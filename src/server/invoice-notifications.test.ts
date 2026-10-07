import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb } from "@/test/fake-supabase";

import type { SendEmailInput, SendEmailResult } from "./email";

const sent = vi.hoisted(() => ({
  calls: [] as SendEmailInput[],
  next: null as null | ((input: SendEmailInput) => SendEmailResult),
}));
vi.mock("@/server/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./email")>()),
  sendEmail: vi.fn(async (input: SendEmailInput) => {
    sent.calls.push(input);
    return sent.next
      ? sent.next(input)
      : { status: "sent", logId: "l1", providerMessageId: "re_1" };
  }),
}));

const { onInvoiceIssued, onPaymentRecorded } = await import("./invoice-notifications");

const APP = "https://app.example.com";
const INVOICE = "f0000000-0000-4000-8000-000000000001";
const ALICE = "c0000000-0000-4000-8000-000000000001";
const BOB = "c0000000-0000-4000-8000-000000000002";
const O1 = "a0000000-0000-4000-8000-000000000001";

/** Issued with snapshots that differ from today's settings on purpose. */
const issuer = {
  version: 1,
  company_name: "G&R SOLUTIONS N.V.",
  tagline: "CUSTOMS BROKERAGE & LOGISTICS",
  email: "facturen@grsolutions.sr",
  phone: "5978897500",
  address: "kwattaweg #22",
  invoice_title: "INVOICE (inclusief BTW)",
  footer_text: "G&R SOLUTIONS N.V.  |  CUSTOMS BROKERAGE & LOGISTICS",
  payment_terms_text: "Betaal binnen 1 week; daarna 12,5% opslag.",
  payment_term_days: 7,
  late_fee_percent: 12.5,
  vat_rate_percent: null,
  show_vat_breakdown: false,
  paper_size: "Letter",
  bank_accounts: [
    {
      currency: "USD",
      bank_name: "DSB",
      account_holder: "G&R Solutions N.V.",
      account_number: "1234567",
    },
  ],
};

function invoiceRow(customerId: string, extra: Record<string, unknown> = {}) {
  return {
    id: INVOICE,
    customer_id: customerId,
    invoice_number: "INV-2026-0007",
    status: "open",
    currency: "USD",
    invoice_date: "2026-10-01",
    due_date: "2026-10-08",
    customer_note: "Met dank voor uw vertrouwen",
    paid_at: null,
    total_lbs: 10,
    subtotal_freight: 45,
    total_charges: 55,
    total_discount: 0,
    total_amount: 55,
    vat_rate: null,
    vat_amount: null,
    issuer_snapshot: issuer,
    bill_to_snapshot: {
      version: 1,
      customer_id: customerId,
      customer_code: "GR00042",
      full_name: "Alice Jansen",
      email: "alice@example.com",
      orders: [
        {
          id: O1,
          reference: "ORD-2026-00012",
          tracking_number: "1Z999",
          store_vendor: "Amazon",
          vendor_order_number: "112-1",
        },
      ],
    },
    amount_paid: 0,
    balance_due: 55,
    is_overdue: false,
    days_overdue: 0,
    late_fee_applied_at: null,
    reminder_count: 0,
    first_reminder_sent_at: null,
    last_reminder_sent_at: null,
    ...extra,
  };
}

function tables(customerId = ALICE, extra: Record<string, unknown> = {}) {
  return {
    company_settings: [{ company_name: "VANDAAG ANDERS N.V.", email: "nu@example.com" }],
    customers: [
      {
        id: ALICE,
        full_name: "Alice Jansen",
        customer_code: "GR00042",
        email: "alice.new@example.com",
        phone: null,
        user_id: "u-a",
        status: "active",
      },
      {
        id: BOB,
        full_name: "Bob Bakker",
        customer_code: "GR00017",
        email: "bob@example.com",
        phone: null,
        user_id: null,
        status: "active",
      },
    ],
    invitations: [],
    invoice_overview: [invoiceRow(customerId, extra)],
    invoice_items: [
      {
        id: "l1",
        invoice_id: INVOICE,
        line_type: "freight",
        description: "Amazon – order 112-1",
        order_id: O1,
        weight_lbs: 10,
        rate_per_lb: 4.5,
        amount: 45,
        vat_exempt: false,
        sort_order: 0,
      },
      {
        id: "l2",
        invoice_id: INVOICE,
        line_type: "customs",
        description: "Douane",
        order_id: null,
        weight_lbs: null,
        rate_per_lb: null,
        amount: 10,
        vat_exempt: true,
        sort_order: 1,
      },
    ],
  };
}

