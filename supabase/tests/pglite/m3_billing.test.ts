// @vitest-environment node
/**
 * Migration 3 (billing & messaging): invoices, lines, numbering, payments,
 * the overview view, late fees, pay-before-pickup, history counts, e-mail logs
 * and job runs.
 *
 * Fixtures are created as the superuser or through createAuthUser; every
 * access rule is asserted through asUser/asAnon/asService, never through
 * db.query. The shared database is used by the whole file, so each test makes
 * its own orders and invoices and filters by their ids. The end-to-end flow
 * runs on a fresh database so its invoice numbers start at 0001.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  type AuthUser,
  type Db,
  type Transaction,
  asAnon,
  asService,
  asUser,
  createAuthUser,
  createDb,
  expectSqlError,
  execMigrationSql,
  listMigrations,
  withSavepoint,
} from "./harness";

type Q = Pick<Transaction, "query">;

const M3_TABLES = [
  "invoice_number_counters",
  "invoices",
  "invoice_items",
  "payments",
  "email_logs",
  "job_runs",
];
const M3_RELATIONS = [...M3_TABLES, "invoice_overview"];
const TODAY = "(now() at time zone 'America/Paramaribo')::date";
const RATE = 4.5;

async function rows<T>(tx: Q, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await tx.query<T>(sql, params)).rows;
}

async function one<T>(tx: Q, sql: string, params: unknown[] = []): Promise<T> {
  const r = await rows<T>(tx, sql, params);
  expect(r).toHaveLength(1);
  return r[0] as T;
}

interface Invoice {
  id: string;
  invoice_number: string | null;
  customer_id: string;
  currency: string;
  status: string;
  total_lbs: string;
  subtotal_freight: string;
  total_charges: string;
  total_discount: string;
  total_amount: string;
  vat_rate: string | null;
  vat_amount: string | null;
  customer_note: string | null;
  issuer_snapshot: Record<string, unknown> | null;
  bill_to_snapshot: Record<string, unknown> | null;
  issued_at: Date | null;
  issued_by: string | null;
  paid_at: Date | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  replaces_invoice_id: string | null;
  reminder_count: number;
  late_fee_applied_at: Date | null;
  created_by: string | null;
}

interface Line {
  id: string;
  invoice_id: string;
  order_id: string | null;
  line_type: string;
  description: string;
  weight_lbs: string | null;
  rate_per_lb: string | null;
  amount: string;
  vat_exempt: boolean;
  created_by: string | null;
}

interface PaymentResult {
  payment_id: string;
  invoice_status: string;
  amount_paid: string;
  balance_due: string;
}

interface Overview {
  id: string;
  status: string;
  amount_paid: string;
  balance_due: string;
  is_overdue: boolean;
  days_overdue: number;
  total_amount: string;
}

interface People {
  admin: AuthUser;
  staff: AuthUser;
  alice: AuthUser;
  bob: AuthUser;
  carol: AuthUser;
  nobody: AuthUser;
  aliceCustomer: string;
  bobCustomer: string;
  carolCustomer: string;
  daveCustomer: string;
}

async function customerIdOf(db: Db, userId: string): Promise<string> {
  const r = await rows<{ id: string }>(db, "select id from public.customers where user_id = $1", [
    userId,
  ]);
  if (!r[0]) throw new Error(`no customer for ${userId}`);
  return r[0].id;
}

/**
 * Admin (bootstrapped as SPEC §35.4 describes), a staff member, two active
 * customers (alice, bob), a disabled one (carol), a login without a customer
 * record (nobody) and a customer without a login (dave). Air freight gets a
 * rate, the USD bank account gets details.
 */
async function seedPeople(db: Db): Promise<People> {
  const admin = await createAuthUser(db, { email: "admin@example.com" });
  await db.query("insert into public.user_roles (user_id, role) values ($1, 'admin')", [admin.id]);
  await db.query(
    `update public.customers set user_id = null, status = 'disabled', disabled_reason = 'bootstrap admin'
      where user_id = $1`,
    [admin.id],
  );
  const staff = await createAuthUser(db, { email: "staff@example.com", confirmed: false });
  await db.query("insert into public.user_roles (user_id, role) values ($1, 'staff')", [staff.id]);

  const alice = await createAuthUser(db, {
    email: "alice@example.com",
    meta: { full_name: "Alice Jansen", phone: "+597 8000001" },
  });
  const bob = await createAuthUser(db, {
    email: "bob@example.com",
    meta: { full_name: "Bob Bakker", phone: "+597 8000002" },
  });
  const carol = await createAuthUser(db, {
    email: "carol@example.com",
    meta: { full_name: "Carol Kromo", phone: "+597 8000003" },
  });
  await db.query("update public.customers set status = 'disabled' where user_id = $1", [carol.id]);
  const nobody = await createAuthUser(db, { email: "nobody@example.com", confirmed: false });

  const dave = await asUser(
    db,
    staff.id,
    (tx) =>
      one<{ id: string }>(
        tx,
        "select id from public.create_customer(_full_name => 'Dave Doorn', _phone => '+597 8000004')",
      ),
    { commit: true },
  );
  await db.query("update public.service_rates set rate_per_lb = $1 where service_type = 'air'", [
    RATE,
  ]);
  await db.query(
    `update public.company_bank_accounts
        set bank_name = 'Testbank', account_holder = 'G&R SOLUTIONS N.V.', account_number = '1234567'
      where currency = 'USD'`,
  );
  await db.query("update public.customers set address = 'Teststraat 1' where user_id = $1", [
    alice.id,
  ]);

  const people: People = {
    admin,
    staff,
    alice,
    bob,
    carol,
    nobody,
    aliceCustomer: await customerIdOf(db, alice.id),
    bobCustomer: await customerIdOf(db, bob.id),
    carolCustomer: await customerIdOf(db, carol.id),
    daveCustomer: dave.id,
  };
  return people;
}

function insertSql(table: string, values: Record<string, unknown>): string {
  const cols = Object.keys(values);
  return `insert into ${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`;
}

interface DraftInput {
  customerId: string;
  currency?: string;
  invoiceOffset?: number;
  dueOffset?: number;
  invoiceDate?: string;
  dueDate?: string;
  note?: string | null;
  replaces?: string | null;
}

/** A draft as the invoice builder saves it (dates relative to today in Suriname). */
async function insertDraft(tx: Q, d: DraftInput): Promise<Invoice> {
  return one<Invoice>(
    tx,
    `insert into public.invoices (customer_id, currency, invoice_date, due_date, customer_note, replaces_invoice_id)
     values ($1, $2, coalesce($3::date, ${TODAY} + $4::int), coalesce($5::date, ${TODAY} + $6::int), $7, $8)
     returning *`,
    [
      d.customerId,
      d.currency ?? "USD",
      d.invoiceDate ?? null,
      d.invoiceOffset ?? 0,
      d.dueDate ?? null,
      d.dueOffset ?? 7,
      d.note ?? null,
      d.replaces ?? null,
    ],
  );
}

interface LineInput {
  line_type: string;
  description?: string;
  order_id?: string | null;
  weight_lbs?: number | null;
  rate_per_lb?: number | null;
  amount?: number | null;
  vat_exempt?: boolean;
  sort_order?: number;
}

/** Inserts a line; keys left undefined are left out, as a PostgREST insert would. */
async function insertLine(tx: Q, invoiceId: string, l: LineInput): Promise<Line> {
  const values: Record<string, unknown> = {
    invoice_id: invoiceId,
    description: `Regel ${l.line_type}`,
  };
  for (const [k, v] of Object.entries(l)) if (v !== undefined) values[k] = v;
  return one<Line>(tx, insertSql("public.invoice_items", values), Object.values(values));
}

const freight = (orderId: string, weight: number, rate = RATE): LineInput => ({
  line_type: "freight",
  order_id: orderId,
  weight_lbs: weight,
  rate_per_lb: rate,
  description: "Amazon – order 112",
});

async function invoiceRow(tx: Q, id: string): Promise<Invoice> {
  return one<Invoice>(tx, "select * from public.invoices where id = $1", [id]);
}

async function overview(tx: Q, id: string): Promise<Overview> {
  return one<Overview>(
    tx,
    "select id, status, amount_paid, balance_due, is_overdue, days_overdue, total_amount from public.invoice_overview where id = $1",
    [id],
  );
}

async function issue(tx: Q, id: string): Promise<Invoice> {
  return one<Invoice>(tx, "select * from public.issue_invoice($1)", [id]);
}

async function pay(
  tx: Q,
  invoiceId: string,
  amount: number | null = null,
  extra: { paid_on?: string; received_amount?: number; received_currency?: string } = {},
): Promise<PaymentResult> {
  return one<PaymentResult>(
    tx,
    `select * from public.record_payment(_invoice_id => $1, _amount => $2, _paid_on => $3::date,
       _method => 'cash', _reference => 'kas', _received_amount => $4, _received_currency => $5::public.currency_code)`,
    [
      invoiceId,
      amount,
      extra.paid_on ?? null,
      extra.received_amount ?? null,
      extra.received_currency ?? null,
    ],
  );
}

/** Creates an order as staff and receives it with the given weight. */
async function receivedOrder(tx: Q, customerId: string, weight: number): Promise<string> {
  const o = await one<{ id: string }>(
    tx,
    "insert into public.orders (customer_id, description, store_vendor, tracking_number) values ($1, 'Pakket', 'Amazon', $2) returning id",
    [customerId, `1Z${randomUUID().slice(0, 8)}`],
  );
  await tx.query("select * from public.receive_order($1, $2)", [o.id, weight]);
  return o.id;
}

let db: Db;
let p: People;
let today: string;
let year: number;

beforeAll(async () => {
  db = await createDb();
  p = await seedPeople(db);
  const t = await one<{ d: string; y: number }>(
    db,
    `select ${TODAY}::text as d, extract(year from ${TODAY})::int as y`,
  );
  today = t.d;
  year = t.y;
});

afterAll(async () => {
  await db?.close();
});

/**
 * Fixture: moves an issued invoice's dates as the passing of time would.
 * issue_invoice refuses stale dates and issued invoices are immutable, so
 * this skips the triggers for one superuser statement (CHECKs still apply).
 */
async function setInvoiceDates(
  target: Db,
  id: string,
  dates: { invoiceDate: string; dueDate: string } | { invoiceOffset: number; dueOffset: number },
): Promise<void> {
  const [inv, due] =
    "invoiceDate" in dates
      ? [`'${dates.invoiceDate}'::date`, `'${dates.dueDate}'::date`]
      : [`${TODAY} + ${dates.invoiceOffset}`, `${TODAY} + ${dates.dueOffset}`];
  await target.transaction(async (tx) => {
    await tx.exec("set local session_replication_role = replica");
    const r = await tx.query(
      `update public.invoices set invoice_date = ${inv}, due_date = ${due} where id = $1 and status <> 'draft'`,
      [id],
    );
    if (r.affectedRows !== 1) throw new Error(`setInvoiceDates: no issued invoice ${id}`);
  });
}

/**
 * Staff: an order for the customer, a draft with its freight (plus extra
 * lines), issued today. With offsets, the invoice is then aged to those dates.
 */
