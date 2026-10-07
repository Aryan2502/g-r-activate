import "@tanstack/react-start/server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { REMINDER_JOB, STALE_RUN_MS } from "@/lib/admin/system-status";
import { invoiceEmailKey, manualReminderKey } from "@/lib/email/keys";
import type { EmailOutcome } from "@/lib/email/outcome";
import {
  REMINDER_EMAIL_KINDS,
  addDays,
  manualReminderKind,
  remindedOn,
  reminderDue,
  type ManualReminderResult,
  type ReminderDue,
  type ReminderSettings,
} from "@/lib/email/reminders";
import { todayInSuriname } from "@/lib/format";
import { sendEmail, toEmailOutcome, type SendEmailResult } from "@/server/email";
import { paymentReminderEmail } from "@/server/email-templates/invoices";
import {
  INVOICE_EMAIL_COLUMNS,
  PROVIDER_PACE_MS,
  appUrlOrNull,
  inIdChunks,
  loadIssuedInvoices,
  loadRecipient,
  pause,
  reachedProvider,
  toIssuedInvoices,
  type IssuedInvoice,
  type Recipient,
} from "@/server/notification-data";

/**
 * Payment reminders (SPEC §19, §35.12). ONE function for the daily run
 * (pg_cron → /api/cron/payment-reminders, after the CRON_SECRET check) and
 * "Herinneringen nu versturen" (staff, after requireStaff): both run with the
 * service role, which SPEC §35.2 allows for the reminder job. It is
 * idempotent: every reminder has its own key (invoice:<id>:<kind>:<seq>), so
 * a second run the same day, or two at once, sends nothing twice.
 *
 * For every open or partly paid invoice with a balance (invoice_overview),
 * reminderDue() (lib/email/reminders.ts) decides by WINDOWS, with "today" in
 * Suriname: before the due date once (due_soon), after it the first overdue
 * reminder and then one every interval up to the maximum. A sent overdue
 * reminder sets reminder_count, first_ and last_reminder_sent_at; the one
 * before the due date is recorded in email_logs only. Nothing is counted
 * when e-mail is not configured (skipped) or the provider refused (failed):
 * the next run tries again. Every run writes a job_runs row; a row a killed
 * run left 'running' is closed as failed by the next run (STALE_RUN_MS).
 *
 * The run assumes the serverless function may run for about a minute
 * (DEFAULT_BUDGET_MS plus one e-mail's timeout): Vercel's Fluid compute,
 * docs/DEPLOYMENT.md §1.1.
 */

export type ServiceDb = Pick<SupabaseClient<Database>, "from">;

export interface ReminderRunStats {
  /** Open invoices with a balance that were looked at. */
  checked: number;
  due_soon: number;
  overdue: number;
  sent: number;
  skipped: number;
  failed: number;
  duplicate: number;
  no_address: number;
  /** Not reached before the time limit; the next run picks them up. */
  deferred: number;
}

export interface ReminderRunResult {
  runId: string;
  status: "succeeded" | "failed";
  stats: ReminderRunStats;
  error: string | null;
}

export interface ReminderDeps {
  db?: ServiceDb;
  /** 'YYYY-MM-DD' in Suriname (default: now). */
  today?: string;
  now?: () => Date;
  pause?: (ms: number) => Promise<void>;
  /** Stop starting new e-mails after this many ms (serverless time limit). */
  budgetMs?: number;
}

const DEFAULT_BUDGET_MS = 45_000;
/** Rows per page of the candidate invoices (PostgREST's default max-rows). */
const PAGE_SIZE = 1000;

async function serviceDb(deps: ReminderDeps): Promise<ServiceDb> {
  if (deps.db) return deps.db;
  const { loadAdminClient } = await import("@/server/admin-client");
  return loadAdminClient();
}

export async function loadReminderSettings(db: ServiceDb): Promise<ReminderSettings> {
  const { data, error } = await db
    .from("company_settings")
    .select("due_soon_days, overdue_reminder_interval_days, max_overdue_reminders")
    .maybeSingle();
  if (error) throw error;
  return {
    dueSoonDays: data?.due_soon_days ?? 2,
    intervalDays: data?.overdue_reminder_interval_days ?? 7,
    maxOverdueReminders: data?.max_overdue_reminders ?? 3,
  };
}

