import { Fragment, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronRight, CircleCheck, Receipt } from "lucide-react";

import { ShellPageHeader } from "@/components/layout/AppShell";
import { CurrencyAmounts } from "@/components/portal/CurrencyAmounts";
import { LoadError, Muted } from "@/components/portal/Section";
import { InvoiceStatusBadge } from "@/components/portal/StatusBadges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { t, useT } from "@/lib/i18n";
import {
  filterPortalInvoices,
  needsPayment,
  portalInvoiceSearchSchema,
  portalInvoicesQueryOptions,
  summarizeOpenInvoices,
  type PortalInvoice,
  type PortalInvoiceSearch,
} from "@/lib/portal/invoices";
import { usePortalCustomer } from "@/lib/portal/use-portal-customer";
import { cn } from "@/lib/utils";

/**
 * /portal/facturen (SPEC §18, §35.10): the customer's issued invoices, never
 * drafts (RLS, and the query says so too), with number, dates, the orders on
 * the invoice, amount, what is still to be paid and the status badge (text
 * plus icon), and the outstanding balance PER CURRENCY.
 */
export const Route = createFileRoute("/portal/facturen/")({
  validateSearch: (search: Record<string, unknown>): PortalInvoiceSearch =>
    portalInvoiceSearchSchema.parse(search),
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("portal.invoices.title") }) }] }),
  component: InvoicesPage,
});

const FILTERS = [undefined, "unpaid", "paid"] as const;

