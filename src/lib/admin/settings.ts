import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { Constants, type Database } from "@/integrations/supabase/types";
import { optionalEmail, optionalText } from "@/lib/admin/customer-actions";
import { parseCustomerCode } from "@/lib/admin/orders";
import { CodedError } from "@/lib/errors";
import { formatNumber, type CurrencyCode } from "@/lib/format";
import { t, type PlainTranslationKey } from "@/lib/i18n";

/**
 * Admin settings (SPEC §35.8, /admin/instellingen): company_settings (the
 * singleton), bank accounts, US warehouse addresses, service rates and the
 * two counters. Readable by staff, writable by admins only: RLS and the
 * RPC guards decide, the page only follows. Every change is audited by the
 * database (audit_row triggers; the counter RPCs write their own entry).
 * Apart from the page so the PGlite contract tests run this code unchanged.
 */

type Client = Pick<SupabaseClient<Database>, "rpc" | "from">;
type Tables = Database["public"]["Tables"];
export type CompanySettings = Tables["company_settings"]["Row"];
export type BankAccount = Pick<
  Tables["company_bank_accounts"]["Row"],
  "id" | "currency" | "bank_name" | "account_holder" | "account_number" | "sort_order" | "is_active"
>;
export type WarehouseAddressRow = Tables["warehouse_addresses"]["Row"];
export type ServiceRate = Tables["service_rates"]["Row"];
export type ServiceType = Database["public"]["Enums"]["service_type"];
export type WeightRounding = Database["public"]["Enums"]["weight_rounding"];

export const CURRENCIES = Constants.public.Enums.currency_code;
export const PAPER_SIZES = Constants.public.Enums.paper_size;
export const SERVICE_TYPES = Constants.public.Enums.service_type;
export const WEIGHT_ROUNDINGS = Constants.public.Enums.weight_rounding;

/** "Nog niet ingesteld" stands for null and empty text (SPEC §35.8). */
export const isUnset = (value: unknown) =>
  value === null || value === undefined || (typeof value === "string" && value.trim() === "");

// ---------------------------------------------------------------------------
// Numbers as staff type them: "15", "15,5" or "15.50"
// ---------------------------------------------------------------------------

const DECIMAL = /^\d{1,9}(?:[.,]\d{1,2})?$/;
const INTEGER = /^\d{1,9}$/;

/** '12,50' → 12.5; null when it is not a number with at most 2 decimals. */
export function parseDecimalInput(value: string): number | null {
  const text = value.trim().replace(/\s/g, "");
  if (!DECIMAL.test(text)) return null;
  return Number(text.replace(",", "."));
}

/** A number as an input value in Dutch notation: 15 → '15', 12.5 → '12,5'. */
export function decimalInputValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(".", ",");
}

const integerField = (min: number, max: number) =>
  z
    .string()
    .trim()
    .refine(
      (v) => INTEGER.test(v) && Number(v) >= min && Number(v) <= max,
      t("admin.settings.form.integerRange", {
        min: formatNumber(min, 0),
        max: formatNumber(max, 0),
      }),
    )
    .transform(Number);

const decimalField = (min: number, max: number, required: boolean) => {
  const message = t("admin.settings.form.decimalRange", {
    min: formatNumber(min, 0),
    max: formatNumber(max, 0),
  });
  return z
    .string()
    .trim()
    .superRefine((v, ctx) => {
      if (v === "") {
        if (required) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: t("admin.settings.form.required") });
        }
        return;
      }
      const n = parseDecimalInput(v);
      if (n === null || n < min || n > max) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    })
    .transform((v) => (v === "" ? null : parseDecimalInput(v)));
};

const requiredText = (max: number) =>
  z
    .string()
    .trim()
    .min(1, t("admin.settings.form.required"))
    .max(max, t("auth.validation.tooLong", { max }));

/** '' stays '' (a NOT NULL column that may be empty, such as the invoice prefix). */
const plainText = (max: number) =>
  z.string().trim().max(max, t("auth.validation.tooLong", { max }));

