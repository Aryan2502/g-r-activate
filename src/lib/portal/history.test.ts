import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import type { StatusMap } from "@/lib/portal/orders";

import {
  buildHistoryRecords,
  filterHistory,
  groupByYear,
  hasHistoryFilters,
  historySearchSchema,
  historyYears,
  surinameYear,
  yearSummaryText,
  type HistorySources,
} from "./history";

const shipment = {
  id: "s1",
  shipment_number: "SH-2026-007",
  service_type: "air" as const,
  carrier: "Amerijet",
  awb_or_container_number: "810-1234 5675",
  departed_at: "2026-09-10T15:00:00Z",
  arrived_at: null,
  created_at: "2026-09-08T15:00:00Z",
};

const sources: HistorySources = {
  orders: [
    {
      id: "o1",
      reference: "ORD-2026-00012",
      order_type: "personal",
      status: "in_transit_air",
      store_vendor: "Amazon",
      description: "Sportschoenen",
      tracking_number: "1Z-999-AA1",
      created_at: "2026-09-01T12:00:00Z",
      shipment,
    },
    {
      id: "o2",
      reference: "ORD-2026-00013",
      order_type: "b2b",
      status: "in_transit_air",
      store_vendor: "Énéas Supplies",
      description: null,
      tracking_number: null,
      created_at: "2026-09-02T12:00:00Z",
      shipment,
    },
    {
      // 01:00 UTC on 1 January 2026 is still 31 December 2025 in Suriname.
      id: "o0",
      reference: "ORD-2025-00099",
      order_type: "personal",
      status: "picked_up",
      store_vendor: "Shein",
      description: null,
      tracking_number: null,
      created_at: "2026-01-01T01:00:00Z",
      shipment: null,
    },
  ],
  history: [
    {
      id: 5,
      order_id: "o1",
      to_status: "in_transit_air",
      changed_at: "2026-09-10T16:00:00Z",
      customer_message: "  Vertrokken met vlucht 123 ",
    },
  ],
  invoices: [
    {
      id: "i1",
      invoice_number: "INV-2026-0007",
      status: "open",
      is_overdue: false,
      invoice_date: "2026-09-15",
      due_date: "2026-09-22",
      total_amount: 45,
      balance_due: 45,
      currency: "USD",
    },
    {
      id: "d1",
      invoice_number: null,
      status: "draft",
      is_overdue: false,
      invoice_date: "2026-09-16",
      due_date: "2026-09-23",
      total_amount: 10,
      balance_due: 0,
      currency: "USD",
    },
  ],
  payments: [
    {
      id: "p1",
      invoice_id: "i1",
      amount: 20,
      paid_on: "2026-09-18",
      method: "cash",
      voided_at: null,
      invoice: { invoice_number: "INV-2026-0007", currency: "USD" },
    },
    {
      id: "p0",
      invoice_id: "i1",
      amount: 99,
      paid_on: "2026-09-17",
      method: "cash",
      voided_at: "2026-09-17T20:00:00Z",
      invoice: { invoice_number: "INV-2026-0007", currency: "USD" },
    },
  ],
};

const statuses: StatusMap = new Map([
  [
    "in_transit_air",
    {
      code: "in_transit_air",
      label_nl: "Onderweg per vliegtuig",
      customer_description_nl: null,
      stage: "in_transit" as const,
      sort_order: 30,
      active: true,
    },
  ],
]);

describe("surinameYear()", () => {
  it("reads a date as written and an instant in Suriname time", () => {
    expect(surinameYear("2026-01-01")).toBe(2026);
    expect(surinameYear("2026-01-01T01:00:00Z")).toBe(2025);
    expect(surinameYear("2026-01-01T03:00:00Z")).toBe(2026);
  });
});

