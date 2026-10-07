import { Fragment, type ComponentType, type ReactNode, type SVGProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  Ban,
  ClipboardList,
  Copy,
  History,
  Package,
  PackageCheck,
  PackagePlus,
  Receipt,
  Truck,
  Wallet,
} from "lucide-react";

import { CurrencyAmounts } from "@/components/portal/CurrencyAmounts";
import { LoadError, Section } from "@/components/portal/Section";
import { B2bBadge, OrderStatusBadge, StageIcon } from "@/components/portal/StatusBadges";
import { WarehouseAddressCard } from "@/components/portal/WarehouseAddressCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { copyToClipboard } from "@/lib/clipboard";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { t, useT } from "@/lib/i18n";
import { paths } from "@/lib/paths";
import { activityQueryOptions, type ActivityItem } from "@/lib/portal/activity";
import { firstName } from "@/lib/portal/customer";
import { invoiceSummaryQueryOptions } from "@/lib/portal/invoices";
import {
  countOrders,
  ordersQueryOptions,
  pickupInfoQueryOptions,
  resolveStatus,
  stageGroup,
  statusesQueryOptions,
  type OrderListItem,
  type OrderStageFilter,
  type StatusMap,
} from "@/lib/portal/orders";
import { usePortalCustomer } from "@/lib/portal/use-portal-customer";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/portal/")({
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("portal.home.title") }) }] }),
  component: PortalHome,
});

function PortalHome() {
  const t = useT();
  const { auth, customer } = usePortalCustomer();

  return (
    <>
      <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl text-primary sm:text-3xl">
            {t("portal.home.welcome", { name: firstName(customer.full_name) })}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("portal.home.intro")}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:flex-col lg:items-stretch">
          <div className="flex items-center justify-between gap-3 rounded-lg border-2 border-primary/20 bg-card px-4 py-2.5 shadow-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {t("portal.home.codeLabel")}
              </p>
              <p className="font-heading text-2xl font-bold tracking-wider text-primary tabular-nums sm:text-3xl">
                {customer.customer_code}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="text-primary"
              title={t("portal.home.copyCode")}
              onClick={() => void copyToClipboard(customer.customer_code)}
            >
              <Copy aria-hidden />
              <span className="sr-only">{t("portal.home.copyCode")}</span>
            </Button>
          </div>
          <Button asChild size="lg">
            <Link to={paths.portalOrderNew}>
              <PackagePlus aria-hidden />
              {t("portal.home.newOrder")}
            </Link>
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        <WarehouseAddressCard
          userId={auth.userId}
          person={{ fullName: customer.full_name, customerCode: customer.customer_code }}
        />
        <Kpis userId={auth.userId} customerId={customer.id} />
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.25fr]">
          <LatestOrder userId={auth.userId} customerId={customer.id} />
          <RecentActivity userId={auth.userId} customerId={customer.id} />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// KPI cards (SPEC §8)
// ---------------------------------------------------------------------------

