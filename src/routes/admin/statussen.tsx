import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { Check, Eye, EyeOff, Lock, Mail, Pencil, Plus, Power, Star, Truck } from "lucide-react";

import { Callout } from "@/components/admin/Callout";
import {
  DeactivateStatusDialog,
  StatusFormDialog,
  type StatusDialogTarget,
} from "@/components/admin/StatusConfigDialogs";
import { useActivateStatus } from "@/components/admin/status-config-mutations";
import { ShellPageHeader } from "@/components/layout/AppShell";
import { LoadError, Muted } from "@/components/portal/Section";
import { StageIcon } from "@/components/portal/StatusBadges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  groupStatusesByStage,
  isDeliveryStatus,
  statusUsageQueryOptions,
  type StageGroup,
} from "@/lib/admin/status-config";
import {
  DEFAULT_OPERATIONAL_SETTINGS,
  adminStatusesQueryOptions,
  operationalSettingsQueryOptions,
  type StatusRow,
} from "@/lib/admin/statuses";
import { formatNumber } from "@/lib/format";
import { t, useT, type PlainTranslationKey } from "@/lib/i18n";
import type { StatusStage } from "@/lib/portal/orders";
import { cn } from "@/lib/utils";

/**
 * /admin/statussen (SPEC §11, §35.7): the flexible status list, per stage.
 * Staff read it; admins add statuses (code + stage, fixed afterwards), edit
 * labels, the customer description, the sort order and the flags, and
 * deactivate statuses (never delete: orders and history keep them). Shows
 * how many orders are in each status now and which status is each stage's
 * default (the first active one).
 */
export const Route = createFileRoute("/admin/statussen")({
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("admin.statuses.title") }) }] }),
  component: StatusesPage,
});

const adminRoute = getRouteApi("/admin");

/** Stages with a note on what the system does with their statuses. */
const STAGE_HINTS: Partial<Record<StatusStage, PlainTranslationKey>> = {
  registered: "admin.statuses.stageHints.registered",
  us_warehouse: "admin.statuses.stageHints.us_warehouse",
  completed: "admin.statuses.stageHints.completed",
  action_required: "admin.statuses.stageHints.action_required",
  cancelled: "admin.statuses.stageHints.cancelled",
};

