import type { Database } from "@/integrations/supabase/types";
import type { EmailOutcome } from "@/lib/email/outcome";
import { todayInSuriname } from "@/lib/format";

/**
 * Which payment reminder an invoice is due for today (SPEC §19, §35.12). Pure,
 * so the windows are unit-tested; runPaymentReminders() in
 * src/server/reminders.ts applies it to every open invoice. Windows rather
 * than exact days, so a day the job did not run is caught up the next day.
 * "Today" is the date in Suriname (America/Paramaribo).
 *
 * - due_soon: due_date − due_soon_days ≤ today < due_date, and no reminder
 *   before the due date was sent yet (due_soon_days 0 = none);
 * - overdue: today > due_date and reminder_count = 0;
 * - repeat:  today > due_date, today ≥ last_reminder_sent_at (its Suriname
 *   date) + overdue_reminder_interval_days, and reminder_count < max.
 *
 * reminder_count, first_ and last_reminder_sent_at count the reminders AFTER
 * the due date (the settings call max_overdue_reminders "Maximaal aantal
 * herinneringen na de vervaldatum"; 0 = none at all). The one reminder before
 * the due date is recorded in email_logs only.
 */

export type InvoiceStatus = Database["public"]["Enums"]["invoice_status"];

export interface ReminderSettings {
  dueSoonDays: number;
  intervalDays: number;
  maxOverdueReminders: number;
}

export interface ReminderInvoice {
  status: InvoiceStatus | null;
  /** 'YYYY-MM-DD' */
  dueDate: string;
  balanceDue: number;
  reminderCount: number;
  lastReminderSentAt: string | null;
  /** A reminder before the due date was already sent (or is being sent). */
  dueSoonSent: boolean;
}

export type ReminderDue =
  { kind: "payment_reminder_due_soon"; seq: 1 } | { kind: "payment_reminder_overdue"; seq: number };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function utcDay(date: string): number {
  if (!DATE.test(date)) throw new RangeError(`Not a date: ${date}`);
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
}

