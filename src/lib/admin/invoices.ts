import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { Constants, type Database } from "@/integrations/supabase/types";
import { addDays } from "@/lib/admin/invoice-builder";
import { adminKeys } from "@/lib/admin/keys";
import {
  allPages,
  customerDisplayName,
  fold,
  normalizeTracking,
  parseCustomerCode,
  searchText,
  type OrderCustomer,
} from "@/lib/admin/orders";
import { invoiceBadgeKey, totalsByCurrency, type CurrencyAmount } from "@/lib/portal/invoices";

/**
 * /admin/facturen (SPEC §17, §35.9, §35.10): every invoice, drafts included
 * (RLS: is_staff), read from invoice_overview so status, balance and
 * "Achterstallig" come from the database (overdue is computed, never
 * stored). Search, filters and sort live in the URL; totals are per
 * currency, never added across currencies.
 */

type OverviewRow = Database["public"]["Views"]["invoice_overview"]["Row"];

export const INVOICE_LIST_COLUMNS =
  "id, invoice_number, status, customer_id, currency, invoice_date, due_date, total_amount, amount_paid, balance_due, is_overdue, days_overdue, paid_at, issued_at, cancelled_at, created_at, replaces_invoice_id, reminder_count, late_fee_applied_at" as const;

export type AdminInvoiceRow = Pick<
  OverviewRow,
  | "id"
  | "invoice_number"
  | "status"
  | "customer_id"
  | "currency"
  | "invoice_date"
  | "due_date"
  | "total_amount"
  | "amount_paid"
  | "balance_due"
  | "is_overdue"
  | "days_overdue"
  | "paid_at"
  | "issued_at"
  | "cancelled_at"
  | "created_at"
  | "replaces_invoice_id"
  | "reminder_count"
  | "late_fee_applied_at"
>;

export interface AdminInvoiceData {
  invoices: AdminInvoiceRow[];
  /** invoice id → the references of the orders on its lines (for search and the list). */
  references: ReadonlyMap<string, readonly string[]>;
}

/** Every invoice and the order references on its lines. */
export const adminInvoicesQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.invoiceList(userId),
    staleTime: 15_000,
    queryFn: async (): Promise<AdminInvoiceData> => {
      const [invoices, items] = await Promise.all([
        allPages<AdminInvoiceRow>((from, to) =>
          supabase
            .from("invoice_overview")
            .select(INVOICE_LIST_COLUMNS)
            .order("invoice_date", { ascending: false })
            .order("id")
            .range(from, to),
        ),
        allPages<{ invoice_id: string; order: { reference: string } | null }>((from, to) =>
          supabase
            .from("invoice_items")
            .select("invoice_id, order:orders(reference)")
            .not("order_id", "is", null)
            .order("id")
            .range(from, to),
        ),
      ]);
      return { invoices, references: referencesByInvoice(items) };
    },
  });

/** invoice id → distinct order references, sorted. */
export function referencesByInvoice(
  items: readonly { invoice_id: string; order: { reference: string } | null }[],
): Map<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const item of items) {
    if (!item.order?.reference) continue;
    const set = map.get(item.invoice_id) ?? new Set<string>();
    set.add(item.order.reference);
    map.set(item.invoice_id, set);
  }
  return new Map([...map].map(([id, refs]) => [id, [...refs].sort()]));
}

// ---------------------------------------------------------------------------
// Search, filters and sort (in the URL)
// ---------------------------------------------------------------------------

/**
 * Status filter: the customer badge keys (overdue wins over open/partially
 * paid, as in invoiceBadgeKey) plus "unpaid" = everything still to be paid.
 */
export const INVOICE_STATUS_FILTERS = [
  "unpaid",
  "open",
  "partially_paid",
  "overdue",
  "paid",
  "draft",
  "cancelled",
] as const;
export type InvoiceStatusFilter = (typeof INVOICE_STATUS_FILTERS)[number];

export const INVOICE_SORTS = ["newest", "oldest", "due", "amount", "customer"] as const;
export type InvoiceSort = (typeof INVOICE_SORTS)[number];