async function issuedInvoice(
  customerId: string,
  opts: { weight?: number; extra?: LineInput[]; invoiceOffset?: number; dueOffset?: number } = {},
): Promise<{ invoice: Invoice; orderId: string }> {
  const result = await asUser(
    db,
    p.staff.id,
    async (tx) => {
      const orderId = await receivedOrder(tx, customerId, opts.weight ?? 2);
      const draft = await insertDraft(tx, { customerId });
      await insertLine(tx, draft.id, freight(orderId, opts.weight ?? 2));
      for (const l of opts.extra ?? []) await insertLine(tx, draft.id, l);
      return { invoice: await issue(tx, draft.id), orderId };
    },
    { commit: true },
  );
  if (opts.invoiceOffset !== undefined || opts.dueOffset !== undefined) {
    const invoiceOffset = opts.invoiceOffset ?? 0;
    await setInvoiceDates(db, result.invoice.id, {
      invoiceOffset,
      dueOffset: opts.dueOffset ?? invoiceOffset + 7,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------

describe("schema", () => {
  it("is idempotent: re-running changes no object, grant or function", async () => {
    // Later migrations replace some of this file's functions (e.g. P4's
    // pickup_override), so replay it the way `supabase db push` would after a
    // reset of its version: this file, then every later one again.
    const all = listMigrations();
    const index = all.findIndex((m) => m.name === "billing");
    if (index < 0) throw new Error("billing migration not found");
    const replay = all.slice(index);
    const fingerprint = `
      select (select count(*) from pg_policies where schemaname in ('public', 'storage'))::int as policies,
             (select count(*) from pg_trigger where not tgisinternal)::int as triggers,
             (select count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace
               where n.nspname in ('public', 'private'))::int as constraints,
             (select count(*) from pg_indexes where schemaname in ('public', 'private'))::int as indexes,
             (select string_agg(c.relname || '=' || coalesce(c.relacl::text, '') || coalesce(c.reloptions::text, ''),
                                ';' order by c.relname)
                from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public') as table_acl,
             (select string_agg(a.attrelid::regclass::text || '.' || a.attname || '=' || a.attacl::text, ';'
                                order by a.attrelid::regclass::text, a.attnum)
                from pg_attribute a join pg_class c on c.oid = a.attrelid
                join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and a.attacl is not null) as column_acl,
             (select string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '') || md5(p.prosrc),
                                ';' order by p.oid::regprocedure::text)
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname in ('public', 'private')) as functions,
             (select count(*) from public.invoice_number_counters)::int as counters`;
    await db.transaction(async (tx) => {
      const before = await one(tx, fingerprint);
      // execMigrationSql: later files enable pg_cron / pg_net (P8), which
      // PGlite only knows through the harness's stubs.
      for (const m of replay) await execMigrationSql(tx, m.sql);
      expect(await one(tx, fingerprint)).toEqual(before);
      await tx.rollback();
    });
  });

  it("defines the billing enums", async () => {
    const enums = await rows<{ typname: string; labels: string[] }>(
      db,
      `select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as labels
         from pg_type t join pg_enum e on e.enumtypid = t.oid
         join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' group by t.typname order by 1`,
    );
    expect(Object.fromEntries(enums.map((e) => [e.typname, e.labels]))).toMatchObject({
      invoice_status: ["draft", "open", "partially_paid", "paid", "cancelled"],
      invoice_line_type: [
        "freight",
        "customs",
        "handling",
        "goods",
        "service_fee",
        "other",
        "discount",
        "late_fee",
      ],
      payment_method: ["bank_transfer", "cash", "pin", "mobile", "other"],
      email_status: ["queued", "sent", "failed", "skipped_no_provider"],
      job_trigger: ["cron", "manual"],
      job_run_status: ["running", "succeeded", "failed"],
    });
  });

  it("grants clients only the invoice columns of a draft and the line columns", async () => {
    const cols = await rows<{
      rel: string;
      col: string;
      ins: boolean;
      upd: boolean;
      svc_upd: boolean;
    }>(
      db,
      `select c.relname as rel, a.attname as col,
              has_column_privilege('authenticated', c.oid, a.attname, 'INSERT') as ins,
              has_column_privilege('authenticated', c.oid, a.attname, 'UPDATE') as upd,
              has_column_privilege('service_role', c.oid, a.attname, 'UPDATE') as svc_upd
         from pg_attribute a join pg_class c on c.oid = a.attrelid
        where c.relname = any($1) and c.relnamespace = 'public'::regnamespace
          and a.attnum > 0 and not a.attisdropped`,
      [M3_TABLES],
    );
    const pick = (rel: string, k: "ins" | "upd" | "svc_upd") =>
      cols
        .filter((c) => c.rel === rel && c[k])
        .map((c) => c.col)
        .sort();
    const draftColumns = [
      "currency",
      "customer_id",
      "customer_note",
      "due_date",
      "invoice_date",
      "replaces_invoice_id",
    ];
    expect(pick("invoices", "ins")).toEqual(draftColumns);
    expect(pick("invoices", "upd")).toEqual(draftColumns);
    expect(pick("invoices", "svc_upd")).toEqual([
      "first_reminder_sent_at",
      "last_reminder_sent_at",
      "reminder_count",
    ]);
    const lineColumns = [
      "amount",
      "description",
      "line_type",
      "order_id",
      "rate_per_lb",
      "sort_order",
      "vat_exempt",
      "weight_lbs",
    ];
    expect(pick("invoice_items", "ins")).toEqual([...lineColumns, "invoice_id"].sort());
    expect(pick("invoice_items", "upd")).toEqual(lineColumns);
    for (const rel of ["invoice_number_counters", "payments", "email_logs", "job_runs"]) {
      expect(pick(rel, "ins"), rel).toEqual([]);
      expect(pick(rel, "upd"), rel).toEqual([]);
    }
    expect(pick("email_logs", "svc_upd")).not.toEqual([]);
    const privileges = await one<Record<string, boolean>>(
      db,
      `select has_table_privilege('authenticated', 'public.invoices', 'delete') as inv_delete,
              has_table_privilege('authenticated', 'public.invoice_items', 'delete') as line_delete,
              has_table_privilege('authenticated', 'public.payments', 'delete') as pay_delete,
              has_table_privilege('authenticated', 'public.invoice_overview', 'select') as view_select,
              has_table_privilege('authenticated', 'public.invoice_overview', 'insert, update, delete') as view_write,
              has_table_privilege('service_role', 'public.invoice_overview', 'select') as svc_view,
              has_table_privilege('service_role', 'public.invoice_number_counters', 'select') as svc_counters,
              has_table_privilege('service_role', 'public.payments', 'insert, update, delete') as svc_pay_write`,
    );
    expect(privileges).toEqual({
      inv_delete: true,
      line_delete: true,
      pay_delete: false,
      view_select: true,
      view_write: false,
      svc_view: true,
      svc_counters: false,
      svc_pay_write: false,
    });
  });

  it("the overview runs with the caller's rights", async () => {
    const v = await one<{ opts: string[] }>(
      db,
      "select reloptions as opts from pg_class where oid = 'public.invoice_overview'::regclass",
    );
    expect(v.opts).toContain("security_invoker=true");
  });
});

// ---------------------------------------------------------------------------

describe("end-to-end billing flow (fresh database)", () => {
  it("order → receive → draft → issue (gapless numbers) → customer view → payments → void → late fee → immutability", async () => {
    const fdb = await createDb();
    try {
      const f = await seedPeople(fdb);
      const t = await one<{ d: string; y: number }>(
        fdb,
        `select ${TODAY}::text as d, extract(year from ${TODAY})::int as y`,
      );
      const staff = <T>(fn: (tx: Transaction) => Promise<T>, commit = true) =>
        asUser(fdb, f.staff.id, fn, { commit });
      const admin = <T>(fn: (tx: Transaction) => Promise<T>, commit = true) =>
        asUser(fdb, f.admin.id, fn, { commit });
      const alice = <T>(fn: (tx: Transaction) => Promise<T>) => asUser(fdb, f.alice.id, fn);

      // 1. Alice registers two orders in the portal.
      const [o1, o2, o3] = await asUser(
        fdb,
        f.alice.id,
        async (tx) => {
          const ins = (desc: string) =>
            one<{ id: string; reference: string }>(
              tx,
              "insert into public.orders (customer_id, description, store_vendor, vendor_order_number, tracking_number) values ($1, $2, 'Amazon', '112-7', $3) returning id, reference",
              [f.aliceCustomer, desc, `1Z ${desc}`],
            );
          return [await ins("Schoenen"), await ins("Jas"), await ins("Laptop")];
        },
        { commit: true },
      );
      if (!o1 || !o2 || !o3) throw new Error("orders missing");

      // 2. Staff receive them in the US warehouse.
      await staff(async (tx) => {
        await tx.query("select * from public.receive_order($1, 3.5)", [o1.id]);
        await tx.query("select * from public.receive_order($1, 2.25)", [o2.id]);
        await tx.query("select * from public.receive_order($1, 1)", [o3.id]);
      });

      // 3. Staff draft invoice A: freight (measured weight × rate) + customs.
      const a = await staff(async (tx) => {
        const d = await insertDraft(tx, { customerId: f.aliceCustomer, note: "Bedankt!" });
        await insertLine(tx, d.id, { ...freight(o1.id, 3.5), amount: 999 }); // amount is recomputed
        await insertLine(tx, d.id, {
          line_type: "customs",
          description: "Inklaring",
          order_id: o1.id,
          amount: 12,
        });
        return invoiceRow(tx, d.id);
      });
      expect(a).toMatchObject({
        status: "draft",
        invoice_number: null,
        total_lbs: "3.50",
        subtotal_freight: "15.75",
        total_charges: "27.75",
        total_discount: "0.00",
        total_amount: "27.75",
      });
      const aLines = await staff(
        (tx) =>
          rows<Line>(
            tx,
            "select * from public.invoice_items where invoice_id = $1 order by line_type",
            [a.id],
          ),
        false,
      );
      expect(aLines.map((l) => [l.line_type, l.amount, l.vat_exempt])).toEqual([
        ["freight", "15.75", false],
        ["customs", "12.00", true], // SPEC default: customs is VAT-exempt
      ]);
      await alice(async (tx) => {
        expect(await rows(tx, "select id from public.invoices")).toEqual([]);
        expect(await rows(tx, "select id from public.invoice_items")).toEqual([]);
        expect(await rows(tx, "select id from public.invoice_overview")).toEqual([]);
      });

      // 4. Gapless: a rolled-back issue and a refused issue use no number.
      await staff(async (tx) => {
        expect((await issue(tx, a.id)).invoice_number).toBe(`INV-${t.y}-0001`);
      }, false);
      const empty = await staff((tx) => insertDraft(tx, { customerId: f.aliceCustomer }));
      await expectSqlError(
        staff((tx) => issue(tx, empty.id)),
        "22023",
      );

      // 5. Issue A, then B: INV-YYYY-0001 and INV-YYYY-0002.
      const issuedA = await staff((tx) => issue(tx, a.id));
      expect(issuedA).toMatchObject({
        status: "open",
        invoice_number: `INV-${t.y}-0001`,
        issued_by: f.staff.id,
      });
      expect(issuedA.issued_at).not.toBeNull();
      const b = await staff(async (tx) => {
        const d = await insertDraft(tx, { customerId: f.aliceCustomer });
        await insertLine(tx, d.id, freight(o2.id, 2.25));
        await insertLine(tx, d.id, { line_type: "handling", amount: 5 });
        await insertLine(tx, d.id, { line_type: "discount", description: "Korting", amount: -2 });
        return issue(tx, d.id);
      });
      expect(b).toMatchObject({
        invoice_number: `INV-${t.y}-0002`,
        total_lbs: "2.25",
        subtotal_freight: "10.13", // 2.25 × 4.50 = 10.125, half-up
        total_charges: "15.13",
        total_discount: "2.00",
        total_amount: "13.13",
      });
      expect(
        await one(fdb, "select last_number from public.invoice_number_counters where year = $1", [
          t.y,
        ]),
      ).toEqual({ last_number: 2 });

      // 6. Alice sees both issued invoices with their lines, never the drafts.
      const draftC = await staff((tx) => insertDraft(tx, { customerId: f.aliceCustomer }));
      await alice(async (tx) => {
        const seen = await rows<{ invoice_number: string; status: string }>(
          tx,
          "select invoice_number, status from public.invoices order by invoice_number",
        );
        expect(seen).toEqual([
          { invoice_number: `INV-${t.y}-0001`, status: "open" },
          { invoice_number: `INV-${t.y}-0002`, status: "open" },
        ]);
        const lineCount = await one<{ n: number }>(
          tx,
          "select count(*)::int as n from public.invoice_items",
        );
        expect(lineCount.n).toBe(5);
        expect(
          await rows(tx, "select id from public.invoices where id = any($1)", [
            [empty.id, draftC.id],
          ]),
        ).toEqual([]);
        expect(await overview(tx, a.id)).toMatchObject({
          amount_paid: "0.00",
          balance_due: "27.75",
          is_overdue: false,
        });
      });
      await asUser(fdb, f.bob.id, async (tx) => {
        expect(await rows(tx, "select id from public.invoices")).toEqual([]);
        expect(await rows(tx, "select id from public.invoice_overview")).toEqual([]);
      });

      // 7. Partial, then full payment: open → partially_paid → paid.
      const partial = await staff((tx) => pay(tx, a.id, 10));
      expect(partial).toMatchObject({
        invoice_status: "partially_paid",
        amount_paid: "10.00",
        balance_due: "17.75",
      });
      const full = await staff((tx) => pay(tx, a.id)); // "Markeer als betaald": the balance
      expect(full).toMatchObject({
        invoice_status: "paid",
        amount_paid: "27.75",
        balance_due: "0.00",
      });
      expect((await staff((tx) => invoiceRow(tx, a.id), false)).paid_at).not.toBeNull();
      await alice(async (tx) => {
        expect(await rows(tx, "select amount from public.payments order by amount", [])).toEqual([
          { amount: "10.00" },
          { amount: "17.75" },
        ]);
        expect((await overview(tx, a.id)).status).toBe("paid");
      });

      // 8. Admin voids the second payment: back to partially_paid.
      const voided = await admin((tx) =>
        one<PaymentResult>(
          tx,
          "select * from public.void_payment($1, 'Bon was dubbel ingevoerd')",
          [full.payment_id],
        ),
      );
      expect(voided).toMatchObject({
        invoice_status: "partially_paid",
        amount_paid: "10.00",
        balance_due: "17.75",
      });
      expect((await staff((tx) => invoiceRow(tx, a.id), false)).paid_at).toBeNull();
      await alice(async (tx) => {
        // Voided payments (and their internal reason) are not shown to the customer.
        expect(await rows(tx, "select amount from public.payments")).toEqual([{ amount: "10.00" }]);
      });

      // 9. Late fee only when overdue: A is not due yet, D (issued 10 days ago) is.
      await expectSqlError(
        admin((tx) => tx.query("select public.apply_late_fee($1)", [a.id])),
        "55000",
      );
      const d = await staff(async (tx) => {
        const dr = await insertDraft(tx, { customerId: f.aliceCustomer });
        await insertLine(tx, dr.id, freight(o3.id, 1));
        await insertLine(tx, dr.id, { line_type: "service_fee", amount: 95.5 });
        return issue(tx, dr.id);
      });
      expect(d.invoice_number).toBe(`INV-${t.y}-0003`);
      await setInvoiceDates(fdb, d.id, { invoiceOffset: -10, dueOffset: -3 });
      await staff((tx) => pay(tx, d.id, 20));
      await alice(async (tx) => {
        expect(await overview(tx, d.id)).toMatchObject({
          status: "partially_paid",
          balance_due: "80.00",
          is_overdue: true,
          days_overdue: 3,
        });
      });
      const late = await admin((tx) =>
        one<Invoice>(tx, "select * from public.apply_late_fee($1)", [d.id]),
      );
      expect(late).toMatchObject({ total_amount: "112.00", total_charges: "112.00" }); // 100 + 15% of 80
      expect(late.late_fee_applied_at).not.toBeNull();
      await alice(async (tx) => {
        const feeLine = await one<Line>(
          tx,
          "select * from public.invoice_items where invoice_id = $1 and line_type = 'late_fee'",
          [d.id],
        );
        expect(feeLine).toMatchObject({
          amount: "12.00",
          description: "Opslag te late betaling (15%)",
          order_id: null,
        });
        expect((await overview(tx, d.id)).balance_due).toBe("92.00");
      });
      await expectSqlError(
        admin((tx) => tx.query("select public.apply_late_fee($1)", [d.id])),
        "55000",
      );
      await staff((tx) => pay(tx, d.id));
      expect((await staff((tx) => overview(tx, d.id), false)).status).toBe("paid");

      // 10. An issued invoice cannot be changed by anyone.
      await staff(async (tx) => {
        for (const [sql, params, code] of [
          ["update public.invoices set customer_note = 'x' where id = $1", [a.id], "55000"],
          ["update public.invoices set due_date = due_date + 30 where id = $1", [a.id], "55000"],
          ["update public.invoices set status = 'paid' where id = $1", [a.id], "42501"],
          ["update public.invoices set total_amount = 1 where id = $1", [a.id], "42501"],
          ["delete from public.invoices where id = $1", [a.id], "55000"],
          ["update public.invoice_items set amount = 1 where invoice_id = $1", [a.id], "55000"],
          // No totals change here, so only the line guard itself can refuse it.
          [
            "update public.invoice_items set description = 'x' where invoice_id = $1",
            [a.id],
            "55000",
          ],
          ["update public.invoice_items set sort_order = 9 where invoice_id = $1", [a.id], "55000"],
          ["delete from public.invoice_items where invoice_id = $1", [a.id], "55000"],
          [
            "insert into public.invoice_items (invoice_id, line_type, description, amount, vat_exempt) values ($1, 'other', 'x', 1, false)",
            [a.id],
            "55000",
          ],
          ["update public.payments set amount = 1 where invoice_id = $1", [a.id], "42501"],
        ] as const) {
          await expectSqlError(
            withSavepoint(tx, () => tx.query(sql, [...params])),
            code,
          );
        }
      }, false);
      for (const sql of [
        "update public.invoices set total_amount = 1 where id = $1",
        "update public.invoices set invoice_number = 'X' where id = $1",
        "update public.invoices set bill_to_snapshot = '{}' where id = $1",
        "update public.invoices set status = 'draft', invoice_number = null where id = $1",
        "delete from public.invoices where id = $1",
        "delete from public.invoice_items where invoice_id = $1",
        "update public.payments set amount = 1 where invoice_id = $1",
        "delete from public.payments where invoice_id = $1",
      ]) {
        // Even the SQL editor (superuser) is refused.
        await expectSqlError(fdb.query(sql, [a.id]), "55000");
      }
      const updatedByAlice = await alice((tx) =>
        tx.query("update public.invoices set customer_note = 'x' where id = $1", [a.id]),
      ).catch((e: unknown) => e);
      expect(updatedByAlice).toMatchObject({ affectedRows: 0 });
      expect(
        await one(fdb, "select customer_note from public.invoices where id = $1", [a.id]),
      ).toEqual({
        customer_note: "Bedankt!",
      });
    } finally {
      await fdb.close();
    }
  });
});

// ---------------------------------------------------------------------------

describe("invoice drafts", () => {
  it("staff create drafts; the trigger fills defaults and ignores status, totals and snapshots", async () => {
    const d = await asUser(db, p.staff.id, (tx) =>
      one<Invoice & { invoice_date_text: string; due_date_text: string }>(
        tx,
        `insert into public.invoices (customer_id) values ($1)
         returning *, invoice_date::text as invoice_date_text, due_date::text as due_date_text`,
        [p.daveCustomer],
      ),
    );
    const term = await one<{ due: string }>(
      db,
      `select (${TODAY} + payment_term_days)::text as due from public.company_settings`,
    );
    expect(d).toMatchObject({
      status: "draft",
      invoice_number: null,
      currency: "USD",
      total_amount: "0.00",
      vat_rate: null,
      vat_amount: null,
      created_by: p.staff.id,
      invoice_date_text: today,
      due_date_text: term.due,
    });

    // Clients cannot even name those columns; the SQL editor's values are reset.
    await asUser(db, p.staff.id, async (tx) => {
      for (const col of [
        "status",
        "invoice_number",
        "total_amount",
        "issued_at",
        "bill_to_snapshot",
      ]) {
        await expectSqlError(
          withSavepoint(tx, () =>
            tx.query(`insert into public.invoices (customer_id, ${col}) values ($1, null)`, [
              p.aliceCustomer,
            ]),
          ),
          "42501",
        );
      }
    });
    const forced = await one<Invoice>(
      db,
      `insert into public.invoices (customer_id, status, invoice_number, total_amount, issued_at, bill_to_snapshot)
       values ($1, 'paid', 'INV-1999-0001', 50, now(), '{}') returning *`,
      [p.daveCustomer],
    );
    expect(forced).toMatchObject({
      status: "draft",
      invoice_number: null,
      total_amount: "0.00",
      issued_at: null,
      bill_to_snapshot: null,
    });
    for (const set of [
      "total_amount = 50",
      "status = 'open'",
      "invoice_number = 'X'",
      "vat_rate = 10, vat_amount = 0",
    ]) {
      await expectSqlError(
        db.query(`update public.invoices set ${set} where id = $1`, [forced.id]),
        "42501",
      );
    }
  });

  it("is refused to customers and anon, and for disabled or unknown customers", async () => {
    await expectSqlError(
      asUser(db, p.alice.id, (tx) => insertDraft(tx, { customerId: p.aliceCustomer })),
      "42501",
    );
    await expectSqlError(
      asUser(db, p.nobody.id, (tx) => insertDraft(tx, { customerId: p.aliceCustomer })),
      "42501",
    );
    await expectSqlError(
      asAnon(db, (tx) => insertDraft(tx, { customerId: p.aliceCustomer })),
      "42501",
    );
    await asUser(db, p.staff.id, async (tx) => {
      await expectSqlError(
        withSavepoint(tx, () => insertDraft(tx, { customerId: p.carolCustomer })),
        "55000",
      );
      await expectSqlError(
        withSavepoint(tx, () => insertDraft(tx, { customerId: randomUUID() })),
        "P0002",
      );
      await expectSqlError(
        withSavepoint(tx, () =>
          insertDraft(tx, { customerId: p.aliceCustomer, invoiceOffset: 0, dueOffset: -1 }),
        ),
        "23514",
      );
    });
  });

  it("staff edit and delete drafts; the lines go with them", async () => {
    const { draft, lineIds } = await asUser(
      db,
      p.staff.id,
      async (tx) => {
        const orderId = await receivedOrder(tx, p.aliceCustomer, 2);
        const draft = await insertDraft(tx, { customerId: p.aliceCustomer });
        const l1 = await insertLine(tx, draft.id, freight(orderId, 2));
        const l2 = await insertLine(tx, draft.id, { line_type: "other", amount: 3 });
        return { draft, lineIds: [l1.id, l2.id] };
      },
      { commit: true },
    );
    await asUser(db, p.staff.id, async (tx) => {
      const r = await tx.query(
        "update public.invoices set currency = 'SRD', customer_note = 'Graag via bank', due_date = due_date + 3 where id = $1",
        [draft.id],
      );
      expect(r.affectedRows).toBe(1);
      expect(await invoiceRow(tx, draft.id)).toMatchObject({
        currency: "SRD",
        customer_note: "Graag via bank",
        updated_by: p.staff.id,
      } as Partial<Invoice>);
      // Its order belongs to alice, so the draft cannot move to bob.
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("update public.invoices set customer_id = $2 where id = $1", [
            draft.id,
            p.bobCustomer,
          ]),
        ),
        "22023",
      );
      const del = await tx.query("delete from public.invoices where id = $1", [draft.id]);
      expect(del.affectedRows).toBe(1);
      expect(
        await rows(tx, "select id from public.invoice_items where id = any($1)", [lineIds]),
      ).toEqual([]);
    });
    // Customers cannot touch drafts at all.
    await asUser(db, p.alice.id, async (tx) => {
      expect(
        (await tx.query("update public.invoices set customer_note = 'x' where id = $1", [draft.id]))
          .affectedRows,
      ).toBe(0);
      expect(
        (await tx.query("delete from public.invoices where id = $1", [draft.id])).affectedRows,
      ).toBe(0);
    });
  });

  it("a replacement points at an issued invoice of the same customer", async () => {
    const { invoice } = await issuedInvoice(p.aliceCustomer);
    await asUser(db, p.staff.id, async (tx) => {
      const draft = await insertDraft(tx, { customerId: p.bobCustomer });
      for (const replaces of [invoice.id, draft.id, randomUUID()]) {
        await expectSqlError(
          withSavepoint(tx, () => insertDraft(tx, { customerId: p.bobCustomer, replaces })),
          "22023",
        );
      }
      const ok = await insertDraft(tx, { customerId: p.aliceCustomer, replaces: invoice.id });
      expect(ok.replaces_invoice_id).toBe(invoice.id);
    });
  });
});

// ---------------------------------------------------------------------------

describe("invoice lines", () => {
  it("prices freight as weight × rate (half-up) and recomputes the totals on every change", async () => {
    await asUser(db, p.staff.id, async (tx) => {
      const o1 = await receivedOrder(tx, p.aliceCustomer, 0.5);
      const o2 = await receivedOrder(tx, p.aliceCustomer, 3);
      const d = await insertDraft(tx, { customerId: p.aliceCustomer });
      const f1 = await insertLine(tx, d.id, { ...freight(o1, 0.5, 12.73), amount: 0 });
      expect(f1.amount).toBe("6.37"); // 6.365: half-up, not banker's rounding
      await insertLine(tx, d.id, freight(o2, 3));
      await insertLine(tx, d.id, { line_type: "customs", amount: 20 });
      await insertLine(tx, d.id, { line_type: "goods", amount: 100 });
      const disc = await insertLine(tx, d.id, { line_type: "discount", amount: -10.5 });
      expect(await invoiceRow(tx, d.id)).toMatchObject({
        total_lbs: "3.50",
        subtotal_freight: "19.87",
        total_charges: "139.87",
        total_discount: "10.50",
        total_amount: "129.37",
      });
      await tx.query("update public.invoice_items set amount = -0.37 where id = $1", [disc.id]);
      await tx.query("update public.invoice_items set weight_lbs = 4 where id = $1", [f1.id]);
      expect(await invoiceRow(tx, d.id)).toMatchObject({
        total_lbs: "7.00",
        subtotal_freight: "64.42", // 4 × 12.73 = 50.92, + 13.50
        total_amount: "184.05",
      });
      await tx.query("delete from public.invoice_items where id = $1", [f1.id]);
      expect(await invoiceRow(tx, d.id)).toMatchObject({
        total_lbs: "3.00",
        subtotal_freight: "13.50",
        total_amount: "133.13",
      });
    });
  });

  it("enforces the per-type rules of SPEC §35.9", async () => {
    await asUser(db, p.staff.id, async (tx) => {
      const order = await receivedOrder(tx, p.aliceCustomer, 1);
      const d = await insertDraft(tx, { customerId: p.aliceCustomer });
      const cases: [LineInput, string][] = [
        [{ line_type: "freight", weight_lbs: 1, rate_per_lb: 1 }, "23514"], // no order
        [{ line_type: "freight", order_id: order, rate_per_lb: 1 }, "22023"], // no weight
        [{ ...freight(order, 0) }, "23514"],
        [{ ...freight(order, 1, -1) }, "23514"],
        [{ line_type: "customs", amount: 5, weight_lbs: 1 }, "23514"],
        [{ line_type: "handling", amount: 5, rate_per_lb: 1 }, "23514"],
        [{ line_type: "discount", amount: 5 }, "23514"],
        [{ line_type: "service_fee", amount: -5 }, "23514"],
        [{ line_type: "other", amount: 5, description: " " }, "23514"],
        [{ line_type: "late_fee", amount: 5 }, "42501"], // only apply_late_fee adds it
      ];
      for (const [line, code] of cases) {
        await expectSqlError(
          withSavepoint(tx, () => insertLine(tx, d.id, line)),
          code,
        );
      }
      const handling = await insertLine(tx, d.id, { line_type: "handling", amount: 5 });
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("update public.invoice_items set line_type = 'late_fee' where id = $1", [
            handling.id,
          ]),
        ),
        "42501",
      );
      const other = await insertDraft(tx, { customerId: p.aliceCustomer });
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("update public.invoice_items set invoice_id = $2 where id = $1", [
            handling.id,
            other.id,
          ]),
        ),
        "42501",
      );
    });
  });

  it("defaults vat_exempt to true for customs lines only", async () => {
    await asUser(db, p.staff.id, async (tx) => {
      const d = await insertDraft(tx, { customerId: p.aliceCustomer });
      const customs = await insertLine(tx, d.id, { line_type: "customs", amount: 1 });
      const handling = await insertLine(tx, d.id, { line_type: "handling", amount: 1 });
      const chosen = await insertLine(tx, d.id, {
        line_type: "customs",
        amount: 1,
        vat_exempt: false,
      });
      expect([customs.vat_exempt, handling.vat_exempt, chosen.vat_exempt]).toEqual([
        true,
        false,
        false,
      ]);
    });
  });

  it("an order on a line belongs to the invoice's customer", async () => {
    await asUser(db, p.staff.id, async (tx) => {
      const bobOrder = await receivedOrder(tx, p.bobCustomer, 1);
      const d = await insertDraft(tx, { customerId: p.aliceCustomer });
      await expectSqlError(
        withSavepoint(tx, () => insertLine(tx, d.id, freight(bobOrder, 1))),
        "22023",
      );
      await expectSqlError(
        withSavepoint(tx, () =>
          insertLine(tx, d.id, { line_type: "customs", order_id: bobOrder, amount: 1 }),
        ),
        "22023",
      );
      await expectSqlError(
        withSavepoint(tx, () =>
          insertLine(tx, d.id, { line_type: "customs", order_id: randomUUID(), amount: 1 }),
        ),
        "22023",
      );
    });
  });

  it("bills freight once per order across invoices that are not cancelled", async () => {
    const { invoice, orderId } = await issuedInvoice(p.aliceCustomer);
    await asUser(db, p.staff.id, async (tx) => {
      const d = await insertDraft(tx, { customerId: p.aliceCustomer });
      const err = await expectSqlError(
        withSavepoint(tx, () => insertLine(tx, d.id, freight(orderId, 2))),
        "23505",
      );
      expect(err.message).toContain(invoice.invoice_number ?? "?");
      // A separate customs invoice for the same order is fine (SPEC §35.9).
      await insertLine(tx, d.id, { line_type: "customs", order_id: orderId, amount: 40 });
      // Turning that line into freight is caught too.
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query(
            "update public.invoice_items set line_type = 'freight', weight_lbs = 1, rate_per_lb = 1 where invoice_id = $1",
            [d.id],
          ),
        ),
        "23505",
      );
    });

    // Two drafts compete the same way: the first one holds the order.
    await asUser(db, p.staff.id, async (tx) => {
      const order = await receivedOrder(tx, p.aliceCustomer, 1);
      const d1 = await insertDraft(tx, { customerId: p.aliceCustomer });
      const d2 = await insertDraft(tx, { customerId: p.aliceCustomer });
      await insertLine(tx, d1.id, freight(order, 1));
      const err = await expectSqlError(
        withSavepoint(tx, () => insertLine(tx, d2.id, freight(order, 1))),
        "23505",
      );
      expect(err.message).toContain("een concept");
    });

    // Once the invoice is cancelled the order can be billed again.
    await asUser(
      db,
      p.admin.id,
      (tx) => tx.query("select public.cancel_invoice($1, 'Verkeerd gewicht')", [invoice.id]),
      { commit: true },
    );
    await asUser(db, p.staff.id, async (tx) => {
      const d = await insertDraft(tx, { customerId: p.aliceCustomer, replaces: invoice.id });
      await insertLine(tx, d.id, freight(orderId, 2.5));
      const replacement = await issue(tx, d.id);
      expect(replacement).toMatchObject({ status: "open", replaces_invoice_id: invoice.id });
    });
  });

  it("refuses a discount larger than the charges", async () => {
    await asUser(db, p.staff.id, async (tx) => {
      const d = await insertDraft(tx, { customerId: p.aliceCustomer });
      await insertLine(tx, d.id, { line_type: "handling", amount: 5 });
      const err = await expectSqlError(
        withSavepoint(tx, () => insertLine(tx, d.id, { line_type: "discount", amount: -5.01 })),
        "22023",
      );
      expect(err.message).toMatch(/negatief/);
      await insertLine(tx, d.id, { line_type: "discount", amount: -5 });
      expect((await invoiceRow(tx, d.id)).total_amount).toBe("0.00");
    });
  });

  it("computes BTW from the non-exempt lines when a rate is set (inclusive prices)", async () => {
    await asUser(db, p.admin.id, async (tx) => {
      await tx.query("update public.company_settings set vat_rate_percent = 10");
      const order = await receivedOrder(tx, p.aliceCustomer, 3.5);
      const d = await insertDraft(tx, { customerId: p.aliceCustomer });
      expect(d).toMatchObject({ vat_rate: "10.00", vat_amount: "0.00" });
      await insertLine(tx, d.id, freight(order, 3.5)); // 15.75, taxed
      await insertLine(tx, d.id, { line_type: "customs", amount: 12 }); // exempt
      await insertLine(tx, d.id, { line_type: "handling", amount: 6.25, vat_exempt: false });
      expect((await invoiceRow(tx, d.id)).vat_amount).toBe("2.00"); // 22.00 × 10 / 110

      // Half-up: 0.12 × 60 / 160 = 0.045 → 0.05
      await tx.query("update public.company_settings set vat_rate_percent = 60");
      const e = await insertDraft(tx, { customerId: p.aliceCustomer });
      await insertLine(tx, e.id, { line_type: "handling", amount: 0.12, vat_exempt: false });
      expect((await invoiceRow(tx, e.id)).vat_amount).toBe("0.05");

      // A non-exempt discount larger than the taxed lines never makes BTW negative.
      await insertLine(tx, e.id, { line_type: "customs", amount: 10 });
      await insertLine(tx, e.id, { line_type: "discount", amount: -1, vat_exempt: false });
      expect((await invoiceRow(tx, e.id)).vat_amount).toBe("0.00");
    });
  });
});