/** 'YYYY-MM-DD' plus n days (n may be negative). */
export function addDays(date: string, days: number): string {
  return new Date((utcDay(date) + days) * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both 'YYYY-MM-DD'). */
export function daysBetween(from: string, to: string): number {
  return Math.round(utcDay(to) - utcDay(from));
}

/** Open or partly paid with something left to pay: the only invoices that get reminders. */
export function isRemindable(invoice: Pick<ReminderInvoice, "status" | "balanceDue">): boolean {
  return (
    (invoice.status === "open" || invoice.status === "partially_paid") && invoice.balanceDue > 0
  );
}

/** The reminder this invoice is due for on `today` ('YYYY-MM-DD' in Suriname), or null. */
export function reminderDue(
  invoice: ReminderInvoice,
  settings: ReminderSettings,
  today: string,
): ReminderDue | null {
  if (!isRemindable(invoice)) return null;

  if (today < invoice.dueDate) {
    const windowStart = addDays(invoice.dueDate, -Math.max(0, settings.dueSoonDays));
    if (settings.dueSoonDays > 0 && windowStart <= today && !invoice.dueSoonSent) {
      return { kind: "payment_reminder_due_soon", seq: 1 };
    }
    return null;
  }
  if (today === invoice.dueDate) return null; // due today: not overdue yet

  const count = Math.max(0, invoice.reminderCount);
  if (count >= settings.maxOverdueReminders) return null;
  if (count === 0) return { kind: "payment_reminder_overdue", seq: 1 };
  if (invoice.lastReminderSentAt) {
    const last = todayInSuriname(new Date(invoice.lastReminderSentAt));
    if (today < addDays(last, Math.max(1, settings.intervalDays))) return null;
  }
  return { kind: "payment_reminder_overdue", seq: count + 1 };
}

/**
 * What "Herinnering nu versturen" sends for this invoice today: the overdue
 * wording once the due date has passed, otherwise the friendly one. Null when
 * there is nothing to remind about (paid, cancelled, nothing left to pay).
 */
export function manualReminderKind(
  invoice: Pick<ReminderInvoice, "status" | "balanceDue" | "dueDate">,
  today: string,
): ReminderDue["kind"] | null {
  if (!isRemindable(invoice)) return null;
  return today > invoice.dueDate ? "payment_reminder_overdue" : "payment_reminder_due_soon";
}

export const REMINDER_EMAIL_KINDS: readonly ReminderDue["kind"][] = [
  "payment_reminder_due_soon",
  "payment_reminder_overdue",
];

/** An email_logs row as far as "was a reminder sent today?" needs it. */
export interface ReminderLogLike {
  kind: string;
  status: string;
  created_at: string;
  updated_at?: string | null;
  sent_at: string | null;
}

/**
 * Whether a payment reminder for this invoice went out (or is going out) on
 * `today` ('YYYY-MM-DD' in Suriname), by any route: the daily run, "Herinneringen
 * nu versturen" or the per-invoice button. A booked overdue reminder counts by
 * last_reminder_sent_at; any reminder by its email_logs row (sent, or queued
 * right now). "Herinnering nu versturen" sends at most one reminder a day in
 * total, not one per route.
 */
export function remindedOn(
  today: string,
  logs: readonly ReminderLogLike[],
  lastReminderSentAt: string | null,
): boolean {
  const onToday = (iso: string | null | undefined) =>
    Boolean(iso) && todayInSuriname(new Date(iso as string)) === today;
  if (onToday(lastReminderSentAt)) return true;
  return logs.some(
    (log) =>
      (REMINDER_EMAIL_KINDS as readonly string[]).includes(log.kind) &&
      (log.status === "sent"
        ? onToday(log.sent_at)
        : log.status === "queued" && (onToday(log.updated_at) || onToday(log.created_at))),
  );
}

/** What "Herinnering nu versturen" for one invoice did (server → staff screen). */
export type ManualReminderResult =
  | { status: "sent_or_tried"; kind: ReminderDue["kind"]; outcome: EmailOutcome }
  /** Paid, cancelled, a draft, or nothing left to pay. */
  | { status: "not_due" }
  /** A reminder for this invoice already went out today (by any route): nothing sent. */
  | { status: "already_today"; kind: ReminderDue["kind"] }
  /** Every reminder after the due date was sent: only sent after an explicit confirmation. */
  | { status: "max_reached"; kind: "payment_reminder_overdue"; max: number };

export type NextReminder =
  /** What the daily run will send, and on which Suriname date (today = the next run). */
  | { kind: ReminderDue["kind"]; seq: number; date: string }
  /** Every reminder after the due date has been sent. */
  | { kind: "max_reached" }
  | null;

/**
 * The next reminder the daily run will send for this invoice, for the
 * overview on /admin/herinneringen: today when one is due now, otherwise the
 * first day its window opens. Null when no reminder is planned (paid,
 * cancelled, or the settings turn them off).
 */
export function nextReminder(
  invoice: ReminderInvoice,
  settings: ReminderSettings,
  today: string,
): NextReminder {
  if (!isRemindable(invoice)) return null;
  const due = reminderDue(invoice, settings, today);
  if (due) return { ...due, date: today };

  const count = Math.max(0, invoice.reminderCount);
  if (today <= invoice.dueDate) {
    const start = addDays(invoice.dueDate, -Math.max(0, settings.dueSoonDays));
    if (settings.dueSoonDays > 0 && !invoice.dueSoonSent && start > today) {
      return { kind: "payment_reminder_due_soon", seq: 1, date: start };
    }
    if (count === 0 && settings.maxOverdueReminders > 0) {
      return { kind: "payment_reminder_overdue", seq: 1, date: addDays(invoice.dueDate, 1) };
    }
  }
  if (count >= settings.maxOverdueReminders) {
    return settings.maxOverdueReminders > 0 && count > 0 ? { kind: "max_reached" } : null;
  }
  if (invoice.lastReminderSentAt) {
    const last = todayInSuriname(new Date(invoice.lastReminderSentAt));
    return {
      kind: "payment_reminder_overdue",
      seq: count + 1,
      date: addDays(last, Math.max(1, settings.intervalDays)),
    };
  }
  return null;
}
