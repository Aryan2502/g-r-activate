// @vitest-environment node
/**
 * P9 against the real migrations, with the app's own loaders and each
 * person's own client (supabase-standin.ts: every request its own committed
 * transaction as `authenticated`), so RLS and the RPC guards decide:
 *
 * - /portal/historie (lib/portal/history.ts): a customer's records and the
 *   per-year counts of customer_history_by_year agree, and nothing of another
 *   customer appears; asking the RPC for someone else's id is refused;
 * - /admin/audit (lib/admin/audit.ts): admins read audit_log with the
 *   filters applied in the database; staff read nothing;
 * - "Exporteer CSV" (lib/admin/exports.ts): every file is built from what the
 *   reader may see, in Dutch Excel format.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The modules create the browser client on import; every call here passes a client.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { loadAuditPage } from "@/lib/admin/audit";
import {
  exportAudit,
  exportCustomers,
  exportInvoices,
  exportOrders,
  exportPayments,
} from "@/lib/admin/exports";
import {
  addOrder,
  initialBuilderState,
  loadBuilderOrders,
  saveDraft,
  type BuilderState,
} from "@/lib/admin/invoice-builder";
import type { ServiceRate } from "@/lib/admin/settings";
import { CSV_BOM } from "@/lib/csv";
import { todayInSuriname } from "@/lib/format";
import {
  buildHistoryRecords,
  loadHistorySources,
  loadYearSummaries,
  type HistoryRecord,
} from "@/lib/portal/history";

import { type AuthUser, type Db, createAuthUser, createDb } from "./harness";
import { userClient } from "./supabase-standin";

type Client = ReturnType<typeof userClient>;
type HistoryClient = Parameters<typeof loadHistorySources>[0];
type AppClient = Parameters<typeof saveDraft>[0];
type ExportClient = NonNullable<Parameters<typeof exportOrders>[1]>;

let db: Db;
let staff: AuthUser;
let admin: AuthUser;
let alice: AuthUser;
let bob: AuthUser;
let aliceCustomer: string;
let bobCustomer: string;
let aliceOrders: string[] = [];
let bobOrder: string;
let invoiceId: string;
let invoiceNumber: string;
let draftId: string;
const TODAY = todayInSuriname();

const as = (user: AuthUser): Client => userClient(db, user.id);
const hist = (c: Client) => c as unknown as HistoryClient;
const exp = (c: Client) => c as unknown as ExportClient;

async function rpc(user: AuthUser, name: string, args: Record<string, unknown>) {
  const { data, error } = await as(user).rpc(name, args);
  if (error) throw new Error(`${name}: ${JSON.stringify(error)}`);
  return data;
}

async function newOrder(customerId: string, tracking: string) {
  const r = await db.query<{ id: string }>(
    `insert into public.orders (customer_id, description, store_vendor, vendor_order_number, tracking_number)
     values ($1, 'Sportschoenen', 'Amazon', '112-0000001', $2) returning id`,
    [customerId, tracking],
  );
  return r.rows[0]!.id;
}

/** The data rows of a CSV as header → value records. */
function parseCsv(csv: string): Record<string, string>[] {
  expect(csv.startsWith(CSV_BOM)).toBe(true);
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  const body = csv.slice(CSV_BOM.length);
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ";") {
      row.push(cur);
      cur = "";
    } else if (ch === "\r" && body[i + 1] === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      i += 1;
    } else cur += ch;
  }
  const [header = [], ...data] = rows;
  for (const r of data) expect(r).toHaveLength(header.length);
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