const switchField = z.enum(["true", "false"]).transform((v) => v === "true");

// ---------------------------------------------------------------------------
// company_settings, in sections
// ---------------------------------------------------------------------------

export type FieldKind =
  "text" | "textarea" | "markdown" | "email" | "integer" | "decimal" | "select" | "switch";

/** The company_settings columns the page edits. */
export type SettingKey = Exclude<
  keyof CompanySettings,
  "id" | "created_at" | "updated_at" | "updated_by"
>;

export interface SettingField {
  key: SettingKey;
  kind: FieldKind;
  label: PlainTranslationKey;
  hint?: PlainTranslationKey;
  /** Shown after a number: "dagen", "%". */
  unit?: PlainTranslationKey;
  options?: readonly { value: string; label: PlainTranslationKey }[];
  schema: z.ZodType<string | number | boolean | null, z.ZodTypeDef, string>;
}

export type SettingsSectionId =
  | "bedrijf"
  | "facturen"
  | "herinneringen"
  | "werkwijze"
  | "afhalen"
  | "teksten"
  | "nummering"
  | "bankrekeningen"
  | "us-adressen"
  | "tarieven";

export interface SettingsSection {
  id: SettingsSectionId;
  title: PlainTranslationKey;
  intro?: PlainTranslationKey;
  fields: readonly SettingField[];
}

const currencyOptions = CURRENCIES.map((c) => ({
  value: c,
  label: `admin.settings.currencies.${c}` as const,
}));

