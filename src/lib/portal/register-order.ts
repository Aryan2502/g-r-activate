import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { CodedError } from "@/lib/errors";
import { t } from "@/lib/i18n";
import { toOrderColumns } from "@/lib/portal/order-fields";
import { applyRootOrder, type RegisterOrderData, type RootOrder } from "@/lib/portal/order-schema";

/**
 * The work of registerOrderFn (SPEC §9, §35.7), apart from the server
 * function so it can be tested with a fake client. Everything runs with the
 * CALLER's Supabase client: RLS and the orders_before_insert trigger decide
 * what is allowed (own customer only, initial status, server-owned columns
 * reset, enabled service type, the open-order limit, parent checks).
 */

type Client = Pick<SupabaseClient<Database>, "rpc" | "from">;

export interface RegisteredOrder {
  id: string;
  reference: string;
  customerId: string;
  parentOrderId: string | null;
}

const ROOT_COLUMNS =
  "id, parent_order_id, order_type, service_type, store_vendor, vendor_order_number, estimated_value_currency, purchase_date, supplier_name, client_po_number, purchase_mode, status_info:shipment_statuses(stage)" as const;

async function fetchOrderForPackage(client: Client, orderId: string) {
  const { data, error } = await client
    .from("orders")
    .select(ROOT_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * The root order an extra package hangs off. Part A always passes the root;
 * a link to an extra package is followed to its root, because
 * check_order_parent refuses nesting. RLS hides other customers' orders, so
 * "not found" covers both.
 */
export async function loadRootOrder(client: Client, orderId: string): Promise<RootOrder> {
  let order = await fetchOrderForPackage(client, orderId);
  if (order?.parent_order_id) order = await fetchOrderForPackage(client, order.parent_order_id);
  if (!order) throw new CodedError(t("portal.newOrder.sibling.notFoundText"), "P0002");
  // A cancelled purchase gets no new packages (the order page hides the button too).
  if (order.status_info?.stage === "cancelled") {
    throw new CodedError(t("portal.newOrder.sibling.cancelledText"), "55000");
  }
  return order;
}

export async function registerOrder(
  client: Client,
  input: RegisterOrderData,
): Promise<RegisteredOrder> {
  // Who the customer is comes from the database, for the caller's own login
  // (an active, linked customer); never from the browser. A staff login that
  // still has a customer record is refused: the database would treat its
  // insert as staff work (no open-order limit, any service type), and staff
  // register orders for customers in /admin.
  const [customer, staff] = await Promise.all([
    client.rpc("current_customer_id"),
    client.rpc("is_staff"),
  ]);
  if (customer.error) throw customer.error;
  if (staff.error) throw staff.error;
  const customerId = customer.data;
  if (!customerId || staff.data) throw new CodedError(t("apiError.forbidden"), "42501");

  let fields = input.fields;
  let parentOrderId: string | null = null;
  if (input.parentOrderId) {
    const root = await loadRootOrder(client, input.parentOrderId);
    fields = applyRootOrder(fields, root);
    parentOrderId = root.id;
  }

  const { data, error } = await client
    .from("orders")
    .insert({ ...toOrderColumns(fields), customer_id: customerId, parent_order_id: parentOrderId })
    .select("id, reference")
    .single();
  if (error) throw error;
  return { id: data.id, reference: data.reference, customerId, parentOrderId };
}
