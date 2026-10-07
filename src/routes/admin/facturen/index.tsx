import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router";
import { FilePlus2, Search, XCircle } from "lucide-react";

import { ShellPageHeader } from "@/components/layout/AppShell";
import { CurrencyAmounts } from "@/components/portal/CurrencyAmounts";
import { LoadError, Muted } from "@/components/portal/Section";
import { InvoiceStatusBadge } from "@/components/portal/StatusBadges";
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
  INVOICE_PERIODS,
  INVOICE_SORTS,
  INVOICE_STATUS_FILTERS,
  adminInvoicesQueryOptions,
  filterInvoices,
  hasInvoiceFilters,
  invoiceListSearchSchema,
  joinInvoices,
  summarizeInvoiceList,
  type AdminInvoiceListItem,
  type InvoiceListSearch,
} from "@/lib/admin/invoices";
import { customerDisplayName, customersQueryOptions } from "@/lib/admin/orders";
import { formatDate, formatMoney, formatNumber, todayInSuriname } from "@/lib/format";
import { t, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * /admin/facturen (SPEC §17, §35.9, §35.10): every invoice, drafts too, with
 * search (number, customer, GR code, order reference), filters (status with
 * "Achterstallig" from invoice_overview, currency, period) and sort in the
 * URL, and the totals of what the filters show PER CURRENCY.
 */
export const Route = createFileRoute("/admin/facturen/")({
  validateSearch: (search: Record<string, unknown>): InvoiceListSearch =>
    invoiceListSearchSchema.parse(search),
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("admin.invoices.title") }) }] }),
  component: InvoicesPage,
});

const adminRoute = getRouteApi("/admin");
const ALL = "all";

function InvoicesPage() {
  const t = useT();
  const { auth } = adminRoute.useRouteContext();
  const search = Route.useSearch();
  const invoices = useQuery(adminInvoicesQueryOptions(auth.userId));
  const customers = useQuery(customersQueryOptions(auth.userId));
  const today = todayInSuriname();

  const all = useMemo(
    () => (invoices.data ? joinInvoices(invoices.data, customers.data) : []),
    [invoices.data, customers.data],
  );
  const visible = useMemo(() => filterInvoices(all, search, today), [all, search, today]);
  const summary = useMemo(() => summarizeInvoiceList(visible), [visible]);

  const header = (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <ShellPageHeader
        title={t("admin.invoices.title")}
        description={t("admin.invoices.intro")}
        className="mb-0"
      />
      <Button asChild className="self-start">
        <Link to="/admin/facturen/nieuw">
          <FilePlus2 aria-hidden />
          {t("admin.invoices.new")}
        </Link>
      </Button>
    </div>
  );

  if (invoices.isError) {
    return (
      <>
        {header}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <LoadError
            title={t("admin.invoices.loadFailed")}
            error={invoices.error}
            onRetry={() => void invoices.refetch()}
          />
        </div>
      </>
    );
  }
  if (invoices.isPending) {
    return (
      <>
        {header}
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only">{t("common.loading")}</span>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      {all.length === 0 ? (
        <div className="flex flex-col items-start gap-4 rounded-lg border bg-card p-6 shadow-sm">
          <div>
            <h2 className="text-lg text-foreground">{t("admin.invoices.emptyTitle")}</h2>
            <p className="mt-1 max-w-prose text-sm leading-6 text-muted-foreground">
              {t("admin.invoices.emptyText")}
            </p>
          </div>
          <Button asChild>
            <Link to="/admin/facturen/nieuw">
              <FilePlus2 aria-hidden />
              {t("admin.invoices.new")}
            </Link>
          </Button>
        </div>
      ) : (
        <>
          <Filters search={search} />
          {customers.isError ? (
            <div className="mb-4 rounded-lg border bg-card p-4 shadow-sm">
              <LoadError
                title={t("admin.invoices.customersLoadFailed")}
                error={customers.error}
                onRetry={() => void customers.refetch()}
              />
            </div>
          ) : null}
          <Totals summary={summary} />
          <p className="mb-3 text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {t(all.length === 1 ? "admin.invoices.resultCountOne" : "admin.invoices.resultCount", {
              count: formatNumber(visible.length, 0),
              total: formatNumber(all.length, 0),
            })}
          </p>
          {visible.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6 shadow-sm">
              <p className="text-sm text-foreground">{t("admin.invoices.noResults")}</p>
              <ClearFiltersButton />
            </div>
          ) : (
            <>
              <InvoicesTable invoices={visible} />
              <InvoiceCards invoices={visible} />
            </>
          )}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Filters (in the URL)
