import { z } from "zod";

import { Constants, type Database } from "@/integrations/supabase/types";
import { formatNumber, todayInSuriname } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { OrderRow } from "@/lib/portal/orders";

/**
 * The fields a customer may enter or change on an order (SPEC §9, §35.7):
 * exactly the customer-editable list of private.orders_guard_update. Limits
 * mirror the orders table checks. Form values are strings; the output is
 * ready for the orders table (empty → null, B2B fields cleared on personal
 * orders as orders_b2b_fields_check requires).
 *
 * Validation runs in two layers: each field on its own (lengths, formats),
 * then the rules that depend on other fields (refineOrderFields: required
 * fields per purchase mode, date windows). The field layer never converts
 * values, so the second layer always runs and every error shows on the
 * first submit; numbers are converted at the end (toOrderFields).
 */

type OrderUpdate = Database["public"]["Tables"]["orders"]["Update"];

const tooLong = (max: number) => t("portal.orderForm.validation.tooLong", { max });

const text = (max: number) => z.string().trim().max(max, tooLong(max));
const requiredText = (max: number, message: string) => text(max).min(1, message);

/** Accepts '1.234,56', '1234,56' and '1234.56' (Dutch or English decimal mark). */
export function parseDecimal(input: string): number | null {
  const value = input.trim().replace(/\s/g, "");
  if (!value) return null;
  let normalised = value;
  if (value.includes(",") && value.includes(".")) {
    // The last separator is the decimal mark.
    normalised =
      value.lastIndexOf(",") > value.lastIndexOf(".")
        ? value.replace(/\./g, "").replace(",", ".")
        : value.replace(/,/g, "");
  } else if (value.includes(",")) {
    normalised = value.replace(",", ".");
  }
  if (!/^\d+(\.\d+)?$/.test(normalised)) return Number.NaN;
  return Number(normalised);
}

const decimalsOf = (n: number) => (String(n).split(".")[1] ?? "").length;

/**
 * Decimal text with at most 2 places, between 0 (exclusive when `positive`)
 * and max; empty is allowed here (required-ness is a cross-field rule).
 */
export const decimalText = ({
  max,
  positive,
  invalid,
}: {
  max: number;
  positive: boolean;
  invalid: string;
}) =>
  z
    .string()
    .trim()
    .refine(
      (value) => {
        const n = parseDecimal(value);
        if (n === null) return true;
        return !Number.isNaN(n) && decimalsOf(n) <= 2 && n <= max && (positive ? n > 0 : n >= 0);
      },
      { message: invalid },
    );

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real calendar date as 'YYYY-MM-DD'. Date.parse would roll 2026-02-30 over
 * to 2 March; Postgres refuses it.
 */
export function isCalendarDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y = 0, m = 0, d = 0] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    y >= 1000 &&
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** 'YYYY-MM-DD' shifted by whole years (29 February becomes 28 February). */
export function shiftYears(date: string, years: number): string {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(y + years, m - 1, d));
  if (shifted.getUTCMonth() !== m - 1) shifted.setUTCDate(0);
  return shifted.toISOString().slice(0, 10);
}

const dateField = z
  .string()
  .trim()
  .refine((v) => v === "" || isCalendarDate(v), {
    message: t("portal.orderForm.validation.dateInvalid"),
  });

/** Field by field (strings in, strings out); see refineOrderFields for the rest. */
export const orderFieldShape = {
  orderType: z.enum(Constants.public.Enums.order_type),
  serviceType: z.enum(Constants.public.Enums.service_type),
  storeVendor: text(200),
  vendorOrderNumber: text(100),
  description: requiredText(2000, t("portal.orderForm.validation.descriptionRequired")),
  quantity: z
    .string()
    .trim()
    .refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 100000, {
      message: t("portal.orderForm.validation.quantityInvalid"),
    }),
  estimatedValue: decimalText({
    max: 9_999_999_999.99,
    positive: false,
    invalid: t("portal.orderForm.validation.valueInvalid"),
  }),
  estimatedValueCurrency: z.enum(Constants.public.Enums.currency_code),
  purchaseDate: dateField,
  expectedDeliveryDate: dateField,
  trackingNumber: text(100),
  carrier: text(100),
  declaredWeightLbs: decimalText({
    max: 99_999_999.99,
    positive: true,
    invalid: t("portal.orderForm.validation.weightInvalid"),
  }),
  customerNote: text(2000),
  supplierName: text(200),
  clientPoNumber: text(100),
  purchaseMode: z.union([z.literal(""), z.enum(Constants.public.Enums.purchase_mode)]),
};

export const orderFieldObject = z.object(orderFieldShape);
export type OrderFieldValues = z.output<typeof orderFieldObject>;

/**
 * B2B with "Inkoop door G&R" (SPEC §3): G&R still has to buy the goods, so
 * the webshop, the value and the purchase date may not be known yet (the
 * columns are nullable). The supplier can stand in for the store.
 */
export const isGrPurchase = (v: { orderType: string; purchaseMode: string }) =>
  v.orderType === "b2b" && v.purchaseMode === "gr_purchases";

/** A purchase G&R still has to make may be dated up to this far ahead. */
export const PLANNED_PURCHASE_MAX_YEARS_AHEAD = 1;

type Issue = (path: keyof OrderFieldValues, message: string) => void;

export const issueAdder =
  (ctx: z.RefinementCtx): Issue =>
  (path, message) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

