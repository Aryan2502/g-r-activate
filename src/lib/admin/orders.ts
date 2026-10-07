import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { Constants, type Database } from "@/integrations/supabase/types";
import { adminKeys } from "@/lib/admin/keys";
import { t } from "@/lib/i18n";
import { isAwaitingReceipt, type AdminStatusMap } from "@/lib/admin/statuses";
import {
  OPEN_INVOICE_STATUSES,
  needsPayment,
  unpaidByCurrency,
  type CurrencyAmount,
} from "@/lib/portal/invoices";
import {
  ORDER_STAGE_FILTERS,
  isUuid,
  matchesStageFilter,
  type StatusStage,
} from "@/lib/portal/orders";

/**
 * Orders as staff see them (SPEC §21, §35.7): every customer's orders (RLS:
 * is_staff), with the customer, the invoices that cover them (read-only until
 * P6/P7) and open cancellation requests. Read with the staff member's own
 * client; writes go through the server functions in
 * lib/server-fns/admin-orders.functions.ts or straight to tables RLS allows.
 */

type Tables = Database["public"]["Tables"];
type OverviewRow = Database["public"]["Views"]["invoice_overview"]["Row"];
export type OrderRow = Tables["orders"]["Row"];
export type CustomerRow = Tables["customers"]["Row"];

const PAGE_SIZE = 1000;

/** Reads every page of a PostgREST query (past its row cap). */
export async function allPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) return rows;
  }
}

// ---------------------------------------------------------------------------
// Customers (who an order belongs to)
// ---------------------------------------------------------------------------

export type OrderCustomer = Pick<
  CustomerRow,
  "id" | "customer_code" | "full_name" | "company_name" | "account_type" | "status" | "user_id"
>;

const CUSTOMER_COLUMNS =
  "id, customer_code, full_name, company_name, account_type, status, user_id";

/** "Maria Pinas" or "Pinas Trading N.V. (Maria Pinas)" for business customers. */
export function customerDisplayName(
  customer: Pick<CustomerRow, "full_name" | "company_name" | "account_type">,
): string {
  if (customer.account_type === "business" && customer.company_name) {
    return `${customer.company_name} (${customer.full_name})`;
  }
  return customer.full_name;
}

/**
 * The customer picker's filter (cmdk): an exact GR code ("gr 42" → GR00042)
 * first, then name, company or phone, ignoring case and accents. `value` is
 * the customer code, `keywords` the other fields.
 */
export function customerSearchScore(value: string, search: string, keywords?: string[]): number {
  const code = parseCustomerCode(search);
  if (code && value === code) return 1;
  const needle = fold(search.trim());
  if (!needle) return 1;
  return fold([value, ...(keywords ?? [])].join(" ")).includes(needle) ? 0.5 : 0;
}

export type PickerCustomer = OrderCustomer & Pick<CustomerRow, "phone" | "email">;

/** Every customer, for "Order aanmaken voor klant" (also customers without a login). */
export const customersQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.customers(userId),
    staleTime: 60_000,
    queryFn: () =>
      allPages<PickerCustomer>((from, to) =>
        supabase
          .from("customers")
          .select(`${CUSTOMER_COLUMNS}, phone, email`)
          .order("customer_number")
          .range(from, to),
      ),
  });

// ---------------------------------------------------------------------------
// The operational list
// ---------------------------------------------------------------------------

/** The columns of an order row in staff lists (the operational list, a shipment's orders). */
export const ADMIN_ORDER_LIST_COLUMNS =
  `id, reference, customer_id, order_type, service_type, store_vendor, vendor_order_number, description, tracking_number, tracking_number_normalized, carrier, status, parent_order_id, shipment_id, created_at, created_by_role, cancellation_requested_at, received_at, declared_weight_lbs, measured_weight_lbs, customer:customers(${CUSTOMER_COLUMNS})` as const;

