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
  /** The customer registered it in the portal, or staff created it in /admin. */
  createdBy: "customer" | "staff";
}

/**
 * P8 HOOK: "Order bevestigd" e-mail (SPEC §24, §35.12).
 *
 * registerOrderFn and createOrderForCustomerFn call this once, after the
 * order row exists, and a failure here never undoes or fails the
 * registration (the caller logs and moves on). P8 adds the e-mail here: look
 * up the customer's address with the service role (allowed for e-mail
 * bookkeeping, SPEC §35.2), write an email_logs row with an idempotency key
 * such as `order_registered:<orderId>`, and send via Resend, or log
 * `skipped_no_provider` when Resend is not configured. A customer without a
 * login (user_id null) gets no portal link (SPEC §35.12).
 *
 * Until P8 nothing is sent.
 */
export async function onOrderRegistered(event: OrderRegisteredEvent): Promise<void> {
  void event;
}

export interface OrderStatusChangedEvent {
  /** What staff did: a status change (single or bulk), a pickup, or a receipt. */
  action: "status" | "pickup" | "receive";
  /** The status the orders moved to. */
  toStatus: string;
  /** The message staff wrote for the customer, if any. */
  customerMessage: string | null;
  /**
   * Who to e-mail: at most ONE entry per customer for the whole action, with
   * the orders of theirs that changed (planStatusEmails in
   * lib/admin/order-actions.ts). Empty when staff switched "Klant e-mailen"
   * off, the status is not customer-visible or nothing changed.
   */
  emails: readonly {
    customerId: string;
    orderIds: readonly string[];
    /** shipment_status_history ids, one per order: the e-mail's idempotency key. */
    historyIds: readonly number[];
  }[];
  /** The staff login that made the change. */
  userId: string;
}

/**
 * P8 HOOK: "Statusupdate" e-mail (SPEC §35.12).
 *
 * changeOrderStatusFn, pickupFn, receiveOrderFn and createOrderForCustomerFn
 * call this once per action, after the database has committed the change; a
 * failure here never fails the status change. P8 sends one e-mail per entry of
 * `emails`, with an idempotency key built from that entry's `historyIds`
 * (e.g. `status:<customerId>:<sorted history ids>`), the same way as
 * onOrderRegistered. A new "Actie vereist" message for an order already in
 * that status is a history row of its own, so it is e-mailed too.
 *
 * Until P8 nothing is sent; the staff dialogs say so (admin.status.emailOff).
 */
export async function onOrderStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
  void event;
}
