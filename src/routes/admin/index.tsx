import { useState, type ComponentType, type SVGProps } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router";
import {
  Ban,
  Check,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  FileSearch,
  Hourglass,
  Loader2,
  MapPin,
  PackageCheck,
  Plane,
  Stamp,
  TriangleAlert,
  UserRound,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";

import { OverviewKpis } from "@/components/admin/dashboard/OverviewKpis";
import { DashboardPanel, PanelLoadError } from "@/components/admin/dashboard/Panel";
import { RecentActivity } from "@/components/admin/dashboard/RecentActivity";
import { SetupChecklist } from "@/components/admin/dashboard/SetupChecklist";
import { SystemStatusPanel } from "@/components/admin/dashboard/SystemStatusPanel";
import { ShellPageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ORDER_COUNT_KEYS,
  ORDER_COUNT_SEARCH,
  openTasksQueryOptions,
  orderCountsQueryOptions,
  resolvableFromDashboard,
  resolveStaffTask,
  staffProfileQueryOptions,
  type OrderCountKey,
  type StaffTask,
} from "@/lib/admin/dashboard";
import { adminKeys } from "@/lib/admin/keys";
import { systemStatusQueryOptions } from "@/lib/admin/system-status-query";
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
  const isAdmin = auth.role === "admin";
  const profile = useQuery(staffProfileQueryOptions(auth.userId));
  const system = useQuery({ ...systemStatusQueryOptions(auth.userId), enabled: isAdmin });
  const name = profile.data ?? auth.email;

  return (
    <>
      <ShellPageHeader
        title={t("admin.home.welcome", { name })}
        description={t("admin.home.signedInAs", { email: auth.email })}
      />
      <div className="space-y-6">
        <SetupChecklist
          userId={auth.userId}
          isAdmin={isAdmin}
          system={isAdmin ? system.data : null}
        />
        {/* What needs someone first (cancellation requests, sign-up conflicts), then the overview. */}
        <OpenTasks userId={auth.userId} />
        <OverviewKpis userId={auth.userId} />
        <OrderCounts userId={auth.userId} />
        <div className={isAdmin ? "grid gap-6 lg:grid-cols-2" : "grid gap-6"}>
          <RecentActivity userId={auth.userId} />
          {isAdmin ? <SystemStatusPanel status={system} /> : null}
        </div>
      </div>
    </>
  );
}

const COUNT_ICONS: Record<OrderCountKey, ComponentType<SVGProps<SVGSVGElement>>> = {
  awaitingReceipt: Hourglass,
  inUsWarehouse: Warehouse,
  inTransit: Plane,
  arrivedSr: MapPin,
  atCustoms: FileSearch,
  cleared: Stamp,
  readyForPickup: PackageCheck,
  actionRequired: TriangleAlert,
  cancellationRequests: Ban,
};