export const COMPANY_SECTIONS: readonly SettingsSection[] = [
  {
    id: "bedrijf",
    title: "admin.settings.sections.bedrijf",
    intro: "admin.settings.intros.bedrijf",
    fields: [
      {
        key: "company_name",
        kind: "text",
        label: "admin.settings.fields.company_name",
        schema: requiredText(200),
      },
      {
        key: "tagline",
        kind: "text",
        label: "admin.settings.fields.tagline",
        schema: optionalText(200),
      },
      { key: "email", kind: "email", label: "admin.settings.fields.email", schema: optionalEmail },
      {
        key: "phone",
        kind: "text",
        label: "admin.settings.fields.phone",
        hint: "admin.settings.hints.phone",
        schema: optionalText(50),
      },
      {
        key: "address",
        kind: "text",
        label: "admin.settings.fields.address",
        schema: optionalText(500),
      },
      {
        key: "kkf_number",
        kind: "text",
        label: "admin.settings.fields.kkf_number",
        hint: "admin.settings.hints.kkfBtw",
        schema: optionalText(50),
      },
      {
        key: "btw_number",
        kind: "text",
        label: "admin.settings.fields.btw_number",
        hint: "admin.settings.hints.kkfBtw",
        schema: optionalText(50),
      },
    ],
  },
  {
    id: "facturen",
    title: "admin.settings.sections.facturen",
    intro: "admin.settings.intros.facturen",
    fields: [
      {
        key: "invoice_title",
        kind: "text",
        label: "admin.settings.fields.invoice_title",
        hint: "admin.settings.hints.invoice_title",
        schema: requiredText(200),
      },
      {
        key: "footer_text",
        kind: "text",
        label: "admin.settings.fields.footer_text",
        hint: "admin.settings.hints.footer_text",
        schema: optionalText(300),
      },
      {
        key: "payment_terms_text",
        kind: "textarea",
        label: "admin.settings.fields.payment_terms_text",
        hint: "admin.settings.hints.payment_terms_text",
        schema: optionalText(2000),
      },
      {
        key: "payment_term_days",
        kind: "integer",
        label: "admin.settings.fields.payment_term_days",
        hint: "admin.settings.hints.payment_term_days",
        unit: "admin.settings.units.days",
        schema: integerField(0, 365),
      },
      {
        key: "late_fee_percent",
        kind: "decimal",
        label: "admin.settings.fields.late_fee_percent",
        hint: "admin.settings.hints.late_fee_percent",
        unit: "admin.settings.units.percent",
        schema: decimalField(0, 100, true),
      },
      {
        key: "default_currency",
        kind: "select",
        label: "admin.settings.fields.default_currency",
        options: currencyOptions,
        schema: z.enum(CURRENCIES),
      },
      {
        key: "vat_rate_percent",
        kind: "decimal",
        label: "admin.settings.fields.vat_rate_percent",
        hint: "admin.settings.hints.vat_rate_percent",
        unit: "admin.settings.units.percent",
        schema: decimalField(0, 100, false),
      },
      {
        key: "show_vat_breakdown",
        kind: "switch",
        label: "admin.settings.fields.show_vat_breakdown",
        hint: "admin.settings.hints.show_vat_breakdown",
        schema: switchField,
      },
      {
        key: "invoice_number_prefix",
        kind: "text",
        label: "admin.settings.fields.invoice_number_prefix",
        hint: "admin.settings.hints.invoice_number_prefix",
        schema: plainText(20).refine((v) => !/\s/.test(v), t("admin.settings.form.noSpaces")),
      },
      {
        key: "paper_size",
        kind: "select",
        label: "admin.settings.fields.paper_size",
        options: PAPER_SIZES.map((p) => ({
          value: p,
          label: `admin.settings.paperSizes.${p}` as const,
        })),
        schema: z.enum(PAPER_SIZES),
      },
    ],
  },
  {
    id: "herinneringen",
    title: "admin.settings.sections.herinneringen",
    intro: "admin.settings.intros.herinneringen",
    fields: [
      {
        key: "due_soon_days",
        kind: "integer",
        label: "admin.settings.fields.due_soon_days",
        hint: "admin.settings.hints.due_soon_days",
        unit: "admin.settings.units.days",
        schema: integerField(0, 60),
      },
      {
        key: "overdue_reminder_interval_days",
        kind: "integer",
        label: "admin.settings.fields.overdue_reminder_interval_days",
        hint: "admin.settings.hints.overdue_reminder_interval_days",
        unit: "admin.settings.units.days",
        schema: integerField(1, 365),
      },
      {
        key: "max_overdue_reminders",
        kind: "integer",
        label: "admin.settings.fields.max_overdue_reminders",
        hint: "admin.settings.hints.max_overdue_reminders",
        schema: integerField(0, 50),
      },
    ],
  },
  {
    id: "werkwijze",
    title: "admin.settings.sections.werkwijze",
    intro: "admin.settings.intros.werkwijze",
    fields: [
      {
        key: "public_signup_enabled",
        kind: "switch",
        label: "admin.settings.fields.public_signup_enabled",
        hint: "admin.settings.hints.public_signup_enabled",
        schema: switchField,
      },
      {
        key: "pay_before_pickup",
        kind: "switch",
        label: "admin.settings.fields.pay_before_pickup",
        hint: "admin.settings.hints.pay_before_pickup",
        schema: switchField,
      },
      {
        key: "delivery_available",
        kind: "switch",
        label: "admin.settings.fields.delivery_available",
        hint: "admin.settings.hints.delivery_available",
        schema: switchField,
      },
      {
        key: "max_open_orders_per_customer",
        kind: "integer",
        label: "admin.settings.fields.max_open_orders_per_customer",
        hint: "admin.settings.hints.max_open_orders_per_customer",
        schema: integerField(1, 10000),
      },
    ],
  },
  {
    id: "afhalen",
    title: "admin.settings.sections.afhalen",
    intro: "admin.settings.intros.afhalen",
    fields: [
      {
        key: "pickup_address",
        kind: "text",
        label: "admin.settings.fields.pickup_address",
        schema: optionalText(500),
      },
      {
        key: "pickup_hours",
        kind: "textarea",
        label: "admin.settings.fields.pickup_hours",
        hint: "admin.settings.hints.pickup_hours",
        schema: optionalText(500),
      },
      {
        key: "pickup_instructions",
        kind: "textarea",
        label: "admin.settings.fields.pickup_instructions",
        hint: "admin.settings.hints.pickup_instructions",
        schema: optionalText(1000),
      },
    ],
  },
  {
    id: "teksten",
    title: "admin.settings.sections.teksten",
    intro: "admin.settings.intros.teksten",
    fields: [
      {
        key: "terms_markdown",
        kind: "markdown",
        label: "admin.settings.fields.terms_markdown",
        hint: "admin.settings.hints.markdown",
        schema: optionalText(50000),
      },
      {
        key: "terms_version",
        kind: "text",
        label: "admin.settings.fields.terms_version",
        hint: "admin.settings.hints.terms_version",
        schema: requiredText(50),
      },
      {
        key: "prohibited_goods_markdown",
        kind: "markdown",
        label: "admin.settings.fields.prohibited_goods_markdown",
        hint: "admin.settings.hints.markdown",
        schema: optionalText(50000),
      },
    ],
  },
];

