import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import {
  CalendarDays,
  ChevronRight,
  FilePlus2,
  Loader2,
  Maximize2,
  Package,
  ReceiptText,
  RotateCw,
  Save,
  Trash2,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { BuilderLines } from "@/components/admin/invoices/BuilderLines";
import { BuilderOrders } from "@/components/admin/invoices/BuilderOrders";
import { Callout, FieldError } from "@/components/admin/Callout";
import { CustomerPicker } from "@/components/admin/CustomerPicker";
import { InvoicePreview } from "@/components/invoice/InvoiceDocument";
import { LoadError, Section } from "@/components/portal/Section";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  addOrder,
  canMoveLine,
  changeCurrency,
  changeInvoiceDate,
  deleteDraft,
  errorOrder,
  extraLine,
  fieldDomId,
  initialBuilderState,
  moveLine,
  refreshDates,
  removeLine,
  removeOrder,
  saveDraft,
  stateFromDraft,
  toDraftForm,
  validateBuilder,
  withSavedIds,
  type BuilderCustomer,
  type BuilderLine,
  type BuilderOrder,
  type BuilderState,
  type DraftInvoice,
  type DraftItem,
} from "@/lib/admin/invoice-builder";
import {
  invalidateInvoices,
  invoiceBuilderOrdersQueryOptions,
  invoiceCustomerQueryOptions,
} from "@/lib/admin/invoice-queries";
import {
  customerDisplayName,
  customersQueryOptions,
  type PickerCustomer,
} from "@/lib/admin/orders";
import {
  bankAccountsQueryOptions,
  companySettingsQueryOptions,
  serviceRatesQueryOptions,
} from "@/lib/admin/settings-queries";
import {
  CURRENCIES,
  incompleteBankCurrencies,
  type BankAccount,
  type CompanySettings,
  type ServiceRate,
} from "@/lib/admin/settings";
import { adminStatusesQueryOptions, type AdminStatusMap } from "@/lib/admin/statuses";
import { errorMessage, toAppError, type AppError } from "@/lib/errors";
import {
  formatDate,
  formatLbs,
  formatMoney,
  todayInSuriname,
  type CurrencyCode,
} from "@/lib/format";
import { useT } from "@/lib/i18n";
import { fromDraftForm, formatPercent } from "@/lib/invoice/model";
import { submitIssueInvoice } from "@/lib/server-fns/invoices.functions";
import { cn } from "@/lib/utils";

/**
 * The invoice builder (SPEC §14, §15, §35.9, §35.11): left the form, right
 * the live preview (the real <InvoiceDocument>, scaled, built from the form
 * and the LIVE settings); below 1024 px tabs "Gegevens" | "Voorbeeld".
 *
 * "Opslaan als concept" writes the draft with the staff member's own client
 * (RLS + triggers: totals, freight once per order); "Genereer factuur" saves
 * the draft, then issueInvoiceFn → issue_invoice (number, snapshots) and the
 * P8 hook. Nothing here claims an e-mail was sent unless the hook says so.
 */

export type BuilderMode =
  | {
      kind: "new";
      customerId: string | null;
      /** ?orders= from "Genereer factuur" on orders or a customer. */
      orderIds: readonly string[];
      /** "Corrigeren": the cancelled invoice this one replaces. */
      replacesInvoiceId: string | null;
      replacesNumber?: string | null;
      /** "Corrigeren": the currency of the replaced invoice (else the default currency). */
      currency?: CurrencyCode | null;
    }
  | { kind: "draft"; invoiceId: string; invoice: DraftInvoice; items: DraftItem[] };

