// @vitest-environment node
/**
 * P5 part B (team page, settings) against the real migrations.
 *
 * The app's own code runs here unchanged: lib/admin/team.ts (what the team
 * page and lib/server-fns/team.functions.ts do with the ADMIN's own client)
 * and lib/admin/settings.ts (every settings section). A small stand-in for
 * supabase-js turns their calls into SQL, each request in its own committed
 * transaction as the right API role, so RLS, the RPC guards and the audit
 * triggers behave as in production. Also proves the team part of migration
 * 20261007150000_p5_customers.sql: a blocked login holds no role,
 * team_members(), log_team_login_change() and set_user_role keeping one
 * admin who can sign in.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Some app modules create the browser client on import; nothing here calls it.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { inviteCustomer, inviteCustomerInputSchema } from "@/lib/admin/customer-actions";
import {
  COMPANY_SECTIONS,
  bankAccountSchema,
  firstIssuedInvoice,
  formatInvoiceNumber,
  incompleteBankCurrencies,
  loadCompanySettings,
  loadInvoiceCounter,
  parseSection,
  saveBankAccount,
  saveCompanySettings,
  saveServiceRate,
  saveWarehouseAddress,
  sectionInputValues,
  serviceRateSchema,
  setInvoiceCounter,
  setNextCustomerNumber,
  setWarehouseAddressActive,
  warehouseAddressSchema,
  type BankAccount,
  type SettingsSection,
} from "@/lib/admin/settings";
import {
  assertTeamLoginChange,
  changeTeamRole,
  inviteStaff,
  inviteStaffSchema,
  loadTeam,
  logTeamLoginChange,
  pendingInvitationsBy,
  type TeamMember,
} from "@/lib/admin/team";
import { toAppError } from "@/lib/errors";
import { todayInSuriname } from "@/lib/format";
import { createInvitationToken } from "@/server/invitation-tokens";

import {
  type AuthUser,
  type Db,
  type Transaction,
  asAnon,
  asGoTrue,
  asService,
  asUser,
  createAuthUser,
  createDb,
  expectSqlError,
  withSavepoint,
} from "./harness";

type Row = Record<string, unknown>;
type DbResult = { data: unknown; error: unknown };
type Run = (sql: string, params: unknown[]) => Promise<{ rows: Row[] } | { error: unknown }>;

// ---------------------------------------------------------------------------
// supabase-js stand-in: the calls the P5-B code makes
// ---------------------------------------------------------------------------

const IDENT = /^[a-z_][a-z0-9_]*$/;
const COLUMNS = /^\*$|^[a-z_][a-z0-9_]*(\s*,\s*[a-z_][a-z0-9_]*)*$/;

function pgError(error: unknown) {
  const e = error as { code?: string; message?: string; hint?: string; detail?: string };
  return {
    code: e.code ?? null,
    message: e.message ?? String(error),
    hint: e.hint ?? null,
    details: e.detail ?? null,
  };
}

const ident = (name: string) => {
  if (!IDENT.test(name)) throw new Error(`bad identifier ${name}`);
  return name;
};
const columns = (list: string) => {
  if (!COLUMNS.test(list)) throw new Error(`bad columns ${list}`);
  return list;
};

/** One PostgREST-like query: filters, then select / insert / update, then a terminal. */
class Query implements PromiseLike<DbResult> {
  private op: "select" | "insert" | "update" = "select";
  private cols = "*";
  private returning: string | null = null;
  private values: Row = {};
  private where: string[] = [];
  private params: unknown[] = [];
  private orderBy: string[] = [];
  private max: number | null = null;

  constructor(
    private readonly run: Run,
    private readonly table: string,
  ) {}

