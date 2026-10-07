import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRightLeft,
  Ban,
  Boxes,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  FileWarning,
  Link2,
  Loader2,
  MessageSquareText,
  PackageCheck,
  PackageMinus,
  PackagePlus,
  PackageSearch,
  Plane,
  Receipt,
  Scale,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Callout } from "@/components/admin/Callout";
import { InternalNotes } from "@/components/admin/InternalNotes";
import { useOrderDialogs, type OrderDialogs } from "@/components/admin/OrderDialogs";
import { ShipmentChooserDialog } from "@/components/admin/ShipmentChooserDialog";
import { StaffOrderDocuments } from "@/components/admin/StaffOrderDocuments";
import { StaffStatusHistory } from "@/components/admin/StaffStatusHistory";
import { CurrencyAmounts } from "@/components/portal/CurrencyAmounts";
import { JourneyProgress } from "@/components/portal/OrderTimeline";
import { DetailItem, DetailList, LoadError, Muted, Section } from "@/components/portal/Section";
import { B2bBadge, InvoiceStatusBadge, OrderStatusBadge } from "@/components/portal/StatusBadges";
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
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { adminKeys } from "@/lib/admin/keys";
import {
  adminOrderCancellationQueryOptions,
  adminOrderDocumentsQueryOptions,
  adminOrderGroupQueryOptions,
  adminOrderHistoryQueryOptions,
  adminOrderInvoicesQueryOptions,
  adminOrderQueryOptions,
  customerDisplayName,
  peopleQueryOptions,
  personName,
  toReceiveTarget,
  toStatusTarget,
  type AdminHistoryEntry,
  type AdminOrderDetail,
  type CancellationTask,
  type OrderInvoiceRow,
} from "@/lib/admin/orders";
import { removeOrdersFromShipment } from "@/lib/admin/shipments";
import {
  B2B_CUSTOMS_DOCUMENT_KINDS,
  DEFAULT_OPERATIONAL_SETTINGS,
  adminStatusesQueryOptions,
  isClosedStage,
  needsB2bCustomsWarning,
  operationalSettingsQueryOptions,
  weightAction,
  type AdminStatusMap,
  type OperationalSettings,
} from "@/lib/admin/statuses";
import { CodedError, errorMessage } from "@/lib/errors";
import { formatDate, formatDateTime, formatLbs, formatMoney, formatNumber } from "@/lib/format";
import { t, useT } from "@/lib/i18n";
import { needsPayment, unpaidByCurrency } from "@/lib/portal/invoices";
import {
  currentStatusMessage,
  orderGroupRoot,
  resolveStatus,
  type StatusStage,
} from "@/lib/portal/orders";
import { cn } from "@/lib/utils";

/**
 * /admin/orders/$id (SPEC §10, §11, §28, §35.7): everything the customer sees
 * of the order, plus the staff tools: status change (with the customer
 * message and "Klant e-mailen"), receiving, hand-over with pay_before_pickup
 * and its override, "Actie vereist", the B2B customs-documents warning, the
 * cancellation decision, internal notes, documents (upload, download,
 * delete), the full status history with staff names, packages of the same
 * purchase and the shipment it travels in.
 */
export const Route = createFileRoute("/admin/orders/$id")({
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("admin.order.heading") }) }] }),
  component: AdminOrderPage,
});

const adminRoute = getRouteApi("/admin");

function AdminOrderPage() {
  const t = useT();
  const { id } = Route.useParams();
  const { auth } = adminRoute.useRouteContext();
  const order = useQuery(adminOrderQueryOptions(auth.userId, id));
  const statuses = useQuery(adminStatusesQueryOptions(auth.userId));
  const settings = useQuery(operationalSettingsQueryOptions(auth.userId));

  const back = (
    <Link
      to="/admin/orders"
      className="mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {t("admin.order.back")}
    </Link>
  );

  if (order.isError || statuses.isError) {
    return (
      <>
        {back}
        <h1 className="sr-only">{t("admin.order.heading")}</h1>
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <LoadError
            title={t("admin.order.loadFailed")}
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
            {t("admin.order.notFoundTitle")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("admin.order.notFoundText")}</p>
        </div>
      </>
    );
  }

  return (
    <>
      {back}
      <OrderView
        key={order.data.id}
        userId={auth.userId}
        order={order.data}
        statuses={statuses.data}
        settings={settings.data ?? DEFAULT_OPERATIONAL_SETTINGS}
      />
    </>
  );
}

