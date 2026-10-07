import type { Database } from "@/integrations/supabase/types";

/**
 * Invoice totals exactly as the database computes them (SPEC §35.9,
 * private.recompute_invoice_totals in 20261006190200_billing.sql):
 *
 *   freight amount   = round(weight_lbs × rate_per_lb, 2)   (whatever the client sends)
 *   total_lbs        = Σ weight_lbs of freight lines
 *   subtotal_freight = Σ amount of freight lines
 *   total_charges    = Σ amount of every line except discounts
 *   total_discount   = −Σ amount of discount lines (a positive number)
 *   total_amount     = total_charges − total_discount (the database refuses < 0)
 *   vat_amount       = round(max(0, Σ amount of non-exempt lines) × rate / (100 + rate), 2),
 *                      null while the rate is null ("inclusief BTW": never added on top)
 *
 * round() on Postgres numeric is half away from zero. Everything here runs in
 * whole cents (and hundredths of a pound) with BigInt, so there is no binary
 * drift: 2,15 lbs × USD 3,50 = 7,525 → USD 7,53, as in SQL. The live preview
 * and the builder's validation use this; the database recomputes on every
 * line change and ignores totals a client sends.
 * supabase/tests/pglite/invoice_totals.test.ts proves TS == SQL.
 */

export type InvoiceLineType = Database["public"]["Enums"]["invoice_line_type"];

type Numeric = number | string;

export interface TotalsLine {
  lineType: InvoiceLineType;
  /** Freight only (numeric(10,2)); ignored for other line types. */
  weightLbs?: Numeric | null;
  /** Freight only (numeric(12,2)); ignored for other line types. */
  ratePerLb?: Numeric | null;
  /** Ignored for freight (recomputed); discounts are ≤ 0, everything else ≥ 0. */
  amount?: Numeric | null;
  vatExempt: boolean;
}

export interface InvoiceTotals {
  totalLbs: number;
  subtotalFreight: number;
  totalCharges: number;
  totalDiscount: number;
  /** May be negative here (a discount larger than the charges); the database refuses that. */
  totalAmount: number;
  /** null while no VAT rate is set. */
  vatAmount: number | null;
  vatRate: number | null;
  /** totalAmount < 0: the database would refuse the line that caused it. */
  negative: boolean;
}

const HUNDRED = 100n;

/**
 * A decimal with at most `places` decimals as a scaled BigInt ('12,5' is not
 * accepted: callers parse Dutch input first). null for null/empty; throws on
 * anything that is not a finite decimal with at most `places` decimals,
 * because the numeric(…, 2) columns would round it differently.
 */
export function toScaled(value: Numeric | null | undefined, places = 2): bigint | null {
  if (value === null || value === undefined) return null;
  let text = typeof value === "number" ? numberText(value) : value.trim();
  if (text === "") return null;
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) {
    throw new RangeError(`Not a decimal: ${String(value)}`);
  }
  const sign = m[1] === "-" ? -1n : 1n;
  let frac = m[3] ?? "";
  // Trailing zeros beyond the scale are harmless (PostgREST may send '4.500').
  frac = frac.replace(/0+$/, "");
  if (frac.length > places) {
    throw new RangeError(`More than ${places} decimals: ${String(value)}`);
  }
  text = `${m[2] || "0"}${frac.padEnd(places, "0")}`;
  return sign * BigInt(text);
}

// Plain decimal notation for a JS number (no exponent), e.g. 1e-7 → '0.0000001'.
function numberText(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`Not a finite number: ${n}`);
  const s = String(n);
  if (!/e/i.test(s)) return s;
  return n.toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
}

/** a / b rounded half away from zero (b > 0). */
function divHalfUp(a: bigint, b: bigint): bigint {
  const negative = a < 0n;
  const abs = negative ? -a : a;
  const q = (abs * 2n + b) / (2n * b);
  return negative ? -q : q;
}

const fromCents = (cents: bigint): number => Number(cents) / 100;

/** round(weight × rate, 2) in cents, as invoice_items_guard sets the freight amount. */
function freightCents(weightLbs: Numeric, ratePerLb: Numeric): bigint {
  const w = toScaled(weightLbs) ?? 0n; // hundredths of a pound
  const r = toScaled(ratePerLb) ?? 0n; // cents per pound
  return divHalfUp(w * r, HUNDRED);
}

/** The amount of a freight line: round(weight_lbs × rate_per_lb, 2). */
export function freightAmount(weightLbs: Numeric, ratePerLb: Numeric): number {
  return fromCents(freightCents(weightLbs, ratePerLb));
}

/** The amount a line ends up with in the database (freight recomputed, others as given). */
export function lineAmount(line: TotalsLine): number {
  return fromCents(lineCents(line));
}

function lineCents(line: TotalsLine): bigint {
  if (line.lineType === "freight") {
    return freightCents(line.weightLbs ?? 0, line.ratePerLb ?? 0);
  }
  return toScaled(line.amount ?? 0) ?? 0n;
}

/**
 * The totals of an invoice with these lines and this VAT rate (the invoice's
 * vat_rate: the live company setting for drafts, frozen at issue).
 */
export function computeInvoiceTotals(
  lines: readonly TotalsLine[],
  vatRate: Numeric | null,
): InvoiceTotals {
  let lbs = 0n;
  let freight = 0n;
  let charges = 0n;
  let discount = 0n;
  let vatBase = 0n;
  for (const line of lines) {
    const cents = lineCents(line);
    if (line.lineType === "freight") {
      lbs += toScaled(line.weightLbs ?? 0) ?? 0n;
      freight += cents;
    }
    if (line.lineType === "discount") discount -= cents;
    else charges += cents;
    if (!line.vatExempt) vatBase += cents;
  }
  const total = charges - discount;
  const rate = toScaled(vatRate);
  let vat: bigint | null = null;
  if (rate !== null) {
    // vat_base × (R/100) / (100 + R/100), in cents: base × R / (10000 + R).
    const base = vatBase > 0n ? vatBase : 0n;
    vat = divHalfUp(base * rate, 10_000n + rate);
  }
  return {
    totalLbs: fromCents(lbs),
    subtotalFreight: fromCents(freight),
    totalCharges: fromCents(charges),
    totalDiscount: fromCents(discount),
    totalAmount: fromCents(total),
    vatAmount: vat === null ? null : fromCents(vat),
    vatRate: rate === null ? null : fromCents(rate),
    negative: total < 0n,
  };
}

/**
 * "Opslag te late betaling" as apply_late_fee computes it (SPEC §35.10):
 * round(balance × late_fee_percent / 100, 2), half away from zero. The
 * dialog shows this amount before the admin confirms; the database computes
 * it again from the balance at that moment.
 */
export function lateFeeAmount(balance: Numeric, percent: Numeric): number {
  const cents = toScaled(balance) ?? 0n;
  const pct = toScaled(percent) ?? 0n; // hundredths of a percent
  // cents × (pct/100) / 100 = cents × pct / 10000
  return fromCents(divHalfUp(cents * pct, 10_000n));
}

/** Sum of amounts in cents (exact), e.g. the summary rows per line type. */
export function sumAmounts(amounts: readonly Numeric[]): number {
  let cents = 0n;
  for (const a of amounts) cents += toScaled(a) ?? 0n;
  return fromCents(cents);
}