/**
 * The rules that need more than one field, shared by "Order aanmelden" and
 * "Gegevens wijzigen" (registration adds its own, order-schema.ts):
 * - a store, or for a G&R purchase a store or a supplier;
 * - no purchase date in the future, except a planned G&R purchase (≤ 1 year);
 * - orders_dates_check: the expected delivery is not before the purchase.
 */
export function refineOrderFields(v: OrderFieldValues, ctx: z.RefinementCtx) {
  const issue = issueAdder(ctx);
  const gr = isGrPurchase(v);

  if (!v.storeVendor) {
    if (!gr) issue("storeVendor", t("portal.orderForm.validation.storeRequired"));
    else if (!v.supplierName) {
      issue("storeVendor", t("portal.orderForm.validation.storeOrSupplierRequired"));
    }
  }

  if (isCalendarDate(v.purchaseDate)) {
    const today = todayInSuriname();
    if (!gr && v.purchaseDate > today) {
      issue("purchaseDate", t("portal.orderForm.validation.purchaseDateFuture"));
    } else if (gr && v.purchaseDate > shiftYears(today, PLANNED_PURCHASE_MAX_YEARS_AHEAD)) {
      issue("purchaseDate", t("portal.orderForm.validation.purchaseDateTooFar"));
    }
  }

  if (
    isCalendarDate(v.purchaseDate) &&
    isCalendarDate(v.expectedDeliveryDate) &&
    v.expectedDeliveryDate < v.purchaseDate
  ) {
    issue("expectedDeliveryDate", t("portal.orderForm.validation.deliveryBeforePurchase"));
  }
}

/** The validated strings as typed values (quantity and amounts as numbers, empty → null). */
export function toOrderFields(v: OrderFieldValues) {
  return {
    ...v,
    quantity: Number(v.quantity),
    estimatedValue: parseDecimal(v.estimatedValue),
    declaredWeightLbs: parseDecimal(v.declaredWeightLbs),
  };
}

/** "Gegevens wijzigen". */
export const orderFieldsSchema = orderFieldObject
  .superRefine(refineOrderFields)
  .transform(toOrderFields);

export type OrderFieldsInput = z.input<typeof orderFieldsSchema>;
export type OrderFieldsOutput = z.output<typeof orderFieldsSchema>;

const orNull = (value: string) => (value === "" ? null : value);

/** Columns for orders insert/update; only customer-editable columns. */
export function toOrderColumns(v: OrderFieldsOutput) {
  const b2b = v.orderType === "b2b";
  return {
    order_type: v.orderType,
    service_type: v.serviceType,
    store_vendor: orNull(v.storeVendor),
    vendor_order_number: orNull(v.vendorOrderNumber),
    description: v.description,
    quantity: v.quantity,
    estimated_value: v.estimatedValue,
    estimated_value_currency: v.estimatedValueCurrency,
    purchase_date: orNull(v.purchaseDate),
    expected_delivery_date: orNull(v.expectedDeliveryDate),
    tracking_number: orNull(v.trackingNumber),
    carrier: orNull(v.carrier),
    declared_weight_lbs: v.declaredWeightLbs,
    customer_note: orNull(v.customerNote),
    supplier_name: b2b ? orNull(v.supplierName) : null,
    client_po_number: b2b ? orNull(v.clientPoNumber) : null,
    purchase_mode: b2b && v.purchaseMode !== "" ? v.purchaseMode : null,
  } satisfies OrderUpdate;
}

const decimalInput = (n: number | null) =>
  n === null ? "" : formatNumber(n, 2).replace(/\./g, "");

/** Form values for an existing order. */
export function orderFieldsFromOrder(
  order: Pick<
    OrderRow,
    | "order_type"
    | "service_type"
    | "store_vendor"
    | "vendor_order_number"
    | "description"
    | "quantity"
    | "estimated_value"
    | "estimated_value_currency"
    | "purchase_date"
    | "expected_delivery_date"
    | "tracking_number"
    | "carrier"
    | "declared_weight_lbs"
    | "customer_note"
    | "supplier_name"
    | "client_po_number"
    | "purchase_mode"
  >,
): OrderFieldsInput {
  return {
    orderType: order.order_type,
    serviceType: order.service_type,
    storeVendor: order.store_vendor ?? "",
    vendorOrderNumber: order.vendor_order_number ?? "",
    description: order.description ?? "",
    quantity: String(order.quantity),
    estimatedValue: decimalInput(order.estimated_value),
    estimatedValueCurrency: order.estimated_value_currency,
    purchaseDate: order.purchase_date ?? "",
    expectedDeliveryDate: order.expected_delivery_date ?? "",
    trackingNumber: order.tracking_number ?? "",
    carrier: order.carrier ?? "",
    declaredWeightLbs: decimalInput(order.declared_weight_lbs),
    customerNote: order.customer_note ?? "",
    supplierName: order.supplier_name ?? "",
    clientPoNumber: order.client_po_number ?? "",
    purchaseMode: order.purchase_mode ?? "",
  };
}

/**
 * Carriers that deliver to the US warehouse most often, offered as a list in
 * the form; anything else is typed in ("Anders"). The column stays free text.
 */
export const COMMON_CARRIERS = [
  "UPS",
  "FedEx",
  "USPS",
  "DHL",
  "Amazon Logistics",
  "OnTrac",
] as const;

export type CarrierChoice = (typeof COMMON_CARRIERS)[number] | "unknown" | "other";

/** Which option of the carrier list a stored carrier corresponds to. */
export function carrierChoice(carrier: string): CarrierChoice {
  const value = carrier.trim();
  if (!value) return "unknown";
  const known = COMMON_CARRIERS.find((c) => c.toLowerCase() === value.toLowerCase());
  return known ?? "other";
}
