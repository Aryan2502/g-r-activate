import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { mergeActivity } from "./activity";

describe("mergeActivity()", () => {
  const sources = {
    orders: [{ id: "o1", reference: "ORD-2026-00001", created_at: "2026-09-01T10:00:00Z" }],
    history: [
      {
        id: 7,
        order_id: "o1",
        to_status: "arrived_us_warehouse",
        changed_at: "2026-09-05T10:00:00Z",
        customer_message: "  ",
        order: { reference: "ORD-2026-00001" },
      },
    ],
    invoices: [
      {
        id: "i1",
        invoice_number: "INV-2026-0001",
        issued_at: "2026-09-06T10:00:00Z",
        cancelled_at: null,
        total_amount: 45,
        currency: "USD" as const,
      },
      {
        id: "i0",
        invoice_number: "INV-2026-0000",
        issued_at: "2026-09-02T10:00:00Z",
        cancelled_at: "2026-09-03T10:00:00Z",
        total_amount: 10,
        currency: "SRD" as const,
      },
    ],
    payments: [
      {
        id: "p1",
        amount: 45,
        paid_on: "2026-09-07",
        created_at: "2026-09-07T15:00:00Z",
        invoice: { invoice_number: "INV-2026-0001", currency: "USD" as const },
      },
    ],
  };

  it("merges all sources newest first", () => {
    expect(mergeActivity(sources).map((a) => a.kind)).toEqual([
      "payment_received",
      "invoice_issued",
      "status_changed",
      "invoice_cancelled",
      "invoice_issued",
      "order_registered",
    ]);
  });

  it("carries what the dashboard shows", () => {
    const [payment, , status] = mergeActivity(sources);
    expect(payment).toMatchObject({
      amount: 45,
      currency: "USD",
      invoiceNumber: "INV-2026-0001",
      paidOn: "2026-09-07",
    });
    expect(status).toMatchObject({
      reference: "ORD-2026-00001",
      status: "arrived_us_warehouse",
      message: null,
    });
  });

  it("keeps only the newest items", () => {
    expect(mergeActivity(sources, 2).map((a) => a.key)).toEqual(["p:p1", "i:i1"]);
  });

  it("lists an invoice found by both invoice queries once, and dates a cancellation by cancelled_at", () => {
    const oldInvoice = {
      id: "i9",
      invoice_number: "INV-2025-0099",
      issued_at: "2025-01-02T10:00:00Z",
      cancelled_at: "2026-09-08T10:00:00Z",
      total_amount: 20,
      currency: "EUR" as const,
    };
    const items = mergeActivity(
      {
        ...sources,
        invoices: [...sources.invoices, oldInvoice, sources.invoices[1]!, oldInvoice],
      },
      20,
    );
    expect(items[0]).toMatchObject({ kind: "invoice_cancelled", key: "ic:i9" });
    const keys = items.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => k.endsWith(":i0"))).toEqual(["ic:i0", "i:i0"]);
  });

  it("is empty without data", () => {
    expect(mergeActivity({ orders: [], history: [], invoices: [], payments: [] })).toEqual([]);
  });
});
