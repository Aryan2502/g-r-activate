import { describe, expect, it } from "vitest";

import {
  COMMON_CARRIERS,
  carrierChoice,
  isCalendarDate,
  orderFieldsFromOrder,
  orderFieldsSchema,
  parseDecimal,
  shiftYears,
  toOrderColumns,
  type OrderFieldsInput,
} from "./order-fields";

const valid: OrderFieldsInput = {
  orderType: "personal",
  serviceType: "air",
  storeVendor: " Amazon ",
  vendorOrderNumber: "",
  description: "Schoenen",
  quantity: "2",
  estimatedValue: "1.234,50",
  estimatedValueCurrency: "USD",
  purchaseDate: "2026-01-02",
  expectedDeliveryDate: "",
  trackingNumber: "",
  carrier: "",
  declaredWeightLbs: "2,5",
  customerNote: "",
  supplierName: "Acme",
  clientPoNumber: "PO-1",
  purchaseMode: "gr_purchases",
};

describe("parseDecimal()", () => {
  it("reads Dutch and English decimal marks", () => {
    expect(parseDecimal("12,50")).toBe(12.5);
    expect(parseDecimal("12.50")).toBe(12.5);
    expect(parseDecimal("1.234,56")).toBe(1234.56);
    expect(parseDecimal("1,234.56")).toBe(1234.56);
    expect(parseDecimal(" 7 ")).toBe(7);
  });

  it("returns null for empty and NaN for nonsense", () => {
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("abc")).toBeNaN();
    expect(parseDecimal("-5")).toBeNaN();
  });
});

describe("orderFieldsSchema", () => {
  it("maps to customer-editable columns only, with empty values as null", () => {
    const columns = toOrderColumns(orderFieldsSchema.parse(valid));
    expect(columns).toEqual({
      order_type: "personal",
      service_type: "air",
      store_vendor: "Amazon",
      vendor_order_number: null,
      description: "Schoenen",
      quantity: 2,
      estimated_value: 1234.5,
      estimated_value_currency: "USD",
      purchase_date: "2026-01-02",
      expected_delivery_date: null,
      tracking_number: null,
      carrier: null,
      declared_weight_lbs: 2.5,
      customer_note: null,
      // orders_b2b_fields_check: personal orders carry no B2B fields.
      supplier_name: null,
      client_po_number: null,
      purchase_mode: null,
    });
    // The orders_guard_update list (migration 2).
    expect(Object.keys(columns).sort()).toEqual(
      [
        "order_type",
        "service_type",
        "store_vendor",
        "vendor_order_number",
        "description",
        "quantity",
        "estimated_value",
        "estimated_value_currency",
        "purchase_date",
        "expected_delivery_date",
        "customer_note",
        "tracking_number",
        "carrier",
        "declared_weight_lbs",
        "supplier_name",
        "client_po_number",
        "purchase_mode",
      ].sort(),
    );
  });

  it("keeps B2B fields on B2B orders", () => {
    const columns = toOrderColumns(orderFieldsSchema.parse({ ...valid, orderType: "b2b" }));
    expect(columns).toMatchObject({
      supplier_name: "Acme",
      client_po_number: "PO-1",
      purchase_mode: "gr_purchases",
    });
  });

  it("requires store and description", () => {
    const result = orderFieldsSchema.safeParse({ ...valid, storeVendor: " ", description: "" });
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["storeVendor", "description"]));
  });

  it("lets the supplier stand in for the store on a B2B purchase by G&R, and keeps value and date optional", () => {
    const gr = {
      ...valid,
      orderType: "b2b" as const,
      purchaseMode: "gr_purchases" as const,
      storeVendor: "",
      estimatedValue: "",
      purchaseDate: "",
    };
    expect(toOrderColumns(orderFieldsSchema.parse(gr))).toMatchObject({
      store_vendor: null,
      supplier_name: "Acme",
      estimated_value: null,
      purchase_date: null,
    });
    const neither = orderFieldsSchema.safeParse({ ...gr, supplierName: "" });
    expect(neither.success ? [] : neither.error.issues.map((i) => i.path.join("."))).toEqual([
      "storeVendor",
    ]);
  });

  it("checks the table limits", () => {
    const bad = (patch: Partial<OrderFieldsInput>) =>
      orderFieldsSchema.safeParse({ ...valid, ...patch }).success;
    expect(bad({ quantity: "0" })).toBe(false);
    expect(bad({ quantity: "1.5" })).toBe(false);
    expect(bad({ declaredWeightLbs: "0" })).toBe(false);
    expect(bad({ declaredWeightLbs: "1,234" })).toBe(false);
    expect(bad({ estimatedValue: "0" })).toBe(true);
    expect(bad({ estimatedValue: "-1" })).toBe(false);
    expect(bad({ trackingNumber: "x".repeat(101) })).toBe(false);
    expect(bad({ purchaseDate: "2999-01-01" })).toBe(false);
    expect(bad({ purchaseDate: "2026-02-30x" })).toBe(false);
    // Date.parse rolls this over to 2 March; Postgres refuses it.
    expect(bad({ purchaseDate: "2026-02-30" })).toBe(false);
  });

  it("refuses a delivery date before the purchase date (orders_dates_check)", () => {
    const result = orderFieldsSchema.safeParse({ ...valid, expectedDeliveryDate: "2026-01-01" });
    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.issues[0]?.path).toEqual(["expectedDeliveryDate"]);
  });
});

