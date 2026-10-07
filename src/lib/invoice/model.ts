import type { Database, Json } from "@/integrations/supabase/types";
import { Constants } from "@/integrations/supabase/types";
import { formatDate, formatLbs, formatMoney, formatNumber, type CurrencyCode } from "@/lib/format";
import {
  BANK_COLUMNS,
  INVOICE_LABELS,
  SUMMARY_LABELS,
  SUMMARY_ORDER,
  fill,
} from "@/lib/invoice/labels";
import {
  computeInvoiceTotals,
  lineAmount,
  sumAmounts,
  type InvoiceLineType,
  type InvoiceTotals,
} from "@/lib/invoice/totals";

/**
 * The one input of <InvoiceDocument> (SPEC §35.11): everything the paper
 * prints, already resolved. Two builders make it:
 *
 * - fromDraftForm(): the builder's live preview, from the form state and the
 *   LIVE company settings, bank accounts and customer (drafts follow today's
 *   settings; totals from computeInvoiceTotals, as the database will store them);
 * - fromIssuedInvoice(): an issued (or cancelled/paid) invoice, ONLY from its
 *   row, its lines and the issuer_snapshot / bill_to_snapshot written by
 *   issue_invoice; never from today's settings or the live customer.
 */

export type PaperSize = Database["public"]["Enums"]["paper_size"];
export type InvoiceStatus = Database["public"]["Enums"]["invoice_status"];
type AccountType = Database["public"]["Enums"]["account_type"];
type Tables = Database["public"]["Tables"];

export interface InvoiceBankAccount {
  currency: CurrencyCode;
  bankName: string | null;
  accountHolder: string | null;
  accountNumber: string | null;
}

/** G&R as printed on the invoice (company_settings, or issuer_snapshot once issued). */
export interface InvoiceIssuer {
  companyName: string;
  tagline: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  kkfNumber: string | null;
  btwNumber: string | null;
  invoiceTitle: string;
  footerText: string | null;
  paymentTermsText: string | null;
  paymentTermDays: number | null;
  lateFeePercent: number | null;
  vatRatePercent: number | null;
  showVatBreakdown: boolean;
  paperSize: PaperSize;
  /** Active accounts; the payment block prints one column per currency. */
  bankAccounts: InvoiceBankAccount[];
}

/** The customer as printed (the customer row, or bill_to_snapshot once issued). */
export interface InvoiceBillTo {
  customerId: string | null;
  customerCode: string;
  fullName: string;
  accountType: AccountType | null;
  companyName: string | null;
  contactPerson: string | null;
  kkfNumber: string | null;
  address: string | null;
  district: string | null;
  email: string | null;
  phone: string | null;
}

export interface InvoiceRenderLine {
  key: string;
  lineType: InvoiceLineType;
  description: string;
  /** Freight: the small grey line under the description ('Tracking: … · Ref: …'). */
  detail: string | null;
  orderId: string | null;
  weightLbs: number | null;
  ratePerLb: number | null;
  /** As stored (freight = round(weight × rate, 2); discounts ≤ 0). */
  amount: number;
  vatExempt: boolean;
}

export interface InvoiceMeta {
  /** null for a draft ("CONCEPT"). */
  invoiceNumber: string | null;
  /** 'YYYY-MM-DD' or '' while the builder's field is empty. */
  invoiceDate: string;
  dueDate: string;
  currency: CurrencyCode;
  /** Order references for "Referentie:". */
  references: string[];
  customerNote: string | null;
}

export interface InvoiceRenderStatus {
  status: InvoiceStatus;
  /** timestamptz; the BETAALD stamp prints its Suriname date. */
  paidAt: string | null;
}

export interface InvoiceRenderModel {
  issuer: InvoiceIssuer;
  billTo: InvoiceBillTo;
  meta: InvoiceMeta;
  /** Every line, in sort order; the document prints freight as item rows, the rest as summary rows. */
  lines: InvoiceRenderLine[];
  totals: InvoiceTotals;
  status: InvoiceRenderStatus;
}

// ---------------------------------------------------------------------------
// Drafts: form state + live settings
// ---------------------------------------------------------------------------