describe("buildHistoryRecords()", () => {
  const records = buildHistoryRecords(sources);

  it("lists orders, shipments, invoices, payments and status changes, newest first", () => {
    expect(records.map((r) => r.key)).toEqual([
      "p:p1",
      "i:i1",
      "h:5",
      "s:s1",
      "o:o2",
      "o:o1",
      "o:o0",
    ]);
  });

  it("makes one shipment record with all of the customer's orders in it", () => {
    const s = records.find((r) => r.type === "shipments");
    expect(s).toMatchObject({
      shipmentNumber: "SH-2026-007",
      year: 2026,
      at: shipment.departed_at,
      orders: [
        { id: "o1", reference: "ORD-2026-00012" },
        { id: "o2", reference: "ORD-2026-00013" },
      ],
    });
  });

  it("never shows drafts or voided payments, and dates by the RPC's rules", () => {
    expect(records.some((r) => r.key === "i:d1" || r.key === "p:p0")).toBe(false);
    expect(records.find((r) => r.key === "o:o0")?.year).toBe(2025);
    expect(records.find((r) => r.key === "h:5")).toMatchObject({
      reference: "ORD-2026-00012",
      message: "Vertrokken met vlucht 123",
    });
    expect(records.find((r) => r.key === "p:p1")).toMatchObject({
      invoiceNumber: "INV-2026-0007",
      currency: "USD",
      year: 2026,
    });
  });

  it("dates a shipment that has not left by its creation", () => {
    const [s] = buildHistoryRecords({
      ...sources,
      orders: [{ ...sources.orders[0]!, shipment: { ...shipment, departed_at: null } }],
      history: [],
      invoices: [],
      payments: [],
    }).filter((r) => r.type === "shipments");
    expect(s?.at).toBe(shipment.created_at);
  });
});

describe("filterHistory()", () => {
  const records = buildHistoryRecords(sources);
  const keys = (search: Parameters<typeof filterHistory>[1]) =>
    filterHistory(records, search, statuses).map((r) => r.key);

  it("filters by year and type", () => {
    expect(keys({ year: 2025 })).toEqual(["o:o0"]);
    expect(keys({ type: "payments" })).toEqual(["p:p1"]);
    expect(keys({ type: "status", year: 2026 })).toEqual(["h:5"]);
    expect(keys({ type: "orders", year: 2024 })).toEqual([]);
  });

  it("searches references, numbers, stores, status labels and messages", () => {
    expect(keys({ q: "inv-2026-0007" })).toEqual(["p:p1", "i:i1"]);
    // Accents and case do not matter.
    expect(keys({ q: "eneas" })).toEqual(["o:o2"]);
    // Tracking and AWB numbers also without dashes or spaces.
    expect(keys({ q: "1z999" })).toEqual(["o:o1"]);
    expect(keys({ q: "81012345675" })).toEqual(["s:s1"]);
    expect(keys({ q: "vliegtuig" })).toEqual(["h:5", "o:o2", "o:o1"]);
    expect(keys({ q: "vlucht 123" })).toEqual(["h:5"]);
  });
});

describe("year helpers", () => {
  it("groups records by year, newest year first", () => {
    const groups = groupByYear(buildHistoryRecords(sources));
    expect(groups.map(([year, list]) => [year, list.length])).toEqual([
      [2026, 6],
      [2025, 1],
    ]);
  });

  it("offers every counted year plus years with only status changes", () => {
    const records = buildHistoryRecords(sources);
    expect(
      historyYears([{ year: 2026, orders: 2, shipments: 1, invoices: 1, payments: 1 }], records),
    ).toEqual([2026, 2025]);
  });

  it("writes the year line the way §20 shows it", () => {
    expect(
      yearSummaryText({ year: 2026, orders: 12, shipments: 8, invoices: 7, payments: 0 }),
    ).toBe("12 orders, 8 zendingen, 7 facturen");
    expect(yearSummaryText({ year: 2026, orders: 1, shipments: 1, invoices: 1, payments: 1 })).toBe(
      "1 order, 1 zending, 1 factuur, 1 betaling",
    );
    expect(yearSummaryText({ year: 2026, orders: 0, shipments: 0, invoices: 0, payments: 0 })).toBe(
      "alleen statuswijzigingen",
    );
  });
});

describe("historySearchSchema", () => {
  it("keeps valid filters and drops the rest", () => {
    expect(historySearchSchema.parse({ year: "2026", type: "invoices", q: 12345 })).toEqual({
      year: 2026,
      type: "invoices",
      q: "12345",
    });
    expect(historySearchSchema.parse({ year: "x", type: "drafts", q: "  " })).toEqual({
      year: undefined,
      type: undefined,
      q: undefined,
    });
    expect(hasHistoryFilters({})).toBe(false);
    expect(hasHistoryFilters({ year: 2026 })).toBe(true);
  });
});
