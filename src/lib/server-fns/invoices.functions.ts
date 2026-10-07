import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  applyLateFee,
  cancelInvoice,
  cancelInvoiceInputSchema,
  invoiceIdInputSchema,
  markInvoicePaid,
  markPaidInputSchema,
  portalInvoiceLink,
  recordPayment,
  recordPaymentInputSchema,
  voidPayment,
  voidPaymentInputSchema,
  type CancelInvoiceInput,
  type InvoiceIdInput,
  type MarkPaidInput,
  type PaymentOutcome,
  type RecordPaymentInput,
  type VoidPaymentInput,
} from "@/lib/admin/invoice-actions";
import { parseActionInput } from "@/lib/admin/order-actions";
import type { EmailOutcome } from "@/lib/email/outcome";
import { CodedError, toTransportError } from "@/lib/errors";
import { t } from "@/lib/i18n";
import { logFailure, unwrap, type Failure, type LinkSource } from "@/lib/server-fns/helpers";
import { denied, requireAdmin, requireStaff, type RoleAccess } from "@/lib/server-fns/middleware";

/**
 * Invoice server functions (SPEC §16, §35.9, §35.12). Each runs
 * requireStaff/requireAdmin and returns failures as data (TransportError),
 * so the browser keeps the SQLSTATE and hints such as invoice_dates. The
 * database work uses the staff member's OWN client (RPC guards, RLS and the
 * audit triggers see who did it); never the service role. Then the e-mail
 * (src/server/invoice-notifications.ts), whose outcome comes back with the
 * answer, so the UI says exactly whether the customer was e-mailed. Only the
 * e-mail log is written with the service role (src/server/email.ts).
 */

export const issueInvoiceInputSchema = z.object({ invoiceId: z.string().uuid() });
export type IssueInvoiceInput = z.input<typeof issueInvoiceInputSchema>;

export type IssueInvoiceResponse =
  | {
      ok: true;
      invoiceId: string;
      invoiceNumber: string;
      /** What happened to the "factuur aangemaakt" e-mail. */
      emailOutcome: EmailOutcome;
    }
  | Failure;

/**
 * "Genereer factuur", after the builder saved the draft: issue_invoice gives
 * the gapless number, recomputes the totals, writes the snapshots and sets
 * the status 'open', in one transaction. Then the "factuur aangemaakt" e-mail.
 */
export const issueInvoiceFn = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  // Typing only: the handler parses with zod, so a bad request gets a Dutch answer.
  .validator((input: IssueInvoiceInput): unknown => input)
  .handler(async ({ context, data }): Promise<IssueInvoiceResponse> => {
    const access = context.access;
    if (!access.ok) return denied(access);

    let issued;
    try {
      const input = parseActionInput(issueInvoiceInputSchema, data);
      const { data: row, error } = await access.supabase.rpc("issue_invoice", {
        _invoice_id: input.invoiceId,
      });
      if (error) throw error;
      if (!row.invoice_number) throw new Error("issue_invoice returned no number");
      issued = { id: row.id, number: row.invoice_number, customerId: row.customer_id };
    } catch (error) {
      logFailure("issueInvoiceFn", error);
      return { ok: false, error: toTransportError(error) };
    }

    // "Factuur aangemaakt". Never fails the issue.
    let emailOutcome: EmailOutcome;
    try {
      const { onInvoiceIssued } = await import("@/server/invoice-notifications");
      emailOutcome = (
        await onInvoiceIssued({
          db: access.supabase,
          invoiceId: issued.id,
          invoiceNumber: issued.number,
          customerId: issued.customerId,
          userId: access.userId,
        })
      ).email;
    } catch (error) {
      console.error("[issueInvoiceFn] onInvoiceIssued failed", error);
      emailOutcome = "failed";
    }
    return { ok: true, invoiceId: issued.id, invoiceNumber: issued.number, emailOutcome };
  });

// ---------------------------------------------------------------------------
// Payments (SPEC §35.10): staff record, admins void
// ---------------------------------------------------------------------------