// ---------------------------------------------------------------------------

describe("issue_invoice", () => {
  it("is refused to customers, disabled customers, logins without a customer and anon", async () => {
    const d = await asUser(
      db,
      p.staff.id,
      (tx) => insertDraft(tx, { customerId: p.aliceCustomer }),
      {
        commit: true,
      },
    );
    for (const user of [p.alice.id, p.carol.id, p.nobody.id]) {
      await expectSqlError(
        asUser(db, user, (tx) => issue(tx, d.id)),
        "42501",
      );
    }
    await expectSqlError(
      asAnon(db, (tx) => issue(tx, d.id)),
      "42501",
    );
    await expectSqlError(
      asService(db, (tx) => issue(tx, d.id)),
      "42501",
    );
  });

  it("validates the invoice: exists, is a draft, has lines and a positive total", async () => {
    const { invoice } = await issuedInvoice(p.aliceCustomer);
    await asUser(db, p.staff.id, async (tx) => {
      await expectSqlError(
        withSavepoint(tx, () => issue(tx, randomUUID())),
        "P0002",
      );
      await expectSqlError(
        withSavepoint(tx, () => issue(tx, invoice.id)),
        "55000",
      );
      const empty = await insertDraft(tx, { customerId: p.aliceCustomer });
      const noLines = await expectSqlError(
        withSavepoint(tx, () => issue(tx, empty.id)),
        "22023",
      );
      expect(noLines.message).toMatch(/minstens één regel/);
      await insertLine(tx, empty.id, { line_type: "handling", amount: 10 });
      await insertLine(tx, empty.id, { line_type: "discount", amount: -10 });
      const zero = await expectSqlError(
        withSavepoint(tx, () => issue(tx, empty.id)),
        "22023",
      );
      expect(zero.message).toMatch(/groter dan 0/);
      // A replacement waits until the invoice it replaces is cancelled.
      const repl = await insertDraft(tx, { customerId: p.aliceCustomer, replaces: invoice.id });
      await insertLine(tx, repl.id, { line_type: "handling", amount: 10 });
      await expectSqlError(
        withSavepoint(tx, () => issue(tx, repl.id)),
        "55000",
      );
    });
  });

  it("refuses a customer who was disabled after the draft was made", async () => {
    const eva = await asUser(
      db,
      p.staff.id,
      async (tx) => {
        const c = await one<{ id: string }>(
          tx,
          "select id from public.create_customer(_full_name => 'Eva Eersel', _phone => '+597 8000005')",
        );
        const d = await insertDraft(tx, { customerId: c.id });
        await insertLine(tx, d.id, { line_type: "handling", amount: 10 });
        return { customer: c.id, draft: d.id };
      },
      { commit: true },
    );
    await db.query("update public.customers set status = 'disabled' where id = $1", [eva.customer]);
    await expectSqlError(
      asUser(db, p.staff.id, (tx) => issue(tx, eva.draft)),
      "55000",
    );
  });

  it("writes the bill-to and issuer snapshots, which later edits do not change", async () => {
    const { invoice, orderId } = await issuedInvoice(p.aliceCustomer, {
      extra: [{ line_type: "customs", amount: 7 }],
    });
    const order = await one<{ reference: string; tracking_number: string }>(
      db,
      "select reference, tracking_number from public.orders where id = $1",
      [orderId],
    );
    const code = await one<{ customer_code: string }>(
      db,
      "select customer_code from public.customers where id = $1",
      [p.aliceCustomer],
    );
    expect(invoice.bill_to_snapshot).toMatchObject({
      customer_id: p.aliceCustomer,
      customer_code: code.customer_code,
      full_name: "Alice Jansen",
      email: "alice@example.com",
      address: "Teststraat 1",
      account_type: "personal",
      orders: [{ id: orderId, reference: order.reference, tracking_number: order.tracking_number }],
    });
    expect(invoice.issuer_snapshot).toMatchObject({
      company_name: "G&R SOLUTIONS N.V.",
      tagline: "CUSTOMS BROKERAGE & LOGISTICS",
      email: "info@grsolutions.sr",
      phone: "5978897500",
      invoice_title: "INVOICE (inclusief BTW)",
      footer_text: "G&R SOLUTIONS N.V.  |  CUSTOMS BROKERAGE & LOGISTICS",
      payment_term_days: 7,
      late_fee_percent: 15,
      vat_rate_percent: null,
      show_vat_breakdown: false,
      paper_size: "Letter",
      bank_accounts: [
        {
          currency: "USD",
          bank_name: "Testbank",
          account_holder: "G&R SOLUTIONS N.V.",
          account_number: "1234567",
        },
        { currency: "EUR", bank_name: null, account_holder: null, account_number: null },
        { currency: "SRD", bank_name: null, account_holder: null, account_number: null },
      ],
    });
    expect(String(invoice.issuer_snapshot?.["payment_terms_text"])).toMatch(/^Deze factuur dient/);

    await asUser(db, p.admin.id, async (tx) => {
      await tx.query("update public.company_settings set company_name = 'Andere naam'");
      await tx.query("update public.customers set full_name = 'Alice Anders' where id = $1", [
        p.aliceCustomer,
      ]);
      const after = await invoiceRow(tx, invoice.id);
      expect(after.issuer_snapshot?.["company_name"]).toBe("G&R SOLUTIONS N.V.");
      expect(after.bill_to_snapshot?.["full_name"]).toBe("Alice Jansen");
    });
  });

  it("takes the VAT rate in force when issuing, not when drafting", async () => {
    await asUser(db, p.admin.id, async (tx) => {
      const order = await receivedOrder(tx, p.aliceCustomer, 2.2);
      const d = await insertDraft(tx, { customerId: p.aliceCustomer });
      await insertLine(tx, d.id, freight(order, 2.2)); // 9.90
      expect(d.vat_rate).toBeNull();
      await tx.query(
        "update public.company_settings set vat_rate_percent = 10, show_vat_breakdown = true",
      );
      const issued = await issue(tx, d.id);
      expect(issued).toMatchObject({ vat_rate: "10.00", vat_amount: "0.90" });
      expect(issued.issuer_snapshot).toMatchObject({
        vat_rate_percent: 10,
        show_vat_breakdown: true,
      });
    });
  });

  it("numbers the year's series, continuing a set counter, with the configured prefix, past 9999", async () => {
    const own = await createDb();
    try {
      const op = await seedPeople(own);
      await asUser(own, op.admin.id, async (tx) => {
        const make = async () => {
          const d = await insertDraft(tx, { customerId: op.daveCustomer });
          await insertLine(tx, d.id, { line_type: "handling", amount: 1 });
          return (await issue(tx, d.id)).invoice_number;
        };
        await tx.query("select public.set_invoice_counter($1, 9998)", [year]);
        expect(await make()).toBe(`INV-${year}-9999`);
        expect(await make()).toBe(`INV-${year}-10000`);
        await tx.query("update public.company_settings set invoice_number_prefix = 'GR/'");
        expect(await make()).toBe(`GR/${year}-10001`);
      });
    } finally {
      await own.close();
    }
  });

  // A draft keeps the dates it was saved with. Issued weeks later it would be
  // overdue at once (reminder, "Achterstallig", late fee); dated in another
  // year it would take a number from that year's series.
  it("refuses dates that are stale, in the future or in another year (SPEC §35.9, §35.10)", async () => {
    await asUser(db, p.staff.id, async (tx) => {
      const draft = await insertDraft(tx, {
        customerId: p.daveCustomer,
        invoiceOffset: -30,
        dueOffset: -23,
      });
      await insertLine(tx, draft.id, { line_type: "handling", amount: 10 });
      const refuse = async (dates: string, message: RegExp) => {
        await tx.query(`update public.invoices set ${dates} where id = $1`, [draft.id]);
        const err = await expectSqlError(
          withSavepoint(tx, () => issue(tx, draft.id)),
          "55000",
        );
        expect(err.message).toMatch(message);
        expect(err.hint).toBe("invoice_dates");
      };
      // Saved 30 days ago with the builder's defaults.
      await refuse("invoice_date = invoice_date", /vervaldatum .* is al verstreken/);
      await refuse(`invoice_date = ${TODAY} - 1, due_date = ${TODAY} - 1`, /al verstreken/);
      await refuse(`invoice_date = ${TODAY} + 1, due_date = ${TODAY} + 8`, /in de toekomst/);
      await refuse(
        `invoice_date = make_date(${year} - 1, 12, 31), due_date = ${TODAY} + 7`,
        new RegExp(`vorig jaar; kies een factuurdatum in ${year}`),
      );
      expect((await invoiceRow(tx, draft.id)).status).toBe("draft");

      // Backdating within this year is fine as long as it is not overdue yet.
      await tx.query(
        `update public.invoices set invoice_date = make_date(${year}, 1, 1), due_date = ${TODAY} where id = $1`,
        [draft.id],
      );
      const issued = await issue(tx, draft.id);
      expect(issued.invoice_number).toMatch(new RegExp(`^INV-${year}-`));
      expect(await overview(tx, draft.id)).toMatchObject({ is_overdue: false, days_overdue: 0 });
    });
  });
});