function Kpis({ userId, customerId }: { userId: string; customerId: string }) {
  const t = useT();
  const orders = useQuery(ordersQueryOptions(userId, customerId));
  const statuses = useQuery(statusesQueryOptions(userId));
  const invoices = useQuery(invoiceSummaryQueryOptions(userId, customerId));
  const pickup = useQuery(pickupInfoQueryOptions(userId));

  const ordersFailed = orders.isError || statuses.isError;
  const counts = orders.data && statuses.data ? countOrders(orders.data, statuses.data) : null;
  const retryOrders = () => {
    if (orders.isError) void orders.refetch();
    if (statuses.isError) void statuses.refetch();
  };
  const orderError = orders.error ?? statuses.error;

  // Orders behind the open invoices, and the ready ones among them (SPEC §26: does the customer have to pay first?).
  const byId = new Map((orders.data ?? []).map((o) => [o.id, o]));
  const invoiceOrders = (invoices.data?.orders ?? []).flatMap((o) => {
    const order = byId.get(o.orderId);
    return order ? [order] : [];
  });
  const readyUnpaid = statuses.data
    ? invoiceOrders.filter(
        (o) => stageGroup(resolveStatus(o.status, statuses.data).stage) === "ready_for_pickup",
      )
    : [];
  const pickupLines = pickup.data
    ? [
        pickup.data.pickup_address
          ? t("portal.kpi.pickupAddress", { address: pickup.data.pickup_address })
          : null,
        pickup.data.pickup_hours
          ? t("portal.kpi.pickupHours", { hours: pickup.data.pickup_hours })
          : null,
        pickup.data.pickup_instructions
          ? t("portal.kpi.pickupInstructions", { instructions: pickup.data.pickup_instructions })
          : null,
      ].filter((line): line is string => line !== null)
    : [];

  return (
    <section
      aria-label={t("portal.home.title")}
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      <KpiCard
        title={t("portal.kpi.orders")}
        icon={Package}
        value={counts?.total}
        failed={ordersFailed}
        error={orderError}
        onRetry={retryOrders}
        link={{ label: t("portal.kpi.viewAllOrders") }}
      >
        {counts && counts.registered > 0 ? (
          <Link
            to="/portal/orders"
            search={{ stage: "registered" }}
            className="rounded-sm underline underline-offset-4 hover:text-primary"
          >
            {t("portal.kpi.registeredHint", { count: formatNumber(counts.registered, 0) })}
          </Link>
        ) : (
          t("portal.kpi.ordersHint")
        )}
      </KpiCard>

      <KpiCard
        title={t("portal.kpi.openInvoices")}
        icon={Receipt}
        value={invoices.data?.openCount}
        failed={invoices.isError}
        error={invoices.error}
        onRetry={() => void invoices.refetch()}
        tone={invoices.data && invoices.data.overdueCount > 0 ? "danger" : "default"}
      >
        {invoices.data ? (
          <>
            <span className="block font-semibold text-foreground">
              {invoices.data.outstanding.length > 0 ? (
                <>
                  {t("portal.kpi.outstandingLabel")}{" "}
                  <CurrencyAmounts amounts={invoices.data.outstanding} />
                </>
              ) : (
                t("portal.kpi.noOutstanding")
              )}
            </span>
            {invoices.data.overdueCount > 0 ? (
              <span className="mt-1 block font-semibold text-destructive">
                {t("portal.kpi.overdue", { count: formatNumber(invoices.data.overdueCount, 0) })}
              </span>
            ) : null}
            {invoiceOrders.length > 0 ? (
              <span className="mt-2 block">
                {t("portal.kpi.invoiceOrders")} <OrderLinks orders={invoiceOrders} />
              </span>
            ) : null}
          </>
        ) : null}
      </KpiCard>

      <KpiCard
        title={t("portal.kpi.inProgress")}
        icon={Truck}
        value={counts?.inProgress}
        failed={ordersFailed}
        error={orderError}
        onRetry={retryOrders}
        link={{ label: t("portal.kpi.viewOrders"), stage: "in_progress" }}
        tone={counts && counts.actionRequired > 0 ? "warning" : "default"}
      >
        {counts && counts.actionRequired > 0 ? (
          <span className="font-semibold text-warning">
            {t("portal.kpi.actionRequired", { count: formatNumber(counts.actionRequired, 0) })}
          </span>
        ) : (
          t("portal.kpi.inProgressHint")
        )}
      </KpiCard>

      <KpiCard
        title={t("portal.kpi.readyForPickup")}
        icon={PackageCheck}
        value={counts?.readyForPickup}
        failed={ordersFailed}
        error={orderError}
        onRetry={retryOrders}
        link={{ label: t("portal.kpi.viewOrders"), stage: "ready_for_pickup" }}
        tone={counts && counts.readyForPickup > 0 ? "success" : "default"}
      >
        {counts && counts.readyForPickup > 0 && pickupLines.length > 0
          ? pickupLines.map((line, i) => (
              <span key={line} className={cn("block whitespace-pre-line", i > 0 && "mt-1")}>
                {line}
              </span>
            ))
          : t("portal.kpi.readyForPickupHint")}
        {readyUnpaid.length > 0 ? (
          <span className="mt-2 block font-semibold text-warning">
            {pickup.data?.pay_before_pickup === false
              ? t("portal.kpi.pickupOpenInvoice")
              : t("portal.kpi.pickupPayFirst")}{" "}
            <OrderLinks orders={readyUnpaid} />
          </span>
        ) : null}
      </KpiCard>
    </section>
  );
}

const MAX_ORDER_LINKS = 3;

