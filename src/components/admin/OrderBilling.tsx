import { Link } from "@tanstack/react-router";
import { CircleCheck, CircleAlert } from "lucide-react";

import { CurrencyAmounts } from "@/components/portal/CurrencyAmounts";
import { Muted } from "@/components/portal/Section";
import { InvoiceStatusBadge } from "@/components/portal/StatusBadges";
import { Badge } from "@/components/ui/badge";
import type { OrderBilling } from "@/lib/admin/orders";
import { useT } from "@/lib/i18n";

/**
 * The "Factuur" column (SPEC §21): the order's newest issued invoice (or its
 * draft) with its status from invoice_overview; the number (or "Concept")
 * opens /admin/facturen/$id, where payments and the other actions are.
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
  const label = first.invoice_number ?? t("admin.invoices.draftNumber");
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="font-semibold tabular-nums">
        {first.id ? (
          <Link
            to="/admin/facturen/$id"
            params={{ id: first.id }}
            className="whitespace-nowrap rounded-sm text-primary underline-offset-4 hover:underline"
          >
            {label}
          </Link>
        ) : (
          <span className="whitespace-nowrap">{label}</span>
        )}{" "}
        {more}
      </span>
      <InvoiceStatusBadge invoice={first} />
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