  select(list = "*") {
    if (this.op === "select") this.cols = columns(list);
    else this.returning = columns(list);
    return this;
  }
  insert(row: Row) {
    this.op = "insert";
    this.values = row;
    return this;
  }
  update(row: Row) {
    this.op = "update";
    this.values = row;
    return this;
  }
  private filter(sql: (n: number) => string, value?: unknown) {
    if (value === undefined) {
      this.where.push(sql(0));
    } else {
      this.params.push(value);
      this.where.push(sql(this.params.length));
    }
    return this;
  }
  eq(c: string, v: unknown) {
    return this.filter((n) => `${ident(c)} = $${n}`, v);
  }
  neq(c: string, v: unknown) {
    return this.filter((n) => `${ident(c)} <> $${n}`, v);
  }
  gte(c: string, v: unknown) {
    return this.filter((n) => `${ident(c)} >= $${n}`, v);
  }
  lte(c: string, v: unknown) {
    return this.filter((n) => `${ident(c)} <= $${n}`, v);
  }
  is(c: string, v: null) {
    if (v !== null) throw new Error("is() supports null only");
    return this.filter(() => `${ident(c)} is null`);
  }
  not(c: string, op: string, v: null) {
    if (op !== "is" || v !== null) throw new Error("not() supports 'is null' only");
    return this.filter(() => `${ident(c)} is not null`);
  }
  in(c: string, v: unknown[]) {
    return this.filter((n) => `${ident(c)} = any($${n})`, v);
  }
  order(c: string, opts: { ascending?: boolean } = {}) {
    this.orderBy.push(`${ident(c)} ${opts.ascending === false ? "desc" : "asc"}`);
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }

  private sql(): { sql: string; params: unknown[] } {
    const table = `public.${ident(this.table)}`;
    if (this.op === "select") {
      const where = this.where.length ? ` where ${this.where.join(" and ")}` : "";
      const order = this.orderBy.length ? ` order by ${this.orderBy.join(", ")}` : "";
      const limit = this.max !== null ? ` limit ${this.max}` : "";
      return {
        sql: `select ${this.cols} from ${table}${where}${order}${limit}`,
        params: this.params,
      };
    }
    const keys = Object.keys(this.values).map(ident);
    const values = keys.map((k) => this.values[k]);
    const shift = (s: string) =>
      s.replace(/\$(\d+)/g, (_, d: string) => `$${Number(d) + keys.length}`);
    const returning = ` returning ${this.returning ?? "*"}`;
    if (this.op === "insert") {
      return {
        sql: `insert into ${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})${returning}`,
        params: values,
      };
    }
    const where = this.where.length ? ` where ${this.where.map(shift).join(" and ")}` : "";
    return {
      sql: `update ${table} set ${keys.map((k, i) => `${k} = $${i + 1}`).join(", ")}${where}${returning}`,
      params: [...values, ...this.params],
    };
  }

  private async rows(): Promise<{ rows: Row[] } | { error: unknown }> {
    const { sql, params } = this.sql();
    return this.run(sql, params);
  }

  async single(): Promise<DbResult> {
    const r = await this.rows();
    if ("error" in r) return { data: null, error: r.error };
    // PostgREST's .single() on zero rows (RLS hid it, or nothing matched): PGRST116.
    if (r.rows.length !== 1) return { data: null, error: { code: "PGRST116", message: "0 rows" } };
    return { data: r.rows[0], error: null };
  }

  async maybeSingle(): Promise<DbResult> {
    const r = await this.rows();
    if ("error" in r) return { data: null, error: r.error };
    return { data: r.rows[0] ?? null, error: null };
  }

  then<A = DbResult, B = never>(
    onfulfilled?: ((value: DbResult) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.rows()
      .then((r) => ("error" in r ? { data: null, error: r.error } : { data: r.rows, error: null }))
      .then(onfulfilled, onrejected);
  }
}

const NUMERIC_OID = 1700;

/**
 * Rows as PostgREST sends them in JSON: timestamps as ISO strings, numeric
 * as numbers (PGlite gives Date objects and numeric strings).
 */
function asJson(result: { rows: Row[]; fields: { name: string; dataTypeID: number }[] }): Row[] {
  const numeric = new Set(
    result.fields.filter((f) => f.dataTypeID === NUMERIC_OID).map((f) => f.name),
  );
  return result.rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value instanceof Date
          ? value.toISOString()
          : numeric.has(key) && typeof value === "string"
            ? Number(value)
            : value,
      ]),
    ),
  );
}

/** Runs each statement in its own committed request, like PostgREST. */
function requestRunner(
  db: Db,
  as: (fn: (tx: Transaction) => Promise<unknown>) => Promise<unknown>,
): Run {
  return async (sql, params) => {
    try {
      const result = (await as((tx) => withSavepoint(tx, () => tx.query<Row>(sql, params)))) as {
        rows: Row[];
        fields: { name: string; dataTypeID: number }[];
      };
      return { rows: asJson(result) };
    } catch (error) {
      return { error: pgError(error) };
    }
  };
}

