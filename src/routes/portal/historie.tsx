import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowRightLeft,
  CalendarDays,
  ClipboardList,
  PackagePlus,
  Plane,
  Receipt,
  Search,
  Ship,
  Wallet,
  XCircle,
} from "lucide-react";

import { ShellPageHeader } from "@/components/layout/AppShell";
import { LoadError } from "@/components/portal/Section";
import {
  B2bBadge,
  InvoiceStatusBadge,
  OrderStatusBadge,
  StageIcon,
} from "@/components/portal/StatusBadges";
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
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { t, useT } from "@/lib/i18n";
import { paths } from "@/lib/paths";
import {
  HISTORY_TYPES,
  filterHistory,
  groupByYear,
  hasHistoryFilters,
  historyQueryOptions,
  historySearchSchema,
  historyYears,
  yearSummaryText,
  type HistoryRecord,
  type HistorySearch,
  type YearSummary,
} from "@/lib/portal/history";
import { resolveStatus, statusesQueryOptions, type StatusMap } from "@/lib/portal/orders";
import { usePortalCustomer } from "@/lib/portal/use-portal-customer";
import { cn } from "@/lib/utils";

/**
 * /portal/historie (SPEC §20): the customer's complete history per year —
 * "2026 – 12 orders, 8 zendingen, 7 facturen" from customer_history_by_year,
 * then every order, shipment, invoice, payment and status change, filtered
 * by year and kind and searched in the browser (filters in the URL). Each
 * record opens its own page; a shipment lists the customer's orders in it.
 */
export const Route = createFileRoute("/portal/historie")({
  validateSearch: (search: Record<string, unknown>): HistorySearch =>
    historySearchSchema.parse(search),
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("portal.history.title") }) }] }),
  component: HistoryPage,
});

const ALL = "all";

