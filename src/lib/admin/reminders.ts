import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { adminKeys } from "@/lib/admin/keys";
import { allPages, customerDisplayName, type PickerCustomer } from "@/lib/admin/orders";
import { portalInvoiceLink } from "@/lib/admin/invoice-actions";
import { REMINDER_JOB } from "@/lib/admin/system-status";
import {
  manualReminderKind,
  nextReminder,
  remindedOn,
  type NextReminder,
  type ReminderSettings,
} from "@/lib/email/reminders";
import { formatDate, formatMoney, type CurrencyCode } from "@/lib/format";
import { t } from "@/lib/i18n";
import { parseIssuerSnapshot } from "@/lib/invoice/model";

/**
 * /admin/herinneringen (SPEC §19, §35.12): the open invoices with what the
 * daily run will send next, the last runs (job_runs) and the reminder
 * history (email_logs). Everything is read with the staff member's own
 * client: staff read job_runs, email_logs and invoice_overview under RLS.
 * Sending goes through the server functions (reminders.functions.ts).
 */

type Tables = Database["public"]["Tables"];
export type EmailLogRow = Pick<
  Tables["email_logs"]["Row"],
  | "id"
  | "kind"
  | "status"
  | "recipient"
  | "invoice_id"
  | "order_id"
  | "customer_id"
  | "idempotency_key"
  | "error"
  | "created_at"
  | "updated_at"
  | "sent_at"
>;
export type ReminderKind = "payment_reminder_due_soon" | "payment_reminder_overdue";
export const REMINDER_KINDS: readonly ReminderKind[] = [
  "payment_reminder_due_soon",
  "payment_reminder_overdue",
];

const EMAIL_LOG_COLUMNS =
  "id, kind, status, recipient, invoice_id, order_id, customer_id, idempotency_key, error, created_at, updated_at, sent_at" as const;

// ---------------------------------------------------------------------------
// Job runs
// ---------------------------------------------------------------------------

export type JobRunRow = Pick<
  Tables["job_runs"]["Row"],
  "id" | "trigger" | "status" | "started_at" | "finished_at" | "started_by" | "stats" | "error"
>;

export interface RunCounts {
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
  duplicate: number;
  no_address: number;
  deferred: number;
}

const count = z.number().int().nonnegative().catch(0);
const runStats = z
  .object({
    checked: count,
    sent: count,
    skipped: count,
    failed: count,
    duplicate: count,
    no_address: count,
    deferred: count,
  })
  .partial();

/** job_runs.stats as written by runPaymentReminders (missing numbers count as 0). */
export function runCounts(stats: Json): RunCounts {
  const parsed = runStats.safeParse(stats);
  const s = parsed.success ? parsed.data : {};
  return {
    checked: s.checked ?? 0,
    sent: s.sent ?? 0,
    skipped: s.skipped ?? 0,
    failed: s.failed ?? 0,
    duplicate: s.duplicate ?? 0,
    no_address: s.no_address ?? 0,
    deferred: s.deferred ?? 0,
  };
}

/** "3 verstuurd · 1 overgeslagen · …": only the non-zero counts. */
export function runSummary(stats: Json): string {
  const c = runCounts(stats);
  const parts = (["sent", "skipped", "failed", "no_address", "duplicate", "deferred"] as const)
    .filter((k) => c[k] > 0)
    .map((k) => t(`admin.reminders.counts.${k}`, { count: c[k] }));
  return parts.length > 0 ? parts.join(" · ") : t("admin.reminders.counts.none");
}