export type CompanySettingsRow = Tables["company_settings"]["Row"];
export type BankAccountRow = Pick<
  Tables["company_bank_accounts"]["Row"],
  "currency" | "bank_name" | "account_holder" | "account_number" | "is_active" | "sort_order"
>;
export type BillToCustomer = Pick<
  Tables["customers"]["Row"],
  | "id"
  | "customer_code"
  | "full_name"
  | "account_type"
  | "company_name"
  | "contact_person"
  | "kkf_number"
  | "address"
  | "district"
  | "email"
  | "phone"
>;

/** One line of the builder, already parsed (null where the field is empty or invalid). */
export interface DraftFormLine {
  key: string;
  lineType: InvoiceLineType;
  description: string;
  detail?: string | null;
  orderId?: string | null;
  weightLbs: number | null;
  ratePerLb: number | null;
  /** Ignored for freight; negative for a discount. */
  amount: number | null;
  vatExempt: boolean;
}

/** What the builder holds; fromDraftForm() turns it into the preview. */
export interface DraftFormState {
  currency: CurrencyCode;
  invoiceDate: string;
  dueDate: string;
  customerNote: string;
  /** The references of the orders on the invoice. */
  references: readonly string[];
  lines: readonly DraftFormLine[];
}

/** The issuer as issue_invoice would snapshot it now (active accounts, sort order). */
export function issuerFromSettings(
  settings: CompanySettingsRow,
  bankAccounts: readonly BankAccountRow[],
): InvoiceIssuer {
  return {
    companyName: settings.company_name,
    tagline: settings.tagline,
    email: settings.email,
    phone: settings.phone,
    address: settings.address,
    kkfNumber: settings.kkf_number,
    btwNumber: settings.btw_number,
    invoiceTitle: settings.invoice_title,
    footerText: settings.footer_text,
    paymentTermsText: settings.payment_terms_text,
    paymentTermDays: settings.payment_term_days,
    lateFeePercent: settings.late_fee_percent,
    vatRatePercent: settings.vat_rate_percent,
    showVatBreakdown: settings.show_vat_breakdown,
    paperSize: settings.paper_size,
    bankAccounts: [...bankAccounts]
      .filter((b) => b.is_active)
      .sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          CURRENCY_ORDER.indexOf(a.currency) - CURRENCY_ORDER.indexOf(b.currency),
      )
      .map((b) => ({
        currency: b.currency,
        bankName: b.bank_name,
        accountHolder: b.account_holder,
        accountNumber: b.account_number,
      })),
  };
}

export function billToFromCustomer(customer: BillToCustomer): InvoiceBillTo {
  return {
    customerId: customer.id,
    customerCode: customer.customer_code,
    fullName: customer.full_name,
    accountType: customer.account_type,
    companyName: customer.company_name,
    contactPerson: customer.contact_person,
    kkfNumber: customer.kkf_number,
    address: customer.address,
    district: customer.district,
    email: customer.email,
    phone: customer.phone,
  };
}

/** The live preview of a draft (SPEC §35.11: drafts render from live settings). */
export function fromDraftForm(
  form: DraftFormState,
  settings: CompanySettingsRow,
  bankAccounts: readonly BankAccountRow[],
  customer: BillToCustomer | null,
): InvoiceRenderModel {
  const lines: InvoiceRenderLine[] = form.lines.map((l) => {
    const freight = l.lineType === "freight";
    const weightLbs = freight ? l.weightLbs : null;
    const ratePerLb = freight ? l.ratePerLb : null;
    return {
      key: l.key,
      lineType: l.lineType,
      description: l.description,
      detail: l.detail ?? null,
      orderId: l.orderId ?? null,
      weightLbs,
      ratePerLb,
      amount: lineAmount({
        lineType: l.lineType,
        weightLbs,
        ratePerLb,
        amount: freight ? null : l.amount,
        vatExempt: l.vatExempt,
      }),
      vatExempt: l.vatExempt,
    };
  });
  return {
    issuer: issuerFromSettings(settings, bankAccounts),
    billTo: customer ? billToFromCustomer(customer) : EMPTY_BILL_TO,
    meta: {
      invoiceNumber: null,
      invoiceDate: form.invoiceDate,
      dueDate: form.dueDate,
      currency: form.currency,
      references: [...form.references],
      customerNote: form.customerNote.trim() === "" ? null : form.customerNote,
    },
    lines,
    // A draft's vat_rate is the live setting (issue_invoice takes it again).
    totals: computeInvoiceTotals(lines, settings.vat_rate_percent),
    status: { status: "draft", paidAt: null },
  };
}

