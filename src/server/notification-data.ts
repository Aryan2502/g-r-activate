import "@tanstack/react-start/server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import type { EmailOutcome } from "@/lib/email/outcome";
import {
  fromIssuedInvoice,
  type InvoiceItemRow,
  type InvoiceRenderModel,
} from "@/lib/invoice/model";
import { sendEmail, toEmailOutcome, type SendEmailInput } from "@/server/email";
import type { EmailBrand, EmailContent } from "@/server/email-templates/layout";
import type { EmailCustomer, PortalAccess } from "@/server/email-templates/orders";
import { MissingEnvError, getAppUrl, getResendConfig } from "@/server/env";

/**
 * What the e-mail hooks read to fill a template. Every loader takes the
 * client of the person acting (RLS applies: a customer reads their own
 * record and order, staff read what staff read); the reminder job and the
 * welcome e-mail after redemption pass the service-role client they already
 * run with. Only sendEmail() itself writes (email_logs, service role).
 */

export type NotificationDb = Pick<SupabaseClient<Database>, "from">;

/** getAppUrl(), or null when neither APP_URL nor Vercel's production domain is set. */
export function appUrlOrNull(): string | null {
  try {
    return getAppUrl();
  } catch (error) {
    if (error instanceof MissingEnvError) return null;
    throw error;
  }
}

/**
 * Without an app URL an e-mail cannot carry a single link or the logo, so it
 * is not sent. That is 'skipped' while e-mail is not configured anyway, and a
 * failure otherwise (Systeemstatus shows the missing APP_URL).
 */
export function noAppUrlOutcome(what: string): EmailOutcome {
  if (!getResendConfig()) return "skipped";
  console.error(`[email] ${what} not sent: APP_URL is not set`);
  return "failed";
}

export interface CompanyContact extends EmailBrand {
  pickupAddress: string | null;
  pickupHours: string | null;
  pickupInstructions: string | null;
}

/** company_settings as the e-mail footer and the pickup block print it. */
export async function loadCompany(db: NotificationDb, appUrl: string): Promise<CompanyContact> {
  const { data, error } = await db
    .from("company_settings")
    .select(
      "company_name, tagline, email, phone, address, pickup_address, pickup_hours, pickup_instructions",
    )
    .maybeSingle();
  if (error) throw error;
  return {
    appUrl,
    companyName: data?.company_name ?? "G&R SOLUTIONS N.V.",
    tagline: data?.tagline ?? null,
    email: data?.email ?? null,
    phone: data?.phone ?? null,
    address: data?.address ?? null,
    pickupAddress: data?.pickup_address ?? null,
    pickupHours: data?.pickup_hours ?? null,
    pickupInstructions: data?.pickup_instructions ?? null,
  };
}

export interface Recipient extends Omit<EmailCustomer, "email"> {
  id: string;
  /** null: the record has no e-mail address (nothing can be sent). */
  email: string | null;
  phone: string | null;
  access: PortalAccess;
}

/**
 * The customer an e-mail goes to, and whether it may link to /portal: only
 * for an active customer with a login (SPEC §35.12). For one without a login
 * the e-mail mentions an open invitation (its link cannot be repeated: only
 * the token's hash is stored).
 */
