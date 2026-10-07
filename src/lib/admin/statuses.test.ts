import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const {
  canReceive,
  canSetWeightDirectly,
  defaultNotify,
  firstActiveStatus,
  isAwaitingReceipt,
  isClosedStage,
  mustReceiveFirst,
  needsB2bCustomsWarning,
  receiveMode,
  selectableStatuses,
  suggestedNextStatus,
  weightAction,
} = await import("./statuses");
type StatusRow = import("./statuses").StatusRow;

const row = (
  code: string,
  stage: StatusRow["stage"],
  sort_order: number,
  extra: Partial<StatusRow> = {},
): StatusRow => ({
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
  ...extra,
});

const statuses = new Map(
  [
    row("order_registered", "registered", 10),
    row("pending", "registered", 20),
    row("arrived_us_warehouse", "us_warehouse", 40, { notify_customer: true }),
    row("old_warehouse", "us_warehouse", 35, { active: false }),
    row("in_transit", "in_transit", 50),
    row("internal_check", "at_customs", 65, { customer_visible: false, notify_customer: true }),
    row("picked_up", "completed", 100),
    row("delivered", "completed", 110),
    row("documents_required", "action_required", 120),
    row("cancelled", "cancelled", 130),
  ].map((s) => [s.code, s]),
);

describe("selectableStatuses()", () => {
  it("offers active statuses in sort order, without 'Bezorgd' unless G&R delivers", () => {
    const codes = selectableStatuses(statuses, { deliveryAvailable: false }).map((s) => s.code);
    expect(codes).not.toContain("old_warehouse");
    expect(codes).not.toContain("delivered");
    expect(codes[0]).toBe("order_registered");
    expect(codes.at(-1)).toBe("cancelled");
    expect(selectableStatuses(statuses, { deliveryAvailable: true }).map((s) => s.code)).toContain(
      "delivered",
    );
  });
});

describe("firstActiveStatus()", () => {
  it("is what receive_order and the shortcuts pick: the lowest active sort order of the stage", () => {
    expect(firstActiveStatus(statuses, "us_warehouse")?.code).toBe("arrived_us_warehouse");
    expect(firstActiveStatus(statuses, "completed")?.code).toBe("picked_up");
    expect(firstActiveStatus(statuses, "arrived_sr")).toBeNull();
  });
});

describe("defaultNotify()", () => {
  it("follows notify_customer, and never e-mails about a status the customer cannot see", () => {
    expect(defaultNotify(statuses.get("arrived_us_warehouse")!)).toBe(true);
    expect(defaultNotify(statuses.get("in_transit")!)).toBe(false);
    expect(defaultNotify(statuses.get("internal_check")!)).toBe(false);
  });
});

describe("receiving", () => {
  it("canReceive() mirrors receive_order: registered, US warehouse (weight fix), action required before receipt", () => {
    expect(canReceive("registered", null)).toBe(true);
    expect(canReceive("us_warehouse", "2026-10-01T10:00:00Z")).toBe(true);
    expect(canReceive("action_required", null)).toBe(true);
    expect(canReceive("action_required", "2026-10-01T10:00:00Z")).toBe(false);
    expect(canReceive("in_transit", "2026-10-01T10:00:00Z")).toBe(false);
    expect(canReceive(null, null)).toBe(false);
  });

  it("isAwaitingReceipt() is not yet in G&R's hands", () => {
    expect(isAwaitingReceipt("registered", null)).toBe(true);
    expect(isAwaitingReceipt("action_required", null)).toBe(true);
    expect(isAwaitingReceipt("action_required", "2026-10-01T10:00:00Z")).toBe(false);
    expect(isAwaitingReceipt("us_warehouse", "2026-10-01T10:00:00Z")).toBe(false);
  });

  it("isClosedStage()", () => {
    expect(isClosedStage("completed")).toBe(true);
    expect(isClosedStage("cancelled")).toBe(true);
    expect(isClosedStage("ready_for_pickup")).toBe(false);
  });
});

