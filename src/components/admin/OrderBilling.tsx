import { CircleCheck, CircleAlert } from "lucide-react";

import { CurrencyAmounts } from "@/components/portal/CurrencyAmounts";
import { Muted } from "@/components/portal/Section";
import { InvoiceStatusBadge } from "@/components/portal/StatusBadges";
import { Badge } from "@/components/ui/badge";
import type { OrderBilling } from "@/lib/admin/orders";
import { useT } from "@/lib/i18n";

/**
 * The "Factuur" column (SPEC §21): the order's newest issued invoice (or its
 * draft) with its status from invoice_overview, read-only until the invoice
 * pages exist (P6/P7).
 */
export function InvoiceSummary({ billing }: { billing: OrderBilling }) {
  const t = useT();
  if (billing.payment === "unknown") return <Unknown />;
  const [first, ...rest] = billing.invoices;
  if (!first) return <Muted>{t("admin.orders.noInvoice")}</Muted>;
  const more =
    rest.length > 0 ? (
      <span className="font-normal text-muted-foreground">
        {t("admin.orders.moreInvoices", { count: rest.length })}
      </span>
    ) : null;
  return (
    <span className="flex flex-col items-start gap-1">
      {/* A draft has no number yet; its badge says "Concept". */}
      {first.invoice_number ? (
        <span className="font-semibold tabular-nums">
          <span className="whitespace-nowrap">{first.invoice_number}</span> {more}
        </span>
      ) : null}
      <span className="inline-flex items-center">
        <InvoiceStatusBadge invoice={first} />
        {first.invoice_number ? null : <span className="ml-1">{more}</span>}
      </span>
    </span>
  );
}

/** The "Betaling" column: what is still open per currency, or paid. */
export function PaymentSummary({ billing }: { billing: OrderBilling }) {
  const t = useT();
  switch (billing.payment) {
    case "unknown":
      return <Unknown />;
    case "none":
      return <Muted>{t("admin.orders.paymentNone")}</Muted>;
    case "draft":
      return <Muted>{t("admin.orders.paymentDraft")}</Muted>;
    case "paid":
      return (
        <Badge variant="success">
          <CircleCheck className="size-3.5 shrink-0" aria-hidden />
          {t("admin.orders.paymentPaid")}
        </Badge>
      );
    case "open":
      return (
        <span className="flex flex-col items-start gap-1">
          <span className="text-sm font-semibold">
            <span className="sr-only">{t("portal.kpi.outstandingLabel")} </span>
            <CurrencyAmounts amounts={billing.unpaid} />
          </span>
          {billing.overdue ? (
            <Badge variant="danger">
              <CircleAlert className="size-3.5 shrink-0" aria-hidden />
              {t("portal.invoiceStatus.overdue")}
            </Badge>
          ) : null}
        </span>
      );
  }
}

/** The invoices could not be loaded: never claim "Geen factuur" then. */
function Unknown() {
  const t = useT();
  return (
    <span title={t("admin.orders.billingUnknownHint")}>
      <Muted>{t("admin.orders.billingUnknown")}</Muted>
    </span>
  );
}