beforeAll(async () => {
  db = await createDb();
  staff = await createAuthUser(db, {
    email: "staff@example.com",
    meta: { full_name: "Sam Staff" },
  });
  admin = await createAuthUser(db, {
    email: "admin@example.com",
    meta: { full_name: "Ada Admin" },
  });
  await db.query(
    "insert into public.user_roles (user_id, role) values ($1, 'staff'), ($2, 'admin')",
    [staff.id, admin.id],
  );
  await db.query(
    `update public.customers set user_id = null, status = 'disabled', disabled_reason = 'team login'
      where user_id = any($1)`,
    [[staff.id, admin.id]],
  );
  await db.query("update public.profiles set display_name = 'Ada Admin' where id = $1", [admin.id]);
  await db.query("update public.profiles set display_name = 'Sam Staff' where id = $1", [staff.id]);
  alice = await createAuthUser(db, {
    email: "alice@example.com",
    meta: { full_name: "Alice Jansen", phone: "+597 8000001" },
  });
  bob = await createAuthUser(db, {
    email: "bob@example.com",
    meta: { full_name: "Bob Bakker", phone: "+597 8000002" },
  });
  const ids = await db.query<{ id: string; user_id: string }>(
    "select id, user_id from public.customers where user_id = any($1)",
    [[alice.id, bob.id]],
  );
  aliceCustomer = ids.rows.find((r) => r.user_id === alice.id)!.id;
  bobCustomer = ids.rows.find((r) => r.user_id === bob.id)!.id;
  await db.query(
    "update public.service_rates set rate_per_lb = 4.5, weight_rounding = '0.5', minimum_billable_lbs = 1 where service_type = 'air'",
  );
  await db.query(
    "update public.company_bank_accounts set bank_name = 'DSB', account_holder = 'G&R Solutions N.V.', account_number = '1234567' where currency = 'USD' and is_active",
  );

  // Alice: two orders in one shipment, received and on their way; Bob: one order.
  aliceOrders = [
    await newOrder(aliceCustomer, "9400111899223397658538"),
    await newOrder(aliceCustomer, "1Z999AA10123456784"),
  ];
  bobOrder = await newOrder(bobCustomer, "BOB-TRACK-1");
  for (const id of aliceOrders) {
    await rpc(staff, "receive_order", { _order_id: id, _measured_weight_lbs: 2.2 });
  }
  await rpc(staff, "receive_order", { _order_id: bobOrder, _measured_weight_lbs: 1 });
  const shipment = await db.query<{ id: string }>(
    "insert into public.shipments (shipment_number, service_type, departed_at) values ('SH-2026-001', 'air', now()) returning id",
  );
  await db.query("update public.orders set shipment_id = $1 where id = any($2)", [
    shipment.rows[0]!.id,
    aliceOrders,
  ]);
  await rpc(staff, "change_order_status", {
    _order_ids: aliceOrders,
    _to_status: "in_transit",
    _customer_message: "Vertrokken met de vlucht van dinsdag",
  });

  // Alice: one issued invoice (built and saved by the builder) with a payment.
  const rates = (await db.query<ServiceRate>("select * from public.service_rates")).rows.map(
    (r) => ({
      ...r,
      rate_per_lb: r.rate_per_lb === null ? null : Number(r.rate_per_lb),
      minimum_billable_lbs: r.minimum_billable_lbs === null ? null : Number(r.minimum_billable_lbs),
    }),
  );
  const staffApp = as(staff) as unknown as AppClient;
  const builderOrders = await loadBuilderOrders(staffApp, aliceCustomer);
  let state: BuilderState = initialBuilderState({
    customerId: aliceCustomer,
    currency: "USD",
    paymentTermDays: 7,
    today: TODAY,
    replacesInvoiceId: null,
  });
  for (const id of aliceOrders) {
    state = addOrder(
      state,
      builderOrders.find((o) => o.id === id)!,
      rates,
    );
  }
  invoiceId = (await saveDraft(staffApp, null, state)).invoiceId;
  const issued = (await rpc(staff, "issue_invoice", { _invoice_id: invoiceId })) as {
    invoice_number: string;
  };
  invoiceNumber = issued.invoice_number;
  await rpc(staff, "record_payment", {
    _invoice_id: invoiceId,
    _amount: 10,
    _paid_on: TODAY,
    _method: "cash",
    _reference: "00042",
  });
  // A draft for Alice that she must never see.
  draftId = (
    await db.query<{ id: string }>(
      "insert into public.invoices (customer_id, currency, invoice_date, due_date) values ($1, 'USD', $2, $2) returning id",
      [aliceCustomer, TODAY],
    )
  ).rows[0]!.id;

  // An admin edits Bob's phone number: an audit row with the admin as actor.
  const { error } = await as(admin)
    .from("customers")
    .update({ phone: "+597 8000003" })
    .eq("id", bobCustomer);
  if (error) throw new Error(JSON.stringify(error));
});

afterAll(async () => {
  await db?.close();
});

// ---------------------------------------------------------------------------

