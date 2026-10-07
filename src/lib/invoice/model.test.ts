import { describe, expect, it } from "vitest";

import {
  freightDescription,
  freightDetail,
  fromDraftForm,
  fromIssuedInvoice,
  documentDensity,
  itemPaddingRows,
  itemRows,
  parseBillToSnapshot,
  parseIssuerSnapshot,
  paymentColumns,
  paymentInstruction,
  printTitle,
  referencesText,
  registrationLine,
  statusMark,
  summaryRows,
  type CompanySettingsRow,
  type DraftFormLine,
  type InvoiceItemRow,
  type IssuedInvoiceRow,
} from "./model";

const settings: CompanySettingsRow = {
  id: true,
  company_name: "G&R SOLUTIONS N.V.",
  tagline: "CUSTOMS BROKERAGE & LOGISTICS",
  email: "info@grsolutions.sr",
  phone: "5978897500",
  address: "kwattaweg #22",
  kkf_number: null,
  btw_number: null,
  invoice_title: "INVOICE (inclusief BTW)",
  footer_text: "G&R SOLUTIONS N.V.  |  CUSTOMS BROKERAGE & LOGISTICS",
  payment_terms_text:
    "Deze factuur dient binnen 1 week na factuurdatum volledig te worden betaald.",
  payment_term_days: 7,
  late_fee_percent: 15,
  due_soon_days: 2,
  overdue_reminder_interval_days: 7,
  max_overdue_reminders: 3,
  default_currency: "USD",
  vat_rate_percent: null,
  show_vat_breakdown: false,
  invoice_number_prefix: "INV-",
  paper_size: "Letter",
  public_signup_enabled: true,
  pay_before_pickup: true,
  delivery_available: false,
  max_open_orders_per_customer: 50,
  pickup_address: null,
  pickup_hours: null,
  pickup_instructions: null,
  terms_markdown: null,
  terms_version: "1",
  prohibited_goods_markdown: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  updated_by: null,
};

const banks = [
  {
    currency: "SRD" as const,
    bank_name: "Republic Bank",
    account_holder: null,
    account_number: null,
    is_active: true,
    sort_order: 3,
  },
  {
    currency: "USD" as const,
    bank_name: "Hakrinbank",
    account_holder: "G&R",
    account_number: "20.123.4567",
    is_active: true,
    sort_order: 1,
  },
  {
    currency: "USD" as const,
    bank_name: "Oud",
    account_holder: null,
    account_number: "999",
    is_active: false,
    sort_order: 0,
  },
];

const customer = {
  id: "c1",
  customer_code: "GR00042",
  full_name: "Maria Pinas",
  account_type: "personal" as const,
  company_name: null,
  contact_person: null,
  kkf_number: null,
  address: "Kwattaweg 100",
  district: "Paramaribo",
  email: "maria@example.com",
  phone: "+597 8897500",
};

const freight = (
  key: string,
  weightLbs: number | null,
  ratePerLb: number | null,
): DraftFormLine => ({
  key,
  lineType: "freight",
  description: "Amazon – order 112-1",
  detail: "Tracking: 1Z · Ref: ORD-2026-00001",
  orderId: `o-${key}`,
  weightLbs,
  ratePerLb,
  amount: 12345, // ignored
  vatExempt: false,
});

const form = (lines: DraftFormLine[], note = "") => ({
  currency: "USD" as const,
  invoiceDate: "2026-10-07",
  dueDate: "2026-10-14",
  customerNote: note,
  references: ["ORD-2026-00001", "ORD-2026-00002"],
  lines,
});