export async function loadRecipient(
  db: NotificationDb,
  customerId: string,
): Promise<Recipient | null> {
  const { data, error } = await db
    .from("customers")
    .select("id, full_name, customer_code, email, phone, user_id, status")
    .eq("id", customerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  let access: PortalAccess;
  if (data.user_id && data.status === "active") {
    access = { login: true };
  } else {
    const open = await db
      .from("invitations")
      .select("id")
      .eq("customer_id", customerId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .limit(1);
    access = { login: false, invitationOpen: !open.error && open.data.length > 0 };
  }
  return {
    id: data.id,
    fullName: data.full_name,
    customerCode: data.customer_code,
    email: data.email?.trim() || null,
    phone: data.phone,
    access,
  };
}

/** An issued invoice with its lines, as the e-mails print it (snapshots only). */
export interface IssuedInvoice {
  id: string;
  customerId: string;
  status: Database["public"]["Enums"]["invoice_status"];
  model: InvoiceRenderModel;
  amountPaid: number;
  balanceDue: number;
  isOverdue: boolean;
  daysOverdue: number;
  dueDate: string;
  paidAt: string | null;
  lateFeeAppliedAt: string | null;
  reminderCount: number;
  firstReminderSentAt: string | null;
  lastReminderSentAt: string | null;
}

export const INVOICE_EMAIL_COLUMNS =
  "id, customer_id, invoice_number, status, currency, invoice_date, due_date, customer_note, paid_at, total_lbs, subtotal_freight, total_charges, total_discount, total_amount, vat_rate, vat_amount, issuer_snapshot, bill_to_snapshot, amount_paid, balance_due, is_overdue, days_overdue, late_fee_applied_at, reminder_count, first_reminder_sent_at, last_reminder_sent_at" as const;

const ITEM_COLUMNS =
  "id, invoice_id, line_type, description, order_id, weight_lbs, rate_per_lb, amount, vat_exempt, sort_order" as const;

type OverviewRow = Pick<
  Database["public"]["Views"]["invoice_overview"]["Row"],
  | "id"
  | "customer_id"
  | "invoice_number"
  | "status"
  | "currency"
  | "invoice_date"
  | "due_date"
  | "customer_note"
  | "paid_at"
  | "total_lbs"
  | "subtotal_freight"
  | "total_charges"
  | "total_discount"
  | "total_amount"
  | "vat_rate"
  | "vat_amount"
  | "issuer_snapshot"
  | "bill_to_snapshot"
  | "amount_paid"
  | "balance_due"
  | "is_overdue"
  | "days_overdue"
  | "late_fee_applied_at"
  | "reminder_count"
  | "first_reminder_sent_at"
  | "last_reminder_sent_at"
>;

/** Builds the e-mail view of overview rows and their lines; drafts are never e-mailed. */
export function toIssuedInvoices(
  rows: readonly OverviewRow[],
  items: readonly (InvoiceItemRow & { invoice_id: string })[],
): IssuedInvoice[] {
  return rows.flatMap((row) => {
    if (!row.id || !row.customer_id || !row.status || row.status === "draft" || !row.due_date) {
      return [];
    }
    const lines = items.filter((i) => i.invoice_id === row.id);
    return [
      {
        id: row.id,
        customerId: row.customer_id,
        status: row.status,
        model: fromIssuedInvoice(row, lines),
        amountPaid: Number(row.amount_paid ?? 0),
        balanceDue: Number(row.balance_due ?? 0),
        isOverdue: row.is_overdue === true,
        daysOverdue: Number(row.days_overdue ?? 0),
        dueDate: row.due_date,
        paidAt: row.paid_at,
        lateFeeAppliedAt: row.late_fee_applied_at,
        reminderCount: Number(row.reminder_count ?? 0),
        firstReminderSentAt: row.first_reminder_sent_at,
        lastReminderSentAt: row.last_reminder_sent_at,
      },
    ];
  });
}

const ID_CHUNK = 100;

/**
 * Runs `.in(column, ids)` queries in chunks of 100 ids, so a long id list
 * (the daily reminder run) never makes a too-long URL for the API gateway.
 */
export async function inIdChunks<T>(
  ids: readonly string[],
  load: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const unique = [...new Set(ids)];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const { data, error } = await load(unique.slice(i, i + ID_CHUNK));
    if (error) throw error;
    out.push(...(data ?? []));
  }
  return out;
}

/** Issued invoices with their lines, by id (invoice_overview: balances computed by the database). */
export async function loadIssuedInvoices(
  db: NotificationDb,
  invoiceIds: readonly string[],
): Promise<IssuedInvoice[]> {
  if (invoiceIds.length === 0) return [];
  const rows = await inIdChunks(invoiceIds, (chunk) =>
    db.from("invoice_overview").select(INVOICE_EMAIL_COLUMNS).in("id", chunk),
  );
  const items = await inIdChunks(invoiceIds, (chunk) =>
    db.from("invoice_items").select(ITEM_COLUMNS).in("invoice_id", chunk),
  );
  return toIssuedInvoices(rows, items);
}

export async function loadIssuedInvoice(
  db: NotificationDb,
  invoiceId: string,
): Promise<IssuedInvoice | null> {
  return (await loadIssuedInvoices(db, [invoiceId]))[0] ?? null;
}

/**
 * Sends one rendered e-mail to a customer and reports it as staff see it.
 * No address: nothing is sent or logged ('no_address').
 */
export async function sendToCustomer(
  recipient: Pick<Recipient, "id" | "email">,
  content: EmailContent,
  meta: Omit<SendEmailInput, "to" | "subject" | "html" | "text" | "customerId">,
): Promise<EmailOutcome> {
  if (!recipient.email) return "no_address";
  const result = await sendEmail({
    ...meta,
    ...content,
    to: recipient.email,
    customerId: recipient.id,
  });
  return toEmailOutcome(result);
}

/**
 * Resend accepts a few requests per second: one action that e-mails many
 * customers (a status change for a whole shipment, the reminder run) waits
 * this long after every e-mail that reached the provider.
 */
export const PROVIDER_PACE_MS = 550;

export function reachedProvider(outcome: EmailOutcome): boolean {
  return outcome === "sent" || outcome === "failed";
}

export const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
