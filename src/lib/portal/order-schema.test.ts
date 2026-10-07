import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CodedError, toAppError } from "@/lib/errors";
import { t } from "@/lib/i18n";
import { toOrderColumns, type OrderFieldsInput } from "./order-fields";
import {
  applyRootOrder,
  defaultServiceType,
  lockedByRoot,
  newOrderDefaults,
  newOrderPageSearchSchema,
  orderRegistrationFieldsSchema,
  parseRegisterOrderInput,
  registerOrderInputSchema,
  type RootOrder,
} from "./order-schema";

// 7 October 2026, 12:00 in Paramaribo (UTC−3).
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T15:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

const valid: OrderFieldsInput = {
  orderType: "personal",
  serviceType: "air",
  storeVendor: "Amazon",
  vendorOrderNumber: "112-7654321-1234567",
  description: "Keukenmixer",
  quantity: "1",
  estimatedValue: "149,99",
  estimatedValueCurrency: "USD",
  purchaseDate: "2026-10-01",
  expectedDeliveryDate: "",
  trackingNumber: "",
  carrier: "",
  declaredWeightLbs: "",
  customerNote: "",
  supplierName: "",
  clientPoNumber: "",
  purchaseMode: "",
};

const issues = (patch: Partial<OrderFieldsInput>) => {
  const result = orderRegistrationFieldsSchema.safeParse({ ...valid, ...patch });
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((i) => [i.path.join("."), i.message]));
};

