import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const {
  ORDER_COUNT_KEYS,
  ORDER_COUNT_SEARCH,
  codesByStage,
  daysAgo,
  mergeStaffActivity,
  resolvableFromDashboard,
  summarizeInvoiceStats,
} = await import("./dashboard");
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

describe("admin dashboard: invoices and activity (SPEC §12, §35.10)", () => {
  it("sums what is still to be paid per currency, never across currencies", () => {
    const stats = summarizeInvoiceStats(
      [
        { currency: "USD", balance_due: 100.1, is_overdue: false },
        { currency: "USD", balance_due: 0.2, is_overdue: true },
        { currency: "SRD", balance_due: 1250, is_overdue: true },
        // Partially paid down to zero by a race: counted as open, adds nothing.
        { currency: "EUR", balance_due: 0, is_overdue: false },
      ],
      { paid: 7, paidRecent: 2, drafts: 1 },
    );
    expect(stats).toEqual({
      openCount: 4,
      overdueCount: 2,
      paidCount: 7,
      paidRecent: 2,
      draftCount: 1,
      outstanding: [
        { currency: "USD", amount: 100.3 },
        { currency: "SRD", amount: 1250 },
      ],
      overdueOutstanding: [
        { currency: "USD", amount: 0.2 },
        { currency: "SRD", amount: 1250 },
      ],
    });
  });

  it("'last 30 days' is counted back from now", () => {
    expect(daysAgo(30, new Date("2026-10-31T12:00:00Z"))).toBe("2026-10-01T12:00:00.000Z");
  });

  it("merges the sources newest first, each item once", () => {
    const maria = { id: "c1", full_name: "Maria Pinas", customer_code: "GR00042" };
    const items = mergeStaffActivity(
      {
        history: [
          {
            id: 7,
            order_id: "o1",
            to_status: "in_transit",
            changed_at: "2026-10-07T12:00:00Z",
            changed_by: "u1",
            order: { reference: "ORD-2026-00001", customer: maria },
          },
        ],
        customers: [{ ...maria, created_at: "2026-10-01T09:00:00Z" }],
        invitations: [
          {
            id: "i1",
            kind: "customer",
            email: "maria@example.com",
            accepted_at: "2026-10-02T09:00:00Z",
            customer: maria,
          },
          { id: "i2", kind: "staff", email: "kim@example.com", accepted_at: null, customer: null },
        ],
        invoices: [
          {
            id: "f1",
            invoice_number: "INV-2026-0001",
            issued_at: "2026-10-05T10:00:00Z",
            cancelled_at: null,
            total_amount: 45,
            currency: "USD",
            customer: maria,
          },
          // The same invoice also comes from the "newest cancelled" list.
          {
            id: "f1",
            invoice_number: "INV-2026-0001",
            issued_at: "2026-10-05T10:00:00Z",
            cancelled_at: null,
            total_amount: 45,
            currency: "USD",
            customer: maria,
          },
        ],
        payments: [
          {
            id: "p1",
            amount: 20,
            created_at: "2026-10-06T10:00:00Z",
            invoice: { invoice_number: "INV-2026-0001", currency: "USD", customer: maria },
          },
        ],
      },
      10,
    );
    expect(items.map((i) => [i.kind, i.at])).toEqual([
      ["status_changed", "2026-10-07T12:00:00Z"],
      ["payment_recorded", "2026-10-06T10:00:00Z"],
      ["invoice_issued", "2026-10-05T10:00:00Z"],
      ["invitation_accepted", "2026-10-02T09:00:00Z"],
      ["customer_created", "2026-10-01T09:00:00Z"],
    ]);
    expect(
      mergeStaffActivity({
        history: [],
        customers: [],
        invitations: [],
        invoices: [],
        payments: [],
      }),
    ).toEqual([]);
  });
});
