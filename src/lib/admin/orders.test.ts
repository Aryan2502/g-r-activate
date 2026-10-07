import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const {
  adminOrderSearchSchema,
  buildOrderViews,
  customerDisplayName,
  customerSearchScore,
  duplicateTrackingOrderIds,
  exactTrackingMatches,
  filterAdminOrders,
  hasAdminFilters,
  indexBilling,
  matchesAdminSearch,
  normalizeTracking,
  orderBilling,
  parseCustomerCode,
  personName,
  toReceiveTarget,
  toStatusTarget,
} = await import("./orders");
type AdminOrderListItem = import("./orders").AdminOrderListItem;
type BillingInvoice = import("./orders").BillingInvoice;
type StatusRow = import("./statuses").StatusRow;

const S = (code: string, stage: StatusRow["stage"], sort_order: number): StatusRow => ({
  code,
  stage,
  sort_order,
  label_nl: code,
  customer_description_nl: null,
  is_terminal: false,
  customer_visible: true,
  notify_customer: false,
  active: true,
  created_at: "2026-10-01T00:00:00Z",
  created_by: null,
  updated_at: "2026-10-01T00:00:00Z",
  updated_by: null,
});
const statuses = new Map(
  [
    S("order_registered", "registered", 10),
    S("arrived_us_warehouse", "us_warehouse", 40),
    S("in_transit", "in_transit", 50),
    S("ready_for_pickup", "ready_for_pickup", 90),
    S("documents_required", "action_required", 120),
    S("cancelled", "cancelled", 130),
  ].map((s) => [s.code, s]),
);

const maria = {
  id: "c1",
  customer_code: "GR00042",
  full_name: "Maria Pinas",
  company_name: null,
  account_type: "personal" as const,
  status: "active" as const,
  user_id: "u1",
};
const trading = {
  id: "c2",
  customer_code: "GR00107",
  full_name: "Éneas Biharie",
  company_name: "Biharie Trading N.V.",
  account_type: "business" as const,
  status: "active" as const,
  user_id: null,
};

let seq = 0;
function order(extra: Partial<AdminOrderListItem> = {}): AdminOrderListItem {
  seq += 1;
  return {
    id: `o${seq}`,
    reference: `ORD-2026-0000${seq}`,
    customer_id: maria.id,
    order_type: "personal",
    service_type: "air",
    store_vendor: "Amazon",
    vendor_order_number: "112-7654321-1234567",
    description: "Keukenmixer",
    tracking_number: null,
    tracking_number_normalized: null,
    carrier: null,
    status: "order_registered",
    parent_order_id: null,
    shipment_id: null,
    created_at: `2026-10-0${Math.min(seq, 9)}T12:00:00Z`,
    created_by_role: "customer",
    cancellation_requested_at: null,
    received_at: null,
    declared_weight_lbs: null,
    measured_weight_lbs: null,
    customer: maria,
    ...extra,
  };
}

describe("normalizeTracking() / parseCustomerCode()", () => {
  it("normalises a tracking number like the generated column", () => {
    expect(normalizeTracking(" 1z 999-aa1 0123456784 ")).toBe("1Z999AA10123456784");
    expect(normalizeTracking("9400 1000 0000")).toBe("940010000000");
  });

  it("reads 'gr00017', ' GR 17 ' and '17' as GR00017 (SPEC §35.5)", () => {
    expect(parseCustomerCode("gr00017")).toBe("GR00017");
    expect(parseCustomerCode(" GR 17 ")).toBe("GR00017");
    expect(parseCustomerCode("17")).toBe("GR00017");
    expect(parseCustomerCode("GR123456")).toBeNull();
    expect(parseCustomerCode("Maria")).toBeNull();
    expect(parseCustomerCode("0")).toBeNull();
  });
});

describe("matchesAdminSearch() (the receiving search)", () => {
  const o = order({
    tracking_number: "1Z 999 AA1 0123456784",
    tracking_number_normalized: "1Z999AA10123456784",
    customer: trading,
  });

  it("finds a tracking number however it is typed or scanned", () => {
    expect(matchesAdminSearch(o, "1z999aa10123456784")).toBe(true);
    expect(matchesAdminSearch(o, "1Z-999-AA1-0123456784")).toBe(true);
    expect(matchesAdminSearch(o, "0123456784")).toBe(true);
  });

  it("finds a GR code, a reference, a name (accents ignored) or a company", () => {
    expect(matchesAdminSearch(o, "gr 107")).toBe(true);
    expect(matchesAdminSearch(o, "GR00107")).toBe(true);
    expect(matchesAdminSearch(o, o.reference.toLowerCase())).toBe(true);
    expect(matchesAdminSearch(o, "eneas")).toBe(true);
    expect(matchesAdminSearch(o, "biharie trading")).toBe(true);
    expect(matchesAdminSearch(o, "keukenmixer")).toBe(true);
  });

  it("does not match unrelated text or another customer's code", () => {
    expect(matchesAdminSearch(o, "GR00042")).toBe(false);
    expect(matchesAdminSearch(o, "Pinas")).toBe(false);
    expect(matchesAdminSearch(o, "")).toBe(true);
  });
});

