import { describe, expect, it } from "vitest";

import { fromIssuedInvoice } from "@/lib/invoice/model";

import { invitationEmail, welcomeEmail } from "./accounts";
import { invoiceIssuedEmail, paymentReceivedEmail, paymentReminderEmail } from "./invoices";
import { escapeHtml, renderEmail, type EmailBrand } from "./layout";
import { orderConfirmationEmail, statusUpdateEmail } from "./orders";

const APP = "https://portal.example.com";
const brand: EmailBrand = {
  appUrl: APP,
  companyName: "G&R SOLUTIONS N.V.",
  tagline: "CUSTOMS BROKERAGE & LOGISTICS",
  email: "info@grsolutions.sr",
  phone: "5978897500",
  address: "kwattaweg #22",
};
const EVIL = `<img src=x onerror="alert(1)">&'"`;

/** Every href in the HTML. */
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

describe("layout", () => {
  it("escapes every piece of text and keeps links on APP_URL", () => {
    const mail = renderEmail({
      brand: { ...brand, companyName: EVIL },
      subject: `Order ${EVIL}\r\nBcc: x@y.z`,
      preheader: EVIL,
      title: EVIL,
      blocks: [
        { type: "paragraph", text: EVIL },
        { type: "details", rows: [[EVIL, EVIL]] },
        { type: "message", title: EVIL, text: `${EVIL}\nregel 2` },
        { type: "table", head: [EVIL], rows: [[EVIL]], total: [EVIL] },
        { type: "address", title: EVIL, lines: [EVIL] },
        { type: "list", items: [EVIL] },
        { type: "button", label: EVIL, href: `${APP}/portal` },
      ],
      reason: EVIL,
    });
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).not.toContain('onerror="');
    expect(mail.html).toContain(escapeHtml(EVIL));
    expect(mail.html).toContain("regel 2");
    // One line, no header injection.
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.html).toContain(`src="${APP}/brand/gr-logo-banner.jpg"`);
    expect(hrefs(mail.html)).toEqual([`${APP}/portal`]);
    // The text version carries the same content, unescaped.
    expect(mail.text).toContain(EVIL);
    expect(mail.text).toContain(`${APP}/portal`);
  });

  it("refuses a link that does not start with APP_URL", () => {
    for (const href of [
      "https://evil.example.com/portal",
      `${APP}.evil.com/x`,
      "javascript:alert(1)",
    ]) {
      expect(() =>
        renderEmail({
          brand,
          subject: "x",
          preheader: "x",
          title: "x",
          blocks: [{ type: "button", label: "x", href }],
          reason: "x",
        }),
      ).toThrow(/APP_URL/);
    }
  });
});

describe("account e-mails", () => {
  it("uitnodiging: a personal link, the code, the login address and the validity", () => {
    const mail = invitationEmail({
      brand,
      kind: "customer",
      fullName: "Alice Jansen",
      customerCode: "GR00042",
      staffRole: null,
      email: "alice@example.com",
      link: `${APP}/invite/abc`,
      expiresAt: "2026-10-14T12:00:00Z",
      resend: false,
    });
    expect(mail.subject).toBe("Uw uitnodiging voor het klantportaal van G&R SOLUTIONS N.V.");
    expect(hrefs(mail.html)).toEqual([`${APP}/invite/abc`, `${APP}/invite/abc`]);
    expect(mail.text).toContain("Beste Alice,");
    expect(mail.text).toContain("GR00042");
    expect(mail.text).toContain("alice@example.com");
    expect(mail.text).toContain("geldig tot 14-10-2026");
  });

  it("uitnodiging voor het team: never greets a team member as a customer (review P8)", () => {
    // resendInvitationFn passes no name; inviteStaffFn only the optional one.
    const mail = invitationEmail({
      brand,
      kind: "staff",
      fullName: null,
      customerCode: null,
      staffRole: "staff",
      email: "sam@grsolutions.sr",
      link: `${APP}/invite/abc`,
      expiresAt: "2026-10-14T12:00:00Z",
      resend: true,
    });
    expect(mail.text).not.toContain("Beste klant,");
    expect(mail.text).toContain("Goedendag,");
    // The company name ends in "N.V.": one full stop, not two.
    expect(mail.text).toContain("het beheersysteem van G&R SOLUTIONS N.V.\n");
    expect(mail.text).not.toContain("N.V..");
    const named = invitationEmail({
      brand,
      kind: "staff",
      fullName: "Sam de Vries",
      customerCode: null,
      staffRole: "admin",
      email: "sam@grsolutions.sr",
      link: `${APP}/invite/abc`,
      expiresAt: "2026-10-14T12:00:00Z",
      resend: false,
    });
    expect(named.text).toContain("Beste Sam,");
  });

  it("welkom: the personal US address and the code rule", () => {
    const mail = welcomeEmail({
      brand,
      kind: "customer",
      fullName: "Alice Jansen",
      customerCode: "GR00042",
      email: "alice@example.com",
      addresses: [
        { title: "Miami (Luchtvracht)", lines: ["Alice Jansen GR00042", "8000 NW 25th St"] },
      ],
    });
    expect(mail.html).toContain("Uw persoonlijk US-verzendadres");
    expect(mail.text).toContain("UW PERSOONLIJK US-VERZENDADRES");
    expect(mail.text).toContain("Alice Jansen GR00042\n8000 NW 25th St");
    expect(mail.text).toContain(
      "Zet altijd uw klantcode GR00042 achter uw naam én op adresregel 2.",
    );
  });
});

