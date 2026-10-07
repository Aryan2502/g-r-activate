import type { ComponentType, ReactNode, SVGProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  BadgeCheck,
  ChevronRight,
  FileWarning,
  Gauge,
  Package,
  ReceiptText,
  Users,
} from "lucide-react";

import { DashboardPanel, PanelLoadError } from "@/components/admin/dashboard/Panel";
import { Skeleton } from "@/components/ui/skeleton";
import {
  customerCountsQueryOptions,
  invoiceStatsQueryOptions,
  orderStatsQueryOptions,
} from "@/lib/admin/dashboard";
import { formatMoney, formatNumber } from "@/lib/format";
import { useT } from "@/lib/i18n";
import type { CurrencyAmount } from "@/lib/portal/invoices";
import { cn } from "@/lib/utils";

/**
 * The §12 figures at a glance, all from Supabase: customers (and new ones),
 * orders (new and running), open, overdue and paid invoices, and what is
 * still to be paid PER CURRENCY (SPEC §35.10; invoice_overview computes it).
 */
export function OverviewKpis({ userId }: { userId: string }) {
  const t = useT();
  const customers = useQuery(customerCountsQueryOptions(userId));
  const orders = useQuery(orderStatsQueryOptions(userId));
  const invoices = useQuery(invoiceStatsQueryOptions(userId));

  return (
    <DashboardPanel
      title={t("admin.home.overviewTitle")}
      icon={<Gauge />}
      description={t("admin.home.overviewIntro")}
    >
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <Kpi
          icon={Users}
          label={t("admin.home.kpi.customers")}
          query={customers}
          value={(d) => d.total}
          link={{ to: "/admin/klanten", label: t("admin.home.kpi.customersLink") }}
        >
          {(d) => (
            <>
              <p>
                {t(
                  d.recent === 1
                    ? "admin.home.kpi.customersRecentOne"
                    : "admin.home.kpi.customersRecent",
                  { count: formatNumber(d.recent, 0) },
                )}
              </p>
              <p>
                {t("admin.home.kpi.customersBreakdown", {
                  active: formatNumber(d.active, 0),
                  invited: formatNumber(d.invited, 0),
                  disabled: formatNumber(d.disabled, 0),
                })}
              </p>
            </>
          )}
        </Kpi>
        <Kpi
          icon={Package}
          label={t("admin.home.kpi.ordersRecent")}
          query={orders}
          value={(d) => d.recent}
          link={{ to: "/admin/orders", label: t("admin.home.allOrders") }}
        >
          {(d) => (
            <>
              <p>{t("admin.home.kpi.ordersRecentHint")}</p>
              <p className="font-semibold text-foreground">
                {t("admin.home.kpi.ordersOpen")}: {formatNumber(d.open, 0)}
              </p>
              <p>{t("admin.home.kpi.ordersOpenHint")}</p>
            </>
          )}
        </Kpi>
        <Kpi
          icon={ReceiptText}
          label={t("admin.home.kpi.invoicesOpen")}
          query={invoices}
          value={(d) => d.openCount}
          link={{
            to: "/admin/facturen",
            search: { status: "unpaid" },
            label: t("admin.home.kpi.openInvoicesList"),
          }}
        >
          {(d) => (
            <>
              <p>{t("admin.home.kpi.invoicesOpenHint")}</p>
              <p className="font-semibold text-foreground">{t("admin.home.kpi.outstanding")}</p>
              <Amounts amounts={d.outstanding} />
            </>
          )}
        </Kpi>
        <Kpi
          icon={FileWarning}
          label={t("admin.home.kpi.invoicesOverdue")}
          query={invoices}
          value={(d) => d.overdueCount}
          attention={(d) => d.overdueCount > 0}
          link={{
            to: "/admin/facturen",
            search: { status: "overdue", sort: "due" },
            label: t("admin.home.kpi.overdueInvoicesList"),
          }}
        >
          {(d) => (
            <>
              <p>{t("admin.home.kpi.invoicesOverdueHint")}</p>
              <Amounts amounts={d.overdueOutstanding} />
            </>
          )}
        </Kpi>
        <Kpi
          icon={BadgeCheck}
          label={t("admin.home.kpi.invoicesPaid")}
          query={invoices}
          value={(d) => d.paidCount}
          link={{
            to: "/admin/facturen",
            search: { status: "paid" },
            label: t("admin.home.kpi.paidInvoicesList"),
          }}
        >
          {(d) => (
            <>
              <p>
                {t("admin.home.kpi.invoicesPaidRecent", { count: formatNumber(d.paidRecent, 0) })}
              </p>
              <p>{t("admin.home.kpi.drafts", { count: formatNumber(d.draftCount, 0) })}</p>
            </>
          )}
        </Kpi>
      </ul>
    </DashboardPanel>
  );
}

function Amounts({ amounts }: { amounts: readonly CurrencyAmount[] }) {
  const t = useT();
  if (amounts.length === 0) return <p>{t("admin.home.kpi.outstandingNone")}</p>;
  return (
    <ul className="space-y-0.5 font-semibold text-foreground tabular-nums">
      {amounts.map((a) => (
        <li key={a.currency}>{formatMoney(a.amount, a.currency)}</li>
      ))}
    </ul>
  );
}

type QueryLike<D> = {
  data: D | undefined;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
};

function Kpi<D>({
  icon: Icon,
  label,
  query,
  value,
  attention,
  link,
  children,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  query: QueryLike<D>;
  value: (data: D) => number;
  attention?: (data: D) => boolean;
  link?:
    | { to: "/admin/klanten" | "/admin/orders"; search?: { openInvoice: true }; label: string }
    | {
        to: "/admin/facturen";
        search: { status: "unpaid" | "overdue" | "paid"; sort?: "due" };
        label: string;
      };
  children: (data: D) => ReactNode;
}) {
  const data = query.data;
  const alert = data !== undefined && attention ? attention(data) : false;
  return (
    <li className="flex min-w-0 flex-col rounded-md border p-4">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            alert ? "bg-destructive-soft text-destructive" : "bg-cream text-primary",
          )}
          aria-hidden
        >
          <Icon className="size-5" />
        </span>
        <p className="min-w-0 flex-1 text-sm font-semibold text-foreground">{label}</p>
        {data === undefined ? (
          query.isError ? null : (
            <Skeleton className="h-8 w-10" />
          )
        ) : (
          <span
            className={cn(
              "font-heading text-3xl font-bold tabular-nums",
              alert ? "text-destructive" : "text-primary",
            )}
          >
            {formatNumber(value(data), 0)}
          </span>
        )}
      </div>
      <div className="mt-3 flex-1 space-y-1 text-sm text-muted-foreground">
        {query.isError ? (
          <PanelLoadError error={query.error} onRetry={() => void query.refetch()} />
        ) : data === undefined ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          children(data)
        )}
      </div>
      {link ? (
        <Link
          to={link.to}
          search={link.search ?? {}}
          className="mt-2 inline-flex min-h-8 items-center gap-1 self-start text-sm font-semibold text-primary underline-offset-4 hover:underline"
        >
          {link.label}
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : null}
    </li>
  );
}
