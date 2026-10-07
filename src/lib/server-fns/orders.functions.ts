import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fromTransportError, toTransportError, type TransportError } from "@/lib/errors";
import { parseRegisterOrderInput, type RegisterOrderInput } from "@/lib/portal/order-schema";
import { registerOrder } from "@/lib/portal/register-order";

/**
 * "Order aanmelden" (SPEC §9, §35.7). Runs with the caller's own Supabase
 * client (context.supabase), never the service role: RLS and the
 * orders_before_insert trigger enforce ownership, the initial status, the
 * server-owned columns and the open-order limit. The browser's input is
 * validated again here with the same zod schema as the form.
 *
 * Failures are RETURNED (see TransportError in lib/errors.ts) so the
 * browser gets the Dutch message, SQLSTATE and hint; use registerOrder()
 * below, which turns them back into an error. Documents are uploaded by the
 * browser afterwards, straight to Storage (SPEC §35.2: files never pass
 * through a server function).
 */
export const registerOrderFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  // Typing only: the handler parses with zod first, so a bad request gets a
  // Dutch answer instead of a thrown zod issue list.
  .validator((input: RegisterOrderInput): unknown => input)
  .handler(
    async ({
      context,
      data,
    }): Promise<
      { ok: true; id: string; reference: string } | { ok: false; error: TransportError }
    > => {
      let order;
      try {
        order = await registerOrder(context.supabase, parseRegisterOrderInput(data));
      } catch (error) {
        console.error("[registerOrderFn] registration failed", error);
        return { ok: false, error: toTransportError(error) };
      }

      // P8 hook point: the "order bevestigd" e-mail. Never fails the registration.
      try {
        const { onOrderRegistered } = await import("@/server/order-notifications");
        await onOrderRegistered({
          orderId: order.id,
          reference: order.reference,
          customerId: order.customerId,
          parentOrderId: order.parentOrderId,
          userId: context.userId,
        });
      } catch (error) {
        console.error("[registerOrderFn] onOrderRegistered failed", error);
      }

      return { ok: true, id: order.id, reference: order.reference };
    },
  );

/** Calls registerOrderFn from the browser; a returned failure is thrown as a CodedError. */
export async function submitOrderRegistration(input: RegisterOrderInput) {
  const result = await registerOrderFn({ data: input });
  if (!result.ok) throw fromTransportError(result.error);
  return { id: result.id, reference: result.reference };
}
