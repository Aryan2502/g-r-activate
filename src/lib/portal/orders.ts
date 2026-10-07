import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { Constants, type Database } from "@/integrations/supabase/types";
import { paths } from "@/lib/paths";

/**
 * The customer's orders in the portal (SPEC §8, §10, §35.7). Every query runs
 * with the signed-in customer's own client, so RLS decides what is returned:
 * own orders only, and only status rows/history that are customer_visible.
 * The portal's queries also filter on the customer explicitly: RLS lets staff
 * read every row, so a login that is staff and still has an active customer
 * record must not see other customers' orders as its own.
 * Query keys start with ["portal", userId] (cleared on sign-out).
 */

type Tables = Database["public"]["Tables"];

export type StatusStage = Database["public"]["Enums"]["status_stage"];
export type OrderType = Database["public"]["Enums"]["order_type"];
export type ServiceType = Database["public"]["Enums"]["service_type"];
export type OrderRow = Tables["orders"]["Row"];

/** All stages in schema order (registered … action_required). */
export const STATUS_STAGES: readonly StatusStage[] = Constants.public.Enums.status_stage;

/** The normal journey of a package, used for the progress steps on the order page. */
export const JOURNEY_STAGES = [
  "registered",
  "us_warehouse",
  "in_transit",
  "arrived_sr",
  "at_customs",
  "cleared",
  "ready_for_pickup",
  "completed",
] as const satisfies readonly StatusStage[];

// ---------------------------------------------------------------------------
// Query keys. Everything about orders hangs under [..., "orders"], so one
// invalidation after a write refreshes the list, the dashboard and the detail.
// ---------------------------------------------------------------------------

export const portalKeys = {
  all: (userId: string) => ["portal", userId] as const,
  statuses: (userId: string) => ["portal", userId, "statuses"] as const,
  serviceTypes: (userId: string) => ["portal", userId, "service-types"] as const,
  pickupInfo: (userId: string) => ["portal", userId, "pickup-info"] as const,
  warehouse: (userId: string) => ["portal", userId, "warehouse-addresses"] as const,
  orders: (userId: string) => ["portal", userId, "orders"] as const,
  order: (userId: string, orderId: string) => ["portal", userId, "orders", orderId] as const,
  orderHistory: (userId: string, orderId: string) =>
    ["portal", userId, "orders", orderId, "history"] as const,
  orderGroup: (userId: string, rootId: string) =>
    ["portal", userId, "orders", "group", rootId] as const,
  orderInvoices: (userId: string, orderId: string) =>
    ["portal", userId, "orders", orderId, "invoices"] as const,
  orderDocuments: (userId: string, orderId: string) =>
    ["portal", userId, "orders", orderId, "documents"] as const,
  invoiceSummary: (userId: string) => ["portal", userId, "invoices", "summary"] as const,
  /** Includes order registrations, so it lives under "orders". */
  activity: (userId: string) => ["portal", userId, "orders", "activity"] as const,
};

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

export type ShipmentStatus = Pick<
  Tables["shipment_statuses"]["Row"],
  "code" | "label_nl" | "customer_description_nl" | "stage" | "sort_order" | "active"
>;

export type StatusMap = ReadonlyMap<string, ShipmentStatus>;

/** Statuses the customer may see (RLS: customer_visible), keyed by code. */
export const statusesQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: portalKeys.statuses(userId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<StatusMap> => {
      const { data, error } = await supabase
        .from("shipment_statuses")
        .select("code, label_nl, customer_description_nl, stage, sort_order, active")
        .order("sort_order")
        .order("code");
      if (error) throw error;
      return new Map(data.map((s) => [s.code, s]));
    },
  });

/**
 * What the customer sees for a status code. A status that is not
 * customer_visible is not readable under RLS: then the label is unknown
 * (null) and so is the stage.
 */
export interface OrderStatusView {
  code: string;
  label: string | null;
  description: string | null;
  stage: StatusStage | null;
}

