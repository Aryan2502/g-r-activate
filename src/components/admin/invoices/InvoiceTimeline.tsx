import { History } from "lucide-react";

import { LoadError, Section } from "@/components/portal/Section";
import { Skeleton } from "@/components/ui/skeleton";
import type { InvoicePayment, InvoiceViewRow } from "@/lib/admin/invoice-queries";
import { buildInvoiceTimeline, type InvoiceEvent } from "@/lib/admin/invoice-timeline";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { sumAmounts } from "@/lib/invoice/totals";

/**
 * The invoice's history in readable Dutch (SPEC §35.13: issued, paid,
 * cancelled; payments recorded and voided), with who and when, newest
 * first. Built from the invoice and its payments, which every staff member
 * may read; the generic audit log stays admin-only.
 */
export function InvoiceTimeline({
  invoice,
  payments,
  lateFee = null,
  name,
  className,
}: {
  invoice: InvoiceViewRow;
  payments: {
    data: readonly InvoicePayment[] | undefined;
    error: unknown;
    isError: boolean;
    refetch: () => unknown;
  };
  /**
   * The amount of the late-fee line, if any: apply_late_fee adds it to
   * total_amount, so the total AS ISSUED is total_amount minus this.
   */
  lateFee?: number | null;
  /** Display name of a login, or null when unknown. */
  name: (id: string | null) => string | null;
  className?: string;
}) {
  const t = useT();
  const currency = invoice.currency ?? "USD";
  const money = (amount: number) => formatMoney(amount, currency);

  const title = (event: InvoiceEvent): string => {
    switch (event.kind) {
      case "created":
        return t("admin.invoices.timeline.created");
      case "issued":
        return t("admin.invoices.timeline.issued", { number: invoice.invoice_number ?? "" });
      case "payment_recorded":
        return t("admin.invoices.timeline.paymentRecorded", {
          amount: money(event.payment?.amount ?? 0),
        });
      case "payment_voided":
        return t("admin.invoices.timeline.paymentVoided", {
          amount: money(event.payment?.amount ?? 0),
        });
      case "late_fee":
        return t("admin.invoices.timeline.lateFee");
      case "paid":
        return t("admin.invoices.timeline.paid");
      case "cancelled":
        return t("admin.invoices.timeline.cancelled");
    }
  };

  const detail = (event: InvoiceEvent): string | null => {
    if (event.kind === "issued" && invoice.total_amount !== null) {
      return t("admin.invoices.timeline.issuedAmount", {
        amount: money(sumAmounts([Number(invoice.total_amount), -(lateFee ?? 0)])),
      });
    }
    if (event.kind === "late_fee" && lateFee !== null) {
      return t("admin.invoices.timeline.lateFeeAmount", {
        amount: money(lateFee),
        total: money(Number(invoice.total_amount ?? 0)),
      });
    }
    if (event.kind === "payment_recorded" && event.payment) {
      return t("admin.invoices.timeline.paymentDetail", {
        date: formatDate(event.payment.paid_on),
        method: t(`admin.customers.detail.paymentMethods.${event.payment.method}`),
      });
    }
    if (event.reason) return t("admin.invoices.timeline.reason", { reason: event.reason });
    return null;
  };

  const events = payments.data ? [...buildInvoiceTimeline(invoice, payments.data)].reverse() : null;

  return (
    <Section
      title={t("admin.invoices.timeline.title")}
      icon={History}
      id="invoice-timeline"
      description={t("admin.invoices.timeline.intro")}
      {...(className ? { className } : {})}
    >
      {payments.isError ? (
        <LoadError
          className="mb-3"
          title={t("admin.invoices.timeline.loadFailed")}
          error={payments.error}
          onRetry={() => void payments.refetch()}
        />
      ) : null}
      {!events && !payments.isError ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <ol className="relative space-y-4 border-l border-border pl-5">
          {(events ?? [...buildInvoiceTimeline(invoice, [])].reverse()).map((event) => {
            const who = event.actorId
              ? t("admin.invoices.timeline.by", {
                  name: name(event.actorId) ?? t("admin.invoices.timeline.someone"),
                })
              : null;
            const extra = detail(event);
            return (
              <li key={event.key} className="relative">
                <span
                  className="absolute -left-[1.6rem] top-1.5 size-2.5 rounded-full border-2 border-card bg-primary"
                  aria-hidden
                />
                <p className="break-words text-sm font-medium leading-6 text-foreground">
                  {title(event)}
                </p>
                {extra ? (
                  <p className="break-words text-sm text-muted-foreground">{extra}</p>
                ) : null}
                <p className="text-xs text-muted-foreground tabular-nums">
                  <time dateTime={event.at}>{formatDateTime(event.at)}</time>
                  {who ? ` · ${who}` : null}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}