function InvoicesPage() {
  const t = useT();
  const { auth, customer } = usePortalCustomer();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const invoices = useQuery(portalInvoicesQueryOptions(auth.userId, customer.id));
  const visible = useMemo(
    () => filterPortalInvoices(invoices.data ?? [], search.show),
    [invoices.data, search.show],
  );
  const summary = useMemo(() => summarizeOpenInvoices(invoices.data ?? []), [invoices.data]);

  const header = (
    <ShellPageHeader
      title={t("portal.invoices.title")}
      description={t("portal.invoices.intro")}
      className="mb-6 sm:mb-8"
    />
  );

  if (invoices.isError) {
    return (
      <>
        {header}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <LoadError
            title={t("portal.invoices.loadFailed")}
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
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </>
    );
  }
  if (invoices.data.length === 0) {
    return (
      <>
        {header}
        <div className="flex items-start gap-4 rounded-lg border bg-card p-6 shadow-sm">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-cream text-primary">
            <Receipt className="size-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg text-foreground">{t("portal.invoices.emptyTitle")}</h2>
            <p className="mt-1 max-w-prose text-sm leading-6 text-muted-foreground">
              {t("portal.invoices.empty")}
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <section
        aria-label={t("portal.invoices.outstanding")}
        className={cn(
          "mb-4 rounded-lg border-2 bg-card p-4 shadow-sm",
          summary.overdueCount > 0 ? "border-destructive/50" : "border-border",
        )}
      >
        {summary.outstanding.length > 0 ? (
          <p className="text-base">
            <span className="font-semibold text-muted-foreground">
              {t("portal.invoices.outstanding")}
            </span>{" "}
            <span className="font-heading text-xl font-bold text-primary">
              <CurrencyAmounts amounts={summary.outstanding} />
            </span>
            {summary.overdueCount > 0 ? (
              <span className="mt-1 block text-sm font-semibold text-destructive">
                {t("portal.invoices.overdueCount", {
                  count: formatNumber(summary.overdueCount, 0),
                })}
              </span>
            ) : null}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm font-semibold text-success">
            <CircleCheck className="size-4 shrink-0" aria-hidden />
            {t("portal.invoices.nothingOutstanding")}
          </p>
        )}
      </section>

      <div
        role="group"
        aria-label={t("portal.invoices.filterLabel")}
        className="mb-4 flex flex-wrap gap-2"
      >
        {FILTERS.map((show) => {
          const active = search.show === show;
          return (
            <Button
              key={show ?? "all"}
              size="sm"
              variant={active ? "default" : "outline"}
              aria-pressed={active}
              onClick={() => void navigate({ search: show ? { show } : {}, replace: true })}
            >
              {t(`portal.invoices.filters.${show ?? "all"}`)}
            </Button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6 shadow-sm">
          <p className="text-sm text-foreground">{t("portal.invoices.noResults")}</p>
          <Button variant="outline" size="sm" onClick={() => void navigate({ search: {} })}>
            {t("portal.invoices.showAll")}
          </Button>
        </div>
      ) : (
        <>
          <InvoiceTable invoices={visible} />
          <InvoiceCards invoices={visible} />
        </>
      )}
    </>
  );
}

const money = (amount: number | null, currency: PortalInvoice["currency"]) =>
  amount !== null && currency ? formatMoney(amount, currency) : "–";

function StatusNotes({ invoice }: { invoice: PortalInvoice }) {
  const t = useT();
  const days = invoice.days_overdue ?? 0;
  return (
    <>
      {invoice.is_overdue && days > 0 ? (
        <span className="mt-1 block text-xs font-semibold text-destructive tabular-nums">
          {days === 1
            ? t("portal.invoices.daysOverdueOne")
            : t("portal.invoices.daysOverdue", { days: formatNumber(days, 0) })}
        </span>
      ) : null}
      {invoice.status === "paid" && invoice.paid_at ? (
        <span className="mt-1 block text-xs text-muted-foreground tabular-nums">
          {t("portal.invoices.paidOn", { date: formatDate(invoice.paid_at) })}
        </span>
      ) : null}
    </>
  );
}

function OrderLinks({ invoice }: { invoice: PortalInvoice }) {
  if (invoice.orders.length === 0) return <Muted>–</Muted>;
  return (
    <>
      {invoice.orders.map((order, i) => (
        <Fragment key={order.id}>
          <span className="whitespace-nowrap">
            <Link
              to="/portal/orders/$id"
              params={{ id: order.id }}
              className="rounded-sm text-primary tabular-nums underline-offset-4 hover:underline"
            >
              {order.reference}
            </Link>
            {i < invoice.orders.length - 1 ? "," : ""}
          </span>
          {i < invoice.orders.length - 1 ? " " : null}
        </Fragment>
      ))}
    </>
  );
}

function NumberLink({ invoice, className }: { invoice: PortalInvoice; className?: string }) {
  if (!invoice.id) return null;
  return (
    <Link
      to="/portal/facturen/$id"
      params={{ id: invoice.id }}
      className={cn(
        "rounded-sm font-bold text-primary tabular-nums underline-offset-4 hover:underline",
        className,
      )}
    >
      {invoice.invoice_number}
    </Link>
  );
}

function InvoiceTable({ invoices }: { invoices: PortalInvoice[] }) {
  const t = useT();
  const th = "px-3 py-2.5 font-bold text-primary first:pl-4 last:pr-4";
  return (
    <div className="hidden overflow-hidden rounded-lg border bg-card shadow-sm xl:block">
      <table className="w-full text-sm">
        <caption className="sr-only">{t("portal.invoices.tableCaption")}</caption>
        <thead className="border-b bg-cream text-left">
          <tr>
            <th scope="col" className={th}>
              {t("portal.invoices.columns.number")}
            </th>
            <th scope="col" className={th}>
              {t("portal.invoices.columns.date")}
            </th>
            <th scope="col" className={th}>
              {t("portal.invoices.columns.dueDate")}
            </th>
            <th scope="col" className={th}>
              {t("portal.invoices.columns.orders")}
            </th>
            <th scope="col" className={cn(th, "text-right")}>
              {t("portal.invoices.columns.amount")}
            </th>
            <th scope="col" className={cn(th, "text-right")}>
              {t("portal.invoices.columns.balance")}
            </th>
            <th scope="col" className={th}>
              {t("portal.invoices.columns.status")}
            </th>
            <th scope="col" className={th}>
              <span className="sr-only">{t("portal.invoices.view")}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {invoices.map((invoice) => (
            <tr key={invoice.id} className="align-top transition-colors hover:bg-cream/50">
              <td className="py-3 pl-4 pr-3">
                <NumberLink invoice={invoice} className="whitespace-nowrap" />
              </td>
              <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                {invoice.invoice_date ? formatDate(invoice.invoice_date) : "–"}
              </td>
              <td
                className={cn(
                  "whitespace-nowrap px-3 py-3 tabular-nums",
                  invoice.is_overdue && "font-semibold text-destructive",
                )}
              >
                {invoice.due_date ? formatDate(invoice.due_date) : "–"}
              </td>
              <td className="max-w-56 px-3 py-3 text-sm">
                <OrderLinks invoice={invoice} />
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                {money(invoice.total_amount, invoice.currency)}
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">
                {needsPayment(invoice) ? (
                  money(invoice.balance_due, invoice.currency)
                ) : (
                  <Muted>–</Muted>
                )}
              </td>
              <td className="px-3 py-3">
                <InvoiceStatusBadge invoice={invoice} />
                <StatusNotes invoice={invoice} />
              </td>
              <td className="py-3 pl-3 pr-4 text-right">
                {invoice.id ? (
                  <Link
                    to="/portal/facturen/$id"
                    params={{ id: invoice.id }}
                    className="inline-flex items-center gap-1 rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline"
                    aria-label={t("portal.invoices.open", { number: invoice.invoice_number ?? "" })}
                  >
                    {t("portal.invoices.view")}
                    <ChevronRight className="size-4" aria-hidden />
                  </Link>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceCards({ invoices }: { invoices: PortalInvoice[] }) {
  const t = useT();
  return (
    <ul
      className="grid gap-3 md:grid-cols-2 xl:hidden"
      aria-label={t("portal.invoices.tableCaption")}
    >
      {invoices.map((invoice) => (
        <li key={invoice.id} className="min-w-0 rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <NumberLink invoice={invoice} className="font-heading text-base" />
            <div className="text-right">
              <InvoiceStatusBadge invoice={invoice} />
              <StatusNotes invoice={invoice} />
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t("portal.invoices.columns.date")}</dt>
              <dd className="tabular-nums">
                {invoice.invoice_date ? formatDate(invoice.invoice_date) : "–"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">
                {t("portal.invoices.columns.dueDate")}
              </dt>
              <dd
                className={cn(
                  "tabular-nums",
                  invoice.is_overdue && "font-semibold text-destructive",
                )}
              >
                {invoice.due_date ? formatDate(invoice.due_date) : "–"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">
                {t("portal.invoices.columns.amount")}
              </dt>
              <dd className="tabular-nums">{money(invoice.total_amount, invoice.currency)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">
                {t("portal.invoices.columns.balance")}
              </dt>
              <dd className="font-semibold tabular-nums">
                {needsPayment(invoice) ? money(invoice.balance_due, invoice.currency) : "–"}
              </dd>
            </div>
            <div className="col-span-2 min-w-0">
              <dt className="text-xs text-muted-foreground">
                {t("portal.invoices.columns.orders")}
              </dt>
              <dd className="text-sm">
                <OrderLinks invoice={invoice} />
              </dd>
            </div>
          </dl>
          {invoice.id ? (
            <Button asChild variant="outline" size="sm" className="mt-3 w-full sm:w-auto">
              <Link to="/portal/facturen/$id" params={{ id: invoice.id }}>
                {t("portal.invoices.open", { number: invoice.invoice_number ?? "" })}
                <ChevronRight aria-hidden />
              </Link>
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