function HistoryPage() {
  const t = useT();
  const { auth, customer } = usePortalCustomer();
  const search = Route.useSearch();
  const history = useQuery(historyQueryOptions(auth.userId, customer.id));
  const statuses = useQuery(statusesQueryOptions(auth.userId));
  const statusMap: StatusMap = useMemo(() => statuses.data ?? new Map(), [statuses.data]);

  const header = (
    <ShellPageHeader title={t("portal.history.title")} description={t("portal.history.intro")} />
  );

  if (history.isError) {
    return (
      <>
        {header}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <LoadError
            title={t("portal.history.loadFailed")}
            error={history.error}
            onRetry={() => void history.refetch()}
          />
        </div>
      </>
    );
  }

  if (history.isPending) {
    return (
      <>
        {header}
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only">{t("common.loading")}</span>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </>
    );
  }

  const { records, years } = history.data;
  if (records.length === 0) {
    return (
      <>
        {header}
        <div className="flex flex-col items-start gap-4 rounded-lg border bg-card p-6 shadow-sm">
          <div>
            <h2 className="text-lg text-foreground">{t("portal.history.emptyTitle")}</h2>
            <p className="mt-1 max-w-prose text-sm leading-6 text-muted-foreground">
              {t("portal.history.emptyText")}
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

  const yearOptions = historyYears(years, records);
  const visible = filterHistory(records, search, statusMap);

  return (
    <>
      {header}
      <YearCards summaries={years} years={yearOptions} selected={search.year} />
      <Filters search={search} years={yearOptions} />
      <p className="mb-3 text-sm text-muted-foreground tabular-nums" aria-live="polite">
        {records.length === 1
          ? t("portal.history.resultCountOne", { count: formatNumber(visible.length, 0) })
          : t("portal.history.resultCount", {
              count: formatNumber(visible.length, 0),
              total: formatNumber(records.length, 0),
            })}
      </p>
      {visible.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6 shadow-sm">
          <p className="text-sm text-foreground">{t("portal.history.noResults")}</p>
          <ClearFiltersButton />
        </div>
      ) : (
        <div className="space-y-6">
          {groupByYear(visible).map(([year, list]) => (
            <section key={year} aria-labelledby={`history-year-${year}`}>
              <h2
                id={`history-year-${year}`}
                className="mb-2 font-heading text-xl font-bold text-primary tabular-nums"
              >
                {year}
              </h2>
              <ol className="divide-y rounded-lg border bg-card shadow-sm">
                {list.map((record) => (
                  <HistoryRow key={record.key} record={record} statuses={statusMap} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Per year (customer_history_by_year)
// ---------------------------------------------------------------------------

function YearCards({
  summaries,
  years,
  selected,
}: {
  summaries: readonly YearSummary[];
  years: readonly number[];
  selected: number | undefined;
}) {
  const t = useT();
  const setSearch = useSetSearch();
  const byYear = new Map(summaries.map((s) => [s.year, s]));
  return (
    <section aria-labelledby="history-years" className="mb-4">
      <h2 id="history-years" className="sr-only">
        {t("portal.history.yearsTitle")}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {years.map((year) => {
          const summary = byYear.get(year) ?? {
            year,
            orders: 0,
            shipments: 0,
            invoices: 0,
            payments: 0,
          };
          const active = selected === year;
          const text = yearSummaryText(summary);
          return (
            <li key={year}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => setSearch({ year: active ? undefined : year })}
                className={cn(
                  "flex h-full w-full items-start gap-3 rounded-lg border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active && "border-primary bg-cream",
                )}
              >
                <CalendarDays className="mt-1 size-5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="font-heading text-xl font-bold text-primary tabular-nums">
                      {year}
                    </span>
                    {active ? (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                        {t("portal.history.yearSelected")}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-sm text-foreground">{text}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Filters (in the URL)
// ---------------------------------------------------------------------------

function useSetSearch() {
  const navigate = useNavigate({ from: Route.fullPath });
  return (patch: Partial<HistorySearch>) =>
    void navigate({
      search: (prev) => {
        const next: HistorySearch = { ...prev, ...patch };
        for (const key of Object.keys(next) as (keyof HistorySearch)[]) {
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
      onClick={() => setSearch({ year: undefined, type: undefined, q: undefined })}
    >
      <XCircle aria-hidden />
      {t("portal.history.filters.clear")}
    </Button>
  );
}

function Filters({ search, years }: { search: HistorySearch; years: readonly number[] }) {
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

  return (
    <div
      role="search"
      className="mb-4 grid gap-3 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))]"
    >
      <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
        <Label htmlFor={`${id}-q`}>{t("portal.history.filters.search")}</Label>
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
            placeholder={t("portal.history.filters.searchPlaceholder")}
            className="h-10 pl-9"
            maxLength={200}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-year`}>{t("portal.history.filters.year")}</Label>
        <Select
          value={search.year ? String(search.year) : ALL}
          onValueChange={(v) => setSearch({ year: v === ALL ? undefined : Number(v) })}
        >
          <SelectTrigger id={`${id}-year`} className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("portal.history.filters.allYears")}</SelectItem>
            {years.map((year) => (
              <SelectItem key={year} value={String(year)}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-type`}>{t("portal.history.filters.type")}</Label>
        <Select
          value={search.type ?? ALL}
          onValueChange={(v) =>
            setSearch({ type: v === ALL ? undefined : HISTORY_TYPES.find((x) => x === v) })
          }
        >
          <SelectTrigger id={`${id}-type`} className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("portal.history.filters.allTypes")}</SelectItem>
            {HISTORY_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`portal.history.types.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {hasHistoryFilters(search) ? (
        <div className="sm:col-span-2 lg:col-span-3">
          <ClearFiltersButton />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One record
// ---------------------------------------------------------------------------

const linkClass =
  "rounded-sm font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline";

function HistoryRow({ record, statuses }: { record: HistoryRecord; statuses: StatusMap }) {
  const t = useT();
  let icon: ReactNode;
  let title: ReactNode;
  let when: ReactNode;
  const details: ReactNode[] = [];

  switch (record.type) {
    case "orders": {
      icon = <ClipboardList className="size-4" aria-hidden />;
      title = (
        <Link to="/portal/orders/$id" params={{ id: record.orderId }} className={linkClass}>
          {t("portal.history.record.order", { reference: record.reference })}
        </Link>
      );
      when = <time dateTime={record.at}>{formatDateTime(record.at)}</time>;
      const what = [record.storeVendor, record.description].filter(Boolean).join(" · ");
      if (what) details.push(<span className="break-words">{what}</span>);
      details.push(
        <span className="flex flex-wrap gap-1.5">
          <OrderStatusBadge status={resolveStatus(record.status, statuses)} />
          {record.orderType === "b2b" ? <B2bBadge /> : null}
        </span>,
      );
      break;
    }
    case "shipments": {
      const ServiceIcon = record.serviceType === "sea" ? Ship : Plane;
      icon = <ServiceIcon className="size-4" aria-hidden />;
      title = (
        <span className="font-semibold text-foreground tabular-nums">
          {t("portal.history.record.shipment", { number: record.shipmentNumber })}
        </span>
      );
      when = record.departedAt ? (
        <time dateTime={record.departedAt}>
          {t("portal.history.record.departed", { date: formatDate(record.departedAt) })}
        </time>
      ) : (
        t("portal.history.record.notDeparted")
      );
      details.push(
        <span className="break-words">
          {[t(`portal.serviceTypes.${record.serviceType}`), record.carrier, record.awb]
            .filter(Boolean)
            .join(" · ")}
          {record.arrivedAt
            ? ` · ${t("portal.history.record.arrived", { date: formatDate(record.arrivedAt) })}`
            : ""}
        </span>,
      );
      details.push(
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span>{t("portal.history.record.shipmentOrders")}</span>
          {record.orders.map((o) => (
            <Link
              key={o.id}
              to="/portal/orders/$id"
              params={{ id: o.id }}
              className="rounded-sm font-semibold text-primary tabular-nums underline underline-offset-4"
            >
              {o.reference}
            </Link>
          ))}
        </span>,
      );
      break;
    }
    case "invoices": {
      icon = <Receipt className="size-4" aria-hidden />;
      const number = record.invoiceNumber ?? t("portal.history.record.invoiceDraftNumber");
      title = (
        <Link to="/portal/facturen/$id" params={{ id: record.invoiceId }} className={linkClass}>
          {t("portal.history.record.invoice", { number })}
        </Link>
      );
      when = (
        <time dateTime={record.invoiceDate}>
          {t("portal.history.record.invoiceDate", { date: formatDate(record.invoiceDate) })}
        </time>
      );
      const money =
        record.currency && record.total !== null
          ? [
              t("portal.history.record.invoiceTotal", {
                amount: formatMoney(record.total, record.currency),
              }),
              record.balance && record.balance > 0
                ? t("portal.history.record.invoiceBalance", {
                    amount: formatMoney(record.balance, record.currency),
                  })
                : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : null;
      if (money) details.push(<span className="tabular-nums">{money}</span>);
      details.push(
        <InvoiceStatusBadge invoice={{ status: record.status, is_overdue: record.isOverdue }} />,
      );
      break;
    }
    case "payments": {
      icon = <Wallet className="size-4" aria-hidden />;
      title = (
        <Link to="/portal/facturen/$id" params={{ id: record.invoiceId }} className={linkClass}>
          {record.invoiceNumber
            ? t("portal.history.record.payment", { number: record.invoiceNumber })
            : t("portal.history.record.paymentNoNumber")}
        </Link>
      );
      when = (
        <time dateTime={record.paidOn}>
          {t("portal.history.record.paidOn", { date: formatDate(record.paidOn) })}
        </time>
      );
      details.push(
        <span className="tabular-nums">
          {[
            record.currency ? formatMoney(record.amount, record.currency) : null,
            t(`portal.invoices.methods.${record.method}`),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>,
      );
      break;
    }
    case "status": {
      const status = resolveStatus(record.toStatus, statuses);
      const label = status.label ?? t("portal.statusUnknown");
      icon = status.stage ? (
        <StageIcon stage={status.stage} className="size-4" />
      ) : (
        <ArrowRightLeft className="size-4" aria-hidden />
      );
      title = (
        <Link to="/portal/orders/$id" params={{ id: record.orderId }} className={linkClass}>
          {record.reference
            ? t("portal.history.record.status", { reference: record.reference, status: label })
            : t("portal.history.record.statusNoRef", { status: label })}
        </Link>
      );
      when = <time dateTime={record.at}>{formatDateTime(record.at)}</time>;
      if (record.message) {
        details.push(<span className="whitespace-pre-line break-words">{record.message}</span>);
      }
      break;
    }
  }

  return (
    <li className="flex gap-3 px-4 py-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-cream text-primary">
        {icon}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
          <p className="min-w-0 break-words">{title}</p>
          <p className="shrink-0 text-xs text-muted-foreground tabular-nums">{when}</p>
        </div>
        <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t(`portal.history.typeOne.${record.type}`)}
        </p>
        {details.map((detail, i) => (
          <div key={i} className="mt-1 text-muted-foreground">
            {detail}
          </div>
        ))}
      </div>
    </li>
  );
}
