import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const { ORDER_COUNT_KEYS, ORDER_COUNT_SEARCH, codesByStage, resolvableFromDashboard } =
  await import("./dashboard");
const { adminOrderSearchSchema } = await import("./orders");

describe("admin dashboard", () => {
  it("groups status codes by stage (counts use stages, never labels)", () => {
    const map = codesByStage([
      { code: "order_registered", stage: "registered" },
      { code: "pending", stage: "registered" },
      { code: "in_transit", stage: "in_transit" },
    ]);
    expect(map.get("registered")).toEqual(["order_registered", "pending"]);
    expect(map.get("in_transit")).toEqual(["in_transit"]);
    expect(map.get("at_customs")).toBeUndefined();
  });

  it("every count links to a valid /admin/orders filter", () => {
    for (const key of ORDER_COUNT_KEYS) {
      const search = ORDER_COUNT_SEARCH[key];
      expect(adminOrderSearchSchema.parse(search), key).toEqual(search);
      expect(Object.keys(search).length, key).toBeGreaterThan(0);
    }
  });

  it("cancellation requests are decided on the order page, other tasks can be ticked off", () => {
    expect(resolvableFromDashboard({ kind: "order_cancellation_request" })).toBe(false);
    expect(resolvableFromDashboard({ kind: "signup_email_conflict" })).toBe(true);
  });
});
