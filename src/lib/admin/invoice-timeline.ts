import type { InvoicePayment, InvoiceViewRow } from "@/lib/admin/invoice-queries";

/**
 * The readable Dutch history of one invoice (SPEC §35.13 subset: issued,
 * paid, cancelled; payment recorded/voided), built from the rows staff may
 * read (the invoice from invoice_overview and its payments), so it needs no
 * access to the admin-only audit log. Each event says who did it where the
 * row records that (issued_by, recorded_by, voided_by, cancelled_by).
 */

export type InvoiceEventKind =
  "created" | "issued" | "payment_recorded" | "payment_voided" | "late_fee" | "paid" | "cancelled";

export interface InvoiceEvent {
  key: string;
  at: string;
  kind: InvoiceEventKind;
  /** Who did it (a login id), null when the row does not say. */
  actorId: string | null;
  /** The payment of a payment event. */
  payment?: InvoicePayment;
  /** A reason given (voiding, cancelling). */
  reason?: string | null;
}

/** Same-instant events keep the order in which they happen. */
const ORDER: Record<InvoiceEventKind, number> = {
  created: 0,
  issued: 1,
  late_fee: 2,
  payment_recorded: 3,
  paid: 4,
  payment_voided: 5,
  cancelled: 6,
};

/** Oldest first. */
export function buildInvoiceTimeline(
  invoice: Pick<
    InvoiceViewRow,
    | "id"
    | "issued_at"
    | "issued_by"
    | "paid_at"
    | "cancelled_at"
    | "cancelled_by"
    | "cancel_reason"
    | "late_fee_applied_at"
    | "created_at"
    | "created_by"
  >,
  payments: readonly InvoicePayment[],
): InvoiceEvent[] {
  const events: InvoiceEvent[] = [];
  if (invoice.created_at) {
    events.push({
      key: "created",
      at: invoice.created_at,
      kind: "created",
      actorId: invoice.created_by ?? null,
    });
  }
  if (invoice.issued_at) {
    events.push({
      key: "issued",
      at: invoice.issued_at,
      kind: "issued",
      actorId: invoice.issued_by,
    });
  }
  if (invoice.late_fee_applied_at) {
    events.push({
      key: "late-fee",
      at: invoice.late_fee_applied_at,
      kind: "late_fee",
      actorId: null,
    });
  }
  for (const p of payments) {
    events.push({
      key: `payment-${p.id}`,
      at: p.created_at,
      kind: "payment_recorded",
      actorId: p.recorded_by,
      payment: p,
    });
    if (p.voided_at) {
      events.push({
        key: `void-${p.id}`,
        at: p.voided_at,
        kind: "payment_voided",
        actorId: p.voided_by,
        payment: p,
        reason: p.void_reason,
      });
    }
  }
  if (invoice.paid_at) {
    events.push({ key: "paid", at: invoice.paid_at, kind: "paid", actorId: null });
  }
  if (invoice.cancelled_at) {
    events.push({
      key: "cancelled",
      at: invoice.cancelled_at,
      kind: "cancelled",
      actorId: invoice.cancelled_by,
      reason: invoice.cancel_reason,
    });
  }
  return events.sort(
    (a, b) =>
      Date.parse(a.at) - Date.parse(b.at) ||
      ORDER[a.kind] - ORDER[b.kind] ||
      a.key.localeCompare(b.key),
  );
}
