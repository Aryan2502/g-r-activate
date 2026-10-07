// @vitest-environment node
/**
 * Migration 1 (identity & settings): roles, customers and GR codes, the sign-up
 * trigger, invitations, staff tasks, company settings and the audit log.
 *
 * Fixtures are created as the superuser or through createAuthUser (which runs
 * the real auth.users trigger); every access rule is asserted through
 * asUser/asAnon/asService, never through db.query.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AuthUser,
  type Db,
  type Transaction,
  asAnon,
  asGoTrue,
  asService,
  asUser,
  confirmAuthUser,
  createAuthUser,
  createDb,
  expectSqlError,
  listMigrations,
  withSavepoint,
} from "./harness";

type Q = Pick<Transaction, "query">;

const M1_TABLES = [
  "profiles",
  "user_roles",
  "customers",
  "invitations",
  "staff_tasks",
  "company_settings",
  "company_bank_accounts",
  "warehouse_addresses",
  "service_rates",
  "audit_log",
];

async function rows<T>(tx: Q, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await tx.query<T>(sql, params)).rows;
}

async function one<T>(tx: Q, sql: string, params: unknown[] = []): Promise<T> {
  const r = await rows<T>(tx, sql, params);
  expect(r).toHaveLength(1);
  return r[0] as T;
}

/** What server code stores for an invitation link token (SPEC §35.6). */
function newTokenHash(): string {
  return createHash("sha256").update(randomBytes(32).toString("base64url")).digest("hex");
}

// Resend limits count per Suriname day (UTC-3); avoid the minutes around its midnight.
function nearParamariboMidnight(): boolean {
  const now = new Date();
  const minutes = (now.getUTCHours() * 60 + now.getUTCMinutes() - 180 + 1440) % 1440;
  return minutes < 3 || minutes > 1437;
}

interface Customer {
  id: string;
  user_id: string | null;
  customer_number: number;
  customer_code: string;
  account_type: string;
  full_name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  district: string | null;
  contact_person: string | null;
  status: string;
  terms_version: string | null;
  terms_accepted_at: Date | null;
  disabled_at: Date | null;
  disabled_by: string | null;
  disabled_reason: string | null;
  created_by: string | null;
  updated_by: string | null;
}

interface People {
  admin: AuthUser;
  staff: AuthUser;
  alice: AuthUser;
  bob: AuthUser;
  carol: AuthUser;
  aliceCustomer: string;
  bobCustomer: string;
  carolCustomer: string;
}

async function customerOf(db: Db, userId: string): Promise<Customer | undefined> {
  return (
    await rows<Customer>(db, "select * from public.customers where user_id = $1", [userId])
  )[0];
}

async function requireCustomer(db: Db, userId: string): Promise<Customer> {
  const c = await customerOf(db, userId);
  if (!c) throw new Error(`no customer for ${userId}`);
  return c;
}

/**
 * Admin (bootstrapped as SPEC §35.4 describes), a staff member, two active
 * customers and one disabled customer. In a fresh database the customer
 * numbers are admin 100 (then unlinked), alice 101, bob 102, carol 103.
 */
async function seedPeople(db: Db): Promise<People> {
  const admin = await createAuthUser(db, {
    email: "admin@example.com",
    meta: { full_name: "Ada Admin" },
  });
  await db.query("insert into public.user_roles (user_id, role) values ($1, 'admin')", [admin.id]);
  await db.query(
    `update public.customers set user_id = null, status = 'disabled', disabled_reason = 'bootstrap admin'
      where user_id = $1`,
    [admin.id],
  );

  // The role exists before the e-mail is confirmed, so no customer is created.
  const staff = await createAuthUser(db, {
    email: "staff@example.com",
    confirmed: false,
    meta: { full_name: "Sam Staff" },
  });
  await db.query("insert into public.user_roles (user_id, role) values ($1, 'staff')", [staff.id]);
  await confirmAuthUser(db, staff.id);

  const alice = await createAuthUser(db, {
    email: "alice@example.com",
    meta: { full_name: "Alice Jansen", phone: "+597 8000001", terms_version: "1" },
  });
  const bob = await createAuthUser(db, {
    email: "bob@example.com",
    meta: {
      full_name: "Bob Bakker",
      phone: "+597 8000002",
      account_type: "business",
      company_name: "Bakker N.V.",
    },
  });
  const carol = await createAuthUser(db, {
    email: "carol@example.com",
    meta: { full_name: "Carol Kromo", phone: "+597 8000003" },
  });
  await db.query("update public.customers set status = 'disabled' where user_id = $1", [carol.id]);

  return {
    admin,
    staff,
    alice,
    bob,
    carol,
    aliceCustomer: (await requireCustomer(db, alice.id)).id,
    bobCustomer: (await requireCustomer(db, bob.id)).id,
    carolCustomer: (await requireCustomer(db, carol.id)).id,
  };
}

async function createCustomerAs(
  db: Db,
  staffId: string,
  args: { full_name: string; phone?: string; email?: string | null; code?: string | null },
): Promise<Customer> {
  return asUser(
    db,
    staffId,
    (tx) =>
      one<Customer>(
        tx,
        "select * from public.create_customer(_full_name => $1, _phone => $2, _email => $3, _code => $4)",
        [args.full_name, args.phone ?? "+597 7000000", args.email ?? null, args.code ?? null],
      ),
    { commit: true },
  );
}

async function inviteAs(
  db: Db,
  userId: string,
  values: { customer_id?: string; email: string; kind?: "customer" | "staff"; staff_role?: string },
  opts: { commit?: boolean } = { commit: true },
): Promise<{ id: string; token_hash: string }> {
  const token_hash = newTokenHash();
  const inv = await asUser(
    db,
    userId,
    (tx) =>
      one<{ id: string }>(
        tx,
        `insert into public.invitations (kind, customer_id, staff_role, email, token_hash)
         values ($1, $2, $3, $4, $5) returning id`,
        [
          values.kind ?? "customer",
          values.customer_id ?? null,
          values.staff_role ?? null,
          values.email,
          token_hash,
        ],
      ),
    opts,
  );
  return { id: inv.id, token_hash };
}

// ---------------------------------------------------------------------------
// Shared database: committed fixtures from seedPeople, everything else in
// blocks that roll back unless a test says otherwise.
// ---------------------------------------------------------------------------

let db: Db;
let p: People;

beforeAll(async () => {
  db = await createDb();
  p = await seedPeople(db);
});

afterAll(async () => {
  await db?.close();
});

describe("schema", () => {
  it("is idempotent: running the file again changes nothing", async () => {
    const m1 = listMigrations().find((m) => m.name === "identity_settings");
    if (!m1) throw new Error("identity_settings migration not found");
    const count = `select (select count(*) from public.company_settings)::int as settings,
                          (select count(*) from public.company_bank_accounts)::int as banks,
                          (select count(*) from public.service_rates)::int as rates,
                          (select count(*) from public.customers)::int as customers,
                          (select count(*) from pg_policies where schemaname = 'public')::int as policies,
                          (select count(*) from pg_trigger where not tgisinternal)::int as triggers`;
    await db.transaction(async (tx) => {
      const before = await one(tx, count);
      await tx.exec(m1.sql);
      expect(await one(tx, count)).toEqual(before);
      await tx.rollback();
    });
  });

  it("creates the identity and settings tables with RLS enabled", async () => {
    const tables = await rows<{ relname: string; relrowsecurity: boolean }>(
      db,
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relname = any($1) order by 1`,
      [
        [
          "audit_log",
          "company_bank_accounts",
          "company_settings",
          "customers",
          "invitations",
          "profiles",
          "service_rates",
          "staff_tasks",
          "user_roles",
          "warehouse_addresses",
        ],
      ],
    );
    expect(tables).toHaveLength(10);
    expect(tables.every((t) => t.relrowsecurity)).toBe(true);
  });

  it("defines the enums used across migrations", async () => {
    const enums = await rows<{ typname: string; labels: string[] }>(
      db,
      `select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as labels
         from pg_type t join pg_enum e on e.enumtypid = t.oid
         join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' group by t.typname order by 1`,
    );
    expect(Object.fromEntries(enums.map((e) => [e.typname, e.labels]))).toMatchObject({
      account_type: ["personal", "business"],
      app_role: ["admin", "staff"],
      currency_code: ["USD", "EUR", "SRD"],
      customer_status: ["invited", "active", "disabled"],
      invitation_kind: ["customer", "staff"],
      paper_size: ["Letter", "A4"],
      service_type: ["air", "sea"],
      staff_task_kind: [
        "signup_email_conflict",
        "signup_customer_failed",
        "order_cancellation_request",
      ],
      weight_rounding: ["none", "0.1", "0.5", "1"],
    });
  });

  it("keeps schema private and its sequence away from the API roles", async () => {
    const r = await one<Record<string, boolean>>(
      db,
      `select has_schema_privilege('anon', 'private', 'usage') as anon_usage,
              has_schema_privilege('authenticated', 'private', 'usage') as auth_usage,
              has_schema_privilege('service_role', 'private', 'usage') as service_usage,
              has_sequence_privilege('authenticated', 'private.customer_number_seq', 'usage') as auth_seq`,
    );
    expect(r).toEqual({
      anon_usage: false,
      auth_usage: false,
      service_usage: false,
      auth_seq: false,
    });
    await expectSqlError(
      asUser(db, p.staff.id, (tx) => tx.query("select private.next_customer_number()")),
      "42501",
    );
  });

  it("derives customer_code from customer_number and refuses to store it directly", async () => {
    const r = await one<{ is_generated: string }>(
      db,
      `select attgenerated as is_generated from pg_attribute
        where attrelid = 'public.customers'::regclass and attname = 'customer_code'`,
    );
    expect(r.is_generated).toBe("s");
    await expectSqlError(
      asUser(db, p.admin.id, (tx) =>
        tx.query("update public.customers set customer_code = 'GR00001' where id = $1", [
          p.aliceCustomer,
        ]),
      ),
      "428C9",
    );
  });
});

