import "@tanstack/react-start/server-only";

import { authorizeCron } from "@/server/cron-secret";

/**
 * What /api/cron/payment-reminders does (src/routes/api/cron/payment-reminders.ts
 * only forwards the request): the bearer check, then with the service role
 *   1. runPaymentReminders({ trigger: "cron" }) — job_runs 'payment_reminders';
 *   2. the clean-up of orphaned uploads — job_runs 'storage_cleanup'.
 * Nothing besides the Authorization header is read from the request (no
 * parameters, no body). 401 on a wrong or missing secret, 500 while
 * CRON_SECRET is not set or when the run could not even start (e.g. no
 * service-role key). The answer holds counts only, never customer data.
 */

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function handlePaymentRemindersCron(request: Request): Promise<Response> {
  const auth = await authorizeCron(request.headers.get("authorization"));
  if (!auth.ok) {
    return json(
      { ok: false, error: auth.status === 401 ? "unauthorized" : "cron_secret_not_configured" },
      auth.status,
    );
  }

  const { runPaymentReminders } = await import("@/server/reminders");
  let reminders;
  try {
    reminders = await runPaymentReminders({ trigger: "cron" });
  } catch (error) {
    console.error("[cron/payment-reminders] could not start", error);
    return json({ ok: false, error: "reminders_not_started" }, 500);
  }

  let cleanup = null;
  try {
    const [{ loadStorageAdmin }, { cleanupOrphanUploads }] = await Promise.all([
      import("@/server/admin-client"),
      import("@/server/storage-cleanup"),
    ]);
    cleanup = await cleanupOrphanUploads(await loadStorageAdmin(), { trigger: "cron" });
  } catch (error) {
    console.error("[cron/payment-reminders] storage clean-up could not start", error);
  }

  return json(
    {
      ok: reminders.status === "succeeded",
      reminders: { status: reminders.status, stats: reminders.stats },
      cleanup: cleanup ? { status: cleanup.status, stats: cleanup.stats } : null,
    },
    200,
  );
}