function StatusesPage() {
  const t = useT();
  const { auth } = adminRoute.useRouteContext();
  const isAdmin = auth.role === "admin";
  const statuses = useQuery(adminStatusesQueryOptions(auth.userId));
  const usage = useQuery(statusUsageQueryOptions(auth.userId));
  const settings = useQuery(operationalSettingsQueryOptions(auth.userId));
  const [editing, setEditing] = useState<StatusDialogTarget | null>(null);
  const [deactivating, setDeactivating] = useState<StatusRow | null>(null);
  const activate = useActivateStatus(auth.userId);

  const groups = useMemo(
    () => (statuses.data ? groupStatusesByStage(statuses.data) : []),
    [statuses.data],
  );

  const header = (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <ShellPageHeader
        title={t("admin.statuses.title")}
        description={t("admin.statuses.intro")}
        className="mb-0"
      />
      {isAdmin ? (
        <Button
          className="self-start"
          onClick={() => setEditing({ mode: "create", stage: "" })}
          disabled={!statuses.data}
        >
          <Plus aria-hidden />
          {t("admin.statuses.add")}
        </Button>
      ) : null}
    </div>
  );

  if (statuses.isError) {
    return (
      <>
        {header}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <LoadError
            title={t("admin.statuses.loadFailed")}
            error={statuses.error}
            onRetry={() => void statuses.refetch()}
          />
        </div>
      </>
    );
  }
  if (statuses.isPending) {
    return (
      <>
        {header}
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only">{t("common.loading")}</span>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </>
    );
  }

  const deliveryAvailable = (settings.data ?? DEFAULT_OPERATIONAL_SETTINGS).delivery_available;
  const rowProps = {
    isAdmin,
    usage: usage.data,
    deliveryAvailable,
    onEdit: (status: StatusRow) => setEditing({ mode: "edit", status }),
    onDeactivate: (status: StatusRow) => setDeactivating(status),
    onActivate: (status: StatusRow) => activate.mutate(status),
    activating: activate.isPending ? (activate.variables?.code ?? null) : null,
  };

  return (
    <>
      {header}
      <div className="space-y-4">
        {isAdmin ? null : (
          <Callout tone="neutral" icon={Lock} title={t("admin.statuses.readOnly")} />
        )}
        {usage.isError ? (
          <div className="rounded-lg border bg-card p-4 shadow-sm">
            <LoadError
              title={t("admin.statuses.usageLoadFailed")}
              error={usage.error}
              onRetry={() => void usage.refetch()}
            />
          </div>
        ) : null}
        {groups.map((group) => (
          <StageSection
            key={group.stage}
            group={group}
            onAdd={isAdmin ? () => setEditing({ mode: "create", stage: group.stage }) : undefined}
            {...rowProps}
          />
        ))}
      </div>
      <StatusFormDialog
        userId={auth.userId}
        statuses={statuses.data}
        target={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
      <DeactivateStatusDialog
        userId={auth.userId}
        statuses={statuses.data}
        status={deactivating}
        usage={usage.data}
        onOpenChange={(open) => {
          if (!open) setDeactivating(null);
        }}
      />
    </>
  );
}

interface RowProps {
  isAdmin: boolean;
  usage: ReadonlyMap<string, number> | undefined;
  deliveryAvailable: boolean;
  onEdit: (status: StatusRow) => void;
  onDeactivate: (status: StatusRow) => void;
  onActivate: (status: StatusRow) => void;
  /** Code of the status being re-activated. */
  activating: string | null;
}

function StageSection({
  group,
  onAdd,
  ...row
}: RowProps & { group: StageGroup; onAdd: (() => void) | undefined }) {
  const t = useT();
  const stageLabel = t(`portal.stages.${group.stage}`);
  const hint = STAGE_HINTS[group.stage];
  const headingId = `stage-${group.stage}`;
  return (
    <section aria-labelledby={headingId} className="min-w-0 rounded-lg border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-cream px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 id={headingId} className="flex items-center gap-2 text-base text-primary">
            <StageIcon stage={group.stage} className="size-4 shrink-0" />
            {stageLabel}
          </h2>
          {hint ? (
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{t(hint)}</p>
          ) : null}
        </div>
        {onAdd ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onAdd}
            aria-label={t("admin.statuses.addToStage", { stage: stageLabel })}
          >
            <Plus aria-hidden />
            {t("admin.statuses.add")}
          </Button>
        ) : null}
      </div>
      {group.statuses.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">
          {t("admin.statuses.emptyStage")}
        </p>
      ) : (
        <>
          <StatusTable group={group} stageLabel={stageLabel} {...row} />
          <ul className="divide-y xl:hidden">
            {group.statuses.map((status) => (
              <StatusCard key={status.code} status={status} group={group} {...row} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function StatusName({
  status,
  group,
  deliveryAvailable,
}: {
  status: StatusRow;
  group: StageGroup;
  deliveryAvailable: boolean;
}) {
  const t = useT();
  return (
    <>
      <span
        className={cn(
          "block font-semibold text-foreground",
          !status.active && "text-muted-foreground",
        )}
      >
        {status.label_nl}
      </span>
      <span className="block font-mono text-xs text-muted-foreground">
        {t("admin.statuses.code", { code: status.code })}
      </span>
      <span className="mt-1 flex flex-wrap gap-1.5">
        {group.defaultCode === status.code ? (
          <Badge variant="success" title={t("admin.statuses.defaultHint")}>
            <Star className="size-3.5 shrink-0" aria-hidden />
            {t("admin.statuses.default")}
            <span className="sr-only">: {t("admin.statuses.defaultHint")}</span>
          </Badge>
        ) : null}
        {!status.active ? <Badge variant="neutral">{t("admin.statuses.inactive")}</Badge> : null}
        {isDeliveryStatus(status.code) && !deliveryAvailable ? (
          <Badge variant="outline">
            <Truck className="size-3.5 shrink-0" aria-hidden />
            {t("admin.statuses.deliveryOnly")}
          </Badge>
        ) : null}
      </span>
    </>
  );
}

function Flag({
  on,
  onIcon: OnIcon,
  offIcon: OffIcon,
}: {
  on: boolean;
  onIcon: typeof Eye;
  offIcon?: typeof Eye;
}) {
  const t = useT();
  const Icon = on ? OnIcon : (OffIcon ?? null);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        on ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
      {on ? t("admin.statuses.yes") : t("admin.statuses.no")}
    </span>
  );
}

function OrdersInUse({
  code,
  usage,
}: {
  code: string;
  usage: ReadonlyMap<string, number> | undefined;
}) {
  const t = useT();
  if (!usage) return <Muted>–</Muted>;
  const count = usage.get(code) ?? 0;
  return (
    <span className="whitespace-nowrap tabular-nums">
      {t(count === 1 ? "admin.statuses.ordersCountOne" : "admin.statuses.ordersCountMany", {
        count: formatNumber(count, 0),
      })}
    </span>
  );
}

function RowActions({
  status,
  isAdmin,
  onEdit,
  onDeactivate,
  onActivate,
  activating,
  stacked = false,
}: RowProps & { status: StatusRow; stacked?: boolean }) {
  const t = useT();
  if (!isAdmin) return null;
  return (
    <div className={cn("flex gap-2", stacked ? "flex-col items-start" : "flex-wrap")}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onEdit(status)}
        aria-label={t("admin.statuses.editLabel", { label: status.label_nl })}
      >
        <Pencil aria-hidden />
        {t("admin.statuses.edit")}
      </Button>
      {status.active ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDeactivate(status)}
          aria-label={t("admin.statuses.deactivateLabel", { label: status.label_nl })}
        >
          <Power aria-hidden />
          {t("admin.statuses.deactivate")}
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onActivate(status)}
          disabled={activating === status.code}
          aria-label={t("admin.statuses.activateLabel", { label: status.label_nl })}
        >
          <Check aria-hidden />
          {activating === status.code ? t("admin.statuses.busy") : t("admin.statuses.activate")}
        </Button>
      )}
    </div>
  );
}