describe("sign-up trigger (private.handle_new_user)", () => {
  it("creates only a profile until the e-mail is confirmed, then a customer from display fields", async () => {
    const u = await createAuthUser(db, {
      email: "Dana@Example.com",
      confirmed: false,
      meta: {
        full_name: "  Dana Wong  ",
        phone: "+597 8111111",
        account_type: "business",
        company_name: "Wong Trading",
        terms_version: "1",
      },
    });
    expect(
      await rows(db, "select display_name from public.profiles where id = $1", [u.id]),
    ).toEqual([{ display_name: "Dana Wong" }]);
    expect(await customerOf(db, u.id)).toBeUndefined();

    await confirmAuthUser(db, u.id);
    const c = await requireCustomer(db, u.id);
    expect(c).toMatchObject({
      full_name: "Dana Wong",
      email: "dana@example.com",
      phone: "+597 8111111",
      account_type: "business",
      company_name: "Wong Trading",
      terms_version: "1",
      status: "active",
      created_by: u.id,
      updated_by: u.id,
    });
    expect(c.terms_accepted_at).toBeInstanceOf(Date);
    expect(c.customer_code).toBe(`GR${String(c.customer_number).padStart(5, "0")}`);
    expect(c.customer_number).toBeGreaterThanOrEqual(100);

    // Replaying the confirmation (GoTrue may touch the column again) changes nothing.
    await confirmAuthUser(db, u.id);
    expect(
      await rows(db, "select id from public.customers where user_id = $1", [u.id]),
    ).toHaveLength(1);

    // The audit trail attributes the self-registration to the user.
    const audit = await one<{ actor_id: string; action: string }>(
      db,
      "select actor_id, action from public.audit_log where table_name = 'customers' and record_id = $1",
      [c.id],
    );
    expect(audit).toEqual({ actor_id: u.id, action: "INSERT" });
  });

  it("never takes codes, numbers, roles, status or ids from raw_user_meta_data", async () => {
    const other = crypto.randomUUID();
    const u = await createAuthUser(db, {
      email: "mallory@example.com",
      meta: {
        full_name: "Mallory",
        customer_code: "GR00001",
        customer_number: 1,
        status: "disabled",
        role: "admin",
        roles: ["admin"],
        user_id: other,
        id: other,
        account_type: "business", // without company_name this stays personal
      },
    });
    const c = await requireCustomer(db, u.id);
    expect(c.customer_number).not.toBe(1);
    expect(c).toMatchObject({ status: "active", account_type: "personal", company_name: null });
    expect(await rows(db, "select * from public.user_roles where user_id = $1", [u.id])).toEqual(
      [],
    );
    const flags = await asUser(db, u.id, (tx) =>
      one<{ admin: boolean; staff: boolean }>(
        tx,
        "select public.is_admin() as admin, public.is_staff() as staff",
      ),
    );
    expect(flags).toEqual({ admin: false, staff: false });
  });

  it("falls back to the e-mail name and the auth phone when display fields are missing", async () => {
    const u = await createAuthUser(db, { email: "nometa@example.com", phone: "5978222222" });
    expect(await requireCustomer(db, u.id)).toMatchObject({
      full_name: "nometa",
      phone: "5978222222",
      terms_version: null,
      terms_accepted_at: null,
    });
  });

  it("skips users created by invitation redemption and users with a staff role", async () => {
    const invited = await createAuthUser(db, {
      email: "invited@example.com",
      appMeta: { invitation_id: crypto.randomUUID() },
      meta: { full_name: "Ivo Invited" },
    });
    expect(await customerOf(db, invited.id)).toBeUndefined();
    expect(
      await rows(db, "select display_name from public.profiles where id = $1", [invited.id]),
    ).toEqual([{ display_name: "Ivo Invited" }]);

    expect(await customerOf(db, p.staff.id)).toBeUndefined();
    expect(
      await rows(db, "select id from public.profiles where id = $1", [p.staff.id]),
    ).toHaveLength(1);
  });

  it("creates nothing but a staff task when an unlinked customer already has the e-mail", async () => {
    const known = await createCustomerAs(db, p.staff.id, {
      full_name: "Eddy Existing",
      email: "eddy@example.com",
    });
    const u = await createAuthUser(db, {
      email: "EDDY@example.com",
      meta: { full_name: "Eddy E." },
    });
    expect(await customerOf(db, u.id)).toBeUndefined();
    expect(
      await rows(db, "select user_id from public.customers where id = $1", [known.id]),
    ).toEqual([{ user_id: null }]);

    const tasks = await rows<{ kind: string; customer_id: string; email: string; body: string }>(
      db,
      "select kind, customer_id, email, body from public.staff_tasks where customer_id = $1",
      [known.id],
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      kind: "signup_email_conflict",
      customer_id: known.id,
      email: "eddy@example.com",
    });
    expect(tasks[0]?.body).toContain(known.customer_code);
    expect(tasks[0]?.body).toContain("eddy@example.com");

    // A replayed confirmation does not pile up tasks.
    await confirmAuthUser(db, u.id);
    expect(
      await rows(db, "select id from public.staff_tasks where customer_id = $1", [known.id]),
    ).toHaveLength(1);
  });

  it("creates no customer for an e-mail with an open staff invitation; staff get a task", async () => {
    // The invitation link grants the role (SPEC §35.6 path b or c). Since the
    // P5 migration (20261007150000) staff hear about the login without a
    // record: the task asks them to point the person to the invitation link
    // (not to send a customer invitation), and redemption resolves it.
    await inviteAs(db, p.admin.id, {
      kind: "staff",
      staff_role: "staff",
      email: "future.staff@example.com",
    });
    const u = await createAuthUser(db, { email: "future.staff@example.com" });
    expect(await customerOf(db, u.id)).toBeUndefined();
    const tasks = await rows<{ kind: string; customer_id: string | null; body: string }>(
      db,
      "select kind, customer_id, body from public.staff_tasks where email = 'future.staff@example.com'",
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ kind: "signup_email_conflict", customer_id: null });
    expect(tasks[0]?.body).toMatch(/uitnodiging als medewerker/);
    expect(tasks[0]?.body).not.toMatch(/Stuur de klant/);
    expect(await rows(db, "select id from public.profiles where id = $1", [u.id])).toHaveLength(1);
  });

  it("does not block sign-up when the customer cannot be created; staff get a task", async () => {
    const own = await createDb();
    try {
      await own.query("select setval('private.customer_number_seq', 99999)");
      const u = await createAuthUser(own, {
        email: "unlucky@example.com",
        meta: { full_name: "Uno" },
      });
      expect(
        await rows(
          own,
          "select email_confirmed_at is not null as ok from auth.users where id = $1",
          [u.id],
        ),
      ).toEqual([{ ok: true }]);
      expect(await customerOf(own, u.id)).toBeUndefined();
      const task = await one<{ kind: string; body: string }>(
        own,
        "select kind, body from public.staff_tasks",
      );
      expect(task.kind).toBe("signup_customer_failed");
      expect(task.body).toMatch(/kon niet automatisch worden aangemaakt/);
    } finally {
      await own.close();
    }
  });

  it("creates no customer while public sign-up is switched off", async () => {
    const own = await createDb();
    try {
      await own.query("update public.company_settings set public_signup_enabled = false");
      const u = await createAuthUser(own, { email: "closed@example.com" });
      expect(await customerOf(own, u.id)).toBeUndefined();
      expect(await rows(own, "select id from public.profiles where id = $1", [u.id])).toHaveLength(
        1,
      );
      // Since the P5 migration (20261007150000): staff see this login too.
      const task = await one<{ kind: string; email: string; body: string }>(
        own,
        "select kind, email, body from public.staff_tasks",
      );
      expect(task).toMatchObject({ kind: "signup_customer_failed", email: "closed@example.com" });
      expect(task.body).toMatch(/terwijl registreren uitstaat/);

      // Invitations keep working: redemption links the record itself.
      await own.query("update public.company_settings set public_signup_enabled = true");
      const v = await createAuthUser(own, { email: "open@example.com" });
      expect(await customerOf(own, v.id)).toBeDefined();
    } finally {
      await own.close();
    }
  });
});

