import { describe, expect, it, vi } from "vitest";

import { t } from "@/lib/i18n";

import {
  applyLateFee,
  cancelInvoice,
  cancelInvoiceInputSchema,
  canApplyLateFee,
  initialPaymentForm,
  invoiceShareText,
  lateFeePreview,
  markInvoicePaid,
  markPaidInputSchema,
  portalInvoiceLink,
  recordPayment,
  recordPaymentInputSchema,
  validatePaymentForm,
  validateReason,
  voidPayment,
  voidPaymentInputSchema,
  type InvoiceShareInput,
  type PaymentFormValues,
} from "./invoice-actions";

const INVOICE = "b0000000-0000-4000-8000-000000000001";
const PAYMENT = "a0000000-0000-4000-8000-000000000001";
const TODAY = "2026-10-07";

describe("server input schemas", () => {
  it("a payment: an amount > 0 with at most 2 decimals; the received amount with its currency or neither", () => {
    const base = { invoiceId: INVOICE, paidOn: TODAY, method: "cash", amount: 12.5 } as const;
    expect(recordPaymentInputSchema.parse(base)).toEqual({
      ...base,
      reference: null,
      customerNote: null,
      receivedAmount: null,
      receivedCurrency: null,
    });
    expect(recordPaymentInputSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(recordPaymentInputSchema.safeParse({ ...base, amount: 1.005 }).success).toBe(false);
    expect(recordPaymentInputSchema.safeParse({ ...base, paidOn: "2026-02-30" }).success).toBe(
      false,
    );
    expect(recordPaymentInputSchema.safeParse({ ...base, method: "card" }).success).toBe(false);
    expect(recordPaymentInputSchema.safeParse({ ...base, receivedAmount: 900 }).success).toBe(
      false,
    );
    expect(
      recordPaymentInputSchema.parse({
        ...base,
        receivedAmount: 900,
        receivedCurrency: "SRD",
        reference: "  ",
      }),
    ).toMatchObject({ receivedAmount: 900, receivedCurrency: "SRD", reference: null });
  });

  it("'Markeer als betaald' carries the confirmed balance; reasons are required (≤ 500)", () => {
    expect(
      markPaidInputSchema.parse({
        invoiceId: INVOICE,
        paidOn: TODAY,
        method: "bank_transfer",
        amount: 45.15,
      }),
    ).toMatchObject({ amount: 45.15 });
    expect(
      markPaidInputSchema.safeParse({ invoiceId: INVOICE, paidOn: TODAY, method: "bank_transfer" })
        .success,
    ).toBe(false);
    expect(voidPaymentInputSchema.safeParse({ paymentId: PAYMENT, reason: " " }).success).toBe(
      false,
    );
    expect(
      cancelInvoiceInputSchema.safeParse({ invoiceId: INVOICE, reason: "x".repeat(501) }).success,
    ).toBe(false);
    expect(cancelInvoiceInputSchema.parse({ invoiceId: INVOICE, reason: " Fout " })).toEqual({
      invoiceId: INVOICE,
      reason: "Fout",
    });
  });
});

describe("the RPC calls", () => {
  const row = { payment_id: PAYMENT, invoice_status: "paid", amount_paid: 50, balance_due: 0 };
  const client = (data: unknown) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    return { rpc } as unknown as Parameters<typeof recordPayment>[0] & { rpc: typeof rpc };
  };

  it("record_payment gets the amount; optional fields only when filled", async () => {
    const c = client([row]);
    await expect(
      recordPayment(c, {
        invoiceId: INVOICE,
        amount: 50,
        paidOn: TODAY,
        method: "cash",
        reference: null,
        customerNote: "Dank u",
        receivedAmount: 1800,
        receivedCurrency: "SRD",
      }),
    ).resolves.toEqual({
      paymentId: PAYMENT,
      invoiceStatus: "paid",
      amountPaid: 50,
      balanceDue: 0,
    });
    expect(c.rpc).toHaveBeenCalledWith("record_payment", {
      _invoice_id: INVOICE,
      _amount: 50,
      _paid_on: TODAY,
      _method: "cash",
      _received_amount: 1800,
      _received_currency: "SRD",
      _customer_note: "Dank u",
    });
  });

  it("'Markeer als betaald' sends the balance the staff member confirmed as the amount", async () => {
    const c = client([row]);
    await markInvoicePaid(c, {
      invoiceId: INVOICE,
      paidOn: TODAY,
      method: "bank_transfer",
      reference: "TRX-1",
      customerNote: null,
      amount: 45.15,
    });
    const args = c.rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args).toMatchObject({ _invoice_id: INVOICE, _reference: "TRX-1", _amount: 45.15 });
  });

  it("void, cancel and late fee pass their arguments and unwrap the row", async () => {
    const v = client([{ ...row, invoice_status: "open", amount_paid: 0, balance_due: 50 }]);
    await expect(voidPayment(v, { paymentId: PAYMENT, reason: "Dubbel" })).resolves.toMatchObject({
      invoiceStatus: "open",
      balanceDue: 50,
    });
    expect(v.rpc).toHaveBeenCalledWith("void_payment", { _payment_id: PAYMENT, _reason: "Dubbel" });

    const c = client({ id: INVOICE, invoice_number: "INV-2026-0001", customer_id: "c1" });
    await expect(cancelInvoice(c, { invoiceId: INVOICE, reason: "Fout" })).resolves.toEqual({
      invoiceId: INVOICE,
      invoiceNumber: "INV-2026-0001",
      customerId: "c1",
    });

    const l = client({ id: INVOICE, total_amount: "51.75" });
    await expect(applyLateFee(l, { invoiceId: INVOICE })).resolves.toEqual({
      invoiceId: INVOICE,
      totalAmount: 51.75,
    });
  });

  it("throws the database error as is (its Dutch message and SQLSTATE)", async () => {
    const error = { code: "22023", message: "Het bedrag is hoger dan het openstaande saldo" };
    const c = {
      rpc: vi.fn().mockResolvedValue({ data: null, error }),
    } as unknown as Parameters<typeof recordPayment>[0];
    await expect(voidPayment(c, { paymentId: PAYMENT, reason: "x" })).rejects.toBe(error);
  });
});