describe("receipt before the journey goes on (P4 review)", () => {
  const AT = "2026-10-01T10:00:00Z";

  it("mustReceiveFirst(): an order that can still be received waits for it before leaving the warehouse", () => {
    expect(mustReceiveFirst({ stage: "registered", receivedAt: null }, "in_transit")).toBe(true);
    expect(mustReceiveFirst({ stage: "registered", receivedAt: null }, "completed")).toBe(true);
    // Put into the US-warehouse status without "Ontvangen": still no receipt.
    expect(mustReceiveFirst({ stage: "us_warehouse", receivedAt: null }, "in_transit")).toBe(true);
    expect(mustReceiveFirst({ stage: "action_required", receivedAt: null }, "arrived_sr")).toBe(
      true,
    );
    // Allowed: within the first stages, asking for an action, cancelling.
    expect(mustReceiveFirst({ stage: "registered", receivedAt: null }, "us_warehouse")).toBe(false);
    expect(mustReceiveFirst({ stage: "registered", receivedAt: null }, "action_required")).toBe(
      false,
    );
    expect(mustReceiveFirst({ stage: "registered", receivedAt: null }, "cancelled")).toBe(false);
    expect(mustReceiveFirst({ stage: "us_warehouse", receivedAt: AT }, "in_transit")).toBe(false);
    // Older data already past the warehouse is not held back (it can no longer be received).
    expect(mustReceiveFirst({ stage: "in_transit", receivedAt: null }, "arrived_sr")).toBe(false);
    expect(mustReceiveFirst({ stage: "registered", receivedAt: null }, null)).toBe(false);
  });

  it("canSetWeightDirectly() / receiveMode() / weightAction(): every open order can get its weight", () => {
    expect(canSetWeightDirectly("in_transit", null)).toBe(true);
    expect(canSetWeightDirectly("ready_for_pickup", AT)).toBe(true);
    expect(canSetWeightDirectly("action_required", AT)).toBe(true);
    expect(canSetWeightDirectly("us_warehouse", AT)).toBe(false); // receive_order corrects it
    expect(canSetWeightDirectly("completed", AT)).toBe(false);
    expect(canSetWeightDirectly("cancelled", null)).toBe(false);
    expect(canSetWeightDirectly(null, null)).toBe(false);

    expect(receiveMode({ stage: "registered", received_at: null })).toBe("receive");
    expect(receiveMode({ stage: "us_warehouse", received_at: null })).toBe("receive");
    expect(receiveMode({ stage: "us_warehouse", received_at: AT })).toBe("correct");
    expect(receiveMode({ stage: "in_transit", received_at: null })).toBe("weight");

    const w = (
      stage: Parameters<typeof canReceive>[0],
      received_at: string | null,
      lbs: number | null,
    ) => weightAction({ stage, received_at, measured_weight_lbs: lbs });
    expect(w("registered", null, null)).toBe("receive");
    expect(w("us_warehouse", AT, 2)).toBe("correctWeight");
    expect(w("in_transit", null, null)).toBe("setWeight");
    expect(w("in_transit", AT, 2)).toBe("correctWeight");
    expect(w("completed", AT, 2)).toBeNull();
  });

  it("suggestedNextStatus(): the 'Standaard' status of the next stage, never for an order still to receive", () => {
    const next = (status: string, receivedAt: string | null, deliveryAvailable = false) =>
      suggestedNextStatus(statuses, { status, receivedAt }, { deliveryAvailable })?.code ?? null;
    expect(next("arrived_us_warehouse", AT)).toBe("in_transit");
    // No active arrived_sr status here: the next stage that has one.
    expect(next("in_transit", AT)).toBe("internal_check");
    expect(next("order_registered", null)).toBeNull();
    expect(next("arrived_us_warehouse", null)).toBeNull();
    expect(next("documents_required", AT)).toBeNull();
    expect(next("cancelled", null)).toBeNull();
    expect(next("picked_up", AT)).toBeNull();
    expect(next("unknown_code", AT)).toBeNull();
  });
});

describe("needsB2bCustomsWarning() (SPEC §35.7: warn, never block)", () => {
  const b2b = { orderType: "b2b" as const, hasCustomsDocuments: false };

  it("warns when a B2B order without documents reaches customs or a later stage", () => {
    expect(needsB2bCustomsWarning({ ...b2b, fromStage: "arrived_sr", toStage: "at_customs" })).toBe(
      true,
    );
    expect(needsB2bCustomsWarning({ ...b2b, fromStage: "in_transit", toStage: "cleared" })).toBe(
      true,
    );
    expect(
      needsB2bCustomsWarning({ ...b2b, fromStage: "action_required", toStage: "at_customs" }),
    ).toBe(true);
  });

  it("stays quiet before customs, once past it, with documents, or for personal orders", () => {
    expect(
      needsB2bCustomsWarning({ ...b2b, fromStage: "us_warehouse", toStage: "in_transit" }),
    ).toBe(false);
    expect(needsB2bCustomsWarning({ ...b2b, fromStage: "at_customs", toStage: "cleared" })).toBe(
      false,
    );
    expect(
      needsB2bCustomsWarning({
        ...b2b,
        hasCustomsDocuments: true,
        fromStage: "arrived_sr",
        toStage: "at_customs",
      }),
    ).toBe(false);
    expect(
      needsB2bCustomsWarning({
        orderType: "personal",
        hasCustomsDocuments: false,
        fromStage: "arrived_sr",
        toStage: "at_customs",
      }),
    ).toBe(false);
    expect(needsB2bCustomsWarning({ ...b2b, fromStage: "arrived_sr", toStage: "cancelled" })).toBe(
      false,
    );
  });
});
