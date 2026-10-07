import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Link2, PackagePlus, Search, XCircle } from "lucide-react";

import { ShellPageHeader } from "@/components/layout/AppShell";
import { LoadError, Muted } from "@/components/portal/Section";
import { B2bBadge, OrderStatusBadge } from "@/components/portal/StatusBadges";
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
import { formatDate, formatNumber } from "@/lib/format";
import { t, useT } from "@/lib/i18n";
import { paths } from "@/lib/paths";
import {
  ORDER_SORTS,
  ORDER_STAGE_FILTERS,
  filterOrders,
  orderListSearchSchema,
  ordersQueryOptions,
  resolveStatus,
  statusesQueryOptions,
  type OrderListItem,
  type OrderListSearch,
  type StatusMap,
} from "@/lib/portal/orders";
import { usePortalCustomer } from "@/lib/portal/use-portal-customer";

/**
 * /portal/orders (SPEC §8, §10, §35.7): the customer's orders from Supabase
 * (RLS: own orders only), searched, filtered and sorted in the browser. The
 * filters live in the URL, so the dashboard cards can link to them.
 */
export const Route = createFileRoute("/portal/orders/")({
  validateSearch: (search: Record<string, unknown>): OrderListSearch =>
    orderListSearchSchema.parse(search),
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("portal.orders.title") }) }] }),
  component: OrdersPage,
});

const ALL = "all";