export function InvoiceBuilder({
  userId,
  mode,
  header,
  leaveTo,
}: {
  userId: string;
  mode: BuilderMode;
  /** Back link and title. */
  header: ReactNode;
  /** Where "Concept verwijderen" goes afterwards. */
  leaveTo: { to: "/admin/klanten/$id"; id: string } | { to: "/admin/orders" };
}) {
  const t = useT();
  const settings = useQuery(companySettingsQueryOptions(userId));
  const banks = useQuery(bankAccountsQueryOptions(userId));
  const rates = useQuery(serviceRatesQueryOptions(userId));
  const customers = useQuery(customersQueryOptions(userId));
  const statuses = useQuery(adminStatusesQueryOptions(userId));
  const draftCustomer = mode.kind === "draft" ? mode.invoice.customer_id : "";
  const draftOrders = useQuery({
    ...invoiceBuilderOrdersQueryOptions(
      userId,
      draftCustomer,
      mode.kind === "draft" ? mode.invoiceId : null,
    ),
    enabled: mode.kind === "draft",
  });

  const needed = [
    settings,
    banks,
    rates,
    customers,
    ...(mode.kind === "draft" ? [draftOrders] : []),
  ];
  const failed = needed.find((q) => q.isError);
  if (failed) {
    return (
      <>
        {header}
        <LoadError
          title={t("admin.invoiceBuilder.loadFailed")}
          error={failed.error}
          onRetry={() => needed.forEach((q) => void q.refetch())}
        />
      </>
    );
  }
  if (!settings.data || !banks.data || !rates.data || !customers.data) {
    return (
      <>
        {header}
        <BuilderSkeleton />
      </>
    );
  }
  if (mode.kind === "draft" && !draftOrders.data) {
    return (
      <>
        {header}
        <BuilderSkeleton />
      </>
    );
  }
  return (
    <BuilderBody
      userId={userId}
      mode={mode}
      header={header}
      leaveTo={leaveTo}
      settings={settings.data}
      banks={banks.data}
      rates={rates.data}
      customers={customers.data}
      statuses={statuses.data}
      draftOrders={draftOrders.data ?? []}
    />
  );
}

function BuilderSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-2" aria-busy="true">
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
      <Skeleton className="hidden aspect-[8.5/11] w-full lg:block" />
    </div>
  );
}

/** The form state without React keys or saved ids: what "unsaved changes" compares. */
function snapshot(state: BuilderState): string {
  return JSON.stringify({
    ...state,
    dueTouched: undefined,
    lines: state.lines.map(({ key: _key, id: _id, weightNote: _note, ...rest }) => rest),
  });
}

type Pending = "save" | "issue" | "delete" | null;

