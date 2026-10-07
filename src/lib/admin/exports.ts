import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  auditActionLabel,
  auditQuery,
  auditRangeInvalid,
  auditRecordLabel,
  auditTableLabel,
  type AuditEntry,
  type AuditFilters,
} from "@/lib/admin/audit";
import { allPages, customerDisplayName, loadPeopleNames } from "@/lib/admin/orders";
import { buildCsv, csvFileName, type CsvColumn } from "@/lib/csv";
import { t } from "@/lib/i18n";
import type { nl } from "@/lib/i18n/nl";

/**
 * "Exporteer CSV" (SPEC §35.15, admins): customers, orders, invoices with
 * their lines, payments and the audit log. Every file is built in the
 * browser from queries with the admin's own client, so RLS decides what is
 * in it (audit_log: admins only); nothing passes through a server function
 * and nothing is stored. A list page passes the ids its filters show, so the
 * file holds what is on screen; without ids it holds everything. The export
 * functions use the browser client unless a client is passed (tests).
 */

type Client = Pick<SupabaseClient<Database>, "from" | "rpc">;
type Tables = Database["public"]["Tables"];
type OverviewRow = Database["public"]["Views"]["invoice_overview"]["Row"];

export interface CsvExport {
  filename: string;
  csv: string;
  /** Data rows in the file (without the header). */
  rows: number;
}

/** A column header (or fixed cell text) of the export files, from nl.ts. */
const col = (key: keyof typeof nl.admin.exports.columns) => t(`admin.exports.columns.${key}`);

/**
 * The rows whose id is in `ids`, in the order of `ids` (the order the list
 * shows them in); every row, in query order, without `ids`.
 */
