import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { CurrencyCode } from "@/lib/format";
import { portalKeys } from "@/lib/portal/orders";

/**
 * Recent activity on the dashboard (SPEC §8, §35.7): derived from what the
 * customer can read — order registrations, status history (customer_visible
 * rows only), issued/cancelled invoices and payments. No notifications table.
 */

export type ActivityItem =
  | { kind: "order_registered"; key: string; at: string; orderId: string; reference: string }
  | {
      kind: "status_changed";
      key: string;
      at: string;
      orderId: string;
      reference: string | null;
      status: string;
      message: string | null;
    }
  | {
      kind: "invoice_issued" | "invoice_cancelled";
      key: string;
      at: string;
      invoiceNumber: string | null;
      amount: number | null;
      currency: CurrencyCode | null;
    }
  | {
      kind: "payment_received";
      key: string;
      at: string;
      paidOn: string;
      invoiceNumber: string | null;
      amount: number;
      currency: CurrencyCode | null;
    };

export interface ActivitySources {
  orders: readonly { id: string; reference: string; created_at: string }[];
  history: readonly {
    id: number;
    order_id: string;
    to_status: string;
    changed_at: string;
    customer_message: string | null;
    order: { reference: string } | null;
  }[];
  invoices: readonly {
    id: string | null;
    invoice_number: string | null;
    issued_at: string | null;
    cancelled_at: string | null;
    total_amount: number | null;
    currency: CurrencyCode | null;
  }[];
  payments: readonly {
    id: string;
    amount: number;
    paid_on: string;
    created_at: string;
    invoice: { invoice_number: string | null; currency: CurrencyCode } | null;
  }[];
}

export const ACTIVITY_LIMIT = 8;

/**
 * Newest first; ties keep a stable order by key. An invoice may come from
 * both invoice lists (newest issued, newest cancelled): it appears once.
 */
export function mergeActivity(sources: ActivitySources, limit = ACTIVITY_LIMIT): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const o of sources.orders) {
    items.push({
      kind: "order_registered",
      key: `o:${o.id}`,
      at: o.created_at,
      orderId: o.id,
      reference: o.reference,
    });
  }
  for (const h of sources.history) {
    items.push({
      kind: "status_changed",
      key: `h:${h.id}`,
      at: h.changed_at,
      orderId: h.order_id,
      reference: h.order?.reference ?? null,
      status: h.to_status,
      message: h.customer_message?.trim() || null,
    });
  }
  for (const i of sources.invoices) {
    if (!i.id) continue;
    const base = { invoiceNumber: i.invoice_number, amount: i.total_amount, currency: i.currency };
    if (i.issued_at)
      items.push({ kind: "invoice_issued", key: `i:${i.id}`, at: i.issued_at, ...base });
    if (i.cancelled_at) {
      items.push({ kind: "invoice_cancelled", key: `ic:${i.id}`, at: i.cancelled_at, ...base });
    }
  }
  for (const p of sources.payments) {
    items.push({
      kind: "payment_received",
      key: `p:${p.id}`,
      at: p.created_at,
      paidOn: p.paid_on,
      invoiceNumber: p.invoice?.invoice_number ?? null,
      amount: p.amount,
      currency: p.invoice?.currency ?? null,
    });
  }
  const unique = [...new Map(items.map((item) => [item.key, item])).values()];
  return unique
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.key.localeCompare(b.key))
    .slice(0, limit);
}

const INVOICE_COLUMNS =
  "id, invoice_number, issued_at, cancelled_at, total_amount, currency" as const;

/**
 * The newest items of each source, each filtered on the customer explicitly
 * (RLS would show staff everything): history and payments through an inner
 * join on their order / invoice. Cancellations are dated by cancelled_at, so
 * they get their own query: an old invoice cancelled today is news.
 */
export const activityQueryOptions = (userId: string, customerId: string) =>
  queryOptions({
    queryKey: portalKeys.activity(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<ActivityItem[]> => {
      const [orders, history, issued, cancelled, payments] = await Promise.all([
        supabase
          .from("orders")
          .select("id, reference, created_at")
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(ACTIVITY_LIMIT),
        supabase
          .from("shipment_status_history")
          .select(
            "id, order_id, to_status, changed_at, customer_message, order:orders!inner(reference, customer_id)",
          )
          .eq("order.customer_id", customerId)
          .order("changed_at", { ascending: false })
          .limit(ACTIVITY_LIMIT),
        supabase
          .from("invoice_overview")
          .select(INVOICE_COLUMNS)
          .eq("customer_id", customerId)
          .neq("status", "draft")
          .not("issued_at", "is", null)
          .order("issued_at", { ascending: false })
          .limit(ACTIVITY_LIMIT),
        supabase
          .from("invoice_overview")
          .select(INVOICE_COLUMNS)
          .eq("customer_id", customerId)
          .not("cancelled_at", "is", null)
          .order("cancelled_at", { ascending: false })
          .limit(ACTIVITY_LIMIT),
        supabase
          .from("payments")
          .select(
            "id, amount, paid_on, created_at, invoice:invoices!inner(invoice_number, currency, customer_id)",
          )
          .eq("invoice.customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(ACTIVITY_LIMIT),
      ]);
      for (const result of [orders, history, issued, cancelled, payments]) {
        if (result.error) throw result.error;
      }
      return mergeActivity({
        orders: orders.data ?? [],
        history: history.data ?? [],
        invoices: [...(issued.data ?? []), ...(cancelled.data ?? [])],
        payments: payments.data ?? [],
      });
    },
  });
