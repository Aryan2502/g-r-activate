import { createFileRoute } from "@tanstack/react-router";

/**
 * /api/cron/payment-reminders (SPEC §35.12): called once a day by Supabase
 * pg_cron + pg_net (private.invoke_payment_reminders(), 12:00 UTC = 09:00
 * Suriname) with `Authorization: Bearer <CRON_SECRET>`. GET and POST do the
 * same. The work is in src/server/cron-payment-reminders.ts (bearer check
 * compared as SHA-256 digests with timingSafeEqual, the reminder run and the
 * clean-up of orphaned uploads), loaded only inside the handler.
 */
export const Route = createFileRoute("/api/cron/payment-reminders")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        (await import("@/server/cron-payment-reminders")).handlePaymentRemindersCron(request),
      POST: async ({ request }) =>
        (await import("@/server/cron-payment-reminders")).handlePaymentRemindersCron(request),
    },
  },
});
