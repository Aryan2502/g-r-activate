import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  Ban,
  CircleAlert,
  CircleCheck,
  Copy,
  Download,
  FileSearch,
  Landmark,
  Package,
  Wallet,
} from "lucide-react";

import { Callout } from "@/components/admin/Callout";
import { InvoicePreview } from "@/components/invoice/InvoiceDocument";
import { LoadError, Section } from "@/components/portal/Section";
import { InvoiceStatusBadge } from "@/components/portal/StatusBadges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { copyToClipboard } from "@/lib/clipboard";
import { formatDate, formatMoney, formatNumber, type CurrencyCode } from "@/lib/format";
import { t, useT } from "@/lib/i18n";
import {
  fromIssuedInvoice,
  parseBillToSnapshot,
  type InvoiceRenderModel,
} from "@/lib/invoice/model";
import {
  needsPayment,
  portalInvoiceQueryOptions,
  type PortalInvoiceView,
  type PortalPayment,
} from "@/lib/portal/invoices";
import { usePortalCustomer } from "@/lib/portal/use-portal-customer";

/**
 * /portal/facturen/$id (SPEC §18, §35.10, §35.11): one of the customer's
 * issued invoices, rendered ONLY from its snapshots (the same
 * InvoiceDocument as on paper), with what to pay, by when and how (the
 * payment instruction and the account of the invoice currency, prominent),
 * the payments received and "Opslaan als PDF" (the print route). Never a
 * draft or another customer's invoice (RLS + explicit filters).
 */
export const Route = createFileRoute("/portal/facturen/$id")({
  head: () => ({
    meta: [{ title: t("meta.pageTitle", { page: t("portal.invoices.title") }) }],
  }),
  component: InvoicePage,
});

const BACK =
  "mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline print:hidden";

function InvoicePage() {
  const t = useT();
  const { id } = Route.useParams();
  const { auth, customer } = usePortalCustomer();
  const query = useQuery(portalInvoiceQueryOptions(auth.userId, customer.id, id));

  const back = (
    <Link to="/portal/facturen" className={BACK}>
      <ArrowLeft className="size-4" aria-hidden />
      {t("portal.invoices.detail.back")}
    </Link>
  );

  if (query.isError) {
    return (
      <>
        {back}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <LoadError
            title={t("portal.invoices.detail.loadFailed")}
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        </div>
      </>
    );
  }
  if (query.isPending) {
    return (
      <>
        {back}
        <div className="space-y-4" aria-busy="true">
          <span className="sr-only">{t("common.loading")}</span>
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </>
    );
  }
  if (!query.data) {
    return (
      <>
        {back}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h1 className="flex items-center gap-2 text-xl text-primary">
            <FileSearch className="size-5" aria-hidden />
            {t("portal.invoices.detail.notFound")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("portal.invoices.detail.notFoundText")}
          </p>
        </div>
      </>
    );
  }
  return (
    <InvoiceBody
      invoice={query.data.invoice}
      items={query.data.items}
      payments={query.data.payments}
      back={back}
    />
  );
}