describe("customer numbers and GR codes", () => {
  let num: Db;
  let np: People;

  beforeAll(async () => {
    num = await createDb();
    np = await seedPeople(num);
  });

  afterAll(async () => {
    await num?.close();
  });

  it("numbers sign-ups from 100 upward", async () => {
    const codes = await rows<{ customer_code: string; user_id: string | null }>(
      num,
      "select customer_code, user_id from public.customers order by customer_number",
    );
    expect(codes).toEqual([
      { customer_code: "GR00100", user_id: null }, // the bootstrap admin, unlinked
      { customer_code: "GR00101", user_id: np.alice.id },
      { customer_code: "GR00102", user_id: np.bob.id },
      { customer_code: "GR00103", user_id: np.carol.id },
    ]);
  });

  it("parses admin input into a number", async () => {
    const ok: Array<[string, number]> = [
      ["GR00017", 17],
      ["gr00017", 17],
      [" GR 17 ", 17],
      ["17", 17],
      ["Gr 0 0 0 1 7", 17],
      ["GR99999", 99999],
      ["1", 1],
    ];
    for (const [input, n] of ok) {
      expect(
        await one<{ n: number }>(num, "select private.parse_customer_code($1) as n", [input]),
      ).toEqual({ n });
    }
    for (const bad of [
      "",
      "GR",
      "GR0",
      "GR00000",
      "GR123456",
      "GRX1",
      "G17",
      "1.5",
      "GR-17",
      null,
    ]) {
      await expectSqlError(num.query("select private.parse_customer_code($1)", [bad]), "22023");
    }
  });

  it("lets staff create customers with a typed code or the next free number", async () => {
    const given = await createCustomerAs(num, np.staff.id, {
      full_name: "Frank Legacy",
      code: "gr 17",
    });
    expect(given).toMatchObject({
      customer_number: 17,
      customer_code: "GR00017",
      status: "active",
      user_id: null,
      created_by: np.staff.id,
    });

    // 105 is taken by hand, so the generator hands out 104 and then skips to 106.
    await createCustomerAs(num, np.staff.id, { full_name: "Typed 105", code: "105" });
    const peek = await asUser(num, np.staff.id, (tx) =>
      one<{ n: number }>(tx, "select public.peek_next_customer_number() as n"),
    );
    expect(peek.n).toBe(104);
    const a = await createCustomerAs(num, np.staff.id, { full_name: "Gen A" });
    const b = await createCustomerAs(num, np.staff.id, { full_name: "Gen B" });
    expect([a.customer_code, b.customer_code]).toEqual(["GR00104", "GR00106"]);
  });

  it("rejects a duplicate code with the Dutch message", async () => {
    await createCustomerAs(num, np.staff.id, { full_name: "Hanna Holder", code: "GR00042" });
    const err = await expectSqlError(
      asUser(num, np.staff.id, (tx) =>
        tx.query("select public.create_customer('Someone Else', '+597 1', null, 'GR 42')"),
      ),
      "23505",
    );
    expect(err.message).toBe("GR00042 is al toegewezen aan Hanna Holder");
  });

  it("validates create_customer input", async () => {
    await asUser(num, np.staff.id, async (tx) => {
      const call = (sql: string) => withSavepoint(tx, () => tx.query(sql));
      expect(
        (await expectSqlError(call("select public.create_customer(' ', '+597 1')"), "22023"))
          .message,
      ).toBe("Naam is verplicht");
      expect(
        (await expectSqlError(call("select public.create_customer('Ivy', '  ')"), "22023")).message,
      ).toBe("Telefoonnummer is verplicht");
      await expectSqlError(
        call("select public.create_customer('Ivy', '+597 1', _account_type => 'business')"),
        /Bedrijfsnaam is verplicht/,
      );
      await expectSqlError(
        call("select public.create_customer('Ivy', '+597 1', _email => 'not-an-email')"),
        /Ongeldig e-mailadres/,
      );
      await expectSqlError(
        call("select public.create_customer('Ivy', '+597 1', _code => 'GR1234567')"),
        "22023",
      );
      await expectSqlError(
        call("select public.create_customer('Ivy', '+597 1', _email => 'ALICE@example.com')"),
        /E-mailadres alice@example.com is al in gebruik bij GR00101/,
      );
      const biz = await one<Customer>(
        tx,
        `select * from public.create_customer('Jan Smit', '+597 1', _email => ' Jan@Smit.SR ',
           _account_type => 'business', _company_name => 'Smit B.V.', _address => 'Hoofdstraat 1')`,
      );
      expect(biz).toMatchObject({
        account_type: "business",
        company_name: "Smit B.V.",
        email: "jan@smit.sr",
        address: "Hoofdstraat 1",
      });
    });
  });

  it("retries when a generated number loses a race (SPEC §35.5)", async () => {
    const own = await createDb();
    try {
      const op = await seedPeople(own);
      // Simulates a concurrent transaction taking the number between the
      // generator's check and the insert: a later BEFORE trigger inserts it
      // first, once. A sequence counts the calls because, unlike a GUC or a
      // row, it survives the rollback of the failed attempt.
      await own.exec(`
        create sequence public.test_collide_calls;
        create function public.test_collide() returns trigger language plpgsql as $$
        begin
          if current_setting('test.collide', true) = 'on' and nextval('public.test_collide_calls') = 1 then
            insert into public.customers (customer_number, full_name) values (new.customer_number, 'Racer');
          end if;
          return new;
        end $$;
        create trigger customers_zz_collide before insert on public.customers
          for each row execute function public.test_collide();
      `);
      const c = await asUser(own, op.staff.id, async (tx) => {
        await tx.query("select set_config('test.collide', 'on', true)");
        return one<Customer>(tx, "select * from public.create_customer('Retry Ria', '+597 1')");
      });
      // 104 lost the race (and was rolled back with the failed attempt); 105 won.
      expect(c.customer_code).toBe("GR00105");
    } finally {
      await own.close();
    }
  });

  it("set_next_customer_number: admin only, above every existing and issued number", async () => {
    for (const user of [np.staff, np.alice, np.carol]) {
      await expectSqlError(
        asUser(num, user.id, (tx) => tx.query("select public.set_next_customer_number(500)")),
        "42501",
      );
    }
    await expectSqlError(
      asAnon(num, (tx) => tx.query("select public.set_next_customer_number(500)")),
      "42501",
    );
    await asUser(
      num,
      np.admin.id,
      async (tx) => {
        const max = await one<{ m: number }>(
          tx,
          "select max(customer_number) as m from public.customers",
        );
        await expectSqlError(
          withSavepoint(tx, () => tx.query("select public.set_next_customer_number($1)", [max.m])),
          /hoger zijn dan het hoogste bestaande nummer/,
        );
        await expectSqlError(
          withSavepoint(tx, () => tx.query("select public.set_next_customer_number(100000)")),
          "22023",
        );
        expect(await one(tx, "select public.set_next_customer_number(500) as n")).toEqual({
          n: 500,
        });
        expect(await one(tx, "select public.peek_next_customer_number() as n")).toEqual({ n: 500 });
        const audit = await one<{ new_data: unknown; actor_id: string }>(
          tx,
          "select new_data, actor_id from public.audit_log where table_name = 'customer_number_seq'",
        );
        expect(audit).toEqual({ new_data: { next: 500 }, actor_id: np.admin.id });
      },
      { commit: true },
    );

    const c = await createCustomerAs(num, np.staff.id, { full_name: "After Reset" });
    expect(c.customer_code).toBe("GR00500");

    // Going back below a number the generator already issued is refused, even
    // when that number is no longer in use.
    await num.query("update public.customers set customer_number = 900 where id = $1", [c.id]);
    await num.query("delete from public.customers where id = $1", [c.id]);
    await expectSqlError(
      asUser(num, np.admin.id, (tx) => tx.query("select public.set_next_customer_number(500)")),
      /al eens uitgegeven/,
    );
  });

  it("change_customer_code: admin only, with a reason, audited", async () => {
    const target = await createCustomerAs(num, np.staff.id, { full_name: "Karel Kode" });
    for (const user of [np.staff, np.alice, np.carol]) {
      await expectSqlError(
        asUser(num, user.id, (tx) =>
          tx.query("select public.change_customer_code($1, 'GR00777', 'test')", [target.id]),
        ),
        "42501",
      );
    }

    await asUser(num, np.admin.id, async (tx) => {
      const call = (code: string, reason: string | null) =>
        withSavepoint(tx, () =>
          one<Customer>(tx, "select * from public.change_customer_code($1, $2, $3)", [
            target.id,
            code,
            reason,
          ]),
        );
      await expectSqlError(call("GR00777", null), /reden is verplicht/);
      await expectSqlError(call("GR00777", "   "), /reden is verplicht/);
      await expectSqlError(call("GR00101", "typo"), /GR00101 is al toegewezen aan Alice Jansen/);
      await expectSqlError(call("ABC", "typo"), "22023");
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("select public.change_customer_code($1, 'GR00778', 'x')", [crypto.randomUUID()]),
        ),
        "P0002",
      );

      const changed = await call("gr 777", "Bestaande klant, oude code uit Excel");
      expect(changed).toMatchObject({ customer_number: 777, customer_code: "GR00777" });
      // The same code again is a no-op, not an error.
      expect((await call("GR00777", "again")).customer_code).toBe("GR00777");

      const audit = await one<{
        actor_id: string;
        changed_columns: string[];
        reason: string;
        old_data: { customer_code: string };
        new_data: { customer_code: string };
      }>(
        tx,
        `select actor_id, changed_columns, reason, old_data, new_data from public.audit_log
          where table_name = 'customers' and record_id = $1 and action = 'UPDATE'`,
        [target.id],
      );
      expect(audit.actor_id).toBe(np.admin.id);
      expect(audit.changed_columns).toEqual(["customer_code", "customer_number"]);
      expect(audit.reason).toBe("Bestaande klant, oude code uit Excel");
      expect(audit.old_data.customer_code).toBe(target.customer_code);
      expect(audit.new_data.customer_code).toBe("GR00777");
      // The flags do not leak into later statements of the transaction.
      expect(
        await one(
          tx,
          `select coalesce(current_setting('app.customer_code_change', true), '') as f,
                  coalesce(current_setting('app.audit_reason', true), '') as r`,
        ),
      ).toEqual({ f: "", r: "" });
    });
  });

  it("refuses a direct customer_number update, even by an admin", async () => {
    for (const user of [np.admin, np.staff]) {
      await expectSqlError(
        asUser(num, user.id, (tx) =>
          tx.query("update public.customers set customer_number = 555 where id = $1", [
            np.bobCustomer,
          ]),
        ),
        "42501",
      );
    }
  });

  it("change_customer_code refuses customers with orders or issued invoices", async (ctx) => {
    const own = await createDb();
    try {
      const exists = await one<{ orders: string | null; invoices: string | null }>(
        own,
        "select to_regclass('public.orders')::text as orders, to_regclass('public.invoices')::text as invoices",
      );
      // Once migrations 2 and 3 exist, their own tests cover this with the real tables.
      if (exists.orders || exists.invoices) ctx.skip();

      const op = await seedPeople(own);
      await own.exec(`
        create table public.orders (id uuid primary key default gen_random_uuid(), customer_id uuid);
        create table public.invoices (id uuid primary key default gen_random_uuid(), customer_id uuid, status text);
      `);
      const change = (id: string, code: string) =>
        asUser(own, op.admin.id, (tx) =>
          tx.query("select public.change_customer_code($1, $2, 'reden')", [id, code]),
        );

      await own.query("insert into public.invoices (customer_id, status) values ($1, 'draft')", [
        op.aliceCustomer,
      ]);
      await change(op.aliceCustomer, "GR00011"); // a draft does not freeze the code

      await own.query("insert into public.invoices (customer_id, status) values ($1, 'open')", [
        op.aliceCustomer,
      ]);
      await expectSqlError(change(op.aliceCustomer, "GR00012"), "55000");

      await own.query("insert into public.orders (customer_id) values ($1)", [op.bobCustomer]);
      const err = await expectSqlError(change(op.bobCustomer, "GR00013"), "55000");
      expect(err.message).toMatch(/GR00102 kan niet meer worden gewijzigd/);
    } finally {
      await own.close();
    }
  });

  // SPEC §35.5 "Numbers are never reused": the portal shows the US address
  // with the GR code from day one, so packages may carry a code its customer
  // later gave up. Such a code must never point at someone else.
  it("never gives a number a customer gave up to anyone else (SPEC §35.5)", async () => {
    const own = await createDb();
    try {
      const op = await seedPeople(own); // 100 (admin, unlinked), 101–103
      const create = (name: string, code: string | null = null) =>
        createCustomerAs(own, op.staff.id, { full_name: name, code });
      const changeCode = (id: string, code: string) =>
        asUser(
          own,
          op.admin.id,
          (tx) =>
            one<Customer>(tx, "select * from public.change_customer_code($1, $2, 'correctie')", [
              id,
              code,
            ]),
          { commit: true },
        );
      const retired = async () =>
        (
          await rows<{ customer_number: number; customer_id: string }>(
            own,
            "select customer_number, customer_id from private.retired_customer_numbers order by 1",
          )
        ).map((r) => [r.customer_number, r.customer_id]);

      // Staff type GR00110 (meant GR00015, above the generator); an admin fixes it.
      const typo = await create("Tim Tikfout", "GR00110");
      await changeCode(typo.id, "GR00015");
      // A self-registered customer moves to their legacy code.
      const xavier = await createAuthUser(own, {
        email: "xavier@example.com",
        meta: { full_name: "Xavier" },
      });
      const x = await requireCustomer(own, xavier.id);
      expect(x.customer_code).toBe("GR00104");
      await changeCode(x.id, "GR00017");
      expect(await retired()).toEqual([
        [104, x.id],
        [110, typo.id],
      ]);

      // The generator skips them...
      const generated: string[] = [];
      for (let i = 0; i < 7; i++) generated.push((await create(`Nieuw ${i}`)).customer_code);
      expect(generated).toEqual([
        "GR00105",
        "GR00106",
        "GR00107",
        "GR00108",
        "GR00109",
        "GR00111",
        "GR00112",
      ]);
      // ...and nobody can type them in: create_customer, a direct insert or a code change.
      for (const code of ["GR00110", "GR00104"]) {
        const err = await expectSqlError(create("Yvonne", code), "23505");
        expect(err.message).toBe(`${code} is eerder gebruikt en wordt niet opnieuw uitgegeven`);
      }
      await expectSqlError(
        asUser(own, op.staff.id, (tx) =>
          tx.query("insert into public.customers (customer_number, full_name) values (110, 'Y')"),
        ),
        "23505",
      );
      await expectSqlError(changeCode(op.bobCustomer, "GR00110"), "23505");

      // The customer who gave a number up may take it back (an undone change).
      expect((await changeCode(typo.id, "GR00110")).customer_code).toBe("GR00110");
      expect(await retired()).toEqual([
        [15, typo.id],
        [104, x.id],
      ]);

      // A customer deleted in the SQL editor retires its number too.
      const gone = await create("Weg");
      await own.query("delete from public.customers where id = $1", [gone.id]);
      expect((await retired()).map(([n]) => n)).toContain(gone.customer_number);
      expect(
        await asUser(own, op.staff.id, (tx) =>
          one(tx, "select public.peek_next_customer_number() as n"),
        ),
      ).toEqual({ n: gone.customer_number + 1 });

      // set_next_customer_number stays above every retired number.
      const high = await create("Hoog", "GR00300");
      await changeCode(high.id, "GR00018");
      await asUser(own, op.admin.id, async (tx) => {
        const err = await expectSqlError(
          withSavepoint(tx, () => tx.query("select public.set_next_customer_number(250)")),
          "22023",
        );
        expect(err.message).toMatch(/GR00300 is eerder gebruikt/);
        expect(await one(tx, "select public.set_next_customer_number(301) as n")).toEqual({
          n: 301,
        });
      });
    } finally {
      await own.close();
    }
  });
});