export const INVOICE_PERIODS = [
  "this_month",
  "last_month",
  "last_30",
  "this_year",
  "last_year",
  "custom",
] as const;
export type InvoicePeriod = (typeof INVOICE_PERIODS)[number];

const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => addDays(v, 0) === v)
  .optional()
  .catch(undefined);

/** Search params of /admin/facturen; invalid values are dropped, never an error page. */
export const invoiceListSearchSchema = z.object({
  q: searchText,
  status: z.enum(INVOICE_STATUS_FILTERS).optional().catch(undefined),
  currency: z.enum(Constants.public.Enums.currency_code).optional().catch(undefined),
  period: z.enum(INVOICE_PERIODS).optional().catch(undefined),
  /** Only with period=custom: invoice dates from … to … (inclusive). */
  from: dateParam,
  to: dateParam,
  sort: z.enum(INVOICE_SORTS).optional().catch(undefined),
});
export type InvoiceListSearch = z.infer<typeof invoiceListSearchSchema>;

export function hasInvoiceFilters(search: InvoiceListSearch): boolean {
  return Boolean(search.q || search.status || search.currency || search.period);
}

/** The first day of the month of a 'YYYY-MM-DD' date. */
const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
/** The last day of the month of a 'YYYY-MM-DD' date. */
const monthEnd = (date: string) => {
  const [y = 0, m = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/**
 * The invoice-date range of a period ('YYYY-MM-DD', inclusive; null = open
 * end), counted from today in Suriname. null when there is no period.
 */
export function periodRange(
  search: Pick<InvoiceListSearch, "period" | "from" | "to">,
  today: string,
): { from: string | null; to: string | null } | null {
  const year = today.slice(0, 4);
  switch (search.period) {
    case "this_month":
      return { from: monthStart(today), to: monthEnd(today) };
    case "last_month": {
      const previous = addDays(monthStart(today), -1);
      return { from: monthStart(previous), to: previous };
    }
    case "last_30":
      return { from: addDays(today, -29), to: today };
    case "this_year":
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    case "last_year": {
      const last = String(Number(year) - 1);
      return { from: `${last}-01-01`, to: `${last}-12-31` };
    }
    case "custom": {
      if (!search.from && !search.to) return null;
      // Swapped by mistake: still the range between the two dates.
      if (search.from && search.to && search.from > search.to) {
        return { from: search.to, to: search.from };
      }
      return { from: search.from ?? null, to: search.to ?? null };
    }
    default:
      return null;
  }
}

export type AdminInvoiceListItem = AdminInvoiceRow & {
  customer: (OrderCustomer & { phone?: string | null }) | null;
  references: readonly string[];
};

export function joinInvoices(
  data: AdminInvoiceData,
  customers: readonly OrderCustomer[] | undefined,
): AdminInvoiceListItem[] {
  const byId = new Map((customers ?? []).map((c) => [c.id, c]));
  return data.invoices.map((invoice) => ({
    ...invoice,
    customer: (invoice.customer_id && byId.get(invoice.customer_id)) || null,
    references: (invoice.id && data.references.get(invoice.id)) || [],
  }));
}

/**
 * The search box: an invoice number however it is typed ("INV-2026-0012",
 * "2026-0012", "0012"), a GR code ("gr 17"), the customer's name or company
 * (without accents) or an order reference on the invoice.
 */
export function matchesInvoiceSearch(
  invoice: Pick<AdminInvoiceListItem, "invoice_number" | "customer" | "references">,
  query: string,
): boolean {
  const q = query.trim();
  if (!q) return true;
  const code = parseCustomerCode(q);
  if (code && invoice.customer?.customer_code === code) return true;

  const needle = fold(q);
  const text = [
    invoice.invoice_number,
    invoice.customer?.customer_code,
    invoice.customer?.full_name,
    invoice.customer?.company_name,
    ...invoice.references,
  ];
  if (text.some((f) => (f ? fold(f).includes(needle) : false))) return true;

  // Numbers without their spaces or dashes ("inv 2026 12" is not a match, "2026 0012" is).
  const compact = normalizeTracking(q);
  if (compact.length < 3) return false;
  return [invoice.invoice_number, ...invoice.references].some((f) =>
    f ? normalizeTracking(f).includes(compact) : false,
  );
}

export function matchesStatusFilter(
  invoice: Pick<AdminInvoiceRow, "status" | "is_overdue">,
  filter: InvoiceStatusFilter,
): boolean {
  if (filter === "unpaid") {
    return invoice.status === "open" || invoice.status === "partially_paid";
  }
  return invoiceBadgeKey(invoice) === filter;
}

const sortKey = (i: AdminInvoiceListItem) =>
  `${i.invoice_date ?? ""}|${i.invoice_number ?? ""}|${i.created_at ?? ""}`;

/** Applies the list's search, filters and sort (newest = latest invoice date first). */
export function filterInvoices(
  invoices: readonly AdminInvoiceListItem[],
  search: InvoiceListSearch,
  today: string,
): AdminInvoiceListItem[] {
  const range = periodRange(search, today);
  const result = invoices.filter(
    (i) =>
      (!search.q || matchesInvoiceSearch(i, search.q)) &&
      (!search.status || matchesStatusFilter(i, search.status)) &&
      (!search.currency || i.currency === search.currency) &&
      (!range ||
        (i.invoice_date !== null &&
          (!range.from || i.invoice_date >= range.from) &&
          (!range.to || i.invoice_date <= range.to))),
  );
  const name = (i: AdminInvoiceListItem) =>
    i.customer ? fold(customerDisplayName(i.customer)) : "";
  switch (search.sort) {
    case "oldest":
      return result.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    case "due":
      // Earliest due date first; what still has to be paid before what is settled.
      return result.sort(
        (a, b) =>
          Number(!stillOpen(a)) - Number(!stillOpen(b)) ||
          (a.due_date ?? "").localeCompare(b.due_date ?? "") ||
          sortKey(b).localeCompare(sortKey(a)),
      );
    case "amount":
      return result.sort(
        (a, b) =>
          (a.currency ?? "").localeCompare(b.currency ?? "") ||
          (b.total_amount ?? 0) - (a.total_amount ?? 0) ||
          sortKey(b).localeCompare(sortKey(a)),
      );
    case "customer":
      return result.sort(
        (a, b) => name(a).localeCompare(name(b), "nl") || sortKey(b).localeCompare(sortKey(a)),
      );
    default:
      return result.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  }
}

const stillOpen = (i: Pick<AdminInvoiceRow, "status">) =>
  i.status === "open" || i.status === "partially_paid";

export interface InvoiceListSummary {
  /** Issued invoices that count (open, partially paid, paid). */
  issuedCount: number;
  draftCount: number;
  cancelledCount: number;
  overdueCount: number;
  /** Per currency, never added across currencies (SPEC §35.10). */
  invoiced: CurrencyAmount[];
  paid: CurrencyAmount[];
  outstanding: CurrencyAmount[];
  overdue: CurrencyAmount[];
}

/**
 * The totals line above the list, for what the filters show: drafts and
 * cancelled invoices are counted but never summed.
 */
export function summarizeInvoiceList(invoices: readonly AdminInvoiceRow[]): InvoiceListSummary {
  const issued = invoices.filter((i) => stillOpen(i) || i.status === "paid");
  const open = issued.filter(stillOpen);
  const overdue = open.filter((i) => i.is_overdue === true);
  const per = (rows: readonly AdminInvoiceRow[], pick: (i: AdminInvoiceRow) => number | null) =>
    totalsByCurrency(rows.map((i) => ({ currency: i.currency, amount: pick(i) })));
  return {
    issuedCount: issued.length,
    draftCount: invoices.filter((i) => i.status === "draft").length,
    cancelledCount: invoices.filter((i) => i.status === "cancelled").length,
    overdueCount: overdue.length,
    invoiced: per(issued, (i) => i.total_amount),
    paid: per(issued, (i) => i.amount_paid),
    outstanding: per(open, (i) => i.balance_due),
    overdue: per(overdue, (i) => i.balance_due),
  };
}