// ---------------------------------------------------------------------------

describe("set_invoice_counter", () => {
  it("lets an admin continue the existing numbering of a year, audited", async () => {
    // Next year: nothing can be issued in it yet (issue_invoice refuses future dates).
    const next = year + 1;
    await asUser(db, p.admin.id, async (tx) => {
      expect(await one(tx, "select public.set_invoice_counter($1, 123) as n", [next])).toEqual({
        n: 123,
      });
      expect(await one(tx, "select public.set_invoice_counter($1, 140) as n", [next])).toEqual({
        n: 140,
      });
      const audit = await rows<{
        action: string;
        old_data: unknown;
        new_data: unknown;
        actor_id: string;
      }>(
        tx,
        `select action, old_data, new_data, actor_id from public.audit_log
          where table_name = 'invoice_number_counters' and record_id = $1 order by id`,
        [String(next)],
      );
      expect(audit).toEqual([
        {
          action: "INSERT",
          old_data: null,
          new_data: { year: next, last_number: 123 },
          actor_id: p.admin.id,
        },
        {
          action: "UPDATE",
          old_data: { year: next, last_number: 123 },
          new_data: { year: next, last_number: 140 },
          actor_id: p.admin.id,
        },
      ]);
      // Admins read the counters; nothing else may write them directly.
      expect(
        await rows(
          tx,
          "select year, last_number from public.invoice_number_counters where year = $1",
          [next],
        ),
      ).toEqual([{ year: next, last_number: 140 }]);
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("update public.invoice_number_counters set last_number = 1 where year = $1", [
            next,
          ]),
        ),
        "42501",
      );
    });
  });

  it("is refused once the year has an issued invoice, and validates its input", async () => {
    await issuedInvoice(p.aliceCustomer);
    await asUser(db, p.admin.id, async (tx) => {
      const err = await expectSqlError(
        withSavepoint(tx, () => tx.query("select public.set_invoice_counter($1, 500)", [year])),
        "55000",
      );
      expect(err.message).toMatch(/al een factuur uitgegeven/);
      for (const [y, n] of [
        [1999, 1],
        [3000, 1],
        [2030, -1],
        [null, 1],
        [2030, null],
      ]) {
        await expectSqlError(
          withSavepoint(tx, () => tx.query("select public.set_invoice_counter($1, $2)", [y, n])),
          "22023",
        );
      }
    });
  });

  it("is admin only; staff and customers do not even see the counters", async () => {
    for (const user of [p.staff.id, p.alice.id, p.carol.id]) {
      await expectSqlError(
        asUser(db, user, (tx) => tx.query("select public.set_invoice_counter(2031, 1)")),
        "42501",
      );
      expect(
        await asUser(db, user, (tx) => rows(tx, "select * from public.invoice_number_counters")),
      ).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------

describe("cancel_invoice", () => {
  it("admins cancel with a reason the customer sees; the reason is audited", async () => {
    const { invoice } = await issuedInvoice(p.aliceCustomer);
    const cancelled = await asUser(
      db,
      p.admin.id,
      (tx) =>
        one<Invoice>(tx, "select * from public.cancel_invoice($1, '  Verkeerde klant  ')", [
          invoice.id,
        ]),
      { commit: true },
    );
    expect(cancelled).toMatchObject({
      status: "cancelled",
      cancel_reason: "Verkeerde klant",
      cancelled_by: p.admin.id,
      invoice_number: invoice.invoice_number,
    });
    expect(cancelled.cancelled_at).not.toBeNull();
    await asUser(db, p.alice.id, async (tx) => {
      expect(await overview(tx, invoice.id)).toMatchObject({
        status: "cancelled",
        balance_due: "0.00",
        is_overdue: false,
      });
      expect(
        await one(tx, "select cancel_reason from public.invoices where id = $1", [invoice.id]),
      ).toEqual({ cancel_reason: "Verkeerde klant" });
    });
    const audit = await one<{ reason: string; changed_columns: string[] }>(
      db,
      `select reason, changed_columns from public.audit_log
        where table_name = 'invoices' and record_id = $1 and new_data ->> 'status' = 'cancelled'`,
      [invoice.id],
    );
    expect(audit.reason).toBe("Verkeerde klant");
    expect(audit.changed_columns).toEqual(
      expect.arrayContaining(["status", "cancelled_at", "cancel_reason"]),
    );
    await asUser(db, p.admin.id, async (tx) => {
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("select public.cancel_invoice($1, 'nogmaals')", [invoice.id]),
        ),
        "55000",
      );
      await expectSqlError(
        withSavepoint(tx, () => pay(tx, invoice.id, 1)),
        "55000",
      );
    });
  });

  it("is admin only, needs a reason, and refuses drafts and invoices with payments", async () => {
    const { invoice } = await issuedInvoice(p.aliceCustomer);
    await expectSqlError(
      asUser(db, p.staff.id, (tx) =>
        tx.query("select public.cancel_invoice($1, 'reden')", [invoice.id]),
      ),
      "42501",
    );
    await expectSqlError(
      asUser(db, p.alice.id, (tx) =>
        tx.query("select public.cancel_invoice($1, 'reden')", [invoice.id]),
      ),
      "42501",
    );
    await asUser(db, p.admin.id, async (tx) => {
      for (const reason of [null, "", "   "]) {
        await expectSqlError(
          withSavepoint(tx, () =>
            tx.query("select public.cancel_invoice($1, $2)", [invoice.id, reason]),
          ),
          "22023",
        );
      }
      await expectSqlError(
        withSavepoint(tx, () => tx.query("select public.cancel_invoice($1, 'x')", [randomUUID()])),
        "P0002",
      );
      const draft = await insertDraft(tx, { customerId: p.aliceCustomer });
      await expectSqlError(
        withSavepoint(tx, () => tx.query("select public.cancel_invoice($1, 'x')", [draft.id])),
        "55000",
      );
      const paid = await pay(tx, invoice.id, 1);
      const err = await expectSqlError(
        withSavepoint(tx, () => tx.query("select public.cancel_invoice($1, 'x')", [invoice.id])),
        "55000",
      );
      expect(err.message).toMatch(/betalingen/);
      await tx.query("select * from public.void_payment($1, 'terugbetaald')", [paid.payment_id]);
      const ok = await one<Invoice>(tx, "select * from public.cancel_invoice($1, 'x')", [
        invoice.id,
      ]);
      expect(ok.status).toBe("cancelled");
    });
  });
});

// ---------------------------------------------------------------------------

describe("payments", () => {
  it("staff record payments; the invoice status follows the non-voided total", async () => {
    const { invoice } = await issuedInvoice(p.aliceCustomer, {
      extra: [{ line_type: "customs", amount: 41 }],
    }); // 9.00 + 41.00 = 50.00
    await asUser(db, p.staff.id, async (tx) => {
      const r1 = await pay(tx, invoice.id, 20.004);
      expect(r1).toMatchObject({
        invoice_status: "partially_paid",
        amount_paid: "20.00",
        balance_due: "30.00",
      });
      const stored = await one<{
        amount: string;
        recorded_by: string;
        paid_on: string;
        method: string;
      }>(
        tx,
        "select amount, recorded_by, paid_on::text as paid_on, method from public.payments where id = $1",
        [r1.payment_id],
      );
      expect(stored).toEqual({
        amount: "20.00",
        recorded_by: p.staff.id,
        paid_on: today,
        method: "cash",
      });
      await expectSqlError(
        withSavepoint(tx, () => pay(tx, invoice.id, 30.01)),
        "22023",
      );
      const r2 = await pay(tx, invoice.id, 30, {
        paid_on: today,
        received_amount: 1110,
        received_currency: "SRD",
      });
      expect(r2).toMatchObject({ invoice_status: "paid", balance_due: "0.00" });
      const paid = await invoiceRow(tx, invoice.id);
      expect(paid.status).toBe("paid");
      expect(paid.paid_at).not.toBeNull();
      const err = await expectSqlError(
        withSavepoint(tx, () => pay(tx, invoice.id)),
        "55000",
      );
      expect(err.message).toMatch(/al volledig betaald/);
    });
  });

  it("validates amount, date, received currency and the invoice state", async () => {
    const { invoice } = await issuedInvoice(p.aliceCustomer);
    await asUser(db, p.staff.id, async (tx) => {
      for (const amount of [0, -5]) {
        await expectSqlError(
          withSavepoint(tx, () => pay(tx, invoice.id, amount)),
          "22023",
        );
      }
      await expectSqlError(
        withSavepoint(tx, () =>
          pay(tx, invoice.id, 1, {
            paid_on: new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10),
          }),
        ),
        "22023",
      );
      await expectSqlError(
        withSavepoint(tx, () => pay(tx, invoice.id, 1, { received_amount: 37 })),
        "23514",
      );
      await expectSqlError(
        withSavepoint(tx, () => pay(tx, randomUUID(), 1)),
        "P0002",
      );
      const draft = await insertDraft(tx, { customerId: p.aliceCustomer });
      await insertLine(tx, draft.id, { line_type: "handling", amount: 5 });
      const err = await expectSqlError(
        withSavepoint(tx, () => pay(tx, draft.id, 1)),
        "55000",
      );
      expect(err.message).toMatch(/concept/);
    });
  });

  it("only admins void, once, with a reason; voided payments stay out of the customer's view", async () => {
    const { invoice } = await issuedInvoice(p.aliceCustomer); // 9.00
    const payment = await asUser(db, p.staff.id, (tx) => pay(tx, invoice.id), { commit: true });
    expect(payment.invoice_status).toBe("paid");
    const voidAs = (user: string, reason: string | null, id = payment.payment_id) =>
      asUser(db, user, (tx) =>
        one<PaymentResult>(tx, "select * from public.void_payment($1, $2)", [id, reason]),
      );
    await expectSqlError(voidAs(p.staff.id, "fout"), "42501");
    await expectSqlError(voidAs(p.alice.id, "fout"), "42501");
    await expectSqlError(voidAs(p.admin.id, " "), "22023");
    await expectSqlError(voidAs(p.admin.id, "fout", randomUUID()), "P0002");

    const voided = await asUser(
      db,
      p.admin.id,
      (tx) =>
        one<PaymentResult>(tx, "select * from public.void_payment($1, 'Cheque geweigerd')", [
          payment.payment_id,
        ]),
      { commit: true },
    );
    expect(voided).toMatchObject({
      invoice_status: "open",
      amount_paid: "0.00",
      balance_due: "9.00",
    });
    const row = await one<{ voided_by: string; void_reason: string; paid_at: Date | null }>(
      db,
      `select p.voided_by, p.void_reason, i.paid_at from public.payments p
         join public.invoices i on i.id = p.invoice_id where p.id = $1`,
      [payment.payment_id],
    );
    expect(row).toEqual({ voided_by: p.admin.id, void_reason: "Cheque geweigerd", paid_at: null });
    const twice = await expectSqlError(voidAs(p.admin.id, "nogmaals"), "55000");
    expect(twice.message).toMatch(/al ongedaan gemaakt/);

    const audit = await one<{ reason: string }>(
      db,
      `select reason from public.audit_log
        where table_name = 'payments' and record_id = $1 and action = 'UPDATE'`,
      [payment.payment_id],
    );
    expect(audit.reason).toBe("Cheque geweigerd");
    await asUser(db, p.alice.id, async (tx) => {
      expect(
        await rows(tx, "select id from public.payments where invoice_id = $1", [invoice.id]),
      ).toEqual([]);
    });
    await asUser(db, p.staff.id, async (tx) => {
      expect(
        await rows(tx, "select id from public.payments where invoice_id = $1", [invoice.id]),
      ).toHaveLength(1);
    });
  });

  it("customers see payments of their own invoices only; nobody writes payments directly", async () => {
    const { invoice } = await issuedInvoice(p.aliceCustomer);
    const payment = await asUser(db, p.staff.id, (tx) => pay(tx, invoice.id, 4), { commit: true });
    expect(
      await asUser(db, p.alice.id, (tx) =>
        rows(tx, "select id from public.payments where invoice_id = $1", [invoice.id]),
      ),
    ).toEqual([{ id: payment.payment_id }]);
    for (const user of [p.bob.id, p.carol.id, p.nobody.id]) {
      expect(
        await asUser(db, user, (tx) =>
          rows(tx, "select id from public.payments where invoice_id = $1", [invoice.id]),
        ),
      ).toEqual([]);
    }
    for (const user of [p.staff.id, p.admin.id, p.alice.id]) {
      await asUser(db, user, async (tx) => {
        for (const sql of [
          "insert into public.payments (invoice_id, amount, method) values ($1, 1, 'cash')",
          "update public.payments set void_reason = 'x' where invoice_id = $1",
          "delete from public.payments where invoice_id = $1",
        ]) {
          await expectSqlError(
            withSavepoint(tx, () => tx.query(sql, [invoice.id])),
            "42501",
          );
        }
      });
    }
    await expectSqlError(
      asService(db, (tx) =>
        tx.query(
          "insert into public.payments (invoice_id, amount, method) values ($1, 1, 'cash')",
          [invoice.id],
        ),
      ),
      "42501",
    );
    // A voiding outside void_payment is refused too, even in the SQL editor.
    await expectSqlError(
      db.query("update public.payments set voided_at = now(), void_reason = 'x' where id = $1", [
        payment.payment_id,
      ]),
      "55000",
    );
  });
});

