import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { Constants, type Database } from "@/integrations/supabase/types";
import { isValidDate } from "@/lib/admin/invoice-builder";
import { formatDate, formatMoney, todayInSuriname, type CurrencyCode } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { InvoiceBankAccount } from "@/lib/invoice/model";
import { lateFeeAmount, sumAmounts, toScaled } from "@/lib/invoice/totals";

/**
 * The work behind the invoice actions of /admin/facturen/$id (SPEC §17,
 * §35.9, §35.10), apart from the server functions
 * (lib/server-fns/invoices.functions.ts) so the contract tests run it against
 * the real migrations. Everything runs with the staff member's OWN client:
 * record_payment (staff), void_payment, cancel_invoice and apply_late_fee
 * (admin) check the role themselves, the payment triggers derive the
 * invoice status and the audit log records who did it. Never the service role.
 *
 * Also the dialogs' form rules (Dutch messages, all at once) and the
 * WhatsApp message of "Deel via WhatsApp" (SPEC §35.12).
 */

type Client = Pick<SupabaseClient<Database>, "rpc">;
export type PaymentMethod = Database["public"]["Enums"]["payment_method"];
type InvoiceStatus = Database["public"]["Enums"]["invoice_status"];

export const PAYMENT_METHODS = Constants.public.Enums.payment_method;
const CURRENCIES = Constants.public.Enums.currency_code;

/** numeric(12,2) as the payments columns hold it. */
export const MAX_AMOUNT = 9_999_999_999.99;
export const REASON_MAX = 500;
export const REFERENCE_MAX = 200;
export const NOTE_MAX = 2000;

const twoDecimals = (n: number) => {
  try {
    toScaled(n);
    return true;
  } catch {
    return false;
  }
};

const amount = z.number().finite().positive().max(MAX_AMOUNT).refine(twoDecimals);
const date = z.string().refine(isValidDate);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const reason = z.string().trim().min(1).max(REASON_MAX);

const paymentFields = {
  invoiceId: z.string().uuid(),
  paidOn: date,
  method: z.enum(PAYMENT_METHODS),
  /** Bank or receipt reference (internal bookkeeping; the customer can read it). */
  reference: optionalText(REFERENCE_MAX),
  /** Shown to the customer with the payment. */
  customerNote: optionalText(NOTE_MAX),
};

/** "Betaling registreren": an amount in the invoice currency (≤ the balance; the database checks). */
export const recordPaymentInputSchema = z
  .object({
    ...paymentFields,
    amount,
    /** Informational: what was actually handed over, e.g. SRD cash for a USD invoice. */
    receivedAmount: amount.nullish().transform((v) => v ?? null),
    receivedCurrency: z
      .enum(CURRENCIES)
      .nullish()
      .transform((v) => v ?? null),
  })
  .refine((v) => (v.receivedAmount === null) === (v.receivedCurrency === null));
export type RecordPaymentInput = z.input<typeof recordPaymentInputSchema>;
export type RecordPaymentData = z.output<typeof recordPaymentInputSchema>;

/**
 * "Markeer als betaald": one payment for the full balance. `amount` is the
 * balance the staff member confirmed in the dialog, sent as the payment's
 * amount: if the balance dropped meanwhile (another payment) payments_guard
 * refuses it, if it rose (a late fee) the invoice stays partly paid — never
 * a payment of an amount nobody saw.
 */
export const markPaidInputSchema = z.object({ ...paymentFields, amount });
export type MarkPaidInput = z.input<typeof markPaidInputSchema>;
export type MarkPaidData = z.output<typeof markPaidInputSchema>;

/** "Betaling ongedaan maken" (admin): never deleted, voided with a reason. */
export const voidPaymentInputSchema = z.object({ paymentId: z.string().uuid(), reason });
export type VoidPaymentInput = z.input<typeof voidPaymentInputSchema>;

