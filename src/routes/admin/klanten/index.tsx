import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Search, Send, UserPlus, Users, XCircle } from "lucide-react";

import {
  AccountTypeBadge,
  CustomerStatusBadge,
  InvitationStateBadge,
  NoLoginBadge,
} from "@/components/admin/customers/CustomerBadges";
import { AddCustomerDialog } from "@/components/admin/customers/AddCustomerDialog";
import { ExportCsvButton } from "@/components/admin/ExportCsvButton";
import { InviteCustomerDialog } from "@/components/admin/customers/InviteCustomerDialog";
import { ShellPageHeader } from "@/components/layout/AppShell";
import { CurrencyAmounts } from "@/components/portal/CurrencyAmounts";
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
  CUSTOMER_SORTS,
  CUSTOMER_STATUSES,
  buildCustomerList,
  customerListQueryOptions,
  customerOpenInvitationsQueryOptions,
  customerOpenInvoicesQueryOptions,
  customerSearchSchema,
  filterCustomers,
  hasCustomerFilters,
  ordersPerCustomerQueryOptions,
  type CustomerListItem,
  type CustomerSearch,
} from "@/lib/admin/customers";
import { exportCustomers } from "@/lib/admin/exports";
import { formatDate, formatNumber } from "@/lib/format";
import { t, useT } from "@/lib/i18n";
import { formatPhone } from "@/lib/phone";

/**
 * /admin/klanten (SPEC §13, §26, §35.5): every customer, with and without a
 * login. One search box (name, company, GR code incl. "gr 17", e-mail,
 * phone), filters for status, account type, login and open invoices, and a
 * sort, all in the URL; a table from 1280 px, cards below. "Klant toevoegen"
 * (no invitation) and "Klant uitnodigen" open their dialogs.
 */
export const Route = createFileRoute("/admin/klanten/")({
  validateSearch: (search: Record<string, unknown>): CustomerSearch =>
    customerSearchSchema.parse(search),
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("admin.customers.title") }) }] }),
  component: CustomersPage,
});

const adminRoute = getRouteApi("/admin");
const ALL = "all";