describe("/portal/historie", () => {
  let records: HistoryRecord[];

  it("shows the customer every own record and nothing of anyone else", async () => {
    records = buildHistoryRecords(await loadHistorySources(hist(as(alice)), aliceCustomer));
    const count = (type: HistoryRecord["type"]) => records.filter((r) => r.type === type).length;
    expect(count("orders")).toBe(2);
    expect(count("shipments")).toBe(1);
    expect(count("invoices")).toBe(1);
    expect(count("payments")).toBe(1);
    // Received (2×) and "Onderweg naar Suriname" (2×): customer_visible statuses only.
    expect(count("status")).toBe(4);
    expect(
      records
        .filter((r) => r.type === "orders")
        .map((r) => r.orderId)
        .sort(),
    ).toEqual([...aliceOrders].sort());
    expect(records.some((r) => r.type === "orders" && r.orderId === bobOrder)).toBe(false);
    expect(records.some((r) => r.key === `i:${draftId}`)).toBe(false);
    const shipment = records.find((r) => r.type === "shipments");
    expect(shipment).toMatchObject({ shipmentNumber: "SH-2026-001" });
    expect(shipment?.type === "shipments" ? shipment.orders.length : 0).toBe(2);
    expect(records.find((r) => r.type === "invoices")).toMatchObject({
      invoiceNumber,
      status: "partially_paid",
    });
    expect(records.find((r) => r.type === "status" && r.message !== null)).toMatchObject({
      toStatus: "in_transit",
      message: "Vertrokken met de vlucht van dinsdag",
    });
  });

  it("agrees with the per-year counts of customer_history_by_year", async () => {
    const years = await loadYearSummaries(hist(as(alice)), aliceCustomer);
    const year = Number(TODAY.slice(0, 4));
    expect(years).toEqual([{ year, orders: 2, shipments: 1, invoices: 1, payments: 1 }]);
    const inYear = records.filter((r) => r.year === year);
    expect(inYear.filter((r) => r.type === "orders")).toHaveLength(years[0]!.orders);
    expect(inYear.filter((r) => r.type === "shipments")).toHaveLength(years[0]!.shipments);
    expect(inYear.filter((r) => r.type === "invoices")).toHaveLength(years[0]!.invoices);
    expect(inYear.filter((r) => r.type === "payments")).toHaveLength(years[0]!.payments);
  });

  it("gives Bob only his own order, and refuses Alice's counts to him", async () => {
    const bobRecords = buildHistoryRecords(await loadHistorySources(hist(as(bob)), bobCustomer));
    expect(bobRecords.filter((r) => r.type === "orders").map((r) => r.key)).toEqual([
      `o:${bobOrder}`,
    ]);
    expect(bobRecords.some((r) => r.type === "invoices" || r.type === "shipments")).toBe(false);
    // Asking for Alice's id with Bob's login returns nothing of hers.
    const peek = buildHistoryRecords(await loadHistorySources(hist(as(bob)), aliceCustomer));
    expect(peek).toEqual([]);
    await expect(loadYearSummaries(hist(as(bob)), aliceCustomer)).rejects.toMatchObject({
      code: "42501",
    });
  });
});

