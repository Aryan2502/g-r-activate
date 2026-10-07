import type { UseQueryResult } from "@tanstack/react-query";
import { CircleCheck, CircleX, Info, Server } from "lucide-react";

import { DashboardPanel, PanelLoadError } from "@/components/admin/dashboard/Panel";
import { Skeleton } from "@/components/ui/skeleton";
import type { SystemStatus } from "@/lib/admin/system-status";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";

/**
 * "Systeemstatus" (SPEC §35.2): booleans only, never a value: service-role
 * key, APP_URL, e-mail provider, cron secret, and the last payment-reminder
 * run with its status. Admins only (systemStatusFn).
 */
export function SystemStatusPanel({ status }: { status: UseQueryResult<SystemStatus> }) {
  const t = useT();
  return (
    <DashboardPanel
      title={t("admin.home.system.title")}
      icon={<Server />}
      description={t("admin.home.system.intro")}
    >
      {status.isError ? (
        <PanelLoadError error={status.error} onRetry={() => void status.refetch()} />
      ) : status.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <dl className="divide-y text-sm">
          <Row label={t("admin.home.system.serviceRoleKey")} ok={status.data.serviceRoleKey} />
          <Row
            label={t("admin.home.system.appUrl")}
            ok={status.data.appUrl}
            {...(status.data.appUrlFromVercel ? { note: t("admin.home.system.vercel") } : {})}
          />
          <Row label={t("admin.home.system.email")} ok={status.data.email} />
          <Row label={t("admin.home.system.cronSecret")} ok={status.data.cronSecret} />
          <div className="grid gap-1 py-2.5 sm:grid-cols-[1fr_auto] sm:gap-3">
            <dt className="text-muted-foreground">{t("admin.home.system.lastReminder")}</dt>
            <dd className="text-foreground tabular-nums">
              {status.data.lastReminderRun
                ? `${t("admin.home.system.runValue", {
                    status: t(`admin.home.system.runStatus.${status.data.lastReminderRun.status}`),
                    date: formatDateTime(status.data.lastReminderRun.startedAt),
                  })} (${t(`admin.home.system.runTrigger.${status.data.lastReminderRun.trigger}`)})`
                : t("admin.home.system.noRun")}
            </dd>
          </div>
        </dl>
      )}
    </DashboardPanel>
  );
}

function Row({ label, ok, note }: { label: string; ok: boolean; note?: string }) {
  const t = useT();
  return (
    <div className="grid gap-1 py-2.5 first:pt-0 sm:grid-cols-[1fr_auto] sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1.5 font-semibold">
        {ok ? (
          <>
            <CircleCheck className="size-4 text-success" aria-hidden />
            <span className="text-success">{t("admin.home.system.set")}</span>
          </>
        ) : note ? (
          <>
            <Info className="size-4 text-info" aria-hidden />
            <span className="text-foreground">{note}</span>
          </>
        ) : (
          <>
            <CircleX className="size-4 text-destructive" aria-hidden />
            <span className="text-destructive">{t("admin.home.system.notSet")}</span>
          </>
        )}
      </dd>
    </div>
  );
}