/** Invoices that already got (or are getting) their reminder before the due date. */
async function dueSoonSent(db: ServiceDb, invoiceIds: readonly string[]): Promise<Set<string>> {
  const data = await inIdChunks(invoiceIds, (chunk) =>
    db
      .from("email_logs")
      .select("invoice_id, status")
      .eq("kind", "payment_reminder_due_soon")
      .in("invoice_id", chunk)
      .in("status", ["sent", "queued"]),
  );
  return new Set(data.flatMap((r) => (r.invoice_id ? [r.invoice_id] : [])));
}

/** Closes runs a killed request left 'running', so no screen shows "Bezig" for ever. */
async function closeAbandonedRuns(db: ServiceDb, now: Date): Promise<void> {
  const { error } = await db
    .from("job_runs")
    .update({
      status: "failed",
      finished_at: now.toISOString(),
      error: "Afgebroken: de ronde is niet afgemaakt (tijdslimiet van de server of een storing).",
    })
    .eq("job", REMINDER_JOB)
    .eq("status", "running")
    .lt("started_at", new Date(now.getTime() - STALE_RUN_MS).toISOString());
  if (error) console.error("[reminders] could not close abandoned runs", error);
}

/**
 * After a SENT overdue reminder: the bookkeeping columns. Only if nobody
 * changed reminder_count meanwhile (another reminder for the same invoice).
 */
async function recordOverdueReminder(
  db: ServiceDb,
  invoice: Pick<IssuedInvoice, "id" | "reminderCount" | "firstReminderSentAt">,
  seq: number,
  sentAt: string,
): Promise<void> {
  const { data, error } = await db
    .from("invoices")
    .update({
      reminder_count: seq,
      last_reminder_sent_at: sentAt,
      first_reminder_sent_at: invoice.firstReminderSentAt ?? sentAt,
    })
    .eq("id", invoice.id)
    .eq("reminder_count", invoice.reminderCount)
    .select("id");
  if (error) throw error;
  if (data.length === 0) {
    console.warn("[reminders] reminder_count changed meanwhile; left as is", invoice.id);
  }
}

/** When a reminder was sent according to its log row (a repeat run finds it 'duplicate'). */
async function sentAtOf(db: ServiceDb, key: string): Promise<string | null> {
  const { data, error } = await db
    .from("email_logs")
    .select("sent_at")
    .eq("idempotency_key", key)
    .maybeSingle();
  if (error) throw error;
  return data?.sent_at ?? null;
}

interface SendOne {
  db: ServiceDb;
  appUrl: string;
  invoice: IssuedInvoice;
  recipient: Recipient;
  due: ReminderDue;
  key: string;
  now: () => Date;
  /**
   * Scheduled keys name the reminder's number (…:overdue:<seq>), so a
   * 'duplicate' that was sent but never booked can be booked now. A manual
   * key names the day instead and is never booked twice.
   */
  scheduled: boolean;
}

/** Renders, sends and books one reminder; returns what happened. */
async function sendReminder(one: SendOne): Promise<EmailOutcome> {
  const { invoice, recipient, due } = one;
  if (!recipient.email) return "no_address";
  const content = paymentReminderEmail({
    appUrl: one.appUrl,
    invoiceId: invoice.id,
    model: invoice.model,
    access: recipient.access,
    recipient: recipient.email,
    kind: due.kind,
    seq: due.kind === "payment_reminder_overdue" ? due.seq : 1,
    amountPaid: invoice.amountPaid,
    balanceDue: invoice.balanceDue,
    daysOverdue: invoice.daysOverdue,
    lateFeeApplied: invoice.lateFeeAppliedAt !== null,
  });
  const result: SendEmailResult = await sendEmail({
    ...content,
    kind: due.kind,
    to: recipient.email,
    idempotencyKey: one.key,
    customerId: recipient.id,
    invoiceId: invoice.id,
    replyTo: invoice.model.issuer.email,
  });
  if (due.kind === "payment_reminder_overdue") {
    if (result.status === "sent") {
      await recordOverdueReminder(one.db, invoice, due.seq, one.now().toISOString());
    } else if (one.scheduled && result.status === "duplicate" && result.previous === "sent") {
      // Sent by an earlier run that stopped before booking it: book it now.
      const sentAt = await sentAtOf(one.db, one.key);
      if (sentAt) await recordOverdueReminder(one.db, invoice, due.seq, sentAt);
    }
  }
  return toEmailOutcome(result);
}

const emptyStats = (): ReminderRunStats => ({
  checked: 0,
  due_soon: 0,
  overdue: 0,
  sent: 0,
  skipped: 0,
  failed: 0,
  duplicate: 0,
  no_address: 0,
  deferred: 0,
});

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/**
 * The run itself. Throws only when the job cannot even be recorded (no
 * service role, database unreachable); everything after that ends up in the
 * job_runs row.
 */
