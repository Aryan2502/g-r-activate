import { z } from "zod";

import { Constants } from "@/integrations/supabase/types";
import { CodedError } from "@/lib/errors";
import { todayInSuriname } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  isCalendarDate,
  isGrPurchase,
  issueAdder,
  orderFieldObject,
  refineOrderFields,
  shiftYears,
  toOrderFields,
  type OrderFieldsInput,
  type OrderFieldsOutput,
  type OrderFieldValues,
} from "@/lib/portal/order-fields";
import {
  newOrderSearchSchema,
  type OrderRow,
  type OrderType,
  type ServiceType,
} from "@/lib/portal/orders";

/**
 * "Order aanmelden" (SPEC §9, §35.7): the registration form and the input of
 * registerOrderFn. The same schema runs in the browser (inline errors) and in
 * the server function (which never trusts the browser), on the raw form
 * strings. The fields are the customer-editable columns of order-fields.ts;
 * registration asks a little more than an edit does: the estimated value and
 * the purchase date are required (except for a purchase G&R still has to
 * make), and dates must lie in a sensible window.
 */

/** A purchase date further back is almost always a typo (2016 for 2026). */
export const PURCHASE_DATE_MAX_AGE_YEARS = 2;
/** An expected delivery date further ahead is almost always a typo. */
export const EXPECTED_DELIVERY_MAX_YEARS_AHEAD = 1;

/** The registration's own rules, on top of refineOrderFields. */
export function refineRegistration(v: OrderFieldValues, ctx: z.RefinementCtx) {
  refineOrderFields(v, ctx);
  const issue = issueAdder(ctx);
  const today = todayInSuriname();
  if (!isGrPurchase(v)) {
    if (!v.estimatedValue) issue("estimatedValue", t("portal.orderForm.validation.valueRequired"));
    if (!v.purchaseDate) {
      issue("purchaseDate", t("portal.orderForm.validation.purchaseDateRequired"));
    }
  }
  if (
    isCalendarDate(v.purchaseDate) &&
    v.purchaseDate < shiftYears(today, -PURCHASE_DATE_MAX_AGE_YEARS)
  ) {
    issue("purchaseDate", t("portal.orderForm.validation.purchaseDateTooOld"));
  }
  if (
    isCalendarDate(v.expectedDeliveryDate) &&
    v.expectedDeliveryDate > shiftYears(today, EXPECTED_DELIVERY_MAX_YEARS_AHEAD)
  ) {
    issue("expectedDeliveryDate", t("portal.orderForm.validation.deliveryTooFar"));
  }
}

export const orderRegistrationFieldsSchema = orderFieldObject
  .superRefine(refineRegistration)
  .transform(toOrderFields);

/**
 * What the browser sends to registerOrderFn: the raw form values, the
 * required "Mijn zending bevat geen verboden goederen" confirmation (SPEC
 * §35.14) and, for "Extra pakket toevoegen", the order the package belongs to.
 * The customer is never part of the input: the server asks the database.
 */
export const registerOrderInputSchema = z.object({
  fields: orderRegistrationFieldsSchema,
  prohibitedGoodsAccepted: z.literal(true, {
    errorMap: () => ({ message: t("portal.newOrder.prohibited.required") }),
  }),
  parentOrderId: z.string().uuid().nullable(),
});

export type RegisterOrderInput = z.input<typeof registerOrderInputSchema>;
export type RegisterOrderData = z.output<typeof registerOrderInputSchema>;

/**
 * registerOrderFn's validator. The form has already shown field errors, so a
 * failure here means a stale or tampered request: one Dutch message (22023)
 * instead of zod's issue list.
 */
export function parseRegisterOrderInput(input: unknown): RegisterOrderData {
  const parsed = registerOrderInputSchema.safeParse(input);
  if (!parsed.success) throw new CodedError(t("portal.newOrder.invalid"), "22023");
  return parsed.data;
}

/**
 * Search params of /portal/orders/nieuw: part A's `parent` contract plus the
 * chosen order type (step 1), so the browser's back button returns to the
 * choice. Invalid values are dropped, never an error page.
 */
export const newOrderPageSearchSchema = newOrderSearchSchema.extend({
  type: z.enum(Constants.public.Enums.order_type).optional().catch(undefined),
});
export type NewOrderPageSearch = z.infer<typeof newOrderPageSearchSchema>;

// ---------------------------------------------------------------------------
// "Extra pakket toevoegen": a sibling of the root order (parent_order_id)
// ---------------------------------------------------------------------------

/** What a new package takes over from the root order of the purchase. */
export type RootOrder = Pick<
  OrderRow,
  | "id"
  | "order_type"
  | "service_type"
  | "store_vendor"
  | "vendor_order_number"
  | "estimated_value_currency"
  | "purchase_date"
  | "supplier_name"
  | "client_po_number"
  | "purchase_mode"
>;

/**
 * Fields the form shows read-only for an extra package: one purchase has one
 * store and one vendor order number. A root without a value leaves the field
 * open, so a store can still be filled in.
 */
export function lockedByRoot(root: Pick<RootOrder, "store_vendor" | "vendor_order_number">) {
  return {
    storeVendor: Boolean(root.store_vendor),
    vendorOrderNumber: Boolean(root.vendor_order_number),
  };
}

/**
 * Applied by the server function: the order type, store and vendor order
 * number of an extra package always come from its root order, whatever the
 * browser sent. Personal roots therefore also clear any B2B fields.
 */
export function applyRootOrder<T extends OrderFieldsOutput>(
  fields: T,
  root: Pick<RootOrder, "order_type" | "store_vendor" | "vendor_order_number">,
): T {
  return {
    ...fields,
    orderType: root.order_type,
    storeVendor: root.store_vendor || fields.storeVendor,
    vendorOrderNumber: root.vendor_order_number || fields.vendorOrderNumber,
  };
}

/** The root's service type if still offered, else air, else the first enabled one. */
export function defaultServiceType(
  enabled: readonly ServiceType[],
  preferred?: ServiceType | null,
): ServiceType {
  if (preferred && enabled.includes(preferred)) return preferred;
  if (enabled.includes("air")) return "air";
  return enabled[0] ?? "air";
}

/**
 * Starting values of the form. A new order starts empty (quantity 1, USD);
 * an extra package takes over the purchase details of its root order but
 * not what differs per box (description, value, tracking, weight, note).
 */
export function newOrderDefaults({
  orderType,
  serviceTypes,
  root,
}: {
  orderType?: OrderType | undefined;
  serviceTypes: readonly ServiceType[];
  root?: RootOrder | null | undefined;
}): OrderFieldsInput {
  return {
    orderType: root?.order_type ?? orderType ?? "personal",
    serviceType: defaultServiceType(serviceTypes, root?.service_type),
    storeVendor: root?.store_vendor ?? "",
    vendorOrderNumber: root?.vendor_order_number ?? "",
    description: "",
    quantity: "1",
    estimatedValue: "",
    estimatedValueCurrency: root?.estimated_value_currency ?? "USD",
    purchaseDate: root?.purchase_date ?? "",
    expectedDeliveryDate: "",
    trackingNumber: "",
    carrier: "",
    declaredWeightLbs: "",
    customerNote: "",
    supplierName: root?.supplier_name ?? "",
    clientPoNumber: root?.client_po_number ?? "",
    purchaseMode: root?.purchase_mode ?? "",
  };
}
