import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Briefcase,
  Info,
  Loader2,
  MailX,
  PackageCheck,
  Save,
  Scale,
} from "lucide-react";
import { toast } from "sonner";

import { Callout, FieldError } from "@/components/admin/Callout";
import { StatusFollowUpView } from "@/components/admin/StatusFollowUp";
import { CurrencyAmounts } from "@/components/portal/CurrencyAmounts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { emailStatusQueryOptions } from "@/lib/admin/email";
import { adminKeys } from "@/lib/admin/keys";
import {
  ordersWithCustomsDocuments,
  unpaidInvoicesForOrders,
  type StatusTarget,
} from "@/lib/admin/orders";
import type { StatusFollowUp } from "@/lib/admin/status-share";
import {
  STAGE_DISPLAY_ORDER,
  defaultNotify,
  mustReceiveFirst,
  needsB2bCustomsWarning,
  selectableStatuses,
  suggestedNextStatus,
  type AdminStatusMap,
  type OperationalSettings,
  type StatusRow,
} from "@/lib/admin/statuses";
import { statusEmailSummary } from "@/lib/email/outcome";
import { errorMessage, toAppError } from "@/lib/errors";
import { formatNumber } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { submitPickup, submitStatusChange } from "@/lib/server-fns/admin-orders.functions";

const MESSAGE_MAX = 2000;
const NAME_MAX = 200;
const REASON_MAX = 500;

/**
 * "Status wijzigen" for one order or a selection (SPEC §11, §35.7): one call
 * of change_order_status for all of them (changeOrderStatusFn). The form
 * adapts to the chosen status:
 * - "Actie vereist" needs a message for the customer; an order already
 *   waiting can get a new message (a history row of its own);
 * - a completed status turns the dialog into "Afgeven aan klant": who
 *   collected it, and with pay_before_pickup on, unpaid orders block until
 *   staff give a reason ("Toch afgeven", pickup_override, audited on the
 *   unpaid orders only). Hand-over is per customer, so a selection of
 *   several customers is not offered a completed status;
 * - orders that were never received stay behind when the status is past the
 *   US warehouse (receive them first, with their weight);
 * - a B2B order without commercial invoice or packing list gets a warning
 *   (never a block) when it moves on to customs;
 * - "Klant e-mailen" starts at the status's notify_customer; while e-mail is
 *   not configured the dialog says so beforehand, and the toast afterwards
 *   says what happened to each customer's "statusupdate" e-mail. Customers
 *   whose e-mail did not go out are then listed with a WhatsApp button each
 *   (StatusFollowUpView, SPEC §35.12) before the dialog closes.
 */
