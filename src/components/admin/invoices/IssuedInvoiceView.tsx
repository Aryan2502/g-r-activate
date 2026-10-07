import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Ban,
  BellRing,
  CircleAlert,
  CircleCheck,
  FilePen,
  FilePlus2,
  Info,
  MessageCircle,
  Percent,
  Printer,
  Receipt,
  Undo2,
  UserRound,
  Wallet,
} from "lucide-react";

import { Callout } from "@/components/admin/Callout";
import {
  CancelInvoiceDialog,
  LateFeeDialog,
  PaymentDialog,
  ShareInvoiceDialog,
  VoidPaymentDialog,
  type InvoiceActionTarget,
} from "@/components/admin/invoices/InvoiceDialogs";
import { InvoicePreview } from "@/components/invoice/InvoiceDocument";
import { LoadError, Section } from "@/components/portal/Section";
import { InvoiceStatusBadge } from "@/components/portal/StatusBadges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { canApplyLateFee } from "@/lib/admin/invoice-actions";
import { newInvoiceSearch } from "@/lib/admin/invoice-builder";
import {
  invoicePaymentsQueryOptions,
  invoiceRelationsQueryOptions,
  invoiceViewQueryOptions,
  type InvoicePayment,
  type InvoiceViewRow,
} from "@/lib/admin/invoice-queries";
import { customerDisplayName, customersQueryOptions, peopleQueryOptions } from "@/lib/admin/orders";
import { companySettingsQueryOptions } from "@/lib/admin/settings-queries";
import type { AppRole } from "@/lib/auth/redirect";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { useT } from "@/lib/i18n";
import {
  formatPercent,
  fromIssuedInvoice,
  parseIssuerSnapshot,
  type InvoiceItemRow,
} from "@/lib/invoice/model";
import { cn } from "@/lib/utils";

/**
 * An issued (open, partially paid, paid or cancelled) invoice on
 * /admin/facturen/$id (SPEC §17, §35.9–§35.12): the document from its
 * snapshots, its status and balance from invoice_overview, the payments and
 * the reminder bookkeeping, and the actions: payments and "Markeer als
 * betaald" (staff), "Deel via WhatsApp", print/PDF, and for admins
 * cancelling, "Corrigeren", voiding a payment and the late fee.
 */
export function IssuedInvoiceView({
  userId,
  role,
  invoiceId,
  back,
}: {
  userId: string;
  role: AppRole;
  invoiceId: string;
  back: ReactNode;
}) {
  const t = useT();
  const view = useQuery(invoiceViewQueryOptions(userId, invoiceId));

  if (view.isError) {
    return (
      <>
        {back}
        <LoadError
          title={t("admin.invoices.detail.loadFailed")}
          error={view.error}
          onRetry={() => void view.refetch()}
        />
      </>
    );
  }
  if (!view.data) {
    return (
      <>
        {back}
        <div className="space-y-4" aria-busy="true">
          <span className="sr-only">{t("common.loading")}</span>
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-96 w-full" />
        </div>
      </>
    );
  }
  return (
    <InvoiceBody
      userId={userId}
      admin={role === "admin"}
      invoice={view.data.invoice}
      items={view.data.items}
      back={back}
    />
  );
}

type Dialog =
  | { kind: "payment" | "markPaid" | "share" | "cancel" | "correct" | "lateFee" }
  | { kind: "void"; payment: InvoicePayment }
  | null;

