import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  canEditOrder,
  canRequestCancellation,
  canUploadDocuments,
  countOrders,
  currentStatusMessage,
  filterOrders,
  journeySteps,
  matchesOrderSearch,
  newOrderHref,
  newOrderSearchSchema,
  orderGroupRoot,
  orderListSearchSchema,
  portalKeys,
  resolveStatus,
  STATUS_STAGES,
  stageGroup,
  stageTone,
  type OrderListItem,
  type ShipmentStatus,
  type StatusMap,
  type StatusStage,
} from "./orders";

// The seeded statuses of migration 2 (SPEC §35.7), plus a hidden one.
const seed: [string, string, StatusStage, number, boolean?][] = [
  ["order_registered", "Order aangemeld", "registered", 10],
  ["pending", "In behandeling", "registered", 20],
  ["awaiting_shipment", "Wacht op verzending door de winkel", "registered", 30],
  ["arrived_us_warehouse", "Aangekomen in US-magazijn", "us_warehouse", 40],
  ["in_transit", "Onderweg naar Suriname", "in_transit", 50],
  ["arrived_suriname", "Aangekomen in Suriname", "arrived_sr", 60],
  ["at_customs", "Bij de douane", "at_customs", 70],
  ["customs_cleared", "Ingeklaard", "cleared", 80],
  ["ready_for_pickup", "Klaar voor afhalen", "ready_for_pickup", 90],
  ["picked_up", "Afgehaald", "completed", 100],
  ["delivered", "Bezorgd", "completed", 110],
  ["documents_required", "Actie vereist – documenten nodig", "action_required", 120],
  ["cancelled", "Geannuleerd", "cancelled", 130],
];
const statuses: StatusMap = new Map(
  seed.map(([code, label_nl, stage, sort_order]) => [
    code,
    {
      code,
      label_nl,
      stage,
      sort_order,
      active: true,
      customer_description_nl: null,
    } satisfies ShipmentStatus,
  ]),
);

function order(overrides: Partial<OrderListItem> & { id: string }): OrderListItem {
  return {
    reference: "ORD-2026-00001",
    order_type: "personal",
    service_type: "air",
    store_vendor: null,
    vendor_order_number: null,
    description: null,
    tracking_number: null,
    carrier: null,
    status: "order_registered",
    parent_order_id: null,
    created_at: "2026-10-01T12:00:00Z",
    purchase_date: null,
    cancellation_requested_at: null,
    ...overrides,
  };
}

describe("stageGroup()", () => {
  it("keeps registered, ready for pickup, completed and cancelled apart", () => {
    expect(stageGroup("registered")).toBe("registered");
    expect(stageGroup("ready_for_pickup")).toBe("ready_for_pickup");
    expect(stageGroup("completed")).toBe("completed");
    expect(stageGroup("cancelled")).toBe("cancelled");
  });

  it("counts every other stage as a shipment in progress (SPEC §8)", () => {
    for (const stage of [
      "us_warehouse",
      "in_transit",
      "arrived_sr",
      "at_customs",
      "cleared",
      "action_required",
    ] as const) {
      expect(stageGroup(stage), stage).toBe("in_progress");
    }
  });

  it("treats a status hidden from the customer (unknown stage) as in progress", () => {
    expect(stageGroup(null)).toBe("in_progress");
  });

  it("covers every stage of the enum", () => {
    expect(STATUS_STAGES).toHaveLength(10);
    for (const stage of STATUS_STAGES) expect(stageGroup(stage)).toBeTruthy();
  });
});

describe("countOrders()", () => {
  it("counts by stage, never by label", () => {
    const orders = [
      { status: "order_registered" },
      { status: "pending" },
      { status: "arrived_us_warehouse" },
      { status: "in_transit" },
      { status: "documents_required" },
      { status: "ready_for_pickup" },
      { status: "ready_for_pickup" },
      { status: "picked_up" },
      { status: "delivered" },
      { status: "cancelled" },
      { status: "internal_hold" }, // not customer_visible → unknown stage
    ];
    expect(countOrders(orders, statuses)).toEqual({
      total: 11,
      registered: 2,
      inProgress: 4,
      actionRequired: 1,
      readyForPickup: 2,
      completed: 2,
      cancelled: 1,
    });
  });

  it("is all zeros for no orders", () => {
    expect(countOrders([], statuses)).toMatchObject({ total: 0, inProgress: 0, readyForPickup: 0 });
  });
});

