import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { adminKeys } from "@/lib/admin/keys";
import type { AdminOrderSearch } from "@/lib/admin/orders";
import type { StatusStage } from "@/lib/portal/orders";

type CustomerStatus = Database["public"]["Enums"]["customer_status"];
export type StaffTask = Pick<
  Database["public"]["Tables"]["staff_tasks"]["Row"],
  "id" | "kind" | "body" | "created_at" | "order_id" | "customer_id"
>;

export const staffProfileQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.profile(userId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return data?.display_name?.trim() || null;
    },
  });

async function countCustomers(status: CustomerStatus): Promise<number> {
  const { count, error } = await supabase
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  if (error) throw error;
  return count ?? 0;
}

/** Customers per status (RLS: staff see all customers). */
export const customerCountsQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.customerCounts(userId),
    staleTime: 30_000,
    queryFn: async () => {
      const [active, invited, disabled] = await Promise.all([
        countCustomers("active"),
        countCustomers("invited"),
        countCustomers("disabled"),
      ]);
      return { active, invited, disabled, total: active + invited + disabled };
    },
  });

// ---------------------------------------------------------------------------
// Operational counts (SPEC §12, §35.7): by stage, never by label
// ---------------------------------------------------------------------------

/** Every stage of the journey before hand-over has a tile, plus the two that need someone. */
export const ORDER_COUNT_KEYS = [
  "awaitingReceipt",
  "inUsWarehouse",
  "inTransit",
  "arrivedSr",
  "atCustoms",
  "cleared",
  "readyForPickup",
  "actionRequired",
  "cancellationRequests",
] as const;
export type OrderCountKey = (typeof ORDER_COUNT_KEYS)[number];
export type OrderCounts = Record<OrderCountKey, number>;

/** Where each count links to on /admin/orders (the same filter shows the same orders). */
export const ORDER_COUNT_SEARCH: Record<OrderCountKey, AdminOrderSearch> = {
  awaitingReceipt: { awaitingReceipt: true },
  inUsWarehouse: { stage: "us_warehouse" },
  inTransit: { stage: "in_transit" },
  arrivedSr: { stage: "arrived_sr" },
  atCustoms: { stage: "at_customs" },
  cleared: { stage: "cleared" },
  readyForPickup: { stage: "ready_for_pickup" },
  actionRequired: { stage: "action_required" },
  cancellationRequests: { cancellation: true },
};

/** Status codes per stage, from the configured statuses. */
export function codesByStage(
  statuses: readonly { code: string; stage: StatusStage }[],
): Map<StatusStage, string[]> {
  const map = new Map<StatusStage, string[]>();
  for (const s of statuses) map.set(s.stage, [...(map.get(s.stage) ?? []), s.code]);
  return map;
}

async function countOrders(
  codes: readonly string[],
  { notReceived = false }: { notReceived?: boolean } = {},
): Promise<number> {
  if (codes.length === 0) return 0;
  let query = supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .in("status", [...codes]);
  if (notReceived) query = query.is("received_at", null);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/**
 * The admin dashboard's order counts. "Wacht op ontvangst" is the
 * registered stage plus "Actie vereist" before receipt, exactly what the
 * list's filter of the same name shows; cancellation requests are the open
 * staff tasks of that kind.
 */
export const orderCountsQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.orderCounts(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<OrderCounts> => {
      const { data, error } = await supabase.from("shipment_statuses").select("code, stage");
      if (error) throw error;
      const codes = codesByStage(data);
      const of = (stage: StatusStage) => codes.get(stage) ?? [];
      const [
        registered,
        actionNotReceived,
        inUsWarehouse,
        inTransit,
        arrivedSr,
        atCustoms,
        cleared,
        ready,
        action,
        cancellations,
      ] = await Promise.all([
        countOrders(of("registered")),
        countOrders(of("action_required"), { notReceived: true }),
        countOrders(of("us_warehouse")),
        countOrders(of("in_transit")),
        countOrders(of("arrived_sr")),
        countOrders(of("at_customs")),
        countOrders(of("cleared")),
        countOrders(of("ready_for_pickup")),
        countOrders(of("action_required")),
        supabase
          .from("staff_tasks")
          .select("id", { count: "exact", head: true })
          .eq("kind", "order_cancellation_request")
          .is("resolved_at", null)
          .then(({ count, error: taskError }) => {
            if (taskError) throw taskError;
            return count ?? 0;
          }),
      ]);
      return {
        awaitingReceipt: registered + actionNotReceived,
        inUsWarehouse,
        inTransit,
        arrivedSr,
        atCustoms,
        cleared,
        readyForPickup: ready,
        actionRequired: action,
        cancellationRequests: cancellations,
      };
    },
  });

// ---------------------------------------------------------------------------
// Staff tasks
// ---------------------------------------------------------------------------

export const OPEN_TASKS_SHOWN = 8;
/** "Alle open taken tonen": every open task (far above any real backlog). */
export const OPEN_TASKS_ALL = 500;

/**
 * Open staff tasks, the ones waiting longest first (a work queue: an old
 * signup conflict must not hide behind newer requests), plus the total.
 * "first" is the dashboard's short list, "all" the expanded one.
 */
export const openTasksQueryOptions = (userId: string, scope: "first" | "all" = "first") =>
  queryOptions({
    queryKey: adminKeys.openTasks(userId, scope),
    staleTime: 30_000,
    queryFn: async (): Promise<{ tasks: StaffTask[]; total: number }> => {
      const { data, error, count } = await supabase
        .from("staff_tasks")
        .select("id, kind, body, created_at, order_id, customer_id", { count: "exact" })
        .is("resolved_at", null)
        .order("created_at", { ascending: true })
        .order("id")
        .limit(scope === "all" ? OPEN_TASKS_ALL : OPEN_TASKS_SHOWN);
      if (error) throw error;
      return { tasks: data, total: count ?? data.length };
    },
  });

/**
 * Marks a task done (RLS: staff update). The database stamps resolved_by;
 * a task someone else resolved in the meantime is left alone (.is filter).
 */
export async function resolveStaffTask(taskId: string): Promise<void> {
  const { error } = await supabase
    .from("staff_tasks")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", taskId)
    .is("resolved_at", null);
  if (error) throw error;
}

/** Cancellation requests are decided on the order page (annuleren of behouden), not ticked off. */
export const resolvableFromDashboard = (task: Pick<StaffTask, "kind">) =>
  task.kind !== "order_cancellation_request";