export async function runPaymentReminders(
  options: { trigger: "cron" | "manual"; actorId?: string | null },
  deps: ReminderDeps = {},
): Promise<ReminderRunResult> {
  const db = await serviceDb(deps);
  const now = deps.now ?? (() => new Date());
  const wait = deps.pause ?? pause;
  const started = now().getTime();
  const budget = deps.budgetMs ?? DEFAULT_BUDGET_MS;

  await closeAbandonedRuns(db, now());
  const { data: run, error: runError } = await db
    .from("job_runs")
    .insert({
      job: REMINDER_JOB,
      trigger: options.trigger,
      status: "running",
      started_by: options.actorId ?? null,
    })
    .select("id")
    .single();
  if (runError) throw runError;

  const stats = emptyStats();
  let failure: string | null = null;
  try {
    const appUrl = appUrlOrNull();
    if (!appUrl) throw new Error("APP_URL is not set: reminders cannot link or show the logo");
    const today = deps.today ?? todayInSuriname(now());
    const settings = await loadReminderSettings(db);

    // Open invoices with a balance whose window may have started, every
    // page. Past their due date with every reminder sent, they get nothing
    // more: left out here, so the work does not grow with old unpaid invoices.
    const rows: Awaited<ReturnType<typeof candidatePage>> = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const page = await candidatePage(db, today, settings, from);
      rows.push(
        ...page.filter(
          (r) =>
            (r.due_date !== null && r.due_date >= today) ||
            (r.reminder_count ?? 0) < settings.maxOverdueReminders,
        ),
      );
      if (page.length < PAGE_SIZE) break;
    }
    stats.checked = rows.length;
    // Only invoices before their due date can still get the reminder before it.
    const sentBefore = await dueSoonSent(
      db,
      rows.flatMap((r) => (r.id && r.due_date !== null && r.due_date > today ? [r.id] : [])),
    );

    const due = toIssuedInvoices(rows, []).flatMap((invoice) => {
      const next = reminderDue(
        {
          status: invoice.status,
          dueDate: invoice.dueDate,
          balanceDue: invoice.balanceDue,
          reminderCount: invoice.reminderCount,
          lastReminderSentAt: invoice.lastReminderSentAt,
          dueSoonSent: sentBefore.has(invoice.id),
        },
        settings,
        today,
      );
      return next ? [{ id: invoice.id, next }] : [];
    });
    // With their lines (the e-mail prints the invoice).
    const invoices = new Map(
      (
        await loadIssuedInvoices(
          db,
          due.map((d) => d.id),
        )
      ).map((i) => [i.id, i]),
    );
    const recipients = new Map<string, Recipient | null>();

    for (const [index, { id, next }] of due.entries()) {
      if (now().getTime() - started > budget) {
        stats.deferred = due.length - index;
        break;
      }
      const invoice = invoices.get(id);
      if (!invoice) continue;
      if (next.kind === "payment_reminder_due_soon") stats.due_soon += 1;
      else stats.overdue += 1;
      let outcome: EmailOutcome;
      try {
        if (!recipients.has(invoice.customerId)) {
          recipients.set(invoice.customerId, await loadRecipient(db, invoice.customerId));
        }
        const recipient = recipients.get(invoice.customerId);
        outcome = recipient
          ? await sendReminder({
              db,
              appUrl,
              invoice,
              recipient,
              due: next,
              key: invoiceEmailKey(invoice.id, next.kind, next.seq),
              now,
              scheduled: true,
            })
          : "no_address";
      } catch (err) {
        console.error("[reminders] reminder failed", id, err);
        outcome = "failed";
      }
      stats[outcome] += 1;
      if (reachedProvider(outcome) && index < due.length - 1) await wait(PROVIDER_PACE_MS);
    }
    if (stats.failed > 0) {
      failure =
        stats.failed === 1
          ? "1 herinnering kon niet worden verstuurd"
          : `${stats.failed} herinneringen konden niet worden verstuurd`;
    }
  } catch (err) {
    console.error("[reminders] run failed", err);
    failure = describe(err).slice(0, 5000);
  }

  const status = failure ? "failed" : "succeeded";
  const { error: finishError } = await db
    .from("job_runs")
    .update({ status, finished_at: now().toISOString(), stats: { ...stats }, error: failure })
    .eq("id", run.id);
  if (finishError) console.error("[reminders] could not record the run", finishError);
  return { runId: run.id, status, stats, error: failure };
}