function OrdersPage() {
  const t = useT();
  const { auth, customer } = usePortalCustomer();
  const search = Route.useSearch();
  const orders = useQuery(ordersQueryOptions(auth.userId, customer.id));
  const statuses = useQuery(statusesQueryOptions(auth.userId));

  // The empty state has its own "Order aanmelden": no second one in the header.
  const empty = orders.data?.length === 0;
  const header = (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-start sm:justify-between">
      <ShellPageHeader
        title={t("portal.orders.title")}
        description={t("portal.orders.intro")}
        className="mb-0"
      />
      {empty ? null : (
        <Button asChild className="self-start">
          <Link to={paths.portalOrderNew}>
            <PackagePlus aria-hidden />
            {t("portal.nav.newOrder")}
          </Link>
        </Button>
      )}
    </div>
  );

  if (orders.isError || statuses.isError) {
    return (
      <>
        {header}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <LoadError
            title={t("portal.orders.loadFailed")}
            error={orders.error ?? statuses.error}
            onRetry={() => {
              if (orders.isError) void orders.refetch();
              if (statuses.isError) void statuses.refetch();
            }}
          />
        </div>
      </>
    );
  }

  if (orders.isPending || statuses.isPending) {
    return (
      <>
        {header}
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only">{t("common.loading")}</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </>
    );
  }

  if (orders.data.length === 0) {
    return (
      <>
        {header}
        <div className="flex flex-col items-start gap-4 rounded-lg border bg-card p-6 shadow-sm">
          <div>
            <h2 className="text-lg text-foreground">{t("portal.orders.emptyTitle")}</h2>
            <p className="mt-1 max-w-prose text-sm leading-6 text-muted-foreground">
              {t("portal.orders.emptyText")}
            </p>
          </div>
          <Button asChild>
            <Link to={paths.portalOrderNew}>
              <PackagePlus aria-hidden />
              {t("portal.nav.newOrder")}
            </Link>
          </Button>
        </div>
      </>
    );
  }

  const visible = filterOrders(orders.data, statuses.data, search);
  const filtered = Boolean(search.q || search.stage || search.type);

  return (
    <>
      {header}
      <Filters search={search} />
      <p className="mb-3 text-sm text-muted-foreground tabular-nums" aria-live="polite">
        {t(
          orders.data.length === 1 ? "portal.orders.resultCountOne" : "portal.orders.resultCount",
          {
            count: formatNumber(visible.length, 0),
            total: formatNumber(orders.data.length, 0),
          },
        )}
      </p>
      {visible.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6 shadow-sm">
          <p className="text-sm text-foreground">{t("portal.orders.noResults")}</p>
          {filtered ? <ClearFiltersButton /> : null}
        </div>
      ) : (
        <>
          <OrdersTable orders={visible} statuses={statuses.data} />
          <OrderCards orders={visible} statuses={statuses.data} />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Search, filters and sort (kept in the URL)
// ---------------------------------------------------------------------------

function useSetSearch() {
  const navigate = useNavigate({ from: Route.fullPath });
  return (patch: Partial<OrderListSearch>) =>
    void navigate({
      search: (prev) => {
        const next: OrderListSearch = { ...prev, ...patch };
        // Defaults stay out of the URL.
        if (!next.q) delete next.q;
        if (!next.stage) delete next.stage;
        if (!next.type) delete next.type;
        if (!next.sort || next.sort === "newest") delete next.sort;
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
      onClick={() => setSearch({ q: undefined, stage: undefined, type: undefined })}
    >
      <XCircle aria-hidden />
      {t("portal.orders.clearFilters")}
    </Button>
  );
}

function Filters({ search }: { search: OrderListSearch }) {
  const t = useT();
  const id = useId();
  const setSearch = useSetSearch();
  const [query, setQuery] = useState(search.q ?? "");

  // Typing updates the URL after a short pause; a change from outside
  // (e.g. "Filters wissen", back button) updates the field.
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

  const filtered = Boolean(search.q || search.stage || search.type);

  return (
    <div
      role="search"
      className="mb-4 grid gap-3 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]"
    >
      <div className="space-y-1.5 sm:col-span-2 xl:col-span-1">
        <Label htmlFor={`${id}-q`}>{t("portal.orders.search")}</Label>
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
            placeholder={t("portal.orders.searchPlaceholder")}
            className="h-10 pl-9"
            maxLength={200}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-stage`}>{t("portal.orders.stageFilter")}</Label>
        <Select
          value={search.stage ?? ALL}
          onValueChange={(v) =>
            setSearch({
              stage: v === ALL ? undefined : ORDER_STAGE_FILTERS.find((s) => s === v),
            })
          }
        >
          <SelectTrigger id={`${id}-stage`} className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("portal.orders.allStages")}</SelectItem>
            {ORDER_STAGE_FILTERS.map((stage) => (
              <SelectItem key={stage} value={stage}>
                {t(`portal.stages.${stage}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-type`}>{t("portal.orders.typeFilter")}</Label>
        <Select
          value={search.type ?? ALL}
          onValueChange={(v) =>
            setSearch({
              type: v === ALL ? undefined : Constants.public.Enums.order_type.find((o) => o === v),
            })
          }
        >
          <SelectTrigger id={`${id}-type`} className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("portal.orders.allTypes")}</SelectItem>
            {Constants.public.Enums.order_type.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`portal.orderTypes.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-sort`}>{t("portal.orders.sort")}</Label>
        <Select
          value={search.sort ?? "newest"}
          onValueChange={(v) => setSearch({ sort: ORDER_SORTS.find((s) => s === v) })}
        >
          <SelectTrigger id={`${id}-sort`} className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ORDER_SORTS.map((sort) => (
              <SelectItem key={sort} value={sort}>
                {t(`portal.orders.${sort}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered ? (
        <div className="sm:col-span-2 xl:col-span-4">
          <ClearFiltersButton />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results: a table from xl up (where the main column is wide enough for
// references, dates and tracking numbers on one line), cards below (SPEC §25,
// §35.14): one column on phones, two from md.
// ---------------------------------------------------------------------------

function OrderMarkers({ order }: { order: OrderListItem }) {
  const t = useT();
  if (order.order_type !== "b2b" && !order.parent_order_id && !order.cancellation_requested_at) {
    return null;
  }
  return (
    <span className="mt-1 flex flex-wrap gap-1.5">
      {order.order_type === "b2b" ? <B2bBadge /> : null}
      {order.parent_order_id ? (
        <Badge variant="outline">
          <Link2 className="size-3.5 shrink-0" aria-hidden />
          {t("portal.orders.extraPackage")}
        </Badge>
      ) : null}
      {order.cancellation_requested_at ? (
        <Badge variant="neutral">{t("portal.orders.cancellationRequested")}</Badge>
      ) : null}
    </span>
  );
}

function OrdersTable({ orders, statuses }: { orders: OrderListItem[]; statuses: StatusMap }) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <div className="hidden overflow-hidden rounded-lg border bg-card shadow-sm xl:block">
      <table className="w-full text-sm">
        <caption className="sr-only">{t("portal.orders.tableCaption")}</caption>
        <thead className="border-b bg-cream text-left">
          <tr>
            <th scope="col" className="w-44 px-4 py-3 font-bold text-primary">
              {t("portal.orders.columns.reference")}
            </th>
            <th scope="col" className="px-4 py-3 font-bold text-primary">
              {t("portal.orders.columns.store")}
            </th>
            {/* Room for a usual tracking number (UPS, USPS, Amazon) on one line. */}
            <th scope="col" className="w-56 px-4 py-3 font-bold text-primary">
              {t("portal.orders.columns.tracking")}
            </th>
            <th scope="col" className="px-4 py-3 font-bold text-primary">
              {t("portal.orders.columns.status")}
            </th>
            <th scope="col" className="w-10 px-2 py-3">
              <span className="sr-only">{t("portal.latestOrder.view")}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {orders.map((order) => (
            <tr
              key={order.id}
              className="cursor-pointer align-top transition-colors hover:bg-cream/60"
              onClick={(e) => {
                // Clicks on the links themselves navigate already.
                if ((e.target as HTMLElement).closest("a")) return;
                void navigate({ to: "/portal/orders/$id", params: { id: order.id } });
              }}
            >
              <td className="px-4 py-3">
                <Link
                  to="/portal/orders/$id"
                  params={{ id: order.id }}
                  className="whitespace-nowrap rounded-sm font-heading font-bold text-primary tabular-nums underline-offset-4 hover:underline"
                >
                  {order.reference}
                </Link>
                <span className="mt-0.5 block whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                  {t("portal.orders.columns.date")}: {formatDate(order.created_at)}
                </span>
                <OrderMarkers order={order} />
              </td>
              <td className="px-4 py-3">
                <span className="block break-words font-semibold text-foreground">
                  {order.store_vendor ?? <Muted>{t("portal.order.notProvided")}</Muted>}
                </span>
                {order.description ? (
                  <span className="mt-0.5 line-clamp-2 break-words text-foreground">
                    {order.description}
                  </span>
                ) : null}
                {order.vendor_order_number ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
                    {t("portal.orders.columns.vendorOrder")}:{" "}
                    {/* One unit: the number moves to the next line whole instead of splitting at a dash. */}
                    <span className="inline-block max-w-full [overflow-wrap:anywhere]">
                      {order.vendor_order_number}
                    </span>
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3">
                {order.tracking_number ? (
                  <>
                    <span className="block tabular-nums [overflow-wrap:anywhere]">
                      {order.tracking_number}
                    </span>
                    {order.carrier ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {order.carrier}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="whitespace-nowrap">
                    <Muted>{t("portal.orders.trackingUnknown")}</Muted>
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                <OrderStatusBadge status={resolveStatus(order.status, statuses)} />
              </td>
              <td className="px-2 py-3 text-right">
                <Link
                  to="/portal/orders/$id"
                  params={{ id: order.id }}
                  className="inline-flex size-8 items-center justify-center rounded-md text-primary hover:bg-cream"
                  tabIndex={-1}
                  aria-hidden
                >
                  <ChevronRight className="size-4" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderCards({ orders, statuses }: { orders: OrderListItem[]; statuses: StatusMap }) {
  const t = useT();
  return (
    <ul
      className="grid gap-3 md:grid-cols-2 xl:hidden"
      aria-label={t("portal.orders.tableCaption")}
    >
      {orders.map((order) => (
        <li key={order.id}>
          <Link
            to="/portal/orders/$id"
            params={{ id: order.id }}
            className="block h-full rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-primary/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-heading font-bold text-primary tabular-nums">
                  {order.reference}
                </p>
                <p className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                  {t("portal.orders.columns.date")}: {formatDate(order.created_at)}
                </p>
              </div>
              <ChevronRight className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            </div>
            <OrderMarkers order={order} />
            <div className="mt-3">
              <OrderStatusBadge status={resolveStatus(order.status, statuses)} />
            </div>
            {order.description ? (
              <p className="mt-3 line-clamp-2 break-words text-sm text-foreground">
                {order.description}
              </p>
            ) : null}
            {/* Label above value: the full card width for long order and tracking numbers. */}
            <dl className="mt-3 grid gap-2 text-sm">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">
                  {t("portal.orders.columns.store")}
                </dt>
                <dd className="break-words">
                  {order.store_vendor ?? <Muted>{t("portal.order.notProvided")}</Muted>}
                </dd>
              </div>
              {order.vendor_order_number ? (
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">
                    {t("portal.orders.columns.vendorOrder")}
                  </dt>
                  <dd className="tabular-nums [overflow-wrap:anywhere]">
                    {order.vendor_order_number}
                  </dd>
                </div>
              ) : null}
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">
                  {t("portal.orders.columns.tracking")}
                </dt>
                <dd className="tabular-nums [overflow-wrap:anywhere]">
                  {order.tracking_number ?? <Muted>{t("portal.orders.trackingUnknown")}</Muted>}
                </dd>
              </div>
            </dl>
          </Link>
        </li>
      ))}
    </ul>
  );
}
