import "@tanstack/react-start/server-only";

/**
 * Hook points for invoice e-mails. Load with
 * `await import("@/server/invoice-notifications")` inside a server handler.
 */

export interface InvoiceIssuedEvent {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  /** The staff login that issued it. */
  userId: string;
}

/**
 * P8 HOOK: "Factuur aangemaakt" e-mail (SPEC §35.12).
 *
 * issueInvoiceFn calls this once, after issue_invoice committed (the invoice
 * has its number and snapshots); a failure here never fails or undoes the
 * issue (the caller logs and moves on). P8 sends the e-mail with an
 * idempotency key such as `invoice_issued:<invoiceId>`, built from the
 * snapshots (never today's settings), with a link to /portal/facturen/<id>
 * only for customers with a login (SPEC §35.12), and logs
 * `skipped_no_provider` without Resend.
 *
 * Until P8 nothing is sent: it reports `emailed: false`, so the builder never
 * says an e-mail went out.
 */
export async function onInvoiceIssued(event: InvoiceIssuedEvent): Promise<{ emailed: boolean }> {
  void event;
  return { emailed: false };
}

export interface PaymentRecordedEvent {
  invoiceId: string;
  paymentId: string;
  /** "Betaling registreren" (an amount) or "Markeer als betaald" (the full balance). */
  action: "record" | "mark_paid";
  /** The status the payment trigger derived ('paid' once nothing is left to pay). */
  invoiceStatus: "open" | "partially_paid" | "paid" | "draft" | "cancelled";
  /** The staff login that recorded it. */
  userId: string;
}

/**
 * P8 HOOK: "Betaling ontvangen" e-mail (SPEC §35.12).
 *
 * recordPaymentFn and markPaidFn call this once, after record_payment
 * committed; a failure here never fails or undoes the payment (the caller
 * logs and moves on). P8 sends the e-mail ONLY when `invoiceStatus` is
 * 'paid' (the invoice is settled), with an idempotency key such as
 * `payment_received:<invoiceId>` (one confirmation per invoice, also when a
 * voided payment is recorded again), built from the invoice's snapshots,
 * with a link to /portal/facturen/<id> only for customers with a login, and
 * logs `skipped_no_provider` without Resend.
 *
 * Until P8 nothing is sent: it reports `emailed: false`, so the payment
 * dialog never says an e-mail went out.
 */
export async function onPaymentRecorded(
  event: PaymentRecordedEvent,
): Promise<{ emailed: boolean }> {
  void event;
  return { emailed: false };
}