function OrderView({
  userId,
  order,
  statuses,
  settings,
}: {
  userId: string;
  order: AdminOrderDetail;
  statuses: AdminStatusMap;
  settings: OperationalSettings;
}) {
  const t = useT();
  const dialogs = useOrderDialogs({ userId, statuses, settings });
  const history = useQuery(adminOrderHistoryQueryOptions(userId, order.id));
  const cancellation = useQuery(adminOrderCancellationQueryOptions(userId, order.id));
  const status = resolveStatus(order.status, statuses);
  const stage = status.stage;
  const statusRow = statuses.get(order.status);
  const customer = order.customer;
  const customerUserId = customer?.user_id ?? null;
  const target = toStatusTarget(order);
  const receiveTarget = toReceiveTarget({ ...order, stage, customer });
  const weight = weightAction({ ...order, stage });

  const peopleIds = [
    order.created_by,
    order.received_by,
    order.handed_over_by,
    cancellation.data?.resolved_by ?? null,
    ...(history.data ?? []).map((h) => h.changed_by),
  ].flatMap((id) => (id && id !== customerUserId ? [id] : []));
  const people = useQuery({
    ...peopleQueryOptions(userId, peopleIds),
    enabled: peopleIds.length > 0,
  });

  return (
    <>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl text-primary tabular-nums sm:text-3xl">
            {t("admin.order.title", { reference: order.reference })}
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
          {statusRow && !statusRow.customer_visible ? (
            <Badge variant="neutral">{t("admin.order.history.hidden")}</Badge>
          ) : null}
          <span className="text-sm text-muted-foreground tabular-nums">
            {order.created_by_role === "staff"
              ? t("admin.order.createdOn", { date: formatDate(order.created_at) })
              : t("admin.order.registeredOn", { date: formatDate(order.created_at) })}
          </span>
        </div>
        {customer ? (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-foreground">
            <UserRound className="size-4 text-primary" aria-hidden />
            <span className="font-semibold">{customerDisplayName(customer)}</span>
            <span className="font-heading font-bold text-primary tabular-nums">
              {customer.customer_code}
            </span>
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={() => dialogs.changeStatus([target])}>
            <ArrowRightLeft aria-hidden />
            {t("admin.actions.changeStatus")}
          </Button>
          {weight ? (
            <Button variant="outline" onClick={() => dialogs.receive(receiveTarget)}>
              <Scale aria-hidden />
              {t(`admin.actions.${weight}`)}
            </Button>
          ) : null}
          {stage === "ready_for_pickup" ? (
            <Button variant="outline" onClick={() => dialogs.pickup([target])}>
              <PackageCheck aria-hidden />
              {t("admin.actions.pickup")}
            </Button>
          ) : null}
          {!isClosedStage(stage) && stage !== "action_required" ? (
            <Button
              variant="outline"
              onClick={() => dialogs.changeStatusTo([target], "action_required")}
            >
              <FileWarning aria-hidden />
              {t("admin.actions.requestDocuments")}
            </Button>
          ) : null}
        </div>
      </header>

      <Banners
        userId={userId}
        order={order}
        stage={stage}
        history={history.data}
        cancellation={cancellation.data ?? null}
        people={people.data}
        settings={settings}
        dialogs={dialogs}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6 xl:order-2">
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
          <InternalNotes userId={userId} customerId={order.customer_id} orderId={order.id} />
          <StaffStatusHistory
            order={order}
            statuses={statuses}
            history={history}
            people={people.data}
            customerUserId={customerUserId}
          />
        </div>

        <div className="min-w-0 space-y-6 xl:order-1">
          <CustomerSection order={order} />
          <OrderDetails order={order} people={people.data} />
          <ShipmentSection userId={userId} order={order} stage={stage} statuses={statuses} />
          <StaffOrderInvoices
            userId={userId}
            orderId={order.id}
            customerCode={customer?.customer_code ?? ""}
          />
          <StaffOrderDocuments
            userId={userId}
            customerId={order.customer_id}
            orderId={order.id}
            customerUserId={customerUserId}
            isB2b={order.order_type === "b2b"}
          />
          <StaffOrderSiblings userId={userId} order={order} statuses={statuses} />
        </div>
      </div>
      {dialogs.element}
    </>
  );
}

// ---------------------------------------------------------------------------
// Banners: cancellation request, action required, ready for pickup, B2B docs
// ---------------------------------------------------------------------------

function Banners({
  userId,
  order,
  stage,
  history,
  cancellation,
  people,
  settings,
  dialogs,
}: {
  userId: string;
  order: AdminOrderDetail;
  stage: ReturnType<typeof resolveStatus>["stage"];
  history: readonly AdminHistoryEntry[] | undefined;
  cancellation: CancellationTask | null;
  people: ReadonlyMap<string, string | null> | undefined;
  settings: OperationalSettings;
  dialogs: OrderDialogs;
}) {
  const t = useT();
  const target = toStatusTarget(order);
  const readyForPickup = stage === "ready_for_pickup";
  const invoices = useQuery({
    ...adminOrderInvoicesQueryOptions(userId, order.id),
    enabled: readyForPickup,
  });
  const unpaid = invoices.data
    ? unpaidByCurrency(invoices.data.filter((i) => i.status !== "draft"))
    : [];
  const documents = useQuery({
    ...adminOrderDocumentsQueryOptions(userId, order.id),
    enabled: order.order_type === "b2b",
  });
  const missingCustoms =
    documents.data !== undefined &&
    needsB2bCustomsWarning({
      orderType: order.order_type,
      fromStage: stage,
      toStage: "at_customs",
      hasCustomsDocuments: documents.data.some((d) =>
        (B2B_CUSTOMS_DOCUMENT_KINDS as readonly string[]).includes(d.kind),
      ),
    }) &&
    !isClosedStage(stage);
  const message = history ? currentStatusMessage(history, order.status) : null;
  const openRequest = cancellation && !cancellation.resolved_at && stage !== "cancelled";
  const keptRequest =
    cancellation?.resolved_at && order.cancellation_requested_at && stage !== "cancelled";

  return (
    <div className="mb-6 space-y-4 empty:hidden">
      {openRequest && order.cancellation_requested_at ? (
        <Callout
          as="section"
          tone="warning"
          icon={Ban}
          title={t("admin.order.cancellation.title")}
          actions={
            <>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => dialogs.changeStatusTo([target], "cancelled")}
              >
                <Ban aria-hidden />
                {t("admin.order.cancellation.cancel")}
              </Button>
              <KeepOrderButton userId={userId} order={order} task={cancellation} />
            </>
          }
        >
          <p>
            {t("admin.order.cancellation.text", {
              date: formatDateTime(order.cancellation_requested_at),
            })}
          </p>
        </Callout>
      ) : null}
      {keptRequest && cancellation?.resolved_at && order.cancellation_requested_at ? (
        <Callout tone="neutral" icon={CheckCircle2} title={t("admin.order.cancellation.title")}>
          <p>
            {cancellation.resolved_by
              ? t("admin.order.cancellation.decidedBy", {
                  date: formatDateTime(order.cancellation_requested_at),
                  resolvedAt: formatDateTime(cancellation.resolved_at),
                  name: personName(cancellation.resolved_by, people, null),
                })
              : t("admin.order.cancellation.decided", {
                  date: formatDateTime(order.cancellation_requested_at),
                  resolvedAt: formatDateTime(cancellation.resolved_at),
                })}
          </p>
        </Callout>
      ) : null}

      {stage === "action_required" ? (
        <Callout
          as="section"
          tone="warning"
          icon={TriangleAlert}
          title={t("admin.order.actionRequired.title")}
          actions={
            <Button
              variant="outline"
              size="sm"
              className="bg-card"
              onClick={() => dialogs.changeStatus([target], order.status)}
            >
              <MessageSquareText aria-hidden />
              {t("admin.actions.newMessage")}
            </Button>
          }
        >
          {message ? (
            <>
              <p>{t("admin.order.actionRequired.text")}</p>
              <p className="mt-2 whitespace-pre-line break-words rounded-md border border-warning/30 bg-card px-3 py-2">
                {message}
              </p>
            </>
          ) : (
            <p>{t("admin.order.actionRequired.noMessage")}</p>
          )}
        </Callout>
      ) : null}

      {readyForPickup ? (
        <Callout
          as="section"
          tone={unpaid.length === 0 ? "success" : settings.pay_before_pickup ? "danger" : "warning"}
          icon={unpaid.length === 0 ? PackageCheck : CircleDollarSign}
          title={
            unpaid.length === 0
              ? t("admin.order.pickup.title")
              : t("admin.order.pickup.titleUnpaid")
          }
        >
          {invoices.isError ? (
            <LoadError
              title={t("portal.order.invoices.loadFailed")}
              error={invoices.error}
              onRetry={() => void invoices.refetch()}
            />
          ) : invoices.isPending ? (
            <Skeleton className="h-5 w-48" />
          ) : unpaid.length > 0 ? (
            <p>
              <span className="font-semibold">{t("admin.order.pickup.unpaid")}</span>{" "}
              <CurrencyAmounts amounts={unpaid} />
              {settings.pay_before_pickup ? (
                <span className="block text-muted-foreground">
                  {t("admin.order.pickup.payFirst")}
                </span>
              ) : null}
            </p>
          ) : (
            <p>{t("admin.order.pickup.paid")}</p>
          )}
        </Callout>
      ) : null}

      {order.order_type === "b2b" && missingCustoms ? (
        <Callout
          as="section"
          tone="warning"
          icon={Briefcase}
          title={t("admin.order.b2bDocs.title")}
        >
          <p>{t("admin.order.b2bDocs.text")}</p>
        </Callout>
      ) : null}
    </div>
  );
}

/**
 * "Order behouden": the cancellation request is decided against; its staff
 * task is resolved (the database records who and when). The order keeps its
 * cancellation_requested_at: no client may clear it (PROGRESS.md).
 */
function KeepOrderButton({
  userId,
  order,
  task,
}: {
  userId: string;
  order: AdminOrderDetail;
  task: CancellationTask;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const keep = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("staff_tasks")
        .update({ resolved_at: new Date().toISOString() })
        .eq("id", task.id)
        .is("resolved_at", null)
        .select("id")
        .single();
      if (error) throw error;
    },
    onSuccess: async () => {
      setOpen(false);
      toast.success(t("admin.order.cancellation.kept"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.orders(userId) }),
        queryClient.invalidateQueries({ queryKey: adminKeys.tasks(userId) }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <AlertDialog open={open} onOpenChange={(next) => !keep.isPending && setOpen(next)}>
      <Button variant="outline" size="sm" className="bg-card" onClick={() => setOpen(true)}>
        <CheckCircle2 aria-hidden />
        {t("admin.order.cancellation.keep")}
      </Button>
      <AlertDialogContent className="w-[calc(100%-2rem)] rounded-lg bg-card">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-heading text-primary">
            {t("admin.order.cancellation.keepTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("admin.order.cancellation.keepText", { reference: order.reference })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel disabled={keep.isPending}>
            {t("admin.status.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={keep.isPending}
            onClick={(e) => {
              e.preventDefault();
              keep.mutate();
            }}
          >
            {keep.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {keep.isPending
              ? t("admin.order.cancellation.keeping")
              : t("admin.order.cancellation.keepConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Customer and order fields
// ---------------------------------------------------------------------------

function Value({ value, empty }: { value: ReactNode; empty?: string }) {
  const t = useT();
  return value === null || value === undefined || value === "" ? (
    <Muted>{empty ?? t("portal.order.notProvided")}</Muted>
  ) : (
    <>{value}</>
  );
}

function CustomerSection({ order }: { order: AdminOrderDetail }) {
  const t = useT();
  const customer = order.customer;
  if (!customer) return null;
  return (
    <Section title={t("admin.order.sections.customer")} icon={UserRound} id="order-customer">
      <DetailList>
        <DetailItem label={t("admin.order.fields.customerName")}>
          {/* /admin/klanten/$id arrives in P5; until then the name is plain text. */}
          <span className="font-semibold">{customer.full_name}</span>
        </DetailItem>
        <DetailItem label={t("admin.order.fields.customerCode")}>
          <span className="font-heading font-bold text-primary tabular-nums">
            {customer.customer_code}
          </span>
        </DetailItem>
        {customer.company_name ? (
          <DetailItem label={t("admin.order.fields.company")}>{customer.company_name}</DetailItem>
        ) : null}
        <DetailItem label={t("admin.order.fields.phone")}>
          {customer.phone ? (
            <a
              href={`tel:${customer.phone.replace(/[^\d+]/g, "")}`}
              className="text-primary underline-offset-4 hover:underline tabular-nums"
            >
              {customer.phone}
            </a>
          ) : (
            <Muted>{t("portal.order.notProvided")}</Muted>
          )}
        </DetailItem>
        <DetailItem label={t("admin.order.fields.email")}>
          <span className="break-all">
            <Value value={customer.email} />
          </span>
        </DetailItem>
        <DetailItem label={t("admin.order.fields.login")}>
          {customer.user_id ? t("admin.order.fields.hasLogin") : t("admin.order.fields.noLogin")}
        </DetailItem>
        <DetailItem label={t("admin.order.fields.customerStatus")}>
          {t(`admin.order.customerStatuses.${customer.status}`)}
        </DetailItem>
      </DetailList>
    </Section>
  );
}

function OrderDetails({
  order,
  people,
}: {
  order: AdminOrderDetail;
  people: ReadonlyMap<string, string | null> | undefined;
}) {
  const t = useT();
  const customerUserId = order.customer?.user_id ?? null;
  return (
    <>
      <Section title={t("portal.order.sections.details")} icon={ClipboardList} id="order-details">
        <DetailList>
          <DetailItem label={t("portal.order.fields.reference")}>
            <span className="font-semibold tabular-nums">{order.reference}</span>
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
          <DetailItem label={t("admin.order.fields.createdBy")}>
            {order.created_by_role === "customer"
              ? t("admin.order.createdByCustomer")
              : t("admin.order.byStaffName", {
                  name: personName(order.created_by, people, customerUserId),
                })}
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
            <span className="font-semibold tabular-nums">
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
        <Section title={t("portal.order.sections.b2b")} icon={Briefcase} id="order-b2b">
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
          <DetailItem label={t("portal.order.fields.receivedAt")}>
            {order.received_at ? (
              <span className="tabular-nums">
                {formatDateTime(order.received_at)}
                {order.received_by
                  ? ` · ${t("admin.order.history.by", {
                      name: personName(order.received_by, people, customerUserId),
                    })}`
                  : ""}
              </span>
            ) : (
              <Muted>{t("admin.order.notReceived")}</Muted>
            )}
          </DetailItem>
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
          {order.handed_over_by ? (
            <DetailItem label={t("admin.order.fields.handedOverBy")}>
              {personName(order.handed_over_by, people, customerUserId)}
            </DetailItem>
          ) : null}
          {order.cancellation_requested_at ? (
            <DetailItem label={t("portal.orders.cancellationRequested")}>
              <span className="tabular-nums">
                {formatDateTime(order.cancellation_requested_at)}
              </span>
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
    </>
  );
}

/**
 * The shipment the order travels in (SPEC §35.7), with "Aan zending
 * toevoegen" / "Uit zending halen" (orders.shipment_id, a staff-editable
 * column; same rules as on the shipment page).
 */
function ShipmentSection({
  userId,
  order,
  stage,
  statuses,
}: {
  userId: string;
  order: AdminOrderDetail;
  stage: StatusStage | null;
  statuses: AdminStatusMap;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const shipment = order.shipment;
  const [choosing, setChoosing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const remove = useMutation({
    mutationFn: async (shipmentId: string) => {
      const result = await removeOrdersFromShipment(supabase, shipmentId, [order.id]);
      if (result.done.length === 0) throw new CodedError(t("apiError.notFound"), "P0002");
    },
    onSuccess: async () => {
      toast.success(
        t("admin.order.shipment.removed", {
          reference: order.reference,
          number: shipment?.shipment_number ?? "",
        }),
      );
      setConfirmRemove(false);
      await queryClient.invalidateQueries({ queryKey: adminKeys.orders(userId) });
    },
    onError: (e) => toast.error(`${t("admin.shipments.detail.removeFailed")} ${errorMessage(e)}`),
  });

  return (
    <Section
      title={t("admin.order.shipment.title")}
      icon={Plane}
      id="order-shipment"
      actions={
        shipment ? (
          <Button variant="outline" size="sm" onClick={() => setConfirmRemove(true)}>
            <PackageMinus aria-hidden />
            {t("admin.order.shipment.remove")}
          </Button>
        ) : !isClosedStage(stage) ? (
          <Button variant="outline" size="sm" onClick={() => setChoosing(true)}>
            <PackagePlus aria-hidden />
            {t("admin.order.shipment.add")}
          </Button>
        ) : null
      }
    >
      {shipment ? (
        <>
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
              <DetailItem label={t("admin.shipments.form.customerNote")}>
                <span className="whitespace-pre-line">{shipment.customer_note}</span>
              </DetailItem>
            ) : null}
          </DetailList>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to="/admin/zendingen/$id" params={{ id: shipment.id }}>
              <Plane aria-hidden />
              {t("admin.order.shipment.open", { number: shipment.shipment_number })}
            </Link>
          </Button>
          <AlertDialog
            open={confirmRemove}
            onOpenChange={(next) => !remove.isPending && setConfirmRemove(next)}
          >
            <AlertDialogContent className="w-[calc(100%-2rem)] rounded-lg">
              <AlertDialogHeader>
                <AlertDialogTitle>{t("admin.order.shipment.removeTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("admin.order.shipment.removeText", {
                    reference: order.reference,
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
                    remove.mutate(shipment.id);
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
      ) : (
        <p className="text-sm text-muted-foreground">{t("admin.order.shipment.none")}</p>
      )}
      <ShipmentChooserDialog
        userId={userId}
        orders={[{ ...order, stage }]}
        statuses={statuses}
        open={choosing}
        onOpenChange={setChoosing}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Invoices (read-only until P6/P7)
// ---------------------------------------------------------------------------

function StaffOrderInvoices({
  userId,
  orderId,
  customerCode,
}: {
  userId: string;
  orderId: string;
  customerCode: string;
}) {
  const t = useT();
  const invoices = useQuery(adminOrderInvoicesQueryOptions(userId, orderId));
  return (
    <Section
      title={t("portal.order.invoices.title")}
      icon={Receipt}
      id="order-invoices"
      description={t("admin.order.invoices.intro")}
    >
      {invoices.isError ? (
        <LoadError
          title={t("portal.order.invoices.loadFailed")}
          error={invoices.error}
          onRetry={() => void invoices.refetch()}
        />
      ) : invoices.isPending ? (
        <Skeleton className="h-12 w-full" />
      ) : invoices.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("portal.order.invoices.empty")}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {invoices.data.map((invoice) => (
            <InvoiceRow key={invoice.id} invoice={invoice} customerCode={customerCode} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function InvoiceRow({ invoice, customerCode }: { invoice: OrderInvoiceRow; customerCode: string }) {
  const t = useT();
  const money = (amount: number | null) =>
    amount !== null && invoice.currency ? formatMoney(amount, invoice.currency) : "";
  return (
    <li className="grid gap-2 px-3 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold tabular-nums">
            {invoice.invoice_number ?? t("admin.order.invoices.draft")}
          </span>
          <InvoiceStatusBadge invoice={invoice} />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {invoice.invoice_date ? formatDate(invoice.invoice_date) : ""}
          {invoice.due_date
            ? ` · ${t("portal.order.invoices.dueDate")}: ${formatDate(invoice.due_date)}`
            : ""}
        </p>
        {needsPayment(invoice) && invoice.invoice_number && invoice.currency ? (
          <p className="mt-0.5 break-words text-xs text-muted-foreground tabular-nums">
            {t("portal.order.invoices.payHint", {
              currency: invoice.currency,
              number: invoice.invoice_number,
              code: customerCode,
            })}
          </p>
        ) : null}
      </div>
      <dl className="grid grid-cols-[auto_auto] gap-x-3 text-right tabular-nums">
        <dt className="text-muted-foreground">{t("portal.order.invoices.amount")}</dt>
        <dd className="whitespace-nowrap">{money(invoice.total_amount)}</dd>
        <dt className="text-muted-foreground">{t("portal.order.invoices.balance")}</dt>
        <dd className="whitespace-nowrap font-semibold">{money(invoice.balance_due)}</dd>
      </dl>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Packages of the same purchase (parent/child)
// ---------------------------------------------------------------------------

function StaffOrderSiblings({
  userId,
  order,
  statuses,
}: {
  userId: string;
  order: AdminOrderDetail;
  statuses: AdminStatusMap;
}) {
  const t = useT();
  const rootId = orderGroupRoot(order);
  const group = useQuery(adminOrderGroupQueryOptions(userId, rootId));
  const root = group.data?.find((o) => o.id === rootId);
  const canAdd = group.isSuccess && root && statuses.get(root.status)?.stage !== "cancelled";
  return (
    <Section
      title={t("portal.order.siblings.title")}
      icon={Boxes}
      id="order-siblings"
      description={t("admin.order.siblings.intro")}
    >
      {group.isError ? (
        <LoadError
          title={t("portal.order.siblings.loadFailed")}
          error={group.error}
          onRetry={() => void group.refetch()}
        />
      ) : group.isPending ? (
        <Skeleton className="h-12 w-full" />
      ) : (
        <div className="space-y-4">
          {group.data.length > 1 ? (
            <ul className="divide-y rounded-md border">
              {group.data.map((o) => {
                const current = o.id === order.id;
                return (
                  <li
                    key={o.id}
                    className={cn(
                      "flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm",
                      current && "bg-cream/50",
                    )}
                  >
                    <div className="min-w-0">
                      {current ? (
                        <span className="font-heading font-bold text-foreground tabular-nums">
                          {o.reference}
                        </span>
                      ) : (
                        <Link
                          to="/admin/orders/$id"
                          params={{ id: o.id }}
                          className="rounded-sm font-heading font-bold text-primary tabular-nums underline-offset-4 hover:underline"
                        >
                          {o.reference}
                        </Link>
                      )}
                      <span className="ml-2 inline-flex flex-wrap gap-1.5 align-middle">
                        <Badge variant="outline">
                          {o.id === rootId
                            ? t("portal.order.siblings.main")
                            : t("portal.order.siblings.extra")}
                        </Badge>
                        {current ? (
                          <Badge variant="secondary">{t("portal.order.siblings.current")}</Badge>
                        ) : null}
                      </span>
                      {o.tracking_number ? (
                        <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums [overflow-wrap:anywhere]">
                          {o.tracking_number}
                        </span>
                      ) : null}
                    </div>
                    <OrderStatusBadge status={resolveStatus(o.status, statuses)} />
                  </li>
                );
              })}
            </ul>
          ) : null}
          {canAdd ? (
            <Button asChild variant="outline">
              <Link to="/admin/orders/nieuw" search={{ parent: rootId }}>
                <PackagePlus aria-hidden />
                {t("admin.order.siblings.add")}
              </Link>
            </Button>
          ) : null}
        </div>
      )}
    </Section>
  );
}