/** Functions that return a table: their rows come back as an array. */
const TABLE_FUNCTIONS = new Set(["team_members"]);

function clientFor(run: Run) {
  return {
    async rpc(name: string, args: Record<string, unknown> = {}): Promise<DbResult> {
      ident(name);
      const keys = Object.keys(args).map(ident);
      const r = await run(
        `select * from public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`,
        keys.map((k) => args[k]),
      );
      if ("error" in r) return { data: null, error: r.error };
      if (TABLE_FUNCTIONS.has(name)) return { data: r.rows, error: null };
      // A scalar or void function comes back as one column named after it.
      const first = r.rows[0];
      if (r.rows.length === 1 && first && name in first) return { data: first[name], error: null };
      return { data: r.rows, error: null };
    },
    from(table: string) {
      return new Query(run, table);
    },
  };
}

type AppClient = Parameters<typeof loadTeam>[0];

/** A signed-in user's client (PostgREST with their token). */
function userClient(userId: string): AppClient {
  return clientFor(
    requestRunner(db, (fn) => asUser(db, userId, fn, { commit: true })),
  ) as unknown as AppClient;
}

async function expectAppError(action: Promise<unknown>, code: string) {
  const error = await action.then(
    () => {
      throw new Error(`expected ${code}, but it succeeded`);
    },
    (e: unknown) => e,
  );
  const app = toAppError(error);
  expect(app.code, app.message).toBe(code);
  return app;
}

async function rows<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function one<T = Row>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await rows<T>(sql, params);
  if (r.length !== 1) throw new Error(`expected one row, got ${r.length}: ${sql}`);
  return r[0] as T;
}

/** What GoTrue does for auth.admin.updateUserById(id, { ban_duration }). */
async function ban(userId: string, banned: boolean) {
  await asGoTrue(db, (tx) =>
    tx.query(
      `update auth.users set banned_until = case when $2 then now() + interval '876000 hours' end
        where id = $1`,
      [userId, banned],
    ),
  );
}

const tokens = async () => createInvitationToken();
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let db: Db;
let admin: AuthUser;
let admin2: AuthUser;
let staff: AuthUser;
let alice: AuthUser; // a customer with a login

async function makeTeamMember(email: string, name: string, role: "admin" | "staff") {
  const user = await createAuthUser(db, {
    email,
    meta: { full_name: name },
    appMeta: { invitation_id: "fixture" },
  });
  await db.query("insert into public.user_roles (user_id, role) values ($1, $2)", [user.id, role]);
  return user;
}

beforeAll(async () => {
  db = await createDb();
  admin = await makeTeamMember("ada.admin@example.com", "Ada Admin", "admin");
  admin2 = await makeTeamMember("bert.beheer@example.com", "Bert Beheer", "admin");
  staff = await makeTeamMember("maria.staff@example.com", "Maria Staff", "staff");
  alice = await createAuthUser(db, {
    email: "alice@example.com",
    meta: { full_name: "Alice Jansen", phone: "+597 8000001" },
  });
});

afterAll(async () => {
  await db?.close();
});

// ---------------------------------------------------------------------------
// Database: the team part of 20261007150000_p5_customers.sql
// ---------------------------------------------------------------------------

describe("team_members()", () => {
  it("lists everyone with a role, with e-mail and state, for admins and staff alike", async () => {
    for (const viewer of [admin, staff]) {
      const list = await asUser(
        db,
        viewer.id,
        async (tx) =>
          (
            await tx.query<{
              email: string;
              roles: string[];
              blocked: boolean;
              display_name: string;
            }>("select email, roles, blocked, display_name from public.team_members()")
          ).rows,
      );
      expect(list).toEqual([
        {
          email: "ada.admin@example.com",
          roles: ["admin"],
          blocked: false,
          display_name: "Ada Admin",
        },
        {
          email: "bert.beheer@example.com",
          roles: ["admin"],
          blocked: false,
          display_name: "Bert Beheer",
        },
        {
          email: "maria.staff@example.com",
          roles: ["staff"],
          blocked: false,
          display_name: "Maria Staff",
        },
      ]);
    }
  });

  it("is closed to customers (42501) and to visitors", async () => {
    await expectSqlError(
      asUser(db, alice.id, (tx) => tx.query("select * from public.team_members()")),
      "42501",
    );
    await expectSqlError(
      asAnon(db, (tx) => tx.query("select * from public.team_members()")),
      "42501",
    );
  });
});