describe("customers: row access", () => {
  it("customers see only their own active record", async () => {
    const aliceRows = await asUser(db, p.alice.id, (tx) =>
      rows<{ id: string }>(tx, "select id from public.customers"),
    );
    expect(aliceRows).toEqual([{ id: p.aliceCustomer }]);
    const bobRows = await asUser(db, p.bob.id, (tx) =>
      rows<{ id: string }>(tx, "select id from public.customers where id = $1", [p.aliceCustomer]),
    );
    expect(bobRows).toEqual([]);
    expect(
      await asUser(db, p.carol.id, (tx) => rows(tx, "select id from public.customers")),
    ).toEqual([]);
    await expectSqlError(
      asAnon(db, (tx) => tx.query("select * from public.customers")),
      "42501",
    );
  });

  it("current_customer_id() is set only for an active linked customer", async () => {
    const ids: Record<string, string | null> = {};
    for (const [name, user] of Object.entries({
      alice: p.alice,
      carol: p.carol,
      staff: p.staff,
      admin: p.admin,
    })) {
      ids[name] = (
        await asUser(db, user.id, (tx) =>
          one<{ id: string | null }>(tx, "select public.current_customer_id() as id"),
        )
      ).id;
    }
    expect(ids).toEqual({ alice: p.aliceCustomer, carol: null, staff: null, admin: null });
  });

  it("customers cannot write their record directly", async () => {
    await asUser(db, p.alice.id, async (tx) => {
      const upd = await tx.query("update public.customers set full_name = 'Hacked' where id = $1", [
        p.aliceCustomer,
      ]);
      expect(upd.affectedRows).toBe(0);
      const other = await tx.query(
        "update public.customers set full_name = 'Hacked' where id = $1",
        [p.bobCustomer],
      );
      expect(other.affectedRows).toBe(0);
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("insert into public.customers (full_name, phone) values ('Fake', '1')"),
        ),
        "42501",
      );
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("delete from public.customers where id = $1", [p.aliceCustomer]),
        ),
        "42501",
      );
    });
    expect((await requireCustomer(db, p.alice.id)).full_name).toBe("Alice Jansen");
  });

  it("update_my_contact edits only contact fields of the caller's own record", async () => {
    await asUser(db, p.alice.id, async (tx) => {
      const c = await one<Customer>(
        tx,
        "select * from public.update_my_contact(_phone => ' +597 8999999 ', _address => 'Kwattaweg 1', _district => 'Paramaribo')",
      );
      expect(c).toMatchObject({
        id: p.aliceCustomer,
        phone: "+597 8999999",
        address: "Kwattaweg 1",
        district: "Paramaribo",
        full_name: "Alice Jansen",
        email: "alice@example.com",
        status: "active",
        updated_by: p.alice.id,
      });

      // null keeps a value, an empty string clears it (but phone is required).
      const kept = await one<Customer>(
        tx,
        "select * from public.update_my_contact(_address => '')",
      );
      expect(kept).toMatchObject({ phone: "+597 8999999", address: null, district: "Paramaribo" });
      await expectSqlError(
        withSavepoint(tx, () => tx.query("select public.update_my_contact(_phone => '  ')")),
        "22023",
      );

      // Alice cannot read the audit log; inspect it as the superuser.
      await tx.query("reset role");
      const audit = await rows<{ actor_id: string; changed_columns: string[] }>(
        tx,
        `select actor_id, changed_columns from public.audit_log
          where table_name = 'customers' and record_id = $1 and action = 'UPDATE' order by id`,
        [p.aliceCustomer],
      );
      expect(audit).toEqual([
        { actor_id: p.alice.id, changed_columns: ["address", "district", "phone"] },
        { actor_id: p.alice.id, changed_columns: ["address"] },
      ]);
    });
    expect((await requireCustomer(db, p.bob.id)).address).toBeNull();
  });

  it("update_my_contact is refused without an active customer record", async () => {
    for (const user of [p.carol, p.staff, p.admin]) {
      await expectSqlError(
        asUser(db, user.id, (tx) => tx.query("select public.update_my_contact(_phone => '1')")),
        "42501",
      );
    }
    await expectSqlError(
      asAnon(db, (tx) => tx.query("select public.update_my_contact(_phone => '1')")),
      "42501",
    );
  });

  it("customers cannot call staff or admin RPCs", async () => {
    const calls = [
      "select public.create_customer('X', '1')",
      "select public.peek_next_customer_number()",
      "select public.set_next_customer_number(5000)",
      `select public.change_customer_code('${p.aliceCustomer}', 'GR00001', 'x')`,
      `select public.set_user_role('${p.alice.id}', 'admin', true)`,
    ];
    for (const user of [p.alice, p.carol]) {
      for (const sql of calls) {
        const err = await expectSqlError(
          asUser(db, user.id, (tx) => tx.query(sql)),
          "42501",
        );
        expect(err.message).toBe("Geen toegang");
      }
    }
  });

  it("staff read and edit customers but not login, status, e-mail or ownership", async () => {
    await asUser(db, p.staff.id, async (tx) => {
      const all = await rows(tx, "select id from public.customers");
      expect(all.length).toBeGreaterThanOrEqual(4);

      const edited = await one<Customer>(
        tx,
        "update public.customers set full_name = 'Bob B. Bakker', phone = '+597 1' where id = $1 returning *",
        [p.bobCustomer],
      );
      expect(edited).toMatchObject({ full_name: "Bob B. Bakker", updated_by: p.staff.id });

      for (const set of [
        "status = 'disabled'",
        "email = 'new@example.com'",
        `user_id = '${p.staff.id}'`,
        "user_id = null",
        `created_by = '${p.staff.id}'`,
        "disabled_reason = 'x'",
      ]) {
        await expectSqlError(
          withSavepoint(tx, () =>
            tx.query(`update public.customers set ${set} where id = $1`, [p.bobCustomer]),
          ),
          "42501",
        );
      }

      // Direct inserts get a generated number but can never link a login.
      const direct = await one<Customer>(
        tx,
        "insert into public.customers (full_name, phone, created_by) values ('Direct D', '+597 2', $1) returning *",
        [p.alice.id],
      );
      expect(direct.customer_code).toMatch(/^GR\d{5}$/);
      expect(direct.created_by).toBe(p.staff.id);
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query(
            "insert into public.customers (full_name, phone, user_id) values ('Link L', '1', $1)",
            [p.staff.id],
          ),
        ),
        "42501",
      );
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query(
            "insert into public.customers (full_name, phone, status) values ('Off O', '1', 'disabled')",
          ),
        ),
        "42501",
      );
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query(
            "insert into public.customers (full_name, account_type) values ('Biz', 'business')",
          ),
        ),
        "23514",
      );
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("delete from public.customers where id = $1", [p.bobCustomer]),
        ),
        "42501",
      );
    });
  });

  it("admins disable and re-enable customers; the disable fields are stamped", async () => {
    await asUser(db, p.admin.id, async (tx) => {
      const off = await one<Customer>(
        tx,
        "update public.customers set status = 'disabled', disabled_reason = 'Wanbetaling' where id = $1 returning *",
        [p.bobCustomer],
      );
      expect(off).toMatchObject({
        status: "disabled",
        disabled_by: p.admin.id,
        disabled_reason: "Wanbetaling",
      });
      expect(off.disabled_at).toBeInstanceOf(Date);

      const on = await one<Customer>(
        tx,
        "update public.customers set status = 'active' where id = $1 returning *",
        [p.bobCustomer],
      );
      expect(on).toMatchObject({
        status: "active",
        disabled_at: null,
        disabled_by: null,
        disabled_reason: null,
      });

      const mail = await one<Customer>(
        tx,
        "update public.customers set email = ' Bob.New@Example.com ' where id = $1 returning *",
        [p.bobCustomer],
      );
      expect(mail.email).toBe("bob.new@example.com");
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("update public.customers set email = 'alice@example.com' where id = $1", [
            p.bobCustomer,
          ]),
        ),
        /al in gebruik bij GR\d{5} \(Alice Jansen\)/,
      );
    });
  });

  it("a disabled customer sees nothing at all, and anon is denied every table", async () => {
    await asUser(db, p.carol.id, async (tx) => {
      for (const t of M1_TABLES) {
        expect(await rows(tx, `select * from public.${t}`), t).toEqual([]);
      }
    });
    for (const t of M1_TABLES) {
      await expectSqlError(
        asAnon(db, (tx) => tx.query(`select * from public.${t}`)),
        "42501",
      );
    }
  });
});

