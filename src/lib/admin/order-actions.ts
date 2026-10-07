import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";
import { CodedError } from "@/lib/errors";
import { t } from "@/lib/i18n";
import {
  decimalText,
  orderFieldsSchema,
  parseDecimal,
  toOrderColumns,
} from "@/lib/portal/order-fields";
import { applyRootOrder } from "@/lib/portal/order-schema";

/**
 * The work behind the staff order actions (SPEC §11, §35.7), apart from the
 * server functions (lib/server-fns/admin-orders.functions.ts) so it can be
 * tested with a fake client. Everything runs with the STAFF MEMBER's own
 * client: change_order_status, receive_order and pickup_override check
 * is_staff() themselves and the history trigger records who did it; the
 * orders insert goes through RLS and orders_before_insert (initial status,
 * created_by_role 'staff', reference). Never the service role.
 */

type Client = Pick<SupabaseClient<Database>, "rpc" | "from">;
/**
 * One row of change_order_status / receive_order / pickup_override. The
 * generated type says history_id is a number, but it is null for an order
 * that already had the target status.
 */
export interface StatusChangeRow {
  order_id: string;
  customer_id: string;
  history_id: number | null;
  notify: boolean;
}

const STATUS_CODE = /^[a-z][a-z0-9_]{1,49}$/;

/** Empty or whitespace-only → null; otherwise trimmed. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const orderIds = z.array(z.string().uuid()).min(1).max(1000);

/** "Status wijzigen", single or bulk (change_order_status, one call per action). */
export const changeStatusInputSchema = z.object({
  orderIds,
  toStatus: z.string().regex(STATUS_CODE),
  /** Shown to the customer with the new status (required for "Actie vereist"). */
  customerMessage: optionalText(2000),
  /** Only for a completed status: who collected the package. */
  pickedUpByName: optionalText(200),
  /** "Klant e-mailen" (P8): at most one e-mail per customer per action. */
  notifyCustomer: z.boolean(),
});
export type ChangeStatusInput = z.input<typeof changeStatusInputSchema>;
export type ChangeStatusData = z.output<typeof changeStatusInputSchema>;

/**
 * "Afgeven" (SPEC §35.7): a completed status with the name of who collected
 * it. With an override reason it hands over unpaid orders anyway
 * (pickup_override, audited); without one, pay_before_pickup may refuse.
 */
export const pickupInputSchema = changeStatusInputSchema.extend({
  pickedUpByName: z.string().trim().min(1).max(200),
  overrideReason: optionalText(500),
});
export type PickupInput = z.input<typeof pickupInputSchema>;
export type PickupData = z.output<typeof pickupInputSchema>;

/** Measured weight in lbs: > 0, at most 2 decimals, Dutch or English decimal mark. */
export const measuredWeightText = decimalText({
  max: 99_999_999.99,
  positive: true,
  invalid: t("admin.receive.weightInvalid"),
});

/** "Ontvangen in US-magazijn" (receive_order). */
export const receiveInputSchema = z.object({
  orderId: z.string().uuid(),
  measuredWeightLbs: measuredWeightText.refine((v) => v !== "", {
    message: t("admin.receive.weightRequired"),
  }),
});
export type ReceiveInput = z.input<typeof receiveInputSchema>;

/**
 * "Order aanmaken voor klant": the customer-editable order fields (same
 * schema as "Gegevens wijzigen"), for any customer, also one without a login.
 * Optionally received right away with its measured weight (a package that
 * arrived without a registration).
 */
export const createOrderInputSchema = z.object({
  customerId: z.string().uuid(),
  fields: orderFieldsSchema,
  parentOrderId: z.string().uuid().nullable(),
  measuredWeightLbs: measuredWeightText,
});
export type CreateOrderInput = z.input<typeof createOrderInputSchema>;
export type CreateOrderData = z.output<typeof createOrderInputSchema>;

/**
 * Parses a server function's input. The forms have already shown field
 * errors, so a failure here means a stale or tampered request: one Dutch
 * message (22023) instead of zod's issue list.
 */
export function parseActionInput<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new CodedError(t("admin.actions.invalid"), "22023");
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Results and e-mail planning (P8)
// ---------------------------------------------------------------------------

export interface StatusChangeOutcome {
  /** Orders whose status changed (a history row was written). */
  changed: string[];
  /** Orders that already had the target status (left alone). */
  unchanged: string[];
  rows: StatusChangeRow[];
}

