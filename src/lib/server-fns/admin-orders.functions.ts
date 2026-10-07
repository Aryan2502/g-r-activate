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
import { denied, requireStaff } from "@/lib/server-fns/middleware";

/**
 * Staff order actions (SPEC §11, §21, §35.7). Each one:
 * - runs requireStaff (requireSupabaseAuth + is_staff() as the caller) and
 *   returns its refusal as data;
 * - validates the input again with the form's zod schema;
 * - writes with the staff member's OWN client (context.access.supabase), so
 *   the RPC guards, RLS and triggers apply and the history records who did
 *   it ("door Maria"); never the service role;
 * - then calls the P8 e-mail hook in src/server/order-notifications.ts, which
 *   never fails the action.
 * Failures are RETURNED (TransportError), so the browser keeps the SQLSTATE
 * and hints such as pay_before_pickup; use the submit* wrappers below, which
 * throw them as CodedError.
 */

type Failure = { ok: false; error: TransportError };
export type StatusActionResponse = { ok: true; changed: string[]; unchanged: string[] } | Failure;

/** Expected refusals (validation, state, access) are warnings; the rest is an error. */
function logFailure(name: string, error: unknown) {
  const kind = toAppError(error).kind;
  const log = kind === "unknown" || kind === "network" ? console.error : console.warn;
  log(`[${name}] failed`, error);
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

    // P8 hook point: "statusupdate" e-mails, at most one per customer.
    try {
      const { onOrderStatusChanged } = await import("@/server/order-notifications");
      await onOrderStatusChanged({
        action: "status",
        toStatus: input.toStatus,
        customerMessage: input.customerMessage,
        emails: result.emails,
        userId: access.userId,
      });
    } catch (error) {
      console.error("[changeOrderStatusFn] onOrderStatusChanged failed", error);
    }
    return { ok: true, changed: result.changed, unchanged: result.unchanged };
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

    try {
      const { onOrderStatusChanged } = await import("@/server/order-notifications");
      await onOrderStatusChanged({
        action: "pickup",
        toStatus: input.toStatus,
        customerMessage: input.customerMessage,
        emails: result.emails,
        userId: access.userId,
      });
    } catch (error) {
      console.error("[pickupFn] onOrderStatusChanged failed", error);
    }
    return { ok: true, changed: result.changed, unchanged: result.unchanged };
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

    if (toStatus) {
      try {
        const { onOrderStatusChanged } = await import("@/server/order-notifications");
        await onOrderStatusChanged({
          action: "receive",
          toStatus,
          customerMessage: null,
          emails: result.emails,
          userId: access.userId,
        });
      } catch (error) {
        console.error("[receiveOrderFn] onOrderStatusChanged failed", error);
      }
    }
    return { ok: true, changed: result.changed, unchanged: result.unchanged };
  });

export type CreateOrderResponse =
  | {
      ok: true;
      id: string;
      reference: string;
      /** Set when the order was created but receiving it right away failed. */
      receiveError: TransportError | null;
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

    // P8 hook point: "order bevestigd". Never fails the creation.
    try {
      const { onOrderRegistered } = await import("@/server/order-notifications");
      await onOrderRegistered({
        orderId: order.id,
        reference: order.reference,
        customerId: order.customerId,
        parentOrderId: order.parentOrderId,
        userId: access.userId,
        createdBy: "staff",
      });
    } catch (error) {
      console.error("[createOrderForCustomerFn] onOrderRegistered failed", error);
    }

    let receiveError: TransportError | null = null;
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
        try {
          const { onOrderStatusChanged } = await import("@/server/order-notifications");
          await onOrderStatusChanged({
            action: "receive",
            toStatus: row?.status ?? "",
            customerMessage: null,
            emails: received.emails,
            userId: access.userId,
          });
        } catch (error) {
          console.error("[createOrderForCustomerFn] onOrderStatusChanged failed", error);
        }
      } catch (error) {
        logFailure("createOrderForCustomerFn/receive", error);
        receiveError = toTransportError(error);
      }
    }
    return { ok: true, id: order.id, reference: order.reference, receiveError };
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