describe("order permissions mirror the migration triggers", () => {
  it("edits only in the registered stage", () => {
    expect(canEditOrder("registered")).toBe(true);
    for (const stage of STATUS_STAGES.filter((s) => s !== "registered")) {
      expect(canEditOrder(stage), stage).toBe(false);
    }
    expect(canEditOrder(null)).toBe(false);
  });

  it("uploads until completed or cancelled", () => {
    expect(canUploadDocuments("action_required")).toBe(true);
    expect(canUploadDocuments("registered")).toBe(true);
    expect(canUploadDocuments("completed")).toBe(false);
    expect(canUploadDocuments("cancelled")).toBe(false);
  });

  it("asks for cancellation once, and not for finished orders", () => {
    expect(canRequestCancellation("registered", null)).toBe(true);
    expect(canRequestCancellation("in_transit", null)).toBe(true);
    expect(canRequestCancellation("registered", "2026-10-01T12:00:00Z")).toBe(false);
    expect(canRequestCancellation("completed", null)).toBe(false);
    expect(canRequestCancellation("cancelled", null)).toBe(false);
  });
});

describe("stageTone()", () => {
  it("uses the SPEC §35.14 badge colours", () => {
    expect(stageTone("ready_for_pickup")).toBe("success");
    expect(stageTone("in_transit")).toBe("info");
    expect(stageTone("at_customs")).toBe("info");
    expect(stageTone("action_required")).toBe("warning");
    expect(stageTone("cancelled")).toBe("neutral");
    expect(stageTone("registered")).toBe("secondary");
    expect(stageTone(null)).toBe("info");
  });
});

describe("resolveStatus()", () => {
  it("returns the configured label and stage", () => {
    expect(resolveStatus("in_transit", statuses)).toEqual({
      code: "in_transit",
      label: "Onderweg naar Suriname",
      description: null,
      stage: "in_transit",
    });
  });

  it("returns nulls for a status RLS does not show", () => {
    expect(resolveStatus("internal_hold", statuses)).toEqual({
      code: "internal_hold",
      label: null,
      description: null,
      stage: null,
    });
  });
});