describe("roles", () => {
  it("is_admin / is_staff / has_role reflect user_roles only", async () => {
    const flags: Record<string, unknown> = {};
    for (const [name, user] of Object.entries({
      admin: p.admin,
      staff: p.staff,
      alice: p.alice,
      carol: p.carol,
    })) {
      flags[name] = await asUser(db, user.id, (tx) =>
        one(tx, "select public.is_admin() as admin, public.is_staff() as staff"),
      );
    }
    expect(flags).toEqual({
      admin: { admin: true, staff: true },
      staff: { admin: false, staff: true },
      alice: { admin: false, staff: false },
      carol: { admin: false, staff: false },
    });
    expect(
      await asUser(db, p.alice.id, (tx) =>
        one(tx, "select public.has_role($1, 'staff') as s, public.has_role($1, 'admin') as a", [
          p.staff.id,
        ]),
      ),
    ).toEqual({ s: true, a: false });
    await expectSqlError(
      asAnon(db, (tx) => tx.query("select public.is_staff()")),
      "42501",
    );
  });

  it("users read their own roles; admins read all; nobody writes them directly", async () => {
    expect(
      await asUser(db, p.alice.id, (tx) => rows(tx, "select * from public.user_roles")),
    ).toEqual([]);
    const own = await asUser(db, p.staff.id, (tx) =>
      rows<{ user_id: string; role: string }>(tx, "select user_id, role from public.user_roles"),
    );
    expect(own).toEqual([{ user_id: p.staff.id, role: "staff" }]);
    const all = await asUser(db, p.admin.id, (tx) =>
      rows<{ user_id: string }>(tx, "select user_id from public.user_roles"),
    );
    expect(all.map((r) => r.user_id).sort()).toEqual([p.admin.id, p.staff.id].sort());

    for (const sql of [
      `insert into public.user_roles (user_id, role) values ('${p.alice.id}', 'admin')`,
      `update public.user_roles set role = 'admin' where user_id = '${p.staff.id}'`,
      `delete from public.user_roles where user_id = '${p.staff.id}'`,
    ]) {
      await expectSqlError(
        asUser(db, p.admin.id, (tx) => tx.query(sql)),
        "42501",
      );
    }
    await expectSqlError(
      asAnon(db, (tx) => tx.query("select * from public.user_roles")),
      "42501",
    );
  });

  it("set_user_role grants and revokes roles for admins only, audited", async () => {
    await expectSqlError(
      asUser(db, p.staff.id, (tx) =>
        tx.query("select public.set_user_role($1, 'staff', true)", [p.bob.id]),
      ),
      "42501",
    );
    await asUser(db, p.admin.id, async (tx) => {
      await tx.query("select public.set_user_role($1, 'staff', true)", [p.bob.id]);
      await tx.query("select public.set_user_role($1, 'staff', true)", [p.bob.id]); // idempotent
      expect(
        await one(tx, "select count(*)::int as n from public.user_roles where user_id = $1", [
          p.bob.id,
        ]),
      ).toEqual({ n: 1 });
      const audit = await one<{ actor_id: string; action: string }>(
        tx,
        `select actor_id, action from public.audit_log
          where table_name = 'user_roles' and new_data ->> 'user_id' = $1`,
        [p.bob.id],
      );
      expect(audit).toEqual({ actor_id: p.admin.id, action: "INSERT" });

      await tx.query("select public.set_user_role($1, 'staff', false)", [p.bob.id]);
      expect(
        await rows(tx, "select * from public.user_roles where user_id = $1", [p.bob.id]),
      ).toEqual([]);
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("select public.set_user_role($1, 'staff', true)", [crypto.randomUUID()]),
        ),
        "P0002",
      );
    });
  });

  it("set_user_role refuses to remove the last admin", async () => {
    await asUser(db, p.admin.id, async (tx) => {
      const err = await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("select public.set_user_role($1, 'admin', false)", [p.admin.id]),
        ),
        "55000",
      );
      expect(err.message).toBe("De laatste beheerder kan niet worden verwijderd");

      await tx.query("select public.set_user_role($1, 'admin', true)", [p.staff.id]);
      await tx.query("select public.set_user_role($1, 'admin', false)", [p.admin.id]);
      expect(
        await one(
          tx,
          "select public.has_role($1, 'admin') as old, public.has_role($2, 'admin') as new",
          [p.admin.id, p.staff.id],
        ),
      ).toEqual({ old: false, new: true });
      // The former admin is now a plain user and can no longer manage roles.
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("select public.set_user_role($1, 'admin', true)", [p.admin.id]),
        ),
        "42501",
      );
    });
  });
});

describe("profiles", () => {
  it("customers see and edit only their own profile; staff see all", async () => {
    await asUser(db, p.alice.id, async (tx) => {
      expect(await rows(tx, "select id from public.profiles")).toEqual([{ id: p.alice.id }]);
      const upd = await one<{ display_name: string; updated_at: Date }>(
        tx,
        "update public.profiles set display_name = 'Alice J.' where id = $1 returning display_name, updated_at",
        [p.alice.id],
      );
      expect(upd.display_name).toBe("Alice J.");
      const other = await tx.query("update public.profiles set display_name = 'x' where id = $1", [
        p.bob.id,
      ]);
      expect(other.affectedRows).toBe(0);
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("update public.profiles set id = $1 where id = $2", [p.bob.id, p.alice.id]),
        ),
        "42501",
      );
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("insert into public.profiles (id) values ($1)", [crypto.randomUUID()]),
        ),
        "42501",
      );
    });
    const staffView = await asUser(db, p.staff.id, (tx) =>
      rows<{ id: string }>(tx, "select id from public.profiles where id = any($1)", [
        [p.alice.id, p.bob.id, p.admin.id],
      ]),
    );
    expect(staffView).toHaveLength(3);
    await expectSqlError(
      asAnon(db, (tx) => tx.query("select * from public.profiles")),
      "42501",
    );
  });
});

