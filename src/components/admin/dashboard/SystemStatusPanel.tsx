import type { UseQueryResult } from "@tanstack/react-query";
import { AlertTriangle, CircleCheck, CircleX, Info, Server } from "lucide-react";

import { DashboardPanel, PanelLoadError } from "@/components/admin/dashboard/Panel";
import { Skeleton } from "@/components/ui/skeleton";
import {
  cronSilent,
  runState,
  type JobRunSummary,
  type SystemStatus,
} from "@/lib/admin/system-status";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";

/**
 * "Systeemstatus" (SPEC §35.2): booleans only, never a value: service-role
 * key, APP_URL, e-mail provider, cron secret, the last payment-reminder
 * run with its status, and the last AUTOMATIC run on its own line (a manual
 * run must not hide a daily schedule that stopped). Admins only.
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
          <RunRow
            label={t("admin.home.system.lastReminder")}
            run={status.data.lastReminderRun}
            withTrigger
          />
          {status.data.lastCronReminderRun !== undefined ? (
            <RunRow
              label={t("admin.home.system.lastCronReminder")}
              run={status.data.lastCronReminderRun}
              {...(cronSilent(status.data) ? { warning: t("admin.home.system.cronSilent") } : {})}
            />
          ) : null}
        </dl>
      )}
    </DashboardPanel>
  );
}

function RunRow({
  label,
  run,
  withTrigger = false,
  warning,
}: {
  label: string;
  run: JobRunSummary | null;
  withTrigger?: boolean;
  warning?: string;
}) {
  const t = useT();
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[1fr_auto] sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground tabular-nums sm:text-right">
        {run
          ? `${t("admin.home.system.runValue", {
              status: t(`admin.home.system.runStatus.${runState(run)}`),
              date: formatDateTime(run.startedAt),
            })}${withTrigger ? ` (${t(`admin.home.system.runTrigger.${run.trigger}`)})` : ""}`
          : t("admin.home.system.noRun")}
        {warning ? (
          <span className="mt-0.5 flex items-start gap-1 text-xs font-semibold text-warning sm:justify-end">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
            {warning}
          </span>
        ) : null}
      </dd>
    </div>
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
