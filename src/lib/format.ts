import type { Database } from "@/integrations/supabase/types";

export type CurrencyCode = Database["public"]["Enums"]["currency_code"];

/** Business time zone (SPEC §35.3): UTC−3, no DST. */
export const BUSINESS_TIME_ZONE = "America/Paramaribo";

type Numeric = number | string;
type DateInput = string | Date;

function toNumber(value: Numeric): number {
  const n = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isFinite(n)) throw new RangeError(`Not a finite number: ${String(value)}`);
  return n;
}

// Decimal shift via exponent notation avoids binary drift (1.005 * 100 = 100.49999…).
function shift(n: number, places: number): number {
  const [mantissa, exponent = "0"] = String(n).split("e");
  return Number(`${mantissa}e${Number(exponent) + places}`);
}

/** Rounds half away from zero to `decimals` places, as SQL numeric round() does. */
export function roundHalfUp(value: Numeric, decimals = 2): number {
  const n = toNumber(value);
  const rounded = shift(Math.round(shift(Math.abs(n), decimals)), -decimals);
  return n < 0 && rounded !== 0 ? -rounded : rounded;
}

/** '1234.5' → '1.234,50' (Dutch separators, fixed decimals, no sign handling beyond '-'). */
export function formatNumber(value: Numeric, decimals = 2): string {
  const rounded = roundHalfUp(value, decimals);
  const [int = "0", frac = ""] = Math.abs(rounded).toFixed(decimals).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sign = rounded < 0 ? "-" : "";
  return decimals > 0 ? `${sign}${grouped},${frac}` : `${sign}${grouped}`;
}

/** formatMoney(1234.56, 'USD') → 'USD 1.234,56'; negatives → '– USD 10,00' (SPEC §35.10/§35.11). */
export function formatMoney(amount: Numeric, currency: CurrencyCode): string {
  const rounded = roundHalfUp(amount, 2);
  const body = `${currency} ${formatNumber(Math.abs(rounded), 2)}`;
  return rounded < 0 ? `– ${body}` : body;
}

/** formatLbs(12.5) → '12,50 lbs'. */
export function formatLbs(weight: Numeric): string {
  return `${formatNumber(weight, 2)} lbs`;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function surinameParts(instant: Date) {
  if (Number.isNaN(instant.getTime())) throw new RangeError("Invalid date");
  const parts: Record<string, string> = {};
  for (const p of partsFormatter.formatToParts(instant)) parts[p.type] = p.value;
  return {
    year: parts["year"] ?? "",
    month: parts["month"] ?? "",
    day: parts["day"] ?? "",
    hour: parts["hour"] ?? "",
    minute: parts["minute"] ?? "",
  };
}

/**
 * dd-mm-jjjj. A 'YYYY-MM-DD' string (a Postgres `date`) is printed as-is; an
 * instant (timestamptz string or Date) is shown as its date in Suriname.
 */
export function formatDate(value: DateInput): string {
  if (typeof value === "string") {
    const m = DATE_ONLY.exec(value);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  const p = surinameParts(typeof value === "string" ? new Date(value) : value);
  return `${p.day}-${p.month}-${p.year}`;
}

/** dd-mm-jjjj uu:mm in Suriname time, for timestamptz values. */
export function formatDateTime(value: DateInput): string {
  const p = surinameParts(typeof value === "string" ? new Date(value) : value);
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}`;
}

/** Today's date in Suriname as 'YYYY-MM-DD', matching SQL `(now() at time zone 'America/Paramaribo')::date`. */
export function todayInSuriname(now: Date = new Date()): string {
  const p = surinameParts(now);
  return `${p.year}-${p.month}-${p.day}`;
}
