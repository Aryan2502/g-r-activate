import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useLocation } from "@tanstack/react-router";
import {
  ArrowLeft,
  Ban,
  CalendarDays,
  ClipboardList,
  Info,
  Link2,
  Loader2,
  MessageSquareText,
  PackageCheck,
  PackageSearch,
  Pencil,
  Plane,
  Scale,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { CurrencyAmounts } from "@/components/portal/CurrencyAmounts";
import { OrderDocuments } from "@/components/portal/OrderDocuments";
import { OrderEditForm } from "@/components/portal/OrderEditForm";
import { OrderInvoices } from "@/components/portal/OrderInvoices";
import { OrderSiblings } from "@/components/portal/OrderSiblings";
import { JourneyProgress, StatusHistory } from "@/components/portal/OrderTimeline";
import { DetailItem, DetailList, LoadError, Muted, Section } from "@/components/portal/Section";
import { B2bBadge, OrderStatusBadge } from "@/components/portal/StatusBadges";
import { UploadDocumentDialog } from "@/components/portal/UploadDocumentDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatDateTime, formatLbs, formatMoney, formatNumber } from "@/lib/format";
import { t, useT } from "@/lib/i18n";
import type { PortalCustomer } from "@/lib/portal/customer";
import { orderInvoicesQueryOptions, unpaidByCurrency } from "@/lib/portal/invoices";
import {
  canEditOrder,
  canRequestCancellation,
  canUploadDocuments,
  currentStatusMessage,
  orderHistoryQueryOptions,
  orderQueryOptions,
  pickupInfoQueryOptions,
  portalKeys,
  resolveStatus,
  statusesQueryOptions,
  type OrderDetail,
  type OrderStatusView,
  type StatusHistoryEntry,
  type StatusMap,
} from "@/lib/portal/orders";
import { usePortalCustomer } from "@/lib/portal/use-portal-customer";
import { cn } from "@/lib/utils";

/**
 * /portal/orders/$id (SPEC §10, §35.7): one order with its status, timeline,
 * invoices, documents and sibling packages, all read with the customer's own
 * client under RLS. Edits, uploads and the cancellation request write with
 * that same client; the database triggers decide what is allowed.
 */
export const Route = createFileRoute("/portal/orders/$id")({
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("portal.orders.title") }) }] }),
  component: OrderPage,
});

function OrderPage() {
  const t = useT();
  const { id } = Route.useParams();
  const { auth, customer } = usePortalCustomer();
  const order = useQuery(orderQueryOptions(auth.userId, customer.id, id));
  const statuses = useQuery(statusesQueryOptions(auth.userId));

  const back = (
    <Link
      to="/portal/orders"
      className="mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {t("portal.order.back")}
    </Link>
  );

  if (order.isError || statuses.isError) {
    return (
      <>
        {back}
        <h1 className="sr-only">{t("portal.order.heading")}</h1>
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <LoadError
            title={t("portal.order.loadFailed")}
            error={order.error ?? statuses.error}
            onRetry={() => {
              if (order.isError) void order.refetch();
              if (statuses.isError) void statuses.refetch();
            }}
          />
        </div>
      </>
    );
  }

  if (order.isPending || statuses.isPending) {
    return (
      <>
        {back}
        <div className="space-y-4" aria-busy="true">
          <h1 className="sr-only">{t("common.loading")}</h1>
          <Skeleton className="h-9 w-2/3 max-w-sm" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </>
    );
  }

  if (!order.data) {
    return (
      <>
        {back}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h1 className="flex items-center gap-2 text-xl text-primary">
            <PackageSearch className="size-5" aria-hidden />
            {t("portal.order.notFoundTitle")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("portal.order.notFoundText")}</p>
        </div>
      </>
    );
  }

  return (
    <>
      {back}
      <OrderView
        // A fresh edit state per order when navigating between siblings.
        key={order.data.id}
        userId={auth.userId}
        customer={customer}
        order={order.data}
        statuses={statuses.data}
      />
    </>
  );
}

