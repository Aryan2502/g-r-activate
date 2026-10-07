import { queryOptions } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { allPages, fold, normalizeTracking, searchText } from "@/lib/admin/orders";
import { todayInSuriname, type CurrencyCode } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { StatusMap } from "@/lib/portal/orders";

/**
 * /portal/historie (SPEC §20): everything the customer did with G&R, per
 * year. The per-year counts come from the database (customer_history_by_year,
 * SPEC §35.15); the records are what the customer may read (RLS), each query
 * also filtered on the customer explicitly (RLS shows staff every row, see
 * portal/orders.ts). Years follow the RPC: orders by registration, shipments
 * by departure (else creation), invoices by invoice date, payments by the
 * day paid, status changes by when they happened, all in Suriname time.
 * Drafts and voided payments never appear.
 */

type Client = Pick<SupabaseClient<Database>, "from" | "rpc">;
type Tables = Database["public"]["Tables"];
type InvoiceStatus = Database["public"]["Enums"]["invoice_status"];
type ServiceType = Database["public"]["Enums"]["service_type"];
type OrderType = Database["public"]["Enums"]["order_type"];
type PaymentMethod = Database["public"]["Enums"]["payment_method"];

export const HISTORY_TYPES = ["orders", "shipments", "invoices", "payments", "status"] as const;
export type HistoryType = (typeof HISTORY_TYPES)[number];

interface RecordBase {
  key: string;
  /** Sorts the list (an instant; a date counts as noon in Suriname). */
  at: string;
  year: number;
}

export interface OrderRecord extends RecordBase {
  type: "orders";
  orderId: string;
  reference: string;
  orderType: OrderType;
  status: string;
  storeVendor: string | null;
  description: string | null;
  trackingNumber: string | null;
}

export interface ShipmentRecord extends RecordBase {
  type: "shipments";
  shipmentId: string;
  shipmentNumber: string;
  serviceType: ServiceType;
  carrier: string | null;
  awb: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  /** The customer's own orders in it (links to their pages). */
  orders: { id: string; reference: string }[];
}

export interface InvoiceRecord extends RecordBase {
  type: "invoices";
  invoiceId: string;
  invoiceNumber: string | null;
  status: InvoiceStatus | null;
  isOverdue: boolean | null;
  invoiceDate: string;
  dueDate: string | null;
  total: number | null;
  balance: number | null;
  currency: CurrencyCode | null;
}

export interface PaymentRecord extends RecordBase {
  type: "payments";
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  amount: number;
  currency: CurrencyCode | null;
  paidOn: string;
  method: PaymentMethod;
}

export interface StatusRecord extends RecordBase {
  type: "status";
  historyId: number;
  orderId: string;
  reference: string | null;
  toStatus: string;
  message: string | null;
}

export type HistoryRecord =
  OrderRecord | ShipmentRecord | InvoiceRecord | PaymentRecord | StatusRecord;

export interface YearSummary {
  year: number;
  orders: number;
  shipments: number;
  invoices: number;
  payments: number;
}

/** What the queries return (shapes as PostgREST sends them). */
export interface HistorySources {
  orders: readonly (Pick<
    Tables["orders"]["Row"],
    | "id"
    | "reference"
    | "order_type"
    | "status"
    | "store_vendor"
    | "description"
    | "tracking_number"
    | "created_at"
  > & {
    shipment: Pick<
      Tables["shipments"]["Row"],
      | "id"
      | "shipment_number"
      | "service_type"
      | "carrier"
      | "awb_or_container_number"
      | "departed_at"
      | "arrived_at"
      | "created_at"
    > | null;
  })[];
  history: readonly Pick<
    Tables["shipment_status_history"]["Row"],
    "id" | "order_id" | "to_status" | "changed_at" | "customer_message"
  >[];
  invoices: readonly {
    id: string | null;
    invoice_number: string | null;
    status: InvoiceStatus | null;
    is_overdue: boolean | null;
    invoice_date: string | null;
    due_date: string | null;
    total_amount: number | null;
    balance_due: number | null;
    currency: CurrencyCode | null;
  }[];
  payments: readonly (Pick<
    Tables["payments"]["Row"],
    "id" | "invoice_id" | "amount" | "paid_on" | "method" | "voided_at"
  > & { invoice: { invoice_number: string | null; currency: CurrencyCode } | null })[];
}