describe("order e-mails", () => {
  const customer = { fullName: "Bob Bakker", customerCode: "GR00017", email: "bob@example.com" };
  const order = {
    id: "o1",
    reference: "ORD-2026-00014",
    orderType: "personal",
    serviceType: "air",
    storeVendor: EVIL,
    vendorOrderNumber: null,
    description: null,
    trackingNumber: null,
    carrier: null,
    declaredWeightLbs: null,
    expectedDeliveryDate: null,
    parentReference: null,
  };

  it("order bevestigd without a login: details, no /portal link, the tracking request by reply", () => {
    const mail = orderConfirmationEmail({
      brand,
      customer,
      access: { login: false, invitationOpen: false },
      createdBy: "staff",
      order,
    });
    expect(hrefs(mail.html)).toEqual([]);
    expect(mail.text).toContain("Trackingnummer: Nog niet bekend");
    expect(mail.text).toContain("als antwoord op deze e-mail");
    expect(mail.text).not.toContain("uitnodiging");
    expect(mail.html).not.toContain("<img src=x");
  });

  it("statusupdate with a login links the order", () => {
    const mail = statusUpdateEmail({
      brand,
      customer,
      access: { login: true },
      status: { label: "Onderweg", description: null, stage: "in_transit" },
      orders: [
        {
          id: "o1",
          reference: "ORD-2026-00014",
          storeVendor: "eBay",
          trackingNumber: "1Z",
          description: null,
        },
      ],
      message: null,
      pickup: null,
    });
    expect(mail.subject).toBe("Order ORD-2026-00014: Onderweg");
    expect(hrefs(mail.html)).toEqual([`${APP}/portal/orders/o1`]);
  });
});