function InvoiceBody({
  invoice,
  items,
  payments,
  back,
}: {
  invoice: PortalInvoiceView;
  items: Parameters<typeof fromIssuedInvoice>[1];
  payments: PortalPayment[];
  back: ReactNode;
}) {
  const t = useT();
  const model = useMemo(() => fromIssuedInvoice(invoice, items), [invoice, items]);
  const orders = parseBillToSnapshot(invoice.bill_to_snapshot).orders;
  const number = invoice.invoice_number ?? "";
  const id = invoice.id ?? "";

  return (
    <>
      {back}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between print:hidden">
        <div className="min-w-0">
          <h1 className="text-2xl text-primary tabular-nums sm:text-3xl">
            {t("portal.invoices.detail.title", { number })}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <InvoiceStatusBadge invoice={invoice} className="px-3 py-1 text-sm" />
            {invoice.invoice_date ? (
              <span className="text-muted-foreground tabular-nums">
                {t("portal.invoices.detail.invoiceDate", {
                  date: formatDate(invoice.invoice_date),
                })}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <Button asChild variant="outline">
            <Link to="/portal/facturen/$id/print" params={{ id }}>
              <Download aria-hidden />
              {t("portal.invoices.detail.pdf")}
            </Link>
          </Button>
          <p className="text-xs text-muted-foreground">{t("portal.invoices.detail.pdfHint")}</p>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6 print:hidden lg:col-start-2 lg:row-start-1">
          <PayBox invoice={invoice} model={model} />
          {orders.length > 0 ? (
            <Section title={t("portal.invoices.detail.orders")} icon={Package} id="invoice-orders">
              <ul className="space-y-1.5 text-sm">
                {orders.map((o) => (
                  <li key={o.id}>
                    <Link
                      to="/portal/orders/$id"
                      params={{ id: o.id }}
                      className="font-semibold text-primary tabular-nums underline-offset-4 hover:underline"
                    >
                      {o.reference}
                    </Link>
                    {o.storeVendor ? (
                      <span className="text-muted-foreground"> · {o.storeVendor}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          <Payments payments={payments} currency={invoice.currency ?? "USD"} />
        </div>
        <section
          aria-label={t("portal.invoices.detail.documentLabel")}
          className="min-w-0 rounded-lg border bg-muted/60 p-2 sm:p-4 lg:col-start-1 lg:row-start-1 print:border-0 print:bg-transparent print:p-0"
        >
          <InvoicePreview model={model} />
        </section>
      </div>
    </>
  );
}

/** What to pay, by when and how; or that it is paid or cancelled (SPEC §26: "Understand whether payment is required"). */
function PayBox({ invoice, model }: { invoice: PortalInvoiceView; model: InvoiceRenderModel }) {
  const t = useT();
  const currency: CurrencyCode = invoice.currency ?? "USD";
  const money = (n: number | null) => formatMoney(n ?? 0, currency);

  if (invoice.status === "cancelled") {
    return (
      <Callout tone="neutral" icon={Ban} title={t("portal.invoices.pay.cancelledTitle")}>
        <p>{t("portal.invoices.pay.cancelledText")}</p>
        {invoice.cancel_reason ? (
          <p className="mt-1 break-words">
            {t("portal.invoices.pay.cancelReason", { reason: invoice.cancel_reason })}
          </p>
        ) : null}
      </Callout>
    );
  }
  if (!needsPayment(invoice)) {
    return (
      <Callout tone="success" icon={CircleCheck} title={t("portal.invoices.pay.paidTitle")}>
        {invoice.paid_at
          ? t("portal.invoices.pay.paidText", { date: formatDate(invoice.paid_at) })
          : t("portal.invoices.pay.paidTextNoDate")}
      </Callout>
    );
  }

  const bank = model.issuer.bankAccounts.find((b) => b.currency === currency) ?? null;
  const reference = t("portal.invoices.pay.reference", {
    number: invoice.invoice_number ?? "",
    code: model.billTo.customerCode,
  });
  const days = invoice.days_overdue ?? 0;
  return (
    <section
      aria-labelledby="invoice-pay-title"
      className={
        invoice.is_overdue
          ? "rounded-lg border-2 border-destructive/50 bg-card p-5 shadow-sm"
          : "rounded-lg border-2 border-primary/30 bg-card p-5 shadow-sm"
      }
    >
      <h2 id="invoice-pay-title" className="flex items-center gap-2 text-lg text-foreground">
        <Wallet className="size-5 shrink-0 text-primary" aria-hidden />
        {t("portal.invoices.pay.title")}
      </h2>
      <p className="mt-3 text-sm font-semibold text-muted-foreground">
        {t("portal.invoices.pay.amountLabel")}
      </p>
      <p className="font-heading text-2xl font-bold whitespace-nowrap text-primary tabular-nums">
        {money(invoice.balance_due)}
      </p>
      {invoice.due_date ? (
        <p className="text-sm font-semibold tabular-nums">
          {t("portal.invoices.pay.before", { date: formatDate(invoice.due_date) })}
        </p>
      ) : null}
      {(invoice.amount_paid ?? 0) > 0 ? (
        <p className="mt-1 text-sm text-muted-foreground tabular-nums">
          {t("portal.invoices.pay.partially", {
            paid: money(invoice.amount_paid),
            total: money(invoice.total_amount),
          })}
        </p>
      ) : null}
      {invoice.is_overdue && invoice.due_date ? (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-destructive-soft px-3 py-2 text-sm font-semibold text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {days === 1
            ? t("portal.invoices.pay.overdueOne", { date: formatDate(invoice.due_date) })
            : t("portal.invoices.pay.overdue", {
                days: formatNumber(days, 0),
                date: formatDate(invoice.due_date),
              })}
        </p>
      ) : null}

      <div className="mt-4 space-y-1 border-t pt-3 text-sm">
        <p className="text-muted-foreground">{t("portal.invoices.pay.instruction")}</p>
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-heading text-base font-bold text-foreground tabular-nums [overflow-wrap:anywhere]">
            {reference}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-primary"
            onClick={() => void copyToClipboard(reference)}
          >
            <Copy aria-hidden />
            <span className="sr-only">{t("portal.invoices.pay.copyReference")}</span>
          </Button>
        </p>
        <p className="text-xs text-muted-foreground">
          {t("portal.invoices.pay.currency", { currency })}
        </p>
      </div>

      <div className="mt-4 border-t pt-3 text-sm">
        <p className="flex items-center gap-2 font-semibold text-foreground">
          <Landmark className="size-4 shrink-0 text-primary" aria-hidden />
          {t("portal.invoices.pay.bankTitle")}
        </p>
        {bank?.accountNumber ? (
          <dl className="mt-2 grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-2 gap-y-1">
            <dt className="text-muted-foreground">{t("portal.invoices.pay.accountNumber")}</dt>
            <dd className="flex flex-wrap items-center gap-1 font-semibold tabular-nums [overflow-wrap:anywhere]">
              {bank.accountNumber}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-primary"
                onClick={() => void copyToClipboard(bank.accountNumber ?? "")}
              >
                <Copy aria-hidden />
                <span className="sr-only">{t("portal.invoices.pay.copyAccount")}</span>
              </Button>
            </dd>
            {bank.bankName ? (
              <>
                <dt className="text-muted-foreground">{t("portal.invoices.pay.bank")}</dt>
                <dd className="break-words">{bank.bankName}</dd>
              </>
            ) : null}
            {bank.accountHolder ? (
              <>
                <dt className="text-muted-foreground">{t("portal.invoices.pay.holder")}</dt>
                <dd className="break-words">{bank.accountHolder}</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <p className="mt-2 text-muted-foreground">
            {t("portal.invoices.pay.noBank", { currency })}
          </p>
        )}
      </div>
    </section>
  );
}

function Payments({ payments, currency }: { payments: PortalPayment[]; currency: CurrencyCode }) {
  const t = useT();
  return (
    <Section title={t("portal.invoices.payments.title")} icon={Wallet} id="invoice-payments">
      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("portal.invoices.payments.empty")}</p>
      ) : (
        <ul className="divide-y text-sm">
          {payments.map((p) => (
            <li key={p.id} className="py-2 first:pt-0 last:pb-0">
              <p className="tabular-nums">
                <span className="font-semibold">
                  {t("portal.invoices.payments.row", {
                    amount: formatMoney(p.amount, currency),
                    date: formatDate(p.paid_on),
                  })}
                </span>
                <span className="text-muted-foreground">
                  {" · "}
                  {t(`portal.invoices.methods.${p.method}`)}
                </span>
              </p>
              {p.customer_note ? (
                <p className="mt-0.5 break-words text-muted-foreground">
                  {t("portal.invoices.payments.note", { note: p.customer_note })}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