describe("invitations", () => {
  let inv: Db;
  let ip: People;

  beforeAll(async () => {
    inv = await createDb();
    ip = await seedPeople(inv);
  });

  afterAll(async () => {
    await inv?.close();
  });

  it("staff invite a customer; the row is stamped and the customer becomes 'invited'", async () => {
    const c = await createCustomerAs(inv, ip.staff.id, {
      full_name: "Dirk Doe",
      email: "dirk@example.com",
      code: "GR00017",
    });
    const { id } = await inviteAs(inv, ip.staff.id, {
      customer_id: c.id,
      email: " DIRK@example.com",
    });
    const row = await one<{
      email: string;
      send_count: number;
      created_by: string;
      sent_recently: boolean;
      expires_in_days: number;
      accepted_at: Date | null;
    }>(
      inv,
      `select email, send_count, created_by, last_sent_at > now() - interval '1 minute' as sent_recently,
              round(extract(epoch from expires_at - now()) / 86400)::int as expires_in_days, accepted_at
         from public.invitations where id = $1`,
      [id],
    );
    expect(row).toEqual({
      email: "dirk@example.com",
      send_count: 1,
      created_by: ip.staff.id,
      sent_recently: true,
      expires_in_days: 7,
      accepted_at: null,
    });
    expect(
      (await one<Customer>(inv, "select * from public.customers where id = $1", [c.id])).status,
    ).toBe("invited");

    // The token hash never reaches the audit log.
    const audit = await rows<{ new_data: Record<string, unknown> }>(
      inv,
      "select new_data from public.audit_log where table_name = 'invitations' and record_id = $1",
      [id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.new_data).not.toHaveProperty("token_hash");
    expect(audit[0]?.new_data).toHaveProperty("email", "dirk@example.com");
  });

  it("validates the target customer and allows one open invitation per customer", async () => {
    const noMail = await createCustomerAs(inv, ip.staff.id, { full_name: "No Mail" });
    const withMail = await createCustomerAs(inv, ip.staff.id, {
      full_name: "Elsa Example",
      email: "elsa@example.com",
    });
    await expectSqlError(
      inviteAs(inv, ip.staff.id, { customer_id: noMail.id, email: "nomail@example.com" }),
      /e-mailadres van het klantdossier/,
    );
    await expectSqlError(
      inviteAs(inv, ip.staff.id, { customer_id: withMail.id, email: "other@example.com" }),
      /e-mailadres van het klantdossier/,
    );
    await expectSqlError(
      inviteAs(inv, ip.staff.id, { customer_id: ip.aliceCustomer, email: "alice@example.com" }),
      /heeft al een account/,
    );
    await inviteAs(inv, ip.staff.id, { customer_id: withMail.id, email: "elsa@example.com" });
    await expectSqlError(
      inviteAs(inv, ip.staff.id, { customer_id: withMail.id, email: "elsa@example.com" }),
      "23505",
    );
    await expectSqlError(
      inviteAs(inv, ip.staff.id, { customer_id: withMail.id, email: "elsa@example.com" }),
      "23505",
    );
  });

  it("only admins invite staff; customers and anon have no access at all", async () => {
    await expectSqlError(
      inviteAs(inv, ip.staff.id, { kind: "staff", staff_role: "staff", email: "s1@example.com" }),
      "42501",
    );
    await expectSqlError(
      inviteAs(inv, ip.staff.id, { kind: "staff", staff_role: "admin", email: "s2@example.com" }),
      "42501",
    );
    const staffInv = await inviteAs(
      inv,
      ip.admin.id,
      { kind: "staff", staff_role: "staff", email: "s3@example.com" },
      { commit: false },
    );
    expect(staffInv.id).toBeTruthy();

    for (const user of [ip.alice, ip.carol]) {
      expect(
        await asUser(inv, user.id, (tx) => rows(tx, "select * from public.invitations")),
      ).toEqual([]);
    }
    await expectSqlError(
      inviteAs(inv, ip.alice.id, { customer_id: ip.aliceCustomer, email: "alice@example.com" }),
      "42501",
    );
    await expectSqlError(
      asAnon(inv, (tx) => tx.query("select * from public.invitations")),
      "42501",
    );
    // Staff cannot see staff invitations' hashes differently: same table, staff-only.
    expect(
      (await asUser(inv, ip.staff.id, (tx) => rows(tx, "select id from public.invitations")))
        .length,
    ).toBeGreaterThan(0);
  });

  it("staff can only resend (rotate) or revoke an invitation", async () => {
    const c = await createCustomerAs(inv, ip.staff.id, {
      full_name: "Rita Revoke",
      email: "rita@example.com",
    });
    const { id } = await inviteAs(inv, ip.staff.id, {
      customer_id: c.id,
      email: "rita@example.com",
    });

    await asUser(inv, ip.staff.id, async (tx) => {
      for (const set of [
        `accepted_at = now(), accepted_by = '${ip.staff.id}'`,
        "email = 'other@example.com'",
        "expires_at = now() + interval '1 year'",
        "send_count = 0",
        `created_by = '${ip.admin.id}'`,
      ]) {
        await expectSqlError(
          withSavepoint(tx, () =>
            tx.query(`update public.invitations set ${set} where id = $1`, [id]),
          ),
          "42501",
        );
      }
    });

    // Revoking stamps the real time and returns the customer to 'active'.
    const revoked = await asUser(
      inv,
      ip.staff.id,
      (tx) =>
        one<{ recent: boolean }>(
          tx,
          `update public.invitations set revoked_at = '2000-01-01' where id = $1
           returning revoked_at > now() - interval '1 minute' as recent`,
          [id],
        ),
      { commit: true },
    );
    expect(revoked.recent).toBe(true);
    expect(
      (await one<Customer>(inv, "select * from public.customers where id = $1", [c.id])).status,
    ).toBe("active");
    await expectSqlError(
      asUser(inv, ip.staff.id, (tx) =>
        tx.query("update public.invitations set revoked_at = null where id = $1", [id]),
      ),
      "55000",
    );
    await expectSqlError(
      asUser(inv, ip.staff.id, (tx) =>
        tx.query("update public.invitations set token_hash = $1 where id = $2", [
          newTokenHash(),
          id,
        ]),
      ),
      /niet meer open/,
    );
    // A new invitation is allowed once the old one is revoked, but the resend
    // limits hold per address (P5): not within a minute of the last send.
    await expectSqlError(
      inviteAs(inv, ip.staff.id, { customer_id: c.id, email: "rita@example.com" }),
      /Wacht een minuut: er is net al een uitnodiging naar rita@example.com verstuurd/,
    );
    await inv.query(
      "update public.invitations set last_sent_at = last_sent_at - interval '2 minutes' where id = $1",
      [id],
    );
    await inviteAs(inv, ip.staff.id, { customer_id: c.id, email: "rita@example.com" });
  });

  it.skipIf(nearParamariboMidnight())(
    "resending rotates the token at most once a minute and five times a day",
    async () => {
      const c = await createCustomerAs(inv, ip.staff.id, {
        full_name: "Ronald Resend",
        email: "ronald@example.com",
      });
      const { id } = await inviteAs(inv, ip.staff.id, {
        customer_id: c.id,
        email: "ronald@example.com",
      });
      const rotate = () =>
        asUser(
          inv,
          ip.staff.id,
          (tx) =>
            one<{ send_count: number; fresh: boolean }>(
              tx,
              `update public.invitations set token_hash = $1 where id = $2
               returning send_count, expires_at > now() + interval '6 days 23 hours' as fresh`,
              [newTokenHash(), id],
            ),
          { commit: true },
        );
      const age = (sql: string) =>
        inv.query(`update public.invitations set ${sql} where id = $1`, [id]);

      await expectSqlError(rotate(), /Wacht een minuut/);

      await age(
        "last_sent_at = now() - interval '2 minutes', expires_at = now() + interval '1 hour'",
      );
      expect(await rotate()).toEqual({ send_count: 2, fresh: true });

      await age("last_sent_at = now() - interval '2 minutes', send_count = 5");
      await expectSqlError(rotate(), /vandaag al 5 keer/);

      // A new Suriname day starts a new count.
      await age("last_sent_at = now() - interval '1 day', send_count = 5");
      expect((await rotate()).send_count).toBe(1);
    },
  );

  it("get_invitation and redeem_invitation are for the service role only", async () => {
    const c = await createCustomerAs(inv, ip.staff.id, {
      full_name: "Guus Guard",
      email: "guus@example.com",
    });
    const { token_hash } = await inviteAs(inv, ip.staff.id, {
      customer_id: c.id,
      email: "guus@example.com",
    });
    for (const sql of [
      "select * from public.get_invitation($1)",
      `select * from public.redeem_invitation($1, '${ip.alice.id}')`,
      "select * from public.admin_auth_user_by_email('alice@example.com')",
    ]) {
      const params = sql.includes("$1") ? [token_hash] : [];
      for (const user of [ip.staff, ip.admin, ip.alice]) {
        await expectSqlError(
          asUser(inv, user.id, (tx) => tx.query(sql, params)),
          "42501",
        );
      }
      await expectSqlError(
        asAnon(inv, (tx) => tx.query(sql, params)),
        "42501",
      );
      // Second fence: even a caller with EXECUTE needs the service-role JWT.
      await expectSqlError(inv.query(sql, params), /Geen toegang/);
    }
  });

  it("redeems a customer invitation for a new login (path a) idempotently", async () => {
    const c = await createCustomerAs(inv, ip.staff.id, {
      full_name: "Hugo Hendriks",
      email: "hugo@example.com",
      code: "GR00023",
    });
    const { id, token_hash } = await inviteAs(inv, ip.staff.id, {
      customer_id: c.id,
      email: "hugo@example.com",
    });

    const info = await asService(inv, (tx) =>
      one<Record<string, unknown>>(tx, "select * from public.get_invitation($1)", [token_hash]),
    );
    expect(info).toMatchObject({
      invitation_id: id,
      kind: "customer",
      email: "hugo@example.com",
      customer_id: c.id,
      customer_code: "GR00023",
      full_name: "Hugo Hendriks",
      accepted_at: null,
      revoked_at: null,
      is_expired: false,
    });
    expect(info).not.toHaveProperty("token_hash");
    expect(
      await asService(inv, (tx) =>
        rows(tx, "select * from public.get_invitation($1)", [newTokenHash()]),
      ),
    ).toEqual([]);

    // auth.admin.createUser({ email_confirm: true, app_metadata: { invitation_id } })
    const hugo = await createAuthUser(inv, {
      email: "hugo@example.com",
      appMeta: { invitation_id: id },
    });
    expect(await customerOf(inv, hugo.id)).toBeUndefined();

    const redeem = () =>
      asService(
        inv,
        (tx) =>
          one<Record<string, unknown>>(tx, "select * from public.redeem_invitation($1, $2)", [
            token_hash,
            hugo.id,
          ]),
        { commit: true },
      );
    expect(await redeem()).toEqual({
      invitation_id: id,
      kind: "customer",
      customer_id: c.id,
      staff_role: null,
    });
    expect(await redeem()).toMatchObject({ invitation_id: id }); // idempotent

    expect(await requireCustomer(inv, hugo.id)).toMatchObject({
      id: c.id,
      customer_code: "GR00023",
      status: "active",
      updated_by: hugo.id,
    });
    expect(
      await one(
        inv,
        "select accepted_by, accepted_at is not null as accepted from public.invitations where id = $1",
        [id],
      ),
    ).toEqual({ accepted_by: hugo.id, accepted: true });
    expect(
      await rows(inv, "select display_name from public.profiles where id = $1", [hugo.id]),
    ).toEqual([{ display_name: "Hugo Hendriks" }]);

    // The new login now sees exactly its own record.
    expect(
      await asUser(inv, hugo.id, (tx) =>
        rows<{ customer_code: string }>(tx, "select customer_code from public.customers"),
      ),
    ).toEqual([{ customer_code: "GR00023" }]);

    // Another account cannot reuse the link.
    const other = await createAuthUser(inv, {
      email: "hugo2@example.com",
      appMeta: { invitation_id: id },
    });
    await expectSqlError(
      asService(inv, (tx) =>
        tx.query("select * from public.redeem_invitation($1, $2)", [token_hash, other.id]),
      ),
      /al gebruikt/,
    );
  });

  it("links an unconfirmed existing sign-up (path b) and resolves the conflict task", async () => {
    const c = await createCustomerAs(inv, ip.staff.id, {
      full_name: "Ina Isselt",
      email: "ina@example.com",
    });
    const { token_hash } = await inviteAs(inv, ip.staff.id, {
      customer_id: c.id,
      email: "ina@example.com",
    });
    const ina = await createAuthUser(inv, { email: "ina@example.com", confirmed: false });
    // Even if GoTrue confirms before writing app_metadata, nothing is auto-linked.
    await confirmAuthUser(inv, ina.id);
    expect(await customerOf(inv, ina.id)).toBeUndefined();
    expect(
      await rows(inv, "select resolved_at from public.staff_tasks where customer_id = $1", [c.id]),
    ).toEqual([{ resolved_at: null }]);

    await asService(
      inv,
      (tx) => tx.query("select * from public.redeem_invitation($1, $2)", [token_hash, ina.id]),
      { commit: true },
    );
    expect((await requireCustomer(inv, ina.id)).id).toBe(c.id);
    const task = await one<{ resolved: boolean; resolved_by: string }>(
      inv,
      "select resolved_at is not null as resolved, resolved_by from public.staff_tasks where customer_id = $1",
      [c.id],
    );
    expect(task).toEqual({ resolved: true, resolved_by: ina.id });
  });

  it("refuses redemption for the wrong e-mail, an expired or a revoked invitation", async () => {
    const c = await createCustomerAs(inv, ip.staff.id, {
      full_name: "Jet Jong",
      email: "jet@example.com",
    });
    const { id, token_hash } = await inviteAs(inv, ip.staff.id, {
      customer_id: c.id,
      email: "jet@example.com",
    });
    const redeem = (userId: string) =>
      asService(inv, (tx) =>
        tx.query("select * from public.redeem_invitation($1, $2)", [token_hash, userId]),
      );

    await expectSqlError(redeem(ip.bob.id), "42501"); // bob@ is not jet@
    await expectSqlError(redeem(crypto.randomUUID()), "P0002");
    await expectSqlError(
      asService(inv, (tx) =>
        tx.query("select * from public.redeem_invitation($1, $2)", [newTokenHash(), ip.bob.id]),
      ),
      "P0002",
    );

    const jet = await createAuthUser(inv, {
      email: "jet@example.com",
      appMeta: { invitation_id: id },
    });
    await inv.query(
      "update public.invitations set expires_at = now() - interval '1 minute' where id = $1",
      [id],
    );
    await expectSqlError(redeem(jet.id), /verlopen/);
    expect(
      await asService(inv, (tx) =>
        one(tx, "select is_expired from public.get_invitation($1)", [token_hash]),
      ),
    ).toEqual({ is_expired: true });

    await inv.query(
      "update public.invitations set expires_at = now() + interval '1 day', revoked_at = now() where id = $1",
      [id],
    );
    await expectSqlError(redeem(jet.id), /ingetrokken/);
    expect(await customerOf(inv, jet.id)).toBeUndefined();
  });

  it("redeems a staff invitation by granting the role", async () => {
    const { id, token_hash } = await inviteAs(inv, ip.admin.id, {
      kind: "staff",
      staff_role: "staff",
      email: "kim@example.com",
    });
    const kim = await createAuthUser(inv, {
      email: "kim@example.com",
      appMeta: { invitation_id: id },
    });
    const r = await asService(
      inv,
      (tx) => one(tx, "select * from public.redeem_invitation($1, $2)", [token_hash, kim.id]),
      { commit: true },
    );
    expect(r).toEqual({ invitation_id: id, kind: "staff", customer_id: null, staff_role: "staff" });
    expect(await customerOf(inv, kim.id)).toBeUndefined();
    expect(
      await asUser(inv, kim.id, (tx) =>
        one(tx, "select public.is_staff() as s, public.is_admin() as a"),
      ),
    ).toEqual({ s: true, a: false });
    expect(
      await one(inv, "select created_by from public.user_roles where user_id = $1", [kim.id]),
    ).toEqual({ created_by: ip.admin.id });
  });

  // The link was e-mailed to the address on file at the time. If that address
  // was a typo (a stranger's mailbox), correcting it must kill the link.
  it("an open invitation stops working once an admin corrects the customer's e-mail", async () => {
    const c = await createCustomerAs(inv, ip.staff.id, {
      full_name: "John Doe",
      email: "jon@example.com",
    });
    const { id, token_hash } = await inviteAs(inv, ip.staff.id, {
      customer_id: c.id,
      email: "jon@example.com",
    });
    await asUser(
      inv,
      ip.admin.id,
      (tx) =>
        tx.query("update public.customers set email = 'john@example.com' where id = $1", [c.id]),
      { commit: true },
    );
    expect(
      await one(
        inv,
        `select i.revoked_at is not null as revoked, c.status
           from public.invitations i join public.customers c on c.id = i.customer_id where i.id = $1`,
        [id],
      ),
    ).toEqual({ revoked: true, status: "active" });

    // The stranger at the old address opens the link (path a: createUser).
    const stranger = await createAuthUser(inv, {
      email: "jon@example.com",
      appMeta: { invitation_id: id },
    });
    const redeem = () =>
      asService(inv, (tx) =>
        tx.query("select * from public.redeem_invitation($1, $2)", [token_hash, stranger.id]),
      );
    await expectSqlError(redeem(), /ingetrokken/);
    // Second fence: even if the SQL editor reopened it, the address no longer matches.
    await inv.query("update public.invitations set revoked_at = null where id = $1", [id]);
    const err = await expectSqlError(redeem(), "55000");
    expect(err.message).toMatch(/e-mailadres van dit klantdossier is gewijzigd/);
    expect(await rows(inv, "select user_id from public.customers where id = $1", [c.id])).toEqual([
      { user_id: null },
    ]);
    await inv.query("update public.invitations set revoked_at = now() where id = $1", [id]);

    // A new invitation to the corrected address works.
    const fresh = await inviteAs(inv, ip.staff.id, {
      customer_id: c.id,
      email: "john@example.com",
    });
    const john = await createAuthUser(inv, {
      email: "john@example.com",
      appMeta: { invitation_id: fresh.id },
    });
    await asService(
      inv,
      (tx) =>
        tx.query("select * from public.redeem_invitation($1, $2)", [fresh.token_hash, john.id]),
      { commit: true },
    );
    expect((await requireCustomer(inv, john.id)).id).toBe(c.id);
  });

  // An admin being removed must not be able to leave a way back in behind.
  it("invitations stop working once their inviter loses the role that allowed them", async () => {
    const rogue = await createAuthUser(inv, { email: "rogue@example.com", confirmed: false });
    await inv.query(
      "insert into public.user_roles (user_id, role) values ($1, 'admin'), ($1, 'staff')",
      [rogue.id],
    );
    const customer = await createCustomerAs(inv, ip.staff.id, {
      full_name: "Roos Rogue",
      email: "roos@example.com",
    });
    const adminInv = await inviteAs(inv, rogue.id, {
      kind: "staff",
      staff_role: "admin",
      email: "rogue-alt@example.com",
    });
    const customerInv = await inviteAs(inv, rogue.id, {
      customer_id: customer.id,
      email: "roos@example.com",
    });
    const open = async () =>
      (
        await rows<{ id: string }>(
          inv,
          "select id from public.invitations where created_by = $1 and revoked_at is null order by kind",
          [rogue.id],
        )
      ).map((r) => r.id);
    const setRole = (role: string, grant: boolean) =>
      asUser(
        inv,
        ip.admin.id,
        (tx) => tx.query("select public.set_user_role($1, $2, $3)", [rogue.id, role, grant]),
        { commit: true },
      );

    // Still staff: the customer invitation stays, the admin invitation goes.
    await setRole("admin", false);
    expect(await open()).toEqual([customerInv.id]);
    // No role left: everything goes, and the customer is no longer 'invited'.
    await setRole("staff", false);
    expect(await open()).toEqual([]);
    expect(
      (await one<Customer>(inv, "select * from public.customers where id = $1", [customer.id]))
        .status,
    ).toBe("active");

    const alt = await createAuthUser(inv, {
      email: "rogue-alt@example.com",
      appMeta: { invitation_id: adminInv.id },
    });
    const redeem = () =>
      asService(inv, (tx) =>
        tx.query("select * from public.redeem_invitation($1, $2)", [adminInv.token_hash, alt.id]),
      );
    await expectSqlError(redeem(), /ingetrokken/);
    // Second fence: reopened by hand, it still needs an inviter who is admin now.
    await inv.query("update public.invitations set revoked_at = null where id = $1", [adminInv.id]);
    const err = await expectSqlError(redeem(), "55000");
    expect(err.message).toMatch(/niet meer geldig/);
    expect(
      await asUser(inv, alt.id, (tx) =>
        one(tx, "select public.is_admin() as a, public.is_staff() as s"),
      ),
    ).toEqual({ a: false, s: false });
    await inv.query("update public.invitations set revoked_at = now() where id = $1", [
      adminInv.id,
    ]);

    // Deleting the inviter's Auth user (roles cascade) revokes their invitations too.
    const temp = await createAuthUser(inv, { email: "temp.admin@example.com", confirmed: false });
    await inv.query("insert into public.user_roles (user_id, role) values ($1, 'admin')", [
      temp.id,
    ]);
    const pending = await inviteAs(inv, temp.id, {
      kind: "staff",
      staff_role: "staff",
      email: "pending.staff@example.com",
    });
    await asGoTrue(inv, (tx) => tx.query("delete from auth.users where id = $1", [temp.id]));
    expect(
      await one(
        inv,
        "select revoked_at is not null as revoked from public.invitations where id = $1",
        [pending.id],
      ),
    ).toEqual({ revoked: true });
  });

  // GoTrue's updateUserById confirms the e-mail before it writes
  // app_metadata.invitation_id (path b), so the sign-up trigger runs without
  // knowing about the invitation.
  it("redeeming a staff invitation over an unconfirmed sign-up (path b) leaves no open task", async () => {
    const { id, token_hash } = await inviteAs(inv, ip.admin.id, {
      kind: "staff",
      staff_role: "staff",
      email: "kim.b@example.com",
    });
    const kim = await createAuthUser(inv, { email: "kim.b@example.com", confirmed: false });
    // A task about this address from before (e.g. raised by an earlier rule).
    await inv.query(
      "select private.add_staff_task('signup_email_conflict', null, 'Registratie kim.b@example.com', null, 'kim.b@example.com')",
    );
    await asGoTrue(inv, async (tx) => {
      await tx.query("update auth.users set email_confirmed_at = now() where id = $1", [kim.id]);
      await tx.query(
        `update auth.users set raw_app_meta_data = raw_app_meta_data
           || jsonb_build_object('invitation_id', $2::text) where id = $1`,
        [kim.id, id],
      );
    });
    expect(await customerOf(inv, kim.id)).toBeUndefined();
    await asService(
      inv,
      (tx) => tx.query("select * from public.redeem_invitation($1, $2)", [token_hash, kim.id]),
      { commit: true },
    );
    expect(await asUser(inv, kim.id, (tx) => one(tx, "select public.is_staff() as s"))).toEqual({
      s: true,
    });
    expect(
      await rows(
        inv,
        "select kind, resolved_by from public.staff_tasks where email = 'kim.b@example.com' or body like '%kim.b@example.com%'",
      ),
    ).toEqual([
      // The earlier task, and since the P5 migration the one the confirmation
      // raised for the open staff invitation: both resolved by the redemption.
      { kind: "signup_email_conflict", resolved_by: kim.id },
      { kind: "signup_email_conflict", resolved_by: kim.id },
    ]);
  });

  it("admin_auth_user_by_email finds Auth users for the server", async () => {
    const pending = await createAuthUser(inv, { email: "pending@example.com", confirmed: false });
    await asService(inv, async (tx) => {
      expect(
        await rows(
          tx,
          "select id, email from public.admin_auth_user_by_email(' ALICE@Example.com ')",
        ),
      ).toEqual([{ id: ip.alice.id, email: "alice@example.com" }]);
      const u = await one<{ id: string; email_confirmed_at: Date | null }>(
        tx,
        "select id, email_confirmed_at from public.admin_auth_user_by_email('pending@example.com')",
      );
      expect(u).toEqual({ id: pending.id, email_confirmed_at: null });
      expect(
        await rows(tx, "select * from public.admin_auth_user_by_email('nobody@example.com')"),
      ).toEqual([]);
    });
  });
});

describe("company settings and reference data", () => {
  it("seeds company_settings with the §35.8 values", async () => {
    const s = await one<Record<string, unknown>>(db, "select * from public.company_settings");
    expect(s).toMatchObject({
      id: true,
      company_name: "G&R SOLUTIONS N.V.",
      tagline: "CUSTOMS BROKERAGE & LOGISTICS",
      email: "info@grsolutions.sr",
      phone: "5978897500",
      address: "kwattaweg #22",
      kkf_number: null,
      btw_number: null,
      invoice_title: "INVOICE (inclusief BTW)",
      footer_text: "G&R SOLUTIONS N.V.  |  CUSTOMS BROKERAGE & LOGISTICS",
      payment_terms_text:
        "Deze factuur dient binnen 1 week na factuurdatum volledig te worden betaald. Na het verstrijken van deze betalingstermijn wordt een opslag van 15% op het openstaande bedrag in rekening gebracht.",
      payment_term_days: 7,
      late_fee_percent: "15.00",
      due_soon_days: 2,
      overdue_reminder_interval_days: 7,
      max_overdue_reminders: 3,
      default_currency: "USD",
      vat_rate_percent: null,
      show_vat_breakdown: false,
      invoice_number_prefix: "INV-",
      paper_size: "Letter",
      public_signup_enabled: true,
      pay_before_pickup: true,
      delivery_available: false,
      max_open_orders_per_customer: 50,
      pickup_address: "Kwattaweg #22, Paramaribo",
      pickup_hours: null,
      pickup_instructions: "Neem een geldig legitimatiebewijs en uw klantcode mee",
      terms_version: "1",
    });
    expect(String(s["terms_markdown"])).toMatch(/^_Placeholder/);
    expect(String(s["prohibited_goods_markdown"])).toMatch(/^_Placeholder/);
  });

  it("anon gets the public fields through public_company_info() and nothing else", async () => {
    await expectSqlError(
      asAnon(db, (tx) => tx.query("select * from public.company_settings")),
      "42501",
    );
    await expectSqlError(
      asAnon(db, (tx) => tx.query("select company_name from public.company_settings")),
      "42501",
    );
    const info = await asAnon(db, (tx) =>
      one<Record<string, unknown>>(tx, "select * from public.public_company_info()"),
    );
    expect(Object.keys(info).sort()).toEqual(
      [
        "address",
        "company_name",
        "email",
        "phone",
        "pickup_address",
        "pickup_hours",
        "pickup_instructions",
        "prohibited_goods_markdown",
        "public_signup_enabled",
        "tagline",
        "terms_markdown",
        "terms_version",
      ].sort(),
    );
    expect(info).toMatchObject({ company_name: "G&R SOLUTIONS N.V.", public_signup_enabled: true });
    // Logged-in users without a customer record can use it too.
    const pending = await createAuthUser(db, {
      email: "pending.info@example.com",
      confirmed: false,
    });
    expect(
      await asUser(db, pending.id, (tx) =>
        rows(tx, "select company_name from public.public_company_info()"),
      ),
    ).toEqual([{ company_name: "G&R SOLUTIONS N.V." }]);
    expect(
      await asUser(db, pending.id, (tx) => rows(tx, "select * from public.company_settings")),
    ).toEqual([]);
  });

  it("active customers and staff read settings; only admins change them, audited", async () => {
    for (const user of [p.alice, p.staff]) {
      expect(
        await asUser(db, user.id, (tx) => rows(tx, "select id from public.company_settings")),
      ).toEqual([{ id: true }]);
    }
    for (const user of [p.alice, p.staff]) {
      const r = await asUser(db, user.id, (tx) =>
        tx.query("update public.company_settings set pickup_hours = 'ma-vr 9-17'"),
      );
      expect(r.affectedRows).toBe(0);
    }
    await asUser(db, p.admin.id, async (tx) => {
      const r = await one<{ pickup_hours: string; updated_by: string }>(
        tx,
        "update public.company_settings set pickup_hours = 'ma-vr 9:00-17:00', late_fee_percent = 12.5 returning pickup_hours, updated_by",
      );
      expect(r).toEqual({ pickup_hours: "ma-vr 9:00-17:00", updated_by: p.admin.id });
      const audit = await one<{ actor_id: string; record_id: string; changed_columns: string[] }>(
        tx,
        "select actor_id, record_id, changed_columns from public.audit_log where table_name = 'company_settings'",
      );
      expect(audit).toEqual({
        actor_id: p.admin.id,
        record_id: "true",
        changed_columns: ["late_fee_percent", "pickup_hours"],
      });
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("update public.company_settings set late_fee_percent = 101"),
        ),
        "23514",
      );
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query(
            "insert into public.company_settings (id, company_name, invoice_title) values (false, 'x', 'y')",
          ),
        ),
        "42501",
      );
      await expectSqlError(
        withSavepoint(tx, () => tx.query("delete from public.company_settings")),
        "42501",
      );
    });
  });

  it("seeds three empty bank accounts; customers see only active ones; admins manage them", async () => {
    const seeded = await rows(
      db,
      "select currency, sort_order, bank_name, account_holder, account_number, is_active from public.company_bank_accounts order by sort_order",
    );
    expect(seeded).toEqual(
      ["USD", "EUR", "SRD"].map((currency, i) => ({
        currency,
        sort_order: i + 1,
        bank_name: null,
        account_holder: null,
        account_number: null,
        is_active: true,
      })),
    );

    await expectSqlError(
      asUser(db, p.staff.id, (tx) =>
        tx.query("insert into public.company_bank_accounts (currency) values ('USD')"),
      ),
      "42501",
    );
    await expectSqlError(
      asAnon(db, (tx) => tx.query("select * from public.company_bank_accounts")),
      "42501",
    );
    await asUser(
      db,
      p.admin.id,
      async (tx) => {
        await tx.query(
          "update public.company_bank_accounts set bank_name = 'DSB', account_number = '123' where currency = 'SRD'",
        );
        await tx.query(
          "update public.company_bank_accounts set is_active = false where currency = 'EUR'",
        );
        await expectSqlError(
          withSavepoint(tx, () =>
            tx.query("insert into public.company_bank_accounts (currency) values ('USD')"),
          ),
          "23505",
        );
        await expectSqlError(
          withSavepoint(tx, () => tx.query("delete from public.company_bank_accounts")),
          "42501",
        );
      },
      { commit: true },
    );
    try {
      const forAlice = await asUser(db, p.alice.id, (tx) =>
        rows<{ currency: string }>(
          tx,
          "select currency from public.company_bank_accounts order by sort_order",
        ),
      );
      expect(forAlice.map((r) => r.currency)).toEqual(["USD", "SRD"]);
      const forStaff = await asUser(db, p.staff.id, (tx) =>
        rows(tx, "select currency from public.company_bank_accounts"),
      );
      expect(forStaff).toHaveLength(3);
    } finally {
      await db.query(
        "update public.company_bank_accounts set is_active = true, bank_name = null, account_number = null",
      );
    }
  });

  it("has no warehouse address seeded; admins add one and active customers see it", async () => {
    expect(await rows(db, "select * from public.warehouse_addresses")).toEqual([]);
    await expectSqlError(
      asUser(db, p.staff.id, (tx) =>
        tx.query(
          "insert into public.warehouse_addresses (label, service_type, address_line1, city, state, zip) values ('x', 'air', 'x', 'x', 'x', 'x')",
        ),
      ),
      "42501",
    );
    await asUser(
      db,
      p.admin.id,
      async (tx) => {
        const a = await one<Record<string, unknown>>(
          tx,
          `insert into public.warehouse_addresses (label, service_type, address_line1, city, state, zip)
         values ('Luchtvracht', 'air', '1 Test Street', 'Testville', 'FL', '00000') returning *`,
        );
        expect(a).toMatchObject({
          recipient_name_template: "{FULL_NAME} {GR_CODE}",
          address_line2_template: "{GR_CODE}",
          is_active: true,
          created_by: p.admin.id,
        });
        await tx.query(
          `insert into public.warehouse_addresses (label, service_type, address_line1, city, state, zip, is_active)
         values ('Oud', 'sea', '2 Old Road', 'Testville', 'FL', '00000', false)`,
        );
      },
      { commit: true },
    );
    try {
      expect(
        await asUser(db, p.alice.id, (tx) =>
          rows(tx, "select label from public.warehouse_addresses"),
        ),
      ).toEqual([{ label: "Luchtvracht" }]);
      expect(
        await asUser(db, p.staff.id, (tx) =>
          rows(tx, "select label from public.warehouse_addresses"),
        ),
      ).toHaveLength(2);
      expect(
        await asUser(db, p.carol.id, (tx) =>
          rows(tx, "select label from public.warehouse_addresses"),
        ),
      ).toEqual([]);
    } finally {
      await db.query("delete from public.warehouse_addresses");
    }
  });

  it("seeds service rates (air on without a rate, sea off); customers see enabled ones", async () => {
    expect(
      await rows(
        db,
        "select service_type, enabled, rate_per_lb, currency, minimum_billable_lbs, weight_rounding from public.service_rates order by service_type",
      ),
    ).toEqual([
      {
        service_type: "air",
        enabled: true,
        rate_per_lb: null,
        currency: "USD",
        minimum_billable_lbs: null,
        weight_rounding: "none",
      },
      {
        service_type: "sea",
        enabled: false,
        rate_per_lb: null,
        currency: "USD",
        minimum_billable_lbs: null,
        weight_rounding: "none",
      },
    ]);
    expect(
      await asUser(db, p.alice.id, (tx) =>
        rows(tx, "select service_type from public.service_rates"),
      ),
    ).toEqual([{ service_type: "air" }]);
    expect(
      await asUser(db, p.staff.id, (tx) =>
        rows(tx, "select service_type from public.service_rates"),
      ),
    ).toHaveLength(2);
    const staffUpd = await asUser(db, p.staff.id, (tx) =>
      tx.query("update public.service_rates set rate_per_lb = 1"),
    );
    expect(staffUpd.affectedRows).toBe(0);
    await asUser(db, p.admin.id, async (tx) => {
      const r = await one(
        tx,
        "update public.service_rates set rate_per_lb = 4.5, minimum_billable_lbs = 1, weight_rounding = '0.5' where service_type = 'air' returning rate_per_lb, minimum_billable_lbs",
      );
      expect(r).toEqual({ rate_per_lb: "4.50", minimum_billable_lbs: "1.00" });
      const audit = await one(
        tx,
        "select record_id, actor_id from public.audit_log where table_name = 'service_rates'",
      );
      expect(audit).toEqual({ record_id: "air", actor_id: p.admin.id });
      await expectSqlError(
        withSavepoint(tx, () => tx.query("update public.service_rates set rate_per_lb = -1")),
        "23514",
      );
    });
  });
});