export type SectionValues = Record<string, string>;

/** A column as the form shows it: null → '', booleans 'true'/'false', numbers with a comma. */
export function settingInputValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return decimalInputValue(value);
  return String(value);
}

export function sectionInputValues(
  section: SettingsSection,
  settings: CompanySettings,
): SectionValues {
  return Object.fromEntries(section.fields.map((f) => [f.key, settingInputValue(settings[f.key])]));
}

export type SectionPatch = Partial<Pick<CompanySettings, SettingKey>>;

export type SectionParse =
  { ok: true; values: SectionPatch } | { ok: false; errors: Partial<Record<SettingKey, string>> };

/**
 * Validates a section; every error at once. Rules over several fields are
 * checked in the same pass (a BTW breakdown needs a BTW rate), so they too
 * show on the first submit.
 */
export function parseSection(section: SettingsSection, values: SectionValues): SectionParse {
  const errors: Partial<Record<SettingKey, string>> = {};
  const parsed: Record<string, unknown> = {};
  for (const field of section.fields) {
    const result = field.schema.safeParse(values[field.key] ?? "");
    if (result.success) parsed[field.key] = result.data;
    else errors[field.key] = result.error.issues[0]?.message ?? t("admin.settings.form.invalid");
  }
  if (
    section.id === "facturen" &&
    parsed["show_vat_breakdown"] === true &&
    "vat_rate_percent" in parsed &&
    parsed["vat_rate_percent"] === null &&
    !errors.vat_rate_percent
  ) {
    errors.vat_rate_percent = t("admin.settings.invoice.vatRequired");
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: parsed as SectionPatch };
}

/** Only the columns that really change, so the audit log names what changed. */
export function changedSettings(patch: SectionPatch, current: CompanySettings): SectionPatch {
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const before = current[key as SettingKey] as unknown;
    const same =
      typeof value === "number" && before !== null && before !== undefined
        ? Number(before) === value
        : (before ?? null) === (value ?? null);
    if (!same) changed[key] = value;
  }
  return changed as SectionPatch;
}

/** The singleton (staff and active customers may read it; RLS). */
export async function loadCompanySettings(db: Client): Promise<CompanySettings> {
  const { data, error } = await db.from("company_settings").select("*").eq("id", true).single();
  if (error) throw error;
  return data;
}

/** No row came back: RLS hid it from a non-admin (UPDATE policy: is_admin). */
function adminOnly(error: { code?: string } | null): never | void {
  if (error?.code === "PGRST116") throw new CodedError(t("admin.settings.adminOnly"), "42501");
}

/**
 * Saves the changed columns of one section with the admin's own client
 * (company_settings_update: admins only; the audit trigger records them).
 * Returns null when nothing changed.
 */
