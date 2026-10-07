import "@tanstack/react-start/server-only";

import { invoiceEmailKey } from "@/lib/email/keys";
import type { EmailOutcome } from "@/lib/email/outcome";
import { invoiceIssuedEmail, paymentReceivedEmail } from "@/server/email-templates/invoices";
import {
  appUrlOrNull,
  loadIssuedInvoice,
  loadRecipient,
  noAppUrlOutcome,
  sendToCustomer,
  type NotificationDb,
} from "@/server/notification-data";

/**
 * Invoice e-mails (SPEC §24, §35.12). Load with
 * `await import("@/server/invoice-notifications")` inside a server handler,
 * after the database committed. The content comes from the invoice's
 * snapshots (never today's settings), read with the staff member's own
 * client; the address is the customer record's current one. A link to
 * /portal/facturen/<id> only for a customer who can log in.
 */

export interface InvoiceIssuedEvent {
  /** The staff member's own client. */
  db: NotificationDb;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  /** The staff login that issued it. */
  userId: string;
}

/** "Factuur aangemaakt": once per invoice (invoice:<id>:invoice_issued:1). */
export async function onInvoiceIssued(event: InvoiceIssuedEvent): Promise<{ email: EmailOutcome }> {
  const appUrl = appUrlOrNull();
  if (!appUrl) return { email: noAppUrlOutcome("invoice_issued") };
  const recipient = await loadRecipient(event.db, event.customerId);
  if (!recipient) throw new Error(`customer ${event.customerId} not readable`);
  if (!recipient.email) return { email: "no_address" };
  const invoice = await loadIssuedInvoice(event.db, event.invoiceId);
  if (!invoice) throw new Error(`invoice ${event.invoiceId} not issued or not readable`);

  const content = invoiceIssuedEmail({
    appUrl,
    invoiceId: invoice.id,
    model: invoice.model,
    access: recipient.access,
    recipient: recipient.email,
  });
  const email = await sendToCustomer(recipient, content, {
    kind: "invoice_issued",
    idempotencyKey: invoiceEmailKey(invoice.id, "invoice_issued", 1),
    invoiceId: invoice.id,
    replyTo: invoice.model.issuer.email,
  });
  return { email };
}

export interface PaymentRecordedEvent {
  /** The staff member's own client. */
  db: NotificationDb;
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
 * "Betaling ontvangen": ONLY when the payment settled the invoice (status
 * 'paid'); a part payment e-mails nothing (email: null). One confirmation
 * per invoice (invoice:<id>:payment_received:1), also when a voided payment
 * is recorded again.
 */
export async function onPaymentRecorded(
  event: PaymentRecordedEvent,
): Promise<{ email: EmailOutcome | null }> {
  if (event.invoiceStatus !== "paid") return { email: null };
  const appUrl = appUrlOrNull();
  if (!appUrl) return { email: noAppUrlOutcome("payment_received") };
  const invoice = await loadIssuedInvoice(event.db, event.invoiceId);
  if (!invoice) throw new Error(`invoice ${event.invoiceId} not readable`);
  const recipient = await loadRecipient(event.db, invoice.customerId);
  if (!recipient) throw new Error(`customer ${invoice.customerId} not readable`);
  if (!recipient.email) return { email: "no_address" };

  const content = paymentReceivedEmail({
    appUrl,
    invoiceId: invoice.id,
    model: invoice.model,
    access: recipient.access,
    recipient: recipient.email,
    amountPaid: invoice.amountPaid,
    paidAt: invoice.paidAt,
  });
  const email = await sendToCustomer(recipient, content, {
    kind: "payment_received",
    idempotencyKey: invoiceEmailKey(invoice.id, "payment_received", 1),
    invoiceId: invoice.id,
    replyTo: invoice.model.issuer.email,
  });
  return { email };
}