export type PaymentResponse =
  | ({
      ok: true;
      /** "Betaling ontvangen": only when the invoice became paid (null: no e-mail meant). */
      emailOutcome: EmailOutcome | null;
    } & PaymentOutcome)
  | Failure;

/** "Betaling ontvangen" when the invoice became paid; never fails the payment. */
async function paymentHook(
  name: string,
  action: "record" | "mark_paid",
  invoiceId: string,
  result: PaymentOutcome,
  access: Extract<RoleAccess, { ok: true }>,
): Promise<EmailOutcome | null> {
  if (result.invoiceStatus !== "paid") return null;
  try {
    const { onPaymentRecorded } = await import("@/server/invoice-notifications");
    return (
      await onPaymentRecorded({
        db: access.supabase,
        invoiceId,
        paymentId: result.paymentId,
        action,
        invoiceStatus: result.invoiceStatus,
        userId: access.userId,
      })
    ).email;
  } catch (error) {
    console.error(`[${name}] onPaymentRecorded failed`, error);
    return "failed";
  }
}

/**
 * "Betaling registreren": record_payment with the amount (≤ the balance; the
 * payment trigger derives 'partially_paid' or 'paid'), then "betaling ontvangen" when paid.
 */
export const recordPaymentFn = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((input: RecordPaymentInput): unknown => input)
  .handler(async ({ context, data }): Promise<PaymentResponse> => {
    const access = context.access;
    if (!access.ok) return denied(access);

    let input;
    let result;
    try {
      input = parseActionInput(recordPaymentInputSchema, data);
      result = await recordPayment(access.supabase, input);
    } catch (error) {
      logFailure("recordPaymentFn", error);
      return { ok: false, error: toTransportError(error) };
    }
    const emailOutcome = await paymentHook(
      "recordPaymentFn",
      "record",
      input.invoiceId,
      result,
      access,
    );
    return { ok: true, emailOutcome, ...result };
  });

/** "Markeer als betaald": one payment for the full balance (record_payment without an amount). */
export const markPaidFn = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((input: MarkPaidInput): unknown => input)
  .handler(async ({ context, data }): Promise<PaymentResponse> => {
    const access = context.access;
    if (!access.ok) return denied(access);

    let input;
    let result;
    try {
      input = parseActionInput(markPaidInputSchema, data);
      result = await markInvoicePaid(access.supabase, input);
    } catch (error) {
      logFailure("markPaidFn", error);
      return { ok: false, error: toTransportError(error) };
    }
    const emailOutcome = await paymentHook(
      "markPaidFn",
      "mark_paid",
      input.invoiceId,
      result,
      access,
    );
    return { ok: true, emailOutcome, ...result };
  });

export type VoidPaymentResponse = ({ ok: true } & PaymentOutcome) | Failure;

/** "Betaling ongedaan maken" (admin, with a reason): void_payment; the status follows. */
export const voidPaymentFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: VoidPaymentInput): unknown => input)
  .handler(async ({ context, data }): Promise<VoidPaymentResponse> => {
    const access = context.access;
    if (!access.ok) return denied(access);

    try {
      const input = parseActionInput(voidPaymentInputSchema, data);
      return { ok: true, ...(await voidPayment(access.supabase, input)) };
    } catch (error) {
      logFailure("voidPaymentFn", error);
      return { ok: false, error: toTransportError(error) };
    }
  });

// ---------------------------------------------------------------------------
// Cancel and late fee (admin only, SPEC §35.9, §35.10)
// ---------------------------------------------------------------------------

export type CancelInvoiceResponse =
  { ok: true; invoiceId: string; invoiceNumber: string | null; customerId: string } | Failure;

/**
 * "Factuur annuleren" and the first step of "Corrigeren": cancel_invoice with
 * a reason the customer sees (refused while payments are on it).
 */
export const cancelInvoiceFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: CancelInvoiceInput): unknown => input)
  .handler(async ({ context, data }): Promise<CancelInvoiceResponse> => {
    const access = context.access;
    if (!access.ok) return denied(access);

    try {
      const input = parseActionInput(cancelInvoiceInputSchema, data);
      return { ok: true, ...(await cancelInvoice(access.supabase, input)) };
    } catch (error) {
      logFailure("cancelInvoiceFn", error);
      return { ok: false, error: toTransportError(error) };
    }
  });