function only<T extends { id: string | null }>(rows: readonly T[], ids?: readonly string[]): T[] {
  if (!ids) return [...rows];
  const byId = new Map(rows.flatMap((r) => (r.id === null ? [] : [[r.id, r] as const])));
  return [...new Set(ids)].flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

/** Names of logins for "Geregistreerd door", "Wie" (team names, "Klant GR… · …"; see namePeople). */
export function loadPeople(
  db: Client,
  ids: readonly (string | null)[],
): Promise<ReadonlyMap<string, string | null>> {
  return loadPeopleNames(db, ids);
}

const personOf = (people: ReadonlyMap<string, string | null>, id: string | null) =>
  id ? (people.get(id) ?? id) : "";

type CustomerRef = Pick<
  Tables["customers"]["Row"],
  "id" | "customer_code" | "full_name" | "company_name" | "account_type"
>;

async function loadCustomerRefs(db: Client): Promise<Map<string, CustomerRef>> {
  const rows = await allPages<CustomerRef>((from, to) =>
    db
      .from("customers")
      .select("id, customer_code, full_name, company_name, account_type")
      .order("customer_number")
      .range(from, to),
  );
  return new Map(rows.map((c) => [c.id, c]));
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export type CustomerExportRow = Pick<
  Tables["customers"]["Row"],
  | "id"
  | "customer_code"
  | "full_name"
  | "company_name"
  | "account_type"
  | "status"
  | "email"
  | "phone"
  | "address"
  | "district"
  | "kkf_number"
  | "contact_person"
  | "user_id"
  | "created_at"
  | "disabled_at"
  | "disabled_reason"
  | "terms_accepted_at"
>;

export const CUSTOMER_EXPORT_COLUMNS: CsvColumn<CustomerExportRow>[] = [
  { header: col("grCode"), kind: "code", value: (c) => c.customer_code },
  { header: col("name"), value: (c) => c.full_name },
  { header: col("companyName"), value: (c) => c.company_name },
  {
    header: col("accountType"),
    value: (c) => t(`admin.customers.accountTypes.${c.account_type}`),
  },
  { header: col("status"), value: (c) => t(`admin.customers.statuses.${c.status}`) },
  { header: col("email"), value: (c) => c.email },
  { header: col("phone"), kind: "code", value: (c) => c.phone },
  { header: col("address"), value: (c) => c.address },
  { header: col("district"), value: (c) => c.district },
  { header: col("kkf"), kind: "code", value: (c) => c.kkf_number },
  { header: col("contactPerson"), value: (c) => c.contact_person },
  { header: col("login"), kind: "boolean", value: (c) => c.user_id !== null },
  { header: col("customerSince"), kind: "date", value: (c) => c.created_at },
  { header: col("termsAccepted"), kind: "date", value: (c) => c.terms_accepted_at },
  { header: col("disabledAt"), kind: "date", value: (c) => c.disabled_at },
  { header: col("disabledReason"), value: (c) => c.disabled_reason },
];

export async function loadCustomerExport(db: Client): Promise<CustomerExportRow[]> {
  return allPages<CustomerExportRow>((from, to) =>
    db
      .from("customers")
      .select(
        "id, customer_code, full_name, company_name, account_type, status, email, phone, address, district, kkf_number, contact_person, user_id, created_at, disabled_at, disabled_reason, terms_accepted_at",
      )
      .order("customer_number")
      .range(from, to),
  );
}

export async function exportCustomers(
  opts: { ids?: readonly string[]; today?: string } = {},
  db: Client = supabase,
): Promise<CsvExport> {
  const rows = only(await loadCustomerExport(db), opts.ids);
  return {
    filename: csvFileName("klanten", opts.today),
    csv: buildCsv(CUSTOMER_EXPORT_COLUMNS, rows),
    rows: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

type OrderRow = Tables["orders"]["Row"];

export type OrderExportRow = OrderRow & {
  customer: CustomerRef | null;
  shipment: { shipment_number: string } | null;
  /** The main order's reference for an extra package. */
  parentReference: string | null;
  statusLabel: string;
  stageLabel: string;
};

type StatusInfo = Pick<Tables["shipment_statuses"]["Row"], "code" | "label_nl" | "stage">;

export const ORDER_EXPORT_COLUMNS: CsvColumn<OrderExportRow>[] = [
  { header: col("reference"), kind: "code", value: (o) => o.reference },
  { header: col("grCode"), kind: "code", value: (o) => o.customer?.customer_code },
  { header: col("customer"), value: (o) => (o.customer ? customerDisplayName(o.customer) : "") },
  { header: col("orderType"), value: (o) => t(`portal.orderTypes.${o.order_type}`) },
  { header: col("serviceType"), value: (o) => t(`portal.serviceTypes.${o.service_type}`) },
  { header: col("status"), value: (o) => o.statusLabel },
  { header: col("stage"), value: (o) => o.stageLabel },
  { header: col("store"), value: (o) => o.store_vendor },
  { header: col("vendorOrderNumber"), kind: "code", value: (o) => o.vendor_order_number },
  { header: col("description"), value: (o) => o.description },
  { header: col("quantity"), kind: "integer", value: (o) => o.quantity },
  { header: col("estimatedValue"), kind: "decimal", value: (o) => o.estimated_value },
  {
    header: col("estimatedValueCurrency"),
    value: (o) => (o.estimated_value === null ? "" : o.estimated_value_currency),
  },
  { header: col("purchaseDate"), kind: "date", value: (o) => o.purchase_date },
  { header: col("expectedDelivery"), kind: "date", value: (o) => o.expected_delivery_date },
  { header: col("tracking"), kind: "code", value: (o) => o.tracking_number },
  { header: col("carrier"), value: (o) => o.carrier },
  { header: col("declaredWeight"), kind: "decimal", value: (o) => o.declared_weight_lbs },
  { header: col("measuredWeight"), kind: "decimal", value: (o) => o.measured_weight_lbs },
  { header: col("shipment"), kind: "code", value: (o) => o.shipment?.shipment_number },
  { header: col("parentOrder"), kind: "code", value: (o) => o.parentReference },
  { header: col("supplier"), value: (o) => o.supplier_name },
  { header: col("poNumber"), kind: "code", value: (o) => o.client_po_number },
  {
    header: col("purchaseMode"),
    value: (o) => (o.purchase_mode ? t(`portal.purchaseModes.${o.purchase_mode}`) : ""),
  },
  { header: col("customerNote"), value: (o) => o.customer_note },
  { header: col("registeredAt"), kind: "datetime", value: (o) => o.created_at },
  {
    header: col("registeredBy"),
    value: (o) =>
      o.created_by_role === "customer" ? col("registeredByCustomer") : col("registeredByStaff"),
  },
  { header: col("receivedAt"), kind: "datetime", value: (o) => o.received_at },
  { header: col("pickedUpAt"), kind: "datetime", value: (o) => o.picked_up_at },
  { header: col("pickedUpBy"), value: (o) => o.picked_up_by_name },
  {
    header: col("cancellationRequestedAt"),
    kind: "datetime",
    value: (o) => o.cancellation_requested_at,
  },
];

export async function loadOrderExport(db: Client): Promise<OrderExportRow[]> {
  const [orders, statuses] = await Promise.all([
    allPages<
      OrderRow & { customer: CustomerRef | null; shipment: { shipment_number: string } | null }
    >((from, to) =>
      db
        .from("orders")
        .select(
          "*, customer:customers(id, customer_code, full_name, company_name, account_type), shipment:shipments(shipment_number)",
        )
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    (async () => {
      const { data, error } = await db.from("shipment_statuses").select("code, label_nl, stage");
      if (error) throw error;
      return new Map((data ?? []).map((s: StatusInfo) => [s.code, s]));
    })(),
  ]);
  const references = new Map(orders.map((o) => [o.id, o.reference]));
  return orders.map((o) => {
    const status = statuses.get(o.status);
    return {
      ...o,
      parentReference: o.parent_order_id ? (references.get(o.parent_order_id) ?? null) : null,
      statusLabel: status?.label_nl ?? o.status,
      stageLabel: status ? t(`portal.stages.${status.stage}`) : "",
    };
  });
}

export async function exportOrders(
  opts: { ids?: readonly string[]; today?: string } = {},
  db: Client = supabase,
): Promise<CsvExport> {
  const rows = only(await loadOrderExport(db), opts.ids);
  return {
    filename: csvFileName("orders", opts.today),
    csv: buildCsv(ORDER_EXPORT_COLUMNS, rows),
    rows: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Invoices with their lines (one row per line)
// ---------------------------------------------------------------------------

export type InvoiceExportInvoice = Pick<
  OverviewRow,
  | "id"
  | "invoice_number"
  | "status"
  | "is_overdue"
  | "customer_id"
  | "currency"
  | "invoice_date"
  | "due_date"
  | "issued_at"
  | "total_lbs"
  | "subtotal_freight"
  | "total_charges"
  | "total_discount"
  | "vat_rate"
  | "vat_amount"
  | "total_amount"
  | "amount_paid"
  | "balance_due"
  | "paid_at"
  | "cancelled_at"
  | "cancel_reason"
  | "replaces_invoice_id"
  | "reminder_count"
  | "late_fee_applied_at"
  | "customer_note"
>;

export type InvoiceExportLine = Pick<
  Tables["invoice_items"]["Row"],
  | "invoice_id"
  | "sort_order"
  | "line_type"
  | "description"
  | "weight_lbs"
  | "rate_per_lb"
  | "amount"
  | "vat_exempt"
> & { order: { reference: string } | null };

export interface InvoiceExportRow {
  invoice: InvoiceExportInvoice;
  customer: CustomerRef | null;
  replacesNumber: string | null;
  /** 1-based position on the invoice; null for an invoice without lines. */
  lineNumber: number | null;
  line: InvoiceExportLine | null;
}

export const INVOICE_EXPORT_COLUMNS: CsvColumn<InvoiceExportRow>[] = [
  {
    header: col("invoiceNumber"),
    kind: "code",
    value: (r) => r.invoice.invoice_number ?? col("draft"),
  },
  {
    header: col("status"),
    value: (r) => (r.invoice.status ? t(`portal.invoiceStatus.${r.invoice.status}`) : ""),
  },
  { header: col("overdue"), kind: "boolean", value: (r) => r.invoice.is_overdue === true },
  { header: col("grCode"), kind: "code", value: (r) => r.customer?.customer_code },
  { header: col("customer"), value: (r) => (r.customer ? customerDisplayName(r.customer) : "") },
  { header: col("currency"), value: (r) => r.invoice.currency },
  { header: col("invoiceDate"), kind: "date", value: (r) => r.invoice.invoice_date },
  { header: col("dueDate"), kind: "date", value: (r) => r.invoice.due_date },
  { header: col("issuedAt"), kind: "datetime", value: (r) => r.invoice.issued_at },
  { header: col("totalLbs"), kind: "decimal", value: (r) => r.invoice.total_lbs },
  { header: col("freight"), kind: "decimal", value: (r) => r.invoice.subtotal_freight },
  { header: col("charges"), kind: "decimal", value: (r) => r.invoice.total_charges },
  { header: col("discount"), kind: "decimal", value: (r) => r.invoice.total_discount },
  { header: col("vatRate"), kind: "decimal", value: (r) => r.invoice.vat_rate },
  { header: col("vatAmount"), kind: "decimal", value: (r) => r.invoice.vat_amount },
  { header: col("total"), kind: "decimal", value: (r) => r.invoice.total_amount },
  { header: col("paid"), kind: "decimal", value: (r) => r.invoice.amount_paid },
  { header: col("balance"), kind: "decimal", value: (r) => r.invoice.balance_due },
  { header: col("paidOn"), kind: "date", value: (r) => r.invoice.paid_at },
  { header: col("cancelledAt"), kind: "date", value: (r) => r.invoice.cancelled_at },
  { header: col("cancelReason"), value: (r) => r.invoice.cancel_reason },
  { header: col("replaces"), kind: "code", value: (r) => r.replacesNumber },
  { header: col("reminders"), kind: "integer", value: (r) => r.invoice.reminder_count },
  { header: col("lateFeeAt"), kind: "date", value: (r) => r.invoice.late_fee_applied_at },
  { header: col("invoiceNote"), value: (r) => r.invoice.customer_note },
  { header: col("line"), kind: "integer", value: (r) => r.lineNumber },
  {
    header: col("lineType"),
    value: (r) => (r.line ? t(`admin.invoiceBuilder.lines.types.${r.line.line_type}`) : ""),
  },
  { header: col("lineDescription"), value: (r) => r.line?.description },
  { header: col("order"), kind: "code", value: (r) => r.line?.order?.reference },
  { header: col("weight"), kind: "decimal", value: (r) => r.line?.weight_lbs },
  { header: col("rate"), kind: "decimal", value: (r) => r.line?.rate_per_lb },
  { header: col("lineAmount"), kind: "decimal", value: (r) => r.line?.amount },
  { header: col("vatExempt"), kind: "boolean", value: (r) => r.line?.vat_exempt },
];

/** One row per invoice line, in invoice order then line order; an invoice without lines gets one row. */
export function invoiceExportRows(
  invoices: readonly InvoiceExportInvoice[],
  lines: readonly InvoiceExportLine[],
  customers: ReadonlyMap<string, CustomerRef>,
  /** Where "Vervangt factuur" looks up numbers: the replaced invoice may sit outside the selection. */
  allInvoices: readonly InvoiceExportInvoice[] = invoices,
): InvoiceExportRow[] {
  const byInvoice = new Map<string, InvoiceExportLine[]>();
  for (const line of lines) {
    byInvoice.set(line.invoice_id, [...(byInvoice.get(line.invoice_id) ?? []), line]);
  }
  const numbers = new Map(allInvoices.map((i) => [i.id, i.invoice_number]));
  return invoices.flatMap((invoice): InvoiceExportRow[] => {
    const base = {
      invoice,
      customer: invoice.customer_id ? (customers.get(invoice.customer_id) ?? null) : null,
      replacesNumber: invoice.replaces_invoice_id
        ? (numbers.get(invoice.replaces_invoice_id) ?? null)
        : null,
    };
    const own = [...(byInvoice.get(invoice.id ?? "") ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order,
    );
    if (own.length === 0) return [{ ...base, lineNumber: null, line: null }];
    return own.map((line, i) => ({ ...base, lineNumber: i + 1, line }));
  });
}

export async function exportInvoices(
  opts: { ids?: readonly string[]; today?: string } = {},
  db: Client = supabase,
): Promise<CsvExport> {
  const [all, lines, customers] = await Promise.all([
    allPages<InvoiceExportInvoice>((from, to) =>
      db
        .from("invoice_overview")
        .select(
          "id, invoice_number, status, is_overdue, customer_id, currency, invoice_date, due_date, issued_at, total_lbs, subtotal_freight, total_charges, total_discount, vat_rate, vat_amount, total_amount, amount_paid, balance_due, paid_at, cancelled_at, cancel_reason, replaces_invoice_id, reminder_count, late_fee_applied_at, customer_note",
        )
        .order("invoice_date", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    allPages<InvoiceExportLine>((from, to) =>
      db
        .from("invoice_items")
        .select(
          "invoice_id, sort_order, line_type, description, weight_lbs, rate_per_lb, amount, vat_exempt, order:orders(reference)",
        )
        .order("id")
        .range(from, to),
    ),
    loadCustomerRefs(db),
  ]);
  const rows = invoiceExportRows(only(all, opts.ids), lines, customers, all);
  return {
    filename: csvFileName("facturen-met-regels", opts.today),
    csv: buildCsv(INVOICE_EXPORT_COLUMNS, rows),
    rows: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export type PaymentExportRow = Tables["payments"]["Row"] & {
  invoice: { invoice_number: string | null; currency: string; customer_id: string } | null;
  customer: CustomerRef | null;
  recordedByName: string;
  voidedByName: string;
};

export const PAYMENT_EXPORT_COLUMNS: CsvColumn<PaymentExportRow>[] = [
  { header: col("invoiceNumber"), kind: "code", value: (p) => p.invoice?.invoice_number },
  { header: col("grCode"), kind: "code", value: (p) => p.customer?.customer_code },
  { header: col("customer"), value: (p) => (p.customer ? customerDisplayName(p.customer) : "") },
  { header: col("currency"), value: (p) => p.invoice?.currency },
  { header: col("amount"), kind: "decimal", value: (p) => p.amount },
  { header: col("paidOn"), kind: "date", value: (p) => p.paid_on },
  {
    header: col("method"),
    value: (p) => t(`admin.customers.detail.paymentMethods.${p.method}`),
  },
  { header: col("reference"), kind: "code", value: (p) => p.reference },
  { header: col("receivedAmount"), kind: "decimal", value: (p) => p.received_amount },
  { header: col("receivedCurrency"), value: (p) => p.received_currency },
  { header: col("paymentNote"), value: (p) => p.customer_note },
  { header: col("recordedAt"), kind: "datetime", value: (p) => p.created_at },
  { header: col("recordedBy"), value: (p) => p.recordedByName },
  { header: col("voided"), kind: "boolean", value: (p) => p.voided_at !== null },
  { header: col("voidedAt"), kind: "datetime", value: (p) => p.voided_at },
  { header: col("voidedBy"), value: (p) => p.voidedByName },
  { header: col("voidReason"), value: (p) => p.void_reason },
];

export async function loadPaymentExport(
  db: Client,
  opts: { invoiceIds?: readonly string[] } = {},
): Promise<PaymentExportRow[]> {
  type Loaded = Tables["payments"]["Row"] & {
    invoice: { invoice_number: string | null; currency: string; customer_id: string } | null;
  };
  const [payments, customers] = await Promise.all([
    allPages<Loaded>((from, to) =>
      db
        .from("payments")
        .select("*, invoice:invoices(invoice_number, currency, customer_id)")
        .order("paid_on", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    loadCustomerRefs(db),
  ]);
  const wanted = opts.invoiceIds ? new Set(opts.invoiceIds) : null;
  const chosen = wanted ? payments.filter((p) => wanted.has(p.invoice_id)) : payments;
  const people = await loadPeople(
    db,
    chosen.flatMap((p) => [p.recorded_by, p.voided_by]),
  );
  return chosen.map((p) => ({
    ...p,
    customer: p.invoice ? (customers.get(p.invoice.customer_id) ?? null) : null,
    recordedByName: personOf(people, p.recorded_by),
    voidedByName: personOf(people, p.voided_by),
  }));
}

export async function exportPayments(
  opts: { invoiceIds?: readonly string[]; today?: string } = {},
  db: Client = supabase,
): Promise<CsvExport> {
  const rows = await loadPaymentExport(db, opts);
  return {
    filename: csvFileName("betalingen", opts.today),
    csv: buildCsv(PAYMENT_EXPORT_COLUMNS, rows),
    rows: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export type AuditExportRow = AuditEntry & { actorName: string };

const json = (value: Json | null) => (value === null ? "" : JSON.stringify(value));

export const AUDIT_EXPORT_COLUMNS: CsvColumn<AuditExportRow>[] = [
  { header: col("occurredAt"), kind: "datetime", value: (a) => a.occurred_at },
  { header: col("actor"), value: (a) => a.actorName },
  { header: col("actorId"), value: (a) => a.actor_id },
  { header: col("table"), value: (a) => auditTableLabel(a.table_name) },
  { header: col("tableName"), value: (a) => a.table_name },
  { header: col("record"), value: (a) => auditRecordLabel(a) },
  { header: col("recordId"), kind: "code", value: (a) => a.record_id },
  { header: col("action"), value: (a) => auditActionLabel(a.action) },
  { header: col("changedColumns"), value: (a) => (a.changed_columns ?? []).join(", ") },
  { header: col("reason"), value: (a) => a.reason },
  { header: col("oldData"), value: (a) => json(a.old_data) },
  { header: col("newData"), value: (a) => json(a.new_data) },
];

/** Every audit row the filters match (all pages), newest first. */
export async function loadAuditExport(
  db: Client,
  filters: AuditFilters,
): Promise<AuditExportRow[]> {
  if (auditRangeInvalid(filters)) return [];
  const rows = await allPages<AuditEntry>((from, to) => auditQuery(db, filters).range(from, to));
  const people = await loadPeople(
    db,
    rows.map((r) => r.actor_id),
  );
  return rows.map((r) => ({
    ...r,
    actorName: r.actor_id ? (people.get(r.actor_id) ?? r.actor_id) : t("admin.audit.system"),
  }));
}

export async function exportAudit(
  opts: { filters: AuditFilters; today?: string },
  db: Client = supabase,
): Promise<CsvExport> {
  const rows = await loadAuditExport(db, opts.filters);
  return {
    filename: csvFileName("auditlog", opts.today),
    csv: buildCsv(AUDIT_EXPORT_COLUMNS, rows),
    rows: rows.length,
  };
}
