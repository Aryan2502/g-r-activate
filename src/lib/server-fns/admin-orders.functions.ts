import { createServerFn } from "@tanstack/react-start";

import {
  changeOrderStatus,
  changeStatusInputSchema,
  createOrderForCustomer,
  createOrderInputSchema,
  parseActionInput,
  pickUpOrders,
  pickupInputSchema,
  receiveInputSchema,
  receiveOrder,
  weightFromText,
  type ChangeStatusInput,
  type CreateOrderInput,
  type PickupInput,
  type ReceiveInput,
} from "@/lib/admin/order-actions";
import {
  fromTransportError,
  toAppError,
  toTransportError,
  type TransportError,
} from "@/lib/errors";
import type { StatusFollowUp } from "@/lib/admin/status-share";
import type { EmailOutcome } from "@/lib/email/outcome";
import { denied, requireStaff } from "@/lib/server-fns/middleware";

/**
 * Staff order actions (SPEC §11, §21, §35.7). Each one:
 * - runs requireStaff (requireSupabaseAuth + is_staff() as the caller) and
 *   returns its refusal as data;
 * - validates the input again with the form's zod schema;
 * - writes with the staff member's OWN client (context.access.supabase), so
 *   the RPC guards, RLS and triggers apply and the history records who did
 *   it ("door Maria"); never the service role;
 * - then sends the e-mails (src/server/order-notifications.ts: "statusupdate",
 *   at most one per customer; "order bevestigd") and reports what happened
 *   to each (EmailOutcome), so the dialogs say whether the customer was
 *   e-mailed; an e-mail problem never fails the action.
 * Failures are RETURNED (TransportError), so the browser keeps the SQLSTATE
 * and hints such as pay_before_pickup; use the submit* wrappers below, which
 * throw them as CodedError.
 */

type Failure = { ok: false; error: TransportError };
export type StatusActionResponse =
  | {
      ok: true;
      changed: string[];
      unchanged: string[];
      /** One per customer that was to be e-mailed (empty: no e-mail was meant to go out). */
      emailOutcomes: EmailOutcome[];
      /**
       * Customers whose e-mail did not go out, with a WhatsApp message to
       * send instead (SPEC §35.12).
       */
      followUps: StatusFollowUp[];
    }
  | Failure;

/** Expected refusals (validation, state, access) are warnings; the rest is an error. */
function logFailure(name: string, error: unknown) {
  const kind = toAppError(error).kind;
  const log = kind === "unknown" || kind === "network" ? console.error : console.warn;
  log(`[${name}] failed`, error);
}

/**
 * The "statusupdate" e-mails of one action (an unexpected error counts as
 * failed), and a WhatsApp message for every customer whose e-mail did not go out.
 */
async function statusEmails(
  name: string,
  event: Parameters<typeof import("@/server/order-notifications").onOrderStatusChanged>[0],
): Promise<{ emailOutcomes: EmailOutcome[]; followUps: StatusFollowUp[] }> {
  if (event.emails.length === 0) return { emailOutcomes: [], followUps: [] };
  const notifications = await import("@/server/order-notifications");
  let emailOutcomes: EmailOutcome[];
  try {
    emailOutcomes = (await notifications.onOrderStatusChanged(event)).emails;
  } catch (error) {
    console.error(`[${name}] onOrderStatusChanged failed`, error);
    emailOutcomes = event.emails.map(() => "failed" as const);
  }
  let linkBase: string | null = null;
  try {
    linkBase = (await import("@/server/fn-helpers")).screenBase().base;
  } catch (error) {
    console.warn(`[${name}] no link base for WhatsApp messages`, error);
  }
  const followUps = await notifications.statusFollowUps(event, emailOutcomes, linkBase);
  return { emailOutcomes, followUps };
}

/** "Status wijzigen", for one order or a selection (bulk), in one call. */
export const changeOrderStatusFn = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  // Typing only: the handler parses with zod, so a bad request gets a Dutch answer.
  .validator((input: ChangeStatusInput): unknown => input)
  .handler(async ({ context, data }): Promise<StatusActionResponse> => {
    const access = context.access;
    if (!access.ok) return denied(access);

    let input;
    let result;
    try {
      input = parseActionInput(changeStatusInputSchema, data);
      result = await changeOrderStatus(access.supabase, input);
    } catch (error) {
      logFailure("changeOrderStatusFn", error);
      return { ok: false, error: toTransportError(error) };
    }

    // "statusupdate" e-mails, at most one per customer.
    const emails = await statusEmails("changeOrderStatusFn", {
      db: access.supabase,
      action: "status",
      toStatus: input.toStatus,
      customerMessage: input.customerMessage,
      emails: result.emails,
      userId: access.userId,
    });
    return { ok: true, changed: result.changed, unchanged: result.unchanged, ...emails };
  });

/**
 * "Afgeven": to a completed status with the name of who collected the
 * package. pay_before_pickup refuses unpaid orders (hint pay_before_pickup);
 * with an override reason, pickup_override hands them over anyway (audited).
 */
export const pickupFn = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((input: PickupInput): unknown => input)
  .handler(async ({ context, data }): Promise<StatusActionResponse> => {
    const access = context.access;
    if (!access.ok) return denied(access);

    let input;
    let result;
    try {
      input = parseActionInput(pickupInputSchema, data);
      result = await pickUpOrders(access.supabase, input);
    } catch (error) {
      logFailure("pickupFn", error);
      return { ok: false, error: toTransportError(error) };
    }

    const emails = await statusEmails("pickupFn", {
      db: access.supabase,
      action: "pickup",
      toStatus: input.toStatus,
      customerMessage: input.customerMessage,
      emails: result.emails,
      userId: access.userId,
    });
    return { ok: true, changed: result.changed, unchanged: result.unchanged, ...emails };
  });