// ---------------------------------------------------------------------------

describe("invoice_overview", () => {
  it("computes paid, balance and overdue days in Suriname time", async () => {
    const { invoice: overdue } = await issuedInvoice(p.aliceCustomer, {
      invoiceOffset: -20,
      dueOffset: -5,
    });
    const { invoice: dueToday } = await issuedInvoice(p.aliceCustomer, {
      invoiceOffset: -7,
      dueOffset: 0,
    });
    await asUser(db, p.staff.id, (tx) => pay(tx, overdue.id, 3), { commit: true });
    const draft = await asUser(
      db,
      p.staff.id,
      (tx) => insertDraft(tx, { customerId: p.aliceCustomer }),
      {
        commit: true,
      },
    );
    await asUser(db, p.staff.id, async (tx) => {
      expect(await overview(tx, overdue.id)).toEqual({
        id: overdue.id,
        status: "partially_paid",
        total_amount: "9.00",
        amount_paid: "3.00",
        balance_due: "6.00",
        is_overdue: true,
        days_overdue: 5,
      });
      expect(await overview(tx, dueToday.id)).toMatchObject({
        balance_due: "9.00",
        is_overdue: false,
        days_overdue: 0,
      });
      expect(await overview(tx, draft.id)).toMatchObject({
        status: "draft",
        balance_due: "0.00",
        is_overdue: false,
      });
      await pay(tx, overdue.id);
      expect(await overview(tx, overdue.id)).toMatchObject({
        status: "paid",
        balance_due: "0.00",
        is_overdue: false,
        days_overdue: 0,
      });
    });
  });

  it("applies the caller's row security", async () => {
    const { invoice } = await issuedInvoice(p.bobCustomer);
    const sees = (user: string) =>
      asUser(db, user, (tx) =>
        rows(tx, "select id from public.invoice_overview where id = $1", [invoice.id]),
      );
    expect(await sees(p.bob.id)).toEqual([{ id: invoice.id }]);
    expect(await sees(p.staff.id)).toEqual([{ id: invoice.id }]);
    expect(await sees(p.alice.id)).toEqual([]);
    expect(await sees(p.nobody.id)).toEqual([]);
    expect(
      await asService(db, (tx) =>
        rows(tx, "select id from public.invoice_overview where id = $1", [invoice.id]),
      ),
    ).toEqual([{ id: invoice.id }]);
  });
});