describe("fromDraftForm", () => {
  it("renders a draft from live settings, active bank accounts and the live customer", () => {
    const m = fromDraftForm(
      form([freight("a", 12.5, 4.5), freight("b", 3.4, 4.5)]),
      settings,
      banks,
      customer,
    );
    expect(m.status).toEqual({ status: "draft", paidAt: null });
    expect(m.meta.invoiceNumber).toBeNull();
    expect(m.issuer.invoiceTitle).toBe("INVOICE (inclusief BTW)");
    expect(m.issuer.bankAccounts.map((b) => b.bankName)).toEqual(["Hakrinbank", "Republic Bank"]);
    expect(m.billTo.customerCode).toBe("GR00042");
    expect(m.lines.map((l) => l.amount)).toEqual([56.25, 15.3]);
    expect(m.totals.totalAmount).toBe(71.55);
    expect(m.totals.totalLbs).toBe(15.9);
    expect(m.meta.customerNote).toBeNull();
  });

  it("follows the live VAT setting and keeps a whitespace-only note out", () => {
    const m = fromDraftForm(
      form(
        [
          {
            key: "s",
            lineType: "service_fee",
            description: "Service",
            weightLbs: 9,
            ratePerLb: 9,
            amount: 110,
            vatExempt: false,
          },
        ],
        "  ",
      ),
      { ...settings, vat_rate_percent: 10 },
      banks,
      customer,
    );
    expect(m.lines[0]?.weightLbs).toBeNull(); // only freight carries weight and rate
    expect(m.totals.vatAmount).toBe(10);
    expect(m.meta.customerNote).toBeNull();
  });

  it("prints nothing for an unfinished freight line (weight not filled in yet)", () => {
    const m = fromDraftForm(form([freight("a", null, 4.5)]), settings, banks, null);
    expect(m.lines[0]?.amount).toBe(0);
    expect(itemRows(m)[0]?.weight).toBe("");
    expect(m.billTo.fullName).toBe("");
  });
});

const issuerSnapshot = {
  version: 1,
  company_name: "G&R SOLUTIONS N.V.",
  email: "oud@grsolutions.sr",
  phone: "5978897500",
  address: "kwattaweg #22",
  kkf_number: "12345",
  btw_number: null,
  invoice_title: "INVOICE (inclusief BTW)",
  footer_text: "G&R SOLUTIONS N.V.",
  payment_terms_text: "Binnen 1 week.",
  payment_term_days: 7,
  late_fee_percent: 15,
  vat_rate_percent: 10,
  show_vat_breakdown: true,
  paper_size: "A4",
  bank_accounts: [
    { currency: "EUR", bank_name: "DSB", account_holder: null, account_number: "36.00" },
    { currency: "XXX", bank_name: "?" },
    "garbage",
  ],
};
const billToSnapshot = {
  version: 1,
  customer_id: "c1",
  customer_code: "GR00042",
  full_name: "Maria Pinas (toen)",
  account_type: "personal",
  orders: [
    {
      id: "o1",
      reference: "ORD-2026-00012",
      tracking_number: "1Z999",
      store_vendor: "Amazon",
      vendor_order_number: "112-7",
    },
    {
      id: "o2",
      reference: "ORD-2026-00013",
      tracking_number: null,
      store_vendor: "eBay",
      vendor_order_number: null,
    },
    { id: "bad" },
  ],
};

const row: IssuedInvoiceRow = {
  id: "i1",
  invoice_number: "INV-2026-0012",
  status: "paid",
  currency: "USD",
  invoice_date: "2026-10-07",
  due_date: "2026-10-14",
  customer_note: "Dank u!",
  paid_at: "2026-10-09T02:00:00Z", // 8 October in Suriname
  total_lbs: 15.9,
  subtotal_freight: 71.55,
  total_charges: 96.55,
  total_discount: 10,
  total_amount: 86.55,
  vat_rate: 10,
  vat_amount: 6.6,
  issuer_snapshot: issuerSnapshot,
  bill_to_snapshot: billToSnapshot,
};

const items: InvoiceItemRow[] = [
  {
    id: "l3",
    line_type: "discount",
    description: "Korting",
    order_id: null,
    weight_lbs: null,
    rate_per_lb: null,
    amount: -10,
    vat_exempt: false,
    sort_order: 3,
  },
  {
    id: "l1",
    line_type: "freight",
    description: "Amazon – order 112-7",
    order_id: "o1",
    weight_lbs: 12.5,
    rate_per_lb: 4.5,
    amount: 56.25,
    vat_exempt: false,
    sort_order: 0,
  },
  {
    id: "l2",
    line_type: "freight",
    description: "eBay – ORD-2026-00013",
    order_id: "o2",
    weight_lbs: 3.4,
    rate_per_lb: 4.5,
    amount: 15.3,
    vat_exempt: false,
    sort_order: 1,
  },
  {
    id: "l4",
    line_type: "customs",
    description: "Douane",
    order_id: "o1",
    weight_lbs: null,
    rate_per_lb: null,
    amount: 25,
    vat_exempt: true,
    sort_order: 2,
  },
];