/** The Suriname year of an instant, or of a 'YYYY-MM-DD' date as written. */
export function surinameYear(value: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number(value.slice(0, 4));
  return Number(todayInSuriname(new Date(value)).slice(0, 4));
}

/** A date sorts as noon in Suriname (15:00 UTC), between that day's events. */
const dateInstant = (date: string) => `${date}T15:00:00.000Z`;

/** Every record, newest first; ties keep a stable order by key. */
export function buildHistoryRecords(sources: HistorySources): HistoryRecord[] {
  const records: HistoryRecord[] = [];
  const references = new Map(sources.orders.map((o) => [o.id, o.reference]));
  const shipments = new Map<string, ShipmentRecord>();

  for (const o of sources.orders) {
    records.push({
      type: "orders",
      key: `o:${o.id}`,
      at: o.created_at,
      year: surinameYear(o.created_at),
      orderId: o.id,
      reference: o.reference,
      orderType: o.order_type,
      status: o.status,
      storeVendor: o.store_vendor,
      description: o.description,
      trackingNumber: o.tracking_number,
    });
    const s = o.shipment;
    if (!s) continue;
    const existing = shipments.get(s.id);
    if (existing) {
      existing.orders.push({ id: o.id, reference: o.reference });
      continue;
    }
    const when = s.departed_at ?? s.created_at;
    shipments.set(s.id, {
      type: "shipments",
      key: `s:${s.id}`,
      at: when,
      year: surinameYear(when),
      shipmentId: s.id,
      shipmentNumber: s.shipment_number,
      serviceType: s.service_type,
      carrier: s.carrier,
      awb: s.awb_or_container_number,
      departedAt: s.departed_at,
      arrivedAt: s.arrived_at,
      orders: [{ id: o.id, reference: o.reference }],
    });
  }
  for (const s of shipments.values()) {
    s.orders.sort((a, b) => a.reference.localeCompare(b.reference));
    records.push(s);
  }

  for (const h of sources.history) {
    records.push({
      type: "status",
      key: `h:${h.id}`,
      at: h.changed_at,
      year: surinameYear(h.changed_at),
      historyId: h.id,
      orderId: h.order_id,
      reference: references.get(h.order_id) ?? null,
      toStatus: h.to_status,
      message: h.customer_message?.trim() || null,
    });
  }

  for (const i of sources.invoices) {
    if (!i.id || !i.invoice_date || i.status === "draft") continue;
    records.push({
      type: "invoices",
      key: `i:${i.id}`,
      at: dateInstant(i.invoice_date),
      year: surinameYear(i.invoice_date),
      invoiceId: i.id,
      invoiceNumber: i.invoice_number,
      status: i.status,
      isOverdue: i.is_overdue,
      invoiceDate: i.invoice_date,
      dueDate: i.due_date,
      total: i.total_amount,
      balance: i.balance_due,
      currency: i.currency,
    });
  }

  for (const p of sources.payments) {
    if (p.voided_at) continue;
    records.push({
      type: "payments",
      key: `p:${p.id}`,
      at: dateInstant(p.paid_on),
      year: surinameYear(p.paid_on),
      paymentId: p.id,
      invoiceId: p.invoice_id,
      invoiceNumber: p.invoice?.invoice_number ?? null,
      amount: p.amount,
      currency: p.invoice?.currency ?? null,
      paidOn: p.paid_on,
      method: p.method,
    });
  }

  return records.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// Search and filters (in the URL)
// ---------------------------------------------------------------------------

export const historySearchSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2999).optional().catch(undefined),
  type: z.enum(HISTORY_TYPES).optional().catch(undefined),
  q: searchText,
});
export type HistorySearch = z.infer<typeof historySearchSchema>;