// ---------------------------------------------------------------------------

describe("apply_late_fee", () => {
  it("adds one fee line of late_fee_percent of the balance, audited, only to an overdue invoice", async () => {
    const { invoice } = await issuedInvoice(p.aliceCustomer, {
      weight: 10, // 45.00
      extra: [{ line_type: "customs", amount: 18.33 }], // 63.33
      invoiceOffset: -14,
      dueOffset: -7,
    });
    await asUser(db, p.staff.id, (tx) => pay(tx, invoice.id, 13), { commit: true });
    for (const user of [p.staff.id, p.alice.id]) {
      await expectSqlError(
        asUser(db, user, (tx) => tx.query("select public.apply_late_fee($1)", [invoice.id])),
        "42501",
      );
    }
    await asUser(db, p.admin.id, async (tx) => {
      // The invoice's printed terms promise 15%; a later change of the
      // setting does not apply to it (SPEC §35.9: issued invoices follow their snapshots).
      expect(invoice.issuer_snapshot?.["late_fee_percent"]).toBe(15);
      await tx.query("update public.company_settings set late_fee_percent = 20");
      const after = await one<Invoice>(tx, "select * from public.apply_late_fee($1)", [invoice.id]);
      // balance 50.33 × 15% = 7.5495 → 7.55
      expect(after).toMatchObject({ total_amount: "70.88", status: "partially_paid" });
      expect(after.late_fee_applied_at).not.toBeNull();
      const fee = await one<Line>(
        tx,
        "select * from public.invoice_items where invoice_id = $1 and line_type = 'late_fee'",
        [invoice.id],
      );
      expect(fee).toMatchObject({
        amount: "7.55",
        description: "Opslag te late betaling (15%)",
        vat_exempt: true,
        created_by: p.admin.id,
      });
      const audit = await rows<{ table_name: string; reason: string }>(
        tx,
        `select table_name, reason from public.audit_log
          where reason like 'Opslag te late betaling%' and (record_id = $1 or record_id = $2) order by id`,
        [invoice.id, fee.id],
      );
      expect(audit.map((a) => a.table_name)).toEqual(
        expect.arrayContaining(["invoice_items", "invoices"]),
      );
      await expectSqlError(
        withSavepoint(tx, () => tx.query("select public.apply_late_fee($1)", [invoice.id])),
        "55000",
      );
      // The fee line is as immutable as the rest of the invoice.
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("delete from public.invoice_items where id = $1", [fee.id]),
        ),
        "55000",
      );
    });
  });

  it("is refused before the due date, for drafts, paid and cancelled invoices, and at 0%", async () => {
    const { invoice: notDue } = await issuedInvoice(p.aliceCustomer, { dueOffset: 0 });
    const { invoice: paid } = await issuedInvoice(p.aliceCustomer, {
      invoiceOffset: -10,
      dueOffset: -2,
    });
    const { invoice: cancelled } = await issuedInvoice(p.aliceCustomer, {
      invoiceOffset: -10,
      dueOffset: -2,
    });
    // Issued while the setting was 0%: its own terms promise no surcharge.
    await db.query("update public.company_settings set late_fee_percent = 0");
    const { invoice: zeroPercent } = await issuedInvoice(p.aliceCustomer, {
      invoiceOffset: -10,
      dueOffset: -2,
    }).finally(() => db.query("update public.company_settings set late_fee_percent = 15"));
    await asUser(db, p.staff.id, (tx) => pay(tx, paid.id), { commit: true });
    await asUser(
      db,
      p.admin.id,
      (tx) => tx.query("select public.cancel_invoice($1, 'x')", [cancelled.id]),
      {
        commit: true,
      },
    );
    await asUser(db, p.admin.id, async (tx) => {
      const draft = await insertDraft(tx, {
        customerId: p.aliceCustomer,
        invoiceOffset: -10,
        dueOffset: -2,
      });
      for (const id of [notDue.id, paid.id, cancelled.id, draft.id]) {
        await expectSqlError(
          withSavepoint(tx, () => tx.query("select public.apply_late_fee($1)", [id])),
          "55000",
        );
      }
      await expectSqlError(
        withSavepoint(tx, () => tx.query("select public.apply_late_fee($1)", [randomUUID()])),
        "P0002",
      );
      // Raising the setting now does not give that invoice a fee.
      await tx.query("update public.company_settings set late_fee_percent = 15");
      await expectSqlError(
        withSavepoint(tx, () => tx.query("select public.apply_late_fee($1)", [zeroPercent.id])),
        "22023",
      );
    });
  });

  it("prints a fractional percentage with a decimal comma", async () => {
    await db.query("update public.company_settings set late_fee_percent = 12.5");
    const { invoice } = await issuedInvoice(p.aliceCustomer, {
      weight: 10, // 45.00
      invoiceOffset: -14,
      dueOffset: -7,
    }).finally(() => db.query("update public.company_settings set late_fee_percent = 15"));
    await asUser(db, p.admin.id, async (tx) => {
      await tx.query("select public.apply_late_fee($1)", [invoice.id]);
      expect(
        await one(
          tx,
          "select amount, description from public.invoice_items where invoice_id = $1 and line_type = 'late_fee'",
          [invoice.id],
        ),
      ).toEqual({ amount: "5.63", description: "Opslag te late betaling (12,5%)" }); // 45 × 12.5% = 5.625
    });
  });
});

