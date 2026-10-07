import { CircleAlert, CircleCheck, CircleDashed, MailX } from "lucide-react";

import type { EmailLogRow } from "@/lib/admin/reminders";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const STATUS_ICON = {
  sent: { icon: CircleCheck, className: "text-success" },
  queued: { icon: CircleDashed, className: "text-muted-foreground" },
  failed: { icon: CircleAlert, className: "text-destructive" },
  skipped_no_provider: { icon: MailX, className: "text-warning" },
} as const;

/**
 * E-mails from email_logs (staff read): when, what, to whom and what
 * happened — "Verstuurd", "Overgeslagen (e-mail niet ingesteld)", "Mislukt"
 * with the provider's reason. Status as text plus icon, never colour alone.
 */
export function EmailLogList({
  logs,
  empty,
  className,
}: {
  logs: readonly EmailLogRow[];
  empty: string;
  className?: string;
}) {
  const t = useT();
  if (logs.length === 0)
    return <p className={cn("text-sm text-muted-foreground", className)}>{empty}</p>;
  return (
    <ul className={cn("divide-y text-sm", className)}>
      {logs.map((log) => {
        const status = STATUS_ICON[log.status];
        const Icon = status.icon;
        return (
          <li key={log.id} className="flex min-w-0 items-start gap-2 py-2 first:pt-0 last:pb-0">
            <Icon className={cn("mt-0.5 size-4 shrink-0", status.className)} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap gap-x-2 text-foreground">
                <span className="font-semibold">{t(`admin.reminders.kinds.${log.kind}`)}</span>
                <span>{t(`admin.reminders.emailStatus.${log.status}`)}</span>
                {log.idempotency_key.includes(":manual-") ? (
                  <span className="text-muted-foreground">
                    ({t("admin.reminders.emailLog.manual")})
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums [overflow-wrap:anywhere]">
                {formatDateTime(log.sent_at ?? log.created_at)} ·{" "}
                {t("admin.reminders.emailLog.to", { recipient: log.recipient })}
              </p>
              {log.status === "failed" && log.error ? (
                <p className="mt-0.5 text-xs text-destructive [overflow-wrap:anywhere]">
                  {log.error}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