export function StatusChangeDialog({
  userId,
  orders,
  statuses,
  settings,
  initialStatus,
  heading,
  returnFocus,
  open,
  onOpenChange,
}: {
  userId: string;
  orders: readonly StatusTarget[];
  statuses: AdminStatusMap;
  settings: OperationalSettings;
  /** Preselects a status, e.g. "Afgehaald" for "Afgeven aan klant". */
  initialStatus?: string | null;
  /** Replaces the title and intro, e.g. for "Status voor hele zending wijzigen". */
  heading?: { title: string; description: string } | null;
  /** Where focus goes on close (default: where it came from). */
  returnFocus?: (() => HTMLElement | null) | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [followUps, setFollowUps] = useState<StatusFollowUp[] | null>(null);
  useEffect(() => {
    if (!open) setFollowUps(null);
  }, [open]);
  const close = (next: boolean) => {
    if (busy) return;
    if (!next) setFollowUps(null);
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-h-[92vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-card sm:max-w-xl"
        onCloseAutoFocus={(event) => {
          const element = returnFocus?.();
          if (!element) return;
          event.preventDefault();
          element.focus();
          if (element instanceof HTMLInputElement) element.select();
        }}
      >
        {/* Mounted only while open, so every opening starts from a clean form. */}
        {followUps ? (
          <StatusFollowUpView followUps={followUps} onClose={() => close(false)} />
        ) : (
          <StatusChangeForm
            userId={userId}
            orders={orders}
            statuses={statuses}
            settings={settings}
            initialStatus={initialStatus ?? null}
            heading={heading ?? null}
            onBusyChange={setBusy}
            onFollowUps={setFollowUps}
            onClose={() => close(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatusChangeForm({
  userId,
  orders,
  statuses,
  settings,
  initialStatus,
  heading,
  onBusyChange,
  onFollowUps,
  onClose,
}: {
  userId: string;
  orders: readonly StatusTarget[];
  statuses: AdminStatusMap;
  settings: OperationalSettings;
  initialStatus: string | null;
  heading: { title: string; description: string } | null;
  onBusyChange: (busy: boolean) => void;
  /** Customers to tell via WhatsApp instead: the dialog shows them before closing. */
  onFollowUps: (followUps: StatusFollowUp[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const stageOf = (o: StatusTarget) => statuses.get(o.status)?.stage ?? null;
  const single = orders.length === 1 ? orders[0] : undefined;
  /** One order on its own (not a whole shipment that happens to hold one). */
  const singleMode = single && !heading ? single : undefined;

  // Hand-over is per customer: one collector name for one customer's packages.
  const openCustomers = new Set(
    orders.filter((o) => stageOf(o) !== "completed").map((o) => o.customer_id),
  );
  const perCustomer = openCustomers.size > 1;
  const options = useMemo(
    () =>
      selectableStatuses(statuses, { deliveryAvailable: settings.delivery_available }).filter(
        (s) => !perCustomer || s.stage !== "completed",
      ),
    [statuses, settings.delivery_available, perCustomer],
  );
  const suggested = singleMode
    ? suggestedNextStatus(
        statuses,
        { status: singleMode.status, receivedAt: singleMode.received_at },
        { deliveryAvailable: settings.delivery_available },
      )
    : null;
  const preselected =
    options.find((s) => s.code === (initialStatus ?? suggested?.code ?? null)) ?? null;

  const [code, setCode] = useState<string>(preselected?.code ?? "");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [notify, setNotify] = useState(preselected ? defaultNotify(preselected) : false);
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [serverBlocked, setServerBlocked] = useState(false);

  const target: StatusRow | undefined = statuses.get(code);
  const stage = target?.stage ?? null;
  const visible = target?.customer_visible ?? true;
  const completed = stage === "completed";
  /** A new "Actie vereist" message for an order already waiting for the customer. */
  const remessage = Boolean(
    singleMode && singleMode.status === code && stage === "action_required",
  );

  // Never received: stays behind instead of skipping the receipt and the weight.
  const notReceived = orders.filter(
    (o) =>
      o.status !== code &&
      mustReceiveFirst({ stage: stageOf(o), receivedAt: o.received_at }, stage),
  );
  const included = orders.filter((o) => !notReceived.includes(o));
  const orderIds = included.map((o) => o.id);
  // Orders already in the target status are left alone by the RPC.
  const moving = included.filter((o) => o.status !== code);

  // SPEC §35.7: B2B orders without customs documents, warned (not blocked).
  const b2b = moving.filter((o) => o.order_type === "b2b");
  const checkCustoms =
    stage !== null &&
    b2b.some((o) =>
      needsB2bCustomsWarning({
        orderType: o.order_type,
        fromStage: stageOf(o),
        toStage: stage,
        hasCustomsDocuments: false,
      }),
    );
  // Known beforehand: without e-mail the customer is not told (the dialog says so).
  const emailStatus = useQuery(emailStatusQueryOptions(userId));
  const emailOff = emailStatus.data?.configured === false;
  const customsDocs = useQuery({
    queryKey: adminKeys.selectionChecks(
      userId,
      b2b.map((o) => o.id),
      "customs-documents",
    ),
    queryFn: () => ordersWithCustomsDocuments(b2b.map((o) => o.id)),
    enabled: checkCustoms,
    staleTime: 15_000,
  });
  const missingDocs =
    checkCustoms && customsDocs.data && stage
      ? b2b.filter((o) =>
          needsB2bCustomsWarning({
            orderType: o.order_type,
            fromStage: stageOf(o),
            toStage: stage,
            hasCustomsDocuments: customsDocs.data.has(o.id),
          }),
        )
      : [];

  // pay_before_pickup: unpaid orders block a hand-over unless staff give a reason.
  const checkUnpaid = completed && settings.pay_before_pickup && moving.length > 0;
  const unpaid = useQuery({
    queryKey: adminKeys.selectionChecks(
      userId,
      moving.map((o) => o.id),
      "unpaid",
    ),
    queryFn: () => unpaidInvoicesForOrders(moving.map((o) => o.id)),
    enabled: checkUnpaid,
    staleTime: 10_000,
  });
  const blockers = checkUnpaid ? (unpaid.data ?? []) : [];
  const override = completed && (blockers.length > 0 || serverBlocked);
  const checking = (checkUnpaid && unpaid.isPending) || (checkCustoms && customsDocs.isPending);
  const checksFailed = (checkUnpaid && unpaid.isError) || (checkCustoms && customsDocs.isError);

  const references = (list: readonly { id: string }[]) =>
    list.map((o) => orders.find((x) => x.id === o.id)?.reference ?? o.id).join(", ");

  const errors = {
    status: !target ? t("admin.status.statusRequired") : null,
    received:
      target && included.length === 0
        ? singleMode
          ? t("admin.status.receiveFirstOne", { reference: singleMode.reference })
          : t("admin.status.receiveFirstAll")
        : null,
    name: !completed
      ? null
      : !name.trim()
        ? t("admin.status.pickedUpByRequired")
        : name.trim().length > NAME_MAX
          ? t("admin.status.pickedUpByTooLong")
          : null,
    reason: override && !reason.trim() ? t("admin.status.overrideRequired") : null,
    message:
      message.trim().length > MESSAGE_MAX
        ? t("admin.status.messageTooLong")
        : stage === "action_required" && !message.trim()
          ? t("admin.status.messageRequired")
          : null,
  };
  const valid = !Object.values(errors).some(Boolean);

  const save = useMutation({
    mutationFn: async () => {
      const base = {
        orderIds,
        toStatus: code,
        customerMessage: message.trim() || null,
        notifyCustomer: notify,
      };
      return completed
        ? submitPickup({
            ...base,
            pickedUpByName: name.trim(),
            overrideReason: override ? reason.trim().slice(0, REASON_MAX) : null,
          })
        : submitStatusChange({ ...base, pickedUpByName: null });
    },
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: async (result) => {
      const label = target?.label_nl ?? code;
      const parts: string[] = [];
      if (result.changed.length === 0) {
        parts.push(t("admin.status.nothingChanged"));
      } else if (remessage && singleMode) {
        parts.push(t("admin.status.messageSent", { reference: singleMode.reference }));
      } else {
        parts.push(
          single && result.changed.length === 1
            ? t("admin.status.successOne", { reference: single.reference, status: label })
            : t("admin.status.successMany", {
                count: formatNumber(result.changed.length, 0),
                status: label,
              }),
        );
        if (result.unchanged.length > 0) {
          parts.push(
            t(
              result.unchanged.length === 1
                ? "admin.status.unchangedOne"
                : "admin.status.unchangedMany",
              { count: formatNumber(result.unchanged.length, 0) },
            ),
          );
        }
      }
      if (notReceived.length > 0) {
        parts.push(
          t(notReceived.length === 1 ? "admin.status.skippedOne" : "admin.status.skippedMany", {
            count: formatNumber(notReceived.length, 0),
          }),
        );
      }
      // What happened to the "statusupdate" e-mails (one per customer).
      const emailSummary = statusEmailSummary(result.emailOutcomes);
      if (emailSummary) parts.push(emailSummary);
      const text = parts.join(" ");
      if (result.changed.length === 0) toast.info(text);
      else toast.success(text);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.orders(userId) }),
        queryClient.invalidateQueries({ queryKey: adminKeys.tasks(userId) }),
      ]);
      if (result.followUps.length > 0) onFollowUps(result.followUps);
      else onClose();
    },
    onError: (error) => {
      const app = toAppError(error);
      if (app.hint === "pay_before_pickup") {
        setServerBlocked(true);
        void unpaid.refetch();
      }
      setProblem(app.message);
      toast.error(errorMessage(error));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setProblem(null);
    if (!valid || checking) {
      // The first field with a problem, in the order of the form.
      const field =
        errors.status || errors.received
          ? "status"
          : errors.name
            ? "name"
            : errors.reason
              ? "reason"
              : errors.message
                ? "message"
                : null;
      if (field) document.getElementById(`${id}-${field}`)?.focus();
      return;
    }
    save.mutate();
  };

  const choose = (next: string) => {
    setCode(next);
    const status = statuses.get(next);
    setNotify(status ? defaultNotify(status) : false);
    setServerBlocked(false);
    setProblem(null);
  };

  const show = (error: string | null) => (submitted ? error : null);
  const current = singleMode ? statuses.get(singleMode.status) : undefined;
  const statusErrorId = `${id}-status-error`;
  const statusError = show(errors.status) ?? show(errors.received);

  return (
    <form noValidate onSubmit={submit} className="min-w-0 space-y-5" data-dialog={id}>
      <DialogHeader>
        <DialogTitle className="font-heading text-primary">
          {completed
            ? t("admin.status.titlePickup")
            : heading
              ? heading.title
              : singleMode
                ? t("admin.status.title")
                : t("admin.status.titleBulk", { count: formatNumber(orders.length, 0) })}
        </DialogTitle>
        <DialogDescription>
          {heading
            ? heading.description
            : singleMode
              ? t("admin.status.intro", {
                  reference: singleMode.reference,
                  status: current?.label_nl ?? singleMode.status,
                })
              : t("admin.status.introBulk", { count: formatNumber(orders.length, 0) })}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-status`}>{t("admin.status.status")}</Label>
        <Select value={code} onValueChange={choose}>
          <SelectTrigger
            id={`${id}-status`}
            className="h-11 sm:h-10"
            aria-invalid={statusError ? true : undefined}
            aria-describedby={statusError ? statusErrorId : undefined}
          >
            <SelectValue placeholder={t("admin.status.choose")} />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {STAGE_DISPLAY_ORDER.map((group) => {
              const items = options.filter((s) => s.stage === group);
              if (items.length === 0) return null;
              return (
                <SelectGroup key={group}>
                  <SelectLabel className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t(`portal.stages.${group}`)}
                  </SelectLabel>
                  {items.map((s) => {
                    const isCurrent = singleMode?.status === s.code;
                    const newMessage = isCurrent && s.stage === "action_required";
                    return (
                      <SelectItem key={s.code} value={s.code} disabled={isCurrent && !newMessage}>
                        {s.label_nl}
                        {newMessage
                          ? ` (${t("admin.status.currentNewMessage")})`
                          : isCurrent
                            ? ` (${t("admin.status.current")})`
                            : ""}
                        {!s.customer_visible ? ` (${t("admin.status.hidden")})` : ""}
                      </SelectItem>
                    );
                  })}
                </SelectGroup>
              );
            })}
          </SelectContent>
        </Select>
        <FieldError id={statusErrorId} message={statusError} />
        {remessage ? (
          <p className="text-xs leading-5 text-muted-foreground">
            {t("admin.status.newMessageHint")}
          </p>
        ) : target?.customer_description_nl ? (
          <p className="text-xs leading-5 text-muted-foreground">
            {target.customer_description_nl}
          </p>
        ) : null}
        {perCustomer ? (
          <p className="flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t("admin.status.handoverPerCustomer", {
              count: formatNumber(openCustomers.size, 0),
            })}
          </p>
        ) : null}
      </div>

      {notReceived.length > 0 && target ? (
        <Callout
          tone={included.length === 0 ? "danger" : "warning"}
          icon={Scale}
          title={t("admin.status.notReceivedTitle")}
        >
          {t(
            included.length === 0
              ? "admin.status.notReceivedAll"
              : notReceived.length === 1
                ? "admin.status.notReceivedOne"
                : "admin.status.notReceivedMany",
            {
              references: references(notReceived),
              count: formatNumber(notReceived.length, 0),
            },
          )}
        </Callout>
      ) : null}

      {completed ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-name`}>{t("admin.status.pickedUpBy")}</Label>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX + 50}
            autoComplete="off"
            className="h-11 sm:h-10"
            aria-invalid={show(errors.name) ? true : undefined}
            aria-describedby={`${id}-name-hint${show(errors.name) ? ` ${id}-name-error` : ""}`}
          />
          <p id={`${id}-name-hint`} className="text-xs text-muted-foreground">
            {t("admin.status.pickedUpByHint")}
          </p>
          <FieldError id={`${id}-name-error`} message={show(errors.name)} />
        </div>
      ) : null}

      {checking ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t("admin.status.checking")}
        </p>
      ) : null}
      {checksFailed ? (
        <Callout tone="danger" icon={AlertTriangle} title={t("admin.status.checksFailed")}>
          {errorMessage(unpaid.error ?? customsDocs.error)}
        </Callout>
      ) : null}

      {override ? (
        <Callout tone="danger" icon={PackageCheck} title={t("admin.status.unpaidTitle")}>
          <p>{t("admin.status.unpaidText")}</p>
          {blockers.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {blockers.map((b) => (
                <li key={b.orderId} className="tabular-nums">
                  {t("admin.status.unpaidLine", {
                    reference: references([{ id: b.orderId }]),
                    invoices: b.invoiceNumbers.join(", "),
                  })}{" "}
                  (<CurrencyAmounts amounts={b.unpaid} />)
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 space-y-1.5">
            <Label htmlFor={`${id}-reason`}>{t("admin.status.overrideReason")}</Label>
            <Textarea
              id={`${id}-reason`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={REASON_MAX}
              className="bg-card"
              aria-invalid={show(errors.reason) ? true : undefined}
              aria-describedby={`${id}-reason-hint${show(errors.reason) ? ` ${id}-reason-error` : ""}`}
            />
            <p id={`${id}-reason-hint`} className="text-xs text-muted-foreground">
              {t("admin.status.overrideHint")}
            </p>
            <FieldError id={`${id}-reason-error`} message={show(errors.reason)} />
          </div>
        </Callout>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-message`}>
          {t("admin.status.message")}
          {stage !== "action_required" ? (
            <span className="font-normal text-muted-foreground">
              {" "}
              ({t("portal.orderForm.optional")})
            </span>
          ) : null}
        </Label>
        <Textarea
          id={`${id}-message`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder={
            stage === "action_required" ? t("admin.status.messagePlaceholderAction") : undefined
          }
          aria-invalid={show(errors.message) ? true : undefined}
          aria-describedby={`${id}-message-hint${show(errors.message) ? ` ${id}-message-error` : ""}`}
        />
        <p id={`${id}-message-hint`} className="text-xs text-muted-foreground">
          {visible ? t("admin.status.messageVisible") : t("admin.status.messageHidden")}
        </p>
        <FieldError id={`${id}-message-error`} message={show(errors.message)} />
      </div>

      <div className="rounded-md border bg-cream/50 px-3 py-2.5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor={`${id}-notify`}>{t("admin.status.notify")}</Label>
            <p id={`${id}-notify-hint`} className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {visible ? t("admin.status.notifyHint") : t("admin.status.notifyHidden")}
            </p>
          </div>
          <Switch
            id={`${id}-notify`}
            checked={visible && notify}
            disabled={!visible || !target}
            onCheckedChange={setNotify}
            aria-describedby={`${id}-notify-hint${emailOff && visible ? ` ${id}-email-off` : ""}`}
            className="mt-1"
          />
        </div>
        {emailOff && visible ? (
          <p
            id={`${id}-email-off`}
            className="mt-2 flex items-start gap-1.5 border-t pt-2 text-xs leading-5 text-foreground"
          >
            <MailX className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
            {t("email.notConfigured")}
          </p>
        ) : null}
      </div>

      {missingDocs.length > 0 ? (
        <Callout tone="warning" icon={Briefcase} title={t("admin.status.b2bTitle")}>
          {t("admin.status.b2bText", { references: references(missingDocs) })}
        </Callout>
      ) : null}

      {problem ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {t("admin.status.failed")} {problem}
          </span>
        </p>
      ) : null}

      {/* Stays in view while the dialog scrolls (long hand-over forms on phones). */}
      <DialogFooter className="sticky -bottom-6 z-10 -mx-6 -mb-6 gap-2 border-t bg-card px-6 py-4">
        <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
          {t("admin.status.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={save.isPending || checking}
          variant={override ? "destructive" : "default"}
        >
          {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          {save.isPending
            ? t("admin.status.submitting")
            : override
              ? t("admin.status.override")
              : completed
                ? t("admin.status.submitPickup")
                : remessage
                  ? t("admin.status.submitMessage")
                  : t("admin.status.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}
