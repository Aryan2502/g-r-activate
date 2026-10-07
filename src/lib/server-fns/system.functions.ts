import { createServerFn } from "@tanstack/react-start";

import { REMINDER_JOB, type SystemStatus } from "@/lib/admin/system-status";
import { toTransportError } from "@/lib/errors";
import { logFailure, unwrap, type Failure } from "@/lib/server-fns/helpers";
import { denied, requireAdmin, requireStaff } from "@/lib/server-fns/middleware";

/**
 * The admin dashboard's "Systeemstatus" panel (SPEC §35.2): whether the
 * server is configured, as booleans only (src/server/system-status.ts), plus
 * the last run of the payment-reminder job and, separately, its last
 * AUTOMATIC run (a manual "Herinneringen nu versturen" must not hide a daily
 * schedule that stopped), read with the admin's own client (job_runs: staff
 * read).
 */
export const systemStatusFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }): Promise<{ ok: true; status: SystemStatus } | Failure> => {
    const access = context.access;
    if (!access.ok) return denied(access);

    try {
      const { configStatus } = await import("@/server/system-status");
      const config = configStatus();
      const [last, lastCron] = await Promise.all([
        access.supabase
          .from("job_runs")
          .select("status, trigger, started_at, finished_at")
          .eq("job", REMINDER_JOB)
          .order("started_at", { ascending: false })
          .limit(1),
        access.supabase
          .from("job_runs")
          .select("status, trigger, started_at, finished_at")
          .eq("job", REMINDER_JOB)
          .eq("trigger", "cron")
          .order("started_at", { ascending: false })
          .limit(1),
      ]);
      if (last.error) throw last.error;
      if (lastCron.error) throw lastCron.error;
      const summary = (run: (typeof last.data)[number] | undefined) =>
        run
          ? {
              status: run.status,
              trigger: run.trigger,
              startedAt: run.started_at,
              finishedAt: run.finished_at,
            }
          : null;
      return {
        ok: true,
        status: {
          ...config,
          lastReminderRun: summary(last.data[0]),
          lastCronReminderRun: summary(lastCron.data[0]),
        },
      };
    } catch (error) {
      logFailure("systemStatusFn", error);
      return { ok: false, error: toTransportError(error) };
    }
  });

export async function fetchSystemStatus(): Promise<SystemStatus> {
  return unwrap(await systemStatusFn()).status;
}

export interface EmailStatus {
  configured: boolean;
  /**
   * The base of portal links in a WhatsApp message staff send themselves
   * (APP_URL, else this browser's origin); null when neither is known.
   */
  linkBase: string | null;
}

/**
 * Whether e-mail is configured (RESEND_API_KEY and EMAIL_FROM), as one
 * boolean for every staff member: the status dialog says beforehand that the
 * customer will not be e-mailed (SPEC §35.12 "E-mail is nog niet
 * geconfigureerd") and offers WhatsApp instead. Never a value of either
 * variable.
 */
export const emailStatusFn = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .handler(async ({ context }): Promise<({ ok: true } & EmailStatus) | Failure> => {
    const access = context.access;
    if (!access.ok) return denied(access);
    const { configStatus } = await import("@/server/system-status");
    let linkBase: string | null = null;
    try {
      linkBase = (await import("@/server/fn-helpers")).screenBase().base;
    } catch (error) {
      console.warn("[emailStatusFn] no link base", error);
    }
    return { ok: true, configured: configStatus().email, linkBase };
  });

export async function fetchEmailStatus(): Promise<EmailStatus> {
  const status = unwrap(await emailStatusFn());
  return { configured: status.configured, linkBase: status.linkBase };
}
