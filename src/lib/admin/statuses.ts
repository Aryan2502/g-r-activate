import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { adminKeys } from "@/lib/admin/keys";
import { JOURNEY_STAGES, type StatusStage } from "@/lib/portal/orders";

/**
 * Order statuses as staff see them (SPEC §11, §35.7): every row of
 * shipment_statuses, also inactive and customer-invisible ones (existing
 * orders and history still use them). Stages, never labels, drive the logic.
 */

type Tables = Database["public"]["Tables"];

export type StatusRow = Tables["shipment_statuses"]["Row"];
/** Keyed by code; also usable where the portal's StatusMap is expected. */
export type AdminStatusMap = ReadonlyMap<string, StatusRow>;

export const adminStatusesQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.statuses(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<AdminStatusMap> => {
      const { data, error } = await supabase
        .from("shipment_statuses")
        .select("*")
        .order("sort_order")
        .order("code");
      if (error) throw error;
      return new Map(data.map((s) => [s.code, s]));
    },
  });

export type OperationalSettings = Pick<
  Tables["company_settings"]["Row"],
  | "pay_before_pickup"
  | "delivery_available"
  | "pickup_address"
  | "pickup_hours"
  | "pickup_instructions"
>;

/** Defaults of company_settings (SPEC §35.8) while the row cannot be read. */
export const DEFAULT_OPERATIONAL_SETTINGS: OperationalSettings = {
  pay_before_pickup: true,
  delivery_available: false,
  pickup_address: null,
  pickup_hours: null,
  pickup_instructions: null,
};

export const operationalSettingsQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.settings(userId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<OperationalSettings> => {
      const { data, error } = await supabase
        .from("company_settings")
        .select(
          "pay_before_pickup, delivery_available, pickup_address, pickup_hours, pickup_instructions",
        )
        .maybeSingle();
      if (error) throw error;
      return data ?? DEFAULT_OPERATIONAL_SETTINGS;
    },
  });

/** Stages in display order: the journey, then the off-path stages. */
export const STAGE_DISPLAY_ORDER: readonly StatusStage[] = [
  ...JOURNEY_STAGES,
  "action_required",
  "cancelled",
];

/** The seeded "Bezorgd" status: offered only while delivery_available is on (SPEC §35.7). */
export const DELIVERED_STATUS = "delivered";

const bySortOrder = (a: StatusRow, b: StatusRow) =>
  a.sort_order - b.sort_order || a.code.localeCompare(b.code);

/**
 * What staff can move orders to: active statuses only (change_order_status
 * refuses the others), without "Bezorgd" unless G&R delivers.
 */
export function selectableStatuses(
  statuses: AdminStatusMap,
  { deliveryAvailable }: { deliveryAvailable: boolean },
): StatusRow[] {
  return [...statuses.values()]
    .filter((s) => s.active && (deliveryAvailable || s.code !== DELIVERED_STATUS))
    .sort(bySortOrder);
}

/** The first active status of a stage (what receive_order and the shortcuts use). */
export function firstActiveStatus(
  statuses: AdminStatusMap,
  stage: StatusStage,
  { deliveryAvailable = true }: { deliveryAvailable?: boolean } = {},
): StatusRow | null {
  return selectableStatuses(statuses, { deliveryAvailable }).find((s) => s.stage === stage) ?? null;
}

/**
 * "Klant e-mailen" starts at the status's notify_customer; a status the
 * customer cannot see is never e-mailed.
 */
export function defaultNotify(status: Pick<StatusRow, "notify_customer" | "customer_visible">) {
  return status.customer_visible && status.notify_customer;
}

/** Stages where the order is finished: picked up / delivered, or cancelled. */
export const isClosedStage = (stage: StatusStage | null) =>
  stage === "completed" || stage === "cancelled";

/**
 * receive_order accepts an order that is registered, already in the US
 * warehouse (then it only corrects the weight), or waiting for an action
 * before it was ever received.
 */
export function canReceive(stage: StatusStage | null, receivedAt: string | null): boolean {
  return (
    stage === "registered" ||
    stage === "us_warehouse" ||
    (stage === "action_required" && receivedAt === null)
  );
}

const journeyIndex = (stage: StatusStage | null) =>
  stage ? (JOURNEY_STAGES as readonly StatusStage[]).indexOf(stage) : -1;

/** Stages an order only reaches after it left the US warehouse. */
const PAST_WAREHOUSE_STAGES: readonly StatusStage[] = [
  "in_transit",
  "arrived_sr",
  "at_customs",
  "cleared",
  "ready_for_pickup",
  "completed",
];

