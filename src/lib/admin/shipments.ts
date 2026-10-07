import type { SupabaseClient } from "@supabase/supabase-js";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { Constants, type Database } from "@/integrations/supabase/types";
import { adminKeys } from "@/lib/admin/keys";
import {
  ADMIN_ORDER_LIST_COLUMNS,
  allPages,
  fold,
  normalizeTracking,
  searchFlag,
  searchText,
  type AdminOrderListItem,
} from "@/lib/admin/orders";
import { STAGE_DISPLAY_ORDER, isClosedStage, type AdminStatusMap } from "@/lib/admin/statuses";
import { CodedError, toAppError } from "@/lib/errors";
import { roundHalfUp, surinameDateTimeToIso, toSurinameDateTimeInput } from "@/lib/format";
import { t } from "@/lib/i18n";
import { isUuid, type ServiceType, type StatusStage } from "@/lib/portal/orders";

/**
 * Shipments (SPEC §21, §35.7): optional staff-only consolidation batches,
 * one flight or container. Staff create and edit them and move orders of the
 * same service type in and out with their OWN client (RLS: is_staff for
 * insert/update on shipments; orders.shipment_id is a staff-editable column
 * guarded by orders_guard_update). Customers see a shipment, including its
 * customer_note, only while one of their orders is in it. Shipments are never
 * deleted (no delete grant). "Status voor hele zending wijzigen" is one
 * change_order_status call through changeOrderStatusFn (P8 hook: at most one
 * e-mail per customer).
 */

type Tables = Database["public"]["Tables"];
type OrderRow = Tables["orders"]["Row"];
type Client = Pick<SupabaseClient<Database>, "from">;

export const SHIPMENT_COLUMNS =
  "id, shipment_number, service_type, carrier, awb_or_container_number, departed_at, arrived_at, customer_note, created_at, created_by, updated_at" as const;

export type Shipment = Pick<
  Tables["shipments"]["Row"],
  | "id"
  | "shipment_number"
  | "service_type"
  | "carrier"
  | "awb_or_container_number"
  | "departed_at"
  | "arrived_at"
  | "customer_note"
  | "created_at"
  | "created_by"
  | "updated_at"
>;

/** The columns staff write (the insert/update grants of shipments). */
export type ShipmentColumns = Required<
  Pick<
    Tables["shipments"]["Insert"],
    | "shipment_number"
    | "service_type"
    | "carrier"
    | "awb_or_container_number"
    | "departed_at"
    | "arrived_at"
    | "customer_note"
  >
>;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Every shipment, newest first. */
export const adminShipmentsQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.shipmentList(userId),
    staleTime: 15_000,
    queryFn: () =>
      allPages<Shipment>((from, to) =>
        supabase
          .from("shipments")
          .select(SHIPMENT_COLUMNS)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
  });

export type ShipmentMember = Pick<
  OrderRow,
  "id" | "shipment_id" | "status" | "customer_id" | "measured_weight_lbs" | "service_type"
>;

/** Orders that sit in a shipment, for the counts on the shipment list. */
export const shipmentMembersQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.shipmentMembers(userId),
    staleTime: 15_000,
    queryFn: () =>
      allPages<ShipmentMember>((from, to) =>
        supabase
          .from("orders")
          .select("id, shipment_id, status, customer_id, measured_weight_lbs, service_type")
          .not("shipment_id", "is", null)
          .order("id")
          .range(from, to),
      ),
  });

/** Groups members by shipment id. */
export function membersByShipment<T extends Pick<OrderRow, "shipment_id">>(
  members: readonly T[],
): ReadonlyMap<string, T[]> {
  const map = new Map<string, T[]>();
  for (const m of members) {
    if (!m.shipment_id) continue;
    map.set(m.shipment_id, [...(map.get(m.shipment_id) ?? []), m]);
  }
  return map;
}

