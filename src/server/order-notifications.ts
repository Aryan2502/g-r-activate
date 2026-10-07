import "@tanstack/react-start/server-only";

import { firstStatusChange, orderConfirmationKey, orderStatusEmailKey } from "@/lib/email/keys";
import { needsFollowUp, statusShareText, type StatusFollowUp } from "@/lib/admin/status-share";
import type { EmailOutcome } from "@/lib/email/outcome";
import { orderConfirmationEmail, statusUpdateEmail } from "@/server/email-templates/orders";
import {
  PROVIDER_PACE_MS,
  appUrlOrNull,
  loadCompany,
  loadRecipient,
  noAppUrlOutcome,
  pause,
  reachedProvider,
  sendToCustomer,
  type NotificationDb,
} from "@/server/notification-data";

/**
 * E-mails about orders (SPEC §24, §35.12). Load with
 * `await import("@/server/order-notifications")` inside a server handler,
 * after the database committed the change. They never throw for an e-mail
 * problem: the outcome comes back for the staff screens, and the callers
 * also catch anything unexpected, so an e-mail never fails or undoes the
 * action itself.
 *
 * The content is read with `db`, the client of whoever acted (a customer
 * registering in the portal, or staff): RLS applies. email_logs is written by
 * sendEmail() with the service role (bookkeeping only).
 */