beforeEach(() => {
  sent.calls = [];
  sent.next = null;
  vi.stubEnv("APP_URL", APP);
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "G&R <noreply@example.com>");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('onInvoiceIssued ("factuur aangemaakt")', () => {
  it("e-mails the invoice once, from its snapshots, to the customer's current address", async () => {
    const result = await onInvoiceIssued({
      db: fakeDb(tables()),
      invoiceId: INVOICE,
      invoiceNumber: "INV-2026-0007",
      customerId: ALICE,
      userId: "staff-1",
    });
    expect(result).toEqual({ email: "sent" });
    const mail = sent.calls[0]!;
    expect(mail).toMatchObject({
      kind: "invoice_issued",
      to: "alice.new@example.com",
      idempotencyKey: `invoice:${INVOICE}:invoice_issued:1`,
      invoiceId: INVOICE,
      customerId: ALICE,
      replyTo: "facturen@grsolutions.sr",
      subject: "Factuur INV-2026-0007 van G&R SOLUTIONS N.V.",
    });
    // The snapshot's company, never today's settings.
    expect(mail.html).not.toContain("VANDAAG ANDERS");
    expect(mail.text).toContain("Invoicenummer: INV-2026-0007");
    expect(mail.text).toContain("Vervaldatum: 08-10-2026");
    expect(mail.text).toContain("Totaal prijs: USD 55,00");
    expect(mail.text).toContain("Amazon – order 112-1");
    expect(mail.text).toContain("Inklaringskosten / douane");
    expect(mail.text).toContain("Rekeningnummer: 1234567");
    expect(mail.text).toContain(
      "Factuurvaluta: USD · Vermeld bij betaling: INV-2026-0007 / GR00042",
    );
    expect(mail.text).toContain("Betaal binnen 1 week; daarna 12,5% opslag.");
    expect(mail.text).toContain("Met dank voor uw vertrouwen");
    expect(mail.html).toContain(`href="${APP}/portal/facturen/${INVOICE}"`);
  });

  it("no /portal link for a customer without a login", async () => {
    await onInvoiceIssued({
      db: fakeDb(tables(BOB)),
      invoiceId: INVOICE,
      invoiceNumber: "INV-2026-0007",
      customerId: BOB,
      userId: "staff-1",
    });
    expect(sent.calls[0]!.html).not.toContain(`${APP}/portal`);
    expect(sent.calls[0]!.text).toContain("Rekeningnummer: 1234567");
  });
});

describe('onPaymentRecorded ("betaling ontvangen")', () => {
  it("a part payment e-mails nothing", async () => {
    const db = fakeDb(tables());
    expect(
      await onPaymentRecorded({
        db,
        invoiceId: INVOICE,
        paymentId: "p1",
        action: "record",
        invoiceStatus: "partially_paid",
        userId: "staff-1",
      }),
    ).toEqual({ email: null });
    expect(sent.calls).toHaveLength(0);
    expect(db.queries).toEqual([]);
  });

  it("the payment that settles the invoice sends one confirmation per invoice", async () => {
    const db = fakeDb(
      tables(ALICE, {
        status: "paid",
        paid_at: "2026-10-07T14:00:00Z",
        amount_paid: 55,
        balance_due: 0,
      }),
    );
    const result = await onPaymentRecorded({
      db,
      invoiceId: INVOICE,
      paymentId: "p2",
      action: "mark_paid",
      invoiceStatus: "paid",
      userId: "staff-1",
    });
    expect(result).toEqual({ email: "sent" });
    expect(sent.calls[0]).toMatchObject({
      kind: "payment_received",
      idempotencyKey: `invoice:${INVOICE}:payment_received:1`,
      subject: "Betaling ontvangen: factuur INV-2026-0007",
    });
    expect(sent.calls[0]!.text).toContain("Betaald op: 07-10-2026");
    expect(sent.calls[0]!.text).toContain("Ontvangen: USD 55,00");
  });
});
