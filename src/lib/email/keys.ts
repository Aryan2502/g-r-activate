import type { Database } from "@/integrations/supabase/types";
import { todayInSuriname } from "@/lib/format";

/**
 * Idempotency keys of the e-mails (SPEC §35.12). One key = one e-mail, ever:
 * sendEmail() claims it in email_logs before sending (unique index) and
 * passes it to Resend as the Idempotency-Key, so a retry, a double click or
 * two servers at once never send the same message twice. Each key names the
 * event it reports, so a NEW event always gets a new key.
 */

export type EmailKind = Database["public"]["Enums"]["email_kind"];

type InvoiceEmailKind = Extract<
  EmailKind,
  "invoice_issued" | "payment_received" | "payment_reminder_due_soon" | "payment_reminder_overdue"
>;

/** invoice:<id>:<kind>:<seq>, e.g. the 2nd overdue reminder: invoice:…:payment_reminder_overdue:2. */
export function invoiceEmailKey(invoiceId: string, kind: InvoiceEmailKind, seq: number | string) {
  return `invoice:${invoiceId}:${kind}:${seq}`;
}

/**
 * "Herinnering nu versturen" on /admin/herinneringen: at most one per
 * invoice per Suriname day (the day is the sequence).
 */
export function manualReminderKey(
  invoiceId: string,
  kind: Extract<InvoiceEmailKind, "payment_reminder_due_soon" | "payment_reminder_overdue">,
  today: string,
) {
  return invoiceEmailKey(invoiceId, kind, `manual-${today}`);
}

/** "Order bevestigd": once per order. */
export function orderConfirmationKey(orderId: string) {
  return `order:${orderId}:order_confirmation:1`;
}

/**
 * "Statusupdate": one e-mail per customer per action, keyed by the first
 * (lowest) shipment_status_history row it reports: order:<id>:status:<history_id>.
 * That row belongs to exactly one action, so the key is that action's.
 */
export function orderStatusEmailKey(
  orderIds: readonly string[],
  historyIds: readonly number[],
): string {
  const first = firstStatusChange(orderIds, historyIds);
  return `order:${first.orderId}:status:${first.historyId}`;
}

/** The order and history row a status e-mail is keyed (and logged) by. */
export function firstStatusChange(
  orderIds: readonly string[],
  historyIds: readonly number[],
): { orderId: string; historyId: number } {
  if (orderIds.length === 0 || orderIds.length !== historyIds.length) {
    throw new Error("orderStatusEmailKey: one history id per order");
  }
  let first = 0;
  historyIds.forEach((id, i) => {
    if (id < (historyIds[first] ?? Infinity)) first = i;
  });
  return { orderId: orderIds[first] ?? "", historyId: historyIds[first] ?? 0 };
}

/**
 * "Uitnodiging": invite:<id>:<send_count>:<day>. invitations_guard restarts
 * send_count at 1 on every new Suriname day (the 5-per-day limit), so the day
 * of last_sent_at keeps a resend on Tuesday from reusing Monday's key.
 */
export function invitationEmailKey(
  invitationId: string,
  sendCount: number,
  lastSentAt: string | Date,
): string {
  const day = todayInSuriname(typeof lastSentAt === "string" ? new Date(lastSentAt) : lastSentAt);
  return `invite:${invitationId}:${sendCount}:${day}`;
}

/** "Welkom": once per accepted invitation. */
export function welcomeEmailKey(invitationId: string) {
  return `invite:${invitationId}:welcome`;
}