// ---------------------------------------------------------------------------

function useSetSearch() {
  const navigate = useNavigate({ from: Route.fullPath });
  return (patch: Partial<InvoiceListSearch>) =>
    void navigate({
      search: (prev) => {
        const next: InvoiceListSearch = { ...prev, ...patch };
        for (const key of Object.keys(next) as (keyof InvoiceListSearch)[]) {
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
      onClick={() =>
        setSearch({
          q: undefined,
          status: undefined,
          currency: undefined,
          period: undefined,
          from: undefined,
          to: undefined,
        })
      }
    >
      <XCircle aria-hidden />
      {t("admin.invoices.clearFilters")}
    </Button>
  );
}

function Filters({ search }: { search: InvoiceListSearch }) {
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

  return (
    <div
      role="search"
      className="mb-4 grid gap-4 rounded-lg border bg-card p-4 shadow-sm md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]"
    >
      <div className="min-w-0 space-y-1.5 md:col-span-2 xl:col-span-1">
        <Label htmlFor={`${id}-q`}>{t("admin.invoices.search")}</Label>
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
            placeholder={t("admin.invoices.searchPlaceholder")}
            className="h-10 pl-9"
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>
      <FilterSelect
        id={`${id}-status`}
        label={t("admin.invoices.statusFilter")}
        value={search.status ?? ALL}
        options={[
          { value: ALL, label: t("admin.invoices.allStatuses") },
          ...INVOICE_STATUS_FILTERS.map((s) => ({
            value: s,
            label: t(`admin.invoices.statuses.${s}`),
          })),
        ]}
        onChange={(v) => setSearch({ status: INVOICE_STATUS_FILTERS.find((s) => s === v) })}
      />
      <FilterSelect
        id={`${id}-currency`}
        label={t("admin.invoices.currencyFilter")}
        value={search.currency ?? ALL}
        options={[
          { value: ALL, label: t("admin.invoices.allCurrencies") },
          ...Constants.public.Enums.currency_code.map((c) => ({ value: c, label: c })),
        ]}
        onChange={(v) =>
          setSearch({ currency: Constants.public.Enums.currency_code.find((c) => c === v) })
        }
      />
      <FilterSelect
        id={`${id}-period`}
        label={t("admin.invoices.periodFilter")}
        value={search.period ?? ALL}
        options={[
          { value: ALL, label: t("admin.invoices.allPeriods") },
          ...INVOICE_PERIODS.map((p) => ({ value: p, label: t(`admin.invoices.periods.${p}`) })),
        ]}
        onChange={(v) => {
          const period = INVOICE_PERIODS.find((p) => p === v);
          setSearch(period === "custom" ? { period } : { period, from: undefined, to: undefined });
        }}
      />
      <FilterSelect
        id={`${id}-sort`}
        label={t("admin.invoices.sort")}
        value={search.sort ?? "newest"}
        options={INVOICE_SORTS.map((s) => ({ value: s, label: t(`admin.invoices.sorts.${s}`) }))}
        onChange={(v) => {
          const sort = INVOICE_SORTS.find((s) => s === v);
          setSearch({ sort: sort === "newest" ? undefined : sort });
        }}
      />
      {search.period === "custom" ? (
        <div className="grid gap-4 sm:grid-cols-2 md:col-span-2 xl:col-span-5 xl:max-w-xl">
          <DateFilter
            id={`${id}-from`}
            label={t("admin.invoices.from")}
            value={search.from ?? ""}
            onChange={(v) => setSearch({ from: v || undefined })}
          />
          <DateFilter
            id={`${id}-to`}
            label={t("admin.invoices.to")}
            value={search.to ?? ""}
            onChange={(v) => setSearch({ to: v || undefined })}
          />
        </div>
      ) : null}
      {hasInvoiceFilters(search) ? (
        <div className="md:col-span-2 xl:col-span-5">
          <ClearFiltersButton />
        </div>
      ) : null}
    </div>
  );
}

function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-10">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DateFilter({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10"
        aria-describedby={`${id}-chosen`}
      />
      <p id={`${id}-chosen`} className="text-xs text-muted-foreground tabular-nums">
        {/^\d{4}-\d{2}-\d{2}$/.test(value)
          ? t("admin.invoiceBuilder.chosenDate", { date: formatDate(value) })
          : null}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Totals per currency (never added across currencies)
// ---------------------------------------------------------------------------

function Totals({ summary }: { summary: ReturnType<typeof summarizeInvoiceList> }) {
  const t = useT();
  const cell = (
    label: string,
    amounts: ReturnType<typeof summarizeInvoiceList>["paid"],
    danger = false,
  ) => (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd
        className={cn("mt-0.5 font-semibold", danger && amounts.length > 0 && "text-destructive")}
      >
        {amounts.length > 0 ? (
          <CurrencyAmounts amounts={amounts} />
        ) : (
          t("admin.invoices.totals.none")
        )}
      </dd>
    </div>
  );
  return (
    <section
      aria-labelledby="invoice-totals-title"
      className="mb-4 rounded-lg border bg-cream/50 p-4 text-sm"
    >
      <h2 id="invoice-totals-title" className="text-sm font-bold text-primary">
        {t("admin.invoices.totals.title")}{" "}
        <span className="font-normal text-muted-foreground tabular-nums">
          ·{" "}
          {summary.issuedCount === 1
            ? t("admin.invoices.totals.countOne")
            : t("admin.invoices.totals.count", { count: formatNumber(summary.issuedCount, 0) })}
        </span>
      </h2>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cell(t("admin.invoices.totals.invoiced"), summary.invoiced)}
        {cell(t("admin.invoices.totals.paid"), summary.paid)}
        {cell(t("admin.invoices.totals.outstanding"), summary.outstanding)}
        {cell(t("admin.invoices.totals.overdue"), summary.overdue, true)}
      </dl>
      <p className="mt-3 text-xs text-muted-foreground tabular-nums">
        {t("admin.invoices.totals.note", {
          drafts: formatNumber(summary.draftCount, 0),
          cancelled: formatNumber(summary.cancelledCount, 0),
        })}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Results: a table from xl (1280 px), cards below
// ---------------------------------------------------------------------------

function InvoiceLink({
  invoice,
  className,
}: {
  invoice: AdminInvoiceListItem;
  className?: string;
}) {
  const t = useT();
  if (!invoice.id) return null;
  return (
    <Link
      to="/admin/facturen/$id"
      params={{ id: invoice.id }}
      className={cn(
        "rounded-sm font-bold text-primary tabular-nums underline-offset-4 [overflow-wrap:anywhere] hover:underline",
        className,
      )}
    >
      {invoice.invoice_number ?? t("admin.invoices.draftNumber")}
    </Link>
  );
}

function CustomerCell({ invoice }: { invoice: AdminInvoiceListItem }) {
  const t = useT();
  const c = invoice.customer;
  if (!c) return <Muted>{t("admin.invoices.unknownCustomer")}</Muted>;
  return (
    <span className="block min-w-0">
      <Link
        to="/admin/klanten/$id"
        params={{ id: c.id }}
        className="block break-words font-medium text-foreground underline-offset-4 hover:text-primary hover:underline"
      >
        {customerDisplayName(c)}
      </Link>
      <span className="block text-xs font-semibold text-primary tabular-nums">
        {c.customer_code}
      </span>
    </span>
  );
}

function StatusCell({ invoice }: { invoice: AdminInvoiceListItem }) {
  const t = useT();
  const days = invoice.days_overdue ?? 0;
  return (
    <span className="flex flex-col items-start gap-1">
      <InvoiceStatusBadge invoice={invoice} />
      {invoice.is_overdue && days > 0 ? (
        <span className="text-xs font-semibold text-destructive tabular-nums">
          {days === 1
            ? t("admin.invoices.daysOverdueOne")
            : t("admin.invoices.daysOverdue", { days: formatNumber(days, 0) })}
        </span>
      ) : null}
      {invoice.status === "paid" && invoice.paid_at ? (
        <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
          {t("admin.invoices.paidOn", { date: formatDate(invoice.paid_at) })}
        </span>
      ) : null}
      {(invoice.reminder_count ?? 0) > 0 ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {t("admin.invoices.reminderCount", { count: invoice.reminder_count ?? 0 })}
        </span>
      ) : null}
    </span>
  );
}

const money = (amount: number | null, currency: AdminInvoiceListItem["currency"]) =>
  amount !== null && currency ? formatMoney(amount, currency) : "–";

const showBalance = (i: AdminInvoiceListItem) =>
  i.status === "open" || i.status === "partially_paid";

function InvoicesTable({ invoices }: { invoices: AdminInvoiceListItem[] }) {
  const t = useT();
  const th = "px-2 py-3 font-bold text-primary first:pl-4 last:pr-4";
  return (
    <div className="relative hidden overflow-x-auto rounded-lg border bg-card shadow-sm xl:block">
      <table className="w-full text-sm">
        <caption className="sr-only">{t("admin.invoices.tableCaption")}</caption>
        <thead className="border-b bg-cream text-left">
          <tr>
            <th scope="col" className={th}>
              {t("admin.invoices.columns.invoice")}
            </th>
            <th scope="col" className={th}>
              {t("admin.invoices.columns.customer")}
            </th>
            <th scope="col" className={th}>
              {t("admin.invoices.columns.date")}
            </th>
            <th scope="col" className={th}>
              {t("admin.invoices.columns.due")}
            </th>
            <th scope="col" className={cn(th, "text-right")}>
              {t("admin.invoices.columns.amount")}
            </th>
            <th scope="col" className={cn(th, "text-right")}>
              {t("admin.invoices.columns.balance")}
            </th>
            <th scope="col" className={th}>
              {t("admin.invoices.columns.status")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {invoices.map((i) => (
            <tr key={i.id} className="align-top transition-colors hover:bg-cream/50">
              <td className="max-w-64 py-3 pl-4 pr-2">
                <InvoiceLink invoice={i} className="whitespace-nowrap" />
                {i.references.length > 0 ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums [overflow-wrap:anywhere]">
                    {t("admin.invoices.orders", { refs: i.references.join(", ") })}
                  </span>
                ) : null}
              </td>
              <td className="max-w-64 px-2 py-3">
                <CustomerCell invoice={i} />
              </td>
              <td className="whitespace-nowrap px-2 py-3 tabular-nums">
                {i.invoice_date ? formatDate(i.invoice_date) : "–"}
              </td>
              <td
                className={cn(
                  "whitespace-nowrap px-2 py-3 tabular-nums",
                  i.is_overdue && "font-semibold text-destructive",
                )}
              >
                {i.due_date ? formatDate(i.due_date) : "–"}
              </td>
              <td className="whitespace-nowrap px-2 py-3 text-right tabular-nums">
                {money(i.total_amount, i.currency)}
              </td>
              <td className="whitespace-nowrap px-2 py-3 text-right font-semibold tabular-nums">
                {showBalance(i) ? money(i.balance_due, i.currency) : <Muted>–</Muted>}
              </td>
              <td className="py-3 pl-2 pr-4">
                <StatusCell invoice={i} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceCards({ invoices }: { invoices: AdminInvoiceListItem[] }) {
  const t = useT();
  return (
    <ul
      className="grid gap-3 md:grid-cols-2 xl:hidden"
      aria-label={t("admin.invoices.tableCaption")}
    >
      {invoices.map((i) => (
        <li key={i.id} className="min-w-0 rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <InvoiceLink invoice={i} className="font-heading" />
            <StatusCell invoice={i} />
          </div>
          <div className="mt-2">
            <CustomerCell invoice={i} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t("admin.invoices.columns.date")}</dt>
              <dd className="tabular-nums">{i.invoice_date ? formatDate(i.invoice_date) : "–"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t("admin.invoices.columns.due")}</dt>
              <dd className={cn("tabular-nums", i.is_overdue && "font-semibold text-destructive")}>
                {i.due_date ? formatDate(i.due_date) : "–"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">
                {t("admin.invoices.columns.amount")}
              </dt>
              <dd className="tabular-nums">{money(i.total_amount, i.currency)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">
                {t("admin.invoices.columns.balance")}
              </dt>
              <dd className="font-semibold tabular-nums">
                {showBalance(i) ? money(i.balance_due, i.currency) : <Muted>–</Muted>}
              </dd>
            </div>
          </dl>
          {i.references.length > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground tabular-nums [overflow-wrap:anywhere]">
              {t("admin.invoices.orders", { refs: i.references.join(", ") })}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