/** Where the packages are now (SPEC §12): counts by stage, each a link to those orders. */
function OrderCounts({ userId }: { userId: string }) {
  const t = useT();
  const counts = useQuery(orderCountsQueryOptions(userId));
  return (
    <DashboardPanel
      title={t("admin.home.operationsTitle")}
      icon={<ClipboardList />}
      description={t("admin.home.operationsIntro")}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/orders">
            {t("admin.home.allOrders")}
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      }
    >
      {counts.isError ? (
        <PanelLoadError error={counts.error} onRetry={() => void counts.refetch()} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ORDER_COUNT_KEYS.map((key) => {
            const Icon = COUNT_ICONS[key];
            const label = t(`admin.home.counts.${key}`);
            const value = counts.data?.[key];
            const attention =
              (key === "cancellationRequests" || key === "actionRequired") && (value ?? 0) > 0;
            return (
              <li key={key}>
                <Link
                  to="/admin/orders"
                  search={ORDER_COUNT_SEARCH[key]}
                  className="flex h-full items-center gap-3 rounded-md border p-4 transition-colors hover:border-primary/40 hover:bg-cream/50"
                  aria-label={
                    value === undefined
                      ? label
                      : `${t("admin.home.counts.view", { label })}: ${formatNumber(value, 0)}`
                  }
                >
                  <span
                    className={
                      attention
                        ? "flex size-10 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning"
                        : "flex size-10 shrink-0 items-center justify-center rounded-full bg-cream text-primary"
                    }
                    aria-hidden
                  >
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">{label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t(`admin.home.counts.${key}Hint`)}
                    </span>
                  </span>
                  {value === undefined ? (
                    <Skeleton className="h-8 w-10" />
                  ) : (
                    <span className="font-heading text-3xl font-bold text-primary tabular-nums">
                      {formatNumber(value, 0)}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardPanel>
  );
}

function OpenTasks({ userId }: { userId: string }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const first = useQuery(openTasksQueryOptions(userId));
  const everything = useQuery({ ...openTasksQueryOptions(userId, "all"), enabled: all });
  // Keep the short list on screen until the full one has arrived.
  const tasks = all && everything.data ? everything : first;
  const hidden = tasks.data ? tasks.data.total - tasks.data.tasks.length : 0;

  return (
    <DashboardPanel
      title={t("admin.home.tasksTitle")}
      icon={<ClipboardList />}
      description={t("admin.home.tasksIntro")}
    >
      {tasks.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : tasks.isError ? (
        <PanelLoadError error={tasks.error} onRetry={() => void tasks.refetch()} />
      ) : tasks.data.total === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.home.tasksEmpty")}</p>
      ) : (
        <>
          <p className="font-heading text-4xl font-bold text-primary tabular-nums">
            {formatNumber(tasks.data.total, 0)}
          </p>
          <ul className="mt-4 divide-y border-t">
            {tasks.data.tasks.map((task) => (
              <TaskItem key={task.id} userId={userId} task={task} />
            ))}
          </ul>
          {hidden > 0 || all ? (
            <div className="mt-2 flex flex-wrap items-center gap-3 border-t pt-3">
              {hidden > 0 ? (
                <p className="text-xs text-muted-foreground tabular-nums">
                  {t(hidden === 1 ? "admin.home.tasksMoreOne" : "admin.home.tasksMore", {
                    count: formatNumber(hidden, 0),
                  })}
                </p>
              ) : null}
              {all && !everything.data && !everything.isError ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
              ) : null}
              {all && everything.isError ? (
                <PanelLoadError
                  error={everything.error}
                  onRetry={() => void everything.refetch()}
                />
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  aria-expanded={all}
                  onClick={() => setAll((v) => !v)}
                >
                  {all
                    ? t("admin.home.tasksShowFewer")
                    : t("admin.home.tasksShowAll", { count: formatNumber(tasks.data.total, 0) })}
                </Button>
              )}
            </div>
          ) : null}
        </>
      )}
    </DashboardPanel>
  );
}

function TaskItem({ userId, task }: { userId: string; task: StaffTask }) {
  const t = useT();
  const queryClient = useQueryClient();
  const kind = t(`admin.taskKinds.${task.kind}`);
  const resolve = useMutation({
    mutationFn: () => resolveStaffTask(task.id),
    onSuccess: async () => {
      toast.success(t("admin.home.taskResolved"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.tasks(userId) }),
        queryClient.invalidateQueries({ queryKey: adminKeys.orders(userId) }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <li className="py-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-semibold text-foreground">{kind}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatDateTime(task.created_at)}
        </p>
      </div>
      <p className="mt-1 break-words leading-6 text-muted-foreground">{task.body}</p>
      {!resolvableFromDashboard(task) ? (
        <p className="mt-1 text-xs text-muted-foreground">{t("admin.home.taskCancellationHint")}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {task.order_id ? (
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/orders/$id" params={{ id: task.order_id }}>
              <ExternalLink aria-hidden />
              {t("admin.home.taskOpenOrder")}
            </Link>
          </Button>
        ) : null}
        {task.customer_id ? (
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/klanten/$id" params={{ id: task.customer_id }}>
              <UserRound aria-hidden />
              {t("admin.home.taskOpenCustomer")}
            </Link>
          </Button>
        ) : null}
        {resolvableFromDashboard(task) ? (
          <Button
            size="sm"
            variant="outline"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate()}
            aria-label={t("admin.home.taskResolveLabel", {
              kind,
              date: formatDateTime(task.created_at),
            })}
          >
            {resolve.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Check aria-hidden />
            )}
            {resolve.isPending ? t("admin.home.taskResolving") : t("admin.home.taskResolve")}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