export function hasHistoryFilters(search: HistorySearch): boolean {
  return Boolean(search.year || search.type || search.q);
}

/** The words a record is found by (references, numbers, store, status, …). */
function searchableText(record: HistoryRecord, statuses: StatusMap): (string | null)[] {
  switch (record.type) {
    case "orders":
      return [
        record.reference,
        record.storeVendor,
        record.description,
        record.trackingNumber,
        statuses.get(record.status)?.label_nl ?? null,
      ];
    case "shipments":
      return [
        record.shipmentNumber,
        record.carrier,
        record.awb,
        t(`portal.serviceTypes.${record.serviceType}`),
        ...record.orders.map((o) => o.reference),
      ];
    case "invoices":
      return [record.invoiceNumber];
    case "payments":
      return [record.invoiceNumber];
    case "status":
      return [record.reference, statuses.get(record.toStatus)?.label_nl ?? null, record.message];
  }
}

/** Case- and accent-insensitive; numbers also without their dashes or spaces. */
export function matchesHistorySearch(
  record: HistoryRecord,
  query: string,
  statuses: StatusMap,
): boolean {
  const q = query.trim();
  if (!q) return true;
  const fields = searchableText(record, statuses);
  const needle = fold(q);
  if (fields.some((f) => (f ? fold(f).includes(needle) : false))) return true;
  const compact = normalizeTracking(q);
  return (
    compact.length >= 3 && fields.some((f) => (f ? normalizeTracking(f).includes(compact) : false))
  );
}

export function filterHistory(
  records: readonly HistoryRecord[],
  search: HistorySearch,
  statuses: StatusMap,
): HistoryRecord[] {
  return records.filter(
    (r) =>
      (!search.year || r.year === search.year) &&
      (!search.type || r.type === search.type) &&
      (!search.q || matchesHistorySearch(r, search.q, statuses)),
  );
}

/** Records grouped by year, newest year first (the list's headings). */
export function groupByYear(records: readonly HistoryRecord[]): [number, HistoryRecord[]][] {
  const groups = new Map<number, HistoryRecord[]>();
  for (const r of records) groups.set(r.year, [...(groups.get(r.year) ?? []), r]);
  return [...groups].sort((a, b) => b[0] - a[0]);
}

/**
 * The years to choose from: those the database counted plus any year that
 * only has status changes (the RPC does not count those), newest first.
 */
export function historyYears(
  summaries: readonly YearSummary[],
  records: readonly HistoryRecord[],
): number[] {
  return [...new Set([...summaries.map((s) => s.year), ...records.map((r) => r.year)])].sort(
    (a, b) => b - a,
  );
}

/** "12 orders, 8 zendingen, 7 facturen, 3 betalingen" (zero counts left out). */
export function yearSummaryText(summary: YearSummary): string {
  const parts: string[] = [];
  if (summary.orders > 0) {
    parts.push(
      summary.orders === 1
        ? t("portal.history.counts.ordersOne")
        : t("portal.history.counts.orders", { count: summary.orders }),
    );
  }
  if (summary.shipments > 0) {
    parts.push(
      summary.shipments === 1
        ? t("portal.history.counts.shipmentsOne")
        : t("portal.history.counts.shipments", { count: summary.shipments }),
    );
  }
  if (summary.invoices > 0) {
    parts.push(
      summary.invoices === 1
        ? t("portal.history.counts.invoicesOne")
        : t("portal.history.counts.invoices", { count: summary.invoices }),
    );
  }
  if (summary.payments > 0) {
    parts.push(
      summary.payments === 1
        ? t("portal.history.counts.paymentsOne")
        : t("portal.history.counts.payments", { count: summary.payments }),
    );
  }
  return parts.length > 0 ? parts.join(", ") : t("portal.history.counts.none");
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const ID_CHUNK = 100;

async function inChunks<T>(
  ids: readonly string[],
  load: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await load(ids.slice(i, i + ID_CHUNK));
    if (error) throw error;
    out.push(...(data ?? []));
  }
  return out;
}