describe("orderRegistrationFieldsSchema", () => {
  it("accepts a minimal order: tracking, carrier, weight and delivery date are optional", () => {
    const parsed = orderRegistrationFieldsSchema.parse(valid);
    expect(toOrderColumns(parsed)).toMatchObject({
      tracking_number: null,
      carrier: null,
      declared_weight_lbs: null,
      expected_delivery_date: null,
      estimated_value: 149.99,
      purchase_date: "2026-10-01",
    });
  });

  it("requires store, description, value and purchase date, all on the first submit", () => {
    expect(
      issues({ storeVendor: "  ", description: "", estimatedValue: " ", purchaseDate: "" }),
    ).toEqual({
      storeVendor: t("portal.orderForm.validation.storeRequired"),
      description: t("portal.orderForm.validation.descriptionRequired"),
      estimatedValue: t("portal.orderForm.validation.valueRequired"),
      purchaseDate: t("portal.orderForm.validation.purchaseDateRequired"),
    });
  });

  it("takes value 0 and refuses a negative value or more than 2 decimals", () => {
    expect(issues({ estimatedValue: "0" })).toEqual({});
    expect(issues({ estimatedValue: "1.234,56" })).toEqual({});
    expect(issues({ estimatedValue: "-1" })).toHaveProperty("estimatedValue");
    expect(issues({ estimatedValue: "12,345" })).toHaveProperty("estimatedValue");
    expect(issues({ estimatedValue: "abc" })).toHaveProperty("estimatedValue");
  });

  it("refuses negative or zero weights (orders_declared_weight_check is > 0)", () => {
    expect(
      orderRegistrationFieldsSchema.parse({ ...valid, declaredWeightLbs: "2,5" }),
    ).toMatchObject({ declaredWeightLbs: 2.5 });
    expect(issues({ declaredWeightLbs: "-1" })).toEqual({
      declaredWeightLbs: t("portal.orderForm.validation.weightInvalid"),
    });
    expect(issues({ declaredWeightLbs: "0" })).toHaveProperty("declaredWeightLbs");
  });

  it("checks quantity as a whole number from 1", () => {
    expect(issues({ quantity: "0" })).toHaveProperty("quantity");
    expect(issues({ quantity: "2,5" })).toHaveProperty("quantity");
    expect(issues({ quantity: "100001" })).toHaveProperty("quantity");
    expect(orderRegistrationFieldsSchema.parse({ ...valid, quantity: " 3 " }).quantity).toBe(3);
  });

  describe("dates", () => {
    it("refuses a purchase date in the future (Suriname's today counts)", () => {
      expect(issues({ purchaseDate: "2026-10-07" })).toEqual({});
      expect(issues({ purchaseDate: "2026-10-08" })).toEqual({
        purchaseDate: t("portal.orderForm.validation.purchaseDateFuture"),
      });
    });

    it("refuses a purchase date more than 2 years back (typos)", () => {
      expect(issues({ purchaseDate: "2024-10-07" })).toEqual({});
      expect(issues({ purchaseDate: "2024-10-06" })).toEqual({
        purchaseDate: t("portal.orderForm.validation.purchaseDateTooOld"),
      });
      expect(issues({ purchaseDate: "2016-10-01" })).toHaveProperty("purchaseDate");
    });

    it("refuses dates that do not exist", () => {
      expect(issues({ purchaseDate: "2026-02-30" })).toEqual({
        purchaseDate: t("portal.orderForm.validation.dateInvalid"),
      });
      expect(issues({ expectedDeliveryDate: "2026-13-01" })).toHaveProperty("expectedDeliveryDate");
      expect(issues({ purchaseDate: "1-10-2026" })).toHaveProperty("purchaseDate");
    });

    it("needs the expected delivery after the purchase and within a year", () => {
      expect(issues({ expectedDeliveryDate: "2026-09-30" })).toEqual({
        expectedDeliveryDate: t("portal.orderForm.validation.deliveryBeforePurchase"),
      });
      expect(issues({ expectedDeliveryDate: "2026-10-01" })).toEqual({});
      expect(issues({ expectedDeliveryDate: "2027-10-07" })).toEqual({});
      expect(issues({ expectedDeliveryDate: "2027-10-08" })).toEqual({
        expectedDeliveryDate: t("portal.orderForm.validation.deliveryTooFar"),
      });
    });
  });

  it("keeps B2B fields only on B2B orders (orders_b2b_fields_check)", () => {
    const b2bInput = {
      ...valid,
      supplierName: "Shenzhen Pack Co.",
      clientPoNumber: "PO-7",
      purchaseMode: "gr_purchases" as const,
    };
    const personal = toOrderColumns(orderRegistrationFieldsSchema.parse(b2bInput));
    expect(personal).toMatchObject({
      order_type: "personal",
      supplier_name: null,
      client_po_number: null,
      purchase_mode: null,
    });
    const b2b = toOrderColumns(
      orderRegistrationFieldsSchema.parse({ ...b2bInput, orderType: "b2b" }),
    );
    expect(b2b).toMatchObject({
      order_type: "b2b",
      supplier_name: "Shenzhen Pack Co.",
      client_po_number: "PO-7",
      purchase_mode: "gr_purchases",
    });
  });

  it("shows cross-field errors together with field errors on the first submit", () => {
    expect(
      issues({ quantity: "0", purchaseDate: "2026-10-05", expectedDeliveryDate: "2026-10-01" }),
    ).toEqual({
      quantity: t("portal.orderForm.validation.quantityInvalid"),
      expectedDeliveryDate: t("portal.orderForm.validation.deliveryBeforePurchase"),
    });
  });

  describe("B2B purchase by G&R (Inkoop door G&R)", () => {
    const gr: Partial<OrderFieldsInput> = {
      orderType: "b2b",
      purchaseMode: "gr_purchases",
      supplierName: "Acme Supply",
      clientPoNumber: "PO-9",
      storeVendor: "",
      estimatedValue: "",
      purchaseDate: "",
    };

    it("needs no store, value or purchase date yet: the supplier stands in for the store", () => {
      expect(issues(gr)).toEqual({});
      expect(
        toOrderColumns(orderRegistrationFieldsSchema.parse({ ...valid, ...gr })),
      ).toMatchObject({
        order_type: "b2b",
        purchase_mode: "gr_purchases",
        supplier_name: "Acme Supply",
        store_vendor: null,
        estimated_value: null,
        purchase_date: null,
      });
    });

    it("still needs a store or a supplier", () => {
      expect(issues({ ...gr, supplierName: " " })).toEqual({
        storeVendor: t("portal.orderForm.validation.storeOrSupplierRequired"),
      });
    });

    it("takes a planned purchase date up to a year ahead", () => {
      expect(issues({ ...gr, purchaseDate: "2026-12-01" })).toEqual({});
      expect(issues({ ...gr, purchaseDate: "2027-10-07" })).toEqual({});
      expect(issues({ ...gr, purchaseDate: "2027-10-08" })).toEqual({
        purchaseDate: t("portal.orderForm.validation.purchaseDateTooFar"),
      });
    });

    it("applies only to B2B orders bought by G&R", () => {
      const required = {
        storeVendor: t("portal.orderForm.validation.storeRequired"),
        estimatedValue: t("portal.orderForm.validation.valueRequired"),
        purchaseDate: t("portal.orderForm.validation.purchaseDateRequired"),
      };
      expect(issues({ ...gr, purchaseMode: "customer_purchased" })).toEqual(required);
      expect(issues({ ...gr, purchaseMode: "" })).toEqual(required);
      // A personal order never is one, whatever hidden B2B value the form still holds.
      expect(issues({ ...gr, orderType: "personal" })).toEqual(required);
    });
  });

  it("refuses enum values the database does not know", () => {
    expect(issues({ serviceType: "rocket" as never })).toHaveProperty("serviceType");
    expect(issues({ estimatedValueCurrency: "GBP" as never })).toHaveProperty(
      "estimatedValueCurrency",
    );
    expect(issues({ purchaseMode: "stolen" as never })).toHaveProperty("purchaseMode");
  });

  it("enforces the table's text lengths", () => {
    expect(issues({ trackingNumber: "x".repeat(101) })).toEqual({
      trackingNumber: t("portal.orderForm.validation.tooLong", { max: 100 }),
    });
    expect(issues({ customerNote: "x".repeat(2001) })).toHaveProperty("customerNote");
  });
});

