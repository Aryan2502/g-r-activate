import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Ban,
  Copy,
  Info,
  Loader2,
  MessageCircle,
  Percent,
  Undo2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { Callout, FieldError } from "@/components/admin/Callout";
import { Problem, ReasonField } from "@/components/admin/customers/CustomerActionDialogs";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Constants } from "@/integrations/supabase/types";
import {
  NOTE_MAX,
  PAYMENT_METHODS,
  REASON_MAX,
  REFERENCE_MAX,
  initialPaymentForm,
  invoiceShareText,
  lateFeePreview,
  parseMoneyInput,
  validatePaymentForm,
  validateReason,
  type FormErrors,
  type PaymentFormField,
  type PaymentFormValues,
  type PaymentMethod,
} from "@/lib/admin/invoice-actions";
import { newInvoiceSearch } from "@/lib/admin/invoice-builder";
import { invalidateInvoices } from "@/lib/admin/invoice-queries";
import { adminKeys } from "@/lib/admin/keys";
import { whatsappHref } from "@/lib/admin/invitations";
import { copyToClipboard } from "@/lib/clipboard";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatMoney, type CurrencyCode } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { formatPercent, type InvoiceRenderModel } from "@/lib/invoice/model";
import { phoneDigits } from "@/lib/phone";
import {
  fetchInvoiceShare,
  submitApplyLateFee,
  submitCancelInvoice,
  submitMarkPaid,
  submitRecordPayment,
  submitVoidPayment,
} from "@/lib/server-fns/invoices.functions";

/**
 * The dialogs of an issued invoice's page (SPEC §17, §35.9, §35.10, §35.12):
 * payments (staff), voiding a payment, cancelling, "Corrigeren" and the late
 * fee (admins), and "Deel via WhatsApp". Each writes through a server
 * function with the staff member's own client; the database checks every
 * rule again. Errors show inline and as a toast; nothing claims an e-mail
 * went out unless the server says so.
 */

/** What the dialogs need to know about the invoice (from invoice_overview). */
export interface InvoiceActionTarget {
  id: string;
  invoiceNumber: string;
  customerId: string;
  currency: CurrencyCode;
  total: number;
  amountPaid: number;
  balance: number;
}

const DIALOG = "max-h-[92vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-card sm:max-w-lg";

function focusFirst(prefix: string, fields: readonly string[], errors: Record<string, unknown>) {
  const first = fields.find((f) => errors[f]);
  if (first) document.getElementById(`${prefix}-${first}`)?.focus();
}

// ---------------------------------------------------------------------------
// "Betaling registreren" / "Markeer als betaald"
// ---------------------------------------------------------------------------

const PAYMENT_FIELDS: readonly PaymentFormField[] = [
  "amount",
  "paidOn",
  "method",
  "reference",
  "receivedAmount",
  "receivedCurrency",
  "customerNote",
];
const NO_CURRENCY = "none";

