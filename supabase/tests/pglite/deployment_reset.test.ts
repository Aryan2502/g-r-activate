// @vitest-environment node
/**
 * docs/DEPLOYMENT.md §8.2 (pre-go-live reset), run exactly as the owner runs
 * it in the Supabase SQL editor: as postgres, no JWT, against every migration.
 * The fixture fills every table the way the app does (sign-ups, staff work,
 * issued and cancelled invoices, payments, uploads, invitations, e-mail logs,
 * a code change), next to configuration and a team that must survive.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AuthUser,
  type Db,
  asService,
  asUser,
  createAuthUser,
  createDb,
  expectSqlError,
} from "./harness";

const DEPLOYMENT_MD = path.resolve(__dirname, "../../../docs/DEPLOYMENT.md");
const RLS_SCRIPT = path.resolve(__dirname, "../rls_checks.sql");
const PLACEHOLDER = "<TYP HIER: WIS ALLE TESTGEGEVENS>";

function docSql(marker: string): string {
  const doc = readFileSync(DEPLOYMENT_MD, "utf8");
  const match = new RegExp(
    `<!-- ${marker}:start[^>]*-->\\s*\`\`\`sql\\n([\\s\\S]*?)\`\`\`\\s*<!-- ${marker}:end -->`,
  ).exec(doc);
  if (!match?.[1]) throw new Error(`${marker} block not found in docs/DEPLOYMENT.md`);
  return match[1];
}

function resetSql(confirmation = "WIS ALLE TESTGEGEVENS"): string {
  const sql = docSql("reset-sql");
  expect(sql.split(PLACEHOLDER)).toHaveLength(3); // the constant and the error message
  return sql.replace(`'${PLACEHOLDER}'`, `'${confirmation}'`);
}

async function overview(db: Db): Promise<Record<string, number>> {
  const res = await db.exec(docSql("reset-overview-sql"));
  const rows = res.at(-1)?.rows as { wat: string; aantal: number | string }[];
  return Object.fromEntries(rows.map((r) => [r.wat, Number(r.aantal)]));
}

async function count(db: Db, sql: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`select (${sql})::int as n`);
  return rows[0]!.n;
}

/** Rows that must survive the reset unchanged (configuration and team). */
async function kept(db: Db) {
  const { rows } = await db.query<Record<string, string>>(`
    select
      (select md5(to_jsonb(s)::text) from public.company_settings s) as settings,
      (select md5(jsonb_agg(to_jsonb(b) order by b.id)::text) from public.company_bank_accounts b) as banks,
      (select md5(jsonb_agg(to_jsonb(w) order by w.id)::text) from public.warehouse_addresses w) as addresses,
      (select md5(jsonb_agg(to_jsonb(r) order by r.service_type)::text) from public.service_rates r) as rates,
      (select md5(jsonb_agg(to_jsonb(st) order by st.code)::text) from public.shipment_statuses st) as statuses,
      (select md5(jsonb_agg(to_jsonb(ur) order by ur.id)::text) from public.user_roles ur) as roles,
      (select md5(jsonb_agg(to_jsonb(i) order by i.id)::text) from public.invitations i where i.kind = 'staff') as staff_invites,
      (select md5(jsonb_agg(to_jsonb(a) order by a.id)::text) from public.audit_log a
        where a.table_name in ('company_settings', 'company_bank_accounts', 'warehouse_addresses',
                               'service_rates', 'shipment_statuses', 'user_roles', 'team_login')) as config_audit,
      (select string_agg(p.id::text, ',' order by p.id) from public.profiles p) as profiles,
      (select string_agg(u.id::text, ',' order by u.id) from auth.users u) as logins,
      (select count(*) from storage.objects)::text as objects`);
  return rows[0]!;
}

const sha = (s: string) => s.padEnd(64, "0").slice(0, 64);

interface Fixture {
  admin: AuthUser;
  staff: AuthUser;
  blockedStaff: AuthUser;
  alice: AuthUser;
}