describe("validatePaymentForm()", () => {
  const form = (over: Partial<PaymentFormValues> = {}): PaymentFormValues => ({
    ...initialPaymentForm({ balance: 45.15, today: TODAY }),
    ...over,
  });
  const ctx = {
    invoiceId: INVOICE,
    balance: 45.15,
    currency: "USD" as const,
    mode: "amount" as const,
    today: TODAY,
  };

  it("starts with the full balance, today and bank transfer", () => {
    expect(form()).toMatchObject({ amount: "45,15", paidOn: TODAY, method: "bank_transfer" });
    expect(initialPaymentForm({ balance: 0, today: TODAY }).amount).toBe("");
  });

  it("accepts Dutch amounts and builds both payloads", () => {
    const result = validatePaymentForm(
      form({ amount: "20,5", reference: " TRX ", receivedAmount: "740", receivedCurrency: "SRD" }),
      ctx,
    );
    expect(result).toEqual({
      ok: true,
      record: {
        invoiceId: INVOICE,
        paidOn: TODAY,
        method: "bank_transfer",
        reference: "TRX",
        customerNote: null,
        amount: 20.5,
        receivedAmount: 740,
        receivedCurrency: "SRD",
      },
      markPaid: {
        invoiceId: INVOICE,
        paidOn: TODAY,
        method: "bank_transfer",
        reference: "TRX",
        customerNote: null,
        amount: 45.15,
      },
    });
  });

  it("reads Dutch thousands, but refuses '1.250' (1250 or 1,25?) instead of guessing", () => {
    const big = { ...ctx, balance: 2_000_000 };
    const amountOf = (text: string) => {
      const r = validatePaymentForm(form({ amount: text }), big);
      return r.ok ? r.record.amount : (r.errors.amount ?? null);
    };
    expect(amountOf("1250")).toBe(1250);
    expect(amountOf("1250,5")).toBe(1250.5);
    expect(amountOf("1250.50")).toBe(1250.5);
    expect(amountOf("1.250,00")).toBe(1250);
    expect(amountOf("1.250.000")).toBe(1_250_000);
    expect(amountOf("1,250.50")).toBe(1250.5);
    expect(amountOf("1.250")).toBe(
      t("admin.invoices.payment.validation.ambiguous", {
        thousands: "USD 1.250,00",
        plain: "1250",
      }),
    );
    expect(amountOf("1.000")).toBe(
      t("admin.invoices.payment.validation.ambiguous", {
        thousands: "USD 1.000,00",
        plain: "1000",
      }),
    );
    expect(amountOf("12,345")).toBe(t("admin.invoices.payment.validation.amount"));
    expect(amountOf("1.25.0")).toBe(t("admin.invoices.payment.validation.amount"));
  });

  it("shows every error at once", () => {
    const result = validatePaymentForm(
      form({
        amount: "45,16",
        paidOn: "2026-10-08",
        reference: "x".repeat(201),
        receivedAmount: "12,345",
      }),
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toEqual({
      amount: t("admin.invoices.payment.validation.overBalance", { balance: "USD 45,15" }),
      paidOn: t("admin.invoices.payment.validation.dateFuture"),
      reference: t("admin.invoices.validation.tooLong", { max: 200 }),
      receivedAmount: t("admin.invoices.payment.validation.amount"),
    });
  });

  it("the received amount needs a currency and the currency an amount", () => {
    const noCurrency = validatePaymentForm(form({ receivedAmount: "10" }), ctx);
    expect(!noCurrency.ok && noCurrency.errors.receivedCurrency).toBe(
      t("admin.invoices.payment.validation.receivedCurrency"),
    );
    const noAmount = validatePaymentForm(form({ receivedCurrency: "EUR" }), ctx);
    expect(!noAmount.ok && noAmount.errors.receivedAmount).toBe(
      t("admin.invoices.payment.validation.receivedAmount"),
    );
  });

  it("'Markeer als betaald' ignores the amount fields", () => {
    const result = validatePaymentForm(form({ amount: "", receivedAmount: "x" }), {
      ...ctx,
      mode: "full",
    });
    expect(result.ok).toBe(true);
  });

  it("an empty or zero amount is refused", () => {
    expect(validatePaymentForm(form({ amount: "" }), ctx)).toMatchObject({
      ok: false,
      errors: { amount: t("admin.invoices.payment.validation.amountRequired") },
    });
    expect(validatePaymentForm(form({ amount: "0" }), ctx)).toMatchObject({
      ok: false,
      errors: { amount: t("admin.invoices.payment.validation.amount") },
    });
  });
});

describe("validateReason()", () => {
  it("requires 1–500 characters after trimming", () => {
    expect(validateReason("  ")).toBe(t("admin.invoices.validation.reasonRequired"));
    expect(validateReason("x".repeat(501))).toBe(
      t("admin.invoices.validation.tooLong", { max: 500 }),
    );
    expect(validateReason(" Verkeerd gewicht ")).toBeNull();
  });
});

describe("late fee", () => {
  const overdue = {
    status: "open" as const,
    is_overdue: true,
    late_fee_applied_at: null,
    balance_due: 45.15,
    total_amount: 45.15,
  };

  it("is offered only when overdue, not applied yet, with a positive percentage", () => {
    expect(canApplyLateFee(overdue, 15, false)).toBe(true);
    expect(canApplyLateFee({ ...overdue, is_overdue: false }, 15, false)).toBe(false);
    expect(canApplyLateFee({ ...overdue, late_fee_applied_at: "2026-10-01" }, 15, false)).toBe(
      false,
    );
    expect(canApplyLateFee(overdue, 15, true)).toBe(false);
    expect(canApplyLateFee(overdue, 0, false)).toBe(false);
    expect(canApplyLateFee({ ...overdue, status: "paid" }, 15, false)).toBe(false);
  });

  it("previews round(balance × % / 100, 2) half-up and the new totals", () => {
    // 45,15 × 15% = 6,7725 → 6,77
    expect(lateFeePreview(overdue, 15)).toEqual({ fee: 6.77, newTotal: 51.92, newBalance: 51.92 });
    // 10,10 × 12,5% = 1,2625 → 1,26 ; 0,10 × 15% = 0,015 → 0,02 (half-up)
    expect(lateFeePreview({ balance_due: 10.1, total_amount: 30 }, 12.5).fee).toBe(1.26);
    expect(lateFeePreview({ balance_due: 0.1, total_amount: 0.1 }, 15).fee).toBe(0.02);
  });
});

describe("'Deel via WhatsApp'", () => {
  const base: InvoiceShareInput = {
    customerName: "Maria Pinas",
    customerCode: "GR00042",
    companyName: "G&R SOLUTIONS N.V.",
    invoiceNumber: "INV-2026-0013",
    currency: "USD",
    total: 51.75,
    balance: 51.75,
    amountPaid: 0,
    dueDate: "2026-10-14",
    status: "open",
    isOverdue: false,
    paidAt: null,
    bank: {
      currency: "USD",
      bankName: "DSB",
      accountHolder: "G&R Solutions N.V.",
      accountNumber: "1234567",
    },
    portalUrl: "https://app.example.com/portal/facturen/b1",
  };

  it("names the amount, due date, payment instruction, account and the portal link", () => {
    const text = invoiceShareText(base);
    expect(text).toContain("Beste Maria,");
    expect(text).toContain("Hierbij uw factuur INV-2026-0013 van G&R SOLUTIONS N.V.\n");
    expect(text).toContain("Te betalen: USD 51,75, uiterlijk 14-10-2026.");
    expect(text).toContain("Factuurvaluta: USD · Vermeld bij betaling: INV-2026-0013 / GR00042");
    expect(text).toContain("Rekeningnummer: 1234567 (DSB)");
    expect(text).toContain("Ten name van: G&R Solutions N.V.");
    expect(text).toContain("https://app.example.com/portal/facturen/b1");
  });

  it("without a login there is no portal link; overdue and partial payments are said", () => {
    const text = invoiceShareText({
      ...base,
      portalUrl: null,
      isOverdue: true,
      amountPaid: 20,
      balance: 31.75,
      status: "partially_paid",
      bank: null,
    });
    expect(text).not.toContain("/portal");
    expect(text).toContain(t("admin.invoices.share.noPortal"));
    expect(text).toContain("Al betaald: USD 20,00");
    expect(text).toContain("Nog te betalen: USD 31,75. De vervaldatum (14-10-2026) is verstreken");
    expect(text).not.toContain("Rekeningnummer");
  });

  it("a paid invoice thanks the customer instead of asking for payment", () => {
    const text = invoiceShareText({
      ...base,
      status: "paid",
      balance: 0,
      amountPaid: 51.75,
      paidAt: "2026-10-10T15:00:00Z",
    });
    expect(text).toContain("Deze factuur is op 10-10-2026 volledig betaald.");
    expect(text).not.toContain("Vermeld bij betaling");
  });

  it("portalInvoiceLink() joins the base and the id", () => {
    expect(portalInvoiceLink("https://app.example.com/", "b1")).toBe(
      "https://app.example.com/portal/facturen/b1",
    );
  });
});
