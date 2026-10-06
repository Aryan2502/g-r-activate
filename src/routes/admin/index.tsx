import { useQuery } from "@tanstack/react-query";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { AlertTriangle, ClipboardList, RotateCw, Users } from "lucide-react";
import type { ReactNode } from "react";

import { ShellPageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  customerCountsQueryOptions,
  openTasksQueryOptions,
  staffProfileQueryOptions,
} from "@/lib/admin/dashboard";
import { errorMessage } from "@/lib/errors";
import { formatDateTime, formatNumber } from "@/lib/format";
import { t, useT } from "@/lib/i18n";

const adminRoute = getRouteApi("/admin");

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("admin.home.title") }) }] }),
  component: AdminHome,
});

function AdminHome() {
  const t = useT();
  const { auth } = adminRoute.useRouteContext();
  const profile = useQuery(staffProfileQueryOptions(auth.userId));
  const name = profile.data ?? auth.email;

  return (
    <>
      <ShellPageHeader
        title={t("admin.home.welcome", { name })}
        description={t("admin.home.signedInAs", { email: auth.email })}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <CustomerCounts userId={auth.userId} />
        <OpenTasks userId={auth.userId} />
      </div>
    </>
  );
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-6 shadow-sm">
      <h2 className="flex items-center gap-2 text-lg text-foreground">
        <span className="text-primary [&_svg]:size-5" aria-hidden>
          {icon}
        </span>
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="flex flex-col items-start gap-3 text-sm">
      <p className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="size-4" aria-hidden />
        {t("admin.home.loadFailed")} {errorMessage(error)}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCw aria-hidden />
        {t("common.retry")}
      </Button>
    </div>
  );
}

function CustomerCounts({ userId }: { userId: string }) {
  const t = useT();
  const counts = useQuery(customerCountsQueryOptions(userId));

  return (
    <Panel title={t("admin.home.customersTitle")} icon={<Users />}>
      {counts.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : counts.isError ? (
        <LoadError error={counts.error} onRetry={() => void counts.refetch()} />
      ) : (
        <>
          <p className="font-heading text-4xl font-bold text-primary tabular-nums">
            {formatNumber(counts.data.total, 0)}
          </p>
          <p className="text-sm text-muted-foreground">{t("admin.home.customersTotal")}</p>
          <dl className="mt-4 grid grid-cols-3 gap-3 border-t pt-4 text-sm">
            {(
              [
                ["admin.home.customersActive", counts.data.active],
                ["admin.home.customersInvited", counts.data.invited],
                ["admin.home.customersDisabled", counts.data.disabled],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{t(label)}</dt>
                <dd className="text-lg font-semibold text-foreground tabular-nums">
                  {formatNumber(value, 0)}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Panel>
  );
}

function OpenTasks({ userId }: { userId: string }) {
  const t = useT();
  const tasks = useQuery(openTasksQueryOptions(userId));

  return (
    <Panel title={t("admin.home.tasksTitle")} icon={<ClipboardList />}>
      {tasks.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : tasks.isError ? (
        <LoadError error={tasks.error} onRetry={() => void tasks.refetch()} />
      ) : tasks.data.total === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.home.tasksEmpty")}</p>
      ) : (
        <>
          <p className="font-heading text-4xl font-bold text-primary tabular-nums">
            {formatNumber(tasks.data.total, 0)}
          </p>
          <ul className="mt-4 divide-y border-t">
            {tasks.data.tasks.map((task) => (
              <li key={task.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="font-semibold text-foreground">
                    {t(`admin.taskKinds.${task.kind}`)}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatDateTime(task.created_at)}
                  </p>
                </div>
                <p className="mt-1 leading-6 text-muted-foreground">{task.body}</p>
              </li>
            ))}
          </ul>
          {tasks.data.total > tasks.data.tasks.length ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("admin.home.tasksMore", { count: tasks.data.total - tasks.data.tasks.length })}
            </p>
          ) : null}
        </>
      )}
    </Panel>
  );
}