// ---------------------------------------------------------------------------

describe("pay before pickup (SPEC §35.7)", () => {
  async function readyOrderOnInvoice(): Promise<{ orderId: string; invoice: Invoice }> {
    const { invoice, orderId } = await issuedInvoice(p.aliceCustomer);
    await asUser(
      db,
      p.staff.id,
      (tx) =>
        tx.query(
          "select * from public.change_order_status(array[$1]::uuid[], 'ready_for_pickup')",
          [orderId],
        ),
      { commit: true },
    );
    return { orderId, invoice };
  }
  const pickUp = (tx: Q, ids: string[]) =>
    tx.query(
      "select * from public.change_order_status($1::uuid[], 'picked_up', null, 'Alice zelf')",
      [ids],
    );

  it("blocks handing over an order whose invoice has a balance, until it is paid", async () => {
    const { orderId, invoice } = await readyOrderOnInvoice();
    const free = await asUser(db, p.staff.id, (tx) => receivedOrder(tx, p.aliceCustomer, 1), {
      commit: true,
    });
    await asUser(db, p.staff.id, async (tx) => {
      const err = await expectSqlError(
        withSavepoint(tx, () => pickUp(tx, [free, orderId])),
        "55000",
      );
      expect(err.hint).toBe("pay_before_pickup");
      expect(err.message).toContain(invoice.invoice_number ?? "?");
      // Nothing in the batch moved.
      expect(await rows(tx, "select status from public.orders where id = $1", [free])).toEqual([
        { status: "arrived_us_warehouse" },
      ]);
      // Other stages are not blocked.
      await tx.query(
        "select * from public.change_order_status(array[$1]::uuid[], 'ready_for_pickup')",
        [orderId],
      );
      await pay(tx, invoice.id, 5);
      await expectSqlError(
        withSavepoint(tx, () => pickUp(tx, [orderId])),
        "55000",
      );
      await pay(tx, invoice.id);
      const done = await rows<{ order_id: string }>(
        tx,
        "select * from public.change_order_status(array[$1]::uuid[], 'picked_up', null, 'Alice zelf')",
        [orderId],
      );
      expect(done.map((d) => d.order_id)).toEqual([orderId]);
    });
  });

  it("does not block when the setting is off, for drafts, or for cancelled invoices", async () => {
    const { orderId, invoice } = await readyOrderOnInvoice();
    await asUser(db, p.admin.id, async (tx) => {
      await tx.query("update public.company_settings set pay_before_pickup = false");
      await pickUp(tx, [orderId]);
    });
    await asUser(db, p.admin.id, async (tx) => {
      await tx.query("select public.cancel_invoice($1, 'opnieuw')", [invoice.id]);
      const d = await insertDraft(tx, { customerId: p.aliceCustomer, replaces: invoice.id });
      await insertLine(tx, d.id, freight(orderId, 2)); // a draft is not payable yet
      await pickUp(tx, [orderId]);
    });
  });

  it("pickup_override hands over anyway with a reason, recorded in the audit log", async () => {
    const { orderId } = await readyOrderOnInvoice();
    const override = (user: string, reason: string | null, to = "picked_up") =>
      asUser(db, user, (tx) =>
        rows<{ order_id: string; history_id: number | null; notify: boolean }>(
          tx,
          "select * from public.pickup_override(array[$1]::uuid[], $2, 'Broer van Alice', $3)",
          [orderId, to, reason],
        ),
      );
    await expectSqlError(override(p.alice.id, "nood"), "42501");
    await expectSqlError(
      asAnon(db, (tx) =>
        tx.query("select * from public.pickup_override(array[$1]::uuid[], 'picked_up', 'x', 'y')", [
          orderId,
        ]),
      ),
      "42501",
    );
    await expectSqlError(override(p.staff.id, "  "), "22023");
    await expectSqlError(override(p.staff.id, "nood", "in_transit"), "22023");

    const r = await asUser(
      db,
      p.staff.id,
      (tx) =>
        rows<{ order_id: string; history_id: number | null }>(
          tx,
          "select * from public.pickup_override(array[$1]::uuid[], 'picked_up', 'Broer van Alice', 'Betaalt morgen contant')",
          [orderId],
        ),
      { commit: true },
    );
    expect(r).toHaveLength(1);
    expect(r[0]?.history_id).not.toBeNull();
    const order = await one<{ status: string; picked_up_by_name: string; handed_over_by: string }>(
      db,
      "select status, picked_up_by_name, handed_over_by from public.orders where id = $1",
      [orderId],
    );
    expect(order).toEqual({
      status: "picked_up",
      picked_up_by_name: "Broer van Alice",
      handed_over_by: p.staff.id,
    });
    const audit = await one<{ reason: string; actor_id: string }>(
      db,
      `select reason, actor_id from public.audit_log
        where table_name = 'orders' and record_id = $1 and new_data ->> 'status' = 'picked_up'`,
      [orderId],
    );
    expect(audit).toEqual({
      reason: "Afgegeven zonder volledige betaling: Betaalt morgen contant",
      actor_id: p.staff.id,
    });
  });
});

// ---------------------------------------------------------------------------

describe("customer_history_by_year", () => {
  it("counts a customer's orders, shipments, issued invoices and payments per year", async () => {
    const fien = await createAuthUser(db, {
      email: "fien@example.com",
      meta: { full_name: "Fien Fernandes", phone: "+597 8000006" },
    });
    const fienCustomer = await customerIdOf(db, fien.id);
    await asUser(
      db,
      p.staff.id,
      async (tx) => {
        const shipment = await one<{ id: string }>(
          tx,
          "insert into public.shipments (shipment_number, departed_at) values ($1, now()) returning id",
          [`AWB-${randomUUID().slice(0, 8)}`],
        );
        const o1 = await receivedOrder(tx, fienCustomer, 1);
        const o2 = await receivedOrder(tx, fienCustomer, 2);
        await receivedOrder(tx, fienCustomer, 3);
        await tx.query("update public.orders set shipment_id = $1 where id = any($2)", [
          shipment.id,
          [o1, o2],
        ]);
        const a = await insertDraft(tx, { customerId: fienCustomer });
        await insertLine(tx, a.id, freight(o1, 1));
        await issue(tx, a.id);
        const b = await insertDraft(tx, { customerId: fienCustomer });
        await insertLine(tx, b.id, freight(o2, 2));
        await issue(tx, b.id);
        await insertDraft(tx, { customerId: fienCustomer }); // drafts do not count
        const old = await insertDraft(tx, { customerId: fienCustomer });
        await insertLine(tx, old.id, { line_type: "handling", amount: 10 });
        await issue(tx, old.id);
        await pay(tx, a.id, 1);
        const voided = await pay(tx, a.id, 1);
        await pay(tx, old.id, 10, { paid_on: "2025-03-05" });
        return { voidedId: voided.payment_id, oldId: old.id };
      },
      { commit: true },
    ).then(async ({ voidedId, oldId }) => {
      // An invoice of an earlier year, as if issued back then.
      await setInvoiceDates(db, oldId, { invoiceDate: "2025-03-01", dueDate: "2025-03-08" });
      await asUser(
        db,
        p.admin.id,
        (tx) => tx.query("select * from public.void_payment($1, 'dubbel')", [voidedId]),
        { commit: true },
      );
    });

    const expected = [
      { year, order_count: 3, shipment_count: 1, invoice_count: 2, payment_count: 1 },
      { year: 2025, order_count: 0, shipment_count: 0, invoice_count: 1, payment_count: 1 },
    ];
    expect(
      await asUser(db, fien.id, (tx) =>
        rows(tx, "select * from public.customer_history_by_year()"),
      ),
    ).toEqual(expected);
    expect(
      await asUser(db, fien.id, (tx) =>
        rows(tx, "select * from public.customer_history_by_year($1)", [fienCustomer]),
      ),
    ).toEqual(expected);
    expect(
      await asUser(db, p.staff.id, (tx) =>
        rows(tx, "select * from public.customer_history_by_year($1)", [fienCustomer]),
      ),
    ).toEqual(expected);
  });

  it("customers get only their own history; staff must name a customer", async () => {
    await expectSqlError(
      asUser(db, p.alice.id, (tx) =>
        tx.query("select * from public.customer_history_by_year($1)", [p.bobCustomer]),
      ),
      "42501",
    );
    for (const user of [p.carol.id, p.nobody.id]) {
      await expectSqlError(
        asUser(db, user, (tx) => tx.query("select * from public.customer_history_by_year()")),
        "42501",
      );
    }
    await expectSqlError(
      asAnon(db, (tx) => tx.query("select * from public.customer_history_by_year()")),
      "42501",
    );
    await expectSqlError(
      asUser(db, p.staff.id, (tx) => tx.query("select * from public.customer_history_by_year()")),
      "22023",
    );
  });
});

// ---------------------------------------------------------------------------

describe("internal notes on invoices and payments", () => {
  it("staff attach notes to an invoice or payment of the same customer", async () => {
    const { invoice } = await issuedInvoice(p.aliceCustomer);
    const { invoice: bobInvoice } = await issuedInvoice(p.bobCustomer);
    const payment = await asUser(db, p.staff.id, (tx) => pay(tx, invoice.id, 1), { commit: true });
    await asUser(db, p.staff.id, async (tx) => {
      const note = (target: "invoice_id" | "payment_id", customer: string, id: string) =>
        tx.query(
          `insert into public.internal_notes (customer_id, ${target}, body) values ($1, $2, 'Belt terug') returning id`,
          [customer, id],
        );
      expect((await note("invoice_id", p.aliceCustomer, invoice.id)).rows).toHaveLength(1);
      expect((await note("payment_id", p.aliceCustomer, payment.payment_id)).rows).toHaveLength(1);
      for (const [target, customer, id] of [
        ["invoice_id", p.aliceCustomer, bobInvoice.id],
        ["invoice_id", p.bobCustomer, invoice.id],
        ["invoice_id", p.aliceCustomer, randomUUID()],
        ["payment_id", p.bobCustomer, payment.payment_id],
        ["payment_id", p.aliceCustomer, randomUUID()],
      ] as const) {
        await expectSqlError(
          withSavepoint(tx, () => note(target, customer, id)),
          "22023",
        );
      }
    });
  });

  it("a note survives the deletion of its draft, on the customer", async () => {
    const draft = await asUser(
      db,
      p.staff.id,
      (tx) => insertDraft(tx, { customerId: p.aliceCustomer }),
      {
        commit: true,
      },
    );
    await asUser(db, p.staff.id, async (tx) => {
      const n = await one<{ id: string }>(
        tx,
        "insert into public.internal_notes (customer_id, invoice_id, body) values ($1, $2, 'Concept') returning id",
        [p.aliceCustomer, draft.id],
      );
      await tx.query("delete from public.invoices where id = $1", [draft.id]);
      expect(
        await one(tx, "select customer_id, invoice_id from public.internal_notes where id = $1", [
          n.id,
        ]),
      ).toEqual({ customer_id: p.aliceCustomer, invoice_id: null });
    });
  });
});

// ---------------------------------------------------------------------------