export function resolveStatus(code: string, statuses: StatusMap): OrderStatusView {
  const s = statuses.get(code);
  return {
    code,
    label: s?.label_nl ?? null,
    description: s?.customer_description_nl ?? null,
    stage: s?.stage ?? null,
  };
}

// ---------------------------------------------------------------------------
// Stage helpers (SPEC §35.7: dashboards and the timeline use the stage)
// ---------------------------------------------------------------------------

/** Dashboard buckets (SPEC §8). */
export type StageGroup =
  "registered" | "in_progress" | "ready_for_pickup" | "completed" | "cancelled";

/**
 * registered / ready_for_pickup / completed / cancelled map to themselves;
 * every other stage (US warehouse … cleared, action required) is a shipment
 * in progress. An unknown stage (a status hidden from customers) means G&R is
 * handling the package, so it counts as in progress too.
 */
export function stageGroup(stage: StatusStage | null): StageGroup {
  switch (stage) {
    case "registered":
    case "ready_for_pickup":
    case "completed":
    case "cancelled":
      return stage;
    default:
      return "in_progress";
  }
}

/** Customers edit an order only while it is in the 'registered' stage (orders_guard_update). */
export function canEditOrder(stage: StatusStage | null): boolean {
  return stage === "registered";
}

/** Uploads are refused once an order is completed or cancelled (order_documents_before_insert). */
export function canUploadDocuments(stage: StatusStage | null): boolean {
  return stage !== "completed" && stage !== "cancelled";
}

/** request_order_cancellation refuses completed/cancelled orders and answers a repeat with the first timestamp. */
export function canRequestCancellation(
  stage: StatusStage | null,
  cancellationRequestedAt: string | null,
): boolean {
  return cancellationRequestedAt === null && stage !== "completed" && stage !== "cancelled";
}

export interface OrderCounts {
  total: number;
  registered: number;
  inProgress: number;
  actionRequired: number;
  readyForPickup: number;
  completed: number;
  cancelled: number;
}

/** Counts for the dashboard cards, by stage (never by label). */
export function countOrders(
  orders: readonly { status: string }[],
  statuses: StatusMap,
): OrderCounts {
  const counts: OrderCounts = {
    total: orders.length,
    registered: 0,
    inProgress: 0,
    actionRequired: 0,
    readyForPickup: 0,
    completed: 0,
    cancelled: 0,
  };
  for (const order of orders) {
    const stage = statuses.get(order.status)?.stage ?? null;
    if (stage === "action_required") counts.actionRequired += 1;
    switch (stageGroup(stage)) {
      case "registered":
        counts.registered += 1;
        break;
      case "in_progress":
        counts.inProgress += 1;
        break;
      case "ready_for_pickup":
        counts.readyForPickup += 1;
        break;
      case "completed":
        counts.completed += 1;
        break;
      case "cancelled":
        counts.cancelled += 1;
        break;
    }
  }
  return counts;
}

/** Badge colours (SPEC §35.14); the component adds an icon so colour is never the only cue. */
export type StatusTone = "secondary" | "info" | "success" | "warning" | "neutral";

export function stageTone(stage: StatusStage | null): StatusTone {
  switch (stage) {
    case "registered":
      return "secondary";
    case "ready_for_pickup":
      return "success";
    case "action_required":
      return "warning";
    case "completed":
    case "cancelled":
      return "neutral";
    default:
      return "info";
  }
}

export interface JourneyStep {
  /** A stage of the normal journey, or the off-path stage the order is in now. */
  stage: StatusStage;
  /** Label of the first active status in that stage (configurable by admin), else null. */
  label: string | null;
  state: "done" | "current" | "upcoming";
}