export async function saveCompanySettings(
  db: Client,
  patch: SectionPatch,
  current: CompanySettings,
): Promise<CompanySettings | null> {
  const changed = changedSettings(patch, current);
  if (Object.keys(changed).length === 0) return null;
  const { data, error } = await db
    .from("company_settings")
    .update(changed)
    .eq("id", true)
    .select("*")
    .single();
  if (error) {
    adminOnly(error);
    throw error;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Payment terms text vs. the numbers (SPEC §35.8: a warning, not a block)
// ---------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  een: 1,
  één: 1,
  twee: 2,
  drie: 3,
  vier: 4,
  vijf: 5,
  zes: 6,
  zeven: 7,
  acht: 8,
  negen: 9,
  tien: 10,
  veertien: 14,
  dertig: 30,
};

const PERIOD =
  /(\d{1,3}|een|één|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|veertien|dertig)\s*(dagen|dag|weken|week|maanden|maand)\b/giu;
const PERCENT = /(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:%|procent\b)/giu;

/** The periods ("1 week" → 7) and percentages a payment terms text mentions. */
export function termsTextFigures(text: string): { days: number[]; percents: number[] } {
  const days: number[] = [];
  for (const m of text.matchAll(PERIOD)) {
    const word = (m[1] ?? "").toLowerCase();
    const n = NUMBER_WORDS[word] ?? Number(word);
    const unit = (m[2] ?? "").toLowerCase();
    days.push(unit.startsWith("we") ? n * 7 : unit.startsWith("maand") ? n * 30 : n);
  }
  const percents = [...text.matchAll(PERCENT)].map((m) => Number((m[1] ?? "").replace(",", ".")));
  return { days, percents };
}

/**
 * Warnings when the printed text disagrees with the numbers the system
 * uses: "binnen 1 week" with a term of 14 days, or "15%" with a late fee of
 * 10%. Only figures the text actually mentions are compared.
 */
export function paymentTermsWarnings(
  text: string | null,
  termDays: number | null,
  lateFeePercent: number | null,
): string[] {
  if (!text?.trim()) return [];
  const { days, percents } = termsTextFigures(text);
  const warnings: string[] = [];
  if (termDays !== null && days.length > 0 && !days.includes(termDays)) {
    warnings.push(
      t("admin.settings.invoice.termsDaysMismatch", {
        text: days.map((d) => t("admin.settings.invoice.daysValue", { days: d })).join(", "),
        days: termDays,
      }),
    );
  }
  if (lateFeePercent !== null && percents.length > 0 && !percents.includes(lateFeePercent)) {
    warnings.push(
      t("admin.settings.invoice.termsPercentMismatch", {
        text: percents.map((p) => `${formatNumber(p, p % 1 === 0 ? 0 : 2)}%`).join(", "),
        percent: formatNumber(lateFeePercent, lateFeePercent % 1 === 0 ? 0 : 2),
      }),
    );
  }
  return warnings;
}

/** Placeholder texts of the seed (SPEC §35.8: never generated legal text). */
export const isPlaceholderText = (text: string | null | undefined) =>
  isUnset(text) || /^_?placeholder\b/i.test((text ?? "").trim());

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

/** `{prefix}{YYYY}-{NNNN}` as issue_invoice makes it; from 10000 on just more digits. */
export function formatInvoiceNumber(prefix: string, year: number, n: number): string {
  const digits = n > 9999 ? String(n) : String(n).padStart(4, "0");
  return `${prefix}${year}-${digits}`;
}

export const invoiceCounterSchema = z.object({ lastNumber: integerField(0, 99_999_999) });

/** The counter of a year (admins only; RLS gives staff no rows). 0 when the year has none yet. */
export async function loadInvoiceCounter(db: Client, year: number): Promise<number> {
  const { data, error } = await db
    .from("invoice_number_counters")
    .select("last_number")
    .eq("year", year)
    .maybeSingle();
  if (error) throw error;
  return data?.last_number ?? 0;
}

/**
 * The first invoice number handed out in a year, or null: once there is
 * one, set_invoice_counter refuses that year (the numbering is fixed).
 */
export async function firstIssuedInvoice(db: Client, year: number): Promise<string | null> {
  const { data, error } = await db
    .from("invoices")
    .select("invoice_number")
    .not("invoice_number", "is", null)
    .gte("invoice_date", `${year}-01-01`)
    .lte("invoice_date", `${year}-12-31`)
    .order("invoice_number")
    .limit(1);
  if (error) throw error;
  return data[0]?.invoice_number ?? null;
}

/** set_invoice_counter (admin): continue G&R's existing numbering for a year. */
export async function setInvoiceCounter(db: Client, year: number, lastNumber: number) {
  const { data, error } = await db.rpc("set_invoice_counter", {
    _year: year,
    _last_number: lastNumber,
  });
  if (error) throw error;
  return data;
}

/** "GR00150", "gr 150" or "150" → 150; the rules are the database's (above every number used). */
export const nextCustomerNumberSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, t("admin.settings.form.required"))
    .refine((v) => parseCustomerCode(v) !== null, t("admin.customers.form.codeInvalid"))
    .transform((v) => Number((parseCustomerCode(v) ?? "GR0").slice(2))),
});