/**
 * An order G&R can still receive, but has not (no received_at), must be
 * received with its measured weight before it moves past the US warehouse:
 * after that receive_order refuses it, so the receipt would never be
 * recorded (P4 review). The status dialog leaves such orders out.
 */
export function mustReceiveFirst(
  order: { stage: StatusStage | null; receivedAt: string | null },
  toStage: StatusStage | null,
): boolean {
  return (
    toStage !== null &&
    order.receivedAt === null &&
    canReceive(order.stage, order.receivedAt) &&
    PAST_WAREHOUSE_STAGES.includes(toStage)
  );
}

/**
 * Past the US warehouse and still open: receive_order no longer accepts the
 * order, so "Gewicht invullen/corrigeren" sets measured_weight_lbs directly
 * (updateMeasuredWeight; a staff-editable column).
 */
export function canSetWeightDirectly(
  stage: StatusStage | null,
  receivedAt: string | null,
): boolean {
  return stage !== null && !isClosedStage(stage) && !canReceive(stage, receivedAt);
}

type WeightTarget = { stage: StatusStage | null; received_at: string | null };

/**
 * What the receive dialog does for an order:
 * - "receive": receive_order records the weight and the receipt and moves the
 *   order to the first active US-warehouse status (receiveOrderFn);
 * - "correct": received and still in the US warehouse: receive_order only
 *   corrects the weight;
 * - "weight": past the US warehouse (receive_order refuses it): the measured
 *   weight is set directly, for invoicing (updateMeasuredWeight).
 */
export type ReceiveMode = "receive" | "correct" | "weight";

export function receiveMode(order: WeightTarget): ReceiveMode {
  if (!canReceive(order.stage, order.received_at)) return "weight";
  return order.stage === "us_warehouse" && order.received_at !== null ? "correct" : "receive";
}

/**
 * The weight action an order offers (its admin.actions label), or null for a
 * closed order: "Ontvangen in US-magazijn", "Gewicht corrigeren" or, past the
 * warehouse without a weight, "Gewicht invullen".
 */
export function weightAction(
  order: WeightTarget & { measured_weight_lbs: number | null },
): "receive" | "correctWeight" | "setWeight" | null {
  if (canReceive(order.stage, order.received_at)) {
    return receiveMode(order) === "correct" ? "correctWeight" : "receive";
  }
  if (!canSetWeightDirectly(order.stage, order.received_at)) return null;
  return order.measured_weight_lbs === null ? "setWeight" : "correctWeight";
}

/**
 * The status an order most likely moves to next (SPEC §26: fewer clicks):
 * the "Standaard" status of the next journey stage that has one. None for an
 * order that still has to be received ("Ontvangen" is the next step), for
 * "Actie vereist", for cancelled orders and at the end of the journey.
 */
export function suggestedNextStatus(
  statuses: AdminStatusMap,
  order: { status: string; receivedAt: string | null },
  { deliveryAvailable }: { deliveryAvailable: boolean },
): StatusRow | null {
  const stage = statuses.get(order.status)?.stage ?? null;
  const index = journeyIndex(stage);
  if (index < 0) return null;
  if (order.receivedAt === null && index <= journeyIndex("us_warehouse")) return null;
  for (const next of JOURNEY_STAGES.slice(index + 1)) {
    const status = firstActiveStatus(statuses, next, { deliveryAvailable });
    if (status) return status;
  }
  return null;
}

/** Not yet in G&R's hands: what the "Wacht op ontvangst" filter and count show. */
export function isAwaitingReceipt(stage: StatusStage | null, receivedAt: string | null): boolean {
  return stage === "registered" || (stage === "action_required" && receivedAt === null);
}

const CUSTOMS = journeyIndex("at_customs");

/** Document kinds customs needs for a business shipment (SPEC §35.7). */
export const B2B_CUSTOMS_DOCUMENT_KINDS = ["commercial_invoice", "packing_list"] as const;

/**
 * SPEC §35.7: before a B2B order reaches the at_customs stage, warn (never
 * block) when neither a commercial invoice nor a packing list is uploaded.
 * Warns when the move reaches customs or a later stage of the journey from a
 * stage before customs (action required counts as before).
 */
export function needsB2bCustomsWarning({
  orderType,
  fromStage,
  toStage,
  hasCustomsDocuments,
}: {
  orderType: Database["public"]["Enums"]["order_type"];
  fromStage: StatusStage | null;
  toStage: StatusStage;
  hasCustomsDocuments: boolean;
}): boolean {
  if (orderType !== "b2b" || hasCustomsDocuments) return false;
  if (journeyIndex(toStage) < CUSTOMS) return false;
  return journeyIndex(fromStage) < CUSTOMS;
}
