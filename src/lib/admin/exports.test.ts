import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { CSV_BOM, buildCsv } from "@/lib/csv";

import {
  AUDIT_EXPORT_COLUMNS,
  CUSTOMER_EXPORT_COLUMNS,
  INVOICE_EXPORT_COLUMNS,
  ORDER_EXPORT_COLUMNS,
  PAYMENT_EXPORT_COLUMNS,
  invoiceExportRows,
  type AuditExportRow,
  type CustomerExportRow,
  type InvoiceExportInvoice,
  type InvoiceExportLine,
  type OrderExportRow,
  type PaymentExportRow,
} from "./exports";

/** The data lines of a CSV (no BOM, no header), split on ';' outside quotes. */
function cells(csv: string): string[][] {
  expect(csv.startsWith(CSV_BOM)).toBe(true);
  const lines = csv.slice(CSV_BOM.length).split("\r\n").filter(Boolean);
  return lines.map((line) => {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = !quoted;
      } else if (ch === ";" && !quoted) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out;
  });
}

/** Header → value of one data row. */
const record = (csv: string, row = 1) => {
  const [header = [], ...rows] = cells(csv);
  return Object.fromEntries(header.map((h, i) => [h, rows[row - 1]?.[i]]));
};

const customer = {
  id: "c1",
  customer_code: "GR00042",
  full_name: "Maria Pinas",
  company_name: "Pinas Trading N.V.",
  account_type: "business" as const,
};

describe("customer export", () => {
  const row: CustomerExportRow = {
    ...customer,
    status: "active",
    email: "maria@example.com",
    phone: "+597 889 7500",
    address: "Kernkampweg 1; Paramaribo",
    district: "Paramaribo",
    kkf_number: "012345",
    contact_person: null,
    user_id: "u1",
    created_at: "2026-01-05T02:00:00Z",
    disabled_at: null,
    disabled_reason: null,
    terms_accepted_at: null,
  };

  it("writes Dutch labels, codes as text and dd-mm-jjjj dates", () => {
    const r = record(buildCsv(CUSTOMER_EXPORT_COLUMNS, [row]));
    expect(r).toMatchObject({
      "GR-code": "GR00042",
      Naam: "Maria Pinas",
      "Soort klant": "Zakelijk",
      Status: "Actief",
      Telefoon: '="+597 889 7500"',
      Adres: "Kernkampweg 1; Paramaribo",
      "KKF-nummer": '="012345"',
      Login: "ja",
      // 02:00 UTC on 5 January is still 4 January in Suriname.
      "Klant sinds": "04-01-2026",
      "Gedeactiveerd op": "",
    });
  });
});

describe("order export", () => {
  const order = {
    id: "o1",
    reference: "ORD-2026-00012",
    customer_id: "c1",
    order_type: "b2b",
    service_type: "air",
    status: "in_transit_air",
    store_vendor: "Amazon",
    vendor_order_number: "112-3456789-0123456",
    description: "Schoenen, maat 42",
    quantity: 2,
    estimated_value: 1249.5,
    estimated_value_currency: "USD",
    purchase_date: "2026-09-30",
    expected_delivery_date: null,
    tracking_number: "9400111899223397658538",
    carrier: "USPS",
    declared_weight_lbs: 3.5,
    measured_weight_lbs: 4.25,
    shipment_id: "s1",
    parent_order_id: "o0",
    supplier_name: null,
    client_po_number: "PO-77",
    purchase_mode: "gr_purchases",
    customer_note: "=cmd|' /C calc'!A0",
    created_at: "2026-10-01T13:00:00Z",
    created_by_role: "customer",
    received_at: null,
    picked_up_at: null,
    picked_up_by_name: null,
    cancellation_requested_at: null,
    customer,
    shipment: { shipment_number: "SH-2026-007" },
    parentReference: "ORD-2026-00011",
    statusLabel: "Onderweg (lucht)",
    stageLabel: "Onderweg naar Suriname",
  } as unknown as OrderExportRow;

  it("writes amounts and weights with a decimal comma and keeps long numbers as text", () => {
    const r = record(buildCsv(ORDER_EXPORT_COLUMNS, [order]));
    expect(r).toMatchObject({
      Referentie: "ORD-2026-00012",
      Klant: "Pinas Trading N.V. (Maria Pinas)",
      "Soort order": "Zakelijk",
      Verzendwijze: "Luchtvracht",
      Status: "Onderweg (lucht)",
      Fase: "Onderweg naar Suriname",
      "Ordernummer winkel": '="112-3456789-0123456"',
      Aantal: "2",
      "Geschatte waarde": "1249,50",
      "Valuta waarde": "USD",
      Aankoopdatum: "30-09-2026",
      Trackingnummer: '="9400111899223397658538"',
      "Opgegeven gewicht (lbs)": "3,50",
      "Gemeten gewicht (lbs)": "4,25",
      Zending: "SH-2026-007",
      Hoofdorder: "ORD-2026-00011",
      Inkoopwijze: "Inkoop door G&R",
      // A formula from the customer is defused.
      "Opmerking klant": "'=cmd|' /C calc'!A0",
      "Aangemeld op": "01-10-2026 10:00",
      "Aangemeld door": "Klant",
    });
  });
});

