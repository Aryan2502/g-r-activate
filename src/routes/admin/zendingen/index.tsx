import { Fragment, useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Plane, Search, XCircle } from "lucide-react";

import { ServiceTypeLabel, StageSummary } from "@/components/admin/ShipmentBits";
import { ShipmentFormDialog } from "@/components/admin/ShipmentFormDialog";
import { ShellPageHeader } from "@/components/layout/AppShell";
import { LoadError, Muted } from "@/components/portal/Section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Constants } from "@/integrations/supabase/types";
import {
  adminShipmentsQueryOptions,
  filterShipments,
  isShipmentDone,
  membersByShipment,
  shipmentListSearchSchema,
  shipmentMembersQueryOptions,
  summarizeShipment,
  type Shipment,
  type ShipmentListSearch,
  type ShipmentSummary,
} from "@/lib/admin/shipments";
import { adminStatusesQueryOptions } from "@/lib/admin/statuses";
import { formatDate, formatDateTime, formatLbs, formatNumber } from "@/lib/format";
import { t, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * /admin/zendingen (SPEC §21, §35.7): every consolidation shipment (flight
 * or container) with where its orders are, searchable by number, carrier or
 * AWB/container number. "Zending aanmaken" opens the form and then the new
 * shipment's page, where orders are added.
 */
export const Route = createFileRoute("/admin/zendingen/")({
  validateSearch: (search: Record<string, unknown>): ShipmentListSearch =>
    shipmentListSearchSchema.parse(search),
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("admin.shipments.title") }) }] }),
  component: ShipmentsPage,
});

const adminRoute = getRouteApi("/admin");
const ALL = "all";

interface ShipmentView extends Shipment {
  summary: ShipmentSummary | null;
}

function ShipmentsPage() {
  const t = useT();
  const { auth } = adminRoute.useRouteContext();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const shipments = useQuery(adminShipmentsQueryOptions(auth.userId));
  const members = useQuery(shipmentMembersQueryOptions(auth.userId));
  const statuses = useQuery(adminStatusesQueryOptions(auth.userId));
  const [creating, setCreating] = useState(false);

  const views = useMemo((): ShipmentView[] => {
    if (!shipments.data) return [];
    const grouped = members.data ? membersByShipment(members.data) : null;
    return shipments.data.map((s) => ({
      ...s,
      summary:
        grouped && statuses.data
          ? summarizeShipment(s, grouped.get(s.id) ?? [], statuses.data)
          : null,
    }));
  }, [shipments.data, members.data, statuses.data]);
  const summaries = useMemo(
    () => new Map(views.flatMap((v) => (v.summary ? [[v.id, v.summary] as const] : []))),
    [views],
  );
  const visible = useMemo(
    () => filterShipments(views, summaries, search),
    [views, summaries, search],
  );

  const header = (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <ShellPageHeader
        title={t("admin.shipments.title")}
        description={t("admin.shipments.intro")}
        className="mb-0"
      />
      <Button className="self-start" onClick={() => setCreating(true)}>
        <Plane aria-hidden />
        {t("admin.shipments.new")}
      </Button>
    </div>
  );
  const dialog = (
    <ShipmentFormDialog
      userId={auth.userId}
      shipment={null}
      open={creating}
      onOpenChange={setCreating}
      onCreated={(created) =>
        void navigate({ to: "/admin/zendingen/$id", params: { id: created.id } })
      }
    />
  );

  if (shipments.isError) {
    return (
      <>
        {header}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <LoadError
            title={t("admin.shipments.loadFailed")}
            error={shipments.error}
            onRetry={() => void shipments.refetch()}
          />
        </div>
        {dialog}
      </>
    );
  }

  if (shipments.isPending) {
    return (
      <>
        {header}
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only">{t("common.loading")}</span>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
        {dialog}
      </>
    );
  }

  return (
    <>
      {header}
      {views.length === 0 ? (
        <div className="flex flex-col items-start gap-4 rounded-lg border bg-card p-6 shadow-sm">
          <div>
            <h2 className="text-lg text-foreground">{t("admin.shipments.emptyTitle")}</h2>
            <p className="mt-1 max-w-prose text-sm leading-6 text-muted-foreground">
              {t("admin.shipments.emptyText")}
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plane aria-hidden />
            {t("admin.shipments.new")}
          </Button>
        </div>
      ) : (
        <>
          <Filters search={search} />
          {members.isError || statuses.isError ? (
            <div className="mb-4 rounded-lg border bg-card p-4 shadow-sm">
              <LoadError
                title={t("admin.shipments.membersLoadFailed")}
                error={members.error ?? statuses.error}
                onRetry={() => {
                  if (members.isError) void members.refetch();
                  if (statuses.isError) void statuses.refetch();
                }}
              />
            </div>
          ) : null}
          <p className="mb-3 text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {t(
              views.length === 1 ? "admin.shipments.resultCountOne" : "admin.shipments.resultCount",
              {
                count: formatNumber(visible.length, 0),
                total: formatNumber(views.length, 0),
              },
            )}
          </p>
          {visible.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6 shadow-sm">
              <p className="text-sm text-foreground">{t("admin.shipments.noResults")}</p>
              <ClearFiltersButton />
            </div>
          ) : (
            <>
              <ShipmentsTable shipments={visible} />
              <ShipmentCards shipments={visible} />
            </>
          )}
        </>
      )}
      {dialog}
    </>
  );
}