function CustomersPage() {
  const t = useT();
  const { auth } = adminRoute.useRouteContext();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const customers = useQuery(customerListQueryOptions(auth.userId));
  const orders = useQuery(ordersPerCustomerQueryOptions(auth.userId));
  const invoices = useQuery(customerOpenInvoicesQueryOptions(auth.userId));
  const invitations = useQuery(customerOpenInvitationsQueryOptions(auth.userId));
  const [adding, setAdding] = useState(false);
  const [inviting, setInviting] = useState(false);

  const header = (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <ShellPageHeader
        title={t("admin.customers.title")}
        description={t("admin.customers.intro")}
        className="mb-0"
      />
      <div className="flex flex-wrap gap-2 self-start">
        <Button onClick={() => setAdding(true)}>
          <UserPlus aria-hidden />
          {t("admin.customers.add")}
        </Button>
        <Button variant="outline" onClick={() => setInviting(true)}>
          <Send aria-hidden />
          {t("admin.customers.invite")}
        </Button>
      </div>
    </div>
  );

  const dialogs = (
    <>
      <AddCustomerDialog
        userId={auth.userId}
        open={adding}
        onOpenChange={setAdding}
        onCreated={(customer) =>
          void navigate({ to: "/admin/klanten/$id", params: { id: customer.id } })
        }
      />
      <InviteCustomerDialog
        userId={auth.userId}
        isAdmin={auth.role === "admin"}
        open={inviting}
        onOpenChange={setInviting}
      />
    </>
  );

  let body: ReactNode;
  if (customers.isError) {
    body = (
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <LoadError
          title={t("admin.customers.loadFailed")}
          error={customers.error}
          onRetry={() => void customers.refetch()}
        />
      </div>
    );
  } else if (customers.isPending) {
    body = (
      <div className="space-y-3" aria-busy="true">
        <span className="sr-only">{t("common.loading")}</span>
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  } else {
    const failed = [orders, invoices, invitations].find((q) => q.isError);
    body = (
      <CustomersBoard
        isAdmin={auth.role === "admin"}
        search={search}
        items={buildCustomerList(customers.data, {
          orders: orders.data,
          invoices: invoices.data,
          invitations: invitations.data,
        })}
        invoicesUnknown={!invoices.data}
        sideErrors={
          failed ? (
            <div className="mb-4 rounded-lg border bg-card p-4 shadow-sm">
              <LoadError
                title={t("admin.customers.extrasLoadFailed")}
                error={failed.error}
                onRetry={() =>
                  [orders, invoices, invitations].forEach((q) => q.isError && void q.refetch())
                }
              />
            </div>
          ) : null
        }
      />
    );
  }

  return (
    <>
      {header}
      {body}
      {dialogs}
    </>
  );
}

function CustomersBoard({
  isAdmin,
  search,
  items,
  invoicesUnknown,
  sideErrors,
}: {
  /** "Exporteer CSV" is for admins (SPEC §35.15). */
  isAdmin: boolean;
  search: CustomerSearch;
  items: CustomerListItem[];
  /** The invoices could not be loaded (yet): their filter cannot answer. */
  invoicesUnknown: boolean;
  sideErrors: ReactNode;
}) {
  const t = useT();
  const visible = useMemo(() => filterCustomers(items, search), [items, search]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border bg-card p-6 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg text-foreground">
          <Users className="size-5 text-primary" aria-hidden />
          {t("admin.customers.emptyTitle")}
        </h2>
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          {t("admin.customers.emptyText")}
        </p>
      </div>
    );
  }

  return (
    <>
      <Filters search={search} invoicesUnknown={invoicesUnknown} />
      {sideErrors}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
          {t(
            items.length === 1 ? "admin.customers.resultCountOne" : "admin.customers.resultCount",
            {
              count: formatNumber(visible.length, 0),
              total: formatNumber(items.length, 0),
            },
          )}
        </p>
        {isAdmin && visible.length > 0 ? (
          <ExportCsvButton
            scope={t("admin.exports.scopeFiltered", { count: formatNumber(visible.length, 0) })}
            options={[
              {
                label: t("admin.exports.what.customers"),
                run: () => exportCustomers({ ids: visible.map((c) => c.id) }),
              },
            ]}
          />
        ) : null}
      </div>
      {visible.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6 shadow-sm">
          <p className="text-sm text-foreground">{t("admin.customers.noResults")}</p>
          {hasCustomerFilters(search) ? <ClearFiltersButton /> : null}
        </div>
      ) : (
        <>
          <CustomersTable customers={visible} />
          <CustomerCards customers={visible} />
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
  return (patch: Partial<CustomerSearch>) =>
    void navigate({
      search: (prev) => {
        const next: CustomerSearch = { ...prev, ...patch };
        // Defaults stay out of the URL.
        for (const key of Object.keys(next) as (keyof CustomerSearch)[]) {
          if (next[key] === undefined) delete next[key];
        }
        if (next.sort === "code") delete next.sort;
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
          type: undefined,
          login: undefined,
          openInvoice: undefined,
        })
      }
    >
      <XCircle aria-hidden />
      {t("admin.customers.clearFilters")}
    </Button>
  );
}

function Filters({
  search,
  invoicesUnknown,
}: {
  search: CustomerSearch;
  invoicesUnknown: boolean;
}) {
  const t = useT();
  const id = useId();
  const setSearch = useSetSearch();
  const [query, setQuery] = useState(search.q ?? "");

  // Typing updates the URL after a short pause, Enter at once; a change from
  // outside (e.g. "Filters wissen") updates the field.
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

  const openInvoice = search.openInvoice === true;

  return (
    <div role="search" className="mb-4 space-y-4 rounded-lg border bg-card p-4 shadow-sm">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-q`} className="text-base font-semibold text-primary">
          {t("admin.customers.search")}
        </Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
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
            placeholder={t("admin.customers.searchPlaceholder")}
            className="h-12 pl-10 text-base md:text-base"
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-status`}>{t("admin.customers.statusFilter")}</Label>
          <Select
            value={search.status ?? ALL}
            onValueChange={(v) =>
              setSearch({ status: v === ALL ? undefined : CUSTOMER_STATUSES.find((s) => s === v) })
            }
          >
            <SelectTrigger id={`${id}-status`} className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("admin.customers.allStatuses")}</SelectItem>
              {CUSTOMER_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(`admin.customers.statuses.${status}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-type`}>{t("admin.customers.typeFilter")}</Label>
          <Select
            value={search.type ?? ALL}
            onValueChange={(v) =>
              setSearch({
                type:
                  v === ALL ? undefined : Constants.public.Enums.account_type.find((a) => a === v),
              })
            }
          >
            <SelectTrigger id={`${id}-type`} className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("admin.customers.allTypes")}</SelectItem>
              {Constants.public.Enums.account_type.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(`admin.customers.accountTypes.${type}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-login`}>{t("admin.customers.loginFilter")}</Label>
          <Select
            value={search.login ?? ALL}
            onValueChange={(v) => setSearch({ login: v === "yes" || v === "no" ? v : undefined })}
          >
            <SelectTrigger id={`${id}-login`} className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("admin.customers.allLogins")}</SelectItem>
              <SelectItem value="yes">{t("admin.customers.logins.yes")}</SelectItem>
              <SelectItem value="no">{t("admin.customers.logins.no")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-sort`}>{t("admin.customers.sort")}</Label>
          <Select
            value={search.sort ?? "code"}
            onValueChange={(v) => setSearch({ sort: CUSTOMER_SORTS.find((s) => s === v) })}
          >
            <SelectTrigger id={`${id}-sort`} className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CUSTOMER_SORTS.map((sort) => (
                <SelectItem key={sort} value={sort}>
                  {t(`admin.customers.sorts.${sort}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground" id={`${id}-flags`}>
          {t("admin.customers.onlyShow")}
        </span>
        <div role="group" aria-labelledby={`${id}-flags`} className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={openInvoice ? "default" : "outline"}
            aria-pressed={openInvoice}
            // Without the invoices the filter could only answer "none".
            disabled={invoicesUnknown && !openInvoice}
            title={invoicesUnknown ? t("admin.customers.invoicesUnknownHint") : undefined}
            onClick={() => setSearch({ openInvoice: openInvoice ? undefined : true })}
          >
            {openInvoice ? <CheckCircle2 aria-hidden /> : null}
            {t("admin.customers.openInvoiceFlag")}
          </Button>
        </div>
        {hasCustomerFilters(search) ? (
          <div className="ml-auto">
            <ClearFiltersButton />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results: a table from xl (1280 px), cards below (SPEC §25, §35.14)
// ---------------------------------------------------------------------------

function CustomerName({ customer }: { customer: CustomerListItem }) {
  const t = useT();
  const business = customer.account_type === "business" && customer.company_name;
  return (
    <>
      <Link
        to="/admin/klanten/$id"
        params={{ id: customer.id }}
        className="block break-words font-semibold text-primary underline-offset-4 hover:underline"
        aria-label={t("admin.customers.openLabel", {
          name: `${customer.customer_code} ${business ? customer.company_name : customer.full_name}`,
        })}
      >
        {business ? customer.company_name : customer.full_name}
      </Link>
      {business ? (
        <span className="block break-words text-xs text-muted-foreground">
          {customer.full_name}
        </span>
      ) : null}
      <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
        <span className="font-heading text-xs font-bold text-primary tabular-nums">
          {customer.customer_code}
        </span>
        {customer.account_type === "business" ? (
          <AccountTypeBadge type="business" className="px-1.5 py-0 text-[0.7rem]" />
        ) : null}
      </span>
    </>
  );
}

/**
 * An e-mail address that wraps after the "@" when it must, and only inside
 * a part as a last resort, so it is never split mid-word for no reason.
 */
function EmailText({ email }: { email: string }) {
  const at = email.indexOf("@");
  return (
    <span className="block break-words text-foreground [overflow-wrap:anywhere]">
      {at > 0 ? (
        <>
          {email.slice(0, at)}
          <wbr />
          {email.slice(at)}
        </>
      ) : (
        email
      )}
    </span>
  );
}

function ContactCell({ customer }: { customer: CustomerListItem }) {
  if (!customer.email && !customer.phone) return <Muted>–</Muted>;
  return (
    <>
      {customer.email ? <EmailText email={customer.email} /> : null}
      {customer.phone ? (
        <span className="block whitespace-nowrap text-muted-foreground tabular-nums">
          {formatPhone(customer.phone)}
        </span>
      ) : null}
    </>
  );
}

function StatusCell({ customer }: { customer: CustomerListItem }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <CustomerStatusBadge status={customer.status} />
      {customer.status !== "disabled" &&
      customer.invitationState &&
      customer.invitationState !== "open" ? (
        <InvitationStateBadge state={customer.invitationState} />
      ) : null}
    </span>
  );
}

function OutstandingCell({ customer }: { customer: CustomerListItem }) {
  const t = useT();
  if (!customer.invoicesKnown) return <Muted>{t("admin.customers.unknown")}</Muted>;
  if (customer.openInvoices === null)
    return <Muted>{t("admin.customers.nothingOutstanding")}</Muted>;
  return (
    <>
      <span className="block font-semibold text-foreground">
        <CurrencyAmounts amounts={customer.openInvoices.outstanding} />
      </span>
      {customer.openInvoices.overdue > 0 ? (
        <Badge variant="danger" className="mt-1">
          {t("admin.customers.overdueCount", { count: customer.openInvoices.overdue })}
        </Badge>
      ) : null}
    </>
  );
}

function CustomersTable({ customers }: { customers: CustomerListItem[] }) {
  const t = useT();
  const th = "px-3 py-3 font-bold text-primary";
  return (
    <div className="relative hidden overflow-x-auto rounded-lg border bg-card shadow-sm xl:block">
      <table className="w-full text-sm">
        <caption className="sr-only">{t("admin.customers.tableCaption")}</caption>
        <thead className="border-b bg-cream text-left">
          <tr>
            <th scope="col" className={th}>
              {t("admin.customers.columns.customer")}
            </th>
            <th scope="col" className={th}>
              {t("admin.customers.columns.contact")}
            </th>
            <th scope="col" className={th}>
              {t("admin.customers.columns.status")}
            </th>
            <th scope="col" className={th}>
              {t("admin.customers.columns.login")}
            </th>
            <th scope="col" className={`${th} text-right`}>
              {t("admin.customers.columns.orders")}
            </th>
            <th scope="col" className={th}>
              {t("admin.customers.columns.outstanding")}
            </th>
            <th scope="col" className={th}>
              {t("admin.customers.columns.created")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {customers.map((customer) => (
            <tr key={customer.id} className="align-top transition-colors hover:bg-cream/50">
              <td className="max-w-72 px-3 py-3">
                <CustomerName customer={customer} />
              </td>
              <td className="min-w-60 max-w-80 px-3 py-3">
                <ContactCell customer={customer} />
              </td>
              <td className="px-3 py-3">
                <StatusCell customer={customer} />
              </td>
              <td className="px-3 py-3">
                {customer.user_id ? t("admin.customers.loginYes") : t("admin.customers.loginNo")}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {customer.orderCount === null ? (
                  <Muted>{t("admin.customers.unknown")}</Muted>
                ) : (
                  formatNumber(customer.orderCount, 0)
                )}
              </td>
              <td className="px-3 py-3">
                <OutstandingCell customer={customer} />
              </td>
              <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                {formatDate(customer.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CardItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 min-w-0 text-sm text-foreground">{children}</dd>
    </div>
  );
}

function CustomerCards({ customers }: { customers: CustomerListItem[] }) {
  const t = useT();
  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:hidden">
      {customers.map((customer) => (
        <li key={customer.id} className="min-w-0 rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <CustomerName customer={customer} />
            </div>
            <StatusCell customer={customer} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-3">
            <div className="col-span-2 min-w-0">
              <dt className="text-xs font-semibold text-muted-foreground">
                {t("admin.customers.columns.contact")}
              </dt>
              <dd className="mt-0.5 text-sm">
                <ContactCell customer={customer} />
              </dd>
            </div>
            <CardItem label={t("admin.customers.columns.login")}>
              {customer.user_id ? t("admin.customers.loginYes") : <NoLoginBadge />}
            </CardItem>
            <CardItem label={t("admin.customers.columns.orders")}>
              <span className="tabular-nums">
                {customer.orderCount === null
                  ? t("admin.customers.unknown")
                  : formatNumber(customer.orderCount, 0)}
              </span>
            </CardItem>
            <CardItem label={t("admin.customers.columns.outstanding")}>
              <OutstandingCell customer={customer} />
            </CardItem>
            <CardItem label={t("admin.customers.columns.created")}>
              <span className="tabular-nums">{formatDate(customer.created_at)}</span>
            </CardItem>
          </dl>
        </li>
      ))}
    </ul>
  );
}
