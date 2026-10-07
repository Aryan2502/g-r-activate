import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  filterInvoices,
  hasInvoiceFilters,
  invoiceListSearchSchema,
  joinInvoices,
  matchesInvoiceSearch,
  matchesStatusFilter,
  periodRange,
  referencesByInvoice,
  summarizeInvoiceList,
  type AdminInvoiceListItem,
  type AdminInvoiceRow,
} from "./invoices";

const TODAY = "2026-10-07";

function row(over: Partial<AdminInvoiceRow> & { id: string }): AdminInvoiceRow {
  return {
    invoice_number: null,
    status: "open",
    customer_id: "c1",
    currency: "USD",
    invoice_date: "2026-10-01",
    due_date: "2026-10-08",
    total_amount: 100,
    amount_paid: 0,
    balance_due: 100,
    is_overdue: false,
    days_overdue: 0,
    paid_at: null,
    issued_at: "2026-10-01T12:00:00Z",
    cancelled_at: null,
    created_at: "2026-10-01T11:00:00Z",
    replaces_invoice_id: null,
    reminder_count: 0,
    late_fee_applied_at: null,
    ...over,
  };
}

const maria = {
  id: "c1",
  customer_code: "GR00017",
  full_name: "Maria Pinas",
  company_name: null,
  account_type: "personal" as const,
  status: "active" as const,
  user_id: "u1",
};
const pinas = {
  id: "c2",
  customer_code: "GR00042",
  full_name: "Énéas Wong",
  company_name: "Wong Trading N.V.",
  account_type: "business" as const,
  status: "active" as const,
  user_id: null,
};

function list(): AdminInvoiceListItem[] {
  return joinInvoices(
    {
      invoices: [
        row({ id: "a", invoice_number: "INV-2026-0012", invoice_date: "2026-10-05" }),
        row({
          id: "b",
          invoice_number: "INV-2026-0003",
          invoice_date: "2026-09-02",
          due_date: "2026-09-09",
          status: "partially_paid",
          amount_paid: 40,
          balance_due: 60,
          is_overdue: true,
          days_overdue: 28,
          customer_id: "c2",
        }),
        row({
          id: "c",
          invoice_number: "INV-2026-0010",
          status: "paid",
          currency: "SRD",
          total_amount: 1250,
          amount_paid: 1250,
          balance_due: 0,
          paid_at: "2026-10-03T12:00:00Z",
          invoice_date: "2026-10-02",
        }),
        row({
          id: "d",
          status: "draft",
          issued_at: null,
          invoice_date: "2026-10-06",
          balance_due: 0,
        }),
        row({
          id: "e",
          invoice_number: "INV-2025-0099",
          status: "cancelled",
          invoice_date: "2025-12-30",
          cancelled_at: "2026-01-02T12:00:00Z",
          balance_due: 0,
        }),
      ],
      references: new Map([
        ["a", ["ORD-2026-00012", "ORD-2026-00013"]],
        ["b", ["ORD-2026-00002"]],
      ]),
    },
    [maria, pinas],
  );
}

describe("referencesByInvoice()", () => {
  it("groups distinct references per invoice, sorted, skipping lines without an order", () => {
    const map = referencesByInvoice([
      { invoice_id: "a", order: { reference: "ORD-2026-00013" } },
      { invoice_id: "a", order: { reference: "ORD-2026-00012" } },
      { invoice_id: "a", order: { reference: "ORD-2026-00012" } },
      { invoice_id: "b", order: null },
    ]);
    expect(map.get("a")).toEqual(["ORD-2026-00012", "ORD-2026-00013"]);
    expect(map.has("b")).toBe(false);
  });
});

describe("invoiceListSearchSchema", () => {
  it("keeps valid params and drops invalid ones instead of failing", () => {
    expect(
      invoiceListSearchSchema.parse({
        q: 2026,
        status: "overdue",
        currency: "SRD",
        period: "custom",
        from: "2026-02-30",
        to: "2026-03-31",
        sort: "nope",
      }),
    ).toEqual({
      q: "2026",
      status: "overdue",
      currency: "SRD",
      period: "custom",
      to: "2026-03-31",
    });
    expect(hasInvoiceFilters({})).toBe(false);
    expect(hasInvoiceFilters({ sort: "due" })).toBe(false);
    expect(hasInvoiceFilters({ currency: "USD" })).toBe(true);
  });
});

