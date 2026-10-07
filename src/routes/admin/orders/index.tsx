import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router";
import {
  ArrowRightLeft,
  Ban,
  CheckCircle2,
  Copy,
  FilePlus2,
  Link2,
  PackageCheck,
  PackagePlus,
  PackageSearch,
  Plane,
  Scale,
  Search,
  TriangleAlert,
  XCircle,
} from "lucide-react";

import { Callout } from "@/components/admin/Callout";
import { ExportCsvButton } from "@/components/admin/ExportCsvButton";
import { InvoiceSummary, PaymentSummary } from "@/components/admin/OrderBilling";
import { useOrderDialogs, type OrderDialogs } from "@/components/admin/OrderDialogs";
import { OrderRowActions } from "@/components/admin/OrderRowActions";
import { SelectionBar } from "@/components/admin/SelectionBar";
import { ShipmentChooserDialog } from "@/components/admin/ShipmentChooserDialog";
import { ShellPageHeader } from "@/components/layout/AppShell";
import { LoadError, Muted } from "@/components/portal/Section";
import { B2bBadge, OrderStatusBadge } from "@/components/portal/StatusBadges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  ADMIN_ORDER_SORTS,
  adminOrderSearchSchema,
  adminOrdersQueryOptions,
  buildOrderViews,
  customerDisplayName,
  exactTrackingMatches,
  filterAdminOrders,
  hasAdminFilters,
  normalizeTracking,
  openCancellationTasksQueryOptions,
  orderBillingQueryOptions,
  parseCustomerCode,
  toReceiveTarget,
  toStatusTarget,
  type AdminOrderSearch,
  type AdminOrderView,
} from "@/lib/admin/orders";
import { exportOrders } from "@/lib/admin/exports";
import { newInvoiceSearch } from "@/lib/admin/invoice-builder";
import {
  DEFAULT_OPERATIONAL_SETTINGS,
  adminStatusesQueryOptions,
  operationalSettingsQueryOptions,
  weightAction,
  type AdminStatusMap,
} from "@/lib/admin/statuses";
import { formatDate, formatNumber } from "@/lib/format";
import { t, useT } from "@/lib/i18n";
import { paths } from "@/lib/paths";
import { ORDER_STAGE_FILTERS, resolveStatus } from "@/lib/portal/orders";
import { cn } from "@/lib/utils";

/**
 * /admin/orders (SPEC §21, §26, §35.7): the central operational view of every
 * customer's orders. A prominent search for a tracking number (however it is
 * typed or scanned), GR code, reference or customer; filters and sort in the
 * URL; a table from 1280 px, cards below; per-row actions and a bulk status
 * change for a selection. Invoice and payment columns show the existing
 * invoices; "Genereer factuur" opens the builder for a selection of one
 * customer's orders.
 */
export const Route = createFileRoute("/admin/orders/")({
  validateSearch: (search: Record<string, unknown>): AdminOrderSearch =>
    adminOrderSearchSchema.parse(search),
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("admin.orders.title") }) }] }),
  component: AdminOrdersPage,
});

const adminRoute = getRouteApi("/admin");
const ALL = "all";

