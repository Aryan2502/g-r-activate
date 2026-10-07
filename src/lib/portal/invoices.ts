import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { Constants, type Database } from "@/integrations/supabase/types";
import { roundHalfUp, type CurrencyCode } from "@/lib/format";
import { portalKeys } from "@/lib/portal/orders";

/**
 * Invoices as the customer sees them (SPEC §35.9/§35.10). RLS shows only the
 * customer's own non-draft invoices; the queries say so explicitly as well
 * (customer and status filters), because RLS shows staff every invoice. Every
 * badge, count and balance reads invoice_overview, where overdue is computed
 * (never stored).
 */

type InvoiceStatus = Database["public"]["Enums"]["invoice_status"];
type OverviewRow = Database["public"]["Views"]["invoice_overview"]["Row"];

/** Customer badges (SPEC §35.10): always text plus icon, never colour alone. */
export type InvoiceBadgeKey =
  "draft" | "open" | "partially_paid" | "paid" | "overdue" | "cancelled";
export type InvoiceBadgeTone = "neutral" | "warning" | "success" | "danger";

export function invoiceBadgeKey(invoice: {
  status: InvoiceStatus | null;
  is_overdue: boolean | null;
}): InvoiceBadgeKey {
  if (invoice.is_overdue) return "overdue";
  return invoice.status ?? "open";
}

export function invoiceBadgeTone(key: InvoiceBadgeKey): InvoiceBadgeTone {
  switch (key) {
    case "paid":
      return "success";
    case "overdue":
      return "danger";
    case "open":
    case "partially_paid":
      return "warning";
    default:
      return "neutral";
  }
}

/** Invoices that still need paying (overdue ones included). */
export const OPEN_INVOICE_STATUSES = [
  "open",
  "partially_paid",
] as const satisfies readonly InvoiceStatus[];

export interface CurrencyAmount {
  currency: CurrencyCode;
  amount: number;
}

const CURRENCY_ORDER: readonly CurrencyCode[] = Constants.public.Enums.currency_code;

/**
 * Sums amounts per currency, never across currencies (SPEC §35.10). Sums in
 * cents so 0.1 + 0.2 is exactly 0.30. Currencies whose total is zero are
 * left out; the result is in a fixed order (USD, EUR, SRD).
 */
export function totalsByCurrency(
  rows: readonly { currency: CurrencyCode | null; amount: number | string | null }[],
): CurrencyAmount[] {
  const cents = new Map<CurrencyCode, number>();
  for (const row of rows) {
    if (!row.currency || row.amount === null) continue;
    const value = Math.round(roundHalfUp(row.amount, 2) * 100);
    cents.set(row.currency, (cents.get(row.currency) ?? 0) + value);
  }
  return CURRENCY_ORDER.flatMap((currency) => {
    const total = cents.get(currency) ?? 0;
    return total === 0 ? [] : [{ currency, amount: total / 100 }];
  });
}

export interface InvoiceSummary {
  /** Open or partially paid (overdue included). */
  openCount: number;
  overdueCount: number;
  /** Outstanding balance per currency. */
  outstanding: CurrencyAmount[];
  /**
   * Orders with a line on one of those invoices, those with an overdue
   * invoice first: the way to the invoices until the invoice pages exist.
   */
  orders: { orderId: string; overdue: boolean }[];
}

export function summarizeOpenInvoices(
  rows: readonly Pick<OverviewRow, "id" | "status" | "is_overdue" | "currency" | "balance_due">[],
  items: readonly { invoice_id: string; order_id: string | null }[] = [],
): InvoiceSummary {
  const open = rows.filter((r) => r.status === "open" || r.status === "partially_paid");
  const overdueIds = new Set(open.filter((r) => r.is_overdue === true).map((r) => r.id));
  const openIds = new Set(open.map((r) => r.id));
  const orders = new Map<string, boolean>();
  for (const item of items) {
    if (!item.order_id || !openIds.has(item.invoice_id)) continue;
    orders.set(
      item.order_id,
      (orders.get(item.order_id) ?? false) || overdueIds.has(item.invoice_id),
    );
  }
  return {
    openCount: open.length,
    overdueCount: overdueIds.size,
    outstanding: totalsByCurrency(
      open.map((r) => ({ currency: r.currency, amount: r.balance_due })),
    ),
    orders: [...orders]
      .map(([orderId, overdue]) => ({ orderId, overdue }))
      .sort((a, b) => Number(b.overdue) - Number(a.overdue)),
  };
}

/** Dashboard card "Openstaande facturen". */
export const invoiceSummaryQueryOptions = (userId: string, customerId: string) =>
  queryOptions({
    queryKey: portalKeys.invoiceSummary(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<InvoiceSummary> => {
      const { data, error } = await supabase
        .from("invoice_overview")
        .select("id, status, is_overdue, currency, balance_due")
        .eq("customer_id", customerId)
        .in("status", OPEN_INVOICE_STATUSES);
      if (error) throw error;
      const ids = data.flatMap((r) => (r.id ? [r.id] : []));
      if (ids.length === 0) return summarizeOpenInvoices(data);
      const items = await supabase
        .from("invoice_items")
        .select("invoice_id, order_id")
        .in("invoice_id", ids);
      if (items.error) throw items.error;
      return summarizeOpenInvoices(data, items.data);
    },
  });

/** Open or partially paid with a balance: what still has to be paid. */
export const needsPayment = (invoice: Pick<OverviewRow, "status" | "balance_due">) =>
  (invoice.status === "open" || invoice.status === "partially_paid") &&
  (invoice.balance_due ?? 0) > 0;

/** What is still to be paid on these invoices, per currency (pickup banner). */
export function unpaidByCurrency(
  invoices: readonly Pick<OverviewRow, "status" | "balance_due" | "currency">[],
): CurrencyAmount[] {
  return totalsByCurrency(
    invoices.filter(needsPayment).map((i) => ({ currency: i.currency, amount: i.balance_due })),
  );
}

const ORDER_INVOICE_COLUMNS =
  "id, invoice_number, invoice_date, due_date, currency, total_amount, amount_paid, balance_due, status, is_overdue, days_overdue, paid_at, cancel_reason" as const;

export type OrderInvoice = Pick<
  OverviewRow,
  | "id"
  | "invoice_number"
  | "invoice_date"
  | "due_date"
  | "currency"
  | "total_amount"
  | "amount_paid"
  | "balance_due"
  | "status"
  | "is_overdue"
  | "days_overdue"
  | "paid_at"
  | "cancel_reason"
>;

/**
 * Issued invoices with at least one line for this order (invoice_items →
 * invoice_overview; customers only see lines of their own issued invoices).
 */
export const orderInvoicesQueryOptions = (userId: string, customerId: string, orderId: string) =>
  queryOptions({
    queryKey: portalKeys.orderInvoices(userId, orderId),
    staleTime: 30_000,
    queryFn: async (): Promise<OrderInvoice[]> => {
      const items = await supabase
        .from("invoice_items")
        .select("invoice_id")
        .eq("order_id", orderId);
      if (items.error) throw items.error;
      const ids = [...new Set(items.data.map((i) => i.invoice_id))];
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("invoice_overview")
        .select(ORDER_INVOICE_COLUMNS)
        .in("id", ids)
        .eq("customer_id", customerId)
        .neq("status", "draft")
        .order("invoice_date", { ascending: false })
        .order("invoice_number", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