async function fetchOrderPage(from: number, to: number) {
  return supabase
    .from("orders")
    .select(ADMIN_ORDER_LIST_COLUMNS)
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, to);
}

export type AdminOrderListItem = NonNullable<
  Awaited<ReturnType<typeof fetchOrderPage>>["data"]
>[number];

/** All orders, newest first (pages past PostgREST's row cap). */
export const adminOrdersQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.orderList(userId),
    staleTime: 15_000,
    queryFn: () => allPages(fetchOrderPage),
  });

// ---------------------------------------------------------------------------
// Invoices per order (read-only here; the invoice pages come in P6/P7)
// ---------------------------------------------------------------------------

export type BillingInvoice = Pick<
  OverviewRow,
  | "id"
  | "invoice_number"
  | "status"
  | "is_overdue"
  | "balance_due"
  | "currency"
  | "total_amount"
  | "amount_paid"
  | "invoice_date"
  | "due_date"
>;

export interface BillingData {
  invoices: ReadonlyMap<string, BillingInvoice>;
  /** order id → invoice ids with a line for that order. */
  byOrder: ReadonlyMap<string, readonly string[]>;
}

const BILLING_COLUMNS =
  "id, invoice_number, status, is_overdue, balance_due, currency, total_amount, amount_paid, invoice_date, due_date" as const;

export function indexBilling(
  invoices: readonly BillingInvoice[],
  items: readonly { invoice_id: string; order_id: string | null }[],
): BillingData {
  const byOrder = new Map<string, string[]>();
  for (const item of items) {
    if (!item.order_id) continue;
    const list = byOrder.get(item.order_id) ?? [];
    if (!list.includes(item.invoice_id)) list.push(item.invoice_id);
    byOrder.set(item.order_id, list);
  }
  return {
    invoices: new Map(invoices.flatMap((i) => (i.id ? [[i.id, i] as const] : []))),
    byOrder,
  };
}

/** Every invoice line that points at an order, and those invoices (drafts too: staff see them). */
export const orderBillingQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.orderBilling(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<BillingData> => {
      const [items, invoices] = await Promise.all([
        allPages<{ invoice_id: string; order_id: string | null }>((from, to) =>
          supabase
            .from("invoice_items")
            .select("invoice_id, order_id")
            .not("order_id", "is", null)
            .order("id")
            .range(from, to),
        ),
        allPages<BillingInvoice>((from, to) =>
          supabase
            .from("invoice_overview")
            .select(BILLING_COLUMNS)
            .neq("status", "cancelled")
            .order("id")
            .range(from, to),
        ),
      ]);
      return indexBilling(invoices, items);
    },
  });

/** What the Factuur and Betaling columns show for one order. */
export interface OrderBilling {
  /** Non-cancelled invoices with a line for the order: issued ones first, then drafts. */
  invoices: BillingInvoice[];
  /** Still to be paid on issued invoices, per currency (never summed across). */
  unpaid: CurrencyAmount[];
  hasOpenInvoice: boolean;
  overdue: boolean;
  /**
   * none: no invoice; draft: only drafts; open: something to pay; paid:
   * everything paid; unknown: the invoices could not be loaded (yet), so
   * nothing may be claimed about them.
   */
  payment: "none" | "draft" | "open" | "paid" | "unknown";
}

export function orderBilling(orderId: string, billing: BillingData | undefined): OrderBilling {
  if (!billing) {
    return { invoices: [], unpaid: [], hasOpenInvoice: false, overdue: false, payment: "unknown" };
  }
  const invoices = (billing.byOrder.get(orderId) ?? [])
    .flatMap((id) => {
      const invoice = billing.invoices.get(id);
      return invoice && invoice.status !== "cancelled" ? [invoice] : [];
    })
    .sort(
      (a, b) =>
        Number(a.status === "draft") - Number(b.status === "draft") ||
        (b.invoice_number ?? "").localeCompare(a.invoice_number ?? ""),
    );
  const issued = invoices.filter((i) => i.status !== "draft");
  const unpaid = unpaidByCurrency(issued);
  const hasOpenInvoice = issued.some(needsPayment);
  return {
    invoices,
    unpaid,
    hasOpenInvoice,
    overdue: issued.some((i) => i.is_overdue === true),
    payment:
      invoices.length === 0
        ? "none"
        : issued.length === 0
          ? "draft"
          : hasOpenInvoice
            ? "open"
            : "paid",
  };
}

