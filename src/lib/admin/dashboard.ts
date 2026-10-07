import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { adminKeys } from "@/lib/admin/keys";
import { allPages, type AdminOrderSearch } from "@/lib/admin/orders";
import type { CurrencyCode } from "@/lib/format";
import {
  OPEN_INVOICE_STATUSES,
  totalsByCurrency,
  type CurrencyAmount,
} from "@/lib/portal/invoices";
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

/** "Nieuw" on the dashboard: the last 30 days. */
export const RECENT_DAYS = 30;

/** The instant `days` days before `now`, for created_at >= filters. */
export function daysAgo(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/** Customers per status, plus those added in the last 30 days (RLS: staff see all customers). */
export const customerCountsQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.customerCounts(userId),
    staleTime: 30_000,
    queryFn: async () => {
      const [active, invited, disabled, recent] = await Promise.all([
        countCustomers("active"),
        countCustomers("invited"),
        countCustomers("disabled"),
        supabase
          .from("customers")
          .select("id", { count: "exact", head: true })
          .gte("created_at", daysAgo(RECENT_DAYS))
          .then(({ count, error }) => {
            if (error) throw error;
            return count ?? 0;
          }),
      ]);
      return { active, invited, disabled, total: active + invited + disabled, recent };
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

// ---------------------------------------------------------------------------
// Orders and invoices at a glance (SPEC §12): from invoice_overview, per currency
// ---------------------------------------------------------------------------

/** Stages after which an order is no longer "lopend". */
const FINISHED_STAGES: readonly StatusStage[] = ["completed", "cancelled"];

export interface OrderStats {
  /** Registered in the last 30 days (by customers or staff). */
  recent: number;
  /** Not handed over and not cancelled. */
  open: number;
}

export const orderStatsQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.orderStats(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<OrderStats> => {
      const statuses = await supabase.from("shipment_statuses").select("code, stage");
      if (statuses.error) throw statuses.error;
      const finished = statuses.data
        .filter((s) => FINISHED_STAGES.includes(s.stage))
        .map((s) => s.code);
      let open = supabase.from("orders").select("id", { count: "exact", head: true });
      if (finished.length > 0) open = open.not("status", "in", `(${finished.join(",")})`);
      const [recent, openCount] = await Promise.all([
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .gte("created_at", daysAgo(RECENT_DAYS)),
        open,
      ]);
      if (recent.error) throw recent.error;
      if (openCount.error) throw openCount.error;
      return { recent: recent.count ?? 0, open: openCount.count ?? 0 };
    },
  });

type OverviewRow = Database["public"]["Views"]["invoice_overview"]["Row"];
export type OpenInvoiceRow = Pick<OverviewRow, "currency" | "balance_due" | "is_overdue">;

export interface InvoiceStats {
  /** Open or partially paid (overdue included). */
  openCount: number;
  overdueCount: number;
  paidCount: number;
  /** Paid in full in the last 30 days (paid_at). */
  paidRecent: number;
  draftCount: number;
  /** Still to be paid, per currency (SPEC §35.10: never summed across currencies). */
  outstanding: CurrencyAmount[];
  overdueOutstanding: CurrencyAmount[];
}

export function summarizeInvoiceStats(
  open: readonly OpenInvoiceRow[],
  counts: { paid: number; paidRecent: number; drafts: number },
): InvoiceStats {
  const withBalance = open.filter((r) => (r.balance_due ?? 0) > 0);
  const overdue = withBalance.filter((r) => r.is_overdue === true);
  const amounts = (rows: readonly OpenInvoiceRow[]) =>
    totalsByCurrency(rows.map((r) => ({ currency: r.currency, amount: r.balance_due })));
  return {
    openCount: open.length,
    overdueCount: overdue.length,
    paidCount: counts.paid,
    paidRecent: counts.paidRecent,
    draftCount: counts.drafts,
    outstanding: amounts(withBalance),
    overdueOutstanding: amounts(overdue),
  };
}

const invoiceCount = () => supabase.from("invoices").select("id", { count: "exact", head: true });

async function countOf(query: PromiseLike<{ count: number | null; error: unknown }>) {
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/** Invoice KPIs; overdue and balances are computed by invoice_overview, never stored. */
export const invoiceStatsQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.invoiceStats(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<InvoiceStats> => {
      const [open, paid, paidRecent, drafts] = await Promise.all([
        allPages<OpenInvoiceRow & { id: string | null }>((from, to) =>
          supabase
            .from("invoice_overview")
            .select("id, currency, balance_due, is_overdue")
            .in("status", OPEN_INVOICE_STATUSES)
            .order("id")
            .range(from, to),
        ),
        countOf(invoiceCount().eq("status", "paid")),
        countOf(invoiceCount().eq("status", "paid").gte("paid_at", daysAgo(RECENT_DAYS))),
        countOf(invoiceCount().eq("status", "draft")),
      ]);
      return summarizeInvoiceStats(open, { paid, paidRecent, drafts });
    },
  });

// ---------------------------------------------------------------------------
// Recent activity (SPEC §12, §35.7: derived, no notifications table)
// ---------------------------------------------------------------------------

type ActivityCustomer = { id: string; full_name: string; customer_code: string } | null;

export type StaffActivity =
  | {
      kind: "status_changed";
      key: string;
      at: string;
      orderId: string;
      reference: string | null;
      customer: ActivityCustomer;
      status: string;
      by: string | null;
    }
  | { kind: "customer_created"; key: string; at: string; customer: NonNullable<ActivityCustomer> }
  | {
      kind: "invitation_accepted";
      key: string;
      at: string;
      invitationKind: Database["public"]["Enums"]["invitation_kind"];
      email: string;
      customer: ActivityCustomer;
    }
  | {
      kind: "invoice_issued" | "invoice_cancelled";
      key: string;
      at: string;
      /** Links to /admin/facturen/<id>. */
      invoiceId: string;
      invoiceNumber: string | null;
      amount: number;
      currency: CurrencyCode;
      customer: ActivityCustomer;
    }
  | {
      kind: "payment_recorded";
      key: string;
      at: string;
      amount: number;
      currency: CurrencyCode | null;
      invoiceId: string | null;
      invoiceNumber: string | null;
      customer: ActivityCustomer;
    };

export interface StaffActivitySources {
  history: readonly {
    id: number;
    order_id: string;
    to_status: string;
    changed_at: string;
    changed_by: string | null;
    order: { reference: string; customer: ActivityCustomer } | null;
  }[];
  customers: readonly {
    id: string;
    full_name: string;
    customer_code: string;
    created_at: string;
  }[];
  invitations: readonly {
    id: string;
    kind: Database["public"]["Enums"]["invitation_kind"];
    email: string;
    accepted_at: string | null;
    customer: ActivityCustomer;
  }[];
  invoices: readonly {
    id: string;
    invoice_number: string | null;
    issued_at: string | null;
    cancelled_at: string | null;
    total_amount: number;
    currency: CurrencyCode;
    customer: ActivityCustomer;
  }[];
  payments: readonly {
    id: string;
    /** The invoice paid (links to /admin/facturen/<id>). */
    invoice_id?: string | null;
    amount: number;
    created_at: string;
    invoice: {
      invoice_number: string | null;
      currency: CurrencyCode;
      customer: ActivityCustomer;
    } | null;
  }[];
}

export const STAFF_ACTIVITY_LIMIT = 12;

/** Newest first, each item once; ties ordered by key so the list does not jump. */
export function mergeStaffActivity(
  sources: StaffActivitySources,
  limit = STAFF_ACTIVITY_LIMIT,
): StaffActivity[] {
  const items: StaffActivity[] = [];
  for (const h of sources.history) {
    items.push({
      kind: "status_changed",
      key: `h:${h.id}`,
      at: h.changed_at,
      orderId: h.order_id,
      reference: h.order?.reference ?? null,
      customer: h.order?.customer ?? null,
      status: h.to_status,
      by: h.changed_by,
    });
  }
  for (const c of sources.customers) {
    items.push({ kind: "customer_created", key: `c:${c.id}`, at: c.created_at, customer: c });
  }
  for (const i of sources.invitations) {
    if (!i.accepted_at) continue;
    items.push({
      kind: "invitation_accepted",
      key: `a:${i.id}`,
      at: i.accepted_at,
      invitationKind: i.kind,
      email: i.email,
      customer: i.customer,
    });
  }
  for (const i of sources.invoices) {
    const base = {
      invoiceId: i.id,
      invoiceNumber: i.invoice_number,
      amount: i.total_amount,
      currency: i.currency,
      customer: i.customer,
    };
    if (i.issued_at)
      items.push({ kind: "invoice_issued", key: `i:${i.id}`, at: i.issued_at, ...base });
    if (i.cancelled_at) {
      items.push({ kind: "invoice_cancelled", key: `ic:${i.id}`, at: i.cancelled_at, ...base });
    }
  }
  for (const p of sources.payments) {
    items.push({
      kind: "payment_recorded",
      key: `p:${p.id}`,
      at: p.created_at,
      amount: p.amount,
      currency: p.invoice?.currency ?? null,
      invoiceId: p.invoice_id ?? null,
      invoiceNumber: p.invoice?.invoice_number ?? null,
      customer: p.invoice?.customer ?? null,
    });
  }
  const unique = [...new Map(items.map((item) => [item.key, item])).values()];
  return unique
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.key.localeCompare(b.key))
    .slice(0, limit);
}

