import type { CurrencyCode } from "@/lib/format";
import type { InvoiceLineType } from "@/lib/invoice/totals";

/**
 * The wording printed ON the invoice document (SPEC §35.11), verbatim from
 * G&R's Word template. These are not UI strings: an invoice always uses the
 * template's Dutch wording, also once the app gets another UI language
 * (SPEC §35.0), so they live here and not in i18n/nl.ts. Never "FACTUUR" or
 * "Factuurnummer".
 */
export const INVOICE_LABELS = {
  email: "Email:",
  phone: "Telefoon:",
  address: "Adres:",
  kkf: "KKF:",
  btwNumber: "BTW-nr:",
  customerName: "Naam klant:",
  customerCode: "Unieke code:",
  date: "Datum:",
  invoiceNumber: "Invoicenummer:",
  dueDate: "Vervaldatum:",
  reference: "Referentie:",
  items: "Items",
  weight: "Gewicht",
  pricePerLb: "Prijs per lbs",
  totalLbs: "Totaal lbs",
  totalPrice: "Totaal prijs",
  vatIncluded: "Waarvan BTW ({rate}%)",
  remarks: "OPMERKINGEN",
  paymentDetails: "BETALINGSGEGEVENS",
  accountNumber: "Rekeningnummer:",
  bank: "Bank:",
  paymentTerms: "BETALINGSVOORWAARDEN",
  paymentInstruction: "Factuurvaluta: {currency} · Vermeld bij betaling: {number} / {code}",
  draftNumber: "CONCEPT",
  draftMark: "CONCEPT",
  paidMark: "BETAALD {date}",
  /** The stamp's first line; the date prints under it. */
  paidWord: "BETAALD",
  cancelledMark: "GEANNULEERD",
  tracking: "Tracking: {tracking}",
  ref: "Ref: {reference}",
  /** An empty value in the payment block ("________________"). */
  blank: "________________",
} as const;

/** Column headers of the payment block, in this order (SPEC §35.11). */
export const BANK_COLUMNS: readonly { currency: CurrencyCode; label: string }[] = [
  { currency: "USD", label: "USD – Dollar" },
  { currency: "EUR", label: "EUR – Euro" },
  { currency: "SRD", label: "SRD" },
];

/**
 * Summary-row labels of the charge lines, in print order. Freight prints as
 * item rows ("Vrachtkosten" only as a subtotal when other rows exist); each
 * "other" line prints as its own row with its description.
 */
export const SUMMARY_LABELS: Record<Exclude<InvoiceLineType, "other">, string> & {
  other: string;
} = {
  freight: "Vrachtkosten",
  customs: "Inklaringskosten / douane",
  handling: "Handlingkosten",
  goods: "Goederen (aankoop)",
  service_fee: "Servicekosten",
  other: "Overige kosten: {description}",
  late_fee: "Opslag te late betaling",
  discount: "Korting",
};

export const SUMMARY_ORDER: readonly InvoiceLineType[] = [
  "customs",
  "handling",
  "goods",
  "service_fee",
  "other",
  "late_fee",
  "discount",
];

export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.hasOwn(vars, k) ? (vars[k] ?? m) : m,
  );
}