describe("orderFieldsFromOrder()", () => {
  it("round-trips an order through the form", () => {
    const order = {
      order_type: "b2b" as const,
      service_type: "air" as const,
      store_vendor: "eBay",
      vendor_order_number: "112-1",
      description: "Onderdelen",
      quantity: 3,
      estimated_value: 1234.5,
      estimated_value_currency: "EUR" as const,
      purchase_date: "2026-01-02",
      expected_delivery_date: "2026-01-09",
      tracking_number: "1Z",
      carrier: "UPS",
      declared_weight_lbs: 12.25,
      customer_note: "Breekbaar",
      supplier_name: null,
      client_po_number: null,
      purchase_mode: null,
    };
    const input = orderFieldsFromOrder(order);
    expect(input).toMatchObject({
      estimatedValue: "1234,50",
      declaredWeightLbs: "12,25",
      quantity: "3",
      purchaseMode: "",
    });
    expect(toOrderColumns(orderFieldsSchema.parse(input))).toEqual(order);
  });
});

describe("isCalendarDate()", () => {
  it("accepts real dates only", () => {
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-04-31")).toBe(false);
    expect(isCalendarDate("2026-00-10")).toBe(false);
    expect(isCalendarDate("0050-01-01")).toBe(false);
    expect(isCalendarDate("2026-1-1")).toBe(false);
    expect(isCalendarDate("")).toBe(false);
  });
});

describe("shiftYears()", () => {
  it("moves a date by whole years, 29 February to 28 February", () => {
    expect(shiftYears("2026-10-07", -2)).toBe("2024-10-07");
    expect(shiftYears("2026-10-07", 1)).toBe("2027-10-07");
    expect(shiftYears("2028-02-29", -2)).toBe("2026-02-28");
  });
});

describe("carrierChoice()", () => {
  it("maps a stored carrier to the list, 'other' or 'unknown'", () => {
    expect(carrierChoice("")).toBe("unknown");
    expect(carrierChoice("  ")).toBe("unknown");
    expect(carrierChoice("ups")).toBe("UPS");
    expect(carrierChoice("Amazon Logistics")).toBe("Amazon Logistics");
    expect(carrierChoice("Surinam Airways Cargo")).toBe("other");
    expect(COMMON_CARRIERS).toContain("FedEx");
  });
});