/** "Factuur annuleren" (admin): the reason is shown to the customer. */
export const cancelInvoiceInputSchema = z.object({ invoiceId: z.string().uuid(), reason });
export type CancelInvoiceInput = z.input<typeof cancelInvoiceInputSchema>;

/** "Opslag toepassen" (admin), "Deel via WhatsApp" (staff). */
export const invoiceIdInputSchema = z.object({ invoiceId: z.string().uuid() });
export type InvoiceIdInput = z.input<typeof invoiceIdInputSchema>;

// ---------------------------------------------------------------------------
// The RPC calls (staff member's own client)
// ---------------------------------------------------------------------------

export interface PaymentOutcome {
  paymentId: string;
  /** The status the payment trigger derived: 'paid' once nothing is left. */
  invoiceStatus: InvoiceStatus;
  amountPaid: number;
  balanceDue: number;
}

type PaymentRow = {
  payment_id: string;
  invoice_status: InvoiceStatus;
  amount_paid: number;
  balance_due: number;
};

function outcome(rows: PaymentRow[] | null): PaymentOutcome {
  const row = rows?.[0];
  if (!row) throw new Error("payment RPC returned no row");
  return {
    paymentId: row.payment_id,
    invoiceStatus: row.invoice_status,
    amountPaid: Number(row.amount_paid),
    balanceDue: Number(row.balance_due),
  };
}

/** record_payment with an amount (payments_guard refuses more than the balance). */
export async function recordPayment(
  client: Client,
  input: RecordPaymentData,
): Promise<PaymentOutcome> {
  const { data, error } = await client.rpc("record_payment", {
    _invoice_id: input.invoiceId,
    _amount: input.amount,
    _paid_on: input.paidOn,
    _method: input.method,
    ...(input.reference ? { _reference: input.reference } : {}),
    ...(input.receivedAmount !== null && input.receivedCurrency !== null
      ? { _received_amount: input.receivedAmount, _received_currency: input.receivedCurrency }
      : {}),
    ...(input.customerNote ? { _customer_note: input.customerNote } : {}),
  });
  if (error) throw error;
  return outcome(data);
}

/** record_payment for the balance the staff member confirmed ("Markeer als betaald"). */
export async function markInvoicePaid(
  client: Client,
  input: MarkPaidData,
): Promise<PaymentOutcome> {
  const { data, error } = await client.rpc("record_payment", {
    _invoice_id: input.invoiceId,
    _amount: input.amount,
    _paid_on: input.paidOn,
    _method: input.method,
    ...(input.reference ? { _reference: input.reference } : {}),
    ...(input.customerNote ? { _customer_note: input.customerNote } : {}),
  });
  if (error) throw error;
  return outcome(data);
}

export async function voidPayment(
  client: Client,
  input: z.output<typeof voidPaymentInputSchema>,
): Promise<PaymentOutcome> {
  const { data, error } = await client.rpc("void_payment", {
    _payment_id: input.paymentId,
    _reason: input.reason,
  });
  if (error) throw error;
  return outcome(data);
}

export async function cancelInvoice(
  client: Client,
  input: z.output<typeof cancelInvoiceInputSchema>,
): Promise<{ invoiceId: string; invoiceNumber: string | null; customerId: string }> {
  const { data, error } = await client.rpc("cancel_invoice", {
    _invoice_id: input.invoiceId,
    _reason: input.reason,
  });
  if (error) throw error;
  if (!data) throw new Error("cancel_invoice returned no row");
  return { invoiceId: data.id, invoiceNumber: data.invoice_number, customerId: data.customer_id };
}

export async function applyLateFee(
  client: Client,
  input: z.output<typeof invoiceIdInputSchema>,
): Promise<{ invoiceId: string; totalAmount: number }> {
  const { data, error } = await client.rpc("apply_late_fee", { _invoice_id: input.invoiceId });
  if (error) throw error;
  if (!data) throw new Error("apply_late_fee returned no row");
  return { invoiceId: data.id, totalAmount: Number(data.total_amount) };
}

