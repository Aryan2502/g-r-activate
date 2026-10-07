import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  BILL_TO_COLUMNS,
  loadBuilderOrders,
  loadDraft,
  type BuilderCustomer,
} from "@/lib/admin/invoice-builder";
import { adminKeys } from "@/lib/admin/keys";
import type { InvoiceItemRow, IssuedInvoiceRow } from "@/lib/invoice/model";
import { isUuid } from "@/lib/portal/orders";

/**
 * Reads of the invoice builder and an invoice's page, with the staff
 * member's own client (RLS: staff see every invoice, drafts too).
 */

/** The customer as the preview prints them. */
export const invoiceCustomerQueryOptions = (userId: string, customerId: string) =>
  queryOptions({
    queryKey: adminKeys.invoiceCustomer(userId, customerId),
    staleTime: 30_000,
    queryFn: async (): Promise<BuilderCustomer | null> => {
      if (!isUuid(customerId)) return null;
      const { data, error } = await supabase
        .from("customers")
        .select(BILL_TO_COLUMNS)
        .eq("id", customerId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

/** The customer's orders, with freight already billed on another (non-cancelled) invoice. */
export const invoiceBuilderOrdersQueryOptions = (
  userId: string,
  customerId: string,
  invoiceId: string | null,
) =>
  queryOptions({
    queryKey: adminKeys.invoiceBuilderOrders(userId, customerId, invoiceId),
    staleTime: 10_000,
    queryFn: () => loadBuilderOrders(supabase, customerId, invoiceId),
  });

/** A draft with its lines (null when it does not exist). */
export const invoiceDraftQueryOptions = (userId: string, invoiceId: string) =>
  queryOptions({
    queryKey: [...adminKeys.invoice(userId, invoiceId), "draft"] as const,
    staleTime: 0,
    queryFn: () => (isUuid(invoiceId) ? loadDraft(supabase, invoiceId) : Promise.resolve(null)),
  });

const INVOICE_VIEW_COLUMNS =
  "id, invoice_number, status, customer_id, currency, invoice_date, due_date, customer_note, paid_at, total_lbs, subtotal_freight, total_charges, total_discount, total_amount, vat_rate, vat_amount, issuer_snapshot, bill_to_snapshot, amount_paid, balance_due, is_overdue, days_overdue, cancelled_at, cancelled_by, cancel_reason, replaces_invoice_id, issued_at, issued_by, first_reminder_sent_at, last_reminder_sent_at, reminder_count, late_fee_applied_at, created_at, created_by" as const;

export type InvoiceViewRow = IssuedInvoiceRow & {
  customer_id: string | null;
  amount_paid: number | null;
  balance_due: number | null;
  is_overdue: boolean | null;
  days_overdue: number | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  replaces_invoice_id: string | null;
  issued_at: string | null;
  issued_by: string | null;
  /** Reminder bookkeeping (runPaymentReminders fills it; shown read-only). */
  first_reminder_sent_at: string | null;
  last_reminder_sent_at: string | null;
  reminder_count: number | null;
  late_fee_applied_at: string | null;
  /** When and by whom the draft was made (the invoice's history, P9). */
  created_at?: string | null;
  created_by?: string | null;
};

/**
 * One invoice from invoice_overview (overdue and balance computed there) and
 * its lines: what fromIssuedInvoice() renders.
 */
export const invoiceViewQueryOptions = (userId: string, invoiceId: string) =>
  queryOptions({
    queryKey: [...adminKeys.invoice(userId, invoiceId), "view"] as const,
    staleTime: 10_000,
    queryFn: async (): Promise<{ invoice: InvoiceViewRow; items: InvoiceItemRow[] } | null> => {
      if (!isUuid(invoiceId)) return null;
      const { data: invoice, error } = await supabase
        .from("invoice_overview")
        .select(INVOICE_VIEW_COLUMNS)
        .eq("id", invoiceId)
        .maybeSingle();
      if (error) throw error;
      if (!invoice) return null;
      const { data: items, error: itemsError } = await supabase
        .from("invoice_items")
        .select(
          "id, line_type, description, order_id, weight_lbs, rate_per_lb, amount, vat_exempt, sort_order",
        )
        .eq("invoice_id", invoiceId)
        .order("sort_order");
      if (itemsError) throw itemsError;
      return { invoice, items };
    },
  });

export const INVOICE_PAYMENT_COLUMNS =
  "id, invoice_id, amount, paid_on, method, reference, received_amount, received_currency, customer_note, recorded_by, created_at, voided_at, voided_by, void_reason" as const;

export type InvoicePayment = Pick<
  Database["public"]["Tables"]["payments"]["Row"],
  | "id"
  | "invoice_id"
  | "amount"
  | "paid_on"
  | "method"
  | "reference"
  | "received_amount"
  | "received_currency"
  | "customer_note"
  | "recorded_by"
  | "created_at"
  | "voided_at"
  | "voided_by"
  | "void_reason"
>;

/** Every payment of the invoice, voided ones too (staff only; newest first). */
export const invoicePaymentsQueryOptions = (userId: string, invoiceId: string) =>
  queryOptions({
    queryKey: adminKeys.invoicePayments(userId, invoiceId),
    staleTime: 10_000,
    queryFn: async (): Promise<InvoicePayment[]> => {
      if (!isUuid(invoiceId)) return [];
      const { data, error } = await supabase
        .from("payments")
        .select(INVOICE_PAYMENT_COLUMNS)
        .eq("invoice_id", invoiceId)
        .order("paid_on", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

export interface InvoiceRelation {
  id: string;
  invoice_number: string | null;
  status: Database["public"]["Enums"]["invoice_status"];
}

/**
 * "Corrigeren": the invoice this one replaces (if any) and the invoices
 * (drafts too) that replace it.
 */
export const invoiceRelationsQueryOptions = (
  userId: string,
  invoiceId: string,
  replacesInvoiceId: string | null,
) =>
  queryOptions({
    queryKey: [...adminKeys.invoiceRelations(userId, invoiceId), replacesInvoiceId ?? ""] as const,
    staleTime: 10_000,
    queryFn: async (): Promise<{
      replaces: InvoiceRelation | null;
      replacedBy: InvoiceRelation[];
    }> => {
      if (!isUuid(invoiceId)) return { replaces: null, replacedBy: [] };
      const [by, replaces] = await Promise.all([
        supabase
          .from("invoices")
          .select("id, invoice_number, status")
          .eq("replaces_invoice_id", invoiceId)
          .order("created_at"),
        replacesInvoiceId && isUuid(replacesInvoiceId)
          ? supabase
              .from("invoices")
              .select("id, invoice_number, status")
              .eq("id", replacesInvoiceId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (by.error) throw by.error;
      if (replaces.error) throw replaces.error;
      return { replaces: replaces.data, replacedBy: by.data };
    },
  });

/** After saving, issuing or deleting an invoice: everything that shows invoices. */
export async function invalidateInvoices(queryClient: QueryClient, userId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: adminKeys.invoices(userId) }),
    queryClient.invalidateQueries({ queryKey: adminKeys.orders(userId) }),
    queryClient.invalidateQueries({ queryKey: adminKeys.customers(userId) }),
    queryClient.invalidateQueries({ queryKey: adminKeys.dashboard(userId) }),
  ]);
}