function AdminOrdersPage() {
  const t = useT();
  const { auth } = adminRoute.useRouteContext();
  const search = Route.useSearch();
  const orders = useQuery(adminOrdersQueryOptions(auth.userId));
  const statuses = useQuery(adminStatusesQueryOptions(auth.userId));
  const settings = useQuery(operationalSettingsQueryOptions(auth.userId));
  const billing = useQuery(orderBillingQueryOptions(auth.userId));
  const cancellations = useQuery(openCancellationTasksQueryOptions(auth.userId));

  const header = (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <ShellPageHeader
        title={t("admin.orders.title")}
        description={t("admin.orders.intro")}
        className="mb-0"
      />
      <Button asChild className="self-start">
        <Link to="/admin/orders/nieuw">
          <PackagePlus aria-hidden />
          {t("admin.orders.newOrder")}
        </Link>
      </Button>
    </div>
  );

  if (orders.isError || statuses.isError) {
    return (
      <>
        {header}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <LoadError
            title={t("admin.orders.loadFailed")}
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
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <OrdersBoard
        userId={auth.userId}
        isAdmin={auth.role === "admin"}
        search={search}
        views={buildOrderViews(orders.data, statuses.data, billing.data, cancellations.data)}
        statuses={statuses.data}
        settings={settings.data ?? DEFAULT_OPERATIONAL_SETTINGS}
        billingUnknown={!billing.data}
        cancellationsUnknown={!cancellations.data}
        sideErrors={
          billing.isError || cancellations.isError ? (
            <div className="mb-4 rounded-lg border bg-card p-4 shadow-sm">
              <LoadError
                title={t("admin.orders.billingLoadFailed")}
                error={billing.error ?? cancellations.error}
                onRetry={() => {
                  if (billing.isError) void billing.refetch();
                  if (cancellations.isError) void cancellations.refetch();
                }}
              />
            </div>
          ) : null
        }
      />
    </>
  );
}

function OrdersBoard({
  userId,
  isAdmin,
  search,
  views,
  statuses,
  settings,
  billingUnknown,
  cancellationsUnknown,
  sideErrors,
}: {
  userId: string;
  /** "Exporteer CSV" is for admins (SPEC §35.15). */
  isAdmin: boolean;
  search: AdminOrderSearch;
  views: AdminOrderView[];
  statuses: AdminStatusMap;
  settings: typeof DEFAULT_OPERATIONAL_SETTINGS;
  /** Invoices / cancellation tasks not loaded (yet): their filters cannot answer. */
  billingUnknown: boolean;
  cancellationsUnknown: boolean;
  sideErrors: ReactNode;
}) {
  const t = useT();
  const dialogs = useOrderDialogs({ userId, statuses, settings });
  const searchRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [choosing, setChoosing] = useState(false);
  const visible = useMemo(
    () => filterAdminOrders(views, statuses, search),
    [views, statuses, search],
  );
  const filtered = hasAdminFilters(search);
  const selectedVisible = visible.filter((o) => selected.has(o.id));

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const allSelected = visible.length > 0 && selectedVisible.length === visible.length;
  const toggleAll = (on: boolean) =>
    setSelected(on ? new Set(visible.map((o) => o.id)) : new Set());

  if (views.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-lg border bg-card p-6 shadow-sm">
        <div>
          <h2 className="text-lg text-foreground">{t("admin.orders.emptyTitle")}</h2>
          <p className="mt-1 max-w-prose text-sm leading-6 text-muted-foreground">
            {t("admin.orders.emptyText")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Filters
        search={search}
        inputRef={searchRef}
        billingUnknown={billingUnknown}
        cancellationsUnknown={cancellationsUnknown}
        findings={
          // Right under the search field: on a phone the result and its
          // "Ontvangen" button must not sit below the filters (P4 review).
          <SearchFindings
            search={search}
            views={views}
            visible={visible}
            statuses={statuses}
            dialogs={dialogs}
            searchRef={searchRef}
          />
        }
      />
      {sideErrors}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
          {t(views.length === 1 ? "admin.orders.resultCountOne" : "admin.orders.resultCount", {
            count: formatNumber(visible.length, 0),
            total: formatNumber(views.length, 0),
          })}
        </p>
        {isAdmin && visible.length > 0 ? (
          <ExportCsvButton
            scope={t("admin.exports.scopeFiltered", { count: formatNumber(visible.length, 0) })}
            options={[
              {
                label: t("admin.exports.what.orders"),
                run: () => exportOrders({ ids: visible.map((o) => o.id) }),
              },
            ]}
          />
        ) : null}
      </div>
      {visible.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6 shadow-sm">
          <p className="text-sm text-foreground">{t("admin.orders.noResults")}</p>
          {filtered ? <ClearFiltersButton /> : null}
        </div>
      ) : (
        <>
          <OrdersTable
            orders={visible}
            statuses={statuses}
            selected={selected}
            allSelected={allSelected}
            onToggle={toggle}
            onToggleAll={toggleAll}
            dialogs={dialogs}
          />
          <OrderCards
            orders={visible}
            statuses={statuses}
            selected={selected}
            allSelected={allSelected}
            onToggle={toggle}
            onToggleAll={toggleAll}
            dialogs={dialogs}
          />
          <SelectionBar label={t("admin.orders.bulkStatus")} count={selectedVisible.length}>
            <Button
              size="sm"
              onClick={() => dialogs.changeStatus(selectedVisible.map(toStatusTarget))}
            >
              <ArrowRightLeft aria-hidden />
              {t("admin.orders.bulkStatus")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setChoosing(true)}>
              <Plane aria-hidden />
              {t("admin.order.shipment.add")}
            </Button>
            <GenerateInvoiceButton orders={selectedVisible} />
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              {t("admin.orders.clearSelection")}
            </Button>
          </SelectionBar>
        </>
      )}
      {dialogs.element}
      <ShipmentChooserDialog
        userId={userId}
        orders={selectedVisible}
        statuses={statuses}
        open={choosing}
        onOpenChange={setChoosing}
        onDone={() => setSelected(new Set())}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Search, filters and sort (kept in the URL)
// ---------------------------------------------------------------------------

function useSetSearch() {
  const navigate = useNavigate({ from: Route.fullPath });
  return (patch: Partial<AdminOrderSearch>) =>
    void navigate({
      search: (prev) => {
        const next: AdminOrderSearch = { ...prev, ...patch };
        // Defaults stay out of the URL.
        for (const key of Object.keys(next) as (keyof AdminOrderSearch)[]) {
          if (next[key] === undefined) delete next[key];
        }
        if (next.sort === "newest") delete next.sort;
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
          stage: undefined,
          type: undefined,
          openInvoice: undefined,
          cancellation: undefined,
          awaitingReceipt: undefined,
        })
      }
    >
      <XCircle aria-hidden />
      {t("admin.orders.clearFilters")}
    </Button>
  );
}

const FLAGS = ["awaitingReceipt", "openInvoice", "cancellation"] as const;

function Filters({
  search,
  inputRef,
  findings,
  billingUnknown,
  cancellationsUnknown,
}: {
  search: AdminOrderSearch;
  inputRef: RefObject<HTMLInputElement | null>;
  /** The scan result, shown right under the search field. */
  findings: ReactNode;
  billingUnknown: boolean;
  cancellationsUnknown: boolean;
}) {
  const t = useT();
  const id = useId();
  const setSearch = useSetSearch();
  const [query, setQuery] = useState(search.q ?? "");
  const selectOnMouseUp = useRef(false);

  // Ready for the scanner on arrival (desktop: a phone would pop its keyboard).
  useEffect(() => {
    const idle = !document.activeElement || document.activeElement === document.body;
    if (idle && window.matchMedia?.("(pointer: fine)").matches) inputRef.current?.focus();
  }, [inputRef]);

  // Typing updates the URL after a short pause, Enter (a scanner's last key)
  // at once; a change from outside (e.g. "Filters wissen") updates the field.
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
    <div role="search" className="mb-4 space-y-4 rounded-lg border bg-card p-4 shadow-sm">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-q`} className="text-base font-semibold text-primary">
          {t("admin.orders.search")}
        </Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={inputRef}
            id={`${id}-q`}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // A new scan replaces the previous number instead of appending to it:
            // select it on focus, and keep the click that focused the field from
            // putting the caret back (the mouseup would undo the selection).
            onFocus={(e) => {
              selectOnMouseUp.current = true;
              e.currentTarget.select();
            }}
            onMouseUp={(e) => {
              if (!selectOnMouseUp.current) return;
              selectOnMouseUp.current = false;
              e.preventDefault();
            }}
            onBlur={() => {
              selectOnMouseUp.current = false;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setSearch({ q: query.trim() || undefined });
              }
            }}
            placeholder={t("admin.orders.searchPlaceholder")}
            className="h-12 pl-10 text-base md:text-base"
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>

      {findings}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-stage`}>{t("admin.orders.stageFilter")}</Label>
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
              <SelectItem value={ALL}>{t("admin.orders.allStages")}</SelectItem>
              {ORDER_STAGE_FILTERS.map((stage) => (
                <SelectItem key={stage} value={stage}>
                  {t(`portal.stages.${stage}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-type`}>{t("admin.orders.typeFilter")}</Label>
          <Select
            value={search.type ?? ALL}
            onValueChange={(v) =>
              setSearch({
                type:
                  v === ALL ? undefined : Constants.public.Enums.order_type.find((o) => o === v),
              })
            }
          >
            <SelectTrigger id={`${id}-type`} className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("admin.orders.allTypes")}</SelectItem>
              {Constants.public.Enums.order_type.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(`portal.orderTypes.${type}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-sort`}>{t("admin.orders.sort")}</Label>
          <Select
            value={search.sort ?? "newest"}
            onValueChange={(v) => setSearch({ sort: ADMIN_ORDER_SORTS.find((s) => s === v) })}
          >
            <SelectTrigger id={`${id}-sort`} className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ADMIN_ORDER_SORTS.map((sort) => (
                <SelectItem key={sort} value={sort}>
                  {t(`admin.orders.sorts.${sort}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground" id={`${id}-flags`}>
          {t("admin.orders.onlyShow")}
        </span>
        <div role="group" aria-labelledby={`${id}-flags`} className="flex flex-wrap gap-2">
          {FLAGS.map((flag) => {
            const on = search[flag] === true;
            // Without the invoices / tasks the filter could only answer "none".
            const unknown =
              (flag === "openInvoice" && billingUnknown) ||
              (flag === "cancellation" && cancellationsUnknown);
            return (
              <Button
                key={flag}
                type="button"
                size="sm"
                variant={on ? "default" : "outline"}
                aria-pressed={on}
                disabled={unknown && !on}
                title={unknown ? t("admin.orders.billingUnknownHint") : undefined}
                onClick={() => setSearch({ [flag]: on ? undefined : true })}
              >
                {on ? <CheckCircle2 aria-hidden /> : null}
                {t(`admin.orders.flags.${flag}`)}
              </Button>
            );
          })}
        </div>
        {hasAdminFilters(search) ? (
          <div className="ml-auto">
            <ClearFiltersButton />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Receiving (SPEC §35.7): a scanned or typed tracking number that matches
 * exactly one order shows its status and offers the next step right here
 * ("Ontvangen", "Status wijzigen", "Afgeven"); two orders sharing it get a
 * warning; no match offers "Order aanmaken voor klant" with the number. After
 * receiving, the field is cleared and focused for the next scan.
 */
function SearchFindings({
  search,
  views,
  visible,
  statuses,
  dialogs,
  searchRef,
}: {
  search: AdminOrderSearch;
  views: AdminOrderView[];
  visible: AdminOrderView[];
  statuses: AdminStatusMap;
  dialogs: OrderDialogs;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  const t = useT();
  const setSearch = useSetSearch();
  const q = search.q ?? "";
  if (!q) return null;
  const matches = exactTrackingMatches(views, q);
  const tracking = normalizeTracking(q);
  // Back to the scan field after a dialog from here, its text selected for the next scan.
  const scanFocus = { returnFocus: () => searchRef.current };

  if (matches.length === 1 && matches[0]) {
    const order = matches[0];
    const weight = weightAction(order);
    const stage = order.stage;
    const note =
      stage === "cancelled"
        ? t("admin.orders.found.cancelled")
        : stage === "completed"
          ? t("admin.orders.found.completed")
          : weight === "receive"
            ? null
            : stage === "us_warehouse"
              ? t("admin.orders.found.inWarehouse")
              : t("admin.orders.found.oneReceived");
    return (
      <Callout
        tone={stage === "cancelled" ? "warning" : "success"}
        icon={stage === "cancelled" ? Ban : PackageSearch}
        title={t("admin.orders.found.oneTitle", {
          reference: order.reference,
          customer: order.customer
            ? `${customerDisplayName(order.customer)} (${order.customer.customer_code})`
            : "–",
        })}
        actions={
          <>
            {weight ? (
              <Button
                size="sm"
                variant={weight === "receive" ? "default" : "outline"}
                className={weight === "receive" ? undefined : "bg-card"}
                onClick={() =>
                  dialogs.receive(toReceiveTarget(order), {
                    ...scanFocus,
                    // Received: clear the field for the next parcel.
                    onDone: () => setSearch({ q: undefined }),
                  })
                }
              >
                <Scale aria-hidden />
                {t(`admin.actions.${weight}`)}
              </Button>
            ) : null}
            {stage === "ready_for_pickup" ? (
              <Button size="sm" onClick={() => dialogs.pickup([toStatusTarget(order)], scanFocus)}>
                <PackageCheck aria-hidden />
                {t("admin.actions.pickup")}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              className="bg-card"
              onClick={() => dialogs.changeStatus([toStatusTarget(order)], null, null, scanFocus)}
            >
              <ArrowRightLeft aria-hidden />
              {t("admin.actions.changeStatus")}
            </Button>
            <Button size="sm" variant="outline" className="bg-card" asChild>
              <Link to="/admin/orders/$id" params={{ id: order.id }}>
                {t("admin.actions.open")}
              </Link>
            </Button>
          </>
        }
      >
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="sr-only">{t("admin.orders.columns.status")}:</span>
          <OrderStatusBadge status={resolveStatus(order.status, statuses)} />
        </div>
        {note ? <p className="mt-1.5">{note}</p> : null}
      </Callout>
    );
  }

  if (matches.length > 1) {
    return (
      <Callout
        tone="warning"
        icon={Copy}
        title={t("admin.orders.found.manyTitle", {
          count: matches.length,
          tracking: q.trim(),
        })}
      >
        <p>{t("admin.orders.found.manyText")}</p>
      </Callout>
    );
  }

  const looksLikeTracking =
    tracking.length >= 8 && /\d/.test(tracking) && parseCustomerCode(q) === null;
  if (visible.length === 0 && looksLikeTracking) {
    return (
      <Callout
        tone="info"
        icon={PackageSearch}
        title={t("admin.orders.found.noneTitle", { tracking: q.trim() })}
        actions={
          <Button size="sm" asChild>
            <Link to="/admin/orders/nieuw" search={{ tracking: q.trim() }}>
              <PackagePlus aria-hidden />
              {t("admin.orders.newOrder")}
            </Link>
          </Button>
        }
      >
        <p>{t("admin.orders.found.noneText")}</p>
      </Callout>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Results: a table from xl (1280 px), cards below (SPEC §25, §35.14)
// ---------------------------------------------------------------------------

interface ResultProps {
  orders: AdminOrderView[];
  statuses: AdminStatusMap;
  selected: ReadonlySet<string>;
  allSelected: boolean;
  onToggle: (id: string, on: boolean) => void;
  onToggleAll: (on: boolean) => void;
  dialogs: OrderDialogs;
}

function OrderMarkers({ order }: { order: AdminOrderView }) {
  const t = useT();
  if (!order.parent_order_id && !order.cancellationTask && order.created_by_role !== "staff") {
    return null;
  }
  return (
    <span className="mt-1 flex flex-wrap gap-1.5">
      {order.parent_order_id ? (
        <Badge variant="outline">
          <Link2 className="size-3.5 shrink-0" aria-hidden />
          {t("portal.orders.extraPackage")}
        </Badge>
      ) : null}
      {order.cancellationTask ? (
        <Badge variant="warning">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          {t("portal.orders.cancellationRequested")}
        </Badge>
      ) : null}
      {order.created_by_role === "staff" ? (
        <Badge variant="neutral">{t("admin.orders.createdByStaff")}</Badge>
      ) : null}
    </span>
  );
}

function CustomerCell({ order }: { order: AdminOrderView }) {
  const t = useT();
  if (!order.customer) return <Muted>–</Muted>;
  return (
    <>
      <Link
        to="/admin/klanten/$id"
        params={{ id: order.customer.id }}
        className="block break-words font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline"
      >
        {order.customer.account_type === "business" && order.customer.company_name
          ? order.customer.company_name
          : order.customer.full_name}
      </Link>
      {order.customer.account_type === "business" && order.customer.company_name ? (
        <span className="block break-words text-xs text-muted-foreground">
          {order.customer.full_name}
        </span>
      ) : null}
      <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
        <span className="font-heading text-xs font-bold text-primary tabular-nums">
          {order.customer.customer_code}
        </span>
        {order.customer.user_id ? null : (
          <Badge variant="outline" className="px-1.5 py-0 text-[0.7rem]">
            {t("admin.orders.noLogin")}
          </Badge>
        )}
      </span>
    </>
  );
}

function TrackingCell({ order }: { order: AdminOrderView }) {
  const t = useT();
  if (!order.tracking_number) {
    return (
      <span className="whitespace-nowrap">
        <Muted>{t("admin.orders.trackingUnknown")}</Muted>
      </span>
    );
  }
  return (
    <>
      {/* Staff compare it with the label: on one line where the table has room. */}
      <span className="block tabular-nums [overflow-wrap:anywhere] min-[1440px]:whitespace-nowrap">
        {order.tracking_number}
      </span>
      {order.carrier ? (
        <span className="mt-0.5 block text-xs text-muted-foreground">{order.carrier}</span>
      ) : null}
      {order.duplicateTracking ? (
        <Badge variant="warning" className="mt-1" title={t("admin.orders.duplicateTracking")}>
          <Copy className="size-3.5 shrink-0" aria-hidden />
          {t("admin.orders.duplicateShort")}
          <span className="sr-only"> {t("admin.orders.duplicateTrackingRest")}</span>
        </Badge>
      ) : null}
    </>
  );
}

function TypeCell({ order }: { order: AdminOrderView }) {
  const t = useT();
  return (
    <span className="flex flex-col items-start gap-1">
      {order.order_type === "b2b" ? (
        <B2bBadge />
      ) : (
        <span className="text-xs font-semibold text-foreground">
          {t("portal.orderTypes.personal")}
        </span>
      )}
      <span className="text-xs text-muted-foreground">
        {t(`portal.serviceTypes.${order.service_type}`)}
      </span>
    </span>
  );
}

function rowActions(order: AdminOrderView, dialogs: OrderDialogs) {
  return (
    <OrderRowActions
      order={order}
      onChangeStatus={() => dialogs.changeStatus([toStatusTarget(order)])}
      onReceive={() => dialogs.receive(toReceiveTarget(order))}
      onPickup={() => dialogs.pickup([toStatusTarget(order)])}
    />
  );
}

function OrdersTable({
  orders,
  statuses,
  selected,
  allSelected,
  onToggle,
  onToggleAll,
  dialogs,
}: ResultProps) {
  const t = useT();
  const th = "px-1.5 py-3 font-bold text-primary";
  return (
    // overflow-x-auto: at worst the table scrolls inside its card, never clips.
    <div className="relative hidden overflow-x-auto rounded-lg border bg-card shadow-sm xl:block">
      <table className="w-full text-sm">
        <caption className="sr-only">{t("admin.orders.tableCaption")}</caption>
        <thead className="border-b bg-cream text-left">
          <tr>
            <th scope="col" className="w-8 py-3 pl-2.5 pr-0.5">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(v) => onToggleAll(v === true)}
                aria-label={t("admin.orders.selectAll")}
              />
            </th>
            <th scope="col" className={th}>
              {t("admin.orders.columns.order")}
            </th>
            <th scope="col" className={th}>
              {t("admin.orders.columns.customer")}
            </th>
            <th scope="col" className={th}>
              {t("admin.orders.columns.type")}
            </th>
            <th scope="col" className={th}>
              {t("admin.orders.columns.tracking")}
            </th>
            <th scope="col" className={th}>
              {t("admin.orders.columns.status")}
            </th>
            <th scope="col" className={th}>
              {t("admin.orders.columns.invoice")}
            </th>
            <th scope="col" className={th}>
              {t("admin.orders.columns.payment")}
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
              <td className="py-3 pl-2.5 pr-0.5">
                <Checkbox
                  checked={selected.has(order.id)}
                  onCheckedChange={(v) => onToggle(order.id, v === true)}
                  aria-label={t("admin.orders.selectOrder", { reference: order.reference })}
                  className="mt-0.5"
                />
              </td>
              <td className="px-1.5 py-3">
                <Link
                  to="/admin/orders/$id"
                  params={{ id: order.id }}
                  className="whitespace-nowrap rounded-sm text-[0.8125rem] font-bold text-primary tabular-nums underline-offset-4 hover:underline"
                >
                  {order.reference}
                </Link>
                <span className="mt-0.5 block whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                  <span className="sr-only">{t("admin.orders.columns.date")}: </span>
                  {formatDate(order.created_at)}
                </span>
                <OrderMarkers order={order} />
              </td>
              <td className="px-1.5 py-3">
                <CustomerCell order={order} />
              </td>
              <td className="px-1.5 py-3">
                <TypeCell order={order} />
              </td>
              <td className="px-1.5 py-3">
                <TrackingCell order={order} />
              </td>
              <td className="px-1.5 py-3">
                <OrderStatusBadge status={resolveStatus(order.status, statuses)} />
              </td>
              <td className="px-1.5 py-3">
                <InvoiceSummary billing={order.billing} />
              </td>
              <td className="px-1.5 py-3">
                <PaymentSummary billing={order.billing} />
              </td>
              <td className="px-1 py-2 text-right">{rowActions(order, dialogs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderCards({
  orders,
  statuses,
  selected,
  allSelected,
  onToggle,
  onToggleAll,
  dialogs,
}: ResultProps) {
  const t = useT();
  const id = useId();
  return (
    <div className="xl:hidden">
      <div className="mb-3 flex items-center gap-2 px-1">
        <Checkbox
          id={`${id}-all`}
          checked={allSelected}
          onCheckedChange={(v) => onToggleAll(v === true)}
        />
        <Label htmlFor={`${id}-all`} className="text-sm font-normal">
          {t("admin.orders.selectAll")}
        </Label>
      </div>
      <ul className="grid gap-3 md:grid-cols-2" aria-label={t("admin.orders.tableCaption")}>
        {orders.map((order) => (
          <li
            key={order.id}
            className={cn(
              "min-w-0 rounded-lg border bg-card p-4 shadow-sm",
              selected.has(order.id) && "border-primary/50 bg-cream/40",
            )}
          >
            <div className="flex items-start gap-3">
              <Checkbox
                checked={selected.has(order.id)}
                onCheckedChange={(v) => onToggle(order.id, v === true)}
                aria-label={t("admin.orders.selectOrder", { reference: order.reference })}
                // 20 px box, 44 px to tap.
                className="relative mt-1 size-5 after:absolute after:-inset-3 after:content-['']"
              />
              <div className="min-w-0 flex-1">
                <Link
                  to="/admin/orders/$id"
                  params={{ id: order.id }}
                  className="rounded-sm font-heading font-bold text-primary tabular-nums underline-offset-4 hover:underline"
                >
                  {order.reference}
                </Link>
                <p className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                  {t("admin.orders.columns.date")}: {formatDate(order.created_at)}
                </p>
              </div>
              {rowActions(order, dialogs)}
            </div>
            <OrderMarkers order={order} />
            <div className="mt-3">
              <OrderStatusBadge status={resolveStatus(order.status, statuses)} />
            </div>
            {/* Two columns at every width: three short rows instead of six (P4 review). */}
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">
                  {t("admin.orders.columns.customer")}
                </dt>
                <dd>
                  <CustomerCell order={order} />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{t("admin.orders.columns.type")}</dt>
                <dd>
                  <TypeCell order={order} />
                </dd>
              </div>
              <div className="col-span-2 min-w-0">
                <dt className="text-xs text-muted-foreground">
                  {t("admin.orders.columns.tracking")}
                </dt>
                <dd>
                  <TrackingCell order={order} />
                </dd>
              </div>
              {order.billing.payment === "none" ? (
                // No invoice: one quiet line instead of "Geen factuur" + "n.v.t.".
                <div className="col-span-2 min-w-0">
                  <dt className="text-xs text-muted-foreground">
                    {t("admin.orders.columns.invoice")}
                  </dt>
                  <dd>
                    <InvoiceSummary billing={order.billing} />
                  </dd>
                </div>
              ) : (
                <>
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">
                      {t("admin.orders.columns.invoice")}
                    </dt>
                    <dd>
                      <InvoiceSummary billing={order.billing} />
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">
                      {t("admin.orders.columns.payment")}
                    </dt>
                    <dd>
                      <PaymentSummary billing={order.billing} />
                    </dd>
                  </div>
                </>
              )}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "Genereer factuur" for a selection (SPEC §35.9): one invoice is for one
 * customer, so only a selection of one customer's orders opens the builder.
 */
function GenerateInvoiceButton({
  orders,
}: {
  orders: readonly { id: string; customer_id: string }[];
}) {
  const t = useT();
  const customers = new Set(orders.map((o) => o.customer_id));
  const [customerId] = [...customers];
  if (customers.size !== 1 || !customerId) {
    return (
      <span className="max-w-xs text-xs leading-5 text-muted-foreground">
        {t("admin.actions.generateInvoiceOneCustomer")}
      </span>
    );
  }
  return (
    <Button asChild size="sm" variant="outline">
      <Link
        to="/admin/facturen/nieuw"
        search={newInvoiceSearch({ customerId, orderIds: orders.map((o) => o.id), from: "orders" })}
      >
        <FilePlus2 aria-hidden />
        {t("admin.actions.generateInvoiceSelection", { count: orders.length })}
      </Link>
    </Button>
  );
}
