import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const {
  addOrdersToShipment,
  candidateRefusal,
  emptyShipmentForm,
  filterShipments,
  isShipmentDone,
  matchesShipmentSearch,
  membersByShipment,
  openShipmentOrders,
  removeOrdersFromShipment,
  shipmentCandidates,
  shipmentFormFromRow,
  shipmentListSearchSchema,
  summarizeShipment,
  updateShipment,
  createShipment,
  validateShipmentForm,
} = await import("./shipments");
type Shipment = import("./shipments").Shipment;
type ShipmentSummary = import("./shipments").ShipmentSummary;
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
  created_at: "2026-01-01T00:00:00Z",
  created_by: null,
  updated_at: "2026-01-01T00:00:00Z",
  updated_by: null,
});

const statuses = new Map(
  [
    S("order_registered", "registered", 10),
    S("arrived_us_warehouse", "us_warehouse", 40),
    S("in_transit", "in_transit", 50),
    S("picked_up", "completed", 100),
    S("documents_required", "action_required", 120),
    S("cancelled", "cancelled", 130),
  ].map((s) => [s.code, s]),
);

const shipment = (extra: Partial<Shipment> = {}): Shipment => ({
  id: "s1",
  shipment_number: "LUCHT-2026-14",
  service_type: "air",
  carrier: "Amerijet",
  awb_or_container_number: "810-1234 5675",
  departed_at: null,
  arrived_at: null,
  customer_note: null,
  created_at: "2026-10-01T12:00:00Z",
  created_by: null,
  updated_at: "2026-10-01T12:00:00Z",
  ...extra,
});

const member = (
  id: string,
  status: string,
  extra: Partial<{
    customer_id: string;
    measured_weight_lbs: number | null;
    service_type: "air" | "sea";
    shipment_id: string | null;
  }> = {},
) => ({
  id,
  status,
  customer_id: "c1",
  measured_weight_lbs: 1.5,
  service_type: "air" as const,
  shipment_id: "s1",
  ...extra,
});

describe("summarizeShipment", () => {
  it("counts orders, customers, weight and stages in journey order", () => {
    const summary = summarizeShipment(
      shipment(),
      [
        member("o1", "in_transit", { measured_weight_lbs: 2.255 }),
        member("o2", "in_transit", { customer_id: "c2", measured_weight_lbs: 1.1 }),
        member("o3", "order_registered", { measured_weight_lbs: null }),
        member("o4", "picked_up", { customer_id: "c2" }),
        member("o5", "documents_required", { service_type: "sea" }),
      ],
      statuses,
    );
    expect(summary).toEqual({
      orderCount: 5,
      openCount: 4,
      customerCount: 2,
      measuredLbs: 6.36,
      unweighed: 1,
      notReceived: 1,
      mismatched: 1,
      stages: [
        { stage: "registered", count: 1 },
        { stage: "in_transit", count: 2 },
        { stage: "completed", count: 1 },
        { stage: "action_required", count: 1 },
      ],
    });
  });

  it("an empty shipment is not done; one with only finished orders is", () => {
    const empty = summarizeShipment(shipment(), [], statuses);
    expect(empty).toMatchObject({ orderCount: 0, openCount: 0, measuredLbs: 0, stages: [] });
    expect(isShipmentDone(empty)).toBe(false);
    const done = summarizeShipment(
      shipment(),
      [member("o1", "picked_up"), member("o2", "cancelled")],
      statuses,
    );
    expect(isShipmentDone(done)).toBe(true);
    expect(summarizeShipment(shipment(), [member("o1", "unknown")], statuses).stages).toEqual([
      { stage: null, count: 1 },
    ]);
  });

  it("groups members by shipment", () => {
    const map = membersByShipment([
      member("o1", "in_transit"),
      member("o2", "in_transit", { shipment_id: "s2" }),
      member("o3", "in_transit"),
      member("o4", "in_transit", { shipment_id: null }),
    ]);
    expect(map.get("s1")?.map((m) => m.id)).toEqual(["o1", "o3"]);
    expect(map.get("s2")?.map((m) => m.id)).toEqual(["o2"]);
    expect(map.size).toBe(2);
  });
});