function StatusTable({
  group,
  stageLabel,
  ...row
}: RowProps & { group: StageGroup; stageLabel: string }) {
  const t = useT();
  const th = "px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-primary";
  return (
    <div className="relative hidden overflow-x-auto xl:block">
      <table className="w-full text-sm">
        <caption className="sr-only">
          {t("admin.statuses.tableCaption", { stage: stageLabel })}
        </caption>
        <thead className="border-b text-left">
          <tr>
            <th scope="col" className={cn(th, "pl-5")}>
              {t("admin.statuses.columns.status")}
            </th>
            <th scope="col" className={cn(th, "w-28")}>
              {t("admin.statuses.columns.visible")}
            </th>
            <th scope="col" className={cn(th, "w-28")}>
              {t("admin.statuses.columns.notify")}
            </th>
            <th scope="col" className={cn(th, "w-24")}>
              {t("admin.statuses.columns.sortOrder")}
            </th>
            <th scope="col" className={cn(th, "w-28")}>
              {t("admin.statuses.columns.orders")}
            </th>
            {row.isAdmin ? (
              <th scope="col" className={cn(th, "w-40 pr-5")}>
                <span className="sr-only">{t("admin.statuses.columns.actions")}</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y">
          {group.statuses.map((status) => (
            <tr key={status.code} className={cn("align-top", !status.active && "bg-muted/40")}>
              <td className="px-3 py-3 pl-5">
                <StatusName
                  status={status}
                  group={group}
                  deliveryAvailable={row.deliveryAvailable}
                />
                {/* The description sits under the name, so it gets the width it needs at 1280 px. */}
                {status.customer_description_nl ? (
                  <p className="mt-2 max-w-prose leading-6 text-muted-foreground">
                    <span className="sr-only">{t("admin.statuses.columns.description")}: </span>
                    {status.customer_description_nl}
                  </p>
                ) : null}
              </td>
              <td className="px-3 py-3">
                <Flag on={status.customer_visible} onIcon={Eye} offIcon={EyeOff} />
              </td>
              <td className="px-3 py-3">
                <Flag on={status.customer_visible && status.notify_customer} onIcon={Mail} />
              </td>
              <td className="px-3 py-3 tabular-nums">{status.sort_order}</td>
              <td className="px-3 py-3">
                <OrdersInUse code={status.code} usage={row.usage} />
              </td>
              {row.isAdmin ? (
                <td className="px-3 py-2.5 pr-5">
                  <RowActions status={status} {...row} stacked />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusCard({
  status,
  group,
  ...row
}: RowProps & { status: StatusRow; group: StageGroup }) {
  const t = useT();
  return (
    <li className={cn("min-w-0 px-4 py-4 sm:px-5", !status.active && "bg-muted/40")}>
      <StatusName status={status} group={group} deliveryAvailable={row.deliveryAvailable} />
      {status.customer_description_nl ? (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {status.customer_description_nl}
        </p>
      ) : null}
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("admin.statuses.columns.visible")}</dt>
          <dd>
            <Flag on={status.customer_visible} onIcon={Eye} offIcon={EyeOff} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("admin.statuses.columns.notify")}</dt>
          <dd>
            <Flag on={status.customer_visible && status.notify_customer} onIcon={Mail} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("admin.statuses.columns.sortOrder")}</dt>
          <dd className="tabular-nums">{status.sort_order}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("admin.statuses.columns.orders")}</dt>
          <dd>
            <OrdersInUse code={status.code} usage={row.usage} />
          </dd>
        </div>
      </dl>
      {row.isAdmin ? (
        <div className="mt-3">
          <RowActions status={status} {...row} />
        </div>
      ) : null}
    </li>
  );
}