function InvoiceBody({
  userId,
  admin,
  invoice,
  items,
  back,
}: {
  userId: string;
  admin: boolean;
  invoice: InvoiceViewRow;
  items: InvoiceItemRow[];
  back: ReactNode;
}) {
  const t = useT();
  const id = invoice.id ?? "";
  const customers = useQuery(customersQueryOptions(userId));
  const payments = useQuery(invoicePaymentsQueryOptions(userId, id));
  const settings = useQuery(companySettingsQueryOptions(userId));
  const relations = useQuery(invoiceRelationsQueryOptions(userId, id, invoice.replaces_invoice_id));
  const [dialog, setDialog] = useState<Dialog>(null);

  const model = useMemo(() => fromIssuedInvoice(invoice, items), [invoice, items]);
  const issuer = parseIssuerSnapshot(invoice.issuer_snapshot);
  const customer = (customers.data ?? []).find((c) => c.id === invoice.customer_id) ?? null;
  const peopleIds = [
    invoice.issued_by,
    invoice.cancelled_by,
    ...(payments.data ?? []).flatMap((p) => [p.recorded_by, p.voided_by]),
  ].filter((v): v is string => Boolean(v));
  const people = useQuery({
    ...peopleQueryOptions(userId, peopleIds),
    enabled: peopleIds.length > 0,
  });
  const name = (uid: string | null) => (uid ? (people.data?.get(uid) ?? null) : null);

  const currency = invoice.currency ?? "USD";
  const money = (n: number | null) => formatMoney(n ?? 0, currency);
  const status = invoice.status ?? "open";
  const number = invoice.invoice_number ?? "";
  const balance = invoice.balance_due ?? 0;
  const amountPaid = invoice.amount_paid ?? 0;
  const payable = (status === "open" || status === "partially_paid") && balance > 0;
  const cancelled = status === "cancelled";
  const lateFeePercent = issuer.lateFeePercent ?? settings.data?.late_fee_percent ?? null;
  const hasLateFeeLine = items.some((i) => i.line_type === "late_fee");
  const lateFeeOffered =
    admin && lateFeePercent !== null && canApplyLateFee(invoice, lateFeePercent, hasLateFeeLine);
  const orderIds = [...new Set(items.flatMap((i) => (i.order_id ? [i.order_id] : [])))];
  const target: InvoiceActionTarget = {
    id,
    invoiceNumber: number,
    customerId: invoice.customer_id ?? "",
    currency,
    total: invoice.total_amount ?? 0,
    amountPaid,
    balance,
  };
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };

  const actions = (
    <div className="flex flex-wrap gap-2">
      {payable ? (
        <>
          <Button onClick={() => setDialog({ kind: "payment" })}>
            <Wallet aria-hidden />
            {t("admin.invoices.actions.recordPayment")}
          </Button>
          <Button variant="outline" onClick={() => setDialog({ kind: "markPaid" })}>
            <CircleCheck aria-hidden />
            {t("admin.invoices.actions.markPaid")}
          </Button>
        </>
      ) : null}
      {!cancelled ? (
        <Button variant="outline" onClick={() => setDialog({ kind: "share" })}>
          <MessageCircle aria-hidden />
          {t("admin.invoices.actions.share")}
        </Button>
      ) : null}
      <Button variant="outline" asChild>
        <Link to="/admin/facturen/$id/print" params={{ id }} target="_blank">
          <Printer aria-hidden />
          {t("admin.invoices.actions.print")}
        </Link>
      </Button>
      {lateFeeOffered ? (
        <Button variant="outline" onClick={() => setDialog({ kind: "lateFee" })}>
          <Percent aria-hidden />
          {t("admin.invoices.actions.lateFee", { percent: formatPercent(lateFeePercent) })}
        </Button>
      ) : null}
      {/* A cancelled invoice that nothing replaces yet (e.g. "Corrigeren" was left
          before the new draft was saved): make the replacement from here. */}
      {cancelled && relations.data && relations.data.replacedBy.length === 0 && customer ? (
        <Button variant="outline" asChild>
          <Link
            to="/admin/facturen/nieuw"
            search={{
              ...newInvoiceSearch({ customerId: customer.id, orderIds, from: "customer" }),
              replaces: id,
            }}
          >
            <FilePlus2 aria-hidden />
            {t("admin.invoices.actions.replace")}
          </Link>
        </Button>
      ) : null}
      {admin && !cancelled ? (
        <>
          <Button variant="outline" onClick={() => setDialog({ kind: "correct" })}>
            <FilePen aria-hidden />
            {t("admin.invoices.actions.correct")}
          </Button>
          <Button
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive-soft hover:text-destructive"
            onClick={() => setDialog({ kind: "cancel" })}
          >
            <Ban aria-hidden />
            {t("admin.invoices.actions.cancel")}
          </Button>
        </>
      ) : null}
    </div>
  );

  const issuedBy = name(invoice.issued_by);
  const cancelledBy = name(invoice.cancelled_by);

  return (
    <>
      {back}
      <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between print:hidden">
        <div className="min-w-0">
          <h1 className="text-2xl text-primary tabular-nums sm:text-3xl">
            {t("admin.invoices.detail.title", { number })}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <InvoiceStatusBadge invoice={invoice} className="px-3 py-1 text-sm" />
            {customer ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <UserRound className="size-4 shrink-0 text-primary" aria-hidden />
                <Link
                  to="/admin/klanten/$id"
                  params={{ id: customer.id }}
                  className="font-semibold break-words text-primary underline-offset-4 hover:underline"
                >
                  {customerDisplayName(customer)}
                </Link>
                <span className="font-heading font-bold text-primary tabular-nums">
                  {customer.customer_code}
                </span>
              </span>
            ) : null}
            <span className="font-semibold tabular-nums">{money(invoice.total_amount)}</span>
          </div>
        </div>
      </div>
      <div className="mb-6 space-y-3 print:hidden">
        <div aria-label={t("admin.invoices.detail.actionsTitle")} role="group">
          {actions}
        </div>
        {!admin && !cancelled ? (
          <p className="text-xs text-muted-foreground">{t("admin.invoices.detail.adminOnly")}</p>
        ) : null}
      </div>

      <Notices
        invoice={invoice}
        cancelledBy={cancelledBy}
        noLogin={customer !== null && customer.user_id === null}
        relations={relations.data}
      />

      {/* xl: the document on the left over all rows; the cards stack on the right (the last row takes the rest). */}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_26rem] xl:grid-rows-[auto_auto_1fr]">
        <Section
          title={t("admin.invoices.detail.summaryTitle")}
          icon={Receipt}
          id="invoice-summary"
          className="xl:col-start-2 xl:row-start-1 print:hidden"
        >
          <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t("admin.invoices.detail.customer")}</dt>
            <dd className="min-w-0 break-words">
              {model.billTo.fullName}{" "}
              <span className="font-semibold text-primary tabular-nums">
                {model.billTo.customerCode}
              </span>
            </dd>
            <dt className="text-muted-foreground">{t("admin.invoices.detail.invoiceDate")}</dt>
            <dd className="tabular-nums">
              {invoice.invoice_date ? formatDate(invoice.invoice_date) : "–"}
            </dd>
            <dt className="text-muted-foreground">{t("admin.invoices.detail.dueDate")}</dt>
            <dd className="tabular-nums">
              {invoice.due_date ? formatDate(invoice.due_date) : "–"}
            </dd>
            <dt className="text-muted-foreground">{t("admin.invoices.detail.total")}</dt>
            <dd className="font-semibold tabular-nums">{money(invoice.total_amount)}</dd>
            <dt className="text-muted-foreground">{t("admin.invoices.detail.paid")}</dt>
            <dd className="tabular-nums">{money(amountPaid)}</dd>
            <dt className="text-muted-foreground">{t("admin.invoices.detail.balance")}</dt>
            <dd
              className={cn(
                "font-semibold tabular-nums",
                invoice.is_overdue ? "text-destructive" : "text-foreground",
              )}
            >
              {money(balance)}
            </dd>
          </dl>
          <ul className="mt-4 space-y-1 border-t pt-3 text-xs text-muted-foreground">
            {invoice.issued_at ? (
              <li className="tabular-nums">
                {issuedBy
                  ? t("admin.invoices.detail.issued", {
                      date: formatDateTime(invoice.issued_at),
                      name: issuedBy,
                    })
                  : t("admin.invoices.detail.issuedNoName", {
                      date: formatDateTime(invoice.issued_at),
                    })}
              </li>
            ) : null}
            {invoice.late_fee_applied_at ? (
              <li className="tabular-nums">
                {t("admin.invoices.detail.lateFeeApplied", {
                  date: formatDateTime(invoice.late_fee_applied_at),
                })}
              </li>
            ) : null}
          </ul>
        </Section>

        <section
          aria-label={t("admin.invoices.detail.documentLabel")}
          className="min-w-0 rounded-lg border bg-muted/60 p-2 sm:p-4 xl:col-start-1 xl:row-span-3 xl:row-start-1 print:border-0 print:bg-transparent print:p-0"
        >
          <InvoicePreview model={model} label={t("admin.invoices.detail.documentLabel")} />
        </section>

        <Section
          title={t("admin.invoices.payments.title")}
          icon={Wallet}
          id="invoice-payments"
          description={t("admin.invoices.payments.intro")}
          className="xl:col-start-2 print:hidden"
        >
          {payments.isError ? (
            <LoadError
              title={t("admin.invoices.payments.loadFailed")}
              error={payments.error}
              onRetry={() => void payments.refetch()}
            />
          ) : payments.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : payments.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("admin.invoices.payments.empty")}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {payments.data.map((p) => (
                <PaymentRow
                  key={p.id}
                  payment={p}
                  currency={currency}
                  recordedBy={name(p.recorded_by)}
                  voidedBy={name(p.voided_by)}
                  canVoid={admin && !cancelled && p.voided_at === null}
                  onVoid={() => setDialog({ kind: "void", payment: p })}
                />
              ))}
            </ul>
          )}
        </Section>

        <Section
          title={t("admin.invoices.reminders.title")}
          icon={BellRing}
          id="invoice-reminders"
          description={t("admin.invoices.reminders.intro")}
          className="xl:col-start-2 print:hidden"
        >
          {(invoice.reminder_count ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">{t("admin.invoices.reminders.none")}</p>
          ) : null}
          <dl className="mt-2 grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">{t("admin.invoices.reminders.count")}</dt>
            <dd className="tabular-nums">{formatNumber(invoice.reminder_count ?? 0, 0)}</dd>
            <dt className="text-muted-foreground">{t("admin.invoices.reminders.first")}</dt>
            <dd className="tabular-nums">
              {invoice.first_reminder_sent_at
                ? formatDateTime(invoice.first_reminder_sent_at)
                : t("admin.invoices.reminders.never")}
            </dd>
            <dt className="text-muted-foreground">{t("admin.invoices.reminders.last")}</dt>
            <dd className="tabular-nums">
              {invoice.last_reminder_sent_at
                ? formatDateTime(invoice.last_reminder_sent_at)
                : t("admin.invoices.reminders.never")}
            </dd>
          </dl>
        </Section>
      </div>

      {/* Dialogs; each mounts only for its own action. */}
      {payable ? (
        <>
          <PaymentDialog
            userId={userId}
            invoice={target}
            mode="amount"
            open={dialog?.kind === "payment"}
            onOpenChange={close}
          />
          <PaymentDialog
            userId={userId}
            invoice={target}
            mode="full"
            open={dialog?.kind === "markPaid"}
            onOpenChange={close}
          />
        </>
      ) : null}
      {!cancelled && status !== "draft" ? (
        <ShareInvoiceDialog
          userId={userId}
          invoice={{
            id,
            invoiceNumber: number,
            status:
              status === "paid" ? "paid" : status === "partially_paid" ? "partially_paid" : "open",
            isOverdue: invoice.is_overdue === true,
            total: invoice.total_amount ?? 0,
            amountPaid,
            balance,
            dueDate: invoice.due_date ?? "",
            paidAt: invoice.paid_at,
          }}
          model={model}
          open={dialog?.kind === "share"}
          onOpenChange={close}
        />
      ) : null}
      {admin && !cancelled ? (
        <>
          <CancelInvoiceDialog
            userId={userId}
            invoice={target}
            mode="cancel"
            orderIds={orderIds}
            open={dialog?.kind === "cancel"}
            onOpenChange={close}
          />
          <CancelInvoiceDialog
            userId={userId}
            invoice={target}
            mode="correct"
            orderIds={orderIds}
            open={dialog?.kind === "correct"}
            onOpenChange={close}
          />
        </>
      ) : null}
      {lateFeeOffered ? (
        <LateFeeDialog
          userId={userId}
          invoice={target}
          percent={lateFeePercent}
          open={dialog?.kind === "lateFee"}
          onOpenChange={close}
        />
      ) : null}
      {admin ? (
        <VoidPaymentDialog
          userId={userId}
          payment={dialog?.kind === "void" ? dialog.payment : null}
          currency={currency}
          open={dialog?.kind === "void"}
          onOpenChange={close}
        />
      ) : null}
    </>
  );
}