describe("audit log", () => {
  it("is readable by admins only and writable by nobody", async () => {
    const forAdmin = await asUser(db, p.admin.id, (tx) =>
      rows(tx, "select id from public.audit_log limit 1"),
    );
    expect(forAdmin).toHaveLength(1);
    for (const user of [p.staff, p.alice, p.carol]) {
      expect(
        await asUser(db, user.id, (tx) => rows(tx, "select id from public.audit_log")),
      ).toEqual([]);
    }
    await expectSqlError(
      asAnon(db, (tx) => tx.query("select * from public.audit_log")),
      "42501",
    );
    for (const sql of [
      "insert into public.audit_log (table_name, action) values ('x', 'INSERT')",
      "update public.audit_log set reason = 'x'",
      "delete from public.audit_log",
    ]) {
      await expectSqlError(
        asUser(db, p.admin.id, (tx) => tx.query(sql)),
        "42501",
      );
      await expectSqlError(
        asService(db, (tx) => tx.query(sql)),
        "42501",
      );
    }
  });

  it("falls back to updated_by / created_by when there is no logged-in user", async () => {
    await asService(db, async (tx) => {
      const c = await one<{ id: string }>(
        tx,
        "insert into public.customers (full_name, created_by) values ('Server Made', $1) returning id",
        [p.staff.id],
      );
      const ins = await one(
        tx,
        "select actor_id, action from public.audit_log where table_name = 'customers' and record_id = $1",
        [c.id],
      );
      expect(ins).toEqual({ actor_id: p.staff.id, action: "INSERT" });

      await tx.query("update public.customers set phone = '1', updated_by = $1 where id = $2", [
        p.admin.id,
        c.id,
      ]);
      const upd = await one(
        tx,
        "select actor_id, changed_columns from public.audit_log where table_name = 'customers' and record_id = $1 and action = 'UPDATE'",
        [c.id],
      );
      expect(upd).toEqual({ actor_id: p.admin.id, changed_columns: ["phone"] });
    });
  });

  it("skips no-op updates and records deletes", async () => {
    await asUser(db, p.admin.id, async (tx) => {
      const before = await one<{ n: number }>(
        tx,
        "select count(*)::int as n from public.audit_log",
      );
      await tx.query("update public.service_rates set enabled = enabled");
      expect(await one(tx, "select count(*)::int as n from public.audit_log")).toEqual(before);
    });
    await db.transaction(async (tx) => {
      const acct = await one<{ id: string }>(
        tx,
        "insert into public.company_bank_accounts (currency, is_active) values ('USD', false) returning id",
      );
      await tx.query("delete from public.company_bank_accounts where id = $1", [acct.id]);
      const del = await one<{ action: string; old_data: { currency: string }; new_data: unknown }>(
        tx,
        "select action, old_data, new_data from public.audit_log where record_id = $1 and action = 'DELETE'",
        [acct.id],
      );
      expect(del).toMatchObject({
        action: "DELETE",
        old_data: { currency: "USD" },
        new_data: null,
      });
      await tx.rollback();
    });
  });
});