describe("fromIssuedInvoice", () => {
  it("renders only from the row, its lines and the snapshots", () => {
    const m = fromIssuedInvoice(row, items);
    expect(m.issuer.email).toBe("oud@grsolutions.sr");
    expect(m.issuer.paperSize).toBe("A4");
    expect(m.issuer.bankAccounts).toEqual([
      { currency: "EUR", bankName: "DSB", accountHolder: null, accountNumber: "36.00" },
    ]);
    expect(m.billTo.fullName).toBe("Maria Pinas (toen)");
    expect(m.meta.references).toEqual(["ORD-2026-00012", "ORD-2026-00013"]);
    expect(m.lines.map((l) => l.key)).toEqual(["l1", "l2", "l4", "l3"]);
    expect(m.lines[0]?.detail).toBe("Tracking: 1Z999 · Ref: ORD-2026-00012");
    expect(m.lines[1]?.detail).toBe("Ref: ORD-2026-00013");
    expect(m.lines[2]?.detail).toBeNull(); // customs lines have no tracking line
    expect(m.totals.totalAmount).toBe(86.55); // stored totals, not recomputed
    expect(m.status).toEqual({ status: "paid", paidAt: "2026-10-09T02:00:00Z" });
  });

  it("accepts snapshots passed separately and survives empty ones", () => {
    const m = fromIssuedInvoice({ ...row, issuer_snapshot: null, bill_to_snapshot: null }, [], {
      issuer: null,
      billTo: null,
    });
    expect(m.issuer.paperSize).toBe("Letter");
    expect(m.issuer.bankAccounts).toEqual([]);
    expect(m.billTo.customerCode).toBe("");
    expect(paymentColumns(m).map((c) => c.accountNumber)).toEqual([
      "________________",
      "________________",
      "________________",
    ]);
  });
});