function Notices({
  invoice,
  cancelledBy,
  noLogin,
  relations,
}: {
  invoice: InvoiceViewRow;
  cancelledBy: string | null;
  noLogin: boolean;
  relations:
    | {
        replaces: { id: string; invoice_number: string | null } | null;
        replacedBy: { id: string; invoice_number: string | null; status: string }[];
      }
    | undefined;
}) {
  const t = useT();
  const notes: ReactNode[] = [];
  if (invoice.status === "cancelled" && invoice.cancelled_at) {
    notes.push(
      <Callout
        key="cancelled"
        tone="danger"
        icon={Ban}
        title={
          cancelledBy
            ? t("admin.invoices.detail.cancelled", {
                date: formatDateTime(invoice.cancelled_at),
                name: cancelledBy,
              })
            : t("admin.invoices.detail.cancelledNoName", {
                date: formatDateTime(invoice.cancelled_at),
              })
        }
      >
        {invoice.cancel_reason ? (
          <p className="break-words">
            {t("admin.invoices.detail.cancelReason", { reason: invoice.cancel_reason })}
          </p>
        ) : null}
      </Callout>,
    );
  }
  if (invoice.is_overdue && invoice.due_date) {
    const days = invoice.days_overdue ?? 0;
    notes.push(
      <Callout
        key="overdue"
        tone="danger"
        icon={CircleAlert}
        title={
          days === 1
            ? t("admin.invoices.detail.overdueOne", { date: formatDate(invoice.due_date) })
            : t("admin.invoices.detail.overdue", {
                days: formatNumber(days, 0),
                date: formatDate(invoice.due_date),
              })
        }
      />,
    );
  }
  if (invoice.status === "paid" && invoice.paid_at) {
    notes.push(
      <Callout
        key="paid"
        tone="success"
        icon={CircleCheck}
        title={t("admin.invoices.detail.paidAt", { date: formatDate(invoice.paid_at) })}
      />,
    );
  }
  if (relations?.replaces) {
    notes.push(
      <Callout
        key="replaces"
        tone="info"
        icon={Info}
        title={t("admin.invoices.detail.replaces", {
          number: relations.replaces.invoice_number ?? "–",
        })}
        actions={
          <Link
            to="/admin/facturen/$id"
            params={{ id: relations.replaces.id }}
            className="font-semibold text-primary underline underline-offset-4"
          >
            {relations.replaces.invoice_number ?? "–"}
          </Link>
        }
      />,
    );
  }
  for (const r of relations?.replacedBy ?? []) {
    notes.push(
      <Callout
        key={`by-${r.id}`}
        tone="info"
        icon={Info}
        title={
          r.invoice_number
            ? t("admin.invoices.detail.replacedBy", { number: r.invoice_number })
            : t("admin.invoices.detail.replacedByDraft")
        }
        actions={
          <Link
            to="/admin/facturen/$id"
            params={{ id: r.id }}
            className="font-semibold text-primary underline underline-offset-4"
          >
            {r.invoice_number ?? t("admin.invoices.detail.openDraft")}
          </Link>
        }
      />,
    );
  }
  if (noLogin && invoice.status !== "cancelled") {
    notes.push(
      <Callout key="login" tone="neutral" icon={Info} title={t("admin.invoices.detail.noLogin")} />,
    );
  }
  if (notes.length === 0) return null;
  return <div className="mb-6 space-y-3 print:hidden">{notes}</div>;
}