const ACTIVITY_CUSTOMER = "customer:customers(id, full_name, customer_code)" as const;
const ACTIVITY_INVOICE_COLUMNS =
  `id, invoice_number, issued_at, cancelled_at, total_amount, currency, ${ACTIVITY_CUSTOMER}` as const;

/** The newest items of each source; everything staff may read (RLS: is_staff). */
export const recentActivityQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.recentActivity(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<StaffActivity[]> => {
      const n = STAFF_ACTIVITY_LIMIT;
      const [history, customers, invitations, issued, cancelled, payments] = await Promise.all([
        supabase
          .from("shipment_status_history")
          .select(
            `id, order_id, to_status, changed_at, changed_by, order:orders(reference, ${ACTIVITY_CUSTOMER})`,
          )
          .order("changed_at", { ascending: false })
          .limit(n),
        supabase
          .from("customers")
          .select("id, full_name, customer_code, created_at")
          .order("created_at", { ascending: false })
          .limit(n),
        supabase
          .from("invitations")
          .select(`id, kind, email, accepted_at, ${ACTIVITY_CUSTOMER}`)
          .not("accepted_at", "is", null)
          .order("accepted_at", { ascending: false })
          .limit(n),
        supabase
          .from("invoices")
          .select(ACTIVITY_INVOICE_COLUMNS)
          .not("issued_at", "is", null)
          .order("issued_at", { ascending: false })
          .limit(n),
        supabase
          .from("invoices")
          .select(ACTIVITY_INVOICE_COLUMNS)
          .not("cancelled_at", "is", null)
          .order("cancelled_at", { ascending: false })
          .limit(n),
        supabase
          .from("payments")
          .select(
            `id, invoice_id, amount, created_at, invoice:invoices(invoice_number, currency, ${ACTIVITY_CUSTOMER})`,
          )
          .order("created_at", { ascending: false })
          .limit(n),
      ]);
      for (const result of [history, customers, invitations, issued, cancelled, payments]) {
        if (result.error) throw result.error;
      }
      return mergeStaffActivity({
        history: history.data ?? [],
        customers: customers.data ?? [],
        invitations: invitations.data ?? [],
        invoices: [...(issued.data ?? []), ...(cancelled.data ?? [])],
        payments: payments.data ?? [],
      });
    },
  });
