import "@tanstack/react-start/server-only";

/**
 * Hook points for e-mails about orders. Load with
 * `await import("@/server/order-notifications")` inside a server handler.
 */

export interface OrderRegisteredEvent {
  orderId: string;
  reference: string;
  customerId: string;
  /** The extra package's root order, or null for a new purchase. */
  parentOrderId: string | null;
  /** The login that registered the order. */
  userId: string;
}

/**
 * P8 HOOK: "Order bevestigd" e-mail (SPEC §24, §35.12).
 *
 * registerOrderFn calls this once, after the order row exists, and a failure
 * here never undoes or fails the registration (the caller logs and moves on).
 * P8 adds the e-mail here: look up the customer's address with the service
 * role (allowed for e-mail bookkeeping, SPEC §35.2), write an email_logs row
 * with an idempotency key such as `order_registered:<orderId>`, and send via
 * Resend, or log `skipped_no_provider` when Resend is not configured.
 *
 * Until P8 nothing is sent.
 */
export async function onOrderRegistered(event: OrderRegisteredEvent): Promise<void> {
  void event;
}
