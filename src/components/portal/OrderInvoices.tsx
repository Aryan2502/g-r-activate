import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Receipt } from "lucide-react";

import { LoadError, Section } from "@/components/portal/Section";
import { InvoiceStatusBadge } from "@/components/portal/StatusBadges";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { needsPayment, orderInvoicesQueryOptions, type OrderInvoice } from "@/lib/portal/invoices";

/**
 * Invoices with a line for this order (SPEC §10, §35.9): invoice_items →
 * invoice_overview, so status, balance and "Achterstallig" come from the
 * database. Customers only see their own issued invoices (no drafts); each
 * number opens the invoice (/portal/facturen/$id).
 */
export function OrderInvoices({
  userId,
  customerId,
  orderId,
  customerCode,
}: {
  userId: string;
  customerId: string;
  orderId: string;
  customerCode: string;
}) {
  const t = useT();
  const invoices = useQuery(orderInvoicesQueryOptions(userId, customerId, orderId));

  return (
    <Section title={t("portal.order.invoices.title")} icon={Receipt} id="order-invoices">
      {invoices.isError ? (
        <LoadError
          title={t("portal.order.invoices.loadFailed")}
          error={invoices.error}
          onRetry={() => void invoices.refetch()}
        />
      ) : invoices.isPending ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : invoices.data.length === 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">
          {t("portal.order.invoices.empty")}
        </p>
      ) : (
        // The section is narrow beside the timeline on wide screens: the
        // table only when the section itself has room, cards otherwise.
        <div className="@container">
          <InvoiceTable invoices={invoices.data} customerCode={customerCode} />
          <InvoiceCards invoices={invoices.data} customerCode={customerCode} />
        </div>
      )}
    </Section>
  );
}

const money = (amount: number | null, currency: OrderInvoice["currency"]) =>
  amount !== null && currency ? formatMoney(amount, currency) : "";

/** The invoice number, to the invoice's page. */
function NumberLink({ invoice }: { invoice: OrderInvoice }) {
  const t = useT();
  if (!invoice.id) return <>{invoice.invoice_number}</>;
  return (
    <Link
      to="/portal/facturen/$id"
      params={{ id: invoice.id }}
      className="rounded-sm text-primary underline underline-offset-4"
      aria-label={t("portal.order.invoices.open", { number: invoice.invoice_number ?? "" })}
    >
      {invoice.invoice_number}
    </Link>
  );
}

function InvoiceNotes({ invoice, customerCode }: { invoice: OrderInvoice; customerCode: string }) {
  const t = useT();
  return (
    <>
      {invoice.is_overdue && invoice.days_overdue ? (
        <span className="mt-1 block text-xs font-semibold text-destructive">
          {t(
            invoice.days_overdue === 1
              ? "portal.order.invoices.daysOverdueOne"
              : "portal.order.invoices.daysOverdue",
            { days: invoice.days_overdue },
          )}
        </span>
      ) : null}
      {invoice.status === "paid" && invoice.paid_at ? (
        <span className="mt-1 block text-xs text-muted-foreground tabular-nums">
          {t("portal.order.invoices.paidOn", { date: formatDate(invoice.paid_at) })}
        </span>
      ) : null}
      {invoice.status === "cancelled" && invoice.cancel_reason ? (
        <span className="mt-1 block break-words text-xs text-muted-foreground">
          {t("portal.order.invoices.cancelReason", { reason: invoice.cancel_reason })}
        </span>
      ) : null}
      {needsPayment(invoice) && invoice.invoice_number && invoice.currency ? (
        <span className="mt-1 block break-words text-xs text-muted-foreground tabular-nums">
          {t("portal.order.invoices.payHint", {
            currency: invoice.currency,
            number: invoice.invoice_number,
            code: customerCode,
          })}
        </span>
      ) : null}
    </>
  );
}

function InvoiceTable({
  invoices,
  customerCode,
}: {
  invoices: OrderInvoice[];
  customerCode: string;
}) {
  const t = useT();
  return (
    <div className="hidden overflow-hidden rounded-md border @xl:block">
      <table className="w-full text-sm" aria-labelledby="order-invoices-title">
        <thead className="border-b bg-cream text-left">
          <tr>
            <th scope="col" className="px-3 py-2.5 font-bold text-primary">
              {t("portal.order.invoices.number")}
            </th>
            <th scope="col" className="px-3 py-2.5 font-bold text-primary">
              {t("portal.order.invoices.dueDate")}
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-bold text-primary">
              {t("portal.order.invoices.amount")}
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-bold text-primary">
              {t("portal.order.invoices.balance")}
            </th>
            <th scope="col" className="px-3 py-2.5 font-bold text-primary">
              {t("portal.order.invoices.status")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {invoices.map((invoice) => (
            <tr key={invoice.id} className="align-top">
              <td className="px-3 py-2.5">
                <span className="block font-semibold whitespace-nowrap tabular-nums">
                  <NumberLink invoice={invoice} />
                </span>
                {invoice.invoice_date ? (
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {formatDate(invoice.invoice_date)}
                  </span>
                ) : null}
                <InvoiceNotes invoice={invoice} customerCode={customerCode} />
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                {invoice.due_date ? formatDate(invoice.due_date) : ""}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                {money(invoice.total_amount, invoice.currency)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap">
                {money(invoice.balance_due, invoice.currency)}
              </td>
              <td className="px-3 py-2.5">
                <InvoiceStatusBadge invoice={invoice} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceCards({
  invoices,
  customerCode,
}: {
  invoices: OrderInvoice[];
  customerCode: string;
}) {
  const t = useT();
  return (
    <ul className="space-y-3 @xl:hidden">
      {invoices.map((invoice) => (
        <li key={invoice.id} className="rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold tabular-nums">
              <NumberLink invoice={invoice} />
            </span>
            <InvoiceStatusBadge invoice={invoice} />
          </div>
          <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1">
            <dt className="text-muted-foreground">{t("portal.order.invoices.date")}</dt>
            <dd className="tabular-nums">
              {invoice.invoice_date ? formatDate(invoice.invoice_date) : ""}
            </dd>
            <dt className="text-muted-foreground">{t("portal.order.invoices.dueDate")}</dt>
            <dd className="tabular-nums">{invoice.due_date ? formatDate(invoice.due_date) : ""}</dd>
            <dt className="text-muted-foreground">{t("portal.order.invoices.amount")}</dt>
            <dd className="tabular-nums">{money(invoice.total_amount, invoice.currency)}</dd>
            <dt className="text-muted-foreground">{t("portal.order.invoices.balance")}</dt>
            <dd className="font-semibold tabular-nums">
              {money(invoice.balance_due, invoice.currency)}
            </dd>
          </dl>
          <InvoiceNotes invoice={invoice} customerCode={customerCode} />
        </li>
      ))}
    </ul>
  );
}