describe("journeySteps()", () => {
  it("labels each stage with its first configured status", () => {
    const steps = journeySteps("registered", statuses);
    expect(steps.map((s) => s.label)).toEqual([
      "Order aangemeld",
      "Aangekomen in US-magazijn",
      "Onderweg naar Suriname",
      "Aangekomen in Suriname",
      "Bij de douane",
      "Ingeklaard",
      "Klaar voor afhalen",
      "Afgehaald",
    ]);
  });

  it("marks earlier steps done and the current one current", () => {
    const steps = journeySteps("at_customs", statuses);
    expect(steps.map((s) => s.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
  });

  it("makes the final step current once completed", () => {
    expect(journeySteps("completed", statuses).at(-1)?.state).toBe("current");
  });

  it("action required: the stages passed, then the order's own status as the current step, then the rest", () => {
    const steps = journeySteps(
      "action_required",
      statuses,
      ["registered", "us_warehouse", "action_required"],
      "Actie vereist – documenten nodig",
    );
    expect(steps.map((s) => [s.stage, s.state])).toEqual([
      ["registered", "done"],
      ["us_warehouse", "done"],
      ["action_required", "current"],
      ["in_transit", "upcoming"],
      ["arrived_sr", "upcoming"],
      ["at_customs", "upcoming"],
      ["cleared", "upcoming"],
      ["ready_for_pickup", "upcoming"],
      ["completed", "upcoming"],
    ]);
    expect(steps[2]?.label).toBe("Actie vereist – documenten nodig");
  });

  it("cancelled: the stages passed and a final cancelled step, nothing still to come", () => {
    const steps = journeySteps("cancelled", statuses, ["cancelled"]);
    expect(steps.map((s) => [s.stage, s.state, s.label])).toEqual([
      ["registered", "done", "Order aangemeld"],
      ["cancelled", "current", "Geannuleerd"],
    ]);
    expect(
      journeySteps("cancelled", statuses, ["us_warehouse", "in_transit"]).map((s) => s.stage),
    ).toEqual(["registered", "us_warehouse", "in_transit", "cancelled"]);
  });

  it("a stage hidden from the customer marks no step current", () => {
    const steps = journeySteps(null, statuses, ["registered", "us_warehouse"]);
    expect(steps.map((s) => s.state)).toEqual([
      "done",
      "done",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
  });

  it("prefers active statuses for labels and falls back to null", () => {
    const custom: StatusMap = new Map([
      [
        "old",
        {
          code: "old",
          label_nl: "Oud",
          stage: "registered",
          sort_order: 1,
          active: false,
          customer_description_nl: null,
        },
      ],
      [
        "new",
        {
          code: "new",
          label_nl: "Nieuw",
          stage: "registered",
          sort_order: 5,
          active: true,
          customer_description_nl: null,
        },
      ],
    ]);
    const steps = journeySteps("registered", custom);
    expect(steps[0]?.label).toBe("Nieuw");
    expect(steps[1]?.label).toBeNull();
  });
});

describe("order search and filters", () => {
  const orders = [
    order({
      id: "a",
      reference: "ORD-2026-00001",
      store_vendor: "Amazon",
      tracking_number: "1Z 999-AA1",
      created_at: "2026-09-01T10:00:00Z",
    }),
    order({
      id: "b",
      reference: "ORD-2026-00002",
      store_vendor: "eBay",
      vendor_order_number: "112-7788",
      status: "in_transit",
      created_at: "2026-09-03T10:00:00Z",
    }),
    order({
      id: "c",
      reference: "ORD-2026-00003",
      order_type: "b2b",
      status: "ready_for_pickup",
      created_at: "2026-09-02T10:00:00Z",
    }),
    order({
      id: "d",
      reference: "ORD-2026-00004",
      status: "documents_required",
      created_at: "2026-09-04T10:00:00Z",
    }),
  ];

  it("matches reference, store, vendor order number and tracking, case-insensitively", () => {
    expect(matchesOrderSearch(orders[0]!, "amazon")).toBe(true);
    expect(matchesOrderSearch(orders[1]!, "00002")).toBe(true);
    expect(matchesOrderSearch(orders[1]!, "112-77")).toBe(true);
    expect(matchesOrderSearch(orders[0]!, "1z 999")).toBe(true);
    expect(matchesOrderSearch(orders[0]!, "ebay")).toBe(false);
    expect(matchesOrderSearch(orders[0]!, "   ")).toBe(true);
  });

  it("matches the description of the goods, which customers remember best", () => {
    const shoes = { ...orders[0]!, description: "Sportschoenen maat 42" };
    expect(matchesOrderSearch(shoes, "sportschoenen")).toBe(true);
    expect(matchesOrderSearch(shoes, "MAAT 42")).toBe(true);
    expect(matchesOrderSearch(shoes, "keukenmixer")).toBe(false);
    expect(filterOrders([shoes, orders[1]!], statuses, { q: "schoenen" }).map((o) => o.id)).toEqual(
      ["a"],
    );
  });

  it("ignores spaces and dashes in tracking and order numbers", () => {
    expect(matchesOrderSearch(orders[0]!, "1Z999AA1")).toBe(true);
    expect(matchesOrderSearch(orders[1]!, "1127788")).toBe(true);
    expect(matchesOrderSearch(orders[0]!, "--")).toBe(false);
  });

  it("filters by stage, by the in-progress group and by order type", () => {
    const ids = (search: Parameters<typeof filterOrders>[2]) =>
      filterOrders(orders, statuses, search).map((o) => o.id);
    expect(ids({ stage: "ready_for_pickup" })).toEqual(["c"]);
    expect(ids({ stage: "in_progress" })).toEqual(["d", "b"]);
    expect(ids({ stage: "registered" })).toEqual(["a"]);
    expect(ids({ type: "b2b" })).toEqual(["c"]);
    expect(ids({ type: "personal", q: "ebay" })).toEqual(["b"]);
  });

  it("sorts by registration date, newest first by default", () => {
    expect(filterOrders(orders, statuses, {}).map((o) => o.id)).toEqual(["d", "b", "c", "a"]);
    expect(filterOrders(orders, statuses, { sort: "oldest" }).map((o) => o.id)).toEqual([
      "a",
      "c",
      "b",
      "d",
    ]);
  });

  it("does not mutate the input", () => {
    const before = orders.map((o) => o.id);
    filterOrders(orders, statuses, { sort: "oldest" });
    expect(orders.map((o) => o.id)).toEqual(before);
  });
});

describe("search param schemas", () => {
  it("drops invalid list params instead of failing", () => {
    expect(
      orderListSearchSchema.parse({ q: " amazon ", stage: "nope", type: "b2b", sort: "sideways" }),
    ).toEqual({
      q: "amazon",
      stage: undefined,
      type: "b2b",
      sort: undefined,
    });
    expect(orderListSearchSchema.parse({ stage: "in_progress" }).stage).toBe("in_progress");
  });

  it("reads a numeric search as text and an empty search as none", () => {
    expect(orderListSearchSchema.parse({ q: 1234567 }).q).toBe("1234567");
    expect(orderListSearchSchema.parse({ q: "   " }).q).toBeUndefined();
    expect(orderListSearchSchema.parse({ q: { a: 1 } }).q).toBeUndefined();
  });

  it("accepts only a UUID as the parent of a new order", () => {
    const id = "6f1c0d2e-8a4b-4c3d-9e5f-0a1b2c3d4e5f";
    expect(newOrderSearchSchema.parse({ parent: id })).toEqual({ parent: id });
    expect(newOrderSearchSchema.parse({ parent: "1 or 1=1" })).toEqual({ parent: undefined });
    expect(newOrderSearchSchema.parse({})).toEqual({});
  });

  it("links to the registration form with the root order as parent", () => {
    const id = "6f1c0d2e-8a4b-4c3d-9e5f-0a1b2c3d4e5f";
    expect(newOrderHref({ parent: id })).toBe(`/portal/orders/nieuw?parent=${id}`);
    expect(newOrderHref()).toBe("/portal/orders/nieuw");
  });
});

describe("order helpers", () => {
  it("finds the message staff left with the current status", () => {
    const history = [
      {
        id: 1,
        from_status: "order_registered",
        to_status: "documents_required",
        changed_at: "2026-09-01T10:00:00Z",
        customer_message: "Oude vraag",
      },
      {
        id: 2,
        from_status: "documents_required",
        to_status: "arrived_us_warehouse",
        changed_at: "2026-09-02T10:00:00Z",
        customer_message: null,
      },
      {
        id: 3,
        from_status: "arrived_us_warehouse",
        to_status: "documents_required",
        changed_at: "2026-09-03T10:00:00Z",
        customer_message: "  Upload de factuur  ",
      },
    ];
    expect(currentStatusMessage(history, "documents_required")).toBe("Upload de factuur");
    expect(currentStatusMessage(history, "arrived_us_warehouse")).toBeNull();
    expect(currentStatusMessage([], "documents_required")).toBeNull();
  });

  it("groups extra packages under their root order", () => {
    expect(orderGroupRoot({ id: "a", parent_order_id: null })).toBe("a");
    expect(orderGroupRoot({ id: "b", parent_order_id: "a" })).toBe("a");
  });

  it("nests every order query under the user's orders key", () => {
    const orders = portalKeys.orders("u1");
    for (const key of [
      portalKeys.order("u1", "o1"),
      portalKeys.orderHistory("u1", "o1"),
      portalKeys.orderDocuments("u1", "o1"),
      portalKeys.orderInvoices("u1", "o1"),
      portalKeys.orderGroup("u1", "o1"),
      portalKeys.activity("u1"),
    ]) {
      expect(key.slice(0, orders.length)).toEqual([...orders]);
    }
  });
});