export interface OrderRegisteredEvent {
  /** The client of whoever registered the order (customer or staff). */
  db: NotificationDb;
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
 * "Order bevestigd": once per order (key order:<id>:order_confirmation:1),
 * to the customer's address; with a link to /portal/orders/<id> only when
 * the customer can log in, otherwise the details alone.
 */
export async function onOrderRegistered(
  event: OrderRegisteredEvent,
): Promise<{ email: EmailOutcome }> {
  const appUrl = appUrlOrNull();
  if (!appUrl) return { email: noAppUrlOutcome("order_confirmation") };
  const { db } = event;

  const recipient = await loadRecipient(db, event.customerId);
  if (!recipient) throw new Error(`customer ${event.customerId} not readable`);
  if (!recipient.email) return { email: "no_address" };

  const { data: order, error } = await db
    .from("orders")
    .select(
      "id, reference, order_type, service_type, store_vendor, vendor_order_number, description, tracking_number, carrier, declared_weight_lbs, expected_delivery_date, parent_order_id",
    )
    .eq("id", event.orderId)
    .single();
  if (error) throw error;
  let parentReference: string | null = null;
  if (order.parent_order_id) {
    const parent = await db
      .from("orders")
      .select("reference")
      .eq("id", order.parent_order_id)
      .maybeSingle();
    parentReference = parent.data?.reference ?? null;
  }

  const brand = await loadCompany(db, appUrl);
  const content = orderConfirmationEmail({
    brand,
    customer: { ...recipient, email: recipient.email },
    access: recipient.access,
    createdBy: event.createdBy,
    order: {
      id: order.id,
      reference: order.reference,
      orderType: order.order_type,
      serviceType: order.service_type,
      storeVendor: order.store_vendor,
      vendorOrderNumber: order.vendor_order_number,
      description: order.description,
      trackingNumber: order.tracking_number,
      carrier: order.carrier,
      declaredWeightLbs: order.declared_weight_lbs,
      expectedDeliveryDate: order.expected_delivery_date,
      parentReference,
    },
  });
  const outcome = await sendToCustomer(recipient, content, {
    kind: "order_confirmation",
    idempotencyKey: orderConfirmationKey(order.id),
    orderId: order.id,
    replyTo: brand.email,
  });
  return { email: outcome };
}

export interface OrderStatusChangedEvent {
  /** The staff member's own client. */
  db: NotificationDb;
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
 * "Statusupdate": one e-mail per entry of `emails` (one per customer per
 * action) listing that customer's changed orders, the status, its
 * description and staff's message (pickup details for "Klaar voor
 * afhalen"). Key order:<first order>:status:<first history id>, so a new
 * "Actie vereist" message for an order already in that status (a history row
 * of its own) is e-mailed too. Returns one outcome per entry, in order.
 */
export async function onOrderStatusChanged(
  event: OrderStatusChangedEvent,
): Promise<{ emails: EmailOutcome[] }> {
  if (event.emails.length === 0) return { emails: [] };
  const appUrl = appUrlOrNull();
  if (!appUrl) {
    const outcome = noAppUrlOutcome("status_update");
    return { emails: event.emails.map(() => outcome) };
  }
  const { db } = event;

  const { data: status, error } = await db
    .from("shipment_statuses")
    .select("code, label_nl, customer_description_nl, stage")
    .eq("code", event.toStatus)
    .maybeSingle();
  if (error) throw error;
  const brand = await loadCompany(db, appUrl);

  const outcomes: EmailOutcome[] = [];
  for (const entry of event.emails) {
    let outcome: EmailOutcome;
    try {
      outcome = await statusEmail(event, entry, brand, {
        label: status?.label_nl ?? event.toStatus,
        description: status?.customer_description_nl ?? null,
        stage: status?.stage ?? "",
      });
    } catch (err) {
      console.error("[onOrderStatusChanged] e-mail failed", entry.customerId, err);
      outcome = "failed";
    }
    outcomes.push(outcome);
    if (reachedProvider(outcome) && outcomes.length < event.emails.length) {
      await pause(PROVIDER_PACE_MS);
    }
  }
  return { emails: outcomes };
}

async function statusEmail(
  event: OrderStatusChangedEvent,
  entry: OrderStatusChangedEvent["emails"][number],
  brand: Awaited<ReturnType<typeof loadCompany>>,
  status: { label: string; description: string | null; stage: string },
): Promise<EmailOutcome> {
  const recipient = await loadRecipient(event.db, entry.customerId);
  if (!recipient) throw new Error(`customer ${entry.customerId} not readable`);
  if (!recipient.email) return "no_address";
  const { data: orders, error } = await event.db
    .from("orders")
    .select("id, reference, store_vendor, tracking_number, description")
    .in("id", [...entry.orderIds]);
  if (error) throw error;
  const byId = new Map(orders.map((o) => [o.id, o]));
  const ordered = entry.orderIds.flatMap((id) => {
    const o = byId.get(id);
    return o
      ? [
          {
            id: o.id,
            reference: o.reference,
            storeVendor: o.store_vendor,
            trackingNumber: o.tracking_number,
            description: o.description,
          },
        ]
      : [];
  });
  if (ordered.length === 0) throw new Error("no readable orders for the status e-mail");

  const content = statusUpdateEmail({
    brand,
    customer: { ...recipient, email: recipient.email },
    access: recipient.access,
    status,
    orders: ordered,
    message: event.customerMessage,
    pickup:
      status.stage === "ready_for_pickup"
        ? {
            address: brand.pickupAddress,
            hours: brand.pickupHours,
            instructions: brand.pickupInstructions,
          }
        : null,
  });
  return sendToCustomer(recipient, content, {
    kind: "status_update",
    idempotencyKey: orderStatusEmailKey(entry.orderIds, entry.historyIds),
    // email_logs holds one order: the one the key names (the first change).
    orderId: firstStatusChange(entry.orderIds, entry.historyIds).orderId,
    replyTo: brand.email,
  });
}

/**
 * "Deel via WhatsApp" after a status change (SPEC §35.12): for every customer
 * whose "statusupdate" e-mail did not go out (e-mail not configured, failed,
 * no address), the same news as a ready WhatsApp message, with the portal
 * link only for an active customer with a login (on `linkBase`: APP_URL,
 * else the staff member's browser origin). Read with the staff member's own
 * client. Never throws: without it staff still get the toast.
 */
export async function statusFollowUps(
  event: OrderStatusChangedEvent,
  outcomes: readonly EmailOutcome[],
  linkBase: string | null,
): Promise<StatusFollowUp[]> {
  const pending = event.emails.flatMap((entry, i) => {
    const outcome = outcomes[i];
    return outcome && needsFollowUp(outcome) ? [{ entry, reason: outcome }] : [];
  });
  if (pending.length === 0) return [];
  try {
    const { db } = event;
    const [status, company, customers, orders] = await Promise.all([
      db
        .from("shipment_statuses")
        .select("label_nl, customer_description_nl, stage")
        .eq("code", event.toStatus)
        .maybeSingle(),
      db
        .from("company_settings")
        .select("company_name, pickup_address, pickup_hours, pickup_instructions")
        .maybeSingle(),
      db
        .from("customers")
        .select("id, full_name, company_name, account_type, customer_code, phone, user_id, status")
        .in(
          "id",
          pending.map((p) => p.entry.customerId),
        ),
      db
        .from("orders")
        .select("id, reference")
        .in(
          "id",
          pending.flatMap((p) => [...p.entry.orderIds]),
        ),
    ]);
    for (const r of [status, company, customers, orders]) if (r.error) throw r.error;
    const byCustomer = new Map((customers.data ?? []).map((c) => [c.id, c]));
    const references = new Map((orders.data ?? []).map((o) => [o.id, o.reference]));
    const companyName = company.data?.company_name ?? "G&R SOLUTIONS N.V.";
    return pending.flatMap(({ entry, reason }) => {
      const c = byCustomer.get(entry.customerId);
      if (!c) return [];
      const changed = entry.orderIds.flatMap((id) => {
        const reference = references.get(id);
        return reference ? [{ id, reference }] : [];
      });
      if (changed.length === 0) return [];
      const name =
        c.account_type === "business" && c.company_name
          ? `${c.company_name} (${c.full_name})`
          : c.full_name;
      return [
        {
          customerId: c.id,
          reason,
          customerName: name,
          customerCode: c.customer_code,
          phone: c.phone,
          references: changed.map((o) => o.reference),
          text: statusShareText({
            customerName: c.full_name,
            orders: changed,
            status: {
              label: status.data?.label_nl ?? event.toStatus,
              description: status.data?.customer_description_nl ?? null,
              stage: status.data?.stage ?? "",
            },
            message: event.customerMessage,
            pickup: company.data
              ? {
                  address: company.data.pickup_address,
                  hours: company.data.pickup_hours,
                  instructions: company.data.pickup_instructions,
                }
              : null,
            portalBase: c.user_id && c.status === "active" ? linkBase : null,
            companyName,
          }),
        },
      ];
    });
  } catch (error) {
    console.error("[statusFollowUps] could not prepare the WhatsApp messages", error);
    return [];
  }
}
