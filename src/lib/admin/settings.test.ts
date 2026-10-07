import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const {
  COMPANY_SECTIONS,
  bankAccountChange,
  billableWeight,
  changedSettings,
  decimalInputValue,
  formatInvoiceNumber,
  incompleteBankCurrencies,
  isPlaceholderText,
  nextCustomerNumberSchema,
  parseDecimalInput,
  parseSection,
  paymentTermsWarnings,
  termsTextFigures,
  unknownPlaceholders,
  warehouseAddressSchema,
  warehouseWarnings,
  EMPTY_WAREHOUSE_ADDRESS,
} = await import("./settings");

const section = (id: string) => COMPANY_SECTIONS.find((s) => s.id === id)!;
const SEED_TERMS =
  "Deze factuur dient binnen 1 week na factuurdatum volledig te worden betaald. Na het verstrijken van deze betalingstermijn wordt een opslag van 15% op het openstaande bedrag in rekening gebracht.";

describe("numbers as staff type them", () => {
  it("accepts a comma or a dot and at most 2 decimals", () => {
    expect(parseDecimalInput("15")).toBe(15);
    expect(parseDecimalInput(" 12,5 ")).toBe(12.5);
    expect(parseDecimalInput("12.50")).toBe(12.5);
    for (const bad of ["", "abc", "-1", "1,234", "1.2.3", "12,345"]) {
      expect(parseDecimalInput(bad), bad).toBeNull();
    }
    expect(decimalInputValue(12.5)).toBe("12,5");
    expect(decimalInputValue(null)).toBe("");
  });
});