/** The last runs of the reminder job, newest first. */
export const reminderRunsQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.reminderRuns(userId),
    staleTime: 15_000,
    queryFn: async (): Promise<JobRunRow[]> => {
      const { data, error } = await supabase
        .from("job_runs")
        .select("id, trigger, status, started_at, finished_at, started_by, stats, error")
        .eq("job", REMINDER_JOB)
        .order("started_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

// ---------------------------------------------------------------------------
// Open invoices and their reminders
// ---------------------------------------------------------------------------

type OverviewRow = Database["public"]["Views"]["invoice_overview"]["Row"];
export type ReminderInvoiceRow = Pick<
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
  | "reminder_count"
  | "first_reminder_sent_at"
  | "last_reminder_sent_at"
  | "late_fee_applied_at"
  | "issuer_snapshot"
>;

export interface ReminderOverview {
  invoices: ReminderInvoiceRow[];
  settings: ReminderSettings;
  /** Every reminder e-mail of these invoices, newest first. */
  logs: EmailLogRow[];
}

/** Open and partly paid invoices with a balance, the reminder settings and the reminder log. */
export const reminderOverviewQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.reminderOverview(userId),
    staleTime: 15_000,
    queryFn: async (): Promise<ReminderOverview> => {
      const [invoices, settings, logs] = await Promise.all([
        allPages<ReminderInvoiceRow>((from, to) =>
          supabase
            .from("invoice_overview")
            .select(
              "id, invoice_number, status, customer_id, currency, invoice_date, due_date, total_amount, amount_paid, balance_due, is_overdue, days_overdue, reminder_count, first_reminder_sent_at, last_reminder_sent_at, late_fee_applied_at, issuer_snapshot",
            )
            .in("status", ["open", "partially_paid"])
            .gt("balance_due", 0)
            .order("due_date")
            .order("id")
            .range(from, to),
        ),
        supabase
          .from("company_settings")
          .select("due_soon_days, overdue_reminder_interval_days, max_overdue_reminders")
          .maybeSingle(),
        allPages<EmailLogRow>((from, to) =>
          supabase
            .from("email_logs")
            .select(EMAIL_LOG_COLUMNS)
            .in("kind", [...REMINDER_KINDS])
            .order("created_at", { ascending: false })
            .order("id")
            .range(from, to),
        ),
      ]);
      if (settings.error) throw settings.error;
      return {
        invoices,
        settings: {
          dueSoonDays: settings.data?.due_soon_days ?? 2,
          intervalDays: settings.data?.overdue_reminder_interval_days ?? 7,
          maxOverdueReminders: settings.data?.max_overdue_reminders ?? 3,
        },
        logs,
      };
    },
  });