describe("shipment list search", () => {
  it("parses the URL leniently", () => {
    expect(shipmentListSearchSchema.parse({ q: 1234, type: "sea", open: "true" })).toEqual({
      q: "1234",
      type: "sea",
      open: true,
    });
    expect(shipmentListSearchSchema.parse({ q: "  ", type: "boat", open: "nee" })).toEqual({
      q: undefined,
      type: undefined,
      open: undefined,
    });
  });

  it("matches number, carrier or AWB, ignoring case, spaces and dashes", () => {
    const s = shipment();
    expect(matchesShipmentSearch(s, "lucht-2026")).toBe(true);
    expect(matchesShipmentSearch(s, "amerijet")).toBe(true);
    expect(matchesShipmentSearch(s, "81012345675")).toBe(true);
    expect(matchesShipmentSearch(s, "810 1234-5675")).toBe(true);
    expect(matchesShipmentSearch(s, "zee")).toBe(false);
    expect(matchesShipmentSearch(s, "  ")).toBe(true);
  });

  it("filters on service type and on shipments still under way", () => {
    const a = shipment({ id: "a" });
    const b = shipment({ id: "b", service_type: "sea", shipment_number: "ZEE-1" });
    const c = shipment({ id: "c", shipment_number: "LUCHT-2" });
    const summary = (orderCount: number, openCount: number): ShipmentSummary => ({
      orderCount,
      openCount,
      customerCount: 1,
      measuredLbs: 0,
      unweighed: 0,
      notReceived: 0,
      mismatched: 0,
      stages: [],
    });
    const summaries = new Map([
      ["a", summary(2, 0)],
      ["b", summary(1, 1)],
    ]);
    const ids = (search: Parameters<typeof filterShipments>[2]) =>
      filterShipments([a, b, c], summaries, search).map((s) => s.id);
    expect(ids({})).toEqual(["a", "b", "c"]);
    expect(ids({ type: "sea" })).toEqual(["b"]);
    // "c" has no orders yet: still under way.
    expect(ids({ open: true })).toEqual(["b", "c"]);
    expect(ids({ q: "lucht" })).toEqual(["a", "c"]);
  });
});