describe("invoice export (one row per line)", () => {
  const invoice = (over: Partial<InvoiceExportInvoice>): InvoiceExportInvoice => ({
    id: "i1",
    invoice_number: "INV-2026-0007",
    status: "partially_paid",
    is_overdue: true,
    customer_id: "c1",
    currency: "SRD",
    invoice_date: "2026-09-01",
    due_date: "2026-09-08",
    issued_at: "2026-09-01T14:00:00Z",
    total_lbs: 4.5,
    subtotal_freight: 20.25,
    total_charges: 1000,
    total_discount: 0,
    vat_rate: null,
    vat_amount: null,
    total_amount: 1020.25,
    amount_paid: 500,
    balance_due: 520.25,
    paid_at: null,
    cancelled_at: null,
    cancel_reason: null,
    replaces_invoice_id: "i0",
    reminder_count: 2,
    late_fee_applied_at: null,
    customer_note: null,
    ...over,
  });
  const line = (over: Partial<InvoiceExportLine>): InvoiceExportLine => ({
    invoice_id: "i1",
    sort_order: 1,
    line_type: "freight",
    description: "Amazon – order 112",
    weight_lbs: 4.5,
    rate_per_lb: 4.5,
    amount: 20.25,
    vat_exempt: false,
    order: { reference: "ORD-2026-00012" },
    ...over,
  });
  const customers = new Map([["c1", customer]]);
  const replaced = invoice({ id: "i0", invoice_number: "INV-2026-0003", status: "cancelled" });

  it("numbers the lines in invoice order and repeats the invoice on each", () => {
    const rows = invoiceExportRows(
      [invoice({})],
      [
        line({ sort_order: 5, line_type: "customs", description: "Douane", amount: 1000 }),
        line({}),
      ],
      customers,
      [invoice({}), replaced],
    );
    expect(rows.map((r) => [r.lineNumber, r.line?.line_type])).toEqual([
      [1, "freight"],
      [2, "customs"],
    ]);
    const csv = buildCsv(INVOICE_EXPORT_COLUMNS, rows);
    const first = record(csv, 1);
    expect(first).toMatchObject({
      Factuurnummer: "INV-2026-0007",
      Status: "Deels betaald",
      Achterstallig: "ja",
      "GR-code": "GR00042",
      Valuta: "SRD",
      Factuurdatum: "01-09-2026",
      Vervaldatum: "08-09-2026",
      Totaal: "1020,25",
      Betaald: "500,00",
      Openstaand: "520,25",
      "Vervangt factuur": "INV-2026-0003",
      Herinneringen: "2",
      Regel: "1",
      "Soort regel": "Vracht",
      Order: "ORD-2026-00012",
      "Gewicht (lbs)": "4,50",
      "Tarief per lb": "4,50",
      "Bedrag regel": "20,25",
      "BTW-vrij": "nee",
    });
    expect(record(csv, 2)).toMatchObject({
      Regel: "2",
      "Soort regel": "Inklaringskosten / douane",
      "Bedrag regel": "1000,00",
      Order: "ORD-2026-00012",
    });
  });

  it("gives an invoice without lines one row, and a draft the word Concept", () => {
    const rows = invoiceExportRows(
      [invoice({ id: "d1", invoice_number: null, status: "draft", replaces_invoice_id: null })],
      [],
      customers,
    );
    expect(rows).toHaveLength(1);
    const r = record(buildCsv(INVOICE_EXPORT_COLUMNS, rows));
    expect(r).toMatchObject({ Factuurnummer: "Concept", Status: "Concept", Regel: "" });
  });
});