describe("a blocked login holds no role", () => {
  it("is_staff/has_role ignore a banned login at once, and everything comes back on unban", async () => {
    await ban(staff.id, true);
    try {
      const blocked = await asUser(db, staff.id, async (tx) => ({
        staff: (await tx.query<{ v: boolean }>("select public.is_staff() as v")).rows[0]?.v,
        customers: (await tx.query("select id from public.customers")).rows.length,
      }));
      // The access token is still valid, but the database no longer sees a staff member.
      expect(blocked).toEqual({ staff: false, customers: 0 });
      expect(await one("select public.has_role($1, 'staff') as v", [staff.id])).toEqual({
        v: false,
      });
      const listed = await asUser(
        db,
        admin.id,
        async (tx) =>
          (
            await tx.query<{ blocked: boolean }>(
              "select blocked from public.team_members() where user_id = $1",
              [staff.id],
            )
          ).rows,
      );
      expect(listed).toEqual([{ blocked: true }]);
    } finally {
      await ban(staff.id, false);
    }
    expect(
      await asUser(
        db,
        staff.id,
        async (tx) => (await tx.query<{ v: boolean }>("select public.is_staff() as v")).rows[0]?.v,
      ),
    ).toBe(true);
  });

  it("a blocked admin's staff invitation no longer redeems", async () => {
    const { tokenHash } = await createInvitationToken();
    await asUser(
      db,
      admin2.id,
      (tx) =>
        tx.query(
          "insert into public.invitations (kind, staff_role, email, token_hash) values ('staff', 'staff', 'kim@example.com', $1)",
          [tokenHash],
        ),
      { commit: true },
    );
    const kim = await createAuthUser(db, {
      email: "kim@example.com",
      appMeta: { invitation_id: "x" },
    });
    await ban(admin2.id, true);
    try {
      const err = await expectSqlError(
        asService(db, (tx) =>
          tx.query("select * from public.redeem_invitation($1, $2)", [tokenHash, kim.id]),
        ),
        "55000",
      );
      expect(err.message).toMatch(/niet meer geldig/);
    } finally {
      await ban(admin2.id, false);
    }
    await db.query("update public.invitations set revoked_at = now() where token_hash = $1", [
      tokenHash,
    ]);
  });

  it("set_user_role keeps an admin who can sign in", async () => {
    await ban(admin2.id, true);
    try {
      const err = await expectSqlError(
        asUser(db, admin.id, (tx) =>
          tx.query("select public.set_user_role($1, 'admin', false)", [admin.id]),
        ),
        "55000",
      );
      expect(err.message).toMatch(/laatste actieve beheerder/);
    } finally {
      await ban(admin2.id, false);
    }
    // With Bert active again, Ada may step down (rolled back: the block is not committed).
    await asUser(db, admin.id, async (tx) => {
      await tx.query("select public.set_user_role($1, 'admin', false)", [admin.id]);
      expect(
        (await tx.query("select 1 from public.user_roles where user_id = $1", [admin.id])).rows,
      ).toEqual([]);
    });
  });
});

