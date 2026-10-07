import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { parseActionInput } from "@/lib/admin/order-actions";
import type { ManualReminderResult } from "@/lib/email/reminders";
import { toTransportError } from "@/lib/errors";
import { logFailure, unwrap, type Failure } from "@/lib/server-fns/helpers";
import { denied, requireStaff } from "@/lib/server-fns/middleware";

/**
 * /admin/herinneringen (SPEC §35.12). Staff only (requireStaff, the role from
 * is_staff() as the caller). After that check the reminder job runs with the
 * service role, exactly as the daily cron run does after its CRON_SECRET
 * check (SPEC §35.2: the reminder job): it writes job_runs, email_logs and the
 * invoices' reminder columns, none of which a client may write.
 */

export interface ReminderRunSummary {
  status: "succeeded" | "failed";
  stats: {
    checked: number;
    due_soon: number;
    overdue: number;
    sent: number;
    skipped: number;
    failed: number;
    duplicate: number;
    no_address: number;
    deferred: number;
  };
  error: string | null;
}

/** "Herinneringen nu versturen": the same run as the daily one, trigger 'manual'. */
export const runRemindersFn = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .handler(async ({ context }): Promise<({ ok: true } & ReminderRunSummary) | Failure> => {
    const access = context.access;
    if (!access.ok) return denied(access);
    try {
      const { runPaymentReminders } = await import("@/server/reminders");
      const run = await runPaymentReminders({ trigger: "manual", actorId: access.userId });
      return { ok: true, status: run.status, stats: run.stats, error: run.error };
    } catch (error) {
      logFailure("runRemindersFn", error);
      const { serviceFailure } = await import("@/server/fn-helpers");
      return { ok: false, error: serviceFailure(error) };
    }
  });

export const invoiceReminderInputSchema = z.object({
  invoiceId: z.string().uuid(),
  /** Staff confirmed sending past max_overdue_reminders. */
  confirmMax: z.boolean().optional(),
});
export type InvoiceReminderInput = z.input<typeof invoiceReminderInputSchema>;

export type InvoiceReminderResponse = { ok: true; result: ManualReminderResult } | Failure;

/** "Herinnering nu versturen" for one invoice (at most one reminder per invoice per day). */
export const sendInvoiceReminderFn = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((input: InvoiceReminderInput): unknown => input)
  .handler(async ({ context, data }): Promise<InvoiceReminderResponse> => {
    const access = context.access;
    if (!access.ok) return denied(access);
    let input;
    try {
      input = parseActionInput(invoiceReminderInputSchema, data);
    } catch (error) {
      return { ok: false, error: toTransportError(error) };
    }
    try {
      // The invoice must be one this staff member can read (RLS), before
      // the service role touches it.
      const { data: visible, error } = await access.supabase
        .from("invoices")
        .select("id")
        .eq("id", input.invoiceId)
        .maybeSingle();
      if (error) throw error;
      if (!visible) return { ok: true, result: { status: "not_due" } };
      const { sendInvoiceReminderNow } = await import("@/server/reminders");
      const result = await sendInvoiceReminderNow({
        invoiceId: input.invoiceId,
        actorId: access.userId,
        confirmMax: input.confirmMax === true,
      });
      return { ok: true, result };
    } catch (error) {
      logFailure("sendInvoiceReminderFn", error);
      const { serviceFailure } = await import("@/server/fn-helpers");
      return { ok: false, error: serviceFailure(error) };
    }
  });

export async function submitRunReminders() {
  return unwrap(await runRemindersFn());
}

export async function submitInvoiceReminder(
  input: InvoiceReminderInput,
): Promise<ManualReminderResult> {
  return unwrap(await sendInvoiceReminderFn({ data: input })).result;
}
