import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InvoiceDocument, InvoicePreview } from "@/components/invoice/InvoiceDocument";
import { fromIssuedInvoice, type InvoiceItemRow, type IssuedInvoiceRow } from "@/lib/invoice/model";

const row: IssuedInvoiceRow = {
  id: "i1",
  invoice_number: null,
  status: "draft",
  currency: "USD",
  invoice_date: "2026-10-07",
  due_date: "2026-10-14",
  customer_note: null,
  paid_at: null,
  total_lbs: 12.5,
  subtotal_freight: 56.25,
  total_charges: 56.25,
  total_discount: 0,
  total_amount: 56.25,
  vat_rate: null,
  vat_amount: null,
  issuer_snapshot: {
    company_name: "G&R SOLUTIONS N.V.",
    email: "info@grsolutions.sr",
    phone: "5978897500",
    address: "kwattaweg #22",
    invoice_title: "INVOICE (inclusief BTW)",
    footer_text: "G&R SOLUTIONS N.V.  |  CUSTOMS BROKERAGE & LOGISTICS",
    payment_terms_text: "Deze factuur dient binnen 1 week te worden betaald.",
    paper_size: "Letter",
    bank_accounts: [],
  },
  bill_to_snapshot: {
    customer_code: "GR00042",
    full_name: "Maria Pinas",
    account_type: "personal",
    orders: [{ id: "o1", reference: "ORD-2026-00012", tracking_number: "1Z999" }],
  },
};
const items: InvoiceItemRow[] = [
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
];