describe("staff tasks", () => {
  it("staff create, list and resolve tasks; only admins delete; customers see none", async () => {
    await asUser(db, p.staff.id, async (tx) => {
      const t = await one<{ id: string; created_by: string }>(
        tx,
        `insert into public.staff_tasks (kind, customer_id, body, created_by)
         values ('order_cancellation_request', $1, 'Klant vraagt annulering', $2) returning id, created_by`,
        [p.aliceCustomer, p.alice.id],
      );
      expect(t.created_by).toBe(p.staff.id);
      const resolved = await one(
        tx,
        "update public.staff_tasks set resolved_at = now() where id = $1 returning resolved_by",
        [t.id],
      );
      expect(resolved).toEqual({ resolved_by: p.staff.id });
      const reopened = await one(
        tx,
        "update public.staff_tasks set resolved_at = null where id = $1 returning resolved_by",
        [t.id],
      );
      expect(reopened).toEqual({ resolved_by: null });
      const del = await tx.query("delete from public.staff_tasks where id = $1", [t.id]);
      expect(del.affectedRows).toBe(0);
    });

    await asUser(db, p.admin.id, async (tx) => {
      const t = await one<{ id: string }>(
        tx,
        "insert into public.staff_tasks (kind, body) values ('order_cancellation_request', 'x') returning id",
      );
      const del = await tx.query("delete from public.staff_tasks where id = $1", [t.id]);
      expect(del.affectedRows).toBe(1);
    });

    for (const user of [p.alice, p.carol]) {
      await asUser(db, user.id, async (tx) => {
        expect(await rows(tx, "select * from public.staff_tasks")).toEqual([]);
        await expectSqlError(
          withSavepoint(tx, () =>
            tx.query(
              "insert into public.staff_tasks (kind, body) values ('order_cancellation_request', 'x')",
            ),
          ),
          "42501",
        );
      });
    }
    await expectSqlError(
      asAnon(db, (tx) => tx.query("select * from public.staff_tasks")),
      "42501",
    );
  });
});

describe("Auth server compatibility", () => {
  it("runs the auth.users trigger as supabase_auth_admin without extra grants", async () => {
    // asGoTrue is how createAuthUser inserts; a direct update proves the
    // UPDATE OF email_confirmed_at path works under the same role.
    const u = await createAuthUser(db, { email: "gotrue@example.com", confirmed: false });
    await asGoTrue(db, (tx) =>
      tx.query("update auth.users set email_confirmed_at = now() where id = $1", [u.id]),
    );
    expect(await customerOf(db, u.id)).toBeDefined();
  });
});