/** One page of the run's candidates: open, a balance, due within the window. */
async function candidatePage(
  db: ServiceDb,
  today: string,
  settings: ReminderSettings,
  from: number,
) {
  const { data, error } = await db
    .from("invoice_overview")
    .select(INVOICE_EMAIL_COLUMNS)
    .in("status", ["open", "partially_paid"])
    .gt("balance_due", 0)
    .lte("due_date", addDays(today, Math.max(0, settings.dueSoonDays)))
    .order("due_date")
    .order("id")
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw error;
  return data;
}

/** This invoice's reminder e-mails (newest first), for the once-a-day check. */
async function reminderLogs(db: ServiceDb, invoiceId: string) {
  const { data, error } = await db
    .from("email_logs")
    .select("kind, status, created_at, updated_at, sent_at")
    .eq("invoice_id", invoiceId)
    .in("kind", [...REMINDER_EMAIL_KINDS])
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data;
}

export type { ManualReminderResult };

/**
 * "Herinnering nu versturen" for one invoice: the overdue wording after the
 * due date, the friendly one before it. At most ONE reminder per invoice per
 * Suriname day, whichever route sent it (the daily run, the bulk button or
 * this one): a second attempt that day answers 'already_today'.
 *
 * When the daily run would send a reminder today anyway, this sends exactly
 * that one, under its scheduled key (invoice:<id>:<kind>:<seq>): the run and a
 * click at the same moment then claim the same email_logs row and only one
 * goes out. Otherwise it is an extra reminder under the day's manual key
 * (invoice:<id>:<kind>:manual-<day>). A sent overdue reminder is booked like
 * a scheduled one. Past max_overdue_reminders nothing is sent unless staff
 * confirmed it (`confirmMax`).
 */
export async function sendInvoiceReminderNow(
  input: { invoiceId: string; actorId: string; confirmMax?: boolean },
  deps: ReminderDeps = {},
): Promise<ManualReminderResult> {
  const db = await serviceDb(deps);
  const now = deps.now ?? (() => new Date());
  const today = deps.today ?? todayInSuriname(now());
  const [invoice] = await loadIssuedInvoices(db, [input.invoiceId]);
  if (!invoice) return { status: "not_due" };
  const kind = manualReminderKind(
    { status: invoice.status, balanceDue: invoice.balanceDue, dueDate: invoice.dueDate },
    today,
  );
  if (!kind) return { status: "not_due" };
  if (remindedOn(today, await reminderLogs(db, invoice.id), invoice.lastReminderSentAt)) {
    return { status: "already_today", kind };
  }
  const settings = await loadReminderSettings(db);
  if (
    kind === "payment_reminder_overdue" &&
    invoice.reminderCount >= settings.maxOverdueReminders &&
    !input.confirmMax
  ) {
    return { status: "max_reached", kind, max: settings.maxOverdueReminders };
  }
  const appUrl = appUrlOrNull();
  if (!appUrl) {
    const { noAppUrlOutcome } = await import("@/server/notification-data");
    return { status: "sent_or_tried", kind, outcome: noAppUrlOutcome("payment_reminder") };
  }
  const recipient = await loadRecipient(db, invoice.customerId);
  if (!recipient) return { status: "not_due" };

  const scheduled = reminderDue(
    {
      status: invoice.status,
      dueDate: invoice.dueDate,
      balanceDue: invoice.balanceDue,
      reminderCount: invoice.reminderCount,
      lastReminderSentAt: invoice.lastReminderSentAt,
      dueSoonSent: (await dueSoonSent(db, [invoice.id])).has(invoice.id),
    },
    settings,
    today,
  );
  const due: ReminderDue =
    scheduled?.kind === kind
      ? scheduled
      : kind === "payment_reminder_overdue"
        ? { kind, seq: invoice.reminderCount + 1 }
        : { kind, seq: 1 };
  const outcome = await sendReminder({
    db,
    appUrl,
    invoice,
    recipient,
    due,
    key:
      scheduled?.kind === kind
        ? invoiceEmailKey(invoice.id, kind, due.seq)
        : manualReminderKey(invoice.id, kind, today),
    now,
    scheduled: scheduled?.kind === kind,
  });
  console.info("[reminders] manual reminder", invoice.id, kind, outcome, "by", input.actorId);
  return { status: "sent_or_tried", kind, outcome };
}