// ---------------------------------------------------------------------------
// Filters (in the URL)
// ---------------------------------------------------------------------------

function useSetSearch() {
  const navigate = useNavigate({ from: Route.fullPath });
  return (patch: Partial<ShipmentListSearch>) =>
    void navigate({
      search: (prev) => {
        const next: ShipmentListSearch = { ...prev, ...patch };
        for (const key of Object.keys(next) as (keyof ShipmentListSearch)[]) {
          if (next[key] === undefined) delete next[key];
        }
        return next;
      },
      replace: true,
    });
}

function ClearFiltersButton() {
  const t = useT();
  const setSearch = useSetSearch();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setSearch({ q: undefined, type: undefined, open: undefined })}
    >
      <XCircle aria-hidden />
      {t("admin.shipments.clearFilters")}
    </Button>
  );
}

function Filters({ search }: { search: ShipmentListSearch }) {
  const t = useT();
  const id = useId();
  const setSearch = useSetSearch();
  const [query, setQuery] = useState(search.q ?? "");

  useEffect(() => {
    setQuery(search.q ?? "");
  }, [search.q]);
  useEffect(() => {
    const value = query.trim();
    if (value === (search.q ?? "")) return;
    const timer = window.setTimeout(() => setSearch({ q: value || undefined }), 300);
    return () => window.clearTimeout(timer);
    // setSearch is recreated each render; the URL value is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, search.q]);

  const filtered = Boolean(search.q || search.type || search.open);
  return (
    <div
      role="search"
      className="mb-4 grid gap-4 rounded-lg border bg-card p-4 shadow-sm md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
    >
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={`${id}-q`}>{t("admin.shipments.search")}</Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id={`${id}-q`}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setSearch({ q: query.trim() || undefined });
              }
            }}
            placeholder={t("admin.shipments.searchPlaceholder")}
            className="h-10 pl-9"
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={`${id}-type`}>{t("admin.shipments.typeFilter")}</Label>
        <Select
          value={search.type ?? ALL}
          onValueChange={(v) =>
            setSearch({
              type:
                v === ALL ? undefined : Constants.public.Enums.service_type.find((s) => s === v),
            })
          }
        >
          <SelectTrigger id={`${id}-type`} className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("admin.shipments.allTypes")}</SelectItem>
            {Constants.public.Enums.service_type.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`portal.serviceTypes.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2 md:col-span-2">
        <Button
          type="button"
          size="sm"
          variant={search.open ? "default" : "outline"}
          aria-pressed={search.open === true}
          onClick={() => setSearch({ open: search.open ? undefined : true })}
        >
          {search.open ? <CheckCircle2 aria-hidden /> : null}
          {t("admin.shipments.onlyOpen")}
        </Button>
        {filtered ? (
          <div className="ml-auto">
            <ClearFiltersButton />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results: a table from xl (1280 px), cards below
// ---------------------------------------------------------------------------

function OrdersCell({ summary }: { summary: ShipmentSummary | null }) {
  const t = useT();
  if (!summary) return <Muted>–</Muted>;
  if (summary.orderCount === 0) {
    return (
      <span className="whitespace-nowrap text-muted-foreground">
        {t("admin.shipments.noOrders")}
      </span>
    );
  }
  return (
    <span className="block tabular-nums">
      <span className="block font-semibold text-foreground">
        {t(
          summary.orderCount === 1 ? "admin.shipments.orderCountOne" : "admin.shipments.orderCount",
          { count: formatNumber(summary.orderCount, 0) },
        )}
      </span>
      <span className="block text-xs text-muted-foreground">
        {t(
          summary.customerCount === 1
            ? "admin.shipments.customerCountOne"
            : "admin.shipments.customerCount",
          { count: formatNumber(summary.customerCount, 0) },
        )}
        {" · "}
        {formatLbs(summary.measuredLbs)}
      </span>
    </span>
  );
}

function StatusCell({ summary }: { summary: ShipmentSummary | null }) {
  const t = useT();
  if (!summary || summary.orderCount === 0) return <Muted>–</Muted>;
  return (
    <div className="space-y-1.5">
      {isShipmentDone(summary) ? (
        <Badge variant="neutral">
          <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
          {t("admin.shipments.done")}
        </Badge>
      ) : null}
      <StageSummary stages={summary.stages} />
    </div>
  );
}

/** Date and time; in the table the time may go under the date (fits at 1280 px). */
function When({ value }: { value: string | null }) {
  const t = useT();
  return value ? (
    <span className="tabular-nums">
      {formatDateTime(value)
        .split(" ")
        .map((part, i) => (
          <Fragment key={i}>
            {i > 0 ? " " : null}
            <span className="whitespace-nowrap">{part}</span>
          </Fragment>
        ))}
    </span>
  ) : (
    <Muted>{t("admin.shipments.notYet")}</Muted>
  );
}

function ShipmentLink({ shipment, className }: { shipment: Shipment; className?: string }) {
  return (
    <Link
      to="/admin/zendingen/$id"
      params={{ id: shipment.id }}
      className={cn(
        "rounded-sm font-bold text-primary tabular-nums underline-offset-4 [overflow-wrap:anywhere] hover:underline",
        className,
      )}
    >
      {shipment.shipment_number}
    </Link>
  );
}

function ShipmentsTable({ shipments }: { shipments: ShipmentView[] }) {
  const t = useT();
  const th = "px-2 py-3 font-bold text-primary first:pl-4 last:pr-4";
  return (
    <div className="relative hidden overflow-x-auto rounded-lg border bg-card shadow-sm xl:block">
      <table className="w-full text-sm">
        <caption className="sr-only">{t("admin.shipments.tableCaption")}</caption>
        <thead className="border-b bg-cream text-left">
          <tr>
            <th scope="col" className={th}>
              {t("admin.shipments.columns.shipment")}
            </th>
            <th scope="col" className={th}>
              {t("admin.shipments.columns.type")}
            </th>
            <th scope="col" className={th}>
              {t("admin.shipments.columns.carrier")}
            </th>
            <th scope="col" className={th}>
              {t("admin.shipments.columns.departed")}
            </th>
            <th scope="col" className={th}>
              {t("admin.shipments.columns.arrived")}
            </th>
            <th scope="col" className={th}>
              {t("admin.shipments.columns.orders")}
            </th>
            <th scope="col" className={th}>
              {t("admin.shipments.columns.status")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {shipments.map((s) => (
            <tr key={s.id} className="align-top transition-colors hover:bg-cream/50">
              <td className="py-3 pl-4 pr-2">
                <ShipmentLink shipment={s} className="whitespace-nowrap" />
                <span className="mt-0.5 block whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                  <span className="sr-only">{t("admin.shipments.columns.created")}: </span>
                  {formatDate(s.created_at)}
                </span>
              </td>
              <td className="px-2 py-3">
                <ServiceTypeLabel type={s.service_type} className="whitespace-nowrap" />
              </td>
              <td className="max-w-72 px-2 py-3">
                {s.carrier ? (
                  <span className="block break-words">{s.carrier}</span>
                ) : (
                  <Muted>–</Muted>
                )}
                {s.awb_or_container_number ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums [overflow-wrap:anywhere]">
                    <span className="sr-only">{t("admin.shipments.columns.awb")}: </span>
                    {s.awb_or_container_number}
                  </span>
                ) : null}
              </td>
              <td className="px-2 py-3">
                <When value={s.departed_at} />
              </td>
              <td className="px-2 py-3">
                <When value={s.arrived_at} />
              </td>
              <td className="px-2 py-3">
                <OrdersCell summary={s.summary} />
              </td>
              <td className="py-3 pl-2 pr-4">
                <StatusCell summary={s.summary} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ShipmentCards({ shipments }: { shipments: ShipmentView[] }) {
  const t = useT();
  return (
    <ul
      className="grid gap-3 md:grid-cols-2 xl:hidden"
      aria-label={t("admin.shipments.tableCaption")}
    >
      {shipments.map((s) => (
        <li key={s.id} className="min-w-0 rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <ShipmentLink shipment={s} className="font-heading" />
              <p className="text-xs text-muted-foreground tabular-nums">
                {t("admin.shipments.columns.created")}: {formatDate(s.created_at)}
              </p>
            </div>
            <ServiceTypeLabel type={s.service_type} className="text-sm" />
          </div>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">
                {t("admin.shipments.columns.carrier")}
              </dt>
              <dd className="break-words">{s.carrier ?? <Muted>–</Muted>}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t("admin.shipments.columns.awb")}</dt>
              <dd className="tabular-nums [overflow-wrap:anywhere]">
                {s.awb_or_container_number ?? <Muted>–</Muted>}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">
                {t("admin.shipments.columns.departed")}
              </dt>
              <dd>
                <When value={s.departed_at} />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">
                {t("admin.shipments.columns.arrived")}
              </dt>
              <dd>
                <When value={s.arrived_at} />
              </dd>
            </div>
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-xs text-muted-foreground">
                {t("admin.shipments.columns.orders")}
              </dt>
              <dd>
                <OrdersCell summary={s.summary} />
              </dd>
            </div>
            {s.summary && s.summary.orderCount > 0 ? (
              <div className="min-w-0 sm:col-span-2">
                <dt className="text-xs text-muted-foreground">
                  {t("admin.shipments.columns.status")}
                </dt>
                <dd className="mt-1">
                  <StatusCell summary={s.summary} />
                </dd>
              </div>
            ) : null}
          </dl>
        </li>
      ))}
    </ul>
  );
}