describe("what the paper prints", () => {
  it("a freight-only invoice has exactly the template's two summary rows", () => {
    const m = fromDraftForm(
      form([freight("a", 12.5, 4.5), freight("b", 3.4, 4.5)]),
      settings,
      banks,
      customer,
    );
    expect(summaryRows(m).map((r) => [r.label, r.weight, r.amount])).toEqual([
      ["Totaal lbs", "15,90 lbs", null],
      ["Totaal prijs", null, "USD 71,55"],
    ]);
    expect(itemRows(m)).toEqual([
      {
        key: "a",
        description: "Amazon – order 112-1",
        detail: "Tracking: 1Z · Ref: ORD-2026-00001",
        weight: "12,50 lbs",
        rate: "USD 4,50",
      },
      {
        key: "b",
        description: "Amazon – order 112-1",
        detail: "Tracking: 1Z · Ref: ORD-2026-00001",
        weight: "3,40 lbs",
        rate: "USD 4,50",
      },
    ]);
  });

  it("other charges print only when non-zero, with Vrachtkosten, Korting and Waarvan BTW", () => {
    const m = fromIssuedInvoice(row, [
      ...items,
      {
        id: "l5",
        line_type: "handling",
        description: "Handling",
        order_id: null,
        weight_lbs: null,
        rate_per_lb: null,
        amount: 0,
        vat_exempt: false,
        sort_order: 4,
      },
      {
        id: "l6",
        line_type: "other",
        description: "Opslag weekend",
        order_id: null,
        weight_lbs: null,
        rate_per_lb: null,
        amount: 5,
        vat_exempt: false,
        sort_order: 5,
      },
      {
        id: "l7",
        line_type: "late_fee",
        description: "Opslag te late betaling (15%)",
        order_id: null,
        weight_lbs: null,
        rate_per_lb: null,
        amount: 2.5,
        vat_exempt: true,
        sort_order: 6,
      },
    ]);
    expect(summaryRows(m).map((r) => `${r.label}|${r.weight ?? ""}|${r.amount ?? ""}`)).toEqual([
      "Totaal lbs|15,90 lbs|",
      "Vrachtkosten||USD 71,55",
      "Inklaringskosten / douane||USD 25,00",
      "Overige kosten: Opslag weekend||USD 5,00",
      "Opslag te late betaling (15%)||USD 2,50",
      "Korting||– USD 10,00",
      "Totaal prijs||USD 86,55",
      "Waarvan BTW (10%)||USD 6,60",
    ]);
  });

  it("no Waarvan BTW without the setting or without a rate", () => {
    const m = fromIssuedInvoice({ ...row, vat_rate: null, vat_amount: null }, items);
    expect(summaryRows(m).some((r) => r.key === "vat")).toBe(false);
  });

  it("payment block: one column per currency, blanks as underscores", () => {
    const m = fromDraftForm(form([]), settings, banks, customer);
    expect(paymentColumns(m)).toEqual([
      {
        currency: "USD",
        label: "USD – Dollar",
        accountNumber: "20.123.4567",
        bankName: "Hakrinbank",
      },
      {
        currency: "EUR",
        label: "EUR – Euro",
        accountNumber: "________________",
        bankName: "________________",
      },
      {
        currency: "SRD",
        label: "SRD",
        accountNumber: "________________",
        bankName: "Republic Bank",
      },
    ]);
  });

  it("payment instruction, title and marks", () => {
    const draft = fromDraftForm(form([]), settings, banks, customer);
    expect(paymentInstruction(draft)).toBe(
      "Factuurvaluta: USD · Vermeld bij betaling: CONCEPT / GR00042",
    );
    const paid = fromIssuedInvoice(row, items);
    expect(paymentInstruction(paid)).toBe(
      "Factuurvaluta: USD · Vermeld bij betaling: INV-2026-0012 / GR00042",
    );
    expect(printTitle(paid)).toBe("INV-2026-0012 - G&R Solutions");
    expect(statusMark(draft.status)).toEqual({ kind: "draft", text: "CONCEPT" });
    expect(statusMark(paid.status)).toEqual({
      kind: "paid",
      text: "BETAALD 08-10-2026",
      date: "08-10-2026",
    });
    expect(statusMark({ status: "cancelled", paidAt: null })).toEqual({
      kind: "cancelled",
      text: "GEANNULEERD",
    });
    expect(statusMark({ status: "open", paidAt: null })).toBeNull();
    expect(statusMark({ status: "partially_paid", paidAt: null })).toBeNull();
  });

  it("pads to five rows, counting each extra summary row as a real row", () => {
    // Freight-only (2 summary rows): the template's five rows.
    expect(itemPaddingRows(0, 2)).toBe(5);
    expect(itemPaddingRows(2, 2)).toBe(3);
    expect(itemPaddingRows(5, 2)).toBe(0);
    expect(itemPaddingRows(8, 2)).toBe(0);
    // + Waarvan BTW: one empty row fewer.
    expect(itemPaddingRows(2, 3)).toBe(2);
    // 1 freight + Vrachtkosten + 3 charges + BTW: no padding at all.
    expect(itemPaddingRows(1, 7)).toBe(0);
  });

  it("roomy only for a template-sized table", () => {
    expect(documentDensity(2, 2)).toBe("roomy");
    expect(documentDensity(5, 3)).toBe("roomy");
    expect(documentDensity(6, 2)).toBe("compact");
    expect(documentDensity(1, 4)).toBe("compact");
  });

  it("KKF/BTW line only when filled", () => {
    const issuer = parseIssuerSnapshot(issuerSnapshot);
    expect(registrationLine(issuer)).toBe("KKF: 12345");
    expect(registrationLine({ ...issuer, btwNumber: "B-1" })).toBe("KKF: 12345 · BTW-nr: B-1");
    expect(registrationLine({ ...issuer, kkfNumber: null })).toBeNull();
  });

  it("references: in full up to three, then sharing the prefix", () => {
    expect(referencesText(["ORD-2026-00012", "ORD-2026-00013"])).toBe(
      "ORD-2026-00012, ORD-2026-00013",
    );
    expect(
      referencesText(["ORD-2026-00012", "ORD-2026-00013", "ORD-2025-00099", "ORD-2025-00100"]),
    ).toBe("ORD-2026-00012, 00013, ORD-2025-00099, 00100");
  });

  it("freight description and detail follow SPEC §35.9", () => {
    expect(
      freightDescription({ storeVendor: "Amazon", vendorOrderNumber: "112-7", reference: "ORD-1" }),
    ).toBe("Amazon – order 112-7");
    expect(
      freightDescription({ storeVendor: "eBay", vendorOrderNumber: null, reference: "ORD-1" }),
    ).toBe("eBay – ORD-1");
    expect(
      freightDescription({ storeVendor: null, vendorOrderNumber: null, reference: "ORD-1" }),
    ).toBe("ORD-1");
    expect(freightDetail({ trackingNumber: "1Z", reference: "ORD-1" })).toBe(
      "Tracking: 1Z · Ref: ORD-1",
    );
    expect(freightDetail({ trackingNumber: null, reference: null })).toBeNull();
  });

  it("parseBillToSnapshot skips malformed orders", () => {
    expect(parseBillToSnapshot(billToSnapshot).orders.map((o) => o.id)).toEqual(["o1", "o2"]);
  });
});