async function fill(db: Db): Promise<Fixture> {
  const signUp = (email: string, name: string, confirmed = true) =>
    createAuthUser(db, {
      email,
      confirmed,
      meta: { full_name: name, phone: "+597 8000000", terms_version: "1" },
    });

  // Team: the first admin (sign-up + §4), a staff member, a deactivated one.
  const admin = await signUp("owner@example.com", "Olga Owner");
  const staff = await signUp("maria@example.com", "Maria Staff");
  const blockedStaff = await signUp("oud@example.com", "Oud Teamlid");
  await db.query(
    `insert into public.user_roles (user_id, role) values ($1, 'admin'), ($2, 'staff'), ($3, 'staff')`,
    [admin.id, staff.id, blockedStaff.id],
  );
  await db.query(
    `update public.customers set user_id = null, status = 'disabled', disabled_reason = 'bootstrap admin'
      where user_id = any($1)`,
    [[admin.id, staff.id, blockedStaff.id]],
  );
  await db.query(
    "update auth.users set banned_until = now() + interval '100 years' where id = $1",
    [blockedStaff.id],
  );

  // Configuration the owner filled in during testing.
  await asUser(
    db,
    admin.id,
    async (tx) => {
      await tx.query(
        "update public.company_settings set pickup_hours = 'ma-vr 9-17', kkf_number = '12345'",
      );
      await tx.query(
        "update public.company_bank_accounts set bank_name = 'DSB', account_holder = 'G&R', account_number = '123' where currency = 'USD'",
      );
      await tx.query(
        `insert into public.warehouse_addresses (label, service_type, address_line1, city, state, zip, country, is_active)
         values ('Miami', 'air', '1 Test Street', 'Miami', 'FL', '33101', 'USA', true)`,
      );
      await tx.query(
        "update public.service_rates set rate_per_lb = 4.5 where service_type = 'air'",
      );
      await tx.query(
        `insert into public.shipment_statuses (code, label_nl, stage, sort_order, customer_visible, notify_customer, active)
         values ('in_sorting', 'In sortering', 'arrived_sr', 65, true, false, true)`,
      );
      const year = await tx.query<{ y: number }>(
        "select extract(year from now() at time zone 'America/Paramaribo')::int as y",
      );
      await tx.query("select public.set_invoice_counter($1, 41)", [year.rows[0]!.y]);
      await tx.query(
        `insert into public.invitations (kind, staff_role, email, token_hash)
         values ('staff', 'staff', 'nieuw.teamlid@example.com', $1)`,
        [sha("a1")],
      );
    },
    { commit: true },
  );

  // Customers: two sign-ups, an unconfirmed sign-up, one added by staff with
  // an existing code and invited, one whose code was changed (retired number).
  const alice = await signUp("alice@example.com", "Alice Klant");
  const bob = await signUp("bob@example.com", "Bob Klant");
  await signUp("halfweg@example.com", "Halfweg", false);
  const cid = async (user: AuthUser) =>
    (
      await db.query<{ id: string }>("select id from public.customers where user_id = $1", [
        user.id,
      ])
    ).rows[0]!.id;
  const aliceId = await cid(alice);
  const bobId = await cid(bob);

  const ids = await asUser(
    db,
    staff.id,
    async (tx) => {
      const one = async <T>(text: string, params: unknown[] = []) =>
        (await tx.query<T>(text, params)).rows[0]!;
      const legacy = await one<{ id: string }>(
        "select (public.create_customer('Jan Bestaand', '+597 8111111', 'jan@example.com', 'GR00017')).id as id",
      );
      await tx.query(
        "insert into public.invitations (kind, customer_id, email, token_hash) values ('customer', $1, 'jan@example.com', $2)",
        [legacy.id, sha("b2")],
      );
      const renamed = await one<{ id: string }>(
        "select (public.create_customer('Code Wissel', '+597 8222222')).id as id",
      );
      const order = (customer: string, parent: string | null = null) =>
        one<{ id: string }>(
          `insert into public.orders (customer_id, store_vendor, vendor_order_number, tracking_number, parent_order_id)
           values ($1, 'Amazon', '112-1', $2, $3) returning id`,
          [customer, `1Z${Math.random().toString(36).slice(2, 10)}`, parent],
        );
      const a1 = await order(aliceId);
      const a2 = await order(aliceId, a1.id);
      const b1 = await order(bobId);
      for (const o of [a1, a2, b1])
        await tx.query("select * from public.receive_order($1, 3)", [o.id]);
      const ship = await one<{ id: string }>(
        "insert into public.shipments (shipment_number) values ('AWB-001') returning id",
      );
      await tx.query("update public.orders set shipment_id = $1 where id = any($2)", [
        ship.id,
        [a1.id, b1.id],
      ]);
      await tx.query(
        "select * from public.change_order_status($1, 'in_transit', 'Vertrokken', null)",
        [[a1.id, b1.id]],
      );
      await tx.query(
        "insert into public.internal_notes (customer_id, order_id, body) values ($1, $2, 'Breekbaar')",
        [aliceId, a1.id],
      );
      const invoice = async (
        customer: string,
        orders: string[],
        replaces: string | null = null,
      ) => {
        const inv = await one<{ id: string }>(
          "insert into public.invoices (customer_id, replaces_invoice_id) values ($1, $2) returning id",
          [customer, replaces],
        );
        for (const o of orders) {
          await tx.query(
            `insert into public.invoice_items (invoice_id, order_id, line_type, description, weight_lbs, rate_per_lb, amount, vat_exempt)
             values ($1, $2, 'freight', 'Vracht', 3, 4.5, 13.5, false)`,
            [inv.id, o],
          );
        }
        return inv.id;
      };
      const paid = await invoice(aliceId, [a1.id]);
      await tx.query("select public.issue_invoice($1)", [paid]);
      await tx.query("select * from public.record_payment($1)", [paid]);
      const wrong = await invoice(aliceId, [a2.id]);
      await tx.query("select public.issue_invoice($1)", [wrong]);
      const open = await invoice(bobId, [b1.id]);
      await tx.query("select public.issue_invoice($1)", [open]);
      const pay = await one<{ payment_id: string }>(
        "select payment_id from public.record_payment($1, 5)",
        [open],
      );
      await tx.query(
        "insert into public.internal_notes (customer_id, invoice_id, body) values ($1, $2, 'Belt terug')",
        [bobId, open],
      );
      await tx.query(
        "insert into public.internal_notes (customer_id, payment_id, body) values ($1, $2, 'Contant')",
        [bobId, pay.payment_id],
      );
      await invoice(bobId, []); // an empty draft
      return { a1: a1.id, a2: a2.id, wrong, payment: pay.payment_id, renamed: renamed.id };
    },
    { commit: true },
  );

  // Admin-only work: correct an invoice (cancel + replacement), void a payment,
  // change a code (retires the old number).
  await asUser(
    db,
    admin.id,
    async (tx) => {
      await tx.query("select public.cancel_invoice($1, 'Verkeerd gewicht')", [ids.wrong]);
      const repl = await tx.query<{ id: string }>(
        "insert into public.invoices (customer_id, replaces_invoice_id) values ($1, $2) returning id",
        [aliceId, ids.wrong],
      );
      await tx.query(
        `insert into public.invoice_items (invoice_id, order_id, line_type, description, weight_lbs, rate_per_lb, amount, vat_exempt)
         values ($1, $2, 'freight', 'Vracht', 2, 4.5, 9, false)`,
        [repl.rows[0]!.id, ids.a2],
      );
      await tx.query("select public.issue_invoice($1)", [repl.rows[0]!.id]);
      await tx.query("select * from public.void_payment($1, 'Dubbel geboekt')", [ids.payment]);
      await tx.query("select public.change_customer_code($1, 'GR00555', 'Wens klant')", [
        ids.renamed,
      ]);
    },
    { commit: true },
  );

  // The customer's own actions: an upload (Storage first, then the record) and
  // a cancellation request (a staff task).
  const objectName = `${aliceId}/${ids.a1}/00000000-0000-4000-8000-0000000000aa.pdf`;
  await db.query(
    "insert into storage.objects (bucket_id, name, created_at) values ('order-documents', $1, now() - interval '2 days')",
    [objectName],
  );
  await asUser(
    db,
    alice.id,
    async (tx) => {
      await tx.query(
        `insert into public.order_documents (order_id, customer_id, kind, storage_path, original_filename, mime_type, size_bytes)
         values ($1, $2, 'purchase_invoice', $3, 'bon.pdf', 'application/pdf', 1000)`,
        [ids.a1, aliceId, objectName],
      );
      await tx.query("select public.request_order_cancellation($1)", [ids.a2]);
    },
    { commit: true },
  );
  await asUser(db, bob.id, (tx) => tx.query("select public.update_my_contact('+597 8999999')"), {
    commit: true,
  });

  // What the server writes with the service role.
  await asService(
    db,
    async (tx) => {
      await tx.query(
        `insert into public.email_logs (kind, customer_id, recipient, idempotency_key, status)
         values ('welcome', $1, 'alice@example.com', 'welcome:alice', 'skipped_no_provider')`,
        [aliceId],
      );
      await tx.query(
        "insert into public.job_runs (job, trigger, status, finished_at) values ('payment_reminders', 'cron', 'succeeded', now())",
      );
    },
    { commit: true },
  );

  return { admin, staff, blockedStaff, alice };
}