describe("registerOrderInputSchema", () => {
  const input = { fields: valid, prohibitedGoodsAccepted: true, parentOrderId: null };

  it("requires the prohibited-goods confirmation", () => {
    expect(registerOrderInputSchema.safeParse(input).success).toBe(true);
    const refused = registerOrderInputSchema.safeParse({
      ...input,
      prohibitedGoodsAccepted: false,
    });
    expect(refused.success).toBe(false);
    expect(refused.success ? null : refused.error.issues[0]?.message).toBe(
      t("portal.newOrder.prohibited.required"),
    );
  });

  it("accepts only a uuid as parent order", () => {
    const parent = "a0000000-0000-4000-8000-000000000001";
    expect(registerOrderInputSchema.parse({ ...input, parentOrderId: parent }).parentOrderId).toBe(
      parent,
    );
    expect(
      registerOrderInputSchema.safeParse({ ...input, parentOrderId: "1 or 1=1" }).success,
    ).toBe(false);
  });

  it("never carries a customer, status or reference from the browser", () => {
    const parsed = registerOrderInputSchema.parse({
      ...input,
      customerId: "c0c0c0c0-0000-4000-8000-000000000002",
      fields: { ...valid, status: "ready_for_pickup", reference: "ORD-2026-99999" },
    });
    expect(parsed).not.toHaveProperty("customerId");
    expect(parsed.fields).not.toHaveProperty("status");
    expect(Object.keys(toOrderColumns(parsed.fields))).not.toContain("status");
  });
});

describe("parseRegisterOrderInput() (registerOrderFn's validator)", () => {
  it("returns the parsed input", () => {
    const data = parseRegisterOrderInput({
      fields: { ...valid, quantity: "2" },
      prohibitedGoodsAccepted: true,
      parentOrderId: null,
    });
    expect(data.fields.quantity).toBe(2);
  });

  it("answers a bad request with one Dutch 22023 error", () => {
    let error: unknown = null;
    try {
      parseRegisterOrderInput({ fields: { ...valid, description: "" }, parentOrderId: null });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CodedError);
    expect(toAppError(error)).toMatchObject({
      kind: "invalid",
      code: "22023",
      message: t("portal.newOrder.invalid"),
    });
  });
});