export function summarizeStatusChange(rows: readonly StatusChangeRow[]): StatusChangeOutcome {
  return {
    changed: rows.filter((r) => r.history_id !== null).map((r) => r.order_id),
    unchanged: rows.filter((r) => r.history_id === null).map((r) => r.order_id),
    rows: [...rows],
  };
}

export interface StatusEmail {
  customerId: string;
  orderIds: string[];
  /**
   * The shipment_status_history rows this e-mail reports, in the same order
   * as orderIds: a stable idempotency key for P8 (email_logs), also when an
   * order returns to a status it had before.
   */
  historyIds: number[];
}

/**
 * Who gets a "statusupdate" e-mail for one action (SPEC §35.12): only orders
 * that actually changed, never for a status the customer cannot see, and at
 * most ONE e-mail per customer however many of their orders moved.
 */
export function planStatusEmails(
  rows: readonly Pick<StatusChangeRow, "order_id" | "customer_id" | "history_id">[],
  { notify, customerVisible }: { notify: boolean; customerVisible: boolean },
): StatusEmail[] {
  if (!notify || !customerVisible) return [];
  const byCustomer = new Map<string, StatusEmail>();
  for (const row of rows) {
    if (row.history_id === null) continue;
    const email = byCustomer.get(row.customer_id) ?? {
      customerId: row.customer_id,
      orderIds: [],
      historyIds: [],
    };
    email.orderIds.push(row.order_id);
    email.historyIds.push(row.history_id);
    byCustomer.set(row.customer_id, email);
  }
  return [...byCustomer.values()];
}