const EMPTY_BILL_TO: InvoiceBillTo = {
  customerId: null,
  customerCode: "",
  fullName: "",
  accountType: null,
  companyName: null,
  contactPerson: null,
  kkfNumber: null,
  address: null,
  district: null,
  email: null,
  phone: null,
};

// ---------------------------------------------------------------------------
// Issued invoices: row + lines + snapshots only
// ---------------------------------------------------------------------------

/** The invoice columns the document needs (an invoices or invoice_overview row). */
export interface IssuedInvoiceRow {
  id: string | null;
  invoice_number: string | null;
  status: InvoiceStatus | null;
  currency: CurrencyCode | null;
  invoice_date: string | null;
  due_date: string | null;
  customer_note: string | null;
  paid_at: string | null;
  total_lbs: number | null;
  subtotal_freight: number | null;
  total_charges: number | null;
  total_discount: number | null;
  total_amount: number | null;
  vat_rate: number | null;
  vat_amount: number | null;
  issuer_snapshot: Json | null;
  bill_to_snapshot: Json | null;
}

export type InvoiceItemRow = Pick<
  Tables["invoice_items"]["Row"],
  | "id"
  | "line_type"
  | "description"
  | "order_id"
  | "weight_lbs"
  | "rate_per_lb"
  | "amount"
  | "vat_exempt"
  | "sort_order"
>;

/** An order as bill_to_snapshot.orders holds it (for "Referentie:" and tracking lines). */
export interface SnapshotOrder {
  id: string;
  reference: string;
  trackingNumber: string | null;
  storeVendor: string | null;
  vendorOrderNumber: string | null;
}

export interface InvoiceSnapshots {
  issuer: Json | null;
  billTo: Json | null;
}

type JsonObject = { [key: string]: Json | undefined };