/** "ORD-2026-00002, ORD-2026-00006 en 2 andere": each to the order's invoices. */
function OrderLinks({ orders }: { orders: readonly Pick<OrderListItem, "id" | "reference">[] }) {
  const t = useT();
  const shown = orders.slice(0, MAX_ORDER_LINKS);
  const more = orders.length - shown.length;
  return (
    <>
      {shown.map((order, i) => (
        <Fragment key={order.id}>
          {/* The comma stays with its reference; the line may break after it. */}
          <span className="whitespace-nowrap">
            <Link
              to="/portal/orders/$id"
              params={{ id: order.id }}
              hash="order-invoices-title"
              className="rounded-sm font-semibold text-primary tabular-nums underline underline-offset-4"
            >
              {order.reference}
            </Link>
            {i < shown.length - 1 ? "," : ""}
          </span>
          {i < shown.length - 1 ? " " : null}
        </Fragment>
      ))}
      {more > 0 ? ` ${t("portal.kpi.moreOrders", { count: formatNumber(more, 0) })}` : null}
    </>
  );
}

const KPI_TONES = {
  default: "border-border",
  warning: "border-warning/50",
  success: "border-success/50",
  danger: "border-destructive/50",
} as const;

function KpiCard({
  title,
  icon: Icon,
  value,
  failed,
  error,
  onRetry,
  link,
  tone = "default",
  children,
}: {
  title: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  value: number | undefined;
  failed: boolean;
  error: unknown;
  onRetry: () => void;
  link?: { label: string; stage?: OrderStageFilter };
  tone?: keyof typeof KPI_TONES;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-lg border-2 bg-card p-5 shadow-sm",
        KPI_TONES[tone],
      )}
    >
      <h2 className="flex items-start gap-2 text-sm leading-5 font-semibold text-muted-foreground xl:min-h-10">
        <Icon className="size-4 shrink-0 text-primary" aria-hidden />
        {title}
      </h2>
      {failed ? (
        <LoadError
          className="mt-3"
          title={t("portal.kpi.loadFailed")}
          error={error}
          onRetry={onRetry}
        />
      ) : value === undefined ? (
        <div className="mt-3 space-y-2" aria-busy="true">
          <Skeleton className="h-9 w-16" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : (
        <>
          <p className="mt-2 font-heading text-4xl font-bold text-primary tabular-nums">
            {formatNumber(value, 0)}
          </p>
          <div className="mt-1 flex-1 text-sm leading-6 text-muted-foreground">{children}</div>
          {link && value > 0 ? (
            <Link
              to="/portal/orders"
              search={link.stage ? { stage: link.stage } : {}}
              className="mt-3 inline-flex items-center gap-1 self-start rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline"
            >
              {link.label}
              <span className="sr-only">: {title}</span>
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          ) : null}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Latest order
// ---------------------------------------------------------------------------

function LatestOrder({ userId, customerId }: { userId: string; customerId: string }) {
  const t = useT();
  const orders = useQuery(ordersQueryOptions(userId, customerId));
  const statuses = useQuery(statusesQueryOptions(userId));
  const latest = orders.data?.[0];

  return (
    <Section title={t("portal.latestOrder.title")} icon={ClipboardList} id="latest-order">
      {orders.isError || statuses.isError ? (
        <LoadError
          title={t("portal.orders.loadFailed")}
          error={orders.error ?? statuses.error}
          onRetry={() => {
            void orders.refetch();
            void statuses.refetch();
          }}
        />
      ) : orders.isPending || statuses.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      ) : !latest ? (
        <div className="flex flex-col items-start gap-4">
          <div>
            <p className="font-semibold text-foreground">{t("portal.latestOrder.emptyTitle")}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t("portal.latestOrder.emptyText")}
            </p>
          </div>
          <Button asChild>
            <Link to={paths.portalOrderNew}>
              <PackagePlus aria-hidden />
              {t("portal.home.newOrder")}
            </Link>
          </Button>
        </div>
      ) : (
        <LatestOrderBody order={latest} statuses={statuses.data} total={orders.data.length} />
      )}
    </Section>
  );
}

function LatestOrderBody({
  order,
  statuses,
  total,
}: {
  order: OrderListItem;
  statuses: StatusMap;
  total: number;
}) {
  const t = useT();
  const status = resolveStatus(order.status, statuses);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-heading text-lg font-bold text-primary tabular-nums">
          {order.reference}
        </p>
        {order.order_type === "b2b" ? <B2bBadge /> : null}
      </div>
      <OrderStatusBadge status={status} />
      {order.description ? (
        <p className="line-clamp-2 break-words text-sm text-foreground">{order.description}</p>
      ) : null}
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{t("portal.order.fields.store")}</dt>
          <dd className="break-words text-foreground">
            {order.store_vendor ?? t("portal.order.notProvided")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("portal.order.fields.createdAt")}</dt>
          <dd className="text-foreground tabular-nums">{formatDate(order.created_at)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">{t("portal.order.fields.trackingNumber")}</dt>
          <dd className="break-all text-foreground tabular-nums">
            {order.tracking_number ?? t("portal.order.trackingUnknown")}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to="/portal/orders/$id" params={{ id: order.id }}>
            {t("portal.latestOrder.view")}
            <ArrowRight aria-hidden />
          </Link>
        </Button>
        {total > 1 ? (
          <Button asChild variant="ghost" size="sm">
            <Link to="/portal/orders">{t("portal.latestOrder.allOrders")}</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent activity
// ---------------------------------------------------------------------------

function RecentActivity({ userId, customerId }: { userId: string; customerId: string }) {
  const t = useT();
  const activity = useQuery(activityQueryOptions(userId, customerId));
  const statuses = useQuery(statusesQueryOptions(userId));

  return (
    <Section title={t("portal.activity.title")} icon={History} id="recent-activity">
      {activity.isError ? (
        <LoadError
          title={t("portal.activity.loadFailed")}
          error={activity.error}
          onRetry={() => void activity.refetch()}
        />
      ) : activity.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : activity.data.length === 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">{t("portal.activity.empty")}</p>
      ) : (
        <ol className="divide-y">
          {activity.data.map((item) => (
            <ActivityRow key={item.key} item={item} statuses={statuses.data} />
          ))}
        </ol>
      )}
    </Section>
  );
}

function ActivityRow({ item, statuses }: { item: ActivityItem; statuses: StatusMap | undefined }) {
  const t = useT();
  let icon: ReactNode;
  let text: string;
  let detail: string | null = null;
  let orderId: string | null = null;

  switch (item.kind) {
    case "order_registered":
      icon = <ClipboardList className="size-4" aria-hidden />;
      text = t("portal.activity.orderRegistered", { reference: item.reference });
      orderId = item.orderId;
      break;
    case "status_changed": {
      const status = resolveStatus(item.status, statuses ?? new Map());
      const label = status.label ?? t("portal.statusUnknown");
      icon = <StageIcon stage={status.stage} className="size-4" />;
      text = item.reference
        ? t("portal.activity.statusChanged", { reference: item.reference, status: label })
        : t("portal.activity.statusChangedNoRef", { status: label });
      detail = item.message;
      orderId = item.orderId;
      break;
    }
    case "invoice_issued":
    case "invoice_cancelled":
      icon =
        item.kind === "invoice_issued" ? (
          <Receipt className="size-4" aria-hidden />
        ) : (
          <Ban className="size-4" aria-hidden />
        );
      text = t(
        item.kind === "invoice_issued"
          ? "portal.activity.invoiceIssued"
          : "portal.activity.invoiceCancelled",
        { number: item.invoiceNumber ?? "" },
      );
      detail =
        item.amount !== null && item.currency ? formatMoney(item.amount, item.currency) : null;
      break;
    case "payment_received":
      icon = <Wallet className="size-4" aria-hidden />;
      text = t("portal.activity.paymentReceived", { number: item.invoiceNumber ?? "" });
      detail = [
        item.currency ? formatMoney(item.amount, item.currency) : null,
        t("portal.activity.paidOn", { date: formatDate(item.paidOn) }),
      ]
        .filter(Boolean)
        .join(" · ");
      break;
  }

  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-cream text-primary">
        {icon}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-foreground">
          {orderId ? (
            <Link
              to="/portal/orders/$id"
              params={{ id: orderId }}
              className="rounded-sm underline-offset-4 hover:text-primary hover:underline"
            >
              {text}
            </Link>
          ) : (
            text
          )}
        </p>
        {detail ? (
          <p className="mt-0.5 line-clamp-2 break-words text-muted-foreground">{detail}</p>
        ) : null}
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          <time dateTime={item.at}>{formatDateTime(item.at)}</time>
        </p>
      </div>
    </li>
  );
}