describe("docs/DEPLOYMENT.md §8.2: pre-go-live reset", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it("removes every customer, order, invoice, payment, e-mail and their audit rows, and keeps settings and team", async () => {
    const team = await fill(db);
    const before = await overview(db);
    expect(before).toMatchObject({
      klantdossiers: 7, // 3 team sign-ups (unlinked), alice, bob, GR00017, GR00555
      "logins zonder teamrol (testklanten)": 3,
      orders: 3,
      zendingen: 1,
      facturen: 5,
      betalingen: 2,
      "e-maillogs": 1,
      "bestanden in order-documents (stap 1)": 1,
      "teamleden (blijven)": 3,
    });
    expect(before["auditregels"]).toBeGreaterThan(30);
    expect(await count(db, "select count(*) from public.staff_tasks")).toBe(1);
    expect(await count(db, "select count(*) from private.retired_customer_numbers")).toBe(1);
    const keptBefore = await kept(db);

    const notices: string[] = [];
    await db.exec(resetSql(), { onNotice: (n) => notices.push(n.message ?? "") });
    expect(notices).toContain(
      "Gewist: 7 klantdossiers en 3 logins zonder teamrol. Nieuwe klantcodes beginnen bij GR00100.",
    );

    for (const table of [
      "public.customers",
      "public.orders",
      "public.shipments",
      "public.shipment_status_history",
      "public.order_documents",
      "public.invoices",
      "public.invoice_items",
      "public.payments",
      "public.internal_notes",
      "public.staff_tasks",
      "public.email_logs",
      "public.job_runs",
      "public.invoice_number_counters",
      "private.order_reference_counters",
      "private.retired_customer_numbers",
    ]) {
      expect(await count(db, `select count(*) from ${table}`), table).toBe(0);
    }
    expect(await count(db, "select count(*) from public.invitations where kind = 'customer'")).toBe(
      0,
    );
    expect(
      await count(
        db,
        `select count(*) from public.audit_log
          where table_name not in ('company_settings', 'company_bank_accounts', 'warehouse_addresses',
                                   'service_rates', 'shipment_statuses', 'user_roles', 'team_login', 'invitations')
             or (table_name = 'invitations' and coalesce(new_data, old_data) ->> 'kind' <> 'staff')`,
      ),
    ).toBe(0);

    // Settings, team (also the deactivated member), staff invitations and their
    // audit rows are untouched; Storage is left to the dashboard (step 1).
    const keptAfter = await kept(db);
    const teamIds = [team.admin.id, team.staff.id, team.blockedStaff.id].sort().join(",");
    expect(keptAfter).toEqual({ ...keptBefore, logins: teamIds, profiles: teamIds });

    expect(await overview(db)).toEqual({
      klantdossiers: 0,
      "logins zonder teamrol (testklanten)": 0,
      orders: 0,
      zendingen: 0,
      facturen: 0,
      betalingen: 0,
      "e-maillogs": 0,
      auditregels: await count(db, "select count(*) from public.audit_log"),
      "bestanden in order-documents (stap 1)": 1,
      "teamleden (blijven)": 3,
      "volgend nieuw klantnummer": 100,
    });

    // The guards are back on: an issued invoice can never be deleted again.
    const { rows: guards } = await db.query<{ tgname: string; tgenabled: string }>(
      `select tgname, tgenabled from pg_trigger
        where tgname in ('payments_guard', 'invoices_guard', 'invoice_items_guard') order by 1`,
    );
    expect(guards).toEqual([
      { tgname: "invoice_items_guard", tgenabled: "O" },
      { tgname: "invoices_guard", tgenabled: "O" },
      { tgname: "payments_guard", tgenabled: "O" },
    ]);
  });

  it("starts numbering again and the app works on the empty database", async () => {
    const team = await fill(db);
    await db.exec(resetSql());

    // A file left in Storage is now an orphan; the daily run (service role) finds it.
    await asService(db, async (tx) => {
      const { rows } = await tx.query<{ name: string }>(
        "select name from public.orphan_order_document_objects()",
      );
      expect(rows).toHaveLength(1);
    });

    const customer = await createAuthUser(db, {
      email: "eerste.klant@example.com",
      meta: { full_name: "Eerste Klant", phone: "+597 8000001", terms_version: "1" },
    });
    const { rows } = await db.query<{ id: string; customer_code: string }>(
      "select id, customer_code from public.customers where user_id = $1",
      [customer.id],
    );
    expect(rows[0]?.customer_code).toBe("GR00100");

    const invoiceId = await asUser(
      db,
      team.staff.id,
      async (tx) => {
        // GR00555 was retired during testing; after the reset it is free again.
        const legacy = await tx.query<{ customer_code: string }>(
          "select (public.create_customer('Bestaande Klant', '+597 8000002', null, 'GR00555')).customer_code",
        );
        expect(legacy.rows[0]?.customer_code).toBe("GR00555");
        const order = await tx.query<{ id: string; reference: string }>(
          "insert into public.orders (customer_id, store_vendor) values ($1, 'eBay') returning id, reference",
          [rows[0]!.id],
        );
        expect(order.rows[0]?.reference).toMatch(/^ORD-\d{4}-00001$/);
        const inv = await tx.query<{ id: string }>(
          "insert into public.invoices (customer_id) values ($1) returning id",
          [rows[0]!.id],
        );
        await tx.query(
          `insert into public.invoice_items (invoice_id, order_id, line_type, description, weight_lbs, rate_per_lb, amount, vat_exempt)
           values ($1, $2, 'freight', 'Vracht', 1, 4.5, 4.5, false)`,
          [inv.rows[0]!.id, order.rows[0]!.id],
        );
        const issued = await tx.query<{ invoice_number: string }>(
          "select invoice_number from public.issue_invoice($1)",
          [inv.rows[0]!.id],
        );
        expect(issued.rows[0]?.invoice_number).toMatch(/^INV-\d{4}-0001$/);
        return inv.rows[0]!.id;
      },
      { commit: true },
    );
    // The guards are back: an issued invoice is never deleted.
    await expectSqlError(
      asUser(db, team.staff.id, (tx) =>
        tx.query("delete from public.invoices where id = $1", [invoiceId]),
      ),
      "55000",
    );

    // And the RLS check still passes on the reset database.
    const result = await db.exec(readFileSync(RLS_SCRIPT, "utf8"));
    expect(result.at(-1)?.rows).toEqual([{ resultaat: "ALLE RLS-CONTROLES GESLAAGD" }]);
  });

  it("changes nothing without the confirmation phrase", async () => {
    await fill(db);
    const before = await overview(db);
    await expectSqlError(db.exec(resetSql(PLACEHOLDER)), /Niets gewist: vervang/);
    expect(await overview(db)).toEqual(before);
  });

  it("changes nothing when no admin can sign in", async () => {
    const team = await fill(db);
    await db.query("update auth.users set banned_until = now() + interval '1 day' where id = $1", [
      team.admin.id,
    ]);
    const before = await overview(db);
    await expectSqlError(db.exec(resetSql()), /Niets gewist: er is geen beheerder/);
    expect(await overview(db)).toEqual(before);
  });
});