describe("log_team_login_change()", () => {
  it("admins only, a reason, a team member, never yourself", async () => {
    const call = (as: string, target: string, blocked: boolean, reason: string) =>
      asUser(db, as, (tx) =>
        tx.query("select public.log_team_login_change($1, $2, $3)", [target, blocked, reason]),
      );
    await expectSqlError(call(staff.id, admin2.id, true, "x"), "42501");
    await expectSqlError(call(admin.id, staff.id, true, "  "), "22023");
    await expectSqlError(call(admin.id, alice.id, true, "klant"), "P0002");
    const self = await expectSqlError(call(admin.id, admin.id, true, "zelf"), "55000");
    expect(self.message).toBe("U kunt uw eigen login niet deactiveren");
  });

  it("audits who, when and why, and revokes the blocked member's open invitations", async () => {
    const invited = inviteCustomerInputSchema.parse({
      mode: "new",
      customer: {
        accountType: "personal",
        fullName: "Olga Open",
        email: "olga@example.com",
        phone: "",
        code: "",
        companyName: "",
      },
    });
    const result = await inviteCustomer(userClient(staff.id) as never, invited, tokens);
    expect(result.status).toBe("invited");
    // An expired one goes too, but is not counted as open.
    const expired = await inviteCustomer(
      userClient(staff.id) as never,
      inviteCustomerInputSchema.parse({
        mode: "new",
        customer: {
          accountType: "personal",
          fullName: "Evert Expired",
          email: "evert@example.com",
          phone: "",
          code: "",
          companyName: "",
        },
      }),
      tokens,
    );
    if (expired.status !== "invited") throw new Error("not invited");
    await db.query(
      "update public.invitations set expires_at = now() - interval '1 day' where id = $1",
      [expired.invitationId],
    );

    // What the dialog lists before the admin confirms.
    expect(
      (await pendingInvitationsBy(userClient(admin.id), staff.id)).map((i) => [
        i.customer?.full_name,
        i.expired,
      ]),
    ).toEqual([
      ["Evert Expired", true],
      ["Olga Open", false],
    ]);

    const logged = await logTeamLoginChange(userClient(admin.id), {
      userId: staff.id,
      blocked: true,
      reason: "Uit dienst",
    });
    expect(logged).toEqual({ revokedInvitations: 1 });
    expect(
      await rows(
        `select i.email, i.revoked_at is not null as revoked, a.reason
           from public.invitations i
           join public.audit_log a on a.table_name = 'invitations' and a.record_id = i.id::text
                                  and a.new_data ? 'revoked_at' and a.new_data->>'revoked_at' is not null
          where i.email in ('olga@example.com', 'evert@example.com') order by i.email`,
      ),
    ).toEqual([
      {
        email: "evert@example.com",
        revoked: true,
        reason: "Ingetrokken: login van Maria Staff gedeactiveerd",
      },
      {
        email: "olga@example.com",
        revoked: true,
        reason: "Ingetrokken: login van Maria Staff gedeactiveerd",
      },
    ]);
    // Each customer's page says why their link stopped working.
    expect(
      await rows(
        `select c.full_name, n.body, n.created_by from public.internal_notes n
           join public.customers c on c.id = n.customer_id
          where c.email in ('olga@example.com', 'evert@example.com') order by c.full_name`,
      ),
    ).toEqual(
      ["Evert Expired", "Olga Open"].map((full_name) => ({
        full_name,
        body: "De uitnodigingslink van deze klant werkt niet meer: hij is ingetrokken omdat de login van Maria Staff (die de uitnodiging maakte) is gedeactiveerd. Maak een nieuwe uitnodiging met ‘Uitnodigen’.",
        created_by: admin.id,
      })),
    );
    expect(await pendingInvitationsBy(userClient(admin.id), staff.id)).toEqual([]);
    expect(
      await one(
        `select actor_id, reason, new_data from public.audit_log
          where table_name = 'team_login' and record_id = $1 order by id desc limit 1`,
        [staff.id],
      ),
    ).toEqual({ actor_id: admin.id, reason: "Uit dienst", new_data: { login_blocked: true } });

    expect(
      await logTeamLoginChange(userClient(admin.id), {
        userId: staff.id,
        blocked: false,
        reason: "Terug in dienst",
      }),
    ).toEqual({ revokedInvitations: 0 });
  });
});

// ---------------------------------------------------------------------------
// The team page's code (lib/admin/team.ts)
// ---------------------------------------------------------------------------