/** set_next_customer_number (admin); returns the number now next. */
export async function setNextCustomerNumber(db: Client, next: number): Promise<number> {
  const { data, error } = await db.rpc("set_next_customer_number", { _next: next });
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Bank accounts (one active account per currency; SPEC §35.8, §35.11)
// ---------------------------------------------------------------------------

export const BANK_ACCOUNT_COLUMNS =
  "id, currency, bank_name, account_holder, account_number, sort_order, is_active" as const;

export const bankAccountSchema = z.object({
  bankName: optionalText(200),
  accountHolder: optionalText(200),
  accountNumber: optionalText(100),
});
export type BankAccountValues = z.input<typeof bankAccountSchema>;
export type BankAccountData = z.output<typeof bankAccountSchema>;

/** The active account of each currency (the invoice prints exactly one per currency). */
export function activeAccountByCurrency(
  accounts: readonly BankAccount[],
): Map<CurrencyCode, BankAccount> {
  const map = new Map<CurrencyCode, BankAccount>();
  for (const account of accounts) if (account.is_active) map.set(account.currency, account);
  return map;
}

/**
 * Currencies whose account cannot be printed yet: no active row, or no
 * account number or bank (the invoice's "Rekeningnummer:" and "Bank:").
 */
export function incompleteBankCurrencies(accounts: readonly BankAccount[]): CurrencyCode[] {
  const active = activeAccountByCurrency(accounts);
  return CURRENCIES.filter((c) => {
    const a = active.get(c);
    return !a || isUnset(a.account_number) || isUnset(a.bank_name);
  });
}

/**
 * What "{currency} opslaan" would do: nothing (no field changed), make a
 * complete account incomplete (new invoices then print "________" instead of
 * the account: the page asks first), or an ordinary save.
 */
export function bankAccountChange(
  account: Pick<BankAccount, "bank_name" | "account_holder" | "account_number"> | null,
  values: BankAccountData,
): "unchanged" | "emptied" | "save" {
  const norm = (v: string | null | undefined) => (isUnset(v) ? null : String(v).trim());
  const before = {
    bankName: norm(account?.bank_name),
    accountHolder: norm(account?.account_holder),
    accountNumber: norm(account?.account_number),
  };
  if (
    before.bankName === values.bankName &&
    before.accountHolder === values.accountHolder &&
    before.accountNumber === values.accountNumber
  ) {
    return "unchanged";
  }
  const wasComplete = before.bankName !== null && before.accountNumber !== null;
  const willBeComplete = values.bankName !== null && values.accountNumber !== null;
  return wasComplete && !willBeComplete ? "emptied" : "save";
}

export async function saveBankAccount(
  db: Client,
  target: { id: string | null; currency: CurrencyCode },
  values: BankAccountData,
): Promise<BankAccount> {
  const row = {
    bank_name: values.bankName,
    account_holder: values.accountHolder,
    account_number: values.accountNumber,
  };
  const query = target.id
    ? db.from("company_bank_accounts").update(row).eq("id", target.id)
    : db.from("company_bank_accounts").insert({
        ...row,
        currency: target.currency,
        sort_order: CURRENCIES.indexOf(target.currency) + 1,
      });
  const { data, error } = await query.select(BANK_ACCOUNT_COLUMNS).single();
  if (error) {
    adminOnly(error);
    throw error;
  }
  return data;
}

// ---------------------------------------------------------------------------
// US warehouse addresses (SPEC §35.8; never invented or seeded)
// ---------------------------------------------------------------------------

export const ADDRESS_PLACEHOLDERS = ["{FULL_NAME}", "{GR_CODE}"] as const;

/** For texts that mention the placeholders literally ("gebruik {FULL_NAME} …"). */
export const PLACEHOLDER_VARS = { FULL_NAME: "{FULL_NAME}", GR_CODE: "{GR_CODE}" } as const;

/** {SOMETHING} that the portal would not fill in. */
export function unknownPlaceholders(template: string): string[] {
  const found = template.match(/\{[^{}]*\}/g) ?? [];
  return [
    ...new Set(found.filter((p) => !(ADDRESS_PLACEHOLDERS as readonly string[]).includes(p))),
  ];
}

const addressTemplate = (max: number) =>
  requiredText(max).superRefine((v, ctx) => {
    const unknown = unknownPlaceholders(v);
    if (unknown.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: t("admin.settings.warehouse.unknownPlaceholder", {
          ...PLACEHOLDER_VARS,
          found: unknown.join(", "),
        }),
      });
    }
  });