// ---------------------------------------------------------------------------
// Cancellation requests (request_order_cancellation raises a staff task)
// ---------------------------------------------------------------------------

export type CancellationTask = Pick<
  Tables["staff_tasks"]["Row"],
  "id" | "order_id" | "created_at" | "resolved_at" | "resolved_by"
>;

/**
 * Open cancellation requests by order. The order keeps its
 * cancellation_requested_at after staff decide (no client may clear it), so
 * the open task is what says a request still waits for a decision.
 */
export const openCancellationTasksQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.cancellationTasks(userId),
    staleTime: 15_000,
    queryFn: async (): Promise<ReadonlyMap<string, CancellationTask>> => {
      const rows = await allPages<CancellationTask>((from, to) =>
        supabase
          .from("staff_tasks")
          .select("id, order_id, created_at, resolved_at, resolved_by")
          .eq("kind", "order_cancellation_request")
          .is("resolved_at", null)
          .order("created_at")
          .range(from, to),
      );
      return new Map(rows.flatMap((r) => (r.order_id ? [[r.order_id, r] as const] : [])));
    },
  });

// ---------------------------------------------------------------------------
// Search, filters and sort (kept in the URL)
// ---------------------------------------------------------------------------

export const ADMIN_ORDER_SORTS = ["newest", "oldest", "customer", "status"] as const;
export type AdminOrderSort = (typeof ADMIN_ORDER_SORTS)[number];

/** A `?flag=true` search param; anything else means off. */
export const searchFlag = z
  .preprocess(
    (v) => (v === true || v === "true" || v === 1 || v === "1" ? true : undefined),
    z.literal(true).optional(),
  )
  .catch(undefined);

/**
 * A free-text `?q=` search param; the router parses `?q=12345` as a number,
 * so numbers are read as text. Empty or invalid means no search.
 */
export const searchText = z
  .preprocess(
    (v) => (typeof v === "number" ? String(v) : v),
    z
      .string()
      .trim()
      .max(200)
      .transform((v) => v || undefined)
      .optional(),
  )
  .catch(undefined);

/**
 * Search params of /admin/orders. Invalid values are dropped, never an error
 * page; the router parses `?q=12345` as a number, so numbers are read as text.
 */
export const adminOrderSearchSchema = z.object({
  q: searchText,
  stage: z.enum(ORDER_STAGE_FILTERS).optional().catch(undefined),
  type: z.enum(Constants.public.Enums.order_type).optional().catch(undefined),
  /** Only orders with an issued invoice that still has a balance. */
  openInvoice: searchFlag,
  /** Only orders with an open cancellation request. */
  cancellation: searchFlag,
  /** Only orders G&R has not received yet. */
  awaitingReceipt: searchFlag,
  sort: z.enum(ADMIN_ORDER_SORTS).optional().catch(undefined),
});
export type AdminOrderSearch = z.infer<typeof adminOrderSearchSchema>;