describe("team page code", () => {
  it("loadTeam reads the full list for admins and staff", async () => {
    for (const viewer of [admin, staff]) {
      const team = await loadTeam(userClient(viewer.id));
      expect(team.complete).toBe(true);
      expect(team.members.map((m) => [m.email, m.roles, m.blocked])).toEqual([
        ["ada.admin@example.com", ["admin"], false],
        ["bert.beheer@example.com", ["admin"], false],
        ["maria.staff@example.com", ["staff"], false],
      ]);
    }
    await expectAppError(loadTeam(userClient(alice.id)), "42501");
  });

  it("assertTeamLoginChange follows the database's rules", async () => {
    const team = await loadTeam(userClient(admin.id));
    expect(assertTeamLoginChange(team, admin.id, { userId: staff.id, blocked: true }).email).toBe(
      "maria.staff@example.com",
    );
    expect(() =>
      assertTeamLoginChange(team, admin.id, { userId: admin.id, blocked: true }),
    ).toThrow(/eigen login/);
    expect(() =>
      assertTeamLoginChange(team, admin.id, { userId: alice.id, blocked: true }),
    ).toThrow(/hoort niet bij het team/);
    expect(() =>
      assertTeamLoginChange(team, admin.id, { userId: staff.id, blocked: false }),
    ).toThrow(/niet gedeactiveerd/);
  });

  it("changeTeamRole: staff ↔ admin with set_user_role; the last admin is kept, nothing half-done", async () => {
    const member = async (id: string): Promise<TeamMember> =>
      (await loadTeam(userClient(admin.id))).members.find((m) => m.userId === id)!;

    await changeTeamRole(userClient(admin.id), await member(staff.id), "admin");
    expect((await member(staff.id)).roles).toEqual(["admin", "staff"]);
    await changeTeamRole(userClient(admin.id), await member(staff.id), "staff");
    expect((await member(staff.id)).roles).toEqual(["staff"]);
    expect(await changeTeamRole(userClient(admin.id), await member(staff.id), "staff")).toEqual({
      changed: false,
    });

    // Staff cannot change roles.
    await expectAppError(
      changeTeamRole(userClient(staff.id), await member(admin2.id), "staff"),
      "42501",
    );

    // Ada is the only admin who can sign in: stepping down is refused and
    // the staff role the call added first is taken back.
    await ban(admin2.id, true);
    try {
      await expectAppError(
        changeTeamRole(userClient(admin.id), await member(admin.id), "staff"),
        "55000",
      );
      expect(
        await rows("select role::text from public.user_roles where user_id = $1", [admin.id]),
      ).toEqual([{ role: "admin" }]);
    } finally {
      await ban(admin2.id, false);
    }
  });

  it("inviteStaff: an invitation with only the token's hash; every conflict with its reason", async () => {
    const values = (email: string) =>
      inviteStaffSchema.parse({ email, role: "staff", fullName: "", phone: "" });
    let token = "";
    const factory = async () => {
      const created = await createInvitationToken();
      token = created.token;
      return created;
    };

    const ok = await inviteStaff(userClient(admin.id), values(" Nina@Example.com "), factory);
    expect(ok).toMatchObject({ status: "invited", email: "nina@example.com", role: "staff" });
    expect(
      await one(
        "select kind::text, staff_role::text, token_hash, created_by from public.invitations where email = 'nina@example.com'",
      ),
    ).toEqual({
      kind: "staff",
      staff_role: "staff",
      token_hash: sha256(token),
      created_by: admin.id,
    });

    const again = await inviteStaff(userClient(admin.id), values("nina@example.com"), factory);
    expect(again).toMatchObject({ status: "conflict", conflict: { kind: "already_invited" } });

    const member = await inviteStaff(
      userClient(admin.id),
      values("maria.staff@example.com"),
      factory,
    );
    expect(member).toMatchObject({
      status: "conflict",
      conflict: { kind: "member", member: { displayName: "Maria Staff" } },
    });

    const customer = await inviteStaff(userClient(admin.id), values("alice@example.com"), factory);
    expect(customer).toMatchObject({
      status: "conflict",
      conflict: { kind: "customer", customer: { full_name: "Alice Jansen" } },
    });

    // Only admins invite staff (RLS + invitations_guard).
    await expectAppError(
      inviteStaff(userClient(staff.id), values("piet@example.com"), factory),
      "42501",
    );
  });

  it("a customer invitation for the address is a conflict too", async () => {
    const invited = inviteCustomerInputSchema.parse({
      mode: "new",
      customer: {
        accountType: "personal",
        fullName: "Carla Klant",
        email: "carla@example.com",
        phone: "",
        code: "",
        companyName: "",
      },
    });
    await inviteCustomer(userClient(staff.id) as never, invited, tokens);
    const result = await inviteStaff(
      userClient(admin.id),
      inviteStaffSchema.parse({
        email: "carla@example.com",
        role: "admin",
        fullName: "",
        phone: "",
      }),
      tokens,
    );
    expect(result).toMatchObject({
      status: "conflict",
      conflict: { kind: "customer_invited", customer: { full_name: "Carla Klant" } },
    });
  });
});