/**
 * Progress steps for the order page. The labels come from the configured
 * statuses; the current step is the order's stage. Off the normal path, the
 * stages already passed (from the history) are done, then:
 * - action required: a current step with the order's own status label, and
 *   the rest of the journey still to come (it continues once the customer
 *   has acted);
 * - cancelled: a final current "Geannuleerd" step and nothing after it.
 * An unknown stage (a status hidden from customers) marks no step current.
 */
export function journeySteps(
  currentStage: StatusStage | null,
  statuses: StatusMap,
  reachedStages: readonly (StatusStage | null)[] = [],
  currentLabel: string | null = null,
): JourneyStep[] {
  const firstLabel = new Map<StatusStage, ShipmentStatus>();
  for (const s of statuses.values()) {
    const seen = firstLabel.get(s.stage);
    const better =
      !seen ||
      (s.active && !seen.active) ||
      (s.active === seen.active && s.sort_order < seen.sort_order);
    if (better) firstLabel.set(s.stage, s);
  }
  const labelOf = (stage: StatusStage) => firstLabel.get(stage)?.label_nl ?? null;

  const index = (stage: StatusStage | null) =>
    stage ? (JOURNEY_STAGES as readonly StatusStage[]).indexOf(stage) : -1;
  const current = index(currentStage);
  const reached = Math.max(current, 0, ...reachedStages.map(index));

  if (currentStage === "cancelled" || currentStage === "action_required") {
    const step = (stage: StatusStage, state: JourneyStep["state"]): JourneyStep => ({
      stage,
      label: labelOf(stage),
      state,
    });
    const passed = JOURNEY_STAGES.slice(0, reached + 1).map((stage) => step(stage, "done"));
    const offPath = {
      ...step(currentStage, "current"),
      label: currentLabel ?? labelOf(currentStage),
    };
    if (currentStage === "cancelled") return [...passed, offPath];
    const ahead = JOURNEY_STAGES.slice(reached + 1).map((stage) => step(stage, "upcoming"));
    return [...passed, offPath, ...ahead];
  }

  return JOURNEY_STAGES.map((stage, i) => {
    let state: JourneyStep["state"] = "upcoming";
    if (current >= 0) {
      state = i < current ? "done" : i === current ? "current" : "upcoming";
    } else if (i <= reached) {
      state = "done";
    }
    // The last step is reached, not passed: completed is "current" once there.
    if (state === "done" && i === JOURNEY_STAGES.length - 1) state = "current";
    return { stage, label: labelOf(stage), state };
  });
}

// ---------------------------------------------------------------------------
// Order list
// ---------------------------------------------------------------------------

const LIST_COLUMNS =
  "id, reference, order_type, service_type, store_vendor, vendor_order_number, description, tracking_number, carrier, status, parent_order_id, created_at, purchase_date, cancellation_requested_at" as const;

export type OrderListItem = Pick<
  OrderRow,
  | "id"
  | "reference"
  | "order_type"
  | "service_type"
  | "store_vendor"
  | "vendor_order_number"
  | "description"
  | "tracking_number"
  | "carrier"
  | "status"
  | "parent_order_id"
  | "created_at"
  | "purchase_date"
  | "cancellation_requested_at"
>;

const PAGE_SIZE = 1000;