/** One shipment; null when it does not exist (or the id is not a uuid). */
export const adminShipmentQueryOptions = (userId: string, shipmentId: string) =>
  queryOptions({
    queryKey: adminKeys.shipment(userId, shipmentId),
    staleTime: 10_000,
    queryFn: async (): Promise<Shipment | null> => {
      if (!isUuid(shipmentId)) return null;
      const { data, error } = await supabase
        .from("shipments")
        .select(SHIPMENT_COLUMNS)
        .eq("id", shipmentId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

async function fetchShipmentOrderPage(shipmentId: string, from: number, to: number) {
  return supabase
    .from("orders")
    .select(ADMIN_ORDER_LIST_COLUMNS)
    .eq("shipment_id", shipmentId)
    .order("created_at")
    .order("id")
    .range(from, to);
}

/** The orders in one shipment, oldest first, as rows of the operational list. */
export const shipmentOrdersQueryOptions = (userId: string, shipmentId: string) =>
  queryOptions({
    queryKey: adminKeys.shipmentOrders(userId, shipmentId),
    staleTime: 10_000,
    queryFn: (): Promise<AdminOrderListItem[]> =>
      isUuid(shipmentId)
        ? allPages((from, to) => fetchShipmentOrderPage(shipmentId, from, to))
        : Promise.resolve([]),
  });

// ---------------------------------------------------------------------------
// Summary of a shipment's orders
// ---------------------------------------------------------------------------

type MemberLike = Pick<
  OrderRow,
  "id" | "status" | "customer_id" | "measured_weight_lbs" | "service_type"
>;

export interface StageCount {
  /** null: a status code that is not configured (should not happen for staff). */
  stage: StatusStage | null;
  count: number;
}

export interface ShipmentSummary {
  orderCount: number;
  /** Orders not picked up, delivered or cancelled: what a whole-shipment status change moves. */
  openCount: number;
  customerCount: number;
  /** Sum of the measured weights, rounded to 2 decimals. */
  measuredLbs: number;
  /** Orders without a measured weight yet. */
  unweighed: number;
  /** Orders not received in the US warehouse yet (stage registered). */
  notReceived: number;
  /** Orders whose service type differs from the shipment's (fix before departure). */
  mismatched: number;
  /** Orders per stage, in journey order. */
  stages: StageCount[];
}

export function summarizeShipment(
  shipment: Pick<Shipment, "service_type">,
  orders: readonly MemberLike[],
  statuses: AdminStatusMap,
): ShipmentSummary {
  const byStage = new Map<StatusStage | null, number>();
  let open = 0;
  let unweighed = 0;
  let notReceived = 0;
  let mismatched = 0;
  let lbs = 0;
  for (const o of orders) {
    const stage = statuses.get(o.status)?.stage ?? null;
    byStage.set(stage, (byStage.get(stage) ?? 0) + 1);
    if (!isClosedStage(stage)) open += 1;
    if (stage === "registered") notReceived += 1;
    if (o.service_type !== shipment.service_type) mismatched += 1;
    if (o.measured_weight_lbs === null) unweighed += 1;
    else lbs += Number(o.measured_weight_lbs);
  }
  const stages: StageCount[] = [...STAGE_DISPLAY_ORDER, null].flatMap((stage) => {
    const count = byStage.get(stage) ?? 0;
    return count > 0 ? [{ stage, count }] : [];
  });
  return {
    orderCount: orders.length,
    openCount: open,
    customerCount: new Set(orders.map((o) => o.customer_id)).size,
    measuredLbs: roundHalfUp(lbs, 2),
    unweighed,
    notReceived,
    mismatched,
    stages,
  };
}

/** A shipment is done once it has orders and all of them are picked up, delivered or cancelled. */
export const isShipmentDone = (summary: Pick<ShipmentSummary, "orderCount" | "openCount">) =>
  summary.orderCount > 0 && summary.openCount === 0;

// ---------------------------------------------------------------------------
// The shipment list: search and filters (kept in the URL)
// ---------------------------------------------------------------------------

export const shipmentListSearchSchema = z.object({
  q: searchText,
  type: z.enum(Constants.public.Enums.service_type).optional().catch(undefined),
  /** Only shipments with orders still under way (or no orders yet). */
  open: searchFlag,
});
export type ShipmentListSearch = z.infer<typeof shipmentListSearchSchema>;

/** Shipment number, carrier or AWB/container number, ignoring case, spaces and dashes. */
export function matchesShipmentSearch(
  shipment: Pick<Shipment, "shipment_number" | "carrier" | "awb_or_container_number">,
  query: string,
): boolean {
  const q = query.trim();
  if (!q) return true;
  const needle = fold(q);
  const fields = [shipment.shipment_number, shipment.carrier, shipment.awb_or_container_number];
  if (fields.some((f) => (f ? fold(f).includes(needle) : false))) return true;
  const compact = normalizeTracking(q);
  if (compact.length < 3) return false;
  return [shipment.shipment_number, shipment.awb_or_container_number].some((f) =>
    f ? normalizeTracking(f).includes(compact) : false,
  );
}

export function filterShipments<T extends Shipment>(
  shipments: readonly T[],
  summaries: ReadonlyMap<string, ShipmentSummary>,
  search: ShipmentListSearch,
): T[] {
  return shipments.filter((s) => {
    if (search.q && !matchesShipmentSearch(s, search.q)) return false;
    if (search.type && s.service_type !== search.type) return false;
    if (search.open) {
      const summary = summaries.get(s.id);
      if (summary && isShipmentDone(summary)) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Create / edit form
// ---------------------------------------------------------------------------

export interface ShipmentFormValues {
  shipmentNumber: string;
  serviceType: ServiceType;
  carrier: string;
  awbOrContainerNumber: string;
  /** datetime-local in Suriname time, or "". */
  departedAt: string;
  arrivedAt: string;
  /** Shown to customers with an order in this shipment. */
  customerNote: string;
}
export type ShipmentFormField = keyof ShipmentFormValues;
export type ShipmentFormErrors = Partial<Record<ShipmentFormField, string>>;

/** Same limits as the shipments table's checks. */
export const SHIPMENT_LIMITS = {
  shipmentNumber: 50,
  carrier: 100,
  awbOrContainerNumber: 100,
  customerNote: 2000,
} as const;

export function emptyShipmentForm(serviceType: ServiceType = "air"): ShipmentFormValues {
  return {
    shipmentNumber: "",
    serviceType,
    carrier: "",
    awbOrContainerNumber: "",
    departedAt: "",
    arrivedAt: "",
    customerNote: "",
  };
}

export function shipmentFormFromRow(
  row: Pick<
    Shipment,
    | "shipment_number"
    | "service_type"
    | "carrier"
    | "awb_or_container_number"
    | "departed_at"
    | "arrived_at"
    | "customer_note"
  >,
): ShipmentFormValues {
  return {
    shipmentNumber: row.shipment_number,
    serviceType: row.service_type,
    carrier: row.carrier ?? "",
    awbOrContainerNumber: row.awb_or_container_number ?? "",
    departedAt: row.departed_at ? toSurinameDateTimeInput(row.departed_at) : "",
    arrivedAt: row.arrived_at ? toSurinameDateTimeInput(row.arrived_at) : "",
    customerNote: row.customer_note ?? "",
  };
}

const tooLong = (max: number) => t("admin.shipments.form.tooLong", { max });

const dateTime = z
  .string()
  .trim()
  .refine((v) => v === "" || surinameDateTimeToIso(v) !== null, {
    message: t("admin.shipments.form.dateTimeInvalid"),
  });

const shipmentFieldsSchema = z.object({
  shipmentNumber: z
    .string()
    .trim()
    .min(1, t("admin.shipments.form.numberRequired"))
    .max(SHIPMENT_LIMITS.shipmentNumber, tooLong(SHIPMENT_LIMITS.shipmentNumber)),
  serviceType: z.enum(Constants.public.Enums.service_type, {
    message: t("admin.shipments.form.serviceTypeRequired"),
  }),
  carrier: z.string().trim().max(SHIPMENT_LIMITS.carrier, tooLong(SHIPMENT_LIMITS.carrier)),
  awbOrContainerNumber: z
    .string()
    .trim()
    .max(SHIPMENT_LIMITS.awbOrContainerNumber, tooLong(SHIPMENT_LIMITS.awbOrContainerNumber)),
  departedAt: dateTime,
  arrivedAt: dateTime,
  customerNote: z
    .string()
    .trim()
    .max(SHIPMENT_LIMITS.customerNote, tooLong(SHIPMENT_LIMITS.customerNote)),
});

/**
 * Checks the whole form at once (field rules and the arrival-after-departure
 * rule together, so every problem shows on the first submit) and turns it
 * into the columns to write: empty text → null, times → ISO instants.
 */
export function validateShipmentForm(
  values: ShipmentFormValues,
): { ok: true; columns: ShipmentColumns } | { ok: false; errors: ShipmentFormErrors } {
  const errors: ShipmentFormErrors = {};
  const parsed = shipmentFieldsSchema.safeParse(values);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as ShipmentFormField | undefined;
      if (field && !errors[field]) errors[field] = issue.message;
    }
  }
  const departed = surinameDateTimeToIso(values.departedAt);
  const arrived = surinameDateTimeToIso(values.arrivedAt);
  if (departed && arrived && arrived < departed && !errors.arrivedAt) {
    errors.arrivedAt = t("admin.shipments.form.arrivedBeforeDeparted");
  }
  if (!parsed.success || Object.keys(errors).length > 0) return { ok: false, errors };
  const v = parsed.data;
  return {
    ok: true,
    columns: {
      shipment_number: v.shipmentNumber,
      service_type: v.serviceType,
      carrier: v.carrier || null,
      awb_or_container_number: v.awbOrContainerNumber || null,
      departed_at: departed,
      arrived_at: arrived,
      customer_note: v.customerNote || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Writes (the staff member's own client; RLS decides)
// ---------------------------------------------------------------------------

/** A taken shipment number (unique, case-insensitive) gets its own Dutch message. */
function shipmentWriteError(error: unknown, shipmentNumber: string): unknown {
  if (toAppError(error).code === "23505") {
    return new CodedError(t("admin.shipments.numberTaken", { number: shipmentNumber }), "23505");
  }
  return error;
}

/** "Zending aanmaken". */
export async function createShipment(client: Client, columns: ShipmentColumns): Promise<Shipment> {
  const { data, error } = await client
    .from("shipments")
    .insert(columns)
    .select(SHIPMENT_COLUMNS)
    .single();
  if (error) throw shipmentWriteError(error, columns.shipment_number);
  return data;
}

/**
 * "Gegevens wijzigen". RLS lets only staff update; for anyone else the update
 * matches no row, which is reported instead of a silent success.
 */
export async function updateShipment(
  client: Client,
  shipmentId: string,
  columns: ShipmentColumns,
): Promise<void> {
  const { data, error } = await client
    .from("shipments")
    .update(columns)
    .eq("id", shipmentId)
    .select("id");
  if (error) throw shipmentWriteError(error, columns.shipment_number);
  if (data.length === 0) throw new CodedError(t("admin.shipments.notSaved"), "P0002");
}

/** PATCH …?id=in.(…) stays well under URL limits in chunks of this size. */
const ID_CHUNK = 100;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface MembershipResult {
  /** Orders that were moved. */
  done: string[];
  /** Orders that were left alone (other service type, or not in the shipment). */
  skipped: string[];
}

/**
 * "Orders toevoegen": puts the orders in the shipment (an order in another
 * shipment moves over). Only orders of the shipment's service type are
 * changed: the filter is part of the update itself.
 */
export async function addOrdersToShipment(
  client: Client,
  shipment: Pick<Shipment, "id" | "service_type">,
  orderIds: readonly string[],
): Promise<MembershipResult> {
  const done: string[] = [];
  for (const ids of chunks([...new Set(orderIds)], ID_CHUNK)) {
    const { data, error } = await client
      .from("orders")
      .update({ shipment_id: shipment.id })
      .in("id", ids)
      .eq("service_type", shipment.service_type)
      .select("id");
    if (error) throw error;
    done.push(...data.map((r) => r.id));
  }
  return { done, skipped: orderIds.filter((id) => !done.includes(id)) };
}

/** "Uit zending halen": only orders that are in this shipment are changed. */
export async function removeOrdersFromShipment(
  client: Client,
  shipmentId: string,
  orderIds: readonly string[],
): Promise<MembershipResult> {
  const done: string[] = [];
  for (const ids of chunks([...new Set(orderIds)], ID_CHUNK)) {
    const { data, error } = await client
      .from("orders")
      .update({ shipment_id: null })
      .in("id", ids)
      .eq("shipment_id", shipmentId)
      .select("id");
    if (error) throw error;
    done.push(...data.map((r) => r.id));
  }
  return { done, skipped: orderIds.filter((id) => !done.includes(id)) };
}

// ---------------------------------------------------------------------------
// Which orders can go into a shipment
// ---------------------------------------------------------------------------

type CandidateLike = Pick<OrderRow, "id" | "service_type" | "shipment_id" | "created_at"> & {
  stage: StatusStage | null;
};

/** Why an order cannot be added to this shipment; null when it can. */
export type CandidateRefusal = "already" | "serviceType" | "closed";

export function candidateRefusal(
  order: CandidateLike,
  shipment: Pick<Shipment, "id" | "service_type">,
): CandidateRefusal | null {
  if (order.shipment_id === shipment.id) return "already";
  if (order.service_type !== shipment.service_type) return "serviceType";
  if (isClosedStage(order.stage)) return "closed";
  return null;
}

/** Received and waiting in the US warehouse first, then not yet received, then the rest. */
const readiness = (stage: StatusStage | null) =>
  stage === "us_warehouse" ? 0 : stage === "registered" ? 1 : stage === "action_required" ? 2 : 3;

/**
 * Orders staff can add: same service type, not picked up/delivered/cancelled,
 * not in this shipment yet. Ready ones first, those in no other shipment
 * before those that would move, oldest first within that.
 */
export function shipmentCandidates<T extends CandidateLike>(
  orders: readonly T[],
  shipment: Pick<Shipment, "id" | "service_type">,
): T[] {
  return orders
    .filter((o) => candidateRefusal(o, shipment) === null)
    .sort(
      (a, b) =>
        readiness(a.stage) - readiness(b.stage) ||
        Number(a.shipment_id !== null) - Number(b.shipment_id !== null) ||
        Date.parse(a.created_at) - Date.parse(b.created_at) ||
        a.id.localeCompare(b.id),
    );
}

/** The orders a "Status voor hele zending wijzigen" moves: all but the finished ones. */
export function openShipmentOrders<T extends { stage: StatusStage | null }>(
  orders: readonly T[],
): T[] {
  return orders.filter((o) => !isClosedStage(o.stage));
}