const yearRowSchema = z.object({
  year: z.coerce.number().int(),
  order_count: z.coerce.number(),
  shipment_count: z.coerce.number(),
  invoice_count: z.coerce.number(),
  payment_count: z.coerce.number(),
});

/** Per-year counts from customer_history_by_year (SPEC §35.15), newest year first. */
export async function loadYearSummaries(db: Client, customerId: string): Promise<YearSummary[]> {
  const { data, error } = await db.rpc("customer_history_by_year", { _customer_id: customerId });
  if (error) throw error;
  return z
    .array(yearRowSchema)
    .parse(data ?? [])
    .map((r) => ({
      year: r.year,
      orders: r.order_count,
      shipments: r.shipment_count,
      invoices: r.invoice_count,
      payments: r.payment_count,
    }))
    .sort((a, b) => b.year - a.year);
}

/**
 * Everything of one customer: orders (with their shipment), the status
 * history and payments of those orders and invoices (by id, so no row of
 * another customer can slip in), and the issued invoices.
 */
export async function loadHistorySources(db: Client, customerId: string): Promise<HistorySources> {
  const [orders, invoices] = await Promise.all([
    allPages<HistorySources["orders"][number]>((from, to) =>
      db
        .from("orders")
        .select(
          "id, reference, order_type, status, store_vendor, description, tracking_number, created_at, shipment:shipments(id, shipment_number, service_type, carrier, awb_or_container_number, departed_at, arrived_at, created_at)",
        )
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    allPages<HistorySources["invoices"][number]>((from, to) =>
      db
        .from("invoice_overview")
        .select(
          "id, invoice_number, status, is_overdue, invoice_date, due_date, total_amount, balance_due, currency",
        )
        .eq("customer_id", customerId)
        .neq("status", "draft")
        .order("invoice_date", { ascending: false })
        .order("id")
        .range(from, to),
    ),
  ]);
  const orderIds = orders.map((o) => o.id);
  const invoiceIds = invoices.flatMap((i) => (i.id ? [i.id] : []));
  const [history, payments] = await Promise.all([
    inChunks<HistorySources["history"][number]>(orderIds, (chunk) =>
      db
        .from("shipment_status_history")
        .select("id, order_id, to_status, changed_at, customer_message")
        .in("order_id", chunk)
        .order("changed_at")
        .order("id"),
    ),
    inChunks<HistorySources["payments"][number]>(invoiceIds, (chunk) =>
      db
        .from("payments")
        .select(
          "id, invoice_id, amount, paid_on, method, voided_at, invoice:invoices(invoice_number, currency)",
        )
        .in("invoice_id", chunk)
        .is("voided_at", null)
        .order("paid_on")
        .order("id"),
    ),
  ]);
  return { orders, history, invoices, payments };
}

export interface CustomerHistory {
  records: HistoryRecord[];
  years: YearSummary[];
}

export const historyQueryOptions = (userId: string, customerId: string) =>
  queryOptions({
    // Under "orders" so a change to an order refreshes it; an object segment,
    // so no order id from a URL can ever share this key (portalKeys.order).
    queryKey: ["portal", userId, "orders", { view: "history", customerId }] as const,
    staleTime: 30_000,
    queryFn: async (): Promise<CustomerHistory> => {
      const [sources, years] = await Promise.all([
        loadHistorySources(supabase, customerId),
        loadYearSummaries(supabase, customerId),
      ]);
      return { records: buildHistoryRecords(sources), years };
    },
  });