// ---------------------------------------------------------------------------
// Dialog forms: every error at once, in Dutch (the database checks again)
// ---------------------------------------------------------------------------

export interface PaymentFormValues {
  /** Empty for "Markeer als betaald" (the full balance). */
  amount: string;
  paidOn: string;
  method: PaymentMethod;
  reference: string;
  receivedAmount: string;
  receivedCurrency: CurrencyCode | "";
  customerNote: string;
}

export type PaymentFormField = keyof PaymentFormValues;
export type FormErrors<F extends string> = Partial<Record<F, string>>;

export function initialPaymentForm(input: { balance: number; today?: string }): PaymentFormValues {
  return {
    amount: input.balance > 0 ? String(input.balance).replace(".", ",") : "",
    paidOn: input.today ?? todayInSuriname(),
    method: "bank_transfer",
    reference: "",
    receivedAmount: "",
    receivedCurrency: "",
    customerNote: "",
  };
}

/**
 * A payment amount as staff type it: '1250', '1250,5', '1250,50',
 * '1250.50', '1.250,50' or '1.250.000' (Dutch thousands, as the app prints
 * amounts: 'USD 1.250,00') and '1,250.50'. A single '.' followed by exactly
 * three digits ('1.250') is "ambiguous": it may mean 1250 (Dutch) or 1,25,
 * so it is refused instead of guessed. Never more than 2 decimals.
 */
export function parseMoneyInput(
  input: string,
): { kind: "empty" } | { kind: "ok"; value: number } | { kind: "ambiguous" | "invalid" } {
  const text = input.trim().replace(/\s/g, "");
  if (!text) return { kind: "empty" };
  const ok = (normalised: string) => ({ kind: "ok" as const, value: Number(normalised) });
  if (/^\d+$/.test(text)) return ok(text);
  if (/^\d+,\d{1,2}$/.test(text)) return ok(text.replace(",", "."));
  if (/^\d+\.\d{1,2}$/.test(text)) return ok(text);
  if (/^\d{1,3}\.\d{3}$/.test(text)) return { kind: "ambiguous" };
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(text)) {
    return ok(text.replace(/\./g, "").replace(",", "."));
  }
  if (/^\d{1,3}(,\d{3})+\.\d{1,2}$/.test(text)) return ok(text.replace(/,/g, ""));
  return { kind: "invalid" };
}

/** A money field as typed: the number, or a Dutch error (see parseMoneyInput). */
function moneyField(
  text: string,
  currency: CurrencyCode,
): { value: number | null; error: string | null } {
  const parsed = parseMoneyInput(text);
  if (parsed.kind === "empty") return { value: null, error: null };
  if (parsed.kind === "ambiguous") {
    const digits = text.replace(/\D/g, "");
    return {
      value: null,
      error: t("admin.invoices.payment.validation.ambiguous", {
        thousands: formatMoney(Number(digits), currency),
        plain: digits,
      }),
    };
  }
  const n = parsed.kind === "ok" ? parsed.value : Number.NaN;
  if (Number.isNaN(n) || !twoDecimals(n) || n <= 0) {
    return { value: null, error: t("admin.invoices.payment.validation.amount") };
  }
  if (n > MAX_AMOUNT)
    return { value: null, error: t("admin.invoices.payment.validation.tooLarge") };
  return { value: n, error: null };
}

/**
 * The payment dialog ("full" = "Markeer als betaald": no amount field).
 * Checks what record_payment and payments_guard check, so a refusal is rare.
 */
