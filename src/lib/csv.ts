import { formatDate, formatDateTime, roundHalfUp, todayInSuriname } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * CSV files for Dutch Excel ("Exporteer CSV", SPEC §35.15), built in the
 * browser from what the signed-in user may read (RLS):
 *
 * - UTF-8 with a byte order mark, so Excel shows "é", "ë" and "€" right;
 * - ';' between fields (Dutch Excel's list separator: ',' is the decimal
 *   sign), CRLF line ends, every row the same number of fields;
 * - numbers with a decimal comma and no thousands separator ("1234,50"),
 *   so Excel reads them as numbers;
 * - dates dd-mm-jjjj, instants dd-mm-jjjj uu:mm in Suriname time;
 * - a field with ';', '"' or a line break is quoted, quotes doubled;
 * - text that Excel would run as a formula (starting with = + - @, a tab or
 *   a carriage return) gets a leading apostrophe (CSV injection);
 * - identifiers that Excel would turn into numbers (tracking numbers of 20+
 *   digits, leading zeros, "+597 …") are written as ="…", so they stay text.
 */

export const CSV_BOM = "﻿";
export const CSV_SEPARATOR = ";";
export const CSV_EOL = "\r\n";

/**
 * - text: free text (names, descriptions, JSON);
 * - code: an identifier that must stay text (GR code, tracking, phone);
 * - decimal: money, weights (`decimals`, default 2);
 * - integer: counts;
 * - date: a Postgres date or an instant, as dd-mm-jjjj;
 * - datetime: an instant as dd-mm-jjjj uu:mm (Suriname);
 * - boolean: "ja" / "nee".
 */
export type CsvKind = "text" | "code" | "decimal" | "integer" | "date" | "datetime" | "boolean";

export interface CsvColumn<T> {
  header: string;
  kind?: CsvKind;
  /** For `decimal`: places after the comma (default 2). */
  decimals?: number;
  value: (row: T) => unknown;
}

const isBlank = (value: unknown) =>
  value === null || value === undefined || (typeof value === "string" && value.trim() === "");

function finiteNumber(value: unknown): number | null {
  if (isBlank(value)) return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

/** 1234.5 → "1234,50"; -12.345 → "-12,35" (half away from zero); blank → "". */
export function csvDecimal(value: unknown, decimals = 2): string {
  const n = finiteNumber(value);
  if (n === null) return "";
  const rounded = roundHalfUp(n, decimals);
  const text = Math.abs(rounded).toFixed(decimals).replace(".", ",");
  return rounded < 0 ? `-${text}` : text;
}

/** 12 → "12"; 12.6 → "13"; blank → "". */
export function csvInteger(value: unknown): string {
  const n = finiteNumber(value);
  return n === null ? "" : String(roundHalfUp(n, 0));
}

/** '2026-10-07' or an instant → "07-10-2026"; blank or not a date → "". */
export function csvDate(value: unknown): string {
  if (isBlank(value) || (typeof value !== "string" && !(value instanceof Date))) return "";
  try {
    return formatDate(value);
  } catch {
    return "";
  }
}

/** An instant → "07-10-2026 14:05" (Suriname time); blank or not a date → "". */
export function csvDateTime(value: unknown): string {
  if (isBlank(value) || (typeof value !== "string" && !(value instanceof Date))) return "";
  try {
    return formatDateTime(value);
  } catch {
    return "";
  }
}

/** true → "ja", false → "nee", anything else empty. */
export function csvBoolean(value: unknown): string {
  if (value === true) return t("admin.exports.yes");
  if (value === false) return t("admin.exports.no");
  return "";
}

/** Characters that make Excel (or LibreOffice) read a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Free text; objects become JSON. A formula-like start gets an apostrophe. */
export function csvText(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "string"
      ? value
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** Digits with at most a leading "+" and inner spaces or dashes: Excel would make a number of it. */
const NUMBER_LIKE = /^\+?\d[\d -]*$/;

/**
 * An identifier: "00123", "9400111899223397658538" or "+597 889 7500"
 * become ="…" (a text formula of digits only, so Excel keeps every digit);
 * anything else is text.
 */
export function csvCode(value: unknown): string {
  if (isBlank(value)) return "";
  const text = String(value).trim();
  return NUMBER_LIKE.test(text) ? `="${text}"` : csvText(text);
}

/** Quotes a field when it holds the separator, a quote or a line break (RFC 4180). */
export function escapeCsvField(field: string): string {
  return /[";\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

export function formatCsvValue(value: unknown, kind: CsvKind = "text", decimals = 2): string {
  switch (kind) {
    case "code":
      return csvCode(value);
    case "decimal":
      return csvDecimal(value, decimals);
    case "integer":
      return csvInteger(value);
    case "date":
      return csvDate(value);
    case "datetime":
      return csvDateTime(value);
    case "boolean":
      return csvBoolean(value);
    default:
      return csvText(value);
  }
}

/** The whole file: BOM, header row, one row per item, CRLF after every row. */
export function buildCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  const line = (fields: string[]) => fields.map(escapeCsvField).join(CSV_SEPARATOR);
  const lines = [line(columns.map((c) => csvText(c.header)))];
  for (const row of rows) {
    lines.push(line(columns.map((c) => formatCsvValue(c.value(row), c.kind, c.decimals))));
  }
  return `${CSV_BOM}${lines.join(CSV_EOL)}${CSV_EOL}`;
}

/** "gr-klanten-2026-10-07.csv": the Suriname date, so the files sort by day. */
export function csvFileName(name: string, today: string = todayInSuriname()): string {
  const safe = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `gr-${safe}-${today}.csv`;
}

/** Hands the file to the browser as a download (nothing is uploaded or stored). */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Some browsers start the download after the click returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