export function PaymentDialog({
  userId,
  invoice,
  mode,
  open,
  onOpenChange,
}: {
  userId: string;
  invoice: InvoiceActionTarget;
  /** "full": "Markeer als betaald" (the whole balance, no amount field). */
  mode: "amount" | "full";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<PaymentFormValues>(() =>
    initialPaymentForm({ balance: invoice.balance }),
  );
  const [errors, setErrors] = useState<FormErrors<PaymentFormField>>({});
  const [problem, setProblem] = useState<string | null>(null);
  // The balance when the dialog opened: a refetch while it is open (another
  // session recorded a payment or a late fee) shows a notice instead of
  // silently replacing what was typed.
  const [openedBalance, setOpenedBalance] = useState(invoice.balance);
  const wasOpen = useRef(false);

  // A fresh form each time the dialog opens (not on every refetch while open).
  useEffect(() => {
    if (open && !wasOpen.current) {
      setValues(initialPaymentForm({ balance: invoice.balance }));
      setOpenedBalance(invoice.balance);
      setErrors({});
      setProblem(null);
    }
    wasOpen.current = open;
  }, [open, invoice.balance]);

  const save = useMutation({
    mutationFn: (input: ReturnType<typeof validatePaymentForm> & { ok: true }) =>
      mode === "full" ? submitMarkPaid(input.markPaid) : submitRecordPayment(input.record),
    onSuccess: async (result, input) => {
      const description = result.emailed
        ? t("admin.invoices.payment.emailed")
        : t("admin.invoices.payment.noEmail");
      if (result.invoiceStatus === "paid") {
        toast.success(t("admin.invoices.payment.successPaid", { number: invoice.invoiceNumber }), {
          description,
        });
      } else {
        const paid = mode === "full" ? input.markPaid.amount : input.record.amount;
        toast.success(
          t("admin.invoices.payment.success", {
            amount: formatMoney(paid, invoice.currency),
          }),
          {
            description:
              mode === "full"
                ? `${t("admin.invoices.payment.partialAfterChange", {
                    balance: formatMoney(result.balanceDue, invoice.currency),
                  })} ${description}`
                : description,
          },
        );
      }
      await invalidateInvoices(queryClient, userId);
      onOpenChange(false);
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(t("admin.invoices.payment.failed"), { description: errorMessage(e) });
    },
  });

  const set = <K extends PaymentFormField>(key: K, value: PaymentFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const result = validatePaymentForm(values, {
      invoiceId: invoice.id,
      balance: invoice.balance,
      currency: invoice.currency,
      mode,
    });
    if (!result.ok) {
      setErrors(result.errors);
      focusFirst(id, PAYMENT_FIELDS, result.errors);
      return;
    }
    setErrors({});
    save.mutate(result);
  };

  const balance = formatMoney(invoice.balance, invoice.currency);
  const balanceChanged = open && openedBalance !== invoice.balance;
  const typed = parseMoneyInput(values.amount);
  const field = (name: PaymentFormField) => ({
    id: `${id}-${name}`,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": `${id}-${name}-hint ${id}-${name}-error`,
  });
  const hasErrors = Object.values(errors).some(Boolean);

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className={DIALOG}>
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {mode === "full"
              ? t("admin.invoices.payment.titleFull")
              : t("admin.invoices.payment.title")}
          </DialogTitle>
          <DialogDescription>
            {mode === "full"
              ? t("admin.invoices.payment.fullIntro", { balance })
              : t("admin.invoices.payment.intro", { number: invoice.invoiceNumber, balance })}
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="min-w-0 space-y-4">
          {balanceChanged ? (
            <Callout
              tone="warning"
              icon={AlertTriangle}
              title={t("admin.invoices.payment.balanceChanged", {
                balance,
                before: formatMoney(openedBalance, invoice.currency),
              })}
            />
          ) : null}
          {hasErrors ? (
            <p role="alert" className="text-sm font-semibold text-destructive">
              {t("admin.invoices.payment.validation.summary")}
            </p>
          ) : null}
          {mode === "amount" ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-amount`}>
                {t("admin.invoices.payment.amount", { currency: invoice.currency })}
              </Label>
              <Input
                {...field("amount")}
                inputMode="decimal"
                autoComplete="off"
                value={values.amount}
                onChange={(e) => set("amount", e.target.value)}
                className="h-11 tabular-nums sm:h-10"
              />
              <p id={`${id}-amount-hint`} className="text-xs text-muted-foreground">
                {t("admin.invoices.payment.amountHint")}
                {typed.kind === "ok" && typed.value > 0 ? (
                  <>
                    {" "}
                    <span className="font-semibold text-foreground tabular-nums" aria-live="polite">
                      {t("admin.invoices.payment.amountEcho", {
                        amount: formatMoney(typed.value, invoice.currency),
                      })}
                    </span>
                  </>
                ) : null}
              </p>
              <FieldError id={`${id}-amount-error`} message={errors.amount ?? null} />
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${id}-paidOn`}>{t("admin.invoices.payment.paidOn")}</Label>
              <Input
                {...field("paidOn")}
                type="date"
                value={values.paidOn}
                onChange={(e) => set("paidOn", e.target.value)}
                className="h-11 sm:h-10"
              />
              <p id={`${id}-paidOn-hint`} className="text-xs text-muted-foreground tabular-nums">
                {/^\d{4}-\d{2}-\d{2}$/.test(values.paidOn)
                  ? t("admin.invoiceBuilder.chosenDate", { date: formatDate(values.paidOn) })
                  : null}
              </p>
              <FieldError id={`${id}-paidOn-error`} message={errors.paidOn ?? null} />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${id}-method`}>{t("admin.invoices.payment.method")}</Label>
              <Select
                value={values.method}
                onValueChange={(v) => {
                  const method = PAYMENT_METHODS.find((m) => m === v);
                  if (method) set("method", method);
                }}
              >
                <SelectTrigger {...field("method")} className="h-11 sm:h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m: PaymentMethod) => (
                    <SelectItem key={m} value={m}>
                      {t(`admin.customers.detail.paymentMethods.${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span id={`${id}-method-hint`} hidden />
              <FieldError id={`${id}-method-error`} message={errors.method ?? null} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-reference`}>{t("admin.invoices.payment.reference")}</Label>
            <Input
              {...field("reference")}
              value={values.reference}
              maxLength={REFERENCE_MAX + 20}
              onChange={(e) => set("reference", e.target.value)}
              className="h-11 sm:h-10"
            />
            <p id={`${id}-reference-hint`} className="text-xs text-muted-foreground">
              {t("admin.invoices.payment.referenceHint")}
            </p>
            <FieldError id={`${id}-reference-error`} message={errors.reference ?? null} />
          </div>

          {mode === "amount" ? (
            <fieldset className="min-w-0 space-y-2 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">
                {t("admin.invoices.payment.received")}
              </legend>
              <p id={`${id}-receivedAmount-hint`} className="text-xs text-muted-foreground">
                {t("admin.invoices.payment.receivedHint")}
              </p>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor={`${id}-receivedAmount`}>
                    {t("admin.invoices.payment.receivedAmount")}
                  </Label>
                  <Input
                    {...field("receivedAmount")}
                    inputMode="decimal"
                    autoComplete="off"
                    value={values.receivedAmount}
                    onChange={(e) => set("receivedAmount", e.target.value)}
                    className="h-11 tabular-nums sm:h-10"
                  />
                  <FieldError
                    id={`${id}-receivedAmount-error`}
                    message={errors.receivedAmount ?? null}
                  />
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor={`${id}-receivedCurrency`}>
                    {t("admin.invoices.payment.receivedCurrency")}
                  </Label>
                  <Select
                    value={values.receivedCurrency || NO_CURRENCY}
                    onValueChange={(v) =>
                      set(
                        "receivedCurrency",
                        Constants.public.Enums.currency_code.find((c) => c === v) ?? "",
                      )
                    }
                  >
                    <SelectTrigger {...field("receivedCurrency")} className="h-11 sm:h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CURRENCY}>
                        {t("admin.invoices.payment.noCurrency")}
                      </SelectItem>
                      {Constants.public.Enums.currency_code.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span id={`${id}-receivedCurrency-hint`} hidden />
                  <FieldError
                    id={`${id}-receivedCurrency-error`}
                    message={errors.receivedCurrency ?? null}
                  />
                </div>
              </div>
            </fieldset>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-customerNote`}>{t("admin.invoices.payment.customerNote")}</Label>
            <Textarea
              {...field("customerNote")}
              rows={2}
              maxLength={NOTE_MAX + 20}
              value={values.customerNote}
              onChange={(e) => set("customerNote", e.target.value)}
            />
            <p id={`${id}-customerNote-hint`} className="text-xs text-muted-foreground">
              {t("admin.invoices.payment.customerNoteHint")}
            </p>
            <FieldError id={`${id}-customerNote-error`} message={errors.customerNote ?? null} />
          </div>

          <Problem prefix={t("admin.invoices.payment.failed")} message={problem} />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={() => onOpenChange(false)}
            >
              {t("admin.invoices.payment.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Wallet aria-hidden />
              )}
              {save.isPending
                ? t("admin.invoices.payment.saving")
                : mode === "full"
                  ? t("admin.invoices.payment.submitFull")
                  : t("admin.invoices.payment.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// "Betaling ongedaan maken" (admin)
// ---------------------------------------------------------------------------

export function VoidPaymentDialog({
  userId,
  payment,
  currency,
  open,
  onOpenChange,
}: {
  userId: string;
  payment: { id: string; amount: number; paid_on: string } | null;
  currency: CurrencyCode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
      setProblem(null);
    }
  }, [open]);

  const voidIt = useMutation({
    mutationFn: (input: { paymentId: string; reason: string }) => submitVoidPayment(input),
    onSuccess: async () => {
      toast.success(t("admin.invoices.voidPayment.success"));
      await invalidateInvoices(queryClient, userId);
      onOpenChange(false);
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(t("admin.invoices.voidPayment.failed"), { description: errorMessage(e) });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const invalid = validateReason(reason);
    setError(invalid);
    if (invalid || !payment) {
      document.getElementById(`${id}-reason`)?.focus();
      return;
    }
    voidIt.mutate({ paymentId: payment.id, reason: reason.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !voidIt.isPending && onOpenChange(next)}>
      <DialogContent className={DIALOG}>
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {t("admin.invoices.voidPayment.title")}
          </DialogTitle>
          <DialogDescription>
            {payment
              ? t("admin.invoices.voidPayment.text", {
                  amount: formatMoney(payment.amount, currency),
                  date: formatDate(payment.paid_on),
                })
              : null}
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="min-w-0 space-y-4">
          <ReasonField
            id={`${id}-reason`}
            label={t("admin.invoices.voidPayment.reason")}
            hint={t("admin.invoices.validation.tooLong", { max: REASON_MAX })}
            value={reason}
            onChange={(v) => {
              setReason(v);
              if (error) setError(null);
            }}
            error={error}
          />
          <Problem prefix={t("admin.invoices.voidPayment.failed")} message={problem} />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={voidIt.isPending}
              onClick={() => onOpenChange(false)}
            >
              {t("admin.invoices.voidPayment.cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={voidIt.isPending}>
              {voidIt.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Undo2 aria-hidden />
              )}
              {voidIt.isPending
                ? t("admin.invoices.voidPayment.working")
                : t("admin.invoices.voidPayment.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// "Factuur annuleren" and "Corrigeren" (admin)
// ---------------------------------------------------------------------------

/**
 * cancel_invoice with a reason the customer sees. "Corrigeren" does the same
 * and then opens the builder for a new draft that replaces this invoice
 * (same customer and orders; ?replaces= sets replaces_invoice_id).
 */
export function CancelInvoiceDialog({
  userId,
  invoice,
  mode,
  orderIds,
  open,
  onOpenChange,
}: {
  userId: string;
  invoice: InvoiceActionTarget;
  mode: "cancel" | "correct";
  /** The orders on the invoice: the correction starts with them. */
  orderIds: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const key = mode === "correct" ? "correct" : "cancelInvoice";
  const blocked = invoice.amountPaid > 0;

  useEffect(() => {
    if (open) {
      setReason(mode === "correct" ? t("admin.invoices.correct.defaultReason") : "");
      setError(null);
      setProblem(null);
    }
  }, [open, mode, t]);

  const cancel = useMutation({
    mutationFn: (input: { invoiceId: string; reason: string }) => submitCancelInvoice(input),
    onSuccess: async (result) => {
      await invalidateInvoices(queryClient, userId);
      onOpenChange(false);
      if (mode === "correct") {
        toast.success(t("admin.invoices.correct.success", { number: invoice.invoiceNumber }));
        await navigate({
          to: "/admin/facturen/nieuw",
          search: {
            ...newInvoiceSearch({ customerId: result.customerId, orderIds, from: "customer" }),
            replaces: result.invoiceId,
          },
        });
      } else {
        toast.success(t("admin.invoices.cancelInvoice.success", { number: invoice.invoiceNumber }));
      }
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(t(`admin.invoices.${key}.failed`), { description: errorMessage(e) });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const invalid = validateReason(reason);
    setError(invalid);
    if (invalid) {
      document.getElementById(`${id}-reason`)?.focus();
      return;
    }
    cancel.mutate({ invoiceId: invoice.id, reason: reason.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !cancel.isPending && onOpenChange(next)}>
      <DialogContent className={DIALOG}>
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {t(`admin.invoices.${key}.title`, { number: invoice.invoiceNumber })}
          </DialogTitle>
          <DialogDescription>{t(`admin.invoices.${key}.text`)}</DialogDescription>
        </DialogHeader>
        {blocked ? (
          <>
            <Callout
              tone="warning"
              icon={AlertTriangle}
              title={t("admin.invoices.cancelInvoice.hasPayments")}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t(`admin.invoices.${key}.cancel`)}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form noValidate onSubmit={submit} className="min-w-0 space-y-4">
            <ReasonField
              id={`${id}-reason`}
              label={t(`admin.invoices.${key}.reason`)}
              hint={t("admin.invoices.cancelInvoice.reasonHint")}
              value={reason}
              onChange={(v) => {
                setReason(v);
                if (error) setError(null);
              }}
              error={error}
            />
            <Problem prefix={t(`admin.invoices.${key}.failed`)} message={problem} />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                disabled={cancel.isPending}
                onClick={() => onOpenChange(false)}
              >
                {t(`admin.invoices.${key}.cancel`)}
              </Button>
              <Button type="submit" variant="destructive" disabled={cancel.isPending}>
                {cancel.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Ban aria-hidden />
                )}
                {cancel.isPending
                  ? t(`admin.invoices.${key}.working`)
                  : t(`admin.invoices.${key}.confirm`)}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// "Opslag 15% toepassen" (admin, overdue only)
// ---------------------------------------------------------------------------

export function LateFeeDialog({
  userId,
  invoice,
  percent,
  open,
  onOpenChange,
}: {
  userId: string;
  invoice: InvoiceActionTarget;
  /** From the invoice's own terms (issuer_snapshot), as apply_late_fee uses. */
  percent: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const money = (n: number) => formatMoney(n, invoice.currency);
  const preview = lateFeePreview(
    { balance_due: invoice.balance, total_amount: invoice.total },
    percent,
  );
  const pct = formatPercent(percent);

  useEffect(() => {
    if (open) setProblem(null);
  }, [open]);

  const apply = useMutation({
    mutationFn: () => submitApplyLateFee({ invoiceId: invoice.id }),
    onSuccess: async (result) => {
      toast.success(
        t("admin.invoices.lateFee.success", {
          number: invoice.invoiceNumber,
          total: money(result.totalAmount),
        }),
      );
      await invalidateInvoices(queryClient, userId);
      onOpenChange(false);
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(t("admin.invoices.lateFee.failed"), { description: errorMessage(e) });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !apply.isPending && onOpenChange(next)}>
      <DialogContent className={DIALOG}>
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {t("admin.invoices.lateFee.title")}
          </DialogTitle>
          <DialogDescription>
            {t("admin.invoices.lateFee.text", {
              number: invoice.invoiceNumber,
              percent: pct,
              balance: money(invoice.balance),
            })}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 rounded-md border bg-cream/40 p-3 text-sm">
          <dt className="text-muted-foreground">
            {t("admin.invoices.lateFee.fee")} ({pct}%)
          </dt>
          <dd className="text-right font-semibold tabular-nums">{money(preview.fee)}</dd>
          <dt className="text-muted-foreground">{t("admin.invoices.lateFee.newTotal")}</dt>
          <dd className="text-right tabular-nums">{money(preview.newTotal)}</dd>
          <dt className="text-muted-foreground">{t("admin.invoices.lateFee.newBalance")}</dt>
          <dd className="text-right font-semibold tabular-nums">{money(preview.newBalance)}</dd>
        </dl>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          {t("admin.invoices.lateFee.line", { percent: pct })}
        </p>
        <Problem prefix={t("admin.invoices.lateFee.failed")} message={problem} />
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            disabled={apply.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("admin.invoices.lateFee.cancel")}
          </Button>
          <Button
            type="button"
            disabled={apply.isPending || preview.fee <= 0}
            onClick={() => {
              setProblem(null);
              apply.mutate();
            }}
          >
            {apply.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Percent aria-hidden />
            )}
            {apply.isPending
              ? t("admin.invoices.lateFee.working")
              : t("admin.invoices.lateFee.confirm", { fee: money(preview.fee) })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// "Deel via WhatsApp" (SPEC §35.12)
// ---------------------------------------------------------------------------

export interface ShareInvoiceInfo {
  id: string;
  invoiceNumber: string;
  status: "open" | "partially_paid" | "paid";
  isOverdue: boolean;
  total: number;
  amountPaid: number;
  balance: number;
  dueDate: string;
  paidAt: string | null;
}

/**
 * The message is prepared when the dialog opens (the server decides the
 * portal link: APP_URL, and only for a customer with a login), shown for a
 * last check or edit, then opened in WhatsApp by a plain link, so the
 * browser never blocks it as a pop-up.
 */
export function ShareInvoiceDialog({
  userId,
  invoice,
  model,
  open,
  onOpenChange,
}: {
  userId: string;
  invoice: ShareInvoiceInfo;
  /** The invoice as printed (snapshots): name, code, company, bank account. */
  model: InvoiceRenderModel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const share = useQuery({
    queryKey: [...adminKeys.invoice(userId, invoice.id), "share"] as const,
    queryFn: () => fetchInvoiceShare({ invoiceId: invoice.id }),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const [text, setText] = useState("");
  const prepared = useRef<string | null>(null);

  const composed = share.data
    ? invoiceShareText({
        customerName: model.billTo.fullName,
        customerCode: model.billTo.customerCode,
        companyName: model.issuer.companyName,
        invoiceNumber: invoice.invoiceNumber,
        currency: model.meta.currency,
        total: invoice.total,
        balance: invoice.balance,
        amountPaid: invoice.amountPaid,
        dueDate: invoice.dueDate,
        status: invoice.status,
        isOverdue: invoice.isOverdue,
        paidAt: invoice.paidAt,
        bank: model.issuer.bankAccounts.find((b) => b.currency === model.meta.currency) ?? null,
        portalUrl: share.data.portalUrl,
      })
    : null;

  // Fill the editable message once per opening, when it is ready.
  useEffect(() => {
    if (!open) {
      prepared.current = null;
      return;
    }
    if (composed !== null && prepared.current === null) {
      prepared.current = composed;
      setText(composed);
    }
  }, [open, composed]);

  const phone = share.data?.phone ?? null;
  let body: ReactNode;
  if (share.isError) {
    body = (
      <Problem prefix={t("admin.invoices.share.failed")} message={errorMessage(share.error)} />
    );
  } else if (!share.data || prepared.current === null) {
    body = (
      <div className="space-y-2" aria-busy="true">
        <span className="sr-only">{t("admin.invoices.share.loading")}</span>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  } else {
    body = (
      <div className="min-w-0 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-text`}>{t("admin.invoices.share.message")}</Label>
          <Textarea
            id={`${id}-text`}
            rows={12}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="text-sm"
          />
        </div>
        {share.data.portalUrl === null ? (
          <Callout tone="info" icon={Info} title={t("admin.invoices.share.noLogin")} />
        ) : share.data.linkSource === "request" ? (
          <p className="text-xs text-muted-foreground">
            {t("admin.invitations.requestBase", {
              base: (() => {
                try {
                  return new URL(share.data.portalUrl).origin;
                } catch {
                  return share.data.portalUrl;
                }
              })(),
            })}
          </p>
        ) : null}
        {phoneDigits(phone) === null ? (
          <p className="text-xs text-muted-foreground">{t("admin.invoices.share.noPhone")}</p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button asChild>
            <a href={whatsappHref(phone, text)} target="_blank" rel="noopener noreferrer">
              <MessageCircle aria-hidden />
              {t("admin.invoices.share.open")}
            </a>
          </Button>
          <Button type="button" variant="outline" onClick={() => void copyToClipboard(text)}>
            <Copy aria-hidden />
            {t("admin.invoices.share.copy")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG}>
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {t("admin.invoices.share.title")}
          </DialogTitle>
          <DialogDescription>{t("admin.invoices.share.intro")}</DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("admin.invoices.share.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