describe("newOrderPageSearchSchema", () => {
  it("keeps a valid parent and type and drops anything else", () => {
    const parent = "a0000000-0000-4000-8000-000000000001";
    expect(newOrderPageSearchSchema.parse({ parent, type: "b2b" })).toEqual({
      parent,
      type: "b2b",
    });
    expect(newOrderPageSearchSchema.parse({ parent: "x", type: "rocket" })).toEqual({});
    expect(newOrderPageSearchSchema.parse({})).toEqual({});
  });
});

const root: RootOrder = {
  id: "a0000000-0000-4000-8000-000000000001",
  order_type: "b2b",
  service_type: "sea",
  store_vendor: "Alibaba",
  vendor_order_number: "PO-88812",
  estimated_value_currency: "EUR",
  purchase_date: "2026-09-20",
  supplier_name: "Shenzhen Pack Co.",
  client_po_number: "KLANT-PO-7",
  purchase_mode: "gr_purchases",
};

describe("extra package (root order)", () => {
  it("prefills the purchase details of the root, not the per-box ones", () => {
    expect(newOrderDefaults({ serviceTypes: ["air", "sea"], root })).toEqual({
      ...valid,
      orderType: "b2b",
      serviceType: "sea",
      storeVendor: "Alibaba",
      vendorOrderNumber: "PO-88812",
      description: "",
      estimatedValue: "",
      estimatedValueCurrency: "EUR",
      purchaseDate: "2026-09-20",
      supplierName: "Shenzhen Pack Co.",
      clientPoNumber: "KLANT-PO-7",
      purchaseMode: "gr_purchases",
    });
  });

  it("locks store and vendor order number only where the root has them", () => {
    expect(lockedByRoot(root)).toEqual({ storeVendor: true, vendorOrderNumber: true });
    expect(lockedByRoot({ store_vendor: "eBay", vendor_order_number: null })).toEqual({
      storeVendor: true,
      vendorOrderNumber: false,
    });
  });

  it("server side: type, store and order number always come from the root", () => {
    const sent = orderRegistrationFieldsSchema.parse({
      ...valid,
      orderType: "personal",
      storeVendor: "Iets anders",
      vendorOrderNumber: "999",
    });
    const fields = applyRootOrder(sent, root);
    expect(toOrderColumns(fields)).toMatchObject({
      order_type: "b2b",
      store_vendor: "Alibaba",
      vendor_order_number: "PO-88812",
    });
    // A personal root clears B2B fields the browser may have sent.
    const personal = applyRootOrder(
      orderRegistrationFieldsSchema.parse({ ...valid, orderType: "b2b", supplierName: "X" }),
      { order_type: "personal", store_vendor: null, vendor_order_number: null },
    );
    expect(toOrderColumns(personal)).toMatchObject({
      order_type: "personal",
      store_vendor: "Amazon",
      vendor_order_number: "112-7654321-1234567",
      supplier_name: null,
    });
  });
});

describe("newOrderDefaults()", () => {
  it("starts a new order empty with quantity 1, USD and the chosen type", () => {
    expect(newOrderDefaults({ orderType: "b2b", serviceTypes: ["air"] })).toMatchObject({
      orderType: "b2b",
      serviceType: "air",
      quantity: "1",
      estimatedValueCurrency: "USD",
      storeVendor: "",
      purchaseDate: "",
    });
  });

  it("offers only enabled service types, air first", () => {
    expect(defaultServiceType(["air", "sea"])).toBe("air");
    expect(defaultServiceType(["sea"])).toBe("sea");
    expect(defaultServiceType(["air"], "sea")).toBe("air");
    expect(defaultServiceType(["air", "sea"], "sea")).toBe("sea");
  });
});