describe("invoice e-mails (from the snapshots)", () => {
  const model = fromIssuedInvoice(
    {
      id: "i1",
      invoice_number: "INV-2026-0003",
      status: "open",
      currency: "SRD",
      invoice_date: "2026-09-20",
      due_date: "2026-09-27",
      customer_note: null,
      paid_at: null,
      total_lbs: 0,
      subtotal_freight: 0,
      total_charges: 1250,
      total_discount: 0,
      total_amount: 1437.5,
      vat_rate: null,
      vat_amount: null,
      issuer_snapshot: {
        company_name: "G&R SOLUTIONS N.V.",
        email: "facturen@grsolutions.sr",
        late_fee_percent: 12.5,
        payment_terms_text: "Binnen 1 week betalen.",
        bank_accounts: [{ currency: "SRD", bank_name: "Hakrinbank", account_number: "20.0001" }],
      },
      bill_to_snapshot: { customer_code: "GR00017", full_name: "Bob Bakker" },
    },
    [
      {
        id: "l1",
        line_type: "customs",
        description: "Douane",
        order_id: null,
        weight_lbs: null,
        rate_per_lb: null,
        amount: 1250,
        vat_exempt: true,
        sort_order: 0,
      },
      {
        id: "l2",
        line_type: "late_fee",
        description: "Opslag te late betaling (12,5%)",
        order_id: null,
        weight_lbs: null,
        rate_per_lb: null,
        amount: 187.5,
        vat_exempt: true,
        sort_order: 1,
      },
    ],
  );
  const base = { appUrl: APP, invoiceId: "i1", model, recipient: "bob@example.com" };

  it("factuur aangemaakt: amounts per the paper, SRD bank account, instruction, no link without login", () => {
    const mail = invoiceIssuedEmail({ ...base, access: { login: false, invitationOpen: true } });
    expect(mail.subject).toBe("Factuur INV-2026-0003 van G&R SOLUTIONS N.V.");
    expect(mail.text).toContain("Totaal prijs SRD 1.437,50");
    expect(mail.text).toContain("Opslag te late betaling (12,5%)");
    expect(mail.text).toContain("Rekeningnummer: 20.0001");
    expect(mail.text).toContain(
      "Factuurvaluta: SRD · Vermeld bij betaling: INV-2026-0003 / GR00017",
    );
    expect(mail.text).toContain("Er staat een uitnodiging voor u klaar");
    expect(hrefs(mail.html)).toEqual([]);
  });

  it("factuur aangemaakt without orders (charges only): amounts under 'Bedrag', one full stop (review P8)", () => {
    const mail = invoiceIssuedEmail({ ...base, access: { login: true } });
    expect(mail.text).toContain(
      "Hierbij ontvangt u factuur INV-2026-0003 van G&R SOLUTIONS N.V.\n",
    );
    expect(mail.text).not.toContain("N.V..");
    expect(mail.text).toContain("- Inklaringskosten / douane · Bedrag: SRD 1.250,00");
    expect(mail.text).not.toMatch(/prijs per lbs: SRD/i);
    expect(mail.html).toContain(">Bedrag</th>");
    expect(mail.html).toContain("te betalen uiterlijk op 27-09-2026");
  });

  it("factuur aangemaakt with freight: weight, price per lb and the line's amount", () => {
    const freight = fromIssuedInvoice(
      {
        id: "i2",
        invoice_number: "INV-2026-0004",
        status: "open",
        currency: "USD",
        invoice_date: "2026-09-20",
        due_date: "2026-09-27",
        customer_note: null,
        paid_at: null,
        total_lbs: 26,
        subtotal_freight: 117,
        total_charges: 0,
        total_discount: 0,
        total_amount: 117,
        vat_rate: null,
        vat_amount: null,
        issuer_snapshot: { company_name: "G&R SOLUTIONS N.V." },
        bill_to_snapshot: { customer_code: "GR00017", full_name: "Bob Bakker" },
      },
      [
        {
          id: "f1",
          line_type: "freight",
          description: "Luchtvracht ORD-2026-00012",
          order_id: "o1",
          weight_lbs: 26,
          rate_per_lb: 4.5,
          amount: 117,
          vat_exempt: true,
          sort_order: 0,
        },
      ],
    );
    const mail = invoiceIssuedEmail({ ...base, model: freight, access: { login: true } });
    expect(mail.text).toMatch(
      /- Luchtvracht ORD-2026-00012 · Gewicht × prijs per lbs: 26,00 lbs × USD 4,50 · Bedrag: USD 117,00/,
    );
    expect(mail.text).not.toContain("N.V..");
  });

  it("betalingsherinnering: the late-fee percentage of the invoice's own terms, applied or not", () => {
    const common = {
      ...base,
      access: { login: true } as const,
      kind: "payment_reminder_overdue" as const,
      amountPaid: 0,
      balanceDue: 1437.5,
      daysOverdue: 10,
    };
    const notApplied = paymentReminderEmail({ ...common, seq: 1, lateFeeApplied: false });
    expect(notApplied.subject).toBe("Betalingsherinnering: factuur INV-2026-0003");
    expect(notApplied.text).toContain(
      "een opslag van 12,5% op het openstaande bedrag in rekening worden gebracht",
    );
    expect(notApplied.text).toContain("Dagen te laat: 10 dagen");
    expect(notApplied.text).toContain("Binnen 1 week betalen.");
    expect(hrefs(notApplied.html)).toEqual([`${APP}/portal/facturen/i1`]);

    const applied = paymentReminderEmail({ ...common, seq: 3, lateFeeApplied: true });
    expect(applied.subject).toBe("3e betalingsherinnering: factuur INV-2026-0003");
    expect(applied.text).toContain(
      "is een opslag van 12,5% op het openstaande bedrag in rekening gebracht",
    );
  });

  it("betaling bijna verschuldigd: friendly, with the due date", () => {
    const mail = paymentReminderEmail({
      ...base,
      access: { login: true },
      kind: "payment_reminder_due_soon",
      seq: 1,
      amountPaid: 437.5,
      balanceDue: 1000,
      daysOverdue: 0,
      lateFeeApplied: false,
    });
    expect(mail.subject).toBe("Herinnering: factuur INV-2026-0003 vervalt op 27-09-2026");
    expect(mail.text).toContain("Al betaald: SRD 437,50");
    expect(mail.text).toContain("Nog te betalen: SRD 1.000,00");
    // "uiterlijk op" like the invoice: paying ON the due date is not late.
    expect(mail.text).toContain("Betaal uiterlijk op 27-09-2026");
    expect(mail.text).not.toContain("vóór");
  });

  it("betaling ontvangen", () => {
    const mail = paymentReceivedEmail({
      ...base,
      access: { login: true },
      amountPaid: 1437.5,
      paidAt: "2026-10-07T14:00:00Z",
    });
    expect(mail.subject).toBe("Betaling ontvangen: factuur INV-2026-0003");
    expect(mail.text).toContain("Betaald op: 07-10-2026");
  });
});