async function targetStatus(client: Client, code: string) {
  const { data, error } = await client
    .from("shipment_statuses")
    .select("code, customer_visible, notify_customer, stage")
    .eq("code", code)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface StatusActionResult extends StatusChangeOutcome {
  emails: StatusEmail[];
}

/** change_order_status for one action; pay_before_pickup refusals keep their hint. */
export async function changeOrderStatus(
  client: Client,
  input: ChangeStatusData,
): Promise<StatusActionResult> {
  const { data, error } = await client.rpc("change_order_status", {
    _order_ids: input.orderIds,
    _to_status: input.toStatus,
    ...(input.customerMessage ? { _customer_message: input.customerMessage } : {}),
    ...(input.pickedUpByName ? { _picked_up_by_name: input.pickedUpByName } : {}),
  });
  if (error) throw error;
  const outcome = summarizeStatusChange(data);
  const status = await targetStatus(client, input.toStatus);
  return {
    ...outcome,
    emails: planStatusEmails(data, {
      notify: input.notifyCustomer,
      customerVisible: status?.customer_visible ?? false,
    }),
  };
}

/** "Afgeven": change_order_status, or pickup_override with a reason. */
export async function pickUpOrders(client: Client, input: PickupData): Promise<StatusActionResult> {
  if (!input.overrideReason) {
    return changeOrderStatus(client, input);
  }
  const { data, error } = await client.rpc("pickup_override", {
    _order_ids: input.orderIds,
    _to_status: input.toStatus,
    _picked_up_by_name: input.pickedUpByName,
    _reason: input.overrideReason,
    ...(input.customerMessage ? { _customer_message: input.customerMessage } : {}),
  });
  if (error) throw error;
  const status = await targetStatus(client, input.toStatus);
  return {
    ...summarizeStatusChange(data),
    emails: planStatusEmails(data, {
      notify: input.notifyCustomer,
      customerVisible: status?.customer_visible ?? false,
    }),
  };
}

/**
 * receive_order: records the measured weight and moves the order to the US
 * warehouse; receiving again while it is there only corrects the weight. The
 * e-mail follows the status's own notify_customer (the RPC reports it).
 */
export async function receiveOrder(
  client: Client,
  input: { orderId: string; measuredWeightLbs: number },
): Promise<StatusActionResult> {
  const { data, error } = await client.rpc("receive_order", {
    _order_id: input.orderId,
    _measured_weight_lbs: input.measuredWeightLbs,
  });
  if (error) throw error;
  return {
    ...summarizeStatusChange(data),
    emails: planStatusEmails(
      data.filter((r) => r.notify),
      { notify: true, customerVisible: true },
    ),
  };
}

/**
 * "Gewicht invullen/corrigeren" for an order past the US warehouse (SPEC
 * §35.7: staff enter measured_weight_lbs, invoicing uses it). receive_order
 * refuses those orders, but measured_weight_lbs is a staff-editable column
 * (orders_guard_update), so the staff member's own client updates it; the
 * audit trigger records who changed it. Received at/by stay as they are.
 */
export async function updateMeasuredWeight(
  client: Client,
  input: { orderId: string; measuredWeightLbs: number },
): Promise<void> {
  const { error } = await client
    .from("orders")
    .update({ measured_weight_lbs: input.measuredWeightLbs })
    .eq("id", input.orderId)
    .select("id")
    .single();
  if (error) throw error;
}

/** The weight text of a valid form as a number (validated by measuredWeightText). */
export function weightFromText(value: string): number | null {
  const n = parseDecimal(value);
  return n === null || Number.isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// "Order aanmaken voor klant"
// ---------------------------------------------------------------------------

const ROOT_COLUMNS =
  "id, parent_order_id, customer_id, order_type, store_vendor, vendor_order_number" as const;

async function fetchOrder(client: Client, id: string) {
  const { data, error } = await client
    .from("orders")
    .select(ROOT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface CreatedOrder {
  id: string;
  reference: string;
  customerId: string;
  parentOrderId: string | null;
}

/**
 * Inserts the order for the chosen customer with the staff member's client.
 * orders_before_insert gives it the initial status, its reference and
 * created_by_role 'staff', and refuses a disabled customer. An extra package
 * takes over the purchase details of its root order (check_order_parent
 * refuses a root of another customer or a nested package).
 */
export async function createOrderForCustomer(
  client: Client,
  input: CreateOrderData,
): Promise<CreatedOrder> {
  let fields = input.fields;
  let parentOrderId: string | null = null;
  if (input.parentOrderId) {
    let root = await fetchOrder(client, input.parentOrderId);
    if (root?.parent_order_id) root = await fetchOrder(client, root.parent_order_id);
    if (!root || root.customer_id !== input.customerId) {
      throw new CodedError(t("admin.newOrder.parentMismatch"), "22023");
    }
    fields = applyRootOrder(fields, root);
    parentOrderId = root.id;
  }
  const { data, error } = await client
    .from("orders")
    .insert({
      ...toOrderColumns(fields),
      customer_id: input.customerId,
      parent_order_id: parentOrderId,
    })
    .select("id, reference")
    .single();
  if (error) throw error;
  return { id: data.id, reference: data.reference, customerId: input.customerId, parentOrderId };
}

// ---------------------------------------------------------------------------
// "Order behouden" after a cancellation request
// ---------------------------------------------------------------------------

/**
 * Not yet in the generated types: keep_order_after_cancellation_request
 * arrives with migration 20261007150000_p5_customers.sql, and types.ts is
 * regenerated from the live database after it is applied. This one narrow
 * signature stands in until then (drop it once types.ts lists the RPC).
 */
type KeepOrderRpc = (
  fn: "keep_order_after_cancellation_request",
  args: { _order_id: string; _customer_message?: string },
) => PromiseLike<{ error: { code?: string; message: string } | null }>;

/** PostgREST's "function not found" (the migration is not applied yet), or Postgres' own. */
const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);

/** At most what shipment_status_history.customer_message holds. */
export const KEEP_ORDER_MESSAGE_MAX = 2000;

/**
 * "Order behouden" (SPEC §35.7; carry-over of P4): the guarded staff RPC
 * clears orders.cancellation_requested_at, resolves the open cancellation
 * task and puts a message for the customer on the order's history (the
 * database's default text when `customerMessage` is empty), in one
 * transaction. The portal then stops showing the request, shows why, and the
 * customer can ask again later. Before the migration is applied the RPC does
 * not exist yet: then only the task is resolved, as in P4 (`cleared: false`).
 */
export async function keepOrderAfterCancellation(
  client: Client,
  input: { orderId: string; taskId: string | null; customerMessage?: string },
): Promise<{ cleared: boolean }> {
  const rpc = client.rpc as unknown as KeepOrderRpc;
  const message = input.customerMessage?.trim();
  const { error } = await rpc.call(client, "keep_order_after_cancellation_request", {
    _order_id: input.orderId,
    ...(message ? { _customer_message: message } : {}),
  });
  if (!error) return { cleared: true };
  if (!MISSING_FUNCTION.has(error.code ?? "") || !input.taskId) throw error;
  const fallback = await client
    .from("staff_tasks")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", input.taskId)
    .is("resolved_at", null)
    .select("id")
    .single();
  if (fallback.error) throw fallback.error;
  return { cleared: false };
}