/** All of the customer's orders, newest first (pages past PostgREST's row cap). */
export const ordersQueryOptions = (userId: string, customerId: string) =>
  queryOptions({
    queryKey: portalKeys.orders(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<OrderListItem[]> => {
      const rows: OrderListItem[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("orders")
          .select(LIST_COLUMNS)
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        rows.push(...data);
        if (data.length < PAGE_SIZE) return rows;
      }
    },
  });

/** Stage filter values on /portal/orders: a stage, or the dashboard's "in progress" group. */
export const ORDER_STAGE_FILTERS = ["in_progress", ...STATUS_STAGES] as const;
export type OrderStageFilter = (typeof ORDER_STAGE_FILTERS)[number];

export const ORDER_SORTS = ["newest", "oldest"] as const;
export type OrderSort = (typeof ORDER_SORTS)[number];

/**
 * Search params of /portal/orders; invalid values are dropped, never an error
 * page. The router parses `?q=12345` as a number, so numbers are read as text;
 * an empty search is no search.
 */
export const orderListSearchSchema = z.object({
  q: z
    .preprocess(
      (v) => (typeof v === "number" ? String(v) : v),
      z
        .string()
        .trim()
        .max(200)
        .transform((v) => v || undefined)
        .optional(),
    )
    .catch(undefined),
  stage: z.enum(ORDER_STAGE_FILTERS).optional().catch(undefined),
  type: z.enum(Constants.public.Enums.order_type).optional().catch(undefined),
  sort: z.enum(ORDER_SORTS).optional().catch(undefined),
});
export type OrderListSearch = z.infer<typeof orderListSearchSchema>;

const compact = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Case-insensitive match on reference, store, description of the goods (what
 * customers remember: "sportschoenen"), vendor order number or tracking number.
 */
export function matchesOrderSearch(
  order: Pick<
    OrderListItem,
    "reference" | "store_vendor" | "description" | "vendor_order_number" | "tracking_number"
  >,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const fields = [
    order.reference,
    order.store_vendor,
    order.description,
    order.vendor_order_number,
    order.tracking_number,
  ];
  if (fields.some((f) => f?.toLowerCase().includes(q))) return true;
  // Tracking and order numbers are often typed without their dashes or spaces
  // (not applied to the free-text description).
  const numbers = [
    order.reference,
    order.store_vendor,
    order.vendor_order_number,
    order.tracking_number,
  ];
  const cq = compact(query);
  return cq.length > 0 && numbers.some((f) => (f ? compact(f).includes(cq) : false));
}

export function matchesStageFilter(stage: StatusStage | null, filter: OrderStageFilter): boolean {
  return filter === "in_progress" ? stageGroup(stage) === "in_progress" : stage === filter;
}

/** Applies the list's search, filters and date sort. */
export function filterOrders<T extends OrderListItem>(
  orders: readonly T[],
  statuses: StatusMap,
  { q, stage, type, sort }: OrderListSearch,
): T[] {
  const result = orders.filter(
    (o) =>
      (!q || matchesOrderSearch(o, q)) &&
      (!type || o.order_type === type) &&
      (!stage || matchesStageFilter(statuses.get(o.status)?.stage ?? null, stage)),
  );
  const direction = sort === "oldest" ? 1 : -1;
  return result.sort(
    (a, b) =>
      direction * (Date.parse(a.created_at) - Date.parse(b.created_at)) || a.id.localeCompare(b.id),
  );
}

// ---------------------------------------------------------------------------
// Order detail
// ---------------------------------------------------------------------------

export const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const DETAIL_COLUMNS =
  "*, shipment:shipments(shipment_number, service_type, carrier, awb_or_container_number, departed_at, arrived_at, customer_note)" as const;

async function fetchOrder(customerId: string, orderId: string) {
  const { data, error } = await supabase
    .from("orders")
    .select(DETAIL_COLUMNS)
    .eq("id", orderId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export type OrderDetail = NonNullable<Awaited<ReturnType<typeof fetchOrder>>>;

/** One order with its consolidation shipment (if any); null when RLS hides it or it does not exist. */
export const orderQueryOptions = (userId: string, customerId: string, orderId: string) =>
  queryOptions({
    queryKey: portalKeys.order(userId, orderId),
    staleTime: 15_000,
    queryFn: () => (isUuid(orderId) ? fetchOrder(customerId, orderId) : Promise.resolve(null)),
  });

export type StatusHistoryEntry = Pick<
  Tables["shipment_status_history"]["Row"],
  "id" | "from_status" | "to_status" | "changed_at" | "customer_message"
>;

/**
 * Status changes of one order, oldest first. RLS returns only rows whose new
 * status is customer_visible; who changed it is never read (customers see
 * "G&R Solutions"). Only used for an order already loaded with the customer
 * filter (orderQueryOptions).
 */
export const orderHistoryQueryOptions = (userId: string, orderId: string) =>
  queryOptions({
    queryKey: portalKeys.orderHistory(userId, orderId),
    staleTime: 15_000,
    queryFn: async (): Promise<StatusHistoryEntry[]> => {
      const { data, error } = await supabase
        .from("shipment_status_history")
        .select("id, from_status, to_status, changed_at, customer_message")
        .eq("order_id", orderId)
        .order("changed_at")
        .order("id");
      if (error) throw error;
      return data;
    },
  });

/** The message staff left with the status the order is in now (e.g. "Actie vereist"). */
export function currentStatusMessage(
  history: readonly StatusHistoryEntry[],
  currentStatus: string,
): string | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (entry && entry.to_status === currentStatus) return entry.customer_message?.trim() || null;
  }
  return null;
}

/** "Extra pakket toevoegen": siblings hang off one root order (one level deep). */
export function orderGroupRoot(order: Pick<OrderRow, "id" | "parent_order_id">): string {
  return order.parent_order_id ?? order.id;
}

/** The root order and all its extra packages, oldest first. */
export const orderGroupQueryOptions = (userId: string, customerId: string, rootId: string) =>
  queryOptions({
    queryKey: portalKeys.orderGroup(userId, rootId),
    staleTime: 30_000,
    queryFn: async (): Promise<OrderListItem[]> => {
      if (!isUuid(rootId)) return [];
      const { data, error } = await supabase
        .from("orders")
        .select(LIST_COLUMNS)
        .eq("customer_id", customerId)
        .or(`id.eq.${rootId},parent_order_id.eq.${rootId}`)
        .order("created_at")
        .order("id");
      if (error) throw error;
      return data;
    },
  });

// ---------------------------------------------------------------------------
// Settings the portal reads (RLS: active customers may read them)
// ---------------------------------------------------------------------------

/** Service types new orders may use (service_rates.enabled; customers only see enabled rows). */
export const enabledServiceTypesQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: portalKeys.serviceTypes(userId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ServiceType[]> => {
      const { data, error } = await supabase
        .from("service_rates")
        .select("service_type")
        .eq("enabled", true)
        .order("service_type");
      if (error) throw error;
      return data.map((r) => r.service_type);
    },
  });