export type LateFeeResponse = { ok: true; invoiceId: string; totalAmount: number } | Failure;

/** "Opslag 15% toepassen" (admin, overdue only): apply_late_fee adds one late_fee line. */
export const applyLateFeeFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: InvoiceIdInput): unknown => input)
  .handler(async ({ context, data }): Promise<LateFeeResponse> => {
    const access = context.access;
    if (!access.ok) return denied(access);

    try {
      const input = parseActionInput(invoiceIdInputSchema, data);
      return { ok: true, ...(await applyLateFee(access.supabase, input)) };
    } catch (error) {
      logFailure("applyLateFeeFn", error);
      return { ok: false, error: toTransportError(error) };
    }
  });

// ---------------------------------------------------------------------------
// "Deel via WhatsApp" (SPEC §35.12)
// ---------------------------------------------------------------------------

export type InvoiceShareResponse =
  | {
      ok: true;
      /** /portal/facturen/<id> on APP_URL (else this browser's origin); null without a login. */
      portalUrl: string | null;
      linkSource: LinkSource;
      phone: string | null;
    }
  | Failure;

/**
 * The portal link for the WhatsApp message of an issued invoice: only for a
 * customer with a login (SPEC §35.12: no /portal link otherwise), on APP_URL
 * like the invitation links. Reads with the staff member's own client.
 */
export const invoiceShareFn = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((input: InvoiceIdInput): unknown => input)
  .handler(async ({ context, data }): Promise<InvoiceShareResponse> => {
    const access = context.access;
    if (!access.ok) return denied(access);

    let invoice;
    let customer;
    try {
      const input = parseActionInput(invoiceIdInputSchema, data);
      const found = await access.supabase
        .from("invoices")
        .select("id, status, customer_id")
        .eq("id", input.invoiceId)
        .maybeSingle();
      if (found.error) throw found.error;
      if (!found.data) throw new CodedError(t("admin.invoiceBuilder.notFound"), "P0002");
      if (found.data.status === "draft") {
        throw new CodedError(t("invoicePrint.draft"), "55000");
      }
      invoice = found.data;
      const c = await access.supabase
        .from("customers")
        .select("user_id, phone")
        .eq("id", invoice.customer_id)
        .single();
      if (c.error) throw c.error;
      customer = c.data;
    } catch (error) {
      logFailure("invoiceShareFn", error);
      return { ok: false, error: toTransportError(error) };
    }

    let base;
    try {
      base = (await import("@/server/fn-helpers")).screenBase();
    } catch (error) {
      console.error("[invoiceShareFn] no link base", error);
      return { ok: false, error: toTransportError(error) };
    }
    return {
      ok: true,
      portalUrl: customer.user_id ? portalInvoiceLink(base.base, invoice.id) : null,
      linkSource: base.source,
      phone: customer.phone,
    };
  });

// ---------------------------------------------------------------------------
// Browser side: a returned failure is thrown as a CodedError.
// ---------------------------------------------------------------------------

export async function submitIssueInvoice(input: IssueInvoiceInput) {
  return unwrap(await issueInvoiceFn({ data: input }));
}

export async function submitRecordPayment(input: RecordPaymentInput) {
  return unwrap(await recordPaymentFn({ data: input }));
}

export async function submitMarkPaid(input: MarkPaidInput) {
  return unwrap(await markPaidFn({ data: input }));
}

export async function submitVoidPayment(input: VoidPaymentInput) {
  return unwrap(await voidPaymentFn({ data: input }));
}

export async function submitCancelInvoice(input: CancelInvoiceInput) {
  return unwrap(await cancelInvoiceFn({ data: input }));
}

export async function submitApplyLateFee(input: InvoiceIdInput) {
  return unwrap(await applyLateFeeFn({ data: input }));
}

export async function fetchInvoiceShare(input: InvoiceIdInput) {
  return unwrap(await invoiceShareFn({ data: input }));
}
