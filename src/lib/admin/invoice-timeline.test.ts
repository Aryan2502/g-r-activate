import { describe, expect, it } from "vitest";

import type { InvoicePayment } from "./invoice-queries";
import { buildInvoiceTimeline } from "./invoice-timeline";

const payment = (over: Partial<InvoicePayment>): InvoicePayment => ({
  id: "p1",
  invoice_id: "i1",
  amount: 20,
  paid_on: "2026-09-18",
  method: "cash",
  reference: null,
  received_amount: null,
  received_currency: null,
  customer_note: null,
  recorded_by: "staff-1",
  created_at: "2026-09-18T14:00:00Z",
  voided_at: null,
  voided_by: null,
  void_reason: null,
  ...over,
});

const invoice = {
  id: "i1",
  created_at: "2026-09-15T12:00:00Z",
  created_by: "staff-1",
  issued_at: "2026-09-15T13:00:00Z",
  issued_by: "staff-2",
  paid_at: null,
  cancelled_at: null,
  cancelled_by: null,
  cancel_reason: null,
  late_fee_applied_at: null,
};

describe("buildInvoiceTimeline()", () => {
  it("tells the invoice's story oldest first, with who did what", () => {
    const events = buildInvoiceTimeline(
      {
        ...invoice,
        late_fee_applied_at: "2026-09-30T12:00:00Z",
        paid_at: "2026-10-01T15:00:00Z",
      },
      [
        payment({ id: "p2", created_at: "2026-10-01T15:00:00Z", amount: 30 }),
        payment({
          id: "p1",
          voided_at: "2026-09-20T10:00:00Z",
          voided_by: "admin-1",
          void_reason: "Dubbel geboekt",
        }),
      ],
    );
    expect(events.map((e) => [e.kind, e.actorId])).toEqual([
      ["created", "staff-1"],
      ["issued", "staff-2"],
      ["payment_recorded", "staff-1"],
      ["payment_voided", "admin-1"],
      ["late_fee", null],
      // The payment that settled it comes before "Volledig betaald" at the same instant.
      ["payment_recorded", "staff-1"],
      ["paid", null],
    ]);
    expect(events[3]).toMatchObject({ reason: "Dubbel geboekt", payment: { id: "p1" } });
  });

  it("ends a cancelled invoice with who cancelled it and why", () => {
    const events = buildInvoiceTimeline(
      {
        ...invoice,
        cancelled_at: "2026-09-16T09:00:00Z",
        cancelled_by: "admin-1",
        cancel_reason: "Verkeerde klant",
      },
      [],
    );
    expect(events.at(-1)).toMatchObject({
      kind: "cancelled",
      actorId: "admin-1",
      reason: "Verkeerde klant",
    });
  });

  it("leaves out what the row does not record", () => {
    expect(
      buildInvoiceTimeline({ ...invoice, created_at: null, created_by: null }, []).map(
        (e) => e.kind,
      ),
    ).toEqual(["issued"]);
  });
});