describe("shipment form", () => {
  it("turns the form into columns: empty text is null, Suriname times become instants", () => {
    const result = validateShipmentForm({
      shipmentNumber: "  LUCHT-2026-15 ",
      serviceType: "air",
      carrier: " ",
      awbOrContainerNumber: "810-99",
      departedAt: "2026-10-07T21:30",
      arrivedAt: "2026-10-08T06:15",
      customerNote: "",
    });
    expect(result).toEqual({
      ok: true,
      columns: {
        shipment_number: "LUCHT-2026-15",
        service_type: "air",
        carrier: null,
        awb_or_container_number: "810-99",
        departed_at: "2026-10-08T00:30:00.000Z",
        arrived_at: "2026-10-08T09:15:00.000Z",
        customer_note: null,
      },
    });
  });

  it("reports every problem at once, including arrival before departure", () => {
    const result = validateShipmentForm({
      ...emptyShipmentForm("sea"),
      shipmentNumber: "",
      carrier: "x".repeat(101),
      departedAt: "2026-10-08T10:00",
      arrivedAt: "2026-10-07T10:00",
      customerNote: "y".repeat(2001),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual([
      "arrivedAt",
      "carrier",
      "customerNote",
      "shipmentNumber",
    ]);
    expect(result.errors.arrivedAt).toContain("vóór vertrek");
  });

  it("refuses an impossible date and keeps a round trip from a row", () => {
    const bad = validateShipmentForm({
      ...emptyShipmentForm(),
      shipmentNumber: "Z-1",
      departedAt: "2026-02-30T10:00",
    });
    expect(bad.ok ? null : bad.errors.departedAt).toBeTruthy();
    const values = shipmentFormFromRow(
      shipment({ departed_at: "2026-10-08T00:30:00Z", customer_note: "Vlucht vertraagd" }),
    );
    expect(values).toMatchObject({
      shipmentNumber: "LUCHT-2026-14",
      departedAt: "2026-10-07T21:30",
      arrivedAt: "",
      customerNote: "Vlucht vertraagd",
    });
    const again = validateShipmentForm(values);
    expect(again.ok && again.columns.departed_at).toBe("2026-10-08T00:30:00.000Z");
  });
});

describe("candidates for a shipment", () => {
  const order = (
    id: string,
    stage: StatusRow["stage"] | null,
    extra: Partial<{
      service_type: "air" | "sea";
      shipment_id: string | null;
      created_at: string;
    }> = {},
  ) => ({
    id,
    stage,
    service_type: "air" as const,
    shipment_id: null as string | null,
    created_at: "2026-10-01T00:00:00Z",
    ...extra,
  });

  it("says why an order cannot be added", () => {
    const s = shipment();
    expect(candidateRefusal(order("o", "us_warehouse", { shipment_id: "s1" }), s)).toBe("already");
    expect(candidateRefusal(order("o", "us_warehouse", { service_type: "sea" }), s)).toBe(
      "serviceType",
    );
    expect(candidateRefusal(order("o", "completed"), s)).toBe("closed");
    expect(candidateRefusal(order("o", "cancelled"), s)).toBe("closed");
    expect(candidateRefusal(order("o", "in_transit", { shipment_id: "s2" }), s)).toBeNull();
  });

  it("lists ready orders first, free before moving ones, oldest first", () => {
    const list = shipmentCandidates(
      [
        order("late-registered", "registered", { created_at: "2026-10-03T00:00:00Z" }),
        order("warehouse-new", "us_warehouse", { created_at: "2026-10-05T00:00:00Z" }),
        order("warehouse-other", "us_warehouse", {
          shipment_id: "s2",
          created_at: "2026-09-01T00:00:00Z",
        }),
        order("warehouse-old", "us_warehouse", { created_at: "2026-10-02T00:00:00Z" }),
        order("action", "action_required"),
        order("transit", "in_transit"),
        order("sea", "us_warehouse", { service_type: "sea" }),
        order("done", "completed"),
        order("here", "us_warehouse", { shipment_id: "s1" }),
      ],
      shipment(),
    ).map((o) => o.id);
    expect(list).toEqual([
      "warehouse-old",
      "warehouse-new",
      "warehouse-other",
      "late-registered",
      "action",
      "transit",
    ]);
  });

  it("a whole-shipment status change leaves finished orders alone", () => {
    expect(
      openShipmentOrders([
        { id: "a", stage: "in_transit" as const },
        { id: "b", stage: "completed" as const },
        { id: "c", stage: "cancelled" as const },
        { id: "d", stage: null },
      ]).map((o) => o.id),
    ).toEqual(["a", "d"]);
  });
});

// ---------------------------------------------------------------------------
// Writes: the exact supabase-js calls (the PGlite contract test runs them
// against the real migrations).
// ---------------------------------------------------------------------------

type Call = [string, ...unknown[]];

function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};
  for (const name of ["from", "insert", "update", "eq", "in", "select", "single"]) {
    chain[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
      return chain;
    };
  }
  chain["then"] = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return { client: chain as never, calls };
}

describe("shipment writes", () => {
  it("adds only orders of the shipment's service type, in one filtered update", async () => {
    const { client, calls } = fakeClient({ data: [{ id: "o1" }], error: null });
    const result = await addOrdersToShipment(client, { id: "s1", service_type: "sea" }, [
      "o1",
      "o2",
      "o1",
    ]);
    expect(result).toEqual({ done: ["o1"], skipped: ["o2"] });
    expect(calls).toEqual([
      ["from", "orders"],
      ["update", { shipment_id: "s1" }],
      ["in", "id", ["o1", "o2"]],
      ["eq", "service_type", "sea"],
      ["select", "id"],
    ]);
  });

  it("removes only orders that are in this shipment", async () => {
    const { client, calls } = fakeClient({ data: [{ id: "o2" }], error: null });
    expect(await removeOrdersFromShipment(client, "s1", ["o2", "o3"])).toEqual({
      done: ["o2"],
      skipped: ["o3"],
    });
    expect(calls).toEqual([
      ["from", "orders"],
      ["update", { shipment_id: null }],
      ["in", "id", ["o2", "o3"]],
      ["eq", "shipment_id", "s1"],
      ["select", "id"],
    ]);
  });

  it("a taken number gets its own message; an update that matched no row is not a success", async () => {
    const taken = fakeClient({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    const columns = validateShipmentForm({ ...emptyShipmentForm(), shipmentNumber: "Z-1" });
    if (!columns.ok) throw new Error("form");
    await expect(createShipment(taken.client, columns.columns)).rejects.toMatchObject({
      code: "23505",
      message: "Er bestaat al een zending met nummer Z-1.",
    });
    const none = fakeClient({ data: [], error: null });
    await expect(updateShipment(none.client, "s1", columns.columns)).rejects.toMatchObject({
      code: "P0002",
    });
  });
});
