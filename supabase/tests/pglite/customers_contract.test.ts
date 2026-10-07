// @vitest-environment node
/**
 * P5 (customers, invitations) against the real migrations.
 *
 * The app's own code runs here unchanged: lib/admin/customer-actions.ts (what
 * the customer pages and server functions do with the STAFF MEMBER's client),
 * lib/admin/order-actions.ts keepOrderAfterCancellation, and
 * src/server/invitations.ts (lookup and redemption with the service role).
 * A small stand-in for supabase-js turns their calls into SQL: every request
 * runs in its own transaction as the right API role (asUser / asService),
 * auth.admin.* writes auth.users the way GoTrue does (asGoTrue), so triggers
 * and RLS behave as in production. Also proves the carry-over migration
 * 20261007150000_p5_customers.sql: "Order behouden" via
 * keep_order_after_cancellation_request, and staff tasks for every confirmed
 * login without a customer record.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Some app modules create the browser client on import; nothing here calls it.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  addCustomerSchema,
  changeCustomerCode,
  customerContactSchema,
  customerHasActivity,
  inviteCustomer,
  inviteCustomerInputSchema,
  recoveryTarget,
  resendInvitation,
  revokeInvitation,
  addCustomer,
  setCustomerDisabledInDb,
  updateCustomerContact,
  type TokenFactory,
} from "@/lib/admin/customer-actions";
import { buildCustomerTimeline, type AuditEntry, type CustomerRow } from "@/lib/admin/customers";
import { keepOrderAfterCancellation } from "@/lib/admin/order-actions";
import { toAppError } from "@/lib/errors";
import { t } from "@/lib/i18n";
import { createInvitationToken, hashInvitationToken } from "@/server/invitation-tokens";
import {
  lookupInvitation,
  redeemForUser,
  redeemWithPassword,
  type AdminClient,
} from "@/server/invitations";

import {
  type AuthUser,
  type Db,
  type Transaction,
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
// supabase-js stand-in: the calls the P5 code makes
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
  gt(c: string, v: unknown) {
    return this.filter((n) => `${ident(c)} > $${n}`, v);
  }
  is(c: string, v: null) {
    if (v !== null) throw new Error("is() supports null only");
    return this.filter(() => `${ident(c)} is null`);
  }
  in(c: string, v: unknown[]) {
    return this.filter((n) => `${ident(c)} = any($${n})`, v);
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  order() {
    return this;
  }

  private sql(): { sql: string; params: unknown[] } {
    const table = `public.${ident(this.table)}`;
    if (this.op === "select") {
      const where = this.where.length ? ` where ${this.where.join(" and ")}` : "";
      const limit = this.max !== null ? ` limit ${this.max}` : "";
      return { sql: `select ${this.cols} from ${table}${where}${limit}`, params: this.params };
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

/** Runs each statement in its own committed request, like PostgREST. */
function requestRunner(
  db: Db,
  as: (fn: (tx: Transaction) => Promise<unknown>) => Promise<unknown>,
): Run {
  return async (sql, params) => {
    try {
      const rows = (await as((tx) => withSavepoint(tx, () => tx.query<Row>(sql, params)))) as {
        rows: Row[];
      };
      return { rows: rows.rows };
    } catch (error) {
      return { error: pgError(error) };
    }
  };
}

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
      // A scalar or void function comes back as one column named after it.
      const first = r.rows[0];
      if (r.rows.length === 1 && first && Object.keys(first).length === 1 && name in first) {
        return { data: first[name], error: null };
      }
      // A function returning one composite row (create_customer, change_customer_code).
      if (["create_customer", "change_customer_code"].includes(name)) {
        return { data: r.rows[0] ?? null, error: null };
      }
      return { data: r.rows, error: null };
    },
    from(table: string) {
      return new Query(run, table);
    },
  };
}

type StaffClient = Parameters<typeof inviteCustomer>[0];

/** A signed-in user's client (PostgREST with their token). */
function userClient(db: Db, userId: string): StaffClient {
  return clientFor(
    requestRunner(db, (fn) => asUser(db, userId, fn, { commit: true })),
  ) as unknown as StaffClient;
}

