import { describe, expect, it } from "vitest";

import { onInvoiceIssued, onPaymentRecorded } from "./invoice-notifications";

describe("invoice e-mail hooks (P8)", () => {
  it("onInvoiceIssued sends nothing until P8 and says so (emailed: false)", async () => {
    await expect(
      onInvoiceIssued({
        invoiceId: "b0000000-0000-4000-8000-000000000001",
        invoiceNumber: "INV-2026-0001",
        customerId: "c0c0c0c0-0000-4000-8000-000000000001",
        userId: "99999999-9999-4999-8999-999999999999",
      }),
    ).resolves.toEqual({ emailed: false });
  });

  it("onPaymentRecorded sends nothing until P8, also when the invoice became paid", async () => {
    for (const invoiceStatus of ["partially_paid", "paid"] as const) {
      await expect(
        onPaymentRecorded({
          invoiceId: "b0000000-0000-4000-8000-000000000001",
          paymentId: "a0000000-0000-4000-8000-000000000001",
          action: "record",
          invoiceStatus,
          userId: "99999999-9999-4999-8999-999999999999",
        }),
      ).resolves.toEqual({ emailed: false });
    }
  });
});