const isObject = (v: Json | undefined): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (o: JsonObject, k: string): string | null => {
  const v = o[k];
  return typeof v === "string" && v.trim() !== "" ? v : null;
};
const number = (o: JsonObject, k: string): number | null => {
  const v = o[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const CURRENCY_ORDER = Constants.public.Enums.currency_code;
const asCurrency = (v: string | null): CurrencyCode | null =>
  CURRENCY_ORDER.find((c) => c === v) ?? null;

/** issuer_snapshot (version 1) → InvoiceIssuer; missing fields print as empty. */
export function parseIssuerSnapshot(snapshot: Json | null): InvoiceIssuer {
  const o = isObject(snapshot) ? snapshot : {};
  const accounts = Array.isArray(o["bank_accounts"]) ? o["bank_accounts"] : [];
  return {
    companyName: text(o, "company_name") ?? "",
    tagline: text(o, "tagline"),
    email: text(o, "email"),
    phone: text(o, "phone"),
    address: text(o, "address"),
    kkfNumber: text(o, "kkf_number"),
    btwNumber: text(o, "btw_number"),
    invoiceTitle: text(o, "invoice_title") ?? "",
    footerText: text(o, "footer_text"),
    paymentTermsText: text(o, "payment_terms_text"),
    paymentTermDays: number(o, "payment_term_days"),
    lateFeePercent: number(o, "late_fee_percent"),
    vatRatePercent: number(o, "vat_rate_percent"),
    showVatBreakdown: o["show_vat_breakdown"] === true,
    paperSize: text(o, "paper_size") === "A4" ? "A4" : "Letter",
    bankAccounts: accounts.flatMap((a) => {
      if (!isObject(a)) return [];
      const currency = asCurrency(text(a, "currency"));
      if (!currency) return [];
      return [
        {
          currency,
          bankName: text(a, "bank_name"),
          accountHolder: text(a, "account_holder"),
          accountNumber: text(a, "account_number"),
        },
      ];
    }),
  };
}

/** bill_to_snapshot (version 1) → the customer and the orders on the invoice. */
export function parseBillToSnapshot(snapshot: Json | null): {
  billTo: InvoiceBillTo;
  orders: SnapshotOrder[];
} {
  const o = isObject(snapshot) ? snapshot : {};
  const accountType = text(o, "account_type");
  const orders = Array.isArray(o["orders"]) ? o["orders"] : [];
  return {
    billTo: {
      customerId: text(o, "customer_id"),
      customerCode: text(o, "customer_code") ?? "",
      fullName: text(o, "full_name") ?? "",
      accountType: accountType === "business" || accountType === "personal" ? accountType : null,
      companyName: text(o, "company_name"),
      contactPerson: text(o, "contact_person"),
      kkfNumber: text(o, "kkf_number"),
      address: text(o, "address"),
      district: text(o, "district"),
      email: text(o, "email"),
      phone: text(o, "phone"),
    },
    orders: orders.flatMap((x) => {
      if (!isObject(x)) return [];
      const id = text(x, "id");
      const reference = text(x, "reference");
      if (!id || !reference) return [];
      return [
        {
          id,
          reference,
          trackingNumber: text(x, "tracking_number"),
          storeVendor: text(x, "store_vendor"),
          vendorOrderNumber: text(x, "vendor_order_number"),
        },
      ];
    }),
  };
}

/** The grey line under a freight item: 'Tracking: 1Z… · Ref: ORD-2026-00012'. */
export function freightDetail(order: {
  trackingNumber: string | null;
  reference: string | null;
}): string | null {
  const parts = [
    order.trackingNumber ? fill(INVOICE_LABELS.tracking, { tracking: order.trackingNumber }) : null,
    order.reference ? fill(INVOICE_LABELS.ref, { reference: order.reference }) : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** '{store_vendor} – order {vendor_order_number}' (SPEC §35.9), with fallbacks. */
export function freightDescription(order: {
  storeVendor: string | null;
  vendorOrderNumber: string | null;
  reference: string;
}): string {
  const vendor = order.storeVendor?.trim() || null;
  const number = order.vendorOrderNumber?.trim() || null;
  if (vendor && number) return `${vendor} – order ${number}`;
  if (vendor) return `${vendor} – ${order.reference}`;
  if (number) return `Order ${number}`;
  return order.reference;
}

/**
 * An issued, paid or cancelled invoice, rendered ONLY from the row, its lines
 * and the snapshots issue_invoice wrote (SPEC §35.9). Totals are the stored ones.
 */
export function fromIssuedInvoice(
  row: IssuedInvoiceRow,
  items: readonly InvoiceItemRow[],
  snapshots: InvoiceSnapshots = { issuer: row.issuer_snapshot, billTo: row.bill_to_snapshot },
): InvoiceRenderModel {
  const issuer = parseIssuerSnapshot(snapshots.issuer);
  const { billTo, orders } = parseBillToSnapshot(snapshots.billTo);
  const byId = new Map(orders.map((o) => [o.id, o]));
  const lines: InvoiceRenderLine[] = [...items]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item) => {
      const order = item.order_id ? byId.get(item.order_id) : undefined;
      return {
        key: item.id,
        lineType: item.line_type,
        description: item.description,
        detail:
          item.line_type === "freight" && order
            ? freightDetail({ trackingNumber: order.trackingNumber, reference: order.reference })
            : null,
        orderId: item.order_id,
        weightLbs: item.weight_lbs,
        ratePerLb: item.rate_per_lb,
        amount: item.amount,
        vatExempt: item.vat_exempt,
      };
    });
  const total = row.total_amount ?? 0;
  return {
    issuer,
    billTo,
    meta: {
      invoiceNumber: row.invoice_number,
      invoiceDate: row.invoice_date ?? "",
      dueDate: row.due_date ?? "",
      currency: row.currency ?? "USD",
      references: orders.map((o) => o.reference),
      customerNote: row.customer_note?.trim() ? row.customer_note : null,
    },
    lines,
    totals: {
      totalLbs: row.total_lbs ?? 0,
      subtotalFreight: row.subtotal_freight ?? 0,
      totalCharges: row.total_charges ?? 0,
      totalDiscount: row.total_discount ?? 0,
      totalAmount: total,
      vatAmount: row.vat_amount,
      vatRate: row.vat_rate,
      negative: total < 0,
    },
    status: { status: row.status ?? "open", paidAt: row.paid_at },
  };
}

// ---------------------------------------------------------------------------
// What the paper prints (pure, so it is unit-tested apart from the markup)
// ---------------------------------------------------------------------------

export interface ItemRowView {
  key: string;
  description: string;
  detail: string | null;
  weight: string;
  rate: string;
}

export interface SummaryRowView {
  key: string;
  label: string;
  /** "Totaal lbs" prints in the Gewicht column. */
  weight: string | null;
  amount: string | null;
  emphasis?: boolean;
}

export interface PaymentColumnView {
  currency: CurrencyCode;
  label: string;
  accountNumber: string;
  bankName: string;
}

/** At least this many item rows, padded with empty bordered rows (SPEC §35.11). */
export const MIN_ITEM_ROWS = 5;

/**
 * How many empty bordered rows pad the items table. The template pads a
 * freight-only invoice to five rows; every printed row beyond the template's
 * two summary rows ("Totaal lbs", "Totaal prijs") — a charge row,
 * "Vrachtkosten" or "Waarvan BTW" — takes the place of one empty row, so a
 * table with five or more real rows gets no padding and the up-to-8-lines
 * invoice still fits on one page (SPEC §35.11 "Page").
 */
export function itemPaddingRows(itemCount: number, summaryCount: number): number {
  const extraSummary = Math.max(0, summaryCount - 2);
  return Math.max(0, MIN_ITEM_ROWS - itemCount - extraSummary);
}

/**
 * "roomy" for a template-sized table (at most five item rows and at most
 * three summary rows): a taller logo band and item rows, closer to the Word
 * template. Anything bigger prints "compact", which keeps up to 8 lines plus
 * the BTW row, a note, a business name and the KKF line on one Letter page.
 */
export function documentDensity(itemCount: number, summaryCount: number): "roomy" | "compact" {
  return itemCount <= MIN_ITEM_ROWS && summaryCount <= 3 ? "roomy" : "compact";
}

export function itemRows(model: InvoiceRenderModel): ItemRowView[] {
  const { currency } = model.meta;
  return model.lines
    .filter((l) => l.lineType === "freight")
    .map((l) => ({
      key: l.key,
      description: l.description,
      detail: l.detail,
      weight: l.weightLbs === null ? "" : formatLbs(l.weightLbs),
      rate: l.ratePerLb === null ? "" : formatMoney(l.ratePerLb, currency),
    }));
}

/** '21' or '12,5' (a percentage as printed). */
export function formatPercent(value: number): string {
  return formatNumber(value, 2).replace(/,?0+$/, "");
}

/**
 * The summary rows under the items: "Totaal lbs", then only non-zero charge
 * rows ("Vrachtkosten" only when other rows exist), "Totaal prijs" and the
 * optional "Waarvan BTW". A freight-only invoice prints exactly the
 * template's two rows.
 */
export function summaryRows(model: InvoiceRenderModel): SummaryRowView[] {
  const { currency } = model.meta;
  const money = (n: number) => formatMoney(n, currency);
  const charges: SummaryRowView[] = [];
  for (const type of SUMMARY_ORDER) {
    const lines = model.lines.filter((l) => l.lineType === type);
    if (type === "other") {
      for (const l of lines) {
        if (l.amount === 0) continue;
        charges.push({
          key: `other-${l.key}`,
          label: fill(SUMMARY_LABELS.other, { description: l.description.trim() }),
          weight: null,
          amount: money(l.amount),
        });
      }
      continue;
    }
    const total = sumAmounts(lines.map((l) => l.amount));
    if (total === 0) continue;
    // The late fee's own description names the percentage ("… (15%)").
    const lateFee = lines[0]?.description.trim() ?? "";
    const label =
      type === "late_fee" && lateFee.startsWith(SUMMARY_LABELS.late_fee)
        ? lateFee
        : SUMMARY_LABELS[type];
    charges.push({ key: type, label, weight: null, amount: money(total) });
  }

  const rows: SummaryRowView[] = [
    {
      key: "total-lbs",
      label: INVOICE_LABELS.totalLbs,
      weight: formatLbs(model.totals.totalLbs),
      amount: null,
    },
  ];
  if (charges.length > 0 && model.totals.subtotalFreight !== 0) {
    rows.push({
      key: "freight",
      label: SUMMARY_LABELS.freight,
      weight: null,
      amount: money(model.totals.subtotalFreight),
    });
  }
  rows.push(...charges);
  rows.push({
    key: "total",
    label: INVOICE_LABELS.totalPrice,
    weight: null,
    amount: money(model.totals.totalAmount),
    emphasis: true,
  });
  const { vatRate, vatAmount } = model.totals;
  if (model.issuer.showVatBreakdown && vatRate !== null && vatAmount !== null) {
    rows.push({
      key: "vat",
      label: fill(INVOICE_LABELS.vatIncluded, { rate: formatPercent(vatRate) }),
      weight: null,
      amount: money(vatAmount),
    });
  }
  return rows;
}

/** The three columns of BETALINGSGEGEVENS; an empty value prints "________________". */
export function paymentColumns(model: InvoiceRenderModel): PaymentColumnView[] {
  return BANK_COLUMNS.map(({ currency, label }) => {
    const account = model.issuer.bankAccounts.find((a) => a.currency === currency);
    return {
      currency,
      label,
      accountNumber: account?.accountNumber?.trim() || INVOICE_LABELS.blank,
      bankName: account?.bankName?.trim() || INVOICE_LABELS.blank,
    };
  });
}

/** "Factuurvaluta: USD · Vermeld bij betaling: INV-2026-0001 / GR00042". */
export function paymentInstruction(model: InvoiceRenderModel): string {
  return fill(INVOICE_LABELS.paymentInstruction, {
    currency: model.meta.currency,
    number: model.meta.invoiceNumber ?? INVOICE_LABELS.draftNumber,
    code: model.billTo.customerCode || INVOICE_LABELS.blank,
  });
}

/**
 * "Referentie:" as printed. Up to three references in full; more share
 * their prefix ("ORD-2026-00012, 00013, 00014, …") so the info table stays
 * one or two lines (each item row also prints its own "Ref:").
 */
export function referencesText(references: readonly string[]): string {
  if (references.length <= 3) return references.join(", ");
  const out: string[] = [];
  let prefix: string | null = null;
  for (const ref of references) {
    const cut = ref.lastIndexOf("-");
    const head = cut > 0 ? ref.slice(0, cut + 1) : null;
    if (head !== null && head === prefix) {
      out.push(ref.slice(cut + 1));
    } else {
      out.push(ref);
      prefix = head;
    }
  }
  return out.join(", ");
}

/** The KKF/BTW line under the contact lines, only when one of them is filled. */
export function registrationLine(issuer: InvoiceIssuer): string | null {
  const parts = [
    issuer.kkfNumber ? `${INVOICE_LABELS.kkf} ${issuer.kkfNumber}` : null,
    issuer.btwNumber ? `${INVOICE_LABELS.btwNumber} ${issuer.btwNumber}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The mark on the paper: CONCEPT, BETAALD dd-mm-jjjj or GEANNULEERD (or none). */
export function statusMark(
  status: InvoiceRenderStatus,
): { kind: "draft" | "paid" | "cancelled"; text: string; date?: string } | null {
  switch (status.status) {
    case "draft":
      return { kind: "draft", text: INVOICE_LABELS.draftMark };
    case "cancelled":
      return { kind: "cancelled", text: INVOICE_LABELS.cancelledMark };
    case "paid": {
      const date = status.paidAt ? formatDate(status.paidAt) : "";
      return {
        kind: "paid",
        text: fill(INVOICE_LABELS.paidMark, { date }).trim(),
        date,
      };
    }
    default:
      return null;
  }
}

/** '{invoice_number} - G&R Solutions' for the print routes' document.title. */
export function printTitle(model: Pick<InvoiceRenderModel, "meta">): string {
  return `${model.meta.invoiceNumber ?? INVOICE_LABELS.draftNumber} - G&R Solutions`;
}

/** True paper size in CSS px (96 dpi): Letter 816×1056, A4 794×1123. */
export const PAPER_PX: Record<PaperSize, { width: number; height: number }> = {
  Letter: { width: 816, height: 1056 },
  A4: { width: 794, height: 1123 },
};