describe("periodRange()", () => {
  it("counts from today in Suriname, inclusive", () => {
    expect(periodRange({ period: "this_month" }, TODAY)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(periodRange({ period: "last_month" }, "2026-03-15")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(periodRange({ period: "last_month" }, "2026-01-10")).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
    expect(periodRange({ period: "last_30" }, TODAY)).toEqual({ from: "2026-09-08", to: TODAY });
    expect(periodRange({ period: "this_year" }, TODAY)).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
    expect(periodRange({ period: "last_year" }, TODAY)).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });
  });

  it("custom: open ends, swapped dates, nothing chosen", () => {
    expect(periodRange({ period: "custom", from: "2026-09-01" }, TODAY)).toEqual({
      from: "2026-09-01",
      to: null,
    });
    expect(periodRange({ period: "custom", from: "2026-10-01", to: "2026-09-01" }, TODAY)).toEqual({
      from: "2026-09-01",
      to: "2026-10-01",
    });
    expect(periodRange({ period: "custom" }, TODAY)).toBeNull();
    expect(periodRange({}, TODAY)).toBeNull();
  });
});

describe("matchesInvoiceSearch()", () => {
  const [a, b] = list();

  it("finds an invoice number however it is typed", () => {
    expect(matchesInvoiceSearch(a!, "INV-2026-0012")).toBe(true);
    expect(matchesInvoiceSearch(a!, "inv-2026-0012")).toBe(true);
    expect(matchesInvoiceSearch(a!, "2026 0012")).toBe(true);
    expect(matchesInvoiceSearch(a!, "0012")).toBe(true);
    expect(matchesInvoiceSearch(a!, "0003")).toBe(false);
  });

  it("finds the customer by GR code, name or company (accents ignored)", () => {
    expect(matchesInvoiceSearch(a!, "gr 17")).toBe(true);
    expect(matchesInvoiceSearch(a!, "GR00017")).toBe(true);
    expect(matchesInvoiceSearch(a!, "pinas")).toBe(true);
    expect(matchesInvoiceSearch(b!, "eneas")).toBe(true);
    expect(matchesInvoiceSearch(b!, "wong trading")).toBe(true);
    expect(matchesInvoiceSearch(b!, "gr 17")).toBe(false);
  });

  it("finds an order reference on the invoice, also without dashes", () => {
    expect(matchesInvoiceSearch(a!, "ORD-2026-00013")).toBe(true);
    expect(matchesInvoiceSearch(a!, "ord202600013")).toBe(true);
    expect(matchesInvoiceSearch(b!, "ORD-2026-00013")).toBe(false);
  });
});

describe("filterInvoices()", () => {
  const ids = (search: Parameters<typeof filterInvoices>[1]) =>
    filterInvoices(list(), search, TODAY).map((i) => i.id);

  it("status filters follow the badges: overdue wins, 'unpaid' is everything still open", () => {
    expect(ids({ status: "overdue" })).toEqual(["b"]);
    expect(ids({ status: "partially_paid" })).toEqual([]);
    expect(ids({ status: "open" })).toEqual(["a"]);
    expect(ids({ status: "unpaid" })).toEqual(["a", "b"]);
    expect(ids({ status: "draft" })).toEqual(["d"]);
    expect(ids({ status: "cancelled" })).toEqual(["e"]);
    expect(matchesStatusFilter({ status: "paid", is_overdue: false }, "paid")).toBe(true);
  });

  it("filters on currency and the invoice-date period", () => {
    expect(ids({ currency: "SRD" })).toEqual(["c"]);
    expect(ids({ period: "this_month" })).toEqual(["d", "a", "c"]);
    expect(ids({ period: "last_year" })).toEqual(["e"]);
    expect(ids({ period: "custom", from: "2026-09-01", to: "2026-09-30" })).toEqual(["b"]);
  });

  it("sorts: newest (default), oldest, due (open first), amount, customer", () => {
    expect(ids({})).toEqual(["d", "a", "c", "b", "e"]);
    expect(ids({ sort: "oldest" })).toEqual(["e", "b", "c", "a", "d"]);
    expect(ids({ sort: "due" }).slice(0, 2)).toEqual(["b", "a"]);
    expect(ids({ sort: "amount" })[0]).toBe("c");
    expect(ids({ sort: "customer" })).toEqual(["d", "a", "c", "e", "b"]);
  });
});

describe("summarizeInvoiceList()", () => {
  it("sums per currency, never across, and leaves drafts and cancelled invoices out", () => {
    expect(summarizeInvoiceList(list())).toEqual({
      issuedCount: 3,
      draftCount: 1,
      cancelledCount: 1,
      overdueCount: 1,
      invoiced: [
        { currency: "USD", amount: 200 },
        { currency: "SRD", amount: 1250 },
      ],
      paid: [
        { currency: "USD", amount: 40 },
        { currency: "SRD", amount: 1250 },
      ],
      outstanding: [{ currency: "USD", amount: 160 }],
      overdue: [{ currency: "USD", amount: 60 }],
    });
  });
});