export type PickupInfo = Pick<
  Tables["company_settings"]["Row"],
  "pickup_address" | "pickup_hours" | "pickup_instructions" | "pay_before_pickup"
>;

/**
 * Pickup details for the "Klaar voor afhalen" card and the order page (SPEC
 * §35.7), and whether open invoices must be paid before the hand-over.
 */
export const pickupInfoQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: portalKeys.pickupInfo(userId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PickupInfo | null> => {
      const { data, error } = await supabase
        .from("company_settings")
        .select("pickup_address, pickup_hours, pickup_instructions, pay_before_pickup")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

// ---------------------------------------------------------------------------
// Contract with the registration form (/portal/orders/nieuw, part B)
// ---------------------------------------------------------------------------

/**
 * Search params of /portal/orders/nieuw. `parent` prefills "Extra pakket
 * toevoegen": the new order gets parent_order_id = parent (always the root
 * order; check_order_parent refuses nesting). Invalid values are dropped.
 */
export const newOrderSearchSchema = z.object({
  parent: z.string().uuid().optional().catch(undefined),
});
export type NewOrderSearch = z.infer<typeof newOrderSearchSchema>;

/**
 * The registration form's URL, e.g. /portal/orders/nieuw?parent=<root id>.
 * A plain href keeps this side independent of the form route's search types.
 */
export function newOrderHref(search: NewOrderSearch = {}): string {
  const params = new URLSearchParams();
  if (search.parent) params.set("parent", search.parent);
  const query = params.toString();
  return query ? `${paths.portalOrderNew}?${query}` : paths.portalOrderNew;
}