describe("email_logs and job_runs", () => {
  it("the service role claims, sends and re-claims e-mails idempotently", async () => {
    const { invoice } = await issuedInvoice(p.aliceCustomer);
    const key = `invoice_issued:${invoice.id}`;
    const claim = (tx: Q) =>
      tx.query(
        `insert into public.email_logs (kind, customer_id, invoice_id, recipient, idempotency_key)
         values ('invoice_issued', $1, $2, 'alice@example.com', $3)
         on conflict (idempotency_key) do nothing returning id`,
        [p.aliceCustomer, invoice.id, key],
      );
    await asService(
      db,
      async (tx) => {
        expect((await claim(tx)).rows).toHaveLength(1);
        expect((await claim(tx)).rows).toHaveLength(0);
        await tx.query(
          "update public.email_logs set status = 'failed', error = 'timeout' where idempotency_key = $1",
          [key],
        );
        const reclaimed = await tx.query(
          "update public.email_logs set status = 'queued', error = null where idempotency_key = $1 and status = 'failed' returning id",
          [key],
        );
        expect(reclaimed.rows).toHaveLength(1);
        await expectSqlError(
          withSavepoint(tx, () =>
            tx.query("update public.email_logs set status = 'sent' where idempotency_key = $1", [
              key,
            ]),
          ),
          "23514",
        );
        await tx.query(
          "update public.email_logs set status = 'sent', sent_at = now(), provider_message_id = 're_1' where idempotency_key = $1",
          [key],
        );
        await tx.query(
          `insert into public.email_logs (kind, recipient, idempotency_key, status)
           values ('invitation', 'nieuw@example.com', $1, 'skipped_no_provider')`,
          [`invitation:${randomUUID()}`],
        );
      },
      { commit: true },
    );

    expect(
      await asUser(db, p.staff.id, (tx) =>
        rows(tx, "select status from public.email_logs where idempotency_key = $1", [key]),
      ),
    ).toEqual([{ status: "sent" }]);
    for (const user of [p.alice.id, p.carol.id, p.nobody.id]) {
      expect(await asUser(db, user, (tx) => rows(tx, "select id from public.email_logs"))).toEqual(
        [],
      );
    }
    for (const user of [p.staff.id, p.admin.id]) {
      await asUser(db, user, async (tx) => {
        for (const sql of [
          "insert into public.email_logs (kind, recipient, idempotency_key) values ('welcome', 'x@example.com', 'k')",
          "update public.email_logs set status = 'failed'",
          "delete from public.email_logs",
        ]) {
          await expectSqlError(
            withSavepoint(tx, () => tx.query(sql)),
            "42501",
          );
        }
      });
    }
    await expectSqlError(
      asService(db, (tx) => tx.query("delete from public.email_logs")),
      "42501",
    );
  });

  it("e-mail links to a deleted draft are cleared, not lost", async () => {
    const draft = await asUser(
      db,
      p.staff.id,
      (tx) => insertDraft(tx, { customerId: p.aliceCustomer }),
      {
        commit: true,
      },
    );
    const key = `test:${randomUUID()}`;
    await asService(
      db,
      (tx) =>
        tx.query(
          "insert into public.email_logs (kind, customer_id, invoice_id, recipient, idempotency_key) values ('invoice_issued', $1, $2, 'a@example.com', $3)",
          [p.aliceCustomer, draft.id, key],
        ),
      { commit: true },
    );
    await asUser(
      db,
      p.staff.id,
      (tx) => tx.query("delete from public.invoices where id = $1", [draft.id]),
      {
        commit: true,
      },
    );
    expect(
      await one(
        db,
        "select customer_id, invoice_id from public.email_logs where idempotency_key = $1",
        [key],
      ),
    ).toEqual({ customer_id: p.aliceCustomer, invoice_id: null });
  });

  it("the reminder job may only update the reminder bookkeeping of issued invoices", async () => {
    const { invoice } = await issuedInvoice(p.aliceCustomer);
    const draft = await asUser(
      db,
      p.staff.id,
      (tx) => insertDraft(tx, { customerId: p.aliceCustomer }),
      {
        commit: true,
      },
    );
    const remind = `update public.invoices
                       set first_reminder_sent_at = coalesce(first_reminder_sent_at, now()),
                           last_reminder_sent_at = now(), reminder_count = reminder_count + 1
                     where id = $1`;
    await asService(db, async (tx) => {
      expect((await tx.query(remind, [invoice.id])).affectedRows).toBe(1);
      expect((await invoiceRow(tx, invoice.id)).reminder_count).toBe(1);
      await expectSqlError(
        withSavepoint(tx, () => tx.query(remind, [draft.id])),
        "42501",
      );
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("update public.invoices set customer_note = 'x' where id = $1", [invoice.id]),
        ),
        "42501",
      );
    });
    // Staff send a single reminder through server code, not by writing the columns.
    await expectSqlError(
      asUser(db, p.staff.id, (tx) => tx.query(remind, [invoice.id])),
      "42501",
    );
  });

  it("the service role records job runs; staff read them, customers do not", async () => {
    const run = await asService(
      db,
      async (tx) => {
        const r = await one<{ id: string; status: string }>(
          tx,
          "insert into public.job_runs (job, trigger, started_by) values ('payment_reminders', 'manual', $1) returning id, status",
          [p.staff.id],
        );
        expect(r.status).toBe("running");
        await expectSqlError(
          withSavepoint(tx, () =>
            tx.query("update public.job_runs set status = 'succeeded' where id = $1", [r.id]),
          ),
          "23514",
        );
        await tx.query(
          `update public.job_runs set status = 'succeeded', finished_at = now(), stats = '{"sent": 2}' where id = $1`,
          [r.id],
        );
        await expectSqlError(
          withSavepoint(tx, () =>
            tx.query(
              "insert into public.job_runs (job, trigger) values ('Payment Reminders', 'cron')",
            ),
          ),
          "23514",
        );
        return r;
      },
      { commit: true },
    );
    expect(
      await asUser(db, p.staff.id, (tx) =>
        rows(tx, "select status, stats from public.job_runs where id = $1", [run.id]),
      ),
    ).toEqual([{ status: "succeeded", stats: { sent: 2 } }]);
    for (const user of [p.alice.id, p.carol.id]) {
      expect(await asUser(db, user, (tx) => rows(tx, "select id from public.job_runs"))).toEqual(
        [],
      );
    }
    await expectSqlError(
      asUser(db, p.admin.id, (tx) =>
        tx.query("insert into public.job_runs (job, trigger) values ('x_job', 'manual')"),
      ),
      "42501",
    );
  });
});

// ---------------------------------------------------------------------------

describe("audit log", () => {
  it("records invoices, lines and payments with their actors", async () => {
    const { invoice } = await issuedInvoice(p.aliceCustomer);
    const payment = await asUser(db, p.staff.id, (tx) => pay(tx, invoice.id, 2), { commit: true });
    const log = await rows<{ table_name: string; action: string; actor_id: string }>(
      db,
      `select distinct a.table_name, a.action, a.actor_id from public.audit_log a
        where a.record_id = $1
           or a.record_id = $2
           or a.record_id in (select li.id::text from public.invoice_items li where li.invoice_id = $1::uuid)
        order by 1, 2`,
      [invoice.id, payment.payment_id],
    );
    expect(log).toEqual([
      { table_name: "invoice_items", action: "INSERT", actor_id: p.staff.id },
      { table_name: "invoices", action: "INSERT", actor_id: p.staff.id },
      { table_name: "invoices", action: "UPDATE", actor_id: p.staff.id },
      { table_name: "payments", action: "INSERT", actor_id: p.staff.id },
    ]);
    const issued = await one<{ changed_columns: string[] }>(
      db,
      `select changed_columns from public.audit_log
        where table_name = 'invoices' and record_id = $1 and new_data ->> 'status' = 'open'
          and old_data ->> 'status' = 'draft'`,
      [invoice.id],
    );
    expect(issued.changed_columns).toEqual(
      expect.arrayContaining(["status", "invoice_number", "issued_at", "issuer_snapshot"]),
    );
  });
});

// ---------------------------------------------------------------------------

describe("customer codes and orders once invoiced", () => {
  it("an issued invoice freezes the GR code; a draft does not (SPEC §35.5)", async () => {
    const gijs = await asUser(
      db,
      p.staff.id,
      async (tx) => {
        const c = await one<{ id: string }>(
          tx,
          "select id from public.create_customer(_full_name => 'Gijs Goede', _phone => '+597 8000007')",
        );
        const d = await insertDraft(tx, { customerId: c.id });
        await insertLine(tx, d.id, { line_type: "handling", amount: 10 });
        return { id: c.id, draft: d.id };
      },
      { commit: true },
    );
    const change = (code: string) =>
      asUser(
        db,
        p.admin.id,
        (tx) =>
          tx.query("select public.change_customer_code($1, $2, 'correctie')", [gijs.id, code]),
        { commit: true },
      );
    await change("GR00061");
    await asUser(db, p.staff.id, (tx) => issue(tx, gijs.draft), { commit: true });
    const err = await expectSqlError(change("GR00062"), "55000");
    expect(err.message).toMatch(/GR00061 kan niet meer worden gewijzigd/);
  });

  it("an order on an invoice keeps its customer, even for the SQL editor", async () => {
    const { orderId } = await issuedInvoice(p.aliceCustomer);
    await expectSqlError(
      db.query("update public.orders set customer_id = $2 where id = $1", [orderId, p.bobCustomer]),
      "55000",
    );
    const loose = await asUser(db, p.staff.id, (tx) => receivedOrder(tx, p.aliceCustomer, 1), {
      commit: true,
    });
    const moved = await db.query("update public.orders set customer_id = $2 where id = $1", [
      loose,
      p.bobCustomer,
    ]);
    expect(moved.affectedRows).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("access summary", () => {
  it("a disabled customer or a login without a customer sees nothing; anon is denied everything", async () => {
    await issuedInvoice(p.aliceCustomer);
    for (const user of [p.carol.id, p.nobody.id]) {
      await asUser(db, user, async (tx) => {
        for (const t of M3_RELATIONS) {
          expect(await rows(tx, `select * from public.${t}`), t).toEqual([]);
        }
      });
    }
    for (const t of M3_RELATIONS) {
      await expectSqlError(
        asAnon(db, (tx) => tx.query(`select * from public.${t}`)),
        "42501",
      );
    }
  });

  it("customers see none of another customer's billing, and none of the staff-only tables", async () => {
    const { invoice } = await issuedInvoice(p.bobCustomer);
    await asUser(db, p.staff.id, (tx) => pay(tx, invoice.id, 1), { commit: true });
    await asUser(db, p.alice.id, async (tx) => {
      for (const sql of [
        "select id from public.invoices where id = $1",
        "select id from public.invoice_items where invoice_id = $1",
        "select id from public.payments where invoice_id = $1",
        "select id from public.invoice_overview where id = $1",
      ]) {
        expect(await rows(tx, sql, [invoice.id]), sql).toEqual([]);
      }
      for (const t of ["invoice_number_counters", "email_logs", "job_runs"]) {
        expect(await rows(tx, `select * from public.${t}`), t).toEqual([]);
      }
    });
  });

  it("every staff and admin RPC of this migration raises 42501 for a customer; admin RPCs for staff", async () => {
    const { invoice, orderId } = await issuedInvoice(p.aliceCustomer);
    const payment = await asUser(db, p.staff.id, (tx) => pay(tx, invoice.id, 1), { commit: true });
    const calls: [string, unknown[]][] = [
      ["select public.issue_invoice($1)", [invoice.id]],
      ["select public.set_invoice_counter(2032, 1)", []],
      ["select public.cancel_invoice($1, 'x')", [invoice.id]],
      ["select * from public.record_payment($1, 1)", [invoice.id]],
      ["select * from public.void_payment($1, 'x')", [payment.payment_id]],
      ["select public.apply_late_fee($1)", [invoice.id]],
      ["select * from public.pickup_override(array[$1]::uuid[], 'picked_up', 'x', 'y')", [orderId]],
      [
        "select * from public.change_order_status(array[$1]::uuid[], 'picked_up', null, 'x')",
        [orderId],
      ],
    ];
    for (const user of [p.alice.id, p.carol.id, p.nobody.id]) {
      await asUser(db, user, async (tx) => {
        for (const [sql, params] of calls) {
          await expectSqlError(
            withSavepoint(tx, () => tx.query(sql, params)),
            "42501",
          );
        }
      });
    }
    await asUser(db, p.staff.id, async (tx) => {
      for (const [sql, params] of calls.filter(([s]) =>
        /set_invoice_counter|cancel_invoice|void_payment|apply_late_fee/.test(s),
      )) {
        await expectSqlError(
          withSavepoint(tx, () => tx.query(sql, params)),
          "42501",
        );
      }
    });
  });
});