export const warehouseAddressSchema = z.object({
  label: requiredText(100),
  serviceType: z.enum(SERVICE_TYPES),
  recipientTemplate: addressTemplate(200),
  line1: requiredText(200),
  line2Template: addressTemplate(200),
  city: requiredText(100),
  state: requiredText(50),
  zip: requiredText(20),
  country: requiredText(100),
  phone: optionalText(50),
  active: switchField,
});
export type WarehouseAddressValues = z.input<typeof warehouseAddressSchema>;
export type WarehouseAddressData = z.output<typeof warehouseAddressSchema>;

/** New address: the column defaults of warehouse_addresses. */
export const EMPTY_WAREHOUSE_ADDRESS: WarehouseAddressValues = {
  label: "",
  serviceType: "air",
  recipientTemplate: "{FULL_NAME} {GR_CODE}",
  line1: "",
  line2Template: "{GR_CODE}",
  city: "",
  state: "",
  zip: "",
  country: "USA",
  phone: "",
  active: "true",
};

export function warehouseInputValues(row: WarehouseAddressRow): WarehouseAddressValues {
  return {
    label: row.label,
    serviceType: row.service_type,
    recipientTemplate: row.recipient_name_template,
    line1: row.address_line1,
    line2Template: row.address_line2_template,
    city: row.city,
    state: row.state,
    zip: row.zip,
    country: row.country,
    phone: row.phone ?? "",
    active: row.is_active ? "true" : "false",
  };
}

/**
 * The customer must write the GR code behind the name AND on address line 2
 * (SPEC §35.8); a template without it is allowed, with a warning.
 */
export function warehouseWarnings(
  values: Pick<WarehouseAddressValues, "recipientTemplate" | "line2Template">,
) {
  const warnings: string[] = [];
  if (!values.recipientTemplate.includes("{GR_CODE}")) {
    warnings.push(t("admin.settings.warehouse.recipientWithoutCode", PLACEHOLDER_VARS));
  }
  if (!values.line2Template.includes("{GR_CODE}")) {
    warnings.push(t("admin.settings.warehouse.line2WithoutCode", PLACEHOLDER_VARS));
  }
  return warnings;
}

