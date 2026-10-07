import { createServerFn } from "@tanstack/react-start";

import { REMINDER_JOB, type SystemStatus } from "@/lib/admin/system-status";
import { toTransportError } from "@/lib/errors";
import { logFailure, unwrap, type Failure } from "@/lib/server-fns/helpers";
import { denied, requireAdmin } from "@/lib/server-fns/middleware";

/**
 * The admin dashboard's "Systeemstatus" panel (SPEC §35.2): whether the
 * server is configured, as booleans only (src/server/system-status.ts), plus
 * the last run of the payment-reminder job, read with the admin's own client
 * (job_runs: staff read).
 */
export const systemStatusFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }): Promise<{ ok: true; status: SystemStatus } | Failure> => {
    const access = context.access;
    if (!access.ok) return denied(access);

    try {
      const { configStatus } = await import("@/server/system-status");
      const config = configStatus();
      const { data, error } = await access.supabase
        .from("job_runs")
        .select("status, trigger, started_at, finished_at")
        .eq("job", REMINDER_JOB)
        .order("started_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const run = data[0] ?? null;
      return {
        ok: true,
        status: {
          ...config,
          lastReminderRun: run
            ? {
                status: run.status,
                trigger: run.trigger,
                startedAt: run.started_at,
                finishedAt: run.finished_at,
              }
            : null,
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