describe("company settings sections", () => {
  it("shows every error of a section at once, cross-field rules included", () => {
    const parsed = parseSection(section("facturen"), {
      invoice_title: " ",
      footer_text: "",
      payment_terms_text: "",
      payment_term_days: "400",
      late_fee_percent: "abc",
      default_currency: "USD",
      vat_rate_percent: "",
      show_vat_breakdown: "true",
      invoice_number_prefix: "INV -",
      paper_size: "A4",
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(Object.keys(parsed.errors).sort()).toEqual([
      "invoice_number_prefix",
      "invoice_title",
      "late_fee_percent",
      "payment_term_days",
      "vat_rate_percent",
    ]);
    expect(parsed.errors.vat_rate_percent).toMatch(/BTW-tarief/);
    expect(parsed.errors.payment_term_days).toMatch(/0 tot en met 365/);
  });

  it("turns the form into column values: empty optional text is null, an empty prefix stays ''", () => {
    const parsed = parseSection(section("facturen"), {
      invoice_title: "INVOICE",
      footer_text: "  ",
      payment_terms_text: "",
      payment_term_days: "14",
      late_fee_percent: "12,5",
      default_currency: "SRD",
      vat_rate_percent: "10",
      show_vat_breakdown: "false",
      invoice_number_prefix: "",
      paper_size: "Letter",
    });
    expect(parsed).toEqual({
      ok: true,
      values: {
        invoice_title: "INVOICE",
        footer_text: null,
        payment_terms_text: null,
        payment_term_days: 14,
        late_fee_percent: 12.5,
        default_currency: "SRD",
        vat_rate_percent: 10,
        show_vat_breakdown: false,
        invoice_number_prefix: "",
        paper_size: "Letter",
      },
    });
  });

  it("writes only what changed (numbers from the database may be strings)", () => {
    const current = {
      payment_term_days: 7,
      late_fee_percent: "15.00",
      invoice_title: "INVOICE (inclusief BTW)",
      footer_text: null,
    } as unknown as Parameters<typeof changedSettings>[1];
    expect(
      changedSettings(
        { payment_term_days: 7, late_fee_percent: 15, invoice_title: "INVOICE", footer_text: null },
        current,
      ),
    ).toEqual({ invoice_title: "INVOICE" });
  });
});

describe("payment terms text vs. the numbers", () => {
  it("reads periods and percentages from Dutch text", () => {
    expect(termsTextFigures(SEED_TERMS)).toEqual({ days: [7], percents: [15] });
    expect(termsTextFigures("binnen twee weken, daarna 10 procent; of 30 dagen")).toEqual({
      days: [14, 30],
      percents: [10],
    });
  });

  it("warns only when the text names a different figure", () => {
    expect(paymentTermsWarnings(SEED_TERMS, 7, 15)).toEqual([]);
    expect(paymentTermsWarnings(SEED_TERMS, 14, 15)).toEqual([
      "De betalingsvoorwaarden noemen 7 dagen, maar de betalingstermijn staat op 14 dagen.",
    ]);
    expect(paymentTermsWarnings(SEED_TERMS, 7, 12.5)).toEqual([
      "De betalingsvoorwaarden noemen 15%, maar de opslag te late betaling staat op 12,50%.",
    ]);
    expect(paymentTermsWarnings("Betalen bij afhalen.", 7, 15)).toEqual([]);
    expect(paymentTermsWarnings(null, 7, 15)).toEqual([]);
  });

  it("recognises the seeded placeholder texts", () => {
    expect(isPlaceholderText("_Placeholder: de algemene voorwaarden …_")).toBe(true);
    expect(isPlaceholderText("")).toBe(true);
    expect(isPlaceholderText(null)).toBe(true);
    expect(isPlaceholderText("# Algemene voorwaarden")).toBe(false);
  });
});

describe("numbering", () => {
  it("formats invoice numbers as issue_invoice does", () => {
    expect(formatInvoiceNumber("INV-", 2026, 1)).toBe("INV-2026-0001");
    expect(formatInvoiceNumber("INV-", 2026, 9999)).toBe("INV-2026-9999");
    expect(formatInvoiceNumber("INV-", 2026, 10000)).toBe("INV-2026-10000");
    expect(formatInvoiceNumber("", 2027, 42)).toBe("2027-0042");
  });

  it("reads the next customer code as staff type it", () => {
    expect(nextCustomerNumberSchema.parse({ code: "GR00150" })).toEqual({ code: 150 });
    expect(nextCustomerNumberSchema.parse({ code: "gr 7" })).toEqual({ code: 7 });
    expect(nextCustomerNumberSchema.safeParse({ code: "abc" }).success).toBe(false);
    expect(nextCustomerNumberSchema.safeParse({ code: "" }).success).toBe(false);
  });
});

describe("weights and rates (always rounded up)", () => {
  it("rounds up to the step without binary drift, then applies the minimum", () => {
    expect(billableWeight(2.3, "none", null)).toBe(2.3);
    expect(billableWeight(2.3, "0.1", null)).toBe(2.3);
    expect(billableWeight(2.31, "0.1", null)).toBe(2.4);
    expect(billableWeight(0.1 + 0.2, "0.1", null)).toBe(0.3);
    expect(billableWeight(2.3, "0.5", null)).toBe(2.5);
    expect(billableWeight(2.5, "0.5", null)).toBe(2.5);
    expect(billableWeight(2.01, "1", null)).toBe(3);
    expect(billableWeight(2.3, "1", 5)).toBe(5);
    expect(billableWeight(7.2, "none", 5)).toBe(7.2);
  });
});

describe("bank accounts and US addresses", () => {
  const account = (currency: "USD" | "EUR" | "SRD", number: string | null) => ({
    id: currency,
    currency,
    bank_name: "DSB",
    account_holder: null,
    account_number: number,
    sort_order: 1,
    is_active: true,
  });

  it("lists currencies whose account cannot be printed yet", () => {
    expect(incompleteBankCurrencies([account("USD", "1"), account("EUR", null)])).toEqual([
      "EUR",
      "SRD",
    ]);
  });

  it("knows only {FULL_NAME} and {GR_CODE}, and warns without the code", () => {
    expect(unknownPlaceholders("{FULL_NAME} {NAAM} {GR_CODE} {NAAM}")).toEqual(["{NAAM}"]);
    const parsed = warehouseAddressSchema.safeParse({
      ...EMPTY_WAREHOUSE_ADDRESS,
      recipientTemplate: "{NAAM}",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => i.path[0]);
      expect(fields).toEqual(
        expect.arrayContaining(["label", "recipientTemplate", "line1", "city"]),
      );
      expect(parsed.error.issues.find((i) => i.path[0] === "recipientTemplate")?.message).toBe(
        "Onbekende code {NAAM}: gebruik alleen {FULL_NAME} en {GR_CODE}.",
      );
    }
    expect(warehouseWarnings(EMPTY_WAREHOUSE_ADDRESS)).toEqual([]);
    expect(
      warehouseWarnings({ recipientTemplate: "{FULL_NAME}", line2Template: "Suite 4" }),
    ).toHaveLength(2);
  });
});

describe("saving a bank account (bankAccountChange)", () => {
  const complete = { bank_name: "DSB", account_holder: null, account_number: "123" };
  it("nothing changed: nothing to save (also for an empty card)", () => {
    expect(
      bankAccountChange(complete, { bankName: "DSB", accountHolder: null, accountNumber: "123" }),
    ).toBe("unchanged");
    expect(
      bankAccountChange(
        { bank_name: null, account_holder: "", account_number: null },
        { bankName: null, accountHolder: null, accountNumber: null },
      ),
    ).toBe("unchanged");
    expect(
      bankAccountChange(null, { bankName: null, accountHolder: null, accountNumber: null }),
    ).toBe("unchanged");
  });
  it("a complete account made incomplete asks first; anything else saves", () => {
    expect(
      bankAccountChange(complete, { bankName: "DSB", accountHolder: null, accountNumber: null }),
    ).toBe("emptied");
    expect(
      bankAccountChange(complete, { bankName: null, accountHolder: null, accountNumber: null }),
    ).toBe("emptied");
    expect(
      bankAccountChange(complete, {
        bankName: "Hakrinbank",
        accountHolder: "G&R",
        accountNumber: "9",
      }),
    ).toBe("save");
    expect(
      bankAccountChange(null, { bankName: "DSB", accountHolder: null, accountNumber: null }),
    ).toBe("save");
  });
});