describe("payment export", () => {
  const payment = {
    id: "p1",
    invoice_id: "i1",
    amount: 45,
    paid_on: "2026-09-07",
    method: "bank_transfer",
    reference: "000123",
    received_amount: 1620.5,
    received_currency: "SRD",
    customer_note: 'Dank u; "betaald"',
    recorded_by: "u1",
    created_at: "2026-09-07T15:00:00Z",
    voided_at: "2026-09-08T12:00:00Z",
    voided_by: "u2",
    void_reason: "Dubbel geboekt",
    invoice: { invoice_number: "INV-2026-0001", currency: "USD", customer_id: "c1" },
    customer,
    recordedByName: "Maria",
    voidedByName: "Ronald",
  } as unknown as PaymentExportRow;

  it("writes the payment with who recorded and voided it", () => {
    const r = record(buildCsv(PAYMENT_EXPORT_COLUMNS, [payment]));
    expect(r).toMatchObject({
      Factuurnummer: "INV-2026-0001",
      Valuta: "USD",
      Bedrag: "45,00",
      "Betaald op": "07-09-2026",
      Betaalwijze: "Overschrijving",
      Referentie: '="000123"',
      "Ontvangen bedrag": "1620,50",
      "Ontvangen valuta": "SRD",
      "Bericht voor de klant": 'Dank u; "betaald"',
      "Geregistreerd door": "Maria",
      "Ongedaan gemaakt": "ja",
      "Ongedaan gemaakt op": "08-09-2026 09:00",
      "Ongedaan gemaakt door": "Ronald",
      "Reden ongedaan maken": "Dubbel geboekt",
    });
  });
});

describe("audit export", () => {
  const entry: AuditExportRow = {
    id: 7,
    occurred_at: "2026-10-07T12:00:00Z",
    actor_id: "6f1c0d2e-8a4b-4c3d-9e5f-0a1b2c3d4e5f",
    actorName: "Ronald",
    table_name: "orders",
    record_id: "0b5a7c1e-0000-4000-8000-000000000001",
    action: "UPDATE",
    old_data: { reference: "ORD-2026-00012", status: "registered", note: 'a;"b"' },
    new_data: { reference: "ORD-2026-00012", status: "in_transit_air", note: 'a;"b"' },
    changed_columns: ["status", "updated_at"],
    reason: null,
  };

  it("writes readable labels plus the raw JSON, quoted where needed", () => {
    const r = record(buildCsv(AUDIT_EXPORT_COLUMNS, [entry]));
    expect(r).toMatchObject({
      Tijdstip: "07-10-2026 09:00",
      Wie: "Ronald",
      Tabel: "Orders",
      "Tabel (database)": "orders",
      Record: "ORD-2026-00012",
      Actie: "Gewijzigd",
      "Gewijzigde velden": "status, updated_at",
      "Oude waarden (JSON)":
        '{"reference":"ORD-2026-00012","status":"registered","note":"a;\\"b\\""}',
    });
    // The JSON survives a round trip through the CSV quoting.
    expect(JSON.parse(r["Nieuwe waarden (JSON)"] ?? "")).toEqual(entry.new_data);
  });
});