/** Every e-mail about one invoice (factuur, herinneringen, betaling ontvangen), newest first. */
export const invoiceEmailLogsQueryOptions = (userId: string, invoiceId: string) =>
  queryOptions({
    queryKey: adminKeys.invoiceEmails(userId, invoiceId),
    staleTime: 15_000,
    queryFn: async (): Promise<EmailLogRow[]> => {
      const { data, error } = await supabase
        .from("email_logs")
        .select(EMAIL_LOG_COLUMNS)
        .eq("invoice_id", invoiceId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

export interface ReminderRow {
  invoice: ReminderInvoiceRow & { id: string; due_date: string; currency: CurrencyCode };
  customer: PickerCustomer | null;
  next: NextReminder;
  /** What "Herinnering nu versturen" would send today; null: nothing to remind. */
  manualKind: ReminderKind | null;
  /**
   * A reminder for this invoice already went out (or is going out) today, by
   * any route (daily run, bulk button, per-invoice button): at most one a day.
   */
  sentToday: boolean;
  /** Every reminder after the due date was sent: one more only after confirming. */
  maxReached: boolean;
  history: EmailLogRow[];
}

/** One row per open invoice: who, what the daily run sends next, and what was sent. */
export function reminderRows(
  overview: ReminderOverview,
  customers: readonly PickerCustomer[],
  today: string,
): ReminderRow[] {
  const byCustomer = new Map(customers.map((c) => [c.id, c]));
  const logsByInvoice = new Map<string, EmailLogRow[]>();
  for (const log of overview.logs) {
    if (!log.invoice_id) continue;
    const list = logsByInvoice.get(log.invoice_id) ?? [];
    list.push(log);
    logsByInvoice.set(log.invoice_id, list);
  }
  return overview.invoices.flatMap((invoice) => {
    if (!invoice.id || !invoice.due_date || !invoice.currency) return [];
    const history = logsByInvoice.get(invoice.id) ?? [];
    const dueSoonSent = history.some(
      (l) =>
        l.kind === "payment_reminder_due_soon" && (l.status === "sent" || l.status === "queued"),
    );
    const state = {
      status: invoice.status,
      dueDate: invoice.due_date,
      balanceDue: Number(invoice.balance_due ?? 0),
      reminderCount: invoice.reminder_count ?? 0,
      lastReminderSentAt: invoice.last_reminder_sent_at,
      dueSoonSent,
    };
    const manualKind = manualReminderKind(state, today);
    return [
      {
        invoice: {
          ...invoice,
          id: invoice.id,
          due_date: invoice.due_date,
          currency: invoice.currency,
        },
        customer: invoice.customer_id ? (byCustomer.get(invoice.customer_id) ?? null) : null,
        next: nextReminder(state, overview.settings, today),
        manualKind,
        sentToday: remindedOn(today, history, invoice.last_reminder_sent_at),
        maxReached:
          manualKind === "payment_reminder_overdue" &&
          state.reminderCount >= overview.settings.maxOverdueReminders,
        history,
      },
    ];
  });
}

/**
 * Customers without an e-mail address who owe something now (overdue or in
 * the window before the due date): staff remind them via WhatsApp instead.
 */
export function withoutEmail(rows: readonly ReminderRow[], today: string): ReminderRow[] {
  return rows.filter(
    (r) =>
      r.customer !== null &&
      !r.customer.email?.trim() &&
      (r.invoice.is_overdue === true ||
        (r.next !== null && r.next.kind !== "max_reached" && r.next.date <= today)),
  );
}

/**
 * The portal link of this invoice for the WhatsApp reminder: only for an
 * active customer with a login (SPEC §35.12), on `linkBase` (APP_URL, else
 * this browser's origin: emailStatusFn).
 */
export function reminderPortalLink(row: ReminderRow, linkBase: string | null): string | null {
  const c = row.customer;
  if (!linkBase || !c?.user_id || c.status !== "active") return null;
  return portalInvoiceLink(linkBase, row.invoice.id);
}

/**
 * The Dutch WhatsApp reminder (amount, due date, how to pay), for customers
 * without e-mail and for every customer while e-mail is not configured; with
 * the portal link when the customer can log in.
 */
export function reminderShareText(row: ReminderRow, portalUrl: string | null = null): string {
  const { invoice, customer } = row;
  const money = (n: number | null) => formatMoney(Number(n ?? 0), invoice.currency);
  const name = customer ? customerDisplayName(customer).split(/\s+/, 1)[0] : null;
  const issuer = parseIssuerSnapshot(invoice.issuer_snapshot);
  const bank = issuer.bankAccounts.find((a) => a.currency === invoice.currency);
  const lines = [
    name
      ? t("admin.reminders.share.greeting", { name })
      : t("admin.reminders.share.greetingNoName"),
    "",
    invoice.is_overdue
      ? t("admin.reminders.share.overdue", {
          number: invoice.invoice_number ?? "",
          date: formatDate(invoice.due_date),
          amount: money(invoice.balance_due),
        })
      : t("admin.reminders.share.dueSoon", {
          number: invoice.invoice_number ?? "",
          date: formatDate(invoice.due_date),
          amount: money(invoice.balance_due),
        }),
    t("admin.reminders.share.instruction", {
      currency: invoice.currency,
      number: invoice.invoice_number ?? "",
      code: customer?.customer_code ?? "",
    }),
  ];
  if (bank?.accountNumber) {
    lines.push(
      bank.bankName
        ? t("admin.reminders.share.bank", { account: bank.accountNumber, bank: bank.bankName })
        : t("admin.reminders.share.bankNoName", { account: bank.accountNumber }),
    );
  }
  if (portalUrl) lines.push(t("admin.reminders.share.portal", { link: portalUrl }));
  lines.push(
    "",
    t("admin.reminders.share.closing", { company: issuer.companyName || "G&R Solutions" }),
  );
  return lines.join("\n");
}