/** "Ontvangen in US-magazijn": the measured weight, then the US-warehouse status. */
export const receiveOrderFn = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((input: ReceiveInput): unknown => input)
  .handler(async ({ context, data }): Promise<StatusActionResponse> => {
    const access = context.access;
    if (!access.ok) return denied(access);

    let result;
    let toStatus: string | null = null;
    try {
      const input = parseActionInput(receiveInputSchema, data);
      const weight = weightFromText(input.measuredWeightLbs);
      if (weight === null) throw new Error("validated weight missing");
      result = await receiveOrder(access.supabase, {
        orderId: input.orderId,
        measuredWeightLbs: weight,
      });
      if (result.changed.length > 0) {
        const { data: order } = await access.supabase
          .from("orders")
          .select("status")
          .eq("id", input.orderId)
          .maybeSingle();
        toStatus = order?.status ?? null;
      }
    } catch (error) {
      logFailure("receiveOrderFn", error);
      return { ok: false, error: toTransportError(error) };
    }

    const emails = toStatus
      ? await statusEmails("receiveOrderFn", {
          db: access.supabase,
          action: "receive",
          toStatus,
          customerMessage: null,
          emails: result.emails,
          userId: access.userId,
        })
      : { emailOutcomes: [], followUps: [] };
    return { ok: true, changed: result.changed, unchanged: result.unchanged, ...emails };
  });

export type CreateOrderResponse =
  | {
      ok: true;
      id: string;
      reference: string;
      /** Set when the order was created but receiving it right away failed. */
      receiveError: TransportError | null;
      /** "Order bevestigd" to the customer. */
      emailOutcome: EmailOutcome;
      /** "Statusupdate" of the immediate receipt (empty when not received or not e-mailed). */
      receiveEmailOutcomes: EmailOutcome[];
    }
  | Failure;

/**
 * "Order aanmaken voor klant": any customer, also one without a login
 * (created_by_role 'staff' comes from the database). With a measured weight
 * the order is received straight away; if that step fails, the order still
 * exists and the answer says why it was not received.
 */
export const createOrderForCustomerFn = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((input: CreateOrderInput): unknown => input)
  .handler(async ({ context, data }): Promise<CreateOrderResponse> => {
    const access = context.access;
    if (!access.ok) return denied(access);

    let input;
    let order;
    try {
      input = parseActionInput(createOrderInputSchema, data);
      order = await createOrderForCustomer(access.supabase, input);
    } catch (error) {
      logFailure("createOrderForCustomerFn", error);
      return { ok: false, error: toTransportError(error) };
    }

    // "Order bevestigd". Never fails the creation.
    let emailOutcome: EmailOutcome;
    try {
      const { onOrderRegistered } = await import("@/server/order-notifications");
      emailOutcome = (
        await onOrderRegistered({
          db: access.supabase,
          orderId: order.id,
          reference: order.reference,
          customerId: order.customerId,
          parentOrderId: order.parentOrderId,
          userId: access.userId,
          createdBy: "staff",
        })
      ).email;
    } catch (error) {
      console.error("[createOrderForCustomerFn] onOrderRegistered failed", error);
      emailOutcome = "failed";
    }

    let receiveError: TransportError | null = null;
    let receiveEmailOutcomes: EmailOutcome[] = [];
    const weight = weightFromText(input.measuredWeightLbs);
    if (weight !== null) {
      try {
        const received = await receiveOrder(access.supabase, {
          orderId: order.id,
          measuredWeightLbs: weight,
        });
        const { data: row } = await access.supabase
          .from("orders")
          .select("status")
          .eq("id", order.id)
          .maybeSingle();
        receiveEmailOutcomes = (
          await statusEmails("createOrderForCustomerFn", {
            db: access.supabase,
            action: "receive",
            toStatus: row?.status ?? "",
            customerMessage: null,
            emails: received.emails,
            userId: access.userId,
          })
        ).emailOutcomes;
      } catch (error) {
        logFailure("createOrderForCustomerFn/receive", error);
        receiveError = toTransportError(error);
      }
    }
    return {
      ok: true,
      id: order.id,
      reference: order.reference,
      receiveError,
      emailOutcome,
      receiveEmailOutcomes,
    };
  });

// ---------------------------------------------------------------------------
// Browser side: a returned failure is thrown as a CodedError (toasts, alerts,
// and the pay_before_pickup hint for the override dialog).
// ---------------------------------------------------------------------------

function unwrap<T extends { ok: true }>(result: T | Failure): T {
  if (!result.ok) throw fromTransportError(result.error);
  return result;
}

export async function submitStatusChange(input: ChangeStatusInput) {
  return unwrap(await changeOrderStatusFn({ data: input }));
}

export async function submitPickup(input: PickupInput) {
  return unwrap(await pickupFn({ data: input }));
}

export async function submitReceive(input: ReceiveInput) {
  return unwrap(await receiveOrderFn({ data: input }));
}

export async function submitCreateOrder(input: CreateOrderInput) {
  return unwrap(await createOrderForCustomerFn({ data: input }));
}