// ---------------------------------------------------------------------------
// Settings (lib/admin/settings.ts)
// ---------------------------------------------------------------------------

const section = (id: SettingsSection["id"]) => COMPANY_SECTIONS.find((s) => s.id === id)!;

describe("company settings", () => {
  it("the seeded values pass every section's validation unchanged", async () => {
    const settings = await loadCompanySettings(userClient(staff.id));
    for (const s of COMPANY_SECTIONS) {
      const parsed = parseSection(s, sectionInputValues(s, settings));
      expect(parsed.ok, s.id).toBe(true);
      if (parsed.ok) {
        expect(await saveCompanySettings(userClient(admin.id), parsed.values, settings)).toBeNull();
      }
    }
  });

  it("only admins save, only changed columns, audited", async () => {
    const settings = await loadCompanySettings(userClient(staff.id));
    const invoices = section("facturen");
    const values = {
      ...sectionInputValues(invoices, settings),
      payment_term_days: "14",
      late_fee_percent: "12,5",
    };
    const parsed = parseSection(invoices, values);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));

    await expectAppError(
      saveCompanySettings(userClient(staff.id), parsed.values, settings),
      "42501",
    );

    const saved = await saveCompanySettings(userClient(admin.id), parsed.values, settings);
    expect(saved).toMatchObject({ payment_term_days: 14, late_fee_percent: 12.5 });
    expect(
      await one(
        `select actor_id, changed_columns from public.audit_log
          where table_name = 'company_settings' order by id desc limit 1`,
      ),
    ).toEqual({ actor_id: admin.id, changed_columns: ["late_fee_percent", "payment_term_days"] });

    // Customers read the same row (and the pickup texts) but cannot change it.
    expect((await loadCompanySettings(userClient(alice.id))).payment_term_days).toBe(14);
    await expectAppError(
      saveCompanySettings(userClient(alice.id), { payment_term_days: 1 }, saved!),
      "42501",
    );
  });

  it("the switches steer the database: sign-up off stops new customer records", async () => {
    const settings = await loadCompanySettings(userClient(admin.id));
    const operations = section("werkwijze");
    const parsed = parseSection(operations, {
      ...sectionInputValues(operations, settings),
      public_signup_enabled: "false",
    });
    if (!parsed.ok) throw new Error("invalid");
    await saveCompanySettings(userClient(admin.id), parsed.values, settings);
    const late = await createAuthUser(db, { email: "laat@example.com" });
    expect(await rows("select id from public.customers where user_id = $1", [late.id])).toEqual([]);
    expect(
      await one(
        "select kind::text from public.staff_tasks where email = 'laat@example.com' and resolved_at is null",
      ),
    ).toEqual({ kind: "signup_customer_failed" });
    await saveCompanySettings(
      userClient(admin.id),
      { public_signup_enabled: true },
      await loadCompanySettings(userClient(admin.id)),
    );
  });
});

