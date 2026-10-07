import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRightLeft,
  Boxes,
  ClipboardList,
  Eye,
  Loader2,
  PackageMinus,
  PackagePlus,
  Pencil,
  Plane,
  TriangleAlert,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";

import { AddOrdersDialog } from "@/components/admin/AddOrdersDialog";
import { Callout } from "@/components/admin/Callout";
import { useOrderDialogs, type OrderDialogs } from "@/components/admin/OrderDialogs";
import { OrderRowActions } from "@/components/admin/OrderRowActions";
import { ServiceTypeLabel, StageSummary } from "@/components/admin/ShipmentBits";
import { SelectionBar } from "@/components/admin/SelectionBar";
import { ShipmentFormDialog } from "@/components/admin/ShipmentFormDialog";
import { DetailItem, DetailList, LoadError, Muted, Section } from "@/components/portal/Section";
import { B2bBadge, OrderStatusBadge } from "@/components/portal/StatusBadges";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { adminKeys } from "@/lib/admin/keys";
import {
  buildOrderViews,
  customerDisplayName,
  toReceiveTarget,
  toStatusTarget,
  type AdminOrderView,
} from "@/lib/admin/orders";
import {
  adminShipmentQueryOptions,
  openShipmentOrders,
  removeOrdersFromShipment,
  shipmentOrdersQueryOptions,
  summarizeShipment,
  type Shipment,
  type ShipmentSummary,
} from "@/lib/admin/shipments";
import {
  DEFAULT_OPERATIONAL_SETTINGS,
  adminStatusesQueryOptions,
  operationalSettingsQueryOptions,
  type AdminStatusMap,
} from "@/lib/admin/statuses";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatDateTime, formatLbs, formatNumber } from "@/lib/format";
import { t, useT } from "@/lib/i18n";
import { resolveStatus } from "@/lib/portal/orders";
import { cn } from "@/lib/utils";

/**
 * /admin/zendingen/$id (SPEC §21, §35.7): one flight or container. Its
 * details (all visible to customers with an order in it), what is in it, the
 * orders with their row actions, "Orders toevoegen" (same service type,
 * scan to tick), "Uit zending halen", and "Status voor hele zending
 * wijzigen": one change_order_status call for all open orders
 * (changeOrderStatusFn, P8 hook with at most one e-mail per customer).
 */
export const Route = createFileRoute("/admin/zendingen/$id")({
  head: () => ({
    meta: [{ title: t("meta.pageTitle", { page: t("admin.shipments.detail.heading") }) }],
  }),
  component: ShipmentPage,
});

const adminRoute = getRouteApi("/admin");