/** Upper-case letters and digits only, as tracking_number_normalized is stored. */
export function normalizeTracking(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * "gr00017", " GR 17 " and "17" all mean GR00017 (private.parse_customer_code,
 * SPEC §35.5); null when the text is not a customer code.
 */
export function parseCustomerCode(value: string): string | null {
  const m = /^\s*(?:g\s*r)?\s*(\d{1,5})\s*$/i.exec(value);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return n >= 1 ? `GR${String(n).padStart(5, "0")}` : null;
}

/** Lower case without accents, so "eneas" finds "Énéas". */
export const fold = (value: string) => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Searchable = Pick<
  AdminOrderListItem,
  | "reference"
  | "store_vendor"
  | "vendor_order_number"
  | "description"
  | "tracking_number"
  | "tracking_number_normalized"
> & { customer: Pick<OrderCustomer, "customer_code" | "full_name" | "company_name"> | null };

/**
 * The prominent search on /admin/orders (SPEC §35.7 receiving): a tracking
 * number however it is typed or scanned (normalised), a GR code ("gr 17"),
 * the order reference, the customer's name or company, or the store, vendor
 * order number or description.
 */
export function matchesAdminSearch(order: Searchable, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const code = parseCustomerCode(q);
  if (code && order.customer?.customer_code === code) return true;

  const needle = fold(q);
  const text = [
    order.reference,
    order.customer?.customer_code,
    order.customer?.full_name,
    order.customer?.company_name,
    order.store_vendor,
    order.vendor_order_number,
    order.description,
    order.tracking_number,
  ];
  if (text.some((f) => (f ? fold(f).includes(needle) : false))) return true;

  // Tracking, reference and order numbers without their spaces or dashes.
  const compact = normalizeTracking(q);
  if (compact.length < 3) return false;
  const numbers = [
    order.tracking_number_normalized,
    order.reference,
    order.vendor_order_number,
    order.customer?.customer_code,
  ];
  return numbers.some((f) => (f ? normalizeTracking(f).includes(compact) : false));
}

/** Orders whose normalised tracking number is exactly what was typed or scanned. */
export function exactTrackingMatches<T extends Pick<OrderRow, "tracking_number_normalized">>(
  orders: readonly T[],
  query: string,
): T[] {
  const needle = normalizeTracking(query);
  if (needle.length < 4) return [];
  return orders.filter((o) => o.tracking_number_normalized === needle);
}

/**
 * Orders sharing a normalised tracking number with another order that is not
 * cancelled (SPEC §35.7: warn and show both).
 */
export function duplicateTrackingOrderIds(
  orders: readonly Pick<OrderRow, "id" | "status" | "tracking_number_normalized">[],
  statuses: AdminStatusMap,
): ReadonlySet<string> {
  const groups = new Map<string, string[]>();
  for (const o of orders) {
    if (!o.tracking_number_normalized) continue;
    if (statuses.get(o.status)?.stage === "cancelled") continue;
    groups.set(o.tracking_number_normalized, [
      ...(groups.get(o.tracking_number_normalized) ?? []),
      o.id,
    ]);
  }
  return new Set([...groups.values()].filter((ids) => ids.length > 1).flat());
}

export interface AdminOrderView extends Omit<AdminOrderListItem, "customer"> {
  customer: OrderCustomer | null;
  stage: StatusStage | null;
  billing: OrderBilling;
  cancellationTask: CancellationTask | null;
  duplicateTracking: boolean;
}

/** Joins the list with statuses, billing and open cancellation requests. */
export function buildOrderViews(
  orders: readonly AdminOrderListItem[],
  statuses: AdminStatusMap,
  billing: BillingData | undefined,
  cancellations: ReadonlyMap<string, CancellationTask> | undefined,
): AdminOrderView[] {
  const duplicates = duplicateTrackingOrderIds(orders, statuses);
  return orders.map((o) => ({
    ...o,
    stage: statuses.get(o.status)?.stage ?? null,
    billing: orderBilling(o.id, billing),
    cancellationTask: cancellations?.get(o.id) ?? null,
    duplicateTracking: duplicates.has(o.id),
  }));
}

/** What the status dialog needs to know about each selected order. */
export interface StatusTarget {
  id: string;
  reference: string;
  status: string;
  order_type: Database["public"]["Enums"]["order_type"];
  /** Hand-over is per customer: one collector name for one customer's packages. */
  customer_id: string;
  /** Not yet received orders must be received before they move past the warehouse. */
  received_at: string | null;
}

/** What the receive dialog needs to know about the order. */
export interface ReceiveTarget {
  id: string;
  reference: string;
  stage: StatusStage | null;
  declared_weight_lbs: number | null;
  measured_weight_lbs: number | null;
  received_at: string | null;
  /** "Maria Pinas (GR00042)". */
  customerLabel: string | null;
}

export function toStatusTarget(
  o: Pick<OrderRow, "id" | "reference" | "status" | "order_type" | "customer_id" | "received_at">,
): StatusTarget {
  return {
    id: o.id,
    reference: o.reference,
    status: o.status,
    order_type: o.order_type,
    customer_id: o.customer_id,
    received_at: o.received_at,
  };
}

export function toReceiveTarget(
  o: Pick<
    OrderRow,
    "id" | "reference" | "declared_weight_lbs" | "measured_weight_lbs" | "received_at"
  > & {
    stage: StatusStage | null;
    customer: Pick<
      CustomerRow,
      "full_name" | "company_name" | "account_type" | "customer_code"
    > | null;
  },
): ReceiveTarget {
  return {
    id: o.id,
    reference: o.reference,
    stage: o.stage,
    declared_weight_lbs: o.declared_weight_lbs,
    measured_weight_lbs: o.measured_weight_lbs,
    received_at: o.received_at,
    customerLabel: o.customer
      ? `${customerDisplayName(o.customer)} (${o.customer.customer_code})`
      : null,
  };
}

export function hasAdminFilters(search: AdminOrderSearch): boolean {
  return Boolean(
    search.q ||
    search.stage ||
    search.type ||
    search.openInvoice ||
    search.cancellation ||
    search.awaitingReceipt,
  );
}

/** Applies the list's search, filters and sort. */
export function filterAdminOrders(
  orders: readonly AdminOrderView[],
  statuses: AdminStatusMap,
  search: AdminOrderSearch,
): AdminOrderView[] {
  const { q, stage, type, openInvoice, cancellation, awaitingReceipt, sort } = search;
  const result = orders.filter(
    (o) =>
      (!q || matchesAdminSearch(o, q)) &&
      (!type || o.order_type === type) &&
      (!stage || matchesStageFilter(o.stage, stage)) &&
      (!openInvoice || o.billing.hasOpenInvoice) &&
      (!cancellation || o.cancellationTask !== null) &&
      (!awaitingReceipt || isAwaitingReceipt(o.stage, o.received_at)),
  );
  const byDate = (a: AdminOrderView, b: AdminOrderView) =>
    Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id);
  const statusOrder = (o: AdminOrderView) => statuses.get(o.status)?.sort_order ?? 0;
  const name = (o: AdminOrderView) => (o.customer ? fold(customerDisplayName(o.customer)) : "");
  switch (sort) {
    case "oldest":
      return result.sort(
        (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id),
      );
    case "customer":
      return result.sort((a, b) => name(a).localeCompare(name(b), "nl") || byDate(a, b));
    case "status":
      return result.sort((a, b) => statusOrder(a) - statusOrder(b) || byDate(a, b));
    default:
      return result.sort(byDate);
  }
}