describe("tracking duplicates (SPEC §35.7: warn and show both)", () => {
  const a = order({ tracking_number: "TBA-1234", tracking_number_normalized: "TBA1234" });
  const b = order({ tracking_number: "tba 1234", tracking_number_normalized: "TBA1234" });
  const c = order({
    tracking_number: "TBA1234",
    tracking_number_normalized: "TBA1234",
    status: "cancelled",
  });
  const d = order({ tracking_number: "XYZ", tracking_number_normalized: "XYZ" });

  it("exactTrackingMatches() finds every order with that normalised number", () => {
    expect(exactTrackingMatches([a, b, d], "tba 1234").map((o) => o.id)).toEqual([a.id, b.id]);
    expect(exactTrackingMatches([a, b, d], "TBA")).toEqual([]);
  });

  it("duplicateTrackingOrderIds() ignores cancelled orders", () => {
    expect([...duplicateTrackingOrderIds([a, b, c, d], statuses)].sort()).toEqual(
      [a.id, b.id].sort(),
    );
    expect(duplicateTrackingOrderIds([a, c], statuses).size).toBe(0);
  });
});

const inv = (extra: Partial<BillingInvoice>): BillingInvoice => ({
  id: "i1",
  invoice_number: "INV-2026-0001",
  status: "open",
  is_overdue: false,
  balance_due: 0,
  currency: "USD",
  total_amount: 0,
  amount_paid: 0,
  invoice_date: "2026-10-01",
  due_date: "2026-10-08",
  ...extra,
});

describe("orderBilling() (the Factuur and Betaling columns)", () => {
  const billing = indexBilling(
    [
      inv({ id: "open", invoice_number: "INV-2026-0002", total_amount: 45, balance_due: 45 }),
      inv({
        id: "srd",
        invoice_number: "INV-2026-0003",
        currency: "SRD",
        status: "partially_paid",
        total_amount: 300,
        balance_due: 100,
        is_overdue: true,
      }),
      inv({ id: "paid", invoice_number: "INV-2026-0001", status: "paid", total_amount: 20 }),
      inv({ id: "draft", invoice_number: null, status: "draft", total_amount: 10 }),
    ],
    [
      { invoice_id: "open", order_id: "a" },
      { invoice_id: "srd", order_id: "a" },
      { invoice_id: "open", order_id: "a" },
      { invoice_id: "paid", order_id: "b" },
      { invoice_id: "draft", order_id: "c" },
      { invoice_id: "draft", order_id: null },
    ],
  );

  it("shows what is still open per currency, never summed across currencies", () => {
    const a = orderBilling("a", billing);
    expect(a.payment).toBe("open");
    expect(a.hasOpenInvoice).toBe(true);
    expect(a.overdue).toBe(true);
    expect(a.unpaid).toEqual([
      { currency: "USD", amount: 45 },
      { currency: "SRD", amount: 100 },
    ]);
    expect(a.invoices.map((i) => i.id)).toEqual(["srd", "open"]);
  });

  it("paid, draft-only and no invoice", () => {
    expect(orderBilling("b", billing).payment).toBe("paid");
    expect(orderBilling("b", billing).hasOpenInvoice).toBe(false);
    expect(orderBilling("c", billing).payment).toBe("draft");
    expect(orderBilling("c", billing).hasOpenInvoice).toBe(false);
    expect(orderBilling("z", billing).payment).toBe("none");
    expect(orderBilling("z", undefined).invoices).toEqual([]);
    // Not loaded (yet, or failed): unknown, never "Geen factuur".
    expect(orderBilling("a", undefined)).toMatchObject({
      payment: "unknown",
      hasOpenInvoice: false,
    });
  });
});