export function validatePaymentForm(
  values: PaymentFormValues,
  ctx: {
    invoiceId: string;
    balance: number;
    currency: CurrencyCode;
    mode: "amount" | "full";
    today?: string;
  },
):
  | { ok: true; record: RecordPaymentInput; markPaid: MarkPaidInput }
  | { ok: false; errors: FormErrors<PaymentFormField> } {
  const errors: FormErrors<PaymentFormField> = {};
  const today = ctx.today ?? todayInSuriname();

  let amountValue: number | null = null;
  if (ctx.mode === "amount") {
    const parsed = moneyField(values.amount, ctx.currency);
    if (parsed.error) errors.amount = parsed.error;
    else if (parsed.value === null)
      errors.amount = t("admin.invoices.payment.validation.amountRequired");
    else if ((toScaled(parsed.value) ?? 0n) > (toScaled(ctx.balance) ?? 0n)) {
      errors.amount = t("admin.invoices.payment.validation.overBalance", {
        balance: formatMoney(ctx.balance, ctx.currency),
      });
    } else amountValue = parsed.value;
  }

  if (!isValidDate(values.paidOn)) errors.paidOn = t("admin.invoices.payment.validation.date");
  else if (values.paidOn > today) errors.paidOn = t("admin.invoices.payment.validation.dateFuture");

  if (!PAYMENT_METHODS.includes(values.method)) {
    errors.method = t("admin.invoices.payment.validation.method");
  }
  if (values.reference.trim().length > REFERENCE_MAX) {
    errors.reference = t("admin.invoices.validation.tooLong", { max: REFERENCE_MAX });
  }
  if (values.customerNote.trim().length > NOTE_MAX) {
    errors.customerNote = t("admin.invoices.validation.tooLong", { max: NOTE_MAX });
  }

  let received: { amount: number; currency: CurrencyCode } | null = null;
  if (ctx.mode === "amount") {
    const parsed = moneyField(values.receivedAmount, values.receivedCurrency || ctx.currency);
    if (parsed.error) errors.receivedAmount = parsed.error;
    if (parsed.value !== null && values.receivedCurrency === "") {
      errors.receivedCurrency = t("admin.invoices.payment.validation.receivedCurrency");
    } else if (parsed.value === null && !parsed.error && values.receivedCurrency !== "") {
      errors.receivedAmount = t("admin.invoices.payment.validation.receivedAmount");
    } else if (parsed.value !== null && values.receivedCurrency !== "") {
      received = { amount: parsed.value, currency: values.receivedCurrency };
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const common = {
    invoiceId: ctx.invoiceId,
    paidOn: values.paidOn,
    method: values.method,
    reference: values.reference.trim() || null,
    customerNote: values.customerNote.trim() || null,
  };
  return {
    ok: true,
    // The balance shown in the dialog, so the database never pays a different amount.
    markPaid: { ...common, amount: ctx.balance },
    record: {
      ...common,
      amount: amountValue ?? 0,
      receivedAmount: received?.amount ?? null,
      receivedCurrency: received?.currency ?? null,
    },
  };
}

/** A required reason (cancel, void): trimmed, 1–500 characters. */
export function validateReason(text: string): string | null {
  const value = text.trim();
  if (!value) return t("admin.invoices.validation.reasonRequired");
  if (value.length > REASON_MAX) return t("admin.invoices.validation.tooLong", { max: REASON_MAX });
  return null;
}

// ---------------------------------------------------------------------------
// Late fee ("Opslag 15% toepassen")
// ---------------------------------------------------------------------------

export interface LateFeeInvoice {
  status: InvoiceStatus | null;
  is_overdue: boolean | null;
  late_fee_applied_at: string | null;
  balance_due: number | null;
  total_amount: number | null;
}

/**
 * Whether "Opslag toepassen" may be offered: overdue (from invoice_overview),
 * not applied yet, a positive percentage (apply_late_fee checks it all again).
 */
export function canApplyLateFee(
  invoice: LateFeeInvoice,
  percent: number | null,
  hasLateFeeLine: boolean,
): boolean {
  return (
    (invoice.status === "open" || invoice.status === "partially_paid") &&
    invoice.is_overdue === true &&
    invoice.late_fee_applied_at === null &&
    !hasLateFeeLine &&
    percent !== null &&
    percent > 0 &&
    (invoice.balance_due ?? 0) > 0
  );
}

/** What the dialog shows before the admin confirms: the fee and the new totals. */
export function lateFeePreview(
  invoice: Pick<LateFeeInvoice, "balance_due" | "total_amount">,
  percent: number,
): { fee: number; newTotal: number; newBalance: number } {
  const balance = invoice.balance_due ?? 0;
  const fee = lateFeeAmount(balance, percent);
  return {
    fee,
    newTotal: sumAmounts([invoice.total_amount ?? 0, fee]),
    newBalance: sumAmounts([balance, fee]),
  };
}

// ---------------------------------------------------------------------------
// "Deel via WhatsApp" (SPEC §35.12)
// ---------------------------------------------------------------------------

/** `${base}/portal/facturen/<id>`; base is an origin without a trailing slash. */
export function portalInvoiceLink(base: string, invoiceId: string): string {
  return `${base.replace(/\/+$/, "")}/portal/facturen/${invoiceId}`;
}

export interface InvoiceShareInput {
  customerName: string;
  customerCode: string;
  companyName: string;
  invoiceNumber: string;
  currency: CurrencyCode;
  total: number;
  balance: number;
  amountPaid: number;
  dueDate: string;
  status: InvoiceStatus;
  isOverdue: boolean;
  paidAt: string | null;
  /** The account for the invoice currency from the issuer snapshot, if any. */
  bank: InvoiceBankAccount | null;
  /** Only for customers with a login (SPEC §35.12); null: no portal link. */
  portalUrl: string | null;
}

/**
 * The Dutch WhatsApp message for an issued invoice: the amount, what is
 * still to be paid and by when, the payment instruction and the account of
 * the invoice currency; with the portal link only when the customer can log in.
 */
export function invoiceShareText(input: InvoiceShareInput): string {
  const money = (n: number) => formatMoney(n, input.currency);
  const name = input.customerName.trim().split(/\s+/, 1)[0] || input.customerName;
  const lines: string[] = [
    t("admin.invoices.share.greeting", { name }),
    "",
    t("admin.invoices.share.messageIntro", {
      number: input.invoiceNumber,
      company: input.companyName,
    }),
    t("admin.invoices.share.total", { amount: money(input.total) }),
  ];
  if (input.status === "paid") {
    lines.push(
      input.paidAt
        ? t("admin.invoices.share.paidOn", { date: formatDate(input.paidAt) })
        : t("admin.invoices.share.paid"),
    );
  } else {
    if (input.amountPaid > 0) {
      lines.push(t("admin.invoices.share.alreadyPaid", { amount: money(input.amountPaid) }));
    }
    lines.push(
      input.isOverdue
        ? t("admin.invoices.share.overdue", {
            amount: money(input.balance),
            date: formatDate(input.dueDate),
          })
        : t("admin.invoices.share.due", {
            amount: money(input.balance),
            date: formatDate(input.dueDate),
          }),
    );
    lines.push(
      t("admin.invoices.share.instruction", {
        currency: input.currency,
        number: input.invoiceNumber,
        code: input.customerCode,
      }),
    );
    if (input.bank?.accountNumber) {
      lines.push(
        input.bank.bankName
          ? t("admin.invoices.share.bank", {
              account: input.bank.accountNumber,
              bank: input.bank.bankName,
            })
          : t("admin.invoices.share.bankNoName", { account: input.bank.accountNumber }),
      );
      if (input.bank.accountHolder) {
        lines.push(t("admin.invoices.share.holder", { holder: input.bank.accountHolder }));
      }
    }
  }
  lines.push("");
  lines.push(
    input.portalUrl
      ? t("admin.invoices.share.portal", { link: input.portalUrl })
      : t("admin.invoices.share.noPortal"),
  );
  lines.push("", t("admin.invoices.share.closing"), input.companyName);
  return lines.join("\n");
}