// ---------------------------------------------------------------------------
// One order (/admin/orders/$id)
// ---------------------------------------------------------------------------

const DETAIL_COLUMNS =
  `*, customer:customers(${CUSTOMER_COLUMNS}, email, phone), shipment:shipments(id, shipment_number, service_type, carrier, awb_or_container_number, departed_at, arrived_at, customer_note)` as const;

async function fetchAdminOrder(orderId: string) {
  const { data, error } = await supabase
    .from("orders")
    .select(DETAIL_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export type AdminOrderDetail = NonNullable<Awaited<ReturnType<typeof fetchAdminOrder>>>;

export const adminOrderQueryOptions = (userId: string, orderId: string) =>
  queryOptions({
    queryKey: adminKeys.order(userId, orderId),
    staleTime: 10_000,
    queryFn: () => (isUuid(orderId) ? fetchAdminOrder(orderId) : Promise.resolve(null)),
  });

export type AdminHistoryEntry = Pick<
  Tables["shipment_status_history"]["Row"],
  "id" | "from_status" | "to_status" | "changed_at" | "changed_by" | "customer_message"
>;

/** Every status change of the order (staff see them all), oldest first. */
export const adminOrderHistoryQueryOptions = (userId: string, orderId: string) =>
  queryOptions({
    queryKey: adminKeys.orderHistory(userId, orderId),
    staleTime: 10_000,
    queryFn: async (): Promise<AdminHistoryEntry[]> => {
      const { data, error } = await supabase
        .from("shipment_status_history")
        .select("id, from_status, to_status, changed_at, changed_by, customer_message")
        .eq("order_id", orderId)
        .order("changed_at")
        .order("id");
      if (error) throw error;
      return data;
    },
  });

export type OrderInvoiceRow = BillingInvoice & Pick<OverviewRow, "days_overdue" | "paid_at">;

/** Invoices with a line for this order, drafts and cancelled ones included (read-only). */
export const adminOrderInvoicesQueryOptions = (userId: string, orderId: string) =>
  queryOptions({
    queryKey: adminKeys.orderInvoices(userId, orderId),
    staleTime: 30_000,
    queryFn: async (): Promise<OrderInvoiceRow[]> => {
      const items = await supabase
        .from("invoice_items")
        .select("invoice_id")
        .eq("order_id", orderId);
      if (items.error) throw items.error;
      const ids = [...new Set(items.data.map((i) => i.invoice_id))];
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("invoice_overview")
        .select(`${BILLING_COLUMNS}, days_overdue, paid_at`)
        .in("id", ids)
        .order("invoice_date", { ascending: false })
        .order("invoice_number", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

export type StaffOrderDocument = Pick<
  Tables["order_documents"]["Row"],
  | "id"
  | "order_id"
  | "customer_id"
  | "kind"
  | "original_filename"
  | "mime_type"
  | "size_bytes"
  | "storage_path"
  | "uploaded_by"
  | "created_at"
>;

export const STAFF_DOCUMENT_COLUMNS =
  "id, order_id, customer_id, kind, original_filename, mime_type, size_bytes, storage_path, uploaded_by, created_at" as const;

export const adminOrderDocumentsQueryOptions = (userId: string, orderId: string) =>
  queryOptions({
    queryKey: adminKeys.orderDocuments(userId, orderId),
    staleTime: 30_000,
    queryFn: async (): Promise<StaffOrderDocument[]> => {
      const { data, error } = await supabase
        .from("order_documents")
        .select(STAFF_DOCUMENT_COLUMNS)
        .eq("order_id", orderId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

export type InternalNote = Pick<
  Tables["internal_notes"]["Row"],
  "id" | "body" | "created_at" | "created_by" | "updated_at"
>;

/** Staff-only remarks on this order (internal_notes; never shown to the customer). */
export const adminOrderNotesQueryOptions = (userId: string, orderId: string) =>
  queryOptions({
    queryKey: adminKeys.orderNotes(userId, orderId),
    staleTime: 30_000,
    queryFn: async (): Promise<InternalNote[]> => {
      const { data, error } = await supabase
        .from("internal_notes")
        .select("id, body, created_at, created_by, updated_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

/** The latest cancellation request task of this order, open or decided. */
export const adminOrderCancellationQueryOptions = (userId: string, orderId: string) =>
  queryOptions({
    queryKey: adminKeys.orderTasks(userId, orderId),
    staleTime: 15_000,
    queryFn: async (): Promise<CancellationTask | null> => {
      const { data, error } = await supabase
        .from("staff_tasks")
        .select("id, order_id, created_at, resolved_at, resolved_by")
        .eq("order_id", orderId)
        .eq("kind", "order_cancellation_request")
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data[0] ?? null;
    },
  });

export type GroupOrder = Pick<
  OrderRow,
  "id" | "reference" | "status" | "parent_order_id" | "created_at" | "tracking_number"
>;

/** The root order and its extra packages, oldest first. */
export const adminOrderGroupQueryOptions = (userId: string, rootId: string) =>
  queryOptions({
    queryKey: adminKeys.orderGroup(userId, rootId),
    staleTime: 30_000,
    queryFn: async (): Promise<GroupOrder[]> => {
      if (!isUuid(rootId)) return [];
      const { data, error } = await supabase
        .from("orders")
        .select("id, reference, status, parent_order_id, created_at, tracking_number")
        .or(`id.eq.${rootId},parent_order_id.eq.${rootId}`)
        .order("created_at")
        .order("id");
      if (error) throw error;
      return data;
    },
  });

/**
 * Who did something, for "door Maria": the login's display name, "de klant
 * (portaal)" for the customer's own login, else "een medewerker".
 */
export function personName(
  id: string | null,
  people: ReadonlyMap<string, string | null> | undefined,
  customerUserId: string | null,
): string {
  if (id && customerUserId && id === customerUserId) return t("admin.order.byCustomer");
  return (id ? people?.get(id) : null) ?? t("admin.order.someone");
}

/** Display names of logins (profiles: staff may read all), for "door Maria". */
export const peopleQueryOptions = (userId: string, ids: readonly string[]) =>
  queryOptions({
    queryKey: adminKeys.people(userId, ids),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ReadonlyMap<string, string | null>> => {
      const unique = [...new Set(ids)].filter(isUuid);
      if (unique.length === 0) return new Map();
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", unique);
      if (error) throw error;
      return new Map(data.map((p) => [p.id, p.display_name?.trim() || null]));
    },
  });

// ---------------------------------------------------------------------------
// Checks for a selection (status dialog)
// ---------------------------------------------------------------------------

/** Orders (of the given ids) that have a commercial invoice or packing list. */
export async function ordersWithCustomsDocuments(
  orderIds: readonly string[],
): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("order_documents")
    .select("order_id")
    .in("order_id", [...orderIds])
    .in("kind", ["commercial_invoice", "packing_list"]);
  if (error) throw error;
  return new Set(data.map((d) => d.order_id));
}

export interface UnpaidOrder {
  orderId: string;
  invoiceNumbers: string[];
  unpaid: CurrencyAmount[];
}

/**
 * Orders (of the given ids) on an issued invoice that still has a balance:
 * what pay_before_pickup blocks (private.assert_paid_before_pickup).
 */
export async function unpaidInvoicesForOrders(orderIds: readonly string[]): Promise<UnpaidOrder[]> {
  if (orderIds.length === 0) return [];
  const items = await supabase
    .from("invoice_items")
    .select("invoice_id, order_id")
    .in("order_id", [...orderIds]);
  if (items.error) throw items.error;
  const invoiceIds = [...new Set(items.data.map((i) => i.invoice_id))];
  if (invoiceIds.length === 0) return [];
  const invoices = await supabase
    .from("invoice_overview")
    .select(BILLING_COLUMNS)
    .in("id", invoiceIds)
    .in("status", OPEN_INVOICE_STATUSES);
  if (invoices.error) throw invoices.error;
  const billing = indexBilling(invoices.data, items.data);
  return orderIds.flatMap((orderId) => {
    const b = orderBilling(orderId, billing);
    if (!b.hasOpenInvoice) return [];
    return [
      {
        orderId,
        invoiceNumbers: b.invoices
          .filter(needsPayment)
          .flatMap((i) => (i.invoice_number ? [i.invoice_number] : [])),
        unpaid: b.unpaid,
      },
    ];
  });
}