describe("InvoiceDocument", () => {
  it("prints the template's blocks with its Dutch labels verbatim", () => {
    const { container } = render(<InvoiceDocument model={fromIssuedInvoice(row, items)} />);
    const text = container.textContent ?? "";
    for (const label of [
      "INVOICE (inclusief BTW)",
      "Email: info@grsolutions.sr",
      "Telefoon: 5978897500",
      "Adres: kwattaweg #22",
      "Naam klant:",
      "Unieke code:",
      "Datum:",
      "Invoicenummer:",
      "Vervaldatum:",
      "Referentie:",
      "Items",
      "Gewicht",
      "Prijs per lbs",
      "Totaal lbs",
      "Totaal prijs",
      "BETALINGSGEGEVENS",
      "USD – Dollar",
      "EUR – Euro",
      "Rekeningnummer:",
      "Bank:",
      "BETALINGSVOORWAARDEN",
      "G&R SOLUTIONS N.V.  |  CUSTOMS BROKERAGE & LOGISTICS",
    ]) {
      expect(text).toContain(label);
    }
    expect(text).not.toMatch(/FACTUUR|Factuurnummer/);
    expect(text).not.toContain("OPMERKINGEN"); // no note
    expect(text).toContain("07-10-2026");
    expect(text).toContain("Tracking: 1Z999 · Ref: ORD-2026-00012");
    expect(text).toContain("Factuurvaluta: USD · Vermeld bij betaling: CONCEPT / GR00042");
  });

  it("pads the items to five rows and marks a draft CONCEPT", () => {
    const { container } = render(<InvoiceDocument model={fromIssuedInvoice(row, items)} />);
    const itemsTable = container.querySelector(".gr-inv-items");
    expect(itemsTable?.querySelectorAll(":scope > tbody.gr-inv-lines > tr")).toHaveLength(5);
    expect(container.querySelector(".gr-inv-sheet")?.getAttribute("data-density")).toBe("roomy");
    expect(container.querySelector(".gr-inv-watermark")?.textContent).toBe("CONCEPT");
    expect(
      within(container.querySelector(".gr-inv-info") as HTMLElement).getByText("CONCEPT"),
    ).toBeTruthy();
  });

  it("stamps a paid invoice and sets the paper size for printing", () => {
    const paid = fromIssuedInvoice(
      {
        ...row,
        invoice_number: "INV-2026-0001",
        status: "paid",
        paid_at: "2026-10-08T15:00:00Z",
        customer_note: "Dank u wel",
        issuer_snapshot: { ...(row.issuer_snapshot as object), paper_size: "A4" },
      },
      items,
    );
    const { container } = render(<InvoiceDocument model={paid} />);
    const stamp = container.querySelector(".gr-inv-stamp");
    expect(stamp?.textContent).toBe("BETAALD 08-10-2026");
    // In the contact block, whose gutters the CSS keeps free for it on a paid invoice.
    expect(stamp?.closest(".gr-inv-contact")).not.toBeNull();
    expect(container.querySelector(".gr-inv-sheet")?.getAttribute("data-status")).toBe("paid");
    expect(container.querySelector(".gr-inv-watermark")).toBeNull();
    expect(container.querySelector("style")?.textContent).toContain("size: A4");
    expect(container.querySelector(".gr-inv-sheet")?.getAttribute("data-paper")).toBe("A4");
    expect(container.textContent).toContain("OPMERKINGEN");
  });

  it("prints the summary rows in the items table, so its header repeats above them on a new page", () => {
    const charges: InvoiceItemRow[] = [
      ...items,
      {
        id: "c1",
        line_type: "customs",
        description: "Invoerrechten",
        order_id: null,
        weight_lbs: null,
        rate_per_lb: null,
        amount: 20,
        vat_exempt: true,
        sort_order: 1,
      },
      {
        id: "d1",
        line_type: "discount",
        description: "Korting",
        order_id: null,
        weight_lbs: null,
        rate_per_lb: null,
        amount: -5,
        vat_exempt: false,
        sort_order: 2,
      },
    ];
    const { container } = render(
      <InvoiceDocument model={fromIssuedInvoice({ ...row, total_amount: 71.25 }, charges)} />,
    );
    const table = container.querySelector(".gr-inv-items") as HTMLElement;
    expect(table.querySelectorAll(":scope > thead")).toHaveLength(1);
    const totals = table.querySelector(":scope > tbody.gr-inv-totals") as HTMLElement;
    expect(Array.from(totals.querySelectorAll("th")).map((th) => th.textContent)).toEqual([
      "Totaal lbs",
      "Vrachtkosten",
      "Inklaringskosten / douane",
      "Korting",
      "Totaal prijs",
    ]);
    // 1 item + 3 charge rows ("Vrachtkosten", customs, discount) = 4 real rows → 1 empty row.
    expect(table.querySelectorAll(":scope > tbody.gr-inv-lines > tr")).toHaveLength(2);
    expect(container.querySelector(".gr-inv-summary")).toBeNull();
  });

  it("reserves the footer's height with an invisible copy, so a long footer wraps instead of being cut", () => {
    const footer = "G&R SOLUTIONS N.V.  |  ".repeat(8);
    const { container } = render(
      <InvoiceDocument
        model={fromIssuedInvoice(
          { ...row, issuer_snapshot: { ...(row.issuer_snapshot as object), footer_text: footer } },
          items,
        )}
      />,
    );
    const texts = container.querySelectorAll(".gr-inv-footer-text");
    expect(texts).toHaveLength(2);
    expect(container.querySelector("tfoot .gr-inv-footer-text")?.textContent).toBe(footer);
    expect(container.querySelector(".gr-inv-footer")?.textContent).toBe(footer);
  });

  it("InvoicePreview renders the same document inside a scaling wrapper", () => {
    const { container } = render(
      <InvoicePreview model={fromIssuedInvoice(row, items)} label="Voorbeeld" />,
    );
    expect(screen.getByRole("region", { name: "Voorbeeld" })).toBeTruthy();
    const scaled = container.querySelector(".gr-inv-scaled") as HTMLElement;
    expect(scaled.style.width).toBe("816px");
    expect(scaled.style.transform).toMatch(/^scale\(/);
  });
});