function PaymentRow({
  payment,
  currency,
  recordedBy,
  voidedBy,
  canVoid,
  onVoid,
}: {
  payment: InvoicePayment;
  currency: NonNullable<InvoiceViewRow["currency"]>;
  recordedBy: string | null;
  voidedBy: string | null;
  canVoid: boolean;
  onVoid: () => void;
}) {
  const t = useT();
  const voided = payment.voided_at !== null;
  const amount = formatMoney(payment.amount, currency);
  return (
    <li className="space-y-1 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className={cn("min-w-0 tabular-nums", voided && "text-muted-foreground line-through")}>
          <span className="font-semibold">{amount}</span>
          {" · "}
          {t(`admin.customers.detail.paymentMethods.${payment.method}`)}
          {" · "}
          {t("admin.invoices.payments.paidOn", { date: formatDate(payment.paid_on) })}
        </p>
        {voided ? (
          <Badge variant="neutral">
            <Undo2 className="size-3.5 shrink-0" aria-hidden />
            {t("admin.invoices.payments.voided")}
          </Badge>
        ) : canVoid ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-destructive hover:bg-destructive-soft hover:text-destructive"
            onClick={onVoid}
            aria-label={t("admin.invoices.payments.voidLabel", {
              amount,
              date: formatDate(payment.paid_on),
            })}
          >
            <Undo2 aria-hidden />
            {t("admin.invoices.payments.void")}
          </Button>
        ) : null}
      </div>
      {payment.reference ? (
        <p className="break-words text-xs text-muted-foreground">
          {t("admin.invoices.payments.reference", { reference: payment.reference })}
        </p>
      ) : null}
      {payment.received_amount !== null && payment.received_currency ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          {t("admin.invoices.payments.received", {
            amount: formatMoney(payment.received_amount, payment.received_currency),
          })}
        </p>
      ) : null}
      {payment.customer_note ? (
        <p className="break-words text-xs text-foreground">
          {t("admin.invoices.payments.customerNote", { note: payment.customer_note })}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground tabular-nums">
        {recordedBy
          ? t("admin.invoices.payments.recordedBy", {
              name: recordedBy,
              date: formatDateTime(payment.created_at),
            })
          : t("admin.invoices.payments.recordedAt", { date: formatDateTime(payment.created_at) })}
      </p>
      {voided && payment.voided_at ? (
        <p className="break-words text-xs text-muted-foreground">
          {voidedBy
            ? t("admin.invoices.payments.voidedBy", {
                date: formatDateTime(payment.voided_at),
                name: voidedBy,
                reason: payment.void_reason ?? "",
              })
            : t("admin.invoices.payments.voidedNoName", {
                date: formatDateTime(payment.voided_at),
                reason: payment.void_reason ?? "",
              })}
        </p>
      ) : null}
    </li>
  );
}