function ShipmentPage() {
  const t = useT();
  const { id } = Route.useParams();
  const { auth } = adminRoute.useRouteContext();
  const shipment = useQuery(adminShipmentQueryOptions(auth.userId, id));
  const statuses = useQuery(adminStatusesQueryOptions(auth.userId));

  const back = (
    <Link
      to="/admin/zendingen"
      className="mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {t("admin.shipments.detail.back")}
    </Link>
  );

  if (shipment.isError || statuses.isError) {
    return (
      <>
        {back}
        <h1 className="sr-only">{t("admin.shipments.detail.heading")}</h1>
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <LoadError
            title={t("admin.shipments.detail.loadFailed")}
            error={shipment.error ?? statuses.error}
            onRetry={() => {
              if (shipment.isError) void shipment.refetch();
              if (statuses.isError) void statuses.refetch();
            }}
          />
        </div>
      </>
    );
  }

  if (shipment.isPending || statuses.isPending) {
    return (
      <>
        {back}
        <div className="space-y-4" aria-busy="true">
          <span className="sr-only">{t("common.loading")}</span>
          <Skeleton className="h-10 w-72 max-w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }

  if (!shipment.data) {
    return (
      <>
        {back}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h1 className="text-xl text-foreground">{t("admin.shipments.detail.notFoundTitle")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("admin.shipments.detail.notFoundText")}
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      {back}
      <ShipmentView userId={auth.userId} shipment={shipment.data} statuses={statuses.data} />
    </>
  );
}

function ShipmentView({
  userId,
  shipment,
  statuses,
}: {
  userId: string;
  shipment: Shipment;
  statuses: AdminStatusMap;
}) {
  const t = useT();
  const orders = useQuery(shipmentOrdersQueryOptions(userId, shipment.id));
  const settings = useQuery(operationalSettingsQueryOptions(userId));
  const dialogs = useOrderDialogs({
    userId,
    statuses,
    settings: settings.data ?? DEFAULT_OPERATIONAL_SETTINGS,
  });
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);

  const views = useMemo(
    () => (orders.data ? buildOrderViews(orders.data, statuses, undefined, undefined) : []),
    [orders.data, statuses],
  );
  const summary = useMemo(
    () => (orders.data ? summarizeShipment(shipment, orders.data, statuses) : null),
    [shipment, orders.data, statuses],
  );
  const open = openShipmentOrders(views);

  const changeWhole = () =>
    dialogs.changeStatus(open.map(toStatusTarget), null, {
      title: t("admin.shipments.detail.bulkStatusTitle", { number: shipment.shipment_number }),
      description: t(
        open.length === 1
          ? "admin.shipments.detail.bulkStatusIntroOne"
          : "admin.shipments.detail.bulkStatusIntro",
        { count: formatNumber(open.length, 0) },
      ),
    });

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-bold text-primary [overflow-wrap:anywhere] sm:text-3xl">
            {t("admin.shipments.detail.title", { number: shipment.shipment_number })}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <ServiceTypeLabel type={shipment.service_type} className="text-foreground" />
            <span className="tabular-nums">
              {t("admin.shipments.detail.createdOn", { date: formatDate(shipment.created_at) })}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={changeWhole} disabled={!summary || open.length === 0}>
            <ArrowRightLeft aria-hidden />
            {t("admin.shipments.detail.bulkStatus")}
          </Button>
          <Button variant="outline" onClick={() => setAdding(true)}>
            <PackagePlus aria-hidden />
            {t("admin.shipments.detail.addOrders")}
          </Button>
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            {t("admin.shipments.detail.edit")}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        {summary ? <Warnings summary={summary} /> : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <DetailsSection shipment={shipment} />
          <ContentsSection summary={summary} loading={orders.isPending} />
        </div>

        <Section title={t("admin.shipments.detail.ordersTitle")} icon={Boxes} id="shipment-orders">
          {orders.isError ? (
            <LoadError
              title={t("admin.shipments.detail.ordersLoadFailed")}
              error={orders.error}
              onRetry={() => void orders.refetch()}
            />
          ) : orders.isPending ? (
            <div className="space-y-2" aria-busy="true">
              <span className="sr-only">{t("common.loading")}</span>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : views.length === 0 ? (
            <div className="flex flex-col items-start gap-3">
              <p className="max-w-prose text-sm leading-6 text-muted-foreground">
                {t("admin.shipments.detail.ordersEmpty")}
              </p>
              <Button onClick={() => setAdding(true)}>
                <PackagePlus aria-hidden />
                {t("admin.shipments.detail.addOrders")}
              </Button>
            </div>
          ) : (
            <ShipmentOrders
              userId={userId}
              shipment={shipment}
              orders={views}
              statuses={statuses}
              dialogs={dialogs}
            />
          )}
        </Section>
      </div>

      <ShipmentFormDialog
        userId={userId}
        shipment={shipment}
        // Locked while the orders are unknown too: they must keep matching it.
        serviceTypeLocked={!summary || summary.orderCount > 0}
        open={editing}
        onOpenChange={setEditing}
      />
      <AddOrdersDialog
        userId={userId}
        shipment={shipment}
        statuses={statuses}
        open={adding}
        onOpenChange={setAdding}
      />
      {dialogs.element}
    </>
  );
}

function Warnings({ summary }: { summary: ShipmentSummary }) {
  const t = useT();
  if (summary.mismatched === 0 && summary.notReceived === 0) return null;
  return (
    <div className="space-y-3">
      {summary.mismatched > 0 ? (
        <Callout
          tone="warning"
          icon={TriangleAlert}
          title={t(
            summary.mismatched === 1
              ? "admin.shipments.detail.mismatchOne"
              : "admin.shipments.detail.mismatchMany",
            { count: formatNumber(summary.mismatched, 0) },
          )}
        />
      ) : null}
      {summary.notReceived > 0 ? (
        <Callout
          tone="info"
          icon={Warehouse}
          title={t(
            summary.notReceived === 1
              ? "admin.shipments.detail.notReceivedOne"
              : "admin.shipments.detail.notReceivedMany",
            { count: formatNumber(summary.notReceived, 0) },
          )}
        />
      ) : null}
    </div>
  );
}

function DetailsSection({ shipment }: { shipment: Shipment }) {
  const t = useT();
  const when = (value: string | null) =>
    value ? (
      <span className="tabular-nums">{formatDateTime(value)}</span>
    ) : (
      <Muted>{t("admin.shipments.notYet")}</Muted>
    );
  return (
    <Section
      title={t("admin.shipments.detail.details")}
      icon={Plane}
      id="shipment-details"
      description={
        <span className="inline-flex items-start gap-1.5">
          <Eye className="mt-1 size-3.5 shrink-0" aria-hidden />
          {t("admin.shipments.form.visibleNote")}
        </span>
      }
    >
      <DetailList>
        <DetailItem label={t("portal.order.fields.shipmentNumber")}>
          <span className="font-semibold tabular-nums">{shipment.shipment_number}</span>
        </DetailItem>
        <DetailItem label={t("portal.order.fields.serviceType")}>
          <ServiceTypeLabel type={shipment.service_type} />
        </DetailItem>
        <DetailItem label={t("portal.order.fields.carrier")}>
          {shipment.carrier ?? <Muted>–</Muted>}
        </DetailItem>
        <DetailItem label={t("portal.order.fields.awb")}>
          {shipment.awb_or_container_number ? (
            <span className="tabular-nums [overflow-wrap:anywhere]">
              {shipment.awb_or_container_number}
            </span>
          ) : (
            <Muted>–</Muted>
          )}
        </DetailItem>
        <DetailItem label={t("portal.order.fields.departedAt")}>
          {when(shipment.departed_at)}
        </DetailItem>
        <DetailItem label={t("portal.order.fields.arrivedAt")}>
          {when(shipment.arrived_at)}
        </DetailItem>
        <DetailItem label={t("admin.shipments.form.customerNote")}>
          {shipment.customer_note ? (
            <span className="whitespace-pre-line">{shipment.customer_note}</span>
          ) : (
            <Muted>{t("admin.shipments.detail.noNote")}</Muted>
          )}
        </DetailItem>
      </DetailList>
    </Section>
  );
}

function ContentsSection({
  summary,
  loading,
}: {
  summary: ShipmentSummary | null;
  loading: boolean;
}) {
  const t = useT();
  return (
    <Section
      title={t("admin.shipments.detail.summaryTitle")}
      icon={ClipboardList}
      id="shipment-contents"
    >
      {!summary ? (
        loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <Muted>–</Muted>
        )
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div className="min-w-0 rounded-md bg-cream/60 p-3">
              <dt className="text-xs text-muted-foreground">
                {t("admin.shipments.columns.orders")}
              </dt>
              <dd className="mt-1 font-heading text-xl font-bold text-primary tabular-nums">
                {formatNumber(summary.orderCount, 0)}
              </dd>
            </div>
            <div className="min-w-0 rounded-md bg-cream/60 p-3">
              <dt className="text-xs text-muted-foreground">
                {t("admin.shipments.detail.customers")}
              </dt>
              <dd className="mt-1 font-heading text-xl font-bold text-primary tabular-nums">
                {formatNumber(summary.customerCount, 0)}
              </dd>
            </div>
            <div className="min-w-0 rounded-md bg-cream/60 p-3">
              <dt className="text-xs text-muted-foreground">
                {t("admin.shipments.detail.weight")}
              </dt>
              <dd className="mt-1 font-heading text-base font-bold text-primary tabular-nums [overflow-wrap:anywhere] sm:text-xl">
                {formatLbs(summary.measuredLbs)}
              </dd>
            </div>
          </dl>
          {summary.unweighed > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground tabular-nums">
              {t("admin.shipments.detail.unweighed", {
                count: formatNumber(summary.unweighed, 0),
              })}
            </p>
          ) : null}
          <StageSummary stages={summary.stages} className="mt-4" />
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// The orders: a table from xl, cards below; selection → status or removal
// ---------------------------------------------------------------------------

function ShipmentOrders({
  userId,
  shipment,
  orders,
  statuses,
  dialogs,
}: {
  userId: string;
  shipment: Shipment;
  orders: AdminOrderView[];
  statuses: AdminStatusMap;
  dialogs: OrderDialogs;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [removing, setRemoving] = useState<AdminOrderView[] | null>(null);
  const chosen = orders.filter((o) => selected.has(o.id));
  const allSelected = orders.length > 0 && chosen.length === orders.length;

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const toggleAll = (on: boolean) => setSelected(on ? new Set(orders.map((o) => o.id)) : new Set());

  const remove = useMutation({
    mutationFn: (list: AdminOrderView[]) =>
      removeOrdersFromShipment(
        supabase,
        shipment.id,
        list.map((o) => o.id),
      ),
    onSuccess: async (result) => {
      toast.success(
        t(
          result.done.length === 1
            ? "admin.shipments.detail.removedOne"
            : "admin.shipments.detail.removedMany",
          { count: formatNumber(result.done.length, 0) },
        ),
      );
      setRemoving(null);
      setSelected(new Set());
      await queryClient.invalidateQueries({ queryKey: adminKeys.orders(userId) });
    },
    onError: (e) => toast.error(`${t("admin.shipments.detail.removeFailed")} ${errorMessage(e)}`),
  });

  const actions = (order: AdminOrderView) => (
    <OrderRowActions
      order={order}
      onChangeStatus={() => dialogs.changeStatus([toStatusTarget(order)])}
      onReceive={() => dialogs.receive(toReceiveTarget(order))}
      onPickup={() => dialogs.pickup([toStatusTarget(order)])}
      extra={
        <DropdownMenuItem onSelect={() => setRemoving([order])}>
          <PackageMinus aria-hidden />
          {t("admin.shipments.detail.removeSelected")}
        </DropdownMenuItem>
      }
    />
  );

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id="shipment-select-all"
            checked={allSelected}
            onCheckedChange={(v) => toggleAll(v === true)}
          />
          <Label htmlFor="shipment-select-all" className="text-sm font-normal">
            {t("admin.orders.selectAll")}
          </Label>
        </div>
      </div>

      <OrdersTable
        shipment={shipment}
        orders={orders}
        statuses={statuses}
        selected={selected}
        onToggle={toggle}
        actions={actions}
      />
      <OrderCards
        shipment={shipment}
        orders={orders}
        statuses={statuses}
        selected={selected}
        onToggle={toggle}
        actions={actions}
      />
      <SelectionBar label={t("admin.shipments.detail.selectedStatus")} count={chosen.length}>
        <Button size="sm" onClick={() => dialogs.changeStatus(chosen.map(toStatusTarget))}>
          <ArrowRightLeft aria-hidden />
          {t("admin.shipments.detail.selectedStatus")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setRemoving(chosen)}>
          <PackageMinus aria-hidden />
          {t("admin.shipments.detail.removeSelected")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
          {t("admin.orders.clearSelection")}
        </Button>
      </SelectionBar>

      <AlertDialog
        open={removing !== null}
        onOpenChange={(next) => {
          if (!next && !remove.isPending) setRemoving(null);
        }}
      >
        <AlertDialogContent className="w-[calc(100%-2rem)] rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.shipments.detail.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {removing && removing.length === 1 && removing[0]
                ? t("admin.shipments.detail.removeTextOne", {
                    reference: removing[0].reference,
                    number: shipment.shipment_number,
                  })
                : t("admin.shipments.detail.removeTextMany", {
                    count: formatNumber(removing?.length ?? 0, 0),
                    number: shipment.shipment_number,
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              {t("admin.shipments.form.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (removing) remove.mutate(removing);
              }}
            >
              {remove.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {remove.isPending
                ? t("admin.shipments.detail.removing")
                : t("admin.shipments.detail.removeConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface ListProps {
  shipment: Shipment;
  orders: AdminOrderView[];
  statuses: AdminStatusMap;
  selected: ReadonlySet<string>;
  onToggle: (id: string, on: boolean) => void;
  actions: (order: AdminOrderView) => ReactNode;
}

function OrderLink({ order, className }: { order: AdminOrderView; className?: string }) {
  return (
    <Link
      to="/admin/orders/$id"
      params={{ id: order.id }}
      className={cn(
        "whitespace-nowrap rounded-sm font-bold text-primary tabular-nums underline-offset-4 hover:underline",
        className,
      )}
    >
      {order.reference}
    </Link>
  );
}

function CustomerText({ order }: { order: AdminOrderView }) {
  if (!order.customer) return <Muted>–</Muted>;
  return (
    <>
      <span className="block break-words font-semibold text-foreground">
        {customerDisplayName(order.customer)}
      </span>
      <span className="font-heading text-xs font-bold text-primary tabular-nums">
        {order.customer.customer_code}
      </span>
    </>
  );
}

function Weight({ order }: { order: AdminOrderView }) {
  const t = useT();
  return order.measured_weight_lbs !== null ? (
    <span className="whitespace-nowrap tabular-nums">{formatLbs(order.measured_weight_lbs)}</span>
  ) : (
    <Muted>{t("portal.order.notWeighed")}</Muted>
  );
}

function Markers({ order, shipment }: { order: AdminOrderView; shipment: Shipment }) {
  const t = useT();
  const other = order.service_type !== shipment.service_type;
  if (order.order_type !== "b2b" && !other) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1.5">
      {order.order_type === "b2b" ? <B2bBadge /> : null}
      {other ? (
        <Badge variant="warning">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          {t("admin.shipments.detail.otherServiceType")}:{" "}
          {t(`portal.serviceTypes.${order.service_type}`)}
        </Badge>
      ) : null}
    </span>
  );
}

function OrdersTable({ shipment, orders, statuses, selected, onToggle, actions }: ListProps) {
  const t = useT();
  const th = "px-2 py-3 font-bold text-primary";
  return (
    <div className="relative hidden overflow-x-auto rounded-md border xl:block">
      <table className="w-full text-sm">
        <caption className="sr-only">
          {t("admin.shipments.detail.tableCaption", { number: shipment.shipment_number })}
        </caption>
        <thead className="border-b bg-cream text-left">
          <tr>
            <th scope="col" className="w-8 py-3 pl-3 pr-1">
              <span className="sr-only">{t("admin.orders.columns.select")}</span>
            </th>
            <th scope="col" className={th}>
              {t("admin.orders.columns.order")}
            </th>
            <th scope="col" className={th}>
              {t("admin.orders.columns.customer")}
            </th>
            <th scope="col" className={th}>
              {t("admin.orders.columns.tracking")}
            </th>
            <th scope="col" className={th}>
              {t("admin.shipments.detail.columns.weight")}
            </th>
            <th scope="col" className={th}>
              {t("admin.orders.columns.status")}
            </th>
            <th scope="col" className="w-11 px-1 py-3">
              <span className="sr-only">{t("admin.orders.columns.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {orders.map((order) => (
            <tr
              key={order.id}
              className={cn(
                "align-top transition-colors hover:bg-cream/50",
                selected.has(order.id) && "bg-cream/70",
              )}
            >
              <td className="py-3 pl-3 pr-1">
                <Checkbox
                  checked={selected.has(order.id)}
                  onCheckedChange={(v) => onToggle(order.id, v === true)}
                  aria-label={t("admin.orders.selectOrder", { reference: order.reference })}
                  className="mt-0.5"
                />
              </td>
              <td className="px-2 py-3">
                <OrderLink order={order} />
                <span className="mt-0.5 block whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                  <span className="sr-only">{t("admin.orders.columns.date")}: </span>
                  {formatDate(order.created_at)}
                </span>
                <Markers order={order} shipment={shipment} />
              </td>
              <td className="px-2 py-3">
                <CustomerText order={order} />
              </td>
              <td className="px-2 py-3">
                {order.tracking_number ? (
                  <span className="block tabular-nums [overflow-wrap:anywhere]">
                    {order.tracking_number}
                  </span>
                ) : (
                  <Muted>{t("admin.orders.trackingUnknown")}</Muted>
                )}
              </td>
              <td className="px-2 py-3">
                <Weight order={order} />
              </td>
              <td className="px-2 py-3">
                <OrderStatusBadge status={resolveStatus(order.status, statuses)} />
              </td>
              <td className="px-1 py-2 text-right">{actions(order)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderCards({ shipment, orders, statuses, selected, onToggle, actions }: ListProps) {
  const t = useT();
  return (
    <ul
      className="grid gap-3 md:grid-cols-2 xl:hidden"
      aria-label={t("admin.shipments.detail.tableCaption", { number: shipment.shipment_number })}
    >
      {orders.map((order) => (
        <li
          key={order.id}
          className={cn(
            "min-w-0 rounded-md border p-4",
            selected.has(order.id) && "border-primary/50 bg-cream/40",
          )}
        >
          <div className="flex items-start gap-3">
            <Checkbox
              checked={selected.has(order.id)}
              onCheckedChange={(v) => onToggle(order.id, v === true)}
              aria-label={t("admin.orders.selectOrder", { reference: order.reference })}
              className="relative mt-1 size-5 after:absolute after:-inset-3 after:content-['']"
            />
            <div className="min-w-0 flex-1">
              <OrderLink order={order} className="font-heading" />
              <p className="text-xs text-muted-foreground tabular-nums">
                {t("admin.orders.columns.date")}: {formatDate(order.created_at)}
              </p>
            </div>
            {actions(order)}
          </div>
          <Markers order={order} shipment={shipment} />
          <div className="mt-3">
            <OrderStatusBadge status={resolveStatus(order.status, statuses)} />
          </div>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">
                {t("admin.orders.columns.customer")}
              </dt>
              <dd>
                <CustomerText order={order} />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">
                {t("admin.shipments.detail.columns.weight")}
              </dt>
              <dd>
                <Weight order={order} />
              </dd>
            </div>
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-xs text-muted-foreground">
                {t("admin.orders.columns.tracking")}
              </dt>
              <dd className="tabular-nums [overflow-wrap:anywhere]">
                {order.tracking_number ?? <Muted>{t("admin.orders.trackingUnknown")}</Muted>}
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}
