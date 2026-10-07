import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  filterPortalInvoices,
  invoiceBadgeKey,
  invoiceBadgeTone,
  portalInvoiceSearchSchema,
  summarizeOpenInvoices,
  totalsByCurrency,
  unpaidByCurrency,
} from "./invoices";

describe("totalsByCurrency()", () => {
  it("never adds different currencies together (SPEC §35.10)", () => {
    expect(
      totalsByCurrency([
        { currency: "SRD", amount: 1000 },
        { currency: "USD", amount: 200 },
        { currency: "USD", amount: 45 },
        { currency: "SRD", amount: 250 },
      ]),
    ).toEqual([
      { currency: "USD", amount: 245 },
      { currency: "SRD", amount: 1250 },
    ]);
  });

  it("sums in cents, without floating-point drift", () => {
    expect(
      totalsByCurrency([
        { currency: "USD", amount: 0.1 },
        { currency: "USD", amount: 0.2 },
      ]),
    ).toEqual([{ currency: "USD", amount: 0.3 }]);
    expect(
      totalsByCurrency([
        { currency: "EUR", amount: "1.005" },
        { currency: "EUR", amount: "2.675" },
      ]),
    ).toEqual([{ currency: "EUR", amount: 3.69 }]);
  });

  it("orders USD, EUR, SRD and leaves out zero totals and missing values", () => {
    expect(
      totalsByCurrency([
        { currency: "SRD", amount: 5 },
        { currency: "EUR", amount: 0 },
        { currency: null, amount: 99 },
        { currency: "USD", amount: null },
        { currency: "EUR", amount: 7 },
      ]),
    ).toEqual([
      { currency: "EUR", amount: 7 },
      { currency: "SRD", amount: 5 },
    ]);
    expect(totalsByCurrency([])).toEqual([]);
  });
});

describe("summarizeOpenInvoices()", () => {
  const rows = [
    { id: "i1", status: "open", is_overdue: false, currency: "USD", balance_due: 120.5 },
    { id: "i2", status: "partially_paid", is_overdue: true, currency: "USD", balance_due: 24.5 },
    { id: "i3", status: "open", is_overdue: true, currency: "SRD", balance_due: 1250 },
    { id: "i4", status: "paid", is_overdue: false, currency: "USD", balance_due: 0 },
    { id: "i5", status: "cancelled", is_overdue: false, currency: "EUR", balance_due: 0 },
  ] as const;

  it("counts open and partially paid invoices, overdue included, with balances per currency", () => {
    expect(summarizeOpenInvoices(rows)).toEqual({
      openCount: 3,
      overdueCount: 2,
      outstanding: [
        { currency: "USD", amount: 145 },
        { currency: "SRD", amount: 1250 },
      ],
      orders: [],
    });
  });

  it("lists the orders of open invoices once, those with an overdue invoice first", () => {
    const summary = summarizeOpenInvoices(rows, [
      { invoice_id: "i1", order_id: "o-open" },
      { invoice_id: "i1", order_id: "o-both" },
      { invoice_id: "i3", order_id: "o-both" },
      { invoice_id: "i2", order_id: "o-late" },
      { invoice_id: "i2", order_id: null },
      { invoice_id: "i4", order_id: "o-paid" },
      { invoice_id: "i5", order_id: "o-cancelled" },
    ]);
    expect(summary.orders).toEqual([
      { orderId: "o-both", overdue: true },
      { orderId: "o-late", overdue: true },
      { orderId: "o-open", overdue: false },
    ]);
  });

  it("is empty without open invoices", () => {
    expect(summarizeOpenInvoices([])).toEqual({
      openCount: 0,
      overdueCount: 0,
      outstanding: [],
      orders: [],
    });
  });
});

describe("unpaidByCurrency()", () => {
  it("sums what is still to be paid per currency; paid and cancelled invoices do not count", () => {
    expect(
      unpaidByCurrency([
        { status: "open", balance_due: 245, currency: "USD" },
        { status: "partially_paid", balance_due: 1250, currency: "SRD" },
        { status: "open", balance_due: 89.5, currency: "EUR" },
        { status: "open", balance_due: 0.1, currency: "USD" },
        { status: "paid", balance_due: 0, currency: "USD" },
        { status: "cancelled", balance_due: 50, currency: "USD" },
      ]),
    ).toEqual([
      { currency: "USD", amount: 245.1 },
      { currency: "EUR", amount: 89.5 },
      { currency: "SRD", amount: 1250 },
    ]);
    expect(unpaidByCurrency([{ status: "paid", balance_due: 0, currency: "USD" }])).toEqual([]);
  });
});

describe("invoice badges (SPEC §35.10)", () => {
  it("shows overdue instead of open or partially paid", () => {
    expect(invoiceBadgeKey({ status: "open", is_overdue: true })).toBe("overdue");
    expect(invoiceBadgeKey({ status: "partially_paid", is_overdue: true })).toBe("overdue");
    expect(invoiceBadgeKey({ status: "partially_paid", is_overdue: false })).toBe("partially_paid");
    expect(invoiceBadgeKey({ status: "paid", is_overdue: false })).toBe("paid");
    expect(invoiceBadgeKey({ status: "cancelled", is_overdue: null })).toBe("cancelled");
  });

  it("colours paid green, open amber, overdue red and the rest grey", () => {
    expect(invoiceBadgeTone("paid")).toBe("success");
    expect(invoiceBadgeTone("open")).toBe("warning");
    expect(invoiceBadgeTone("partially_paid")).toBe("warning");
    expect(invoiceBadgeTone("overdue")).toBe("danger");
    expect(invoiceBadgeTone("cancelled")).toBe("neutral");
    expect(invoiceBadgeTone("draft")).toBe("neutral");
  });
});

describe("/portal/facturen filters", () => {
  const rows = [
    { id: "a", status: "open" as const, balance_due: 45 },
    { id: "b", status: "partially_paid" as const, balance_due: 10 },
    { id: "c", status: "paid" as const, balance_due: 0 },
    { id: "d", status: "cancelled" as const, balance_due: 0 },
  ];

  it("'Nog te betalen' are open invoices with a balance; 'Betaald' the paid ones", () => {
    expect(filterPortalInvoices(rows, undefined).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    expect(filterPortalInvoices(rows, "unpaid").map((r) => r.id)).toEqual(["a", "b"]);
    expect(filterPortalInvoices(rows, "paid").map((r) => r.id)).toEqual(["c"]);
  });

  it("drops an unknown ?show= instead of failing", () => {
    expect(portalInvoiceSearchSchema.parse({ show: "drafts" })).toEqual({});
    expect(portalInvoiceSearchSchema.parse({ show: "unpaid" })).toEqual({ show: "unpaid" });
  });
});