describe("/admin/audit", () => {
  it("lets an admin filter the log in the database (table, who, day, record)", async () => {
    const page = await loadAuditPage(
      exp(as(admin)),
      { table: "customers", actor: admin.id, from: TODAY, to: TODAY },
      1,
    );
    expect(page.hasMore).toBe(false);
    // The fixtures touched the admin's own (disabled) customer row too.
    expect(page.entries.length).toBeGreaterThan(0);
    expect(page.entries.every((e) => e.table_name === "customers" && e.actor_id === admin.id)).toBe(
      true,
    );
    const phone = page.entries.find((e) => e.record_id === bobCustomer);
    expect(phone).toMatchObject({ action: "UPDATE" });
    expect(phone!.changed_columns).toContain("phone");

    const exact = await loadAuditPage(
      exp(as(admin)),
      { table: "customers", actor: admin.id, record: bobCustomer },
      1,
    );
    expect(exact.entries.map((e) => e.id)).toEqual([phone!.id]);
    // A day range before today matches nothing.
    const yesterday = new Date(Date.parse(`${TODAY}T12:00:00Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(
      (await loadAuditPage(exp(as(admin)), { record: bobCustomer, to: yesterday }, 1)).entries,
    ).toEqual([]);

    const byRecord = await loadAuditPage(exp(as(admin)), { record: invoiceId }, 1);
    expect(byRecord.entries.length).toBeGreaterThan(0);
    expect(byRecord.entries.every((e) => e.record_id === invoiceId)).toBe(true);
    // Newest first.
    const times = byRecord.entries.map((e) => Date.parse(e.occurred_at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("shows staff nothing (audit_log is admin-read only)", async () => {
    const page = await loadAuditPage(exp(as(staff)), {}, 1);
    expect(page).toEqual({ entries: [], hasMore: false });
  });
});

describe("Exporteer CSV", () => {
  it("exports customers, orders, invoices with lines and payments for an admin", async () => {
    const customers = parseCsv(
      (await exportCustomers({ ids: [aliceCustomer, bobCustomer] }, exp(as(admin)))).csv,
    );
    expect(customers.map((c) => c["Naam"])).toEqual(["Alice Jansen", "Bob Bakker"]);
    expect(customers[1]).toMatchObject({ Telefoon: '="+597 8000003"', Login: "ja" });

    const orders = parseCsv((await exportOrders({}, exp(as(admin)))).csv);
    const aliceRows = orders.filter((o) => o["Klant"] === "Alice Jansen");
    expect(aliceRows).toHaveLength(2);
    expect(aliceRows.map((o) => o["Trackingnummer"]).sort()).toEqual([
      "1Z999AA10123456784",
      '="9400111899223397658538"',
    ]);
    expect(aliceRows[0]).toMatchObject({
      Status: "Onderweg naar Suriname",
      Zending: "SH-2026-001",
      "Gemeten gewicht (lbs)": "2,20",
      Verzendwijze: "Luchtvracht",
    });

    // Staff see drafts: without ids the draft is in the file, as "Concept".
    const all = parseCsv((await exportInvoices({}, exp(as(admin)))).csv);
    expect(all.some((r) => r["Factuurnummer"] === "Concept" && r["Status"] === "Concept")).toBe(
      true,
    );
    const invoices = parseCsv((await exportInvoices({ ids: [invoiceId] }, exp(as(admin)))).csv);
    expect(invoices).toHaveLength(2); // one row per freight line
    expect(invoices.map((r) => r["Regel"])).toEqual(["1", "2"]);
    expect(invoices[0]).toMatchObject({
      Factuurnummer: invoiceNumber,
      Status: "Deels betaald",
      Betaald: "10,00",
      "Soort regel": "Vracht",
      "Tarief per lb": "4,50",
    });

    const payments = parseCsv(
      (await exportPayments({ invoiceIds: [invoiceId] }, exp(as(admin)))).csv,
    );
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      Factuurnummer: invoiceNumber,
      Bedrag: "10,00",
      Betaalwijze: "Contant",
      Referentie: '="00042"',
      "Geregistreerd door": "Sam Staff",
      "Ongedaan gemaakt": "nee",
    });
  });

  it("exports the audit log with the page's filters, and nothing for staff", async () => {
    const file = await exportAudit(
      { filters: { table: "customers", actor: admin.id, record: bobCustomer }, today: TODAY },
      exp(as(admin)),
    );
    expect(file.filename).toBe(`gr-auditlog-${TODAY}.csv`);
    const rows = parseCsv(file.csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      Wie: "Ada Admin",
      Tabel: "Klanten",
      Actie: "Gewijzigd",
      "Record-id": bobCustomer,
    });
    expect(JSON.parse(rows[0]!["Nieuwe waarden (JSON)"] ?? "{}")).toMatchObject({
      phone: "+597 8000003",
    });

    const none = await exportAudit({ filters: {} }, exp(as(staff)));
    expect(none.rows).toBe(0);
    expect(parseCsv(none.csv)).toEqual([]);
  });

  it("gives a customer's login nothing it may not read", async () => {
    // RLS, not the app, decides: Alice's own client sees only her own rows.
    const orders = parseCsv((await exportOrders({}, exp(as(alice)))).csv);
    expect(orders.every((o) => o["Klant"] === "Alice Jansen")).toBe(true);
    const audit = await exportAudit({ filters: {} }, exp(as(alice)));
    expect(audit.rows).toBe(0);
  });
});