/** supabaseAdmin: the service role for SQL, GoTrue for auth.admin.*. */
function adminClient(db: Db) {
  const base = clientFor(requestRunner(db, (fn) => asService(db, fn, { commit: true })));
  const auth = {
    admin: {
      createUser: vi.fn(
        async (attrs: {
          email: string;
          password: string;
          email_confirm?: boolean;
          app_metadata?: Record<string, unknown>;
          user_metadata?: Record<string, unknown>;
        }) => {
          const user = await createAuthUser(db, {
            email: attrs.email,
            confirmed: attrs.email_confirm === true,
            ...(attrs.app_metadata ? { appMeta: attrs.app_metadata } : {}),
            ...(attrs.user_metadata ? { meta: attrs.user_metadata } : {}),
          });
          return { data: { user }, error: null };
        },
      ),
      updateUserById: vi.fn(
        async (
          id: string,
          attrs: {
            email_confirm?: boolean;
            app_metadata?: Record<string, unknown>;
            user_metadata?: Record<string, unknown>;
          },
        ) => {
          // GoTrue confirms first, then writes app_metadata (the order the
          // sign-up trigger has to cope with, SPEC §35.6 path b).
          await asGoTrue(db, async (tx) => {
            if (attrs.email_confirm) {
              await tx.query(
                "update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1",
                [id],
              );
            }
            if (attrs.app_metadata) {
              await tx.query(
                "update auth.users set raw_app_meta_data = raw_app_meta_data || $2::jsonb where id = $1",
                [id, JSON.stringify(attrs.app_metadata)],
              );
            }
            if (attrs.user_metadata) {
              // GoTrue merges user_metadata; a key set to null is removed.
              await tx.query(
                `update auth.users
                    set raw_user_meta_data = jsonb_strip_nulls(coalesce(raw_user_meta_data, '{}'::jsonb) || $2::jsonb)
                  where id = $1`,
                [id, JSON.stringify(attrs.user_metadata)],
              );
            }
          });
          return { data: { user: { id } }, error: null };
        },
      ),
      deleteUser: vi.fn(async (id: string) => {
        await asGoTrue(db, (tx) => tx.query("delete from auth.users where id = $1", [id]));
        return { data: {}, error: null };
      }),
    },
  };
  return { ...base, auth } as unknown as AdminClient & { auth: typeof auth };
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

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** A token factory that remembers what it handed out. */
function tokens() {
  const issued: { token: string; tokenHash: string }[] = [];
  const factory: TokenFactory = async () => {
    const created = await createInvitationToken();
    issued.push(created);
    return created;
  };
  return { factory, issued, last: () => issued.at(-1)! };
}

function nearParamariboMidnight(): boolean {
  const now = new Date();
  const minutes = (now.getUTCHours() * 60 + now.getUTCMinutes() - 180 + 1440) % 1440;
  return minutes < 5 || minutes > 1434;
}

/** Moves an invitation's last send back, past the one-minute resend limit. */
async function ageInvitation(id: string, minutes = 2) {
  await db.query(
    `update public.invitations set last_sent_at = last_sent_at - make_interval(mins => $2) where id = $1`,
    [id, minutes],
  );
}

/** What auth.admin.updateUserById({ ban_duration }) leaves behind ('876000h' / 'none'). */
async function ban(userId: string, banned: boolean) {
  await asGoTrue(db, (tx) =>
    tx.query(
      `update auth.users set banned_until = case when $2::boolean then now() + interval '100 years' end
        where id = $1`,
      [userId, banned],
    ),
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let db: Db;
let admin: AuthUser;
let staff: AuthUser;
let alice: AuthUser; // a customer with a login
let aliceCustomer: string;

const newCustomer = (extra: Partial<Record<string, string>> = {}) =>
  inviteCustomerInputSchema.parse({
    mode: "new",
    customer: {
      accountType: "personal",
      fullName: "John Doe",
      email: "john.doe@example.com",
      phone: "",
      code: "",
      companyName: "",
      ...extra,
    },
  });

beforeAll(async () => {
  db = await createDb();
  admin = await createAuthUser(db, {
    email: "admin@example.com",
    meta: { full_name: "Ada Admin" },
  });
  await db.query("insert into public.user_roles (user_id, role) values ($1, 'admin')", [admin.id]);
  await db.query(
    "update public.customers set user_id = null, status = 'disabled', disabled_reason = 'bootstrap admin' where user_id = $1",
    [admin.id],
  );
  staff = await createAuthUser(db, {
    email: "maria.staff@example.com",
    confirmed: false,
    meta: { full_name: "Maria Staff" },
  });
  await db.query("insert into public.user_roles (user_id, role) values ($1, 'staff')", [staff.id]);
  await asGoTrue(db, (tx) =>
    tx.query("update auth.users set email_confirmed_at = now() where id = $1", [staff.id]),
  );
  alice = await createAuthUser(db, {
    email: "alice@example.com",
    meta: { full_name: "Alice Jansen", phone: "+597 8000001" },
  });
  aliceCustomer = (
    await one<{ id: string }>("select id from public.customers where user_id = $1", [alice.id])
  ).id;
});

afterAll(async () => {
  await db?.close();
});

// ---------------------------------------------------------------------------
// Carry-over 1: "Order behouden" (keep_order_after_cancellation_request)
// ---------------------------------------------------------------------------

describe("keep_order_after_cancellation_request (carry-over)", () => {
  async function orderWithRequest() {
    const order = await asUser(
      db,
      alice.id,
      async (tx) =>
        (
          await tx.query<{ id: string; reference: string }>(
            `insert into public.orders (customer_id, store_vendor, description)
             values ($1, 'Amazon', 'Boeken') returning id, reference`,
            [aliceCustomer],
          )
        ).rows[0]!,
      { commit: true },
    );
    await asUser(
      db,
      alice.id,
      (tx) => tx.query("select public.request_order_cancellation($1)", [order.id]),
      {
        commit: true,
      },
    );
    const task = await one<{ id: string }>(
      "select id from public.staff_tasks where order_id = $1 and kind = 'order_cancellation_request'",
      [order.id],
    );
    return { ...order, taskId: task.id };
  }

  it("clears the request, resolves the task as the staff member and audits it, in one call", async () => {
    const order = await orderWithRequest();
    expect(
      await keepOrderAfterCancellation(userClient(db, staff.id), {
        orderId: order.id,
        taskId: order.taskId,
      }),
    ).toEqual({ cleared: true });

    expect(
      await one("select cancellation_requested_at from public.orders where id = $1", [order.id]),
    ).toEqual({ cancellation_requested_at: null });
    expect(
      await one(
        "select resolved_at is not null as resolved, resolved_by from public.staff_tasks where id = $1",
        [order.taskId],
      ),
    ).toEqual({ resolved: true, resolved_by: staff.id });
    expect(
      await one(
        `select actor_id, reason, changed_columns from public.audit_log
          where table_name = 'orders' and record_id = $1 and 'cancellation_requested_at' = any(changed_columns)
            and new_data->>'cancellation_requested_at' is null`,
        [order.id],
      ),
    ).toEqual({
      actor_id: staff.id,
      reason: "Annuleringsverzoek afgehandeld: order behouden",
      changed_columns: ["cancellation_requested_at"],
    });

    // The customer reads why on the order's history (the status stays).
    expect(
      await asUser(
        db,
        alice.id,
        async (tx) =>
          (
            await tx.query(
              `select from_status = to_status as same, customer_message from public.shipment_status_history
                where order_id = $1 order by id`,
              [order.id],
            )
          ).rows,
      ),
    ).toEqual([{ same: true, customer_message: t("admin.order.cancellation.messageDefault") }]);

    // The customer sees no request any more and may ask again (a new task).
    await asUser(
      db,
      alice.id,
      (tx) => tx.query("select public.request_order_cancellation($1)", [order.id]),
      { commit: true },
    );
    expect(
      await rows(
        "select resolved_at is null as open from public.staff_tasks where order_id = $1 order by created_at",
        [order.id],
      ),
    ).toEqual([{ open: false }, { open: true }]);
  });

  it("puts the staff member's own message on the history; refuses one that is too long", async () => {
    const order = await orderWithRequest();
    await expectAppError(
      keepOrderAfterCancellation(userClient(db, staff.id), {
        orderId: order.id,
        taskId: order.taskId,
        customerMessage: "x".repeat(2001),
      }),
      "22023",
    );
    await keepOrderAfterCancellation(userClient(db, staff.id), {
      orderId: order.id,
      taskId: order.taskId,
      customerMessage: "  De winkel heeft het pakket al verzonden; we leveren het gewoon af.  ",
    });
    expect(
      await rows(
        "select customer_message, changed_by from public.shipment_status_history where order_id = $1",
        [order.id],
      ),
    ).toEqual([
      {
        customer_message: "De winkel heeft het pakket al verzonden; we leveren het gewoon af.",
        changed_by: staff.id,
      },
    ]);
  });

  it("is staff-only, refuses a cancelled order and an order without a request", async () => {
    const order = await orderWithRequest();
    await expectAppError(
      keepOrderAfterCancellation(userClient(db, alice.id), { orderId: order.id, taskId: null }),
      "42501",
    );
    await keepOrderAfterCancellation(userClient(db, staff.id), { orderId: order.id, taskId: null });
    const again = await expectAppError(
      keepOrderAfterCancellation(userClient(db, staff.id), { orderId: order.id, taskId: null }),
      "55000",
    );
    expect(again.message).toMatch(/geen annuleringsverzoek open/);

    const cancelled = await orderWithRequest();
    await asUser(
      db,
      staff.id,
      (tx) =>
        tx.query("select * from public.change_order_status(array[$1]::uuid[], 'cancelled')", [
          cancelled.id,
        ]),
      { commit: true },
    );
    await expectAppError(
      keepOrderAfterCancellation(userClient(db, staff.id), { orderId: cancelled.id, taskId: null }),
      "55000",
    );
  });
});

// ---------------------------------------------------------------------------
// Carry-over 2: every confirmed login without a customer record raises a task
// ---------------------------------------------------------------------------

describe("handle_new_user: staff see every login without a customer record (carry-over)", () => {
  it("a known customer who registers while sign-up is off gets the 'send the link' task", async () => {
    const own = await createDb();
    try {
      const staffUser = await createAuthUser(own, { email: "s@example.com", confirmed: false });
      await own.query("insert into public.user_roles (user_id, role) values ($1, 'staff')", [
        staffUser.id,
      ]);
      const known = await asUser(
        own,
        staffUser.id,
        async (tx) =>
          (
            await tx.query<{ id: string; customer_code: string }>(
              "select id, customer_code from public.create_customer('Eddy Existing', '+597 8000000', 'eddy@example.com')",
            )
          ).rows[0]!,
        { commit: true },
      );
      await own.query("update public.company_settings set public_signup_enabled = false");
      await createAuthUser(own, { email: "eddy@example.com" });
      const task = (
        await own.query<{ kind: string; customer_id: string; body: string }>(
          "select kind, customer_id, body from public.staff_tasks",
        )
      ).rows;
      expect(task).toHaveLength(1);
      expect(task[0]).toMatchObject({ kind: "signup_email_conflict", customer_id: known.id });
      expect(task[0]?.body).toContain(known.customer_code);
    } finally {
      await own.close();
    }
  });

  it("redeeming an invitation for that address resolves a 'sign-up was off' task", async () => {
    const own = await createDb();
    try {
      const staffUser = await createAuthUser(own, { email: "s2@example.com", confirmed: false });
      await own.query("insert into public.user_roles (user_id, role) values ($1, 'staff')", [
        staffUser.id,
      ]);
      await own.query("update public.company_settings set public_signup_enabled = false");
      const early = await createAuthUser(own, { email: "early@example.com" });
      expect(
        (await own.query("select kind from public.staff_tasks where email = 'early@example.com'"))
          .rows,
      ).toEqual([{ kind: "signup_customer_failed" }]);

      // Staff create the record and invite it; the person accepts with the
      // login they already have (path c).
      const t1 = tokens();
      const invited = await inviteCustomer(
        userClient(own, staffUser.id),
        inviteCustomerInputSchema.parse({
          mode: "new",
          customer: {
            accountType: "personal",
            fullName: "Erik Early",
            email: "early@example.com",
            phone: "",
            code: "",
            companyName: "",
          },
        }),
        t1.factory,
      );
      expect(invited.status).toBe("invited");
      const outcome = await redeemForUser(adminClient(own), {
        token: t1.last().token,
        userId: early.id,
        acceptTerms: true,
      });
      expect(outcome).toMatchObject({ ok: true, destination: "/portal" });
      expect(
        (
          await own.query(
            "select resolved_by from public.staff_tasks where email = 'early@example.com'",
          )
        ).rows,
      ).toEqual([{ resolved_by: early.id }]);
    } finally {
      await own.close();
    }
  });
});

// ---------------------------------------------------------------------------
// "Klant toevoegen" and GR codes
// ---------------------------------------------------------------------------

describe("Klant toevoegen (create_customer with the staff member's client)", () => {
  const input = (extra: Record<string, string> = {}) =>
    addCustomerSchema.parse({
      accountType: "personal",
      fullName: "Dave Zonder Login",
      phone: "8001234",
      email: "",
      code: "",
      companyName: "",
      kkfNumber: "",
      contactPerson: "",
      address: "",
      district: "",
      ...extra,
    });

  it("takes a code as staff type it, and refuses it twice with the Dutch message", async () => {
    const dave = await addCustomer(userClient(db, staff.id), input({ code: "gr 17" }));
    expect(dave).toMatchObject({
      customer_code: "GR00017",
      status: "active",
      user_id: null,
      phone: "+5978001234",
      email: null,
    });
    const taken = await expectAppError(
      addCustomer(userClient(db, staff.id), input({ code: "17", fullName: "Iemand Anders" })),
      "23505",
    );
    expect(taken.message).toBe("GR00017 is al toegewezen aan Dave Zonder Login");
  });

  it("numbers the customer itself without a code; peek_next_customer_number predicted it", async () => {
    const next = (await userClient(db, staff.id).rpc("peek_next_customer_number")) as {
      data: number;
    };
    const customer = await addCustomer(
      userClient(db, staff.id),
      input({ fullName: "Nieuw Nummer" }),
    );
    expect(customer.customer_code).toBe(`GR${String(next.data).padStart(5, "0")}`);
  });

  it("a customer cannot add customers (42501)", async () => {
    await expectAppError(addCustomer(userClient(db, alice.id), input({ fullName: "X" })), "42501");
  });
});

// ---------------------------------------------------------------------------
// Invitations (SPEC §35.6)
// ---------------------------------------------------------------------------

describe("Klant uitnodigen (inviteCustomer with the staff member's client)", () => {
  it("creates the customer (code reserved, status invited) and an invitation holding only the token's hash", async () => {
    const t1 = tokens();
    const result = await inviteCustomer(
      userClient(db, staff.id),
      newCustomer({ email: "John.Doe@Example.com", code: "GR 23" }),
      t1.factory,
    );
    expect(result).toMatchObject({
      status: "invited",
      customerCreated: true,
      customer: { customer_code: "GR00023", email: "john.doe@example.com", phone: null },
    });
    if (result.status !== "invited") throw new Error("not invited");
    expect(result.token).toBe(t1.last().token);

    const stored = await one<Row>(
      "select i.token_hash, i.created_by, i.send_count, c.status from public.invitations i join public.customers c on c.id = i.customer_id where i.id = $1",
      [result.invitationId],
    );
    expect(stored).toEqual({
      token_hash: sha256(result.token),
      created_by: staff.id,
      send_count: 1,
      status: "invited",
    });
    expect(await hashInvitationToken(result.token)).toBe(stored["token_hash"]);
    // The token itself is nowhere in the database, not even in the audit log.
    expect(
      await rows(
        "select id from public.audit_log where old_data::text like $1 or new_data::text like $1",
        [`%${result.token}%`],
      ),
    ).toEqual([]);
    expect(
      await rows(
        "select id from public.audit_log where table_name = 'invitations' and new_data ? 'token_hash'",
      ),
    ).toEqual([]);
  });

  it("never makes a second record for an e-mail: each conflict comes back with the way forward", async () => {
    const t1 = tokens();
    const staffDb = userClient(db, staff.id);

    // The same address again: already invited.
    const again = await inviteCustomer(staffDb, newCustomer(), t1.factory);
    expect(again).toMatchObject({ status: "conflict", conflict: { kind: "already_invited" } });

    // A customer who logs in already; the requested code can still be given
    // by an admin while there are no orders, not after.
    await createAuthUser(db, { email: "cleo@example.com", meta: { full_name: "Cleo" } });
    const login = await inviteCustomer(
      staffDb,
      newCustomer({ email: "cleo@example.com", code: "GR00099" }),
      t1.factory,
    );
    expect(login).toMatchObject({
      status: "conflict",
      conflict: { kind: "has_login", requestedCode: "GR00099", canChangeCode: true },
    });
    const withOrders = await inviteCustomer(
      staffDb,
      newCustomer({ email: "alice@example.com", code: "GR00099" }),
      t1.factory,
    );
    expect(withOrders).toMatchObject({
      status: "conflict",
      conflict: { kind: "has_login", requestedCode: "GR00099", canChangeCode: false },
    });

    // An existing record without a login, but another code than typed.
    const plain = await addCustomer(
      staffDb,
      addCustomerSchema.parse({
        accountType: "personal",
        fullName: "Paula Plain",
        phone: "8009999",
        email: "paula@example.com",
        code: "",
        companyName: "",
        kkfNumber: "",
        contactPerson: "",
        address: "",
        district: "",
      }),
    );
    const other = await inviteCustomer(
      staffDb,
      newCustomer({ email: "paula@example.com", code: "GR00055", fullName: "Paula" }),
      t1.factory,
    );
    expect(other).toMatchObject({
      status: "conflict",
      conflict: { kind: "other_code", requestedCode: "GR00055", customer: { id: plain.id } },
    });
    // Without a code the existing record is reused, not duplicated.
    const reused = await inviteCustomer(
      staffDb,
      newCustomer({ email: "paula@example.com", fullName: "Paula" }),
      t1.factory,
    );
    expect(reused).toMatchObject({
      status: "invited",
      customerCreated: false,
      customer: { id: plain.id },
    });
    expect(
      await rows("select id from public.customers where email = 'paula@example.com'"),
    ).toHaveLength(1);

    // No e-mail on the record ("Uitnodigen" from the customer page).
    const noMail = await addCustomer(
      staffDb,
      addCustomerSchema.parse({
        accountType: "personal",
        fullName: "Nora Nomail",
        phone: "8001111",
        email: "",
        code: "",
        companyName: "",
        kkfNumber: "",
        contactPerson: "",
        address: "",
        district: "",
      }),
    );
    expect(
      await inviteCustomer(staffDb, { mode: "existing", customerId: noMail.id }, t1.factory),
    ).toMatchObject({ status: "conflict", conflict: { kind: "no_email" } });
  });

  it("'Opnieuw versturen' rotates the token once a minute, five times a day; 'Intrekken' ends it", async () => {
    const t1 = tokens();
    const staffDb = userClient(db, staff.id);
    const invited = await inviteCustomer(
      staffDb,
      newCustomer({ email: "rotate@example.com", fullName: "Rita Rotate" }),
      t1.factory,
    );
    if (invited.status !== "invited") throw new Error("not invited");
    const first = invited.token;

    const wait = await expectAppError(
      resendInvitation(staffDb, invited.invitationId, t1.factory),
      "55000",
    );
    expect(wait.message).toMatch(/Wacht een minuut/);

    await ageInvitation(invited.invitationId);
    const resent = await resendInvitation(staffDb, invited.invitationId, t1.factory);
    expect(resent.invitation).toMatchObject({ id: invited.invitationId, send_count: 2 });
    expect(resent.customer).toMatchObject({ full_name: "Rita Rotate" });
    expect(resent.token).not.toBe(first);

    // The old link is dead; the new one works.
    const service = adminClient(db);
    expect(await lookupInvitation(service, first)).toEqual({ status: "invalid" });
    expect(await lookupInvitation(service, resent.token)).toMatchObject({
      status: "open",
      firstName: "Rita",
      maskedEmail: "ro•••@e•••.com",
    });

    // Five sends per Suriname day (not checked in the minutes around its
    // midnight, where "2 minutes ago" may be yesterday).
    if (!nearParamariboMidnight()) {
      await db.query("update public.invitations set send_count = 5 where id = $1", [
        invited.invitationId,
      ]);
      await ageInvitation(invited.invitationId);
      const limit = await expectAppError(
        resendInvitation(staffDb, invited.invitationId, t1.factory),
        "55000",
      );
      expect(limit.message).toMatch(/vandaag al 5 keer/);
    }

    // A customer cannot see or touch invitations: the update finds nothing.
    await expectAppError(
      resendInvitation(userClient(db, alice.id), invited.invitationId, t1.factory),
      "P0002",
    );

    await revokeInvitation(staffDb, invited.invitationId);
    expect(
      await one(
        "select c.status from public.invitations i join public.customers c on c.id = i.customer_id where i.id = $1",
        [invited.invitationId],
      ),
    ).toEqual({ status: "active" });
    expect(await lookupInvitation(service, resent.token)).toEqual({
      status: "revoked",
      kind: "customer",
    });
    const twice = await expectAppError(revokeInvitation(staffDb, invited.invitationId), "55000");
    expect(twice.message).toBe(t("admin.invitations.notOpen"));
  });
});

describe("redemption (src/server/invitations.ts with the service role)", () => {
  async function invite(email: string, fullName: string, code = "") {
    const t1 = tokens();
    const result = await inviteCustomer(
      userClient(db, staff.id),
      newCustomer({ email, fullName, code }),
      t1.factory,
    );
    if (result.status !== "invited") throw new Error(`not invited: ${result.status}`);
    return result;
  }

  it("path a: no login yet → a confirmed login, linked to the existing GR code, terms recorded", async () => {
    const invited = await invite("hugo@example.com", "Hugo Hendriks", "GR00031");
    const service = adminClient(db);
    expect(await lookupInvitation(service, invited.token)).toMatchObject({
      status: "open",
      customerCode: "GR00031",
      existingAccount: false,
    });

    const outcome = await redeemWithPassword(service, {
      token: invited.token,
      password: "een-goed-wachtwoord",
      acceptTerms: true,
    });
    expect(outcome).toMatchObject({
      ok: true,
      kind: "customer",
      email: "hugo@example.com",
      destination: "/portal",
    });
    if (!outcome.ok) throw new Error("not redeemed");

    const user = await one<Row>(
      "select email_confirmed_at is not null as confirmed, raw_app_meta_data->>'invitation_id' as invitation from auth.users where id = $1",
      [outcome.userId],
    );
    expect(user).toEqual({ confirmed: true, invitation: invited.invitationId });
    const customer = await one<Row>(
      "select customer_code, user_id, status, terms_version, terms_accepted_at is not null as accepted from public.customers where id = $1",
      [invited.customer.id],
    );
    expect(customer).toEqual({
      customer_code: "GR00031",
      user_id: outcome.userId,
      status: "active",
      terms_version: "1",
      accepted: true,
    });
    // The sign-up trigger made no second record for this login.
    expect(
      await rows("select id from public.customers where user_id = $1", [outcome.userId]),
    ).toHaveLength(1);
    // The new login sees exactly its own record.
    expect(
      await asUser(
        db,
        outcome.userId,
        async (tx) => (await tx.query("select customer_code from public.customers")).rows,
      ),
    ).toEqual([{ customer_code: "GR00031" }]);
    expect(await lookupInvitation(service, invited.token)).toEqual({
      status: "accepted",
      kind: "customer",
    });
  });

  it("path b: an unconfirmed sign-up → password set, confirmed, linked; its conflict task resolved", async () => {
    const invited = await invite("ina@example.com", "Ina Isselt");
    const ina = await createAuthUser(db, { email: "ina@example.com", confirmed: false });
    const service = adminClient(db);
    expect(await lookupInvitation(service, invited.token)).toMatchObject({
      existingAccount: false,
    });

    const outcome = await redeemWithPassword(service, {
      token: invited.token,
      password: "een-goed-wachtwoord",
      acceptTerms: true,
    });
    expect(outcome).toMatchObject({ ok: true, userId: ina.id });
    expect(service.auth.admin.createUser).not.toHaveBeenCalled();
    expect(
      await one("select user_id, status from public.customers where id = $1", [
        invited.customer.id,
      ]),
    ).toEqual({ user_id: ina.id, status: "active" });
    // GoTrue confirmed before it wrote invitation_id, so the trigger raised a
    // task; the redemption resolved it.
    expect(
      await rows("select resolved_by from public.staff_tasks where email = 'ina@example.com'"),
    ).toEqual([{ resolved_by: ina.id }]);
  });

  it("path c: a confirmed login → sign in first; linked only for the invitation's own address", async () => {
    const invited = await invite("carl@example.com", "Carl Confirmed");
    const carl = await createAuthUser(db, { email: "carl@example.com" }); // a stray sign-up: a task, no record
    const service = adminClient(db);
    expect(await lookupInvitation(service, invited.token)).toMatchObject({ existingAccount: true });
    expect(
      await redeemWithPassword(service, {
        token: invited.token,
        password: "een-goed-wachtwoord",
        acceptTerms: true,
      }),
    ).toEqual({ ok: false, reason: "needs_login" });

    // Someone else's login cannot take it: the database compares the addresses.
    const wrong = await expectAppError(
      redeemForUser(service, { token: invited.token, userId: alice.id, acceptTerms: true }),
      "42501",
    );
    expect(wrong.message).toBe("Het e-mailadres van dit account hoort niet bij deze uitnodiging");

    const outcome = await redeemForUser(service, {
      token: invited.token,
      userId: carl.id,
      acceptTerms: true,
    });
    expect(outcome).toMatchObject({ ok: true, userId: carl.id, destination: "/portal" });
    expect(
      await one("select user_id, status from public.customers where id = $1", [
        invited.customer.id,
      ]),
    ).toEqual({ user_id: carl.id, status: "active" });
    // Repeating it is fine for the same login.
    expect(
      await redeemForUser(service, { token: invited.token, userId: carl.id, acceptTerms: false }),
    ).toMatchObject({ ok: true });
    expect(
      await rows(
        "select resolved_at is not null as resolved from public.staff_tasks where email = 'carl@example.com'",
      ),
    ).toEqual([{ resolved: true }]);
  });

  it("a staff invitation grants the role and leads to /admin", async () => {
    const created = await asUser(
      db,
      admin.id,
      async (tx) => {
        const token = await createInvitationToken();
        await tx.query(
          "insert into public.invitations (kind, staff_role, email, token_hash) values ('staff', 'staff', 'kim@example.com', $1)",
          [token.tokenHash],
        );
        return token;
      },
      { commit: true },
    );
    const service = adminClient(db);
    expect(await lookupInvitation(service, created.token)).toMatchObject({
      status: "open",
      kind: "staff",
      staffRole: "staff",
      customerCode: null,
    });
    const outcome = await redeemWithPassword(service, {
      token: created.token,
      password: "een-goed-wachtwoord",
      acceptTerms: false,
    });
    expect(outcome).toMatchObject({ ok: true, kind: "staff", destination: "/admin" });
    if (!outcome.ok) throw new Error("not redeemed");
    expect(
      await asUser(
        db,
        outcome.userId,
        async (tx) => (await tx.query("select public.is_staff() as s")).rows[0],
      ),
    ).toEqual({ s: true });
    expect(
      await rows("select id from public.customers where user_id = $1", [outcome.userId]),
    ).toEqual([]);
  });

  it("disabling the record revokes the link: the page says so and no login is created", async () => {
    const invited = await invite("dora@example.com", "Dora Disabled");
    // An admin disables the record between invitation and redemption…
    await setCustomerDisabledInDb(userClient(db, admin.id), {
      customerId: invited.customer.id,
      disabled: true,
      reason: "Test",
    });
    const service = adminClient(db);
    // …which revoked the invitation: the page says so and nothing is created.
    expect(await lookupInvitation(service, invited.token)).toEqual({
      status: "revoked",
      kind: "customer",
    });
    expect(
      await redeemWithPassword(service, {
        token: invited.token,
        password: "een-goed-wachtwoord",
        acceptTerms: true,
      }),
    ).toEqual({ ok: false, reason: "state", status: "revoked" });
    expect(service.auth.admin.createUser).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Disable / enable, contact edits, code change, reset links
// ---------------------------------------------------------------------------

describe("Deactiveren / Activeren (admin; the database half of setCustomerDisabledFn)", () => {
  it("only an admin disables; the reason, who and when are stored, the open invitation revoked, a note left", async () => {
    const t1 = tokens();
    const invited = await inviteCustomer(
      userClient(db, staff.id),
      newCustomer({ email: "vera@example.com", fullName: "Vera Vertrokken" }),
      t1.factory,
    );
    if (invited.status !== "invited") throw new Error("not invited");
    const input = { customerId: invited.customer.id, disabled: true, reason: "Verhuisd naar NL" };

    await expectAppError(setCustomerDisabledInDb(userClient(db, staff.id), input), "42501");

    const result = await setCustomerDisabledInDb(userClient(db, admin.id), input);
    expect(result).toMatchObject({
      customer: { status: "disabled", user_id: null },
      revokedInvitations: 1,
    });
    expect(
      await one<Row>(
        "select status, disabled_reason, disabled_by, disabled_at is not null as at from public.customers where id = $1",
        [invited.customer.id],
      ),
    ).toEqual({
      status: "disabled",
      disabled_reason: "Verhuisd naar NL",
      disabled_by: admin.id,
      at: true,
    });
    expect(
      await rows("select body, created_by from public.internal_notes where customer_id = $1", [
        invited.customer.id,
      ]),
    ).toEqual([{ body: "Klant gedeactiveerd. Reden: Verhuisd naar NL", created_by: admin.id }]);

    const twice = await expectAppError(
      setCustomerDisabledInDb(userClient(db, admin.id), input),
      "55000",
    );
    expect(twice.message).toBe(t("admin.customers.disable.alreadyDisabled"));

    await setCustomerDisabledInDb(userClient(db, admin.id), {
      ...input,
      disabled: false,
      reason: "Terug",
    });
    expect(
      await one<Row>(
        "select status, disabled_reason, disabled_by from public.customers where id = $1",
        [invited.customer.id],
      ),
    ).toEqual({ status: "active", disabled_reason: null, disabled_by: null });
  });

  it("a disabled customer with a login sees nothing any more (current_customer_id is null)", async () => {
    const bea = await createAuthUser(db, { email: "bea@example.com", meta: { full_name: "Bea" } });
    const beaCustomer = await one<{ id: string }>(
      "select id from public.customers where user_id = $1",
      [bea.id],
    );
    await setCustomerDisabledInDb(userClient(db, admin.id), {
      customerId: beaCustomer.id,
      disabled: true,
      reason: "Misbruik",
    });
    expect(
      await asUser(
        db,
        bea.id,
        async (tx) => (await tx.query("select id from public.customers")).rows,
      ),
    ).toEqual([]);

    // Inviting her says "gedeactiveerd", not "heeft al een login": she cannot sign in.
    expect(
      await inviteCustomer(
        userClient(db, staff.id),
        newCustomer({ fullName: "Bea", email: "bea@example.com" }),
        tokens().factory,
      ),
    ).toMatchObject({ status: "conflict", conflict: { kind: "disabled" } });
  });
});

describe("Gegevens wijzigen and Code wijzigen", () => {
  const values = (extra: Record<string, string> = {}) =>
    customerContactSchema.parse({
      accountType: "personal",
      fullName: "Paula Plain",
      phone: "+597 800 9999",
      email: "paula.new@example.com",
      companyName: "",
      kkfNumber: "",
      contactPerson: "",
      address: "Kwattaweg 1",
      district: "Paramaribo",
      ...extra,
    });

  it("staff edit contact details but not the e-mail; an admin's new address revokes the open invitation", async () => {
    const paula = await one<CustomerRow>(
      "select * from public.customers where email = 'paula@example.com'",
    );
    const saved = await updateCustomerContact(userClient(db, staff.id), paula.id, values(), {
      includeEmail: false,
      current: paula,
    });
    expect(saved).toMatchObject({ email: "paula@example.com" });
    expect(
      await one("select address, district from public.customers where id = $1", [paula.id]),
    ).toEqual({ address: "Kwattaweg 1", district: "Paramaribo" });

    await expectAppError(
      updateCustomerContact(userClient(db, staff.id), paula.id, values(), { includeEmail: true }),
      "42501",
    );

    const open = await one<{ id: string }>(
      "select id from public.invitations where customer_id = $1 and accepted_at is null and revoked_at is null",
      [paula.id],
    );
    await updateCustomerContact(userClient(db, admin.id), paula.id, values(), {
      includeEmail: true,
      current: paula,
    });
    expect(
      await one<Row>(
        "select revoked_at is not null as revoked from public.invitations where id = $1",
        [open.id],
      ),
    ).toEqual({ revoked: true });
    expect(await one("select status from public.customers where id = $1", [paula.id])).toEqual({
      status: "active",
    });
  });

  it("a code changes only by an admin, with a reason (audited), and only without orders", async () => {
    const nora = await one<{ id: string; customer_code: string }>(
      "select id, customer_code from public.customers where full_name = 'Nora Nomail'",
    );
    expect(await customerHasActivity(userClient(db, staff.id), nora.id)).toBe(false);
    await expectAppError(
      changeCustomerCode(userClient(db, staff.id), {
        customerId: nora.id,
        code: "GR00041",
        reason: "x",
      }),
      "42501",
    );
    const changed = await changeCustomerCode(userClient(db, admin.id), {
      customerId: nora.id,
      code: "gr 41",
      reason: "Bestaande klant",
    });
    expect(changed.customer_code).toBe("GR00041");

    // The readable timeline from the real audit rows (admins read audit_log).
    const audit = await asUser(
      db,
      admin.id,
      async (tx) =>
        (
          await tx.query<AuditEntry>(
            "select id, occurred_at, actor_id, table_name, record_id, action, old_data, new_data, changed_columns, reason from public.audit_log where table_name = 'customers' and record_id = $1 order by id",
            [nora.id],
          )
        ).rows,
    );
    const customer = await one<Parameters<typeof buildCustomerTimeline>[0]["customer"]>(
      "select id, created_at::text, created_by, customer_code, status, disabled_at, disabled_by, disabled_reason from public.customers where id = $1",
      [nora.id],
    );
    const timeline = buildCustomerTimeline({
      customer,
      invitations: [],
      audit: audit.map((a) => ({ ...a, occurred_at: new Date(a.occurred_at).toISOString() })),
    });
    expect(timeline.map((e) => [e.kind, e.actorId, e.detail])).toEqual([
      ["created", staff.id, nora.customer_code],
      ["code_changed", admin.id, `${nora.customer_code} → GR00041 · reden: Bestaande klant`],
    ]);

    // With an order the code is frozen.
    await asUser(
      db,
      staff.id,
      (tx) =>
        tx.query(
          "insert into public.orders (customer_id, store_vendor, description) values ($1, 'X', 'Y')",
          [nora.id],
        ),
      { commit: true },
    );
    expect(await customerHasActivity(userClient(db, staff.id), nora.id)).toBe(true);
    await expectAppError(
      changeCustomerCode(userClient(db, admin.id), {
        customerId: nora.id,
        code: "GR00042",
        reason: "x",
      }),
      "55000",
    );
  });
});

describe("Wachtwoord-resetlink maken: who may make one (recoveryTarget)", () => {
  it("staff for a customer's login; a team login only on the team page; never without a login", async () => {
    expect(await recoveryTarget(userClient(db, staff.id), aliceCustomer, false)).toMatchObject({
      userId: alice.id,
      fullName: "Alice Jansen",
    });

    // A customer record that belongs to a login with a staff role.
    const lena = await createAuthUser(db, {
      email: "lena@example.com",
      meta: { full_name: "Lena" },
    });
    const lenaCustomer = await one<{ id: string }>(
      "select id from public.customers where user_id = $1",
      [lena.id],
    );
    await db.query("insert into public.user_roles (user_id, role) values ($1, 'staff')", [lena.id]);
    const refused = await expectAppError(
      recoveryTarget(userClient(db, staff.id), lenaCustomer.id, false),
      "42501",
    );
    expect(refused.message).toBe(t("admin.recovery.staffOnlyAdmin"));
    // Admins make a team member's reset link on /admin/team (which refuses a
    // deactivated member), not here.
    const adminRefused = await expectAppError(
      recoveryTarget(userClient(db, admin.id), lenaCustomer.id, true),
      "55000",
    );
    expect(adminRefused.message).toBe(t("admin.recovery.teamLogin"));

    // Deactivated on the team page (has_role() then says false): still a team
    // login, so still refused. Otherwise a link made now would work again
    // once the member is reactivated.
    await ban(lena.id, true);
    try {
      expect(
        await asUser(
          db,
          lena.id,
          async (tx) => (await tx.query("select public.is_staff() as s")).rows,
        ),
      ).toEqual([{ s: false }]);
      await expectAppError(
        recoveryTarget(userClient(db, staff.id), lenaCustomer.id, false),
        "42501",
      );
      await expectAppError(
        recoveryTarget(userClient(db, admin.id), lenaCustomer.id, true),
        "55000",
      );
    } finally {
      await ban(lena.id, false);
    }

    const nora = await one<{ id: string }>(
      "select id from public.customers where full_name = 'Nora Nomail'",
    );
    const noLogin = await expectAppError(
      recoveryTarget(userClient(db, staff.id), nora.id, false),
      "55000",
    );
    expect(noLogin.message).toBe(t("admin.recovery.noLogin"));
  });
});

describe("the service role stays inside its lane", () => {
  it("get/redeem_invitation and admin_auth_user_by_email refuse a signed-in staff member", async () => {
    for (const sql of [
      "select * from public.get_invitation($1)",
      "select * from public.admin_auth_user_by_email('alice@example.com')",
    ]) {
      await expectSqlError(
        asUser(db, staff.id, (tx) => tx.query(sql, sql.includes("$1") ? ["0".repeat(64)] : [])),
        "42501",
      );
    }
    await expectSqlError(
      asUser(db, staff.id, (tx) =>
        tx.query("select * from public.redeem_invitation($1, $2)", ["0".repeat(64), staff.id]),
      ),
      "42501",
    );
  });
});

// ---------------------------------------------------------------------------
// Team logins, deactivated inviters, resend limits per address, path b names
// ---------------------------------------------------------------------------

describe("team logins and invitations (P5 review)", () => {
  /** A team login without the auto-created customer record (role first, then confirm). */
  async function teamMember(email: string, role: "admin" | "staff"): Promise<AuthUser> {
    const user = await createAuthUser(db, { email, confirmed: false, meta: { full_name: email } });
    await db.query("insert into public.user_roles (user_id, role) values ($1, $2)", [
      user.id,
      role,
    ]);
    await asGoTrue(db, (tx) =>
      tx.query("update auth.users set email_confirmed_at = now() where id = $1", [user.id]),
    );
    return user;
  }

  async function inviteAs(inviter: AuthUser, email: string, fullName: string) {
    const t1 = tokens();
    const result = await inviteCustomer(
      userClient(db, inviter.id),
      newCustomer({ email, fullName }),
      t1.factory,
    );
    if (result.status !== "invited") throw new Error(`not invited: ${result.status}`);
    return result;
  }

  it("Deactiveren never targets a team login: the owner's own record, a staff login linked through path c", async () => {
    // The owner used the app as a customer first (an order), then became the
    // first admin: DEPLOYMENT.md keeps that record linked.
    const owner = await createAuthUser(db, {
      email: "owner@example.com",
      meta: { full_name: "Olaf Owner", phone: "+5978000002" },
    });
    const ownerCustomer = await one<{ id: string }>(
      "select id from public.customers where user_id = $1",
      [owner.id],
    );
    await asUser(
      db,
      owner.id,
      (tx) =>
        tx.query(
          "insert into public.orders (customer_id, store_vendor, description) values ($1, 'Amazon', 'Test')",
          [ownerCustomer.id],
        ),
      { commit: true },
    );
    await db.query("insert into public.user_roles (user_id, role) values ($1, 'admin')", [
      owner.id,
    ]);
    const own = await setCustomerDisabledInDb(userClient(db, owner.id), {
      customerId: ownerCustomer.id,
      disabled: true,
      reason: "Opruimen",
    });
    // setCustomerDisabledFn leaves the login alone when teamLogin is true.
    expect(own).toMatchObject({ customer: { user_id: owner.id }, teamLogin: true });

    // A staff member invited as a customer and linked through path c.
    const kees = await teamMember("kees.staff@example.com", "staff");
    const invited = await inviteAs(staff, "kees.staff@example.com", "Kees Klant");
    expect(
      await redeemForUser(adminClient(db), {
        token: invited.token,
        userId: kees.id,
        acceptTerms: true,
      }),
    ).toMatchObject({ ok: true });
    const off = await setCustomerDisabledInDb(userClient(db, admin.id), {
      customerId: invited.customer.id,
      disabled: true,
      reason: "Test",
    });
    expect(off).toMatchObject({ customer: { user_id: kees.id }, teamLogin: true });
    // Deactivated on the team page: still a team login (has_role() says no).
    await ban(kees.id, true);
    try {
      const on = await setCustomerDisabledInDb(userClient(db, admin.id), {
        customerId: invited.customer.id,
        disabled: false,
        reason: "Test",
      });
      expect(on.teamLogin).toBe(true);
    } finally {
      await ban(kees.id, false);
    }

    // An ordinary customer's login is (un)banned as before.
    const bob = await createAuthUser(db, { email: "bob@example.com", meta: { full_name: "Bob" } });
    const bobCustomer = await one<{ id: string }>(
      "select id from public.customers where user_id = $1",
      [bob.id],
    );
    expect(
      await setCustomerDisabledInDb(userClient(db, admin.id), {
        customerId: bobCustomer.id,
        disabled: true,
        reason: "Test",
      }),
    ).toMatchObject({ customer: { user_id: bob.id }, teamLogin: false });
  });

  it("an invitation whose inviter was deactivated reads as revoked: path b never touches the login", async () => {
    const inviter = await teamMember("ivo.staff@example.com", "staff");
    // Someone registered with the address but never confirmed it.
    const pending = await createAuthUser(db, { email: "pia@example.com", confirmed: false });
    const invited = await inviteAs(inviter, "pia@example.com", "Pia Pending");
    const service = adminClient(db);
    expect(await lookupInvitation(service, invited.token)).toMatchObject({ status: "open" });

    // Banned outside log_team_login_change (the Supabase dashboard): the
    // invitation row is still open, but it no longer redeems.
    await ban(inviter.id, true);
    try {
      expect(await lookupInvitation(service, invited.token)).toEqual({
        status: "revoked",
        kind: "customer",
      });
      expect(
        await redeemWithPassword(service, {
          token: invited.token,
          password: "Een-Sterk-Wachtwoord-1",
          acceptTerms: true,
        }),
      ).toEqual({ ok: false, reason: "state", status: "revoked" });
      expect(service.auth.admin.updateUserById).not.toHaveBeenCalled();
      expect(service.auth.admin.createUser).not.toHaveBeenCalled();
      expect(
        await one(
          "select email_confirmed_at is null as unconfirmed from auth.users where id = $1",
          [pending.id],
        ),
      ).toEqual({ unconfirmed: true });
    } finally {
      await ban(inviter.id, false);
    }
    // Active again: the same link works.
    expect(await lookupInvitation(service, invited.token)).toMatchObject({ status: "open" });
  });

  it.skipIf(nearParamariboMidnight())(
    "the resend limits hold per address: 'Intrekken' + 'Uitnodigen' cannot get round them",
    async () => {
      const first = await inviteAs(staff, "sam@example.com", "Sam Spam");
      await revokeInvitation(userClient(db, staff.id), first.invitationId);
      const t1 = tokens();
      const again = () =>
        inviteCustomer(
          userClient(db, staff.id),
          inviteCustomerInputSchema.parse({ mode: "existing", customerId: first.customer.id }),
          t1.factory,
        );
      const wait = await expectAppError(again(), "55000");
      expect(wait.message).toBe(
        "Wacht een minuut: er is net al een uitnodiging naar sam@example.com verstuurd",
      );

      // Five sends today in total, spread over revoked rows and one resend.
      let id = first.invitationId;
      for (let i = 0; i < 3; i++) {
        await ageInvitation(id);
        const next = await again();
        if (next.status !== "invited") throw new Error(next.status);
        id = next.invitationId;
        if (i < 2) await revokeInvitation(userClient(db, staff.id), id);
      }
      await ageInvitation(id);
      await resendInvitation(userClient(db, staff.id), id, t1.factory);
      await ageInvitation(id);
      const daily = await expectAppError(
        resendInvitation(userClient(db, staff.id), id, t1.factory),
        "55000",
      );
      expect(daily.message).toBe(
        "Er zijn vandaag al 5 uitnodigingen naar sam@example.com verstuurd; probeer het morgen opnieuw",
      );
      await revokeInvitation(userClient(db, staff.id), id);
      await expectAppError(again(), "55000");
    },
  );

  it("path b: the invitation decides the name, not what a stranger typed when pre-registering", async () => {
    await createAuthUser(db, {
      email: "vera.v@example.com",
      confirmed: false,
      meta: { full_name: "G&R Beheer", phone: "+5978000003", company_name: "Nep BV" },
    });
    const invited = await inviteAs(staff, "vera.v@example.com", "Vera Victim");
    const outcome = await redeemWithPassword(adminClient(db), {
      token: invited.token,
      password: "Een-Sterk-Wachtwoord-1",
      acceptTerms: true,
    });
    expect(outcome).toMatchObject({ ok: true });
    expect(
      await one(
        `select p.display_name, u.raw_user_meta_data as meta from public.profiles p
           join auth.users u on u.id = p.id where u.email = 'vera.v@example.com'`,
      ),
    ).toEqual({ display_name: "Vera Victim", meta: { full_name: "Vera Victim" } });

    // A staff invitation carries no name: the stranger's goes, the invitee
    // fills in their own on the page.
    await createAuthUser(db, {
      email: "stan.s@example.com",
      confirmed: false,
      meta: { full_name: "Directeur" },
    });
    const created = await createInvitationToken();
    await asUser(
      db,
      admin.id,
      (tx) =>
        tx.query(
          `insert into public.invitations (kind, staff_role, email, token_hash) values ('staff', 'staff', $1, $2)`,
          ["stan.s@example.com", created.tokenHash],
        ),
      { commit: true },
    );
    expect(
      await redeemWithPassword(adminClient(db), {
        token: created.token,
        password: "Een-Sterk-Wachtwoord-1",
        acceptTerms: false,
      }),
    ).toMatchObject({ ok: true, kind: "staff" });
    expect(
      await one(
        `select p.display_name, u.raw_user_meta_data as meta from public.profiles p
           join auth.users u on u.id = p.id where u.email = 'stan.s@example.com'`,
      ),
    ).toEqual({ display_name: null, meta: {} });
  });
});

describe("SPEC §5 example: John Doe, john@example.com, GR00017", () => {
  it("staff invite with the existing code, John accepts as GR00017; 'gr 17' for someone else is refused; no code → a new one", async () => {
    const own = await createDb();
    try {
      const ownAdmin = await createAuthUser(own, { email: "boss@example.com", confirmed: false });
      await own.query("insert into public.user_roles (user_id, role) values ($1, 'admin')", [
        ownAdmin.id,
      ]);
      await asGoTrue(own, (tx) =>
        tx.query("update auth.users set email_confirmed_at = now() where id = $1", [ownAdmin.id]),
      );
      const asAdmin = clientFor(
        requestRunner(own, (fn) => asUser(own, ownAdmin.id, fn, { commit: true })),
      ) as unknown as StaffClient;
      const t1 = tokens();
      const john = await inviteCustomer(
        asAdmin,
        newCustomer({ fullName: "John Doe", email: "john@example.com", code: "GR00017" }),
        t1.factory,
      );
      expect(john).toMatchObject({
        status: "invited",
        customer: { customer_code: "GR00017", status: "invited" },
      });
      if (john.status !== "invited") throw new Error("not invited");

      const service = adminClient(own);
      expect(await lookupInvitation(service, john.token)).toMatchObject({
        status: "open",
        kind: "customer",
        firstName: "John",
        customerCode: "GR00017",
        existingAccount: false,
      });
      const outcome = await redeemWithPassword(service, {
        token: john.token,
        password: "een-goed-wachtwoord",
        acceptTerms: true,
      });
      expect(outcome).toMatchObject({ ok: true, kind: "customer", destination: "/portal" });
      if (!outcome.ok) throw new Error("not redeemed");
      expect(
        await asUser(
          own,
          outcome.userId,
          async (tx) =>
            (await tx.query("select customer_code, status, full_name from public.customers")).rows,
        ),
      ).toEqual([{ customer_code: "GR00017", status: "active", full_name: "John Doe" }]);

      const dup = await expectAppError(
        inviteCustomer(
          asAdmin,
          newCustomer({ fullName: "Jane Roe", email: "jane@example.com", code: "gr 17" }),
          t1.factory,
        ),
        "23505",
      );
      expect(dup.message).toBe("GR00017 is al toegewezen aan John Doe");

      const piet = await inviteCustomer(
        asAdmin,
        newCustomer({ fullName: "Piet Nieuw", email: "piet@example.com" }),
        t1.factory,
      );
      if (piet.status !== "invited") throw new Error("not invited");
      expect(piet.customer.customer_code).toMatch(/^GR\d{5}$/);
      expect(piet.customer.customer_code).not.toBe("GR00017");
    } finally {
      await own.close();
    }
  });
});