function OrderView({
  userId,
  customer,
  order,
  statuses,
}: {
  userId: string;
  customer: PortalCustomer;
  order: OrderDetail;
  statuses: StatusMap;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const history = useQuery(orderHistoryQueryOptions(userId, order.id));
  const status = resolveStatus(order.status, statuses);
  const stage = status.stage;
  const editable = canEditOrder(stage);
  const canUpload = canUploadDocuments(stage);
  const canCancel = canRequestCancellation(stage, order.cancellation_requested_at);

  // Links like /portal/orders/<id>#order-invoices-title (dashboard): the
  // sections exist only now that the order has loaded.
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const frame = requestAnimationFrame(() =>
      document.getElementById(hash)?.scrollIntoView({ block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [hash]);

  return (
    <>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl text-primary tabular-nums sm:text-3xl">
            {t("portal.order.title", { reference: order.reference })}
          </h1>
          {order.order_type === "b2b" ? <B2bBadge /> : null}
          {order.parent_order_id ? (
            <Badge variant="outline">
              <Link2 className="size-3.5 shrink-0" aria-hidden />
              {t("portal.orders.extraPackage")}
            </Badge>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <OrderStatusBadge status={status} className="px-3 py-1 text-sm" />
          <span className="text-sm text-muted-foreground tabular-nums">
            {t("portal.order.registeredOn", { date: formatDate(order.created_at) })}
          </span>
        </div>
        {(editable && !editing) || canCancel ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {editable && !editing ? (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden />
                {t("portal.order.edit.button")}
              </Button>
            ) : null}
            {canCancel ? <CancelOrderButton userId={userId} order={order} /> : null}
          </div>
        ) : null}
      </header>

      <Banners
        userId={userId}
        customerId={customer.id}
        order={order}
        status={status}
        history={history.data}
        canUpload={canUpload}
      />

      {/* While editing, the form gets the full width and the status follows it. */}
      <div
        className={cn(
          "grid gap-6",
          !(editing && editable) && "xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]",
        )}
      >
        <div className={cn("min-w-0 space-y-6", !(editing && editable) && "xl:order-2")}>
          <Section title={t("portal.order.sections.status")} icon={ClipboardList} id="order-status">
            <OrderStatusBadge status={status} />
            {status.description ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{status.description}</p>
            ) : null}
            <div className="mt-5">
              <JourneyProgress
                stage={stage}
                label={status.label}
                statuses={statuses}
                history={history.data ?? []}
              />
            </div>
          </Section>
          <StatusHistory order={order} statuses={statuses} history={history} />
        </div>

        <div
          className={cn("min-w-0 space-y-6", editing && editable ? "order-first" : "xl:order-1")}
        >
          {editing && editable ? (
            <OrderEditForm
              userId={userId}
              customerId={customer.id}
              order={order}
              onDone={() => setEditing(false)}
            />
          ) : (
            <OrderDetails order={order} customer={customer} />
          )}
          <OrderInvoices
            userId={userId}
            customerId={customer.id}
            orderId={order.id}
            customerCode={customer.customer_code}
          />
          <OrderDocuments
            userId={userId}
            customerId={customer.id}
            orderId={order.id}
            canUpload={canUpload}
            isB2b={order.order_type === "b2b"}
          />
          <OrderSiblings
            userId={userId}
            customerId={customer.id}
            order={order}
            statuses={statuses}
          />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Banners: cancellation requested, action required, ready for pickup, cancelled
// ---------------------------------------------------------------------------

function Banner({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: "warning" | "success" | "neutral" | "info";
  icon: typeof Info;
  title: string;
  children?: ReactNode;
}) {
  const tones = {
    warning: "border-warning/40 bg-warning-soft [&_[data-icon]]:text-warning",
    success: "border-success/40 bg-success-soft [&_[data-icon]]:text-success",
    neutral: "border-border bg-neutral-soft [&_[data-icon]]:text-neutral",
    info: "border-info/30 bg-info-soft [&_[data-icon]]:text-info",
  } as const;
  return (
    <section className={`mb-6 flex gap-3 rounded-lg border-2 p-4 sm:p-5 ${tones[tone]}`}>
      <Icon data-icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-sm leading-6 text-foreground">
        <h2 className="text-base font-bold text-foreground">{title}</h2>
        {children}
      </div>
    </section>
  );
}

function Banners({
  userId,
  customerId,
  order,
  status,
  history,
  canUpload,
}: {
  userId: string;
  customerId: string;
  order: OrderDetail;
  status: OrderStatusView;
  history: readonly StatusHistoryEntry[] | undefined;
  canUpload: boolean;
}) {
  const t = useT();
  const readyForPickup = status.stage === "ready_for_pickup";
  const pickup = useQuery({ ...pickupInfoQueryOptions(userId), enabled: readyForPickup });
  // Shared with the invoices section below (same query key).
  const invoices = useQuery({
    ...orderInvoicesQueryOptions(userId, customerId, order.id),
    enabled: readyForPickup,
  });
  const unpaid = invoices.data ? unpaidByCurrency(invoices.data) : [];
  const message = history ? currentStatusMessage(history, order.status) : null;

  return (
    <>
      {order.cancellation_requested_at && status.stage !== "cancelled" ? (
        <Banner tone="info" icon={Info} title={t("portal.order.cancel.requestedTitle")}>
          <p>
            {t("portal.order.cancellationRequested", {
              date: formatDateTime(order.cancellation_requested_at),
            })}
          </p>
        </Banner>
      ) : null}

      {status.stage === "action_required" ? (
        <Banner tone="warning" icon={TriangleAlert} title={t("portal.order.actionRequired.title")}>
          <p>{t("portal.order.actionRequired.text")}</p>
          {message ? (
            <div className="mt-3 rounded-md border border-warning/30 bg-card px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <MessageSquareText className="size-3.5" aria-hidden />
                {t("portal.order.actionRequired.messageLabel")}
              </p>
              <p className="mt-1 whitespace-pre-line break-words text-foreground">{message}</p>
            </div>
          ) : null}
          {canUpload ? (
            <div className="mt-3">
              <UploadDocumentDialog
                userId={userId}
                customerId={customerId}
                orderId={order.id}
                trigger={
                  <Button>
                    <Upload aria-hidden />
                    {t("portal.order.actionRequired.upload")}
                  </Button>
                }
              />
            </div>
          ) : null}
        </Banner>
      ) : null}

      {status.stage === "ready_for_pickup" ? (
        <Banner tone="success" icon={PackageCheck} title={t("portal.order.pickup.title")}>
          {pickup.isError ? (
            <LoadError
              className="mt-2"
              title={t("portal.order.pickup.loadFailed")}
              error={pickup.error}
              onRetry={() => void pickup.refetch()}
            />
          ) : pickup.isPending ? (
            <Skeleton className="mt-2 h-12 w-full max-w-sm" />
          ) : (
            <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[9rem_1fr]">
              <dt className="font-semibold">{t("portal.order.pickup.address")}</dt>
              <dd>{pickup.data?.pickup_address ?? t("common.notSet")}</dd>
              <dt className="font-semibold">{t("portal.order.pickup.hours")}</dt>
              <dd className="whitespace-pre-line">
                {pickup.data?.pickup_hours ?? t("common.notSet")}
              </dd>
              {pickup.data?.pickup_instructions ? (
                <>
                  <dt className="font-semibold">{t("portal.order.pickup.instructions")}</dt>
                  <dd className="whitespace-pre-line">{pickup.data.pickup_instructions}</dd>
                </>
              ) : null}
            </dl>
          )}
          {unpaid.length > 0 ? (
            <div className="mt-3 flex gap-2 rounded-md border border-warning/40 bg-card px-3 py-2.5">
              <TriangleAlert className="mt-1 size-4 shrink-0 text-warning" aria-hidden />
              <p>
                <span className="font-semibold">
                  {pickup.data?.pay_before_pickup === false
                    ? t("portal.order.pickup.openInvoice")
                    : t("portal.order.pickup.payFirst")}
                </span>{" "}
                <CurrencyAmounts amounts={unpaid} />{" "}
                <a
                  href="#order-invoices-title"
                  className="whitespace-nowrap font-semibold text-primary underline underline-offset-4"
                >
                  {t("portal.order.pickup.toInvoices")}
                </a>
              </p>
            </div>
          ) : null}
        </Banner>
      ) : null}

      {status.stage === "cancelled" ? (
        <Banner tone="neutral" icon={Ban} title={t("portal.order.cancelledTitle")}>
          {/* The status section already describes the status; say it only once. */}
          {status.description ? null : <p>{t("portal.order.cancelledText")}</p>}
          {message ? (
            <p className={cn("whitespace-pre-line break-words", !status.description && "mt-2")}>
              {message}
            </p>
          ) : null}
        </Banner>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// "Annulering aanvragen" (request_order_cancellation)
// ---------------------------------------------------------------------------

function CancelOrderButton({ userId, order }: { userId: string; order: OrderDetail }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const request = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("request_order_cancellation", { _order_id: order.id });
      if (error) throw error;
    },
    onSuccess: async () => {
      setOpen(false);
      toast.success(t("portal.order.cancel.success"));
      await queryClient.invalidateQueries({ queryKey: portalKeys.orders(userId) });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={(next) => !request.isPending && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          className="border-destructive/40 text-destructive hover:bg-destructive-soft hover:text-destructive"
        >
          <Ban aria-hidden />
          {t("portal.order.cancel.button")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="w-[calc(100%-2rem)] rounded-lg bg-card">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-heading text-primary">
            {t("portal.order.cancel.confirmTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("portal.order.cancel.confirmText", { reference: order.reference })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel disabled={request.isPending}>
            {t("portal.order.cancel.keep")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={request.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              // Keep the dialog open until the request has finished.
              e.preventDefault();
              request.mutate();
            }}
          >
            {request.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {request.isPending
              ? t("portal.order.cancel.requesting")
              : t("portal.order.cancel.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Order fields (SPEC §10)
// ---------------------------------------------------------------------------

function Value({ value, empty }: { value: ReactNode; empty?: string }) {
  const t = useT();
  return value === null || value === undefined || value === "" ? (
    <Muted>{empty ?? t("portal.order.notProvided")}</Muted>
  ) : (
    <>{value}</>
  );
}

function OrderDetails({ order, customer }: { order: OrderDetail; customer: PortalCustomer }) {
  const t = useT();
  const shipment = order.shipment;

  return (
    <>
      <Section title={t("portal.order.sections.details")} icon={ClipboardList} id="order-details">
        <DetailList>
          <DetailItem label={t("portal.order.fields.reference")}>
            <span className="font-semibold tabular-nums">{order.reference}</span>
          </DetailItem>
          <DetailItem label={t("portal.order.fields.customerCode")}>
            <span className="font-heading font-bold text-primary tabular-nums">
              {customer.customer_code}
            </span>
          </DetailItem>
          <DetailItem label={t("portal.order.fields.orderType")}>
            {t(`portal.orderTypes.${order.order_type}`)}
          </DetailItem>
          <DetailItem label={t("portal.order.fields.serviceType")}>
            {t(`portal.serviceTypes.${order.service_type}`)}
          </DetailItem>
          <DetailItem label={t("portal.order.fields.store")}>
            <Value value={order.store_vendor} />
          </DetailItem>
          <DetailItem label={t("portal.order.fields.vendorOrderNumber")}>
            <span className="break-all tabular-nums">
              <Value value={order.vendor_order_number} />
            </span>
          </DetailItem>
          <DetailItem label={t("portal.order.fields.description")}>
            <span className="whitespace-pre-line">
              <Value value={order.description} />
            </span>
          </DetailItem>
          <DetailItem label={t("portal.order.fields.quantity")}>
            <span className="tabular-nums">{formatNumber(order.quantity, 0)}</span>
          </DetailItem>
          <DetailItem label={t("portal.order.fields.estimatedValue")}>
            <span className="tabular-nums">
              <Value
                value={
                  order.estimated_value !== null
                    ? formatMoney(order.estimated_value, order.estimated_value_currency)
                    : null
                }
              />
            </span>
          </DetailItem>
        </DetailList>
      </Section>

      <Section title={t("portal.order.sections.shipping")} icon={Scale} id="order-shipping">
        <DetailList>
          <DetailItem label={t("portal.order.fields.trackingNumber")}>
            <span className="break-all tabular-nums">
              <Value value={order.tracking_number} empty={t("portal.order.trackingUnknown")} />
            </span>
          </DetailItem>
          <DetailItem label={t("portal.order.fields.carrier")}>
            <Value value={order.carrier} />
          </DetailItem>
          <DetailItem label={t("portal.order.fields.declaredWeight")}>
            <span className="tabular-nums">
              <Value
                value={
                  order.declared_weight_lbs !== null ? formatLbs(order.declared_weight_lbs) : null
                }
              />
            </span>
          </DetailItem>
          <DetailItem label={t("portal.order.fields.measuredWeight")}>
            <span className="tabular-nums">
              <Value
                value={
                  order.measured_weight_lbs !== null ? formatLbs(order.measured_weight_lbs) : null
                }
                empty={t("portal.order.notWeighed")}
              />
            </span>
          </DetailItem>
        </DetailList>
      </Section>

      {order.order_type === "b2b" ? (
        <Section title={t("portal.order.sections.b2b")} icon={ClipboardList} id="order-b2b">
          <DetailList>
            <DetailItem label={t("portal.order.fields.supplier")}>
              <Value value={order.supplier_name} />
            </DetailItem>
            <DetailItem label={t("portal.order.fields.clientPo")}>
              <span className="break-all tabular-nums">
                <Value value={order.client_po_number} />
              </span>
            </DetailItem>
            <DetailItem label={t("portal.order.fields.purchaseMode")}>
              <Value
                value={
                  order.purchase_mode ? t(`portal.purchaseModes.${order.purchase_mode}`) : null
                }
              />
            </DetailItem>
          </DetailList>
        </Section>
      ) : null}

      <Section title={t("portal.order.sections.dates")} icon={CalendarDays} id="order-dates">
        <DetailList>
          <DetailItem label={t("portal.order.fields.purchaseDate")}>
            <span className="tabular-nums">
              <Value value={order.purchase_date ? formatDate(order.purchase_date) : null} />
            </span>
          </DetailItem>
          <DetailItem label={t("portal.order.fields.expectedDelivery")}>
            <span className="tabular-nums">
              <Value
                value={
                  order.expected_delivery_date ? formatDate(order.expected_delivery_date) : null
                }
              />
            </span>
          </DetailItem>
          <DetailItem label={t("portal.order.fields.createdAt")}>
            <span className="tabular-nums">{formatDateTime(order.created_at)}</span>
          </DetailItem>
          {order.received_at ? (
            <DetailItem label={t("portal.order.fields.receivedAt")}>
              <span className="tabular-nums">{formatDateTime(order.received_at)}</span>
            </DetailItem>
          ) : null}
          {order.picked_up_at ? (
            <DetailItem label={t("portal.order.fields.pickedUpAt")}>
              <span className="tabular-nums">{formatDateTime(order.picked_up_at)}</span>
            </DetailItem>
          ) : null}
          {order.picked_up_by_name ? (
            <DetailItem label={t("portal.order.fields.pickedUpBy")}>
              {order.picked_up_by_name}
            </DetailItem>
          ) : null}
        </DetailList>
      </Section>

      {order.customer_note ? (
        <Section title={t("portal.order.sections.note")} icon={MessageSquareText} id="order-note">
          <p className="whitespace-pre-line break-words text-sm leading-6 text-foreground">
            {order.customer_note}
          </p>
        </Section>
      ) : null}

      {shipment ? (
        <Section title={t("portal.order.sections.shipment")} icon={Plane} id="order-shipment">
          <DetailList>
            <DetailItem label={t("portal.order.fields.shipmentNumber")}>
              <span className="font-semibold tabular-nums">{shipment.shipment_number}</span>
            </DetailItem>
            <DetailItem label={t("portal.order.fields.serviceType")}>
              {t(`portal.serviceTypes.${shipment.service_type}`)}
            </DetailItem>
            {shipment.carrier ? (
              <DetailItem label={t("portal.order.fields.carrier")}>{shipment.carrier}</DetailItem>
            ) : null}
            {shipment.awb_or_container_number ? (
              <DetailItem label={t("portal.order.fields.awb")}>
                <span className="break-all tabular-nums">{shipment.awb_or_container_number}</span>
              </DetailItem>
            ) : null}
            {shipment.departed_at ? (
              <DetailItem label={t("portal.order.fields.departedAt")}>
                <span className="tabular-nums">{formatDateTime(shipment.departed_at)}</span>
              </DetailItem>
            ) : null}
            {shipment.arrived_at ? (
              <DetailItem label={t("portal.order.fields.arrivedAt")}>
                <span className="tabular-nums">{formatDateTime(shipment.arrived_at)}</span>
              </DetailItem>
            ) : null}
            {shipment.customer_note ? (
              <DetailItem label={t("portal.order.fields.shipmentNote")}>
                <span className="whitespace-pre-line">{shipment.customer_note}</span>
              </DetailItem>
            ) : null}
          </DetailList>
        </Section>
      ) : null}
    </>
  );
}