describe("filterAdminOrders()", () => {
  const registered = order({ customer: trading, created_at: "2026-10-01T10:00:00Z" });
  const actionNotReceived = order({
    status: "documents_required",
    created_at: "2026-10-02T10:00:00Z",
  });
  const actionReceived = order({
    status: "documents_required",
    received_at: "2026-10-03T09:00:00Z",
    created_at: "2026-10-03T10:00:00Z",
    order_type: "b2b",
  });
  const ready = order({ status: "ready_for_pickup", created_at: "2026-10-04T10:00:00Z" });
  const billing = indexBilling(
    [inv({ id: "i", total_amount: 10, balance_due: 10 })],
    [{ invoice_id: "i", order_id: ready.id }],
  );
  const cancellations = new Map([
    [
      registered.id,
      {
        id: "t",
        order_id: registered.id,
        created_at: "2026-10-05T00:00:00Z",
        resolved_at: null,
        resolved_by: null,
      },
    ],
  ]);
  const views = buildOrderViews(
    [registered, actionNotReceived, actionReceived, ready],
    statuses,
    billing,
    cancellations,
  );
  const ids = (search: Parameters<typeof filterAdminOrders>[2]) =>
    filterAdminOrders(views, statuses, search).map((o) => o.id);

  it("filters on 'wacht op ontvangst', open invoice, cancellation request, stage and type", () => {
    expect(ids({ awaitingReceipt: true }).sort()).toEqual(
      [registered.id, actionNotReceived.id].sort(),
    );
    expect(ids({ openInvoice: true })).toEqual([ready.id]);
    expect(ids({ cancellation: true })).toEqual([registered.id]);
    expect(ids({ stage: "action_required" }).sort()).toEqual(
      [actionNotReceived.id, actionReceived.id].sort(),
    );
    expect(ids({ stage: "in_progress" }).sort()).toEqual(
      [actionNotReceived.id, actionReceived.id].sort(),
    );
    expect(ids({ type: "b2b" })).toEqual([actionReceived.id]);
  });

  it("sorts newest first by default, and by oldest, customer or status order", () => {
    expect(ids({})).toEqual([ready.id, actionReceived.id, actionNotReceived.id, registered.id]);
    expect(ids({ sort: "oldest" })).toEqual([
      registered.id,
      actionNotReceived.id,
      actionReceived.id,
      ready.id,
    ]);
    // "Biharie Trading N.V. (Éneas Biharie)" sorts before "Maria Pinas".
    expect(ids({ sort: "customer" })[0]).toBe(registered.id);
    expect(ids({ sort: "status" })[0]).toBe(registered.id);
    expect(ids({ sort: "status" }).at(-1)).toMatch(/^o/);
  });

  it("hasAdminFilters() ignores the sort", () => {
    expect(hasAdminFilters({ sort: "oldest" })).toBe(false);
    expect(hasAdminFilters({ openInvoice: true })).toBe(true);
  });
});

describe("adminOrderSearchSchema", () => {
  it("keeps valid params and drops the rest instead of failing", () => {
    expect(
      adminOrderSearchSchema.parse({
        q: 12345,
        stage: "nope",
        type: "b2b",
        openInvoice: "true",
        cancellation: "yes",
        awaitingReceipt: true,
        sort: "customer",
      }),
    ).toEqual({
      q: "12345",
      type: "b2b",
      openInvoice: true,
      awaitingReceipt: true,
      sort: "customer",
    });
    expect(adminOrderSearchSchema.parse({ q: "  " })).toEqual({});
  });
});

describe("customers", () => {
  it("customerDisplayName() names the company for business customers", () => {
    expect(customerDisplayName(maria)).toBe("Maria Pinas");
    expect(customerDisplayName(trading)).toBe("Biharie Trading N.V. (Éneas Biharie)");
  });

  it("customerSearchScore() matches the GR code exactly, else name/company/phone without accents", () => {
    expect(customerSearchScore("GR00107", "gr 107", [])).toBe(1);
    expect(customerSearchScore("GR00107", "eneas", ["Éneas Biharie"])).toBeGreaterThan(0);
    expect(customerSearchScore("GR00107", "pinas", ["Éneas Biharie"])).toBe(0);
    expect(customerSearchScore("GR00042", "", [])).toBe(1);
  });

  it("personName() says 'de klant' for the customer's own login", () => {
    const people = new Map([
      ["s1", "Maria"],
      ["s2", null],
    ]);
    expect(personName("s1", people, "u1")).toBe("Maria");
    expect(personName("u1", people, "u1")).toBe("de klant");
    expect(personName("s2", people, "u1")).toBe("een medewerker");
    expect(personName(null, people, "u1")).toBe("een medewerker");
  });
});

describe("dialog targets", () => {
  it("toStatusTarget() and toReceiveTarget() take what the dialogs need", () => {
    const o = order({ declared_weight_lbs: 2.5, status: "order_registered" });
    expect(toStatusTarget(o)).toEqual({
      id: o.id,
      reference: o.reference,
      status: "order_registered",
      order_type: "personal",
      customer_id: o.customer_id,
      received_at: null,
    });
    expect(toReceiveTarget({ ...o, stage: "registered" })).toMatchObject({
      declared_weight_lbs: 2.5,
      received_at: null,
      customerLabel: "Maria Pinas (GR00042)",
    });
    expect(toReceiveTarget({ ...o, stage: null, customer: null }).customerLabel).toBeNull();
  });
});