function warehouseRow(values: WarehouseAddressData) {
  return {
    label: values.label,
    service_type: values.serviceType,
    recipient_name_template: values.recipientTemplate,
    address_line1: values.line1,
    address_line2_template: values.line2Template,
    city: values.city,
    state: values.state,
    zip: values.zip,
    country: values.country,
    phone: values.phone,
    is_active: values.active,
  };
}

/** Adds (id null) or changes an address with the admin's own client (admins only; audited). */
export async function saveWarehouseAddress(
  db: Client,
  id: string | null,
  values: WarehouseAddressData,
): Promise<WarehouseAddressRow> {
  const row = warehouseRow(values);
  const query = id
    ? db.from("warehouse_addresses").update(row).eq("id", id)
    : db.from("warehouse_addresses").insert(row);
  const { data, error } = await query.select("*").single();
  if (error) {
    adminOnly(error);
    throw error;
  }
  return data;
}

/** Addresses are never deleted (no grant): one that is no longer used is switched off. */
export async function setWarehouseAddressActive(
  db: Client,
  id: string,
  active: boolean,
): Promise<WarehouseAddressRow> {
  const { data, error } = await db
    .from("warehouse_addresses")
    .update({ is_active: active })
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    adminOnly(error);
    throw error;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Service rates (SPEC §35.8: weight always rounded UP to the step)
// ---------------------------------------------------------------------------

export const serviceRateSchema = z.object({
  enabled: switchField,
  ratePerLb: decimalField(0, 100_000, false),
  currency: z.enum(CURRENCIES),
  minimumLbs: decimalField(0, 10_000, false),
  rounding: z.enum(WEIGHT_ROUNDINGS),
});
export type ServiceRateValues = z.input<typeof serviceRateSchema>;
export type ServiceRateData = z.output<typeof serviceRateSchema>;

export function serviceRateInputValues(rate: ServiceRate): ServiceRateValues {
  return {
    enabled: rate.enabled ? "true" : "false",
    ratePerLb: decimalInputValue(rate.rate_per_lb),
    currency: rate.currency,
    minimumLbs: decimalInputValue(rate.minimum_billable_lbs),
    rounding: rate.weight_rounding,
  };
}

/** i18n keys of the rounding options ("0.1" cannot be part of a dotted key). */
export const ROUNDING_KEYS = {
  none: "none",
  "0.1": "tenth",
  "0.5": "half",
  "1": "whole",
} as const satisfies Record<WeightRounding, string>;

const ROUNDING_STEP_HUNDREDTHS: Record<WeightRounding, number> = {
  none: 1,
  "0.1": 10,
  "0.5": 50,
  "1": 100,
};

/**
 * The weight billed for a parcel: rounded UP to the step, then at least the
 * minimum. In hundredths of a pound, so 2.3 lbs to 0.1 stays 2.3 (no binary
 * drift to 2.4).
 */
export function billableWeight(
  weightLbs: number,
  rounding: WeightRounding,
  minimumLbs: number | null,
): number {
  const hundredths = Math.round(weightLbs * 100);
  const step = ROUNDING_STEP_HUNDREDTHS[rounding];
  const rounded = Math.ceil(hundredths / step) * step;
  const minimum = minimumLbs === null ? 0 : Math.round(minimumLbs * 100);
  return Math.max(rounded, minimum) / 100;
}

export async function saveServiceRate(
  db: Client,
  serviceType: ServiceType,
  values: ServiceRateData,
): Promise<ServiceRate> {
  const { data, error } = await db
    .from("service_rates")
    .update({
      enabled: values.enabled,
      rate_per_lb: values.ratePerLb,
      currency: values.currency,
      minimum_billable_lbs: values.minimumLbs,
      weight_rounding: values.rounding,
    })
    .eq("service_type", serviceType)
    .select("*")
    .single();
  if (error) {
    adminOnly(error);
    throw error;
  }
  return data;
}