function BuilderBody({
  userId,
  mode,
  header,
  leaveTo,
  settings,
  banks,
  rates,
  customers,
  statuses,
  draftOrders,
}: {
  userId: string;
  mode: BuilderMode;
  header: ReactNode;
  leaveTo: { to: "/admin/klanten/$id"; id: string } | { to: "/admin/orders" };
  settings: CompanySettings;
  banks: BankAccount[];
  rates: ServiceRate[];
  customers: PickerCustomer[];
  statuses: AdminStatusMap | undefined;
  draftOrders: BuilderOrder[];
}) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const termDays = settings.payment_term_days;

  const [state, setState] = useState<BuilderState>(() =>
    mode.kind === "draft"
      ? stateFromDraft(mode.invoice, mode.items, draftOrders, rates, termDays)
      : initialBuilderState({
          customerId: customers.some((c) => c.id === mode.customerId && c.status !== "disabled")
            ? mode.customerId
            : null,
          currency: mode.currency ?? settings.default_currency,
          paymentTermDays: termDays,
          replacesInvoiceId: mode.replacesInvoiceId,
        }),
  );
  const [invoiceId, setInvoiceId] = useState<string | null>(
    mode.kind === "draft" ? mode.invoiceId : null,
  );
  const [baseline, setBaseline] = useState(() => snapshot(state));
  const [showInvoiced, setShowInvoiced] = useState(false);
  const [showErrors, setShowErrors] = useState<"draft" | "issue" | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  // draftKept: the draft is saved but issuing failed; otherwise the save itself failed.
  const [failure, setFailure] = useState<{ error: AppError; draftKept: boolean } | null>(null);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState<"form" | "preview">("form");
  const [zoom, setZoom] = useState(false);
  const failureRef = useRef<HTMLDivElement>(null);
  const ids = { customer: useId(), currency: useId(), note: useId() };

  const ordersQuery = useQuery({
    ...invoiceBuilderOrdersQueryOptions(userId, state.customerId ?? "", invoiceId),
    enabled: Boolean(state.customerId),
  });
  const orders = useMemo(
    () => ordersQuery.data ?? (state.customerId === draftOrders[0]?.customer_id ? draftOrders : []),
    [ordersQuery.data, draftOrders, state.customerId],
  );
  const customerRow = useQuery({
    ...invoiceCustomerQueryOptions(userId, state.customerId ?? ""),
    enabled: Boolean(state.customerId),
  });

  // "Genereer factuur" from orders or a customer: their freight lines, once the orders are in.
  const prefill = useRef(mode.kind === "new" ? [...mode.orderIds] : []);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (prefill.current.length === 0 || !ordersQuery.data) return;
    let next = stateRef.current;
    for (const id of prefill.current) {
      const order = ordersQuery.data.find((o) => o.id === id);
      if (order) next = addOrder(next, order, rates);
    }
    prefill.current = [];
    if (next.lines.some((l) => l.lineType !== "freight")) setShowInvoiced(true);
    setState(next);
    setBaseline(snapshot(next));
  }, [ordersQuery.data, rates]);

  // "Corrigeren" already cancelled the old invoice: until the replacement is
  // saved there is none, so leaving warns even when nothing was changed yet.
  const correctionUnsaved =
    mode.kind === "new" && state.replacesInvoiceId !== null && invoiceId === null;
  const dirty = snapshot(state) !== baseline || correctionUnsaved;
  const leaving = useRef(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const shouldBlockFn = useCallback(
    ({ current, next }: { current: { pathname: string }; next: { pathname: string } }) =>
      dirtyRef.current && !leaving.current && current.pathname !== next.pathname,
    [],
  );
  const enableBeforeUnload = useCallback(() => dirtyRef.current && !leaving.current, []);
  const blocker = useBlocker({ shouldBlockFn, enableBeforeUnload, withResolver: true });

  const pickerCustomer = customers.find((c) => c.id === state.customerId) ?? null;
  const billTo = useMemo<BuilderCustomer | null>(
    () =>
      customerRow.data ??
      (pickerCustomer
        ? {
            ...pickerCustomer,
            contact_person: null,
            kkf_number: null,
            address: null,
            district: null,
          }
        : null),
    [customerRow.data, pickerCustomer],
  );
  const model = useMemo(
    () => fromDraftForm(toDraftForm(state, orders), settings, banks, billTo),
    [state, orders, settings, banks, billTo],
  );

  const vatRate = settings.vat_rate_percent;
  const validation = validateBuilder(state, {
    orders,
    vatRate,
    mode: showErrors === "issue" ? "issue" : "draft",
  });
  const errors = { ...validation.errors };
  if (showErrors === "issue" && pickerCustomer?.status === "disabled") {
    errors["customer"] = t("admin.invoiceBuilder.customerDisabled");
  }
  const visibleErrors = showErrors ? errors : {};

  const incompleteBanks = incompleteBankCurrencies(banks);
  const rateWarnings = rateProblems(state, orders, rates);
  const ordersLocked = state.lines.some((l) => l.orderId !== null);

  // --- state changes ------------------------------------------------------
  const update = (next: BuilderState) => {
    setState(next);
    setFailure(null);
  };
  const changeLine = (key: string, patch: Partial<BuilderLine>) =>
    update({
      ...state,
      lines: state.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    });

  const focusFirstError = (errs: Record<string, string>) => {
    const first = errorOrder(state).find((f) => errs[f]);
    setTab("form");
    if (!first) return;
    requestAnimationFrame(() => {
      const el =
        document.getElementById(fieldDomId(first)) ??
        (first === "lines" ? document.getElementById("ib-lines-error") : null);
      el?.focus();
      el?.scrollIntoView({ block: "center" });
    });
  };

  const check = (kind: "draft" | "issue") => {
    const v = validateBuilder(state, { orders, vatRate, mode: kind });
    const errs = { ...v.errors };
    if (kind === "issue" && pickerCustomer?.status === "disabled") {
      errs["customer"] = t("admin.invoiceBuilder.customerDisabled");
    }
    setShowErrors(kind);
    if (Object.keys(errs).length > 0) {
      toast.error(t("toast.invoiceCreateFailed"));
      focusFirstError(errs);
      return false;
    }
    return true;
  };

  const persist = async (): Promise<string> => {
    const saved = await saveDraft(supabase, invoiceId, state);
    const next = withSavedIds(state, saved.lineIds);
    setInvoiceId(saved.invoiceId);
    setState(next);
    setBaseline(snapshot(next));
    return saved.invoiceId;
  };

  const showFailure = (error: unknown, draftKept: boolean) => {
    const app = toAppError(error);
    // The message sits in the form (below 1024px possibly on the other tab).
    setTab("form");
    setFailure({ error: app, draftKept });
    toast.error(t("toast.invoiceCreateFailed"), { description: app.message });
    requestAnimationFrame(() => failureRef.current?.focus());
  };

  const onSave = async () => {
    if (pending || !check("draft")) return;
    setPending("save");
    setFailure(null);
    try {
      const id = await persist();
      await invalidateInvoices(queryClient, userId);
      toast.success(t("admin.invoiceBuilder.draftSaved"));
      if (mode.kind === "new") {
        leaving.current = true;
        await navigate({ to: "/admin/facturen/$id", params: { id }, replace: true });
      }
    } catch (error) {
      showFailure(error, false);
    } finally {
      setPending(null);
    }
  };

  const onIssueClick = () => {
    if (pending || !check("issue")) return;
    setConfirmIssue(true);
  };

  const onIssue = async () => {
    setConfirmIssue(false);
    setPending("issue");
    setFailure(null);
    let saved = false;
    try {
      const id = await persist();
      saved = true;
      const issued = await submitIssueInvoice({ invoiceId: id });
      await invalidateInvoices(queryClient, userId);
      toast.success(t("toast.invoiceCreated"), {
        description: issued.emailed
          ? t("admin.invoiceBuilder.issuedEmailed", { number: issued.invoiceNumber })
          : t("admin.invoiceBuilder.issuedNoEmail", { number: issued.invoiceNumber }),
      });
      leaving.current = true;
      await navigate({
        to: "/admin/facturen/$id",
        params: { id: issued.invoiceId },
        replace: true,
      });
    } catch (error) {
      await invalidateInvoices(queryClient, userId);
      showFailure(error, saved);
    } finally {
      setPending(null);
    }
  };

  const onDelete = async () => {
    if (!invoiceId) return;
    setConfirmDelete(false);
    setPending("delete");
    try {
      await deleteDraft(supabase, invoiceId);
      await invalidateInvoices(queryClient, userId);
      toast.success(t("admin.invoiceBuilder.draftDeleted"));
      leaving.current = true;
      if (leaveTo.to === "/admin/orders") await navigate({ to: "/admin/orders" });
      else await navigate({ to: "/admin/klanten/$id", params: { id: leaveTo.id } });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(null);
    }
  };

  const totals = model.totals;
  const busy = pending !== null;

  // "Opslaan als concept" and "Genereer factuur": at the end of the form, and
  // below 1024px also under the preview tab, where staff check before issuing.
  const saveButtons = (
    <>
      <Button type="button" variant="outline" onClick={() => void onSave()} disabled={busy}>
        {pending === "save" ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <Save aria-hidden />
        )}
        {pending === "save"
          ? t("admin.invoiceBuilder.actions.saving")
          : t("admin.invoiceBuilder.actions.saveDraft")}
      </Button>
      <Button type="button" onClick={onIssueClick} disabled={busy}>
        {pending === "issue" ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <FilePlus2 aria-hidden />
        )}
        {pending === "issue"
          ? t("admin.invoiceBuilder.actions.issuing")
          : t("admin.invoiceBuilder.actions.issue")}
      </Button>
    </>
  );

  // --- the form -------------------------------------------------------------
  const form = (
    <div className="space-y-5">
      <Section
        title={t("admin.invoiceBuilder.sections.customer")}
        icon={UserRound}
        id="ib-customer"
      >
        <div className="space-y-1.5">
          <Label htmlFor={fieldDomId("customer")}>{t("admin.invoiceBuilder.customer")}</Label>
          <CustomerPicker
            id={fieldDomId("customer")}
            customers={customers}
            value={state.customerId}
            onChange={(customerId) => update({ ...state, customerId, orderIds: [] })}
            disabled={ordersLocked || busy}
            invalid={Boolean(visibleErrors["customer"])}
            describedBy={`${ids.customer}-hint ${visibleErrors["customer"] ? `${fieldDomId("customer")}-error` : ""}`}
          />
          <p id={`${ids.customer}-hint`} className="text-xs text-muted-foreground">
            {ordersLocked
              ? t("admin.invoiceBuilder.customerChangeBlocked")
              : t("admin.invoiceBuilder.customerHint")}
          </p>
          <FieldError
            id={`${fieldDomId("customer")}-error`}
            message={visibleErrors["customer"] ?? null}
          />
          {pickerCustomer?.status === "disabled" ? (
            <Callout
              tone="danger"
              icon={TriangleAlert}
              title={t("admin.invoiceBuilder.customerDisabled")}
            />
          ) : pickerCustomer && !pickerCustomer.user_id ? (
            <p className="text-xs text-muted-foreground">
              {t("admin.invoiceBuilder.customerNoLogin")}
            </p>
          ) : null}
        </div>
      </Section>

      <Section
        title={t("admin.invoiceBuilder.sections.orders")}
        icon={Package}
        id="ib-orders"
        description={t("admin.invoiceBuilder.orders.intro")}
        actions={
          state.orderIds.length > 0 ? (
            <Badge variant="outline">
              {t("admin.invoiceBuilder.orders.selectedCount", { count: state.orderIds.length })}
            </Badge>
          ) : null
        }
      >
        {!state.customerId ? (
          <p className="text-sm text-muted-foreground">
            {t("admin.invoiceBuilder.orders.chooseCustomerFirst")}
          </p>
        ) : ordersQuery.isError ? (
          <LoadError
            title={t("admin.invoiceBuilder.orders.loadFailed")}
            error={ordersQuery.error}
            onRetry={() => void ordersQuery.refetch()}
          />
        ) : ordersQuery.isPending && orders.length === 0 ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          <BuilderOrders
            orders={orders}
            statuses={statuses}
            selected={state.orderIds}
            showInvoiced={showInvoiced}
            onShowInvoiced={setShowInvoiced}
            onToggle={(order, picked) =>
              update(picked ? addOrder(state, order, rates) : removeOrder(state, order.id))
            }
          />
        )}
      </Section>

      <Section
        title={t("admin.invoiceBuilder.sections.lines")}
        icon={ReceiptText}
        id="ib-lines"
        description={t("admin.invoiceBuilder.lines.intro")}
      >
        {rateWarnings.length > 0 ? (
          <div className="mb-3 space-y-2">
            {rateWarnings.map((w) => (
              <Callout
                key={w.service}
                tone="warning"
                icon={TriangleAlert}
                title={
                  w.kind === "missing"
                    ? t("admin.invoiceBuilder.warnings.noRate", {
                        service: t(`portal.serviceTypes.${w.service}`),
                      })
                    : t("admin.invoiceBuilder.warnings.rateCurrency", {
                        service: t(`portal.serviceTypes.${w.service}`),
                        rateCurrency: w.rateCurrency,
                        currency: state.currency,
                      })
                }
                actions={
                  <Link
                    to="/admin/instellingen"
                    hash="tarieven-title"
                    className="inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    {t("admin.invoiceBuilder.warnings.toSettings")}
                    <ChevronRight className="size-4" aria-hidden />
                  </Link>
                }
              />
            ))}
          </div>
        ) : null}
        <BuilderLines
          lines={state.lines}
          orders={orders}
          currency={state.currency}
          vatConfigured={vatRate !== null}
          errors={visibleErrors}
          onChange={changeLine}
          onAdd={(type) => update({ ...state, lines: [...state.lines, extraLine(type)] })}
          onRemove={(key) => update(removeLine(state, key))}
          onMove={(key, by) => update(moveLine(state, key, by))}
          canMove={(key, by) => canMoveLine(state, key, by)}
        />
        <div id="ib-lines-error" tabIndex={-1} className="mt-2 outline-none">
          <FieldError id="ib-lines-error-text" message={visibleErrors["lines"] ?? null} />
        </div>
      </Section>

      <Section
        title={t("admin.invoiceBuilder.sections.details")}
        icon={CalendarDays}
        id="ib-details"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={ids.currency}>{t("admin.invoiceBuilder.currency")}</Label>
            <Select
              value={state.currency}
              onValueChange={(value) =>
                update(changeCurrency(state, value as CurrencyCode, orders, rates))
              }
              disabled={busy}
            >
              <SelectTrigger
                id={ids.currency}
                className="h-10 w-full sm:w-48"
                aria-describedby={`${ids.currency}-hint`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p id={`${ids.currency}-hint`} className="text-xs text-muted-foreground">
              {t("admin.invoiceBuilder.currencyHint")}
            </p>
          </div>
          <DateField
            id={fieldDomId("invoiceDate")}
            label={t("admin.invoiceBuilder.invoiceDate")}
            value={state.invoiceDate}
            error={visibleErrors["invoiceDate"] ?? null}
            onChange={(value) => update(changeInvoiceDate(state, value, termDays))}
          />
          <DateField
            id={fieldDomId("dueDate")}
            label={t("admin.invoiceBuilder.dueDate")}
            value={state.dueDate}
            min={state.invoiceDate || undefined}
            hint={t("admin.invoiceBuilder.dueHint", { days: termDays })}
            error={visibleErrors["dueDate"] ?? null}
            onChange={(value) => update({ ...state, dueDate: value, dueTouched: true })}
          />
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={fieldDomId("customerNote")}>{t("admin.invoiceBuilder.note")}</Label>
            <Textarea
              id={fieldDomId("customerNote")}
              value={state.customerNote}
              maxLength={2000}
              rows={3}
              onChange={(e) => update({ ...state, customerNote: e.target.value })}
              aria-describedby={`${ids.note}-hint`}
              aria-invalid={visibleErrors["customerNote"] ? true : undefined}
            />
            <p id={`${ids.note}-hint`} className="text-xs text-muted-foreground">
              {t("admin.invoiceBuilder.noteHint")}
            </p>
            <FieldError
              id={`${fieldDomId("customerNote")}-error`}
              message={visibleErrors["customerNote"] ?? null}
            />
          </div>
        </div>
      </Section>

      <Section title={t("admin.invoiceBuilder.totals.title")} icon={FilePlus2} id="ib-totals">
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm tabular-nums">
          <dt className="text-muted-foreground">{t("admin.invoiceBuilder.totals.lbs")}</dt>
          <dd className="text-right">{formatLbs(totals.totalLbs)}</dd>
          <dt className="font-semibold text-primary">{t("admin.invoiceBuilder.totals.total")}</dt>
          <dd className="text-right text-base font-bold text-primary">
            {formatMoney(totals.totalAmount, state.currency)}
          </dd>
          {totals.vatRate !== null && totals.vatAmount !== null ? (
            <>
              <dt className="text-muted-foreground">
                {t("admin.invoiceBuilder.totals.vat", { rate: formatPercent(totals.vatRate) })}
              </dt>
              <dd className="text-right">{formatMoney(totals.vatAmount, state.currency)}</dd>
            </>
          ) : null}
        </dl>

        {failure ? (
          <div ref={failureRef} tabIndex={-1} className="mt-4 outline-none" role="alert">
            <Callout
              tone="danger"
              icon={TriangleAlert}
              title={failure.error.message}
              actions={
                failure.error.hint === "invoice_dates" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="bg-card"
                    onClick={() => update(refreshDates(state, termDays, todayInSuriname()))}
                  >
                    <RotateCw aria-hidden />
                    {t("admin.invoiceBuilder.actions.refreshDates")}
                  </Button>
                ) : null
              }
            >
              {failure.draftKept
                ? t("admin.invoiceBuilder.draftKept")
                : t("admin.invoiceBuilder.draftNotSaved")}
            </Callout>
          </div>
        ) : showErrors && Object.keys(errors).length > 0 ? (
          <p className="mt-4 text-sm font-medium text-destructive" role="status">
            {t("admin.invoiceBuilder.validation.summary")}{" "}
            {validation.dateProblem ? (
              <Button
                type="button"
                variant="link"
                className="h-auto px-1 py-0 align-baseline"
                onClick={() => update(refreshDates(state, termDays, todayInSuriname()))}
              >
                {t("admin.invoiceBuilder.actions.refreshDates")}
              </Button>
            ) : null}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {invoiceId ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive sm:mr-auto"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
            >
              {pending === "delete" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Trash2 aria-hidden />
              )}
              {pending === "delete"
                ? t("admin.invoiceBuilder.actions.deleting")
                : t("admin.invoiceBuilder.actions.deleteDraft")}
            </Button>
          ) : null}
          {dirty ? (
            <Badge variant="warning" className="self-start sm:self-center">
              {t("admin.invoiceBuilder.unsaved")}
            </Badge>
          ) : null}
          {saveButtons}
        </div>
      </Section>
    </div>
  );

  // --- the preview ----------------------------------------------------------
  const preview = (
    <div className="space-y-3">
      {incompleteBanks.length > 0 ? (
        <Callout
          tone="warning"
          icon={TriangleAlert}
          title={t("admin.invoiceBuilder.warnings.bank")}
          actions={
            <Link
              to="/admin/instellingen"
              hash="bankrekeningen-title"
              className="inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-4 hover:underline"
            >
              {t("admin.invoiceBuilder.warnings.toSettings")}
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          }
        >
          {t("admin.invoiceBuilder.warnings.bankDetail", {
            currencies: incompleteBanks.join(", "),
          })}
        </Callout>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs leading-5 text-muted-foreground">
          {t("admin.invoiceBuilder.previewNote")}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => setZoom(true)}>
          <Maximize2 aria-hidden />
          {t("admin.invoiceBuilder.zoom.open")}
        </Button>
      </div>
      <div className="rounded-lg border bg-muted/60 p-2 sm:p-3">
        <InvoicePreview model={model} label={t("admin.invoiceBuilder.previewLabel")} />
      </div>
      {/* Below 1024px (tabs): save or issue right after checking the preview. */}
      <div className="rounded-lg border bg-card p-3 lg:hidden">
        <p className="mb-3 flex items-baseline justify-between gap-3 text-sm">
          <span className="font-semibold">{t("admin.invoiceBuilder.totals.total")}</span>
          <span className="font-bold tabular-nums">
            {formatMoney(totals.totalAmount, state.currency)}
          </span>
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {saveButtons}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {header}
      {state.replacesInvoiceId && mode.kind === "new" && mode.replacesNumber ? (
        <Callout
          tone="info"
          icon={ReceiptText}
          title={t("admin.invoiceBuilder.replaces", { number: mode.replacesNumber })}
          className="mb-4"
        />
      ) : null}
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value === "preview" ? "preview" : "form")}
        className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-6"
      >
        <TabsList className="mb-4 grid h-11 w-full grid-cols-2 lg:hidden">
          <TabsTrigger value="form" className="h-9">
            {t("admin.invoiceBuilder.tabs.form")}
          </TabsTrigger>
          <TabsTrigger value="preview" className="h-9">
            {t("admin.invoiceBuilder.tabs.preview")}
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="form"
          forceMount
          className="mt-0 min-w-0 data-[state=inactive]:hidden lg:data-[state=inactive]:block"
        >
          {form}
        </TabsContent>
        <TabsContent
          value="preview"
          forceMount
          className={cn(
            "mt-0 min-w-0 data-[state=inactive]:hidden lg:sticky lg:top-6 lg:data-[state=inactive]:block",
          )}
        >
          {preview}
        </TabsContent>
      </Tabs>

      {/* The live preview at (nearly) true size: next to the form it is small. */}
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="max-h-[94vh] w-[calc(100%-1rem)] max-w-[min(54rem,calc(100vw-1rem))] overflow-y-auto rounded-lg bg-card p-3 sm:max-w-[min(54rem,calc(100vw-2rem))] sm:p-5">
          <DialogHeader>
            <DialogTitle className="font-heading text-primary">
              {t("admin.invoiceBuilder.zoom.title")}
            </DialogTitle>
            <DialogDescription>{t("admin.invoiceBuilder.zoom.text")}</DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/60 p-2">
            <InvoicePreview model={model} label={t("admin.invoiceBuilder.previewLabel")} />
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmIssue} onOpenChange={setConfirmIssue}>
        <AlertDialogContent className="w-[calc(100%-2rem)] rounded-lg bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading text-primary">
              {t("admin.invoiceBuilder.issueConfirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.invoiceBuilder.issueConfirm.text", {
                customer: pickerCustomer
                  ? `${customerDisplayName(pickerCustomer)} (${pickerCustomer.customer_code})`
                  : "",
                total: formatMoney(totals.totalAmount, state.currency),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>{t("admin.invoiceBuilder.issueConfirm.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onIssue()}>
              {t("admin.invoiceBuilder.issueConfirm.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="w-[calc(100%-2rem)] rounded-lg bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading text-primary">
              {t("admin.invoiceBuilder.deleteConfirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.invoiceBuilder.deleteConfirm.text")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>{t("admin.invoiceBuilder.deleteConfirm.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void onDelete()}
            >
              {t("admin.invoiceBuilder.deleteConfirm.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.status === "blocked") blocker.reset();
        }}
      >
        <AlertDialogContent className="w-[calc(100%-2rem)] rounded-lg bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading text-primary">
              {t("admin.invoiceBuilder.leave.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {correctionUnsaved
                ? t("admin.invoiceBuilder.leave.correctionText", {
                    number: (mode.kind === "new" && mode.replacesNumber) || "",
                  })
                : t("admin.invoiceBuilder.leave.text")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel onClick={() => blocker.reset?.()}>
              {t("admin.invoiceBuilder.leave.stay")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => blocker.proceed?.()}
            >
              {t("admin.invoiceBuilder.leave.leave")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DateField({
  id,
  label,
  value,
  min,
  hint,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  min?: string | undefined;
  hint?: string;
  error: string | null;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const described = [hint ? `${id}-hint` : null, `${id}-chosen`, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="date"
        value={value}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        className="h-10"
      />
      {/* The browser shows the date in its own notation (SPEC §35.10: dd-mm-jjjj). */}
      <p id={`${id}-chosen`} className="text-xs text-muted-foreground tabular-nums">
        {/^\d{4}-\d{2}-\d{2}$/.test(value)
          ? t("admin.invoiceBuilder.chosenDate", { date: formatDate(value) })
          : null}
      </p>
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

interface RateProblem {
  service: ServiceRate["service_type"];
  kind: "missing" | "currency";
  rateCurrency: CurrencyCode;
}

/** Services on this invoice without a usable rate per lb (none set, or another currency). */
function rateProblems(
  state: BuilderState,
  orders: readonly BuilderOrder[],
  rates: readonly ServiceRate[],
): RateProblem[] {
  const services = new Set(
    state.lines
      .filter((l) => l.lineType === "freight")
      .flatMap((l) => orders.filter((o) => o.id === l.orderId).map((o) => o.service_type)),
  );
  return [...services].flatMap((service): RateProblem[] => {
    const rate = rates.find((r) => r.service_type === service);
    if (!rate || rate.rate_per_lb === null) {
      return [{ service, kind: "missing", rateCurrency: state.currency }];
    }
    if (rate.currency !== state.currency) {
      return [{ service, kind: "currency", rateCurrency: rate.currency }];
    }
    return [];
  });
}