describe("bank accounts, US addresses, rates", () => {
  it("bank accounts: admins fill the seeded rows; the checklist follows", async () => {
    const accounts = async () =>
      (
        await rows<BankAccount>("select * from public.company_bank_accounts order by sort_order")
      ).map((a) => a);
    expect(incompleteBankCurrencies(await accounts())).toEqual(["USD", "EUR", "SRD"]);
    const usd = (await accounts()).find((a) => a.currency === "USD")!;
    const values = bankAccountSchema.parse({
      bankName: "Hakrinbank",
      accountHolder: "G&R Solutions N.V.",
      accountNumber: "201.234.567",
    });
    await expectAppError(
      saveBankAccount(userClient(staff.id), { id: usd.id, currency: "USD" }, values),
      "42501",
    );
    const saved = await saveBankAccount(
      userClient(admin.id),
      { id: usd.id, currency: "USD" },
      values,
    );
    expect(saved).toMatchObject({
      currency: "USD",
      bank_name: "Hakrinbank",
      account_number: "201.234.567",
    });
    expect(incompleteBankCurrencies(await accounts())).toEqual(["EUR", "SRD"]);
  });

  it("US addresses: added and switched off by admins; customers see only active ones", async () => {
    const values = warehouseAddressSchema.parse({
      label: "Miami – luchtvracht",
      serviceType: "air",
      recipientTemplate: "{FULL_NAME} {GR_CODE}",
      line1: "8000 NW 25th St Suite 1",
      line2Template: "{GR_CODE}",
      city: "Doral",
      state: "FL",
      zip: "33122",
      country: "USA",
      phone: "",
      active: "true",
    });
    await expectAppError(saveWarehouseAddress(userClient(staff.id), null, values), "42501");
    const address = await saveWarehouseAddress(userClient(admin.id), null, values);
    expect(address).toMatchObject({ label: "Miami – luchtvracht", is_active: true, phone: null });

    const seen = () =>
      asUser(
        db,
        alice.id,
        async (tx) =>
          (await tx.query<{ label: string }>("select label from public.warehouse_addresses")).rows,
      );
    expect(await seen()).toEqual([{ label: "Miami – luchtvracht" }]);
    await setWarehouseAddressActive(userClient(admin.id), address.id, false);
    expect(await seen()).toEqual([]);
    expect(
      await one(
        `select count(*)::int as n from public.audit_log where table_name = 'warehouse_addresses' and record_id = $1`,
        [address.id],
      ),
    ).toEqual({ n: 2 });
  });

  it("rates: an admin switches sea freight on with a rate; customers can then pick it", async () => {
    const values = serviceRateSchema.parse({
      enabled: "true",
      ratePerLb: "2,75",
      currency: "USD",
      minimumLbs: "5",
      rounding: "1",
    });
    await expectAppError(saveServiceRate(userClient(staff.id), "sea", values), "42501");
    const saved = await saveServiceRate(userClient(admin.id), "sea", values);
    expect(saved).toMatchObject({
      enabled: true,
      rate_per_lb: 2.75,
      minimum_billable_lbs: 5,
      weight_rounding: "1",
    });
    const visible = await asUser(
      db,
      alice.id,
      async (tx) =>
        (
          await tx.query<{ service_type: string }>(
            "select service_type::text from public.service_rates order by 1",
          )
        ).rows,
    );
    expect(visible).toEqual([{ service_type: "air" }, { service_type: "sea" }]);
  });
});

describe("numbering", () => {
  const year = Number(todayInSuriname().slice(0, 4));

  it("invoice counter: admins continue the numbering; staff neither see nor set it", async () => {
    expect(await loadInvoiceCounter(userClient(admin.id), year)).toBe(0);
    await expectAppError(setInvoiceCounter(userClient(staff.id), year, 41), "42501");
    expect(await setInvoiceCounter(userClient(admin.id), year, 41)).toBe(41);
    expect(await loadInvoiceCounter(userClient(admin.id), year)).toBe(41);
    expect(await loadInvoiceCounter(userClient(staff.id), year)).toBe(0); // RLS: admins only
    expect(await firstIssuedInvoice(userClient(staff.id), year)).toBeNull();
    expect(formatInvoiceNumber("INV-", year, 42)).toBe(`INV-${year}-0042`);
    expect(
      await one(
        `select actor_id, new_data from public.audit_log
          where table_name = 'invoice_number_counters' and record_id = $1 order by id desc limit 1`,
        [String(year)],
      ),
    ).toEqual({ actor_id: admin.id, new_data: { year, last_number: 41 } });
  });

  it("next customer number: only upwards, admins only; peek follows", async () => {
    await expectAppError(setNextCustomerNumber(userClient(staff.id), 500), "42501");
    expect(await setNextCustomerNumber(userClient(admin.id), 500)).toBe(500);
    const peek = await asUser(
      db,
      staff.id,
      async (tx) =>
        (await tx.query<{ n: number }>("select public.peek_next_customer_number() as n")).rows[0]
          ?.n,
    );
    expect(peek).toBe(500);
    // Below a number in use: refused with the database's own Dutch reason.
    const lower = await expectAppError(setNextCustomerNumber(userClient(admin.id), 1), "22023");
    expect(lower.message).toMatch(/hoger zijn dan het hoogste bestaande nummer/);
  });
});
