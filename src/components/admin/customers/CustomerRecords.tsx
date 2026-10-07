import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Package,
  Paperclip,
  Plane,
  Receipt,
  Ship,
} from "lucide-react";
import { toast } from "sonner";

import { CurrencyAmounts } from "@/components/portal/CurrencyAmounts";
import { LoadError, Muted, Section } from "@/components/portal/Section";
import { B2bBadge, InvoiceStatusBadge, OrderStatusBadge } from "@/components/portal/StatusBadges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  customerDocumentsQueryOptions,
  customerInvoicesQueryOptions,
  outstandingOf,
  shipmentsOfOrders,
  type CustomerDocument,
  type CustomerOrder,
} from "@/lib/admin/customers";
import { peopleQueryOptions, personName } from "@/lib/admin/orders";
import type { AdminStatusMap } from "@/lib/admin/statuses";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { documentDownloadUrl, formatFileSize } from "@/lib/portal/documents";
import { resolveStatus } from "@/lib/portal/orders";

/**
 * The customer page's history sections (SPEC §13: "a complete history"):
 * orders (each links to /admin/orders/$id), the shipments they travel in,
 * invoices and payments (each invoice links to /admin/facturen/$id, where
 * payments are recorded) and the documents of all their orders. Everything is read with the staff member's
 * own client.
 */

export function CustomerOrdersSection({
  orders,
  statuses,
  onRetry,
  error,
  pending,
  actions,
}: {
  orders: CustomerOrder[] | undefined;
  statuses: AdminStatusMap;
  error: unknown;
  pending: boolean;
  onRetry: () => void;
  actions?: ReactNode;
}) {
  const t = useT();
  const count = orders?.length ?? 0;
  return (
    <Section
      title={t("admin.customers.detail.ordersTitle")}
      icon={Package}
      id="customer-orders"
      actions={actions}
      description={
        orders
          ? t(
              count === 1
                ? "admin.customers.detail.ordersCountOne"
                : "admin.customers.detail.ordersCount",
              { count: formatNumber(count, 0) },
            )
          : undefined
      }
    >
      {error ? (
        <LoadError
          title={t("admin.customers.detail.ordersLoadFailed")}
          error={error}
          onRetry={onRetry}
        />
      ) : pending || !orders ? (
        <Skeleton className="h-24 w-full" />
      ) : orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.customers.detail.ordersEmpty")}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {orders.map((order) => (
            <li
              key={order.id}
              className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0">
                <Link
                  to="/admin/orders/$id"
                  params={{ id: order.id }}
                  className="font-semibold text-primary tabular-nums underline-offset-4 hover:underline"
                >
                  {order.reference}
                </Link>
                <p className="break-words text-sm text-foreground">
                  {[order.store_vendor, order.description].filter(Boolean).join(" · ") || (
                    <Muted>{t("admin.customers.detail.notProvided")}</Muted>
                  )}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums [overflow-wrap:anywhere]">
                  {formatDate(order.created_at)}
                  {order.tracking_number ? ` · ${order.tracking_number}` : ""}
                  {order.shipment ? ` · ${order.shipment.shipment_number}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
                {order.order_type === "b2b" ? <B2bBadge /> : null}
                <OrderStatusBadge status={resolveStatus(order.status, statuses)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function CustomerShipmentsSection({ orders }: { orders: CustomerOrder[] | undefined }) {
  const t = useT();
  if (!orders) return null;
  const shipments = shipmentsOfOrders(orders);
  return (
    <Section
      title={t("admin.customers.detail.shipmentsTitle")}
      icon={Plane}
      id="customer-shipments"
    >
      {shipments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("admin.customers.detail.shipmentsEmpty")}
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {shipments.map((shipment) => {
            const Icon = shipment.service_type === "sea" ? Ship : Plane;
            return (
              <li key={shipment.id} className="flex items-start gap-3 px-3 py-3 text-sm">
                <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0">
                  <Link
                    to="/admin/zendingen/$id"
                    params={{ id: shipment.id }}
                    className="font-semibold text-primary tabular-nums underline-offset-4 hover:underline"
                  >
                    {shipment.shipment_number}
                  </Link>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {t(`portal.serviceTypes.${shipment.service_type}`)} ·{" "}
                    {shipment.departed_at
                      ? t("admin.customers.detail.departed", {
                          date: formatDate(shipment.departed_at),
                        })
                      : t("admin.customers.detail.notDeparted")}
                  </p>
                  <p className="break-words text-xs text-muted-foreground tabular-nums">
                    {t("admin.customers.detail.shipmentOrders", {
                      references: shipment.orderReferences.join(", "),
                    })}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

export function CustomerInvoicesSection({
  userId,
  customerId,
  customerCode,
  actions,
}: {
  userId: string;
  customerId: string;
  /** For "Alle facturen" (/admin/facturen?q=GR…). */
  customerCode?: string;
  actions?: ReactNode;
}) {
  const t = useT();
  const query = useQuery(customerInvoicesQueryOptions(userId, customerId));
  const invoices = query.data?.invoices ?? [];
  const numbers = new Map(invoices.map((i) => [i.id, i]));
  const outstanding = outstandingOf(invoices);
  const overdue = invoices.filter((i) => i.is_overdue === true).length;

  return (
    <Section
      title={t("admin.customers.detail.invoicesTitle")}
      icon={Receipt}
      id="customer-invoices"
      description={t("admin.customers.detail.invoicesIntro")}
      actions={
        <>
          {customerCode && invoices.length > 0 ? (
            <Button size="sm" variant="outline" asChild>
              <Link to="/admin/facturen" search={{ q: customerCode }}>
                <Receipt aria-hidden />
                {t("admin.customers.detail.allInvoices")}
              </Link>
            </Button>
          ) : null}
          {actions}
        </>
      }
    >
      {query.isError ? (
        <LoadError
          title={t("admin.customers.detail.invoicesLoadFailed")}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : query.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.customers.detail.invoicesEmpty")}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-cream/60 px-3 py-2 text-sm">
            <span className="font-semibold text-primary">
              {t("admin.customers.detail.outstanding")}
            </span>
            {outstanding.length > 0 ? (
              <span className="font-semibold">
                <CurrencyAmounts amounts={outstanding} />
              </span>
            ) : (
              <span className="text-muted-foreground">
                {t("admin.customers.detail.nothingOutstanding")}
              </span>
            )}
            {overdue > 0 ? (
              <Badge variant="danger">
                {t("admin.customers.detail.overdue", { count: overdue })}
              </Badge>
            ) : null}
          </div>
          <ul className="divide-y rounded-md border">
            {invoices.map((invoice) => (
              <li
                key={invoice.id}
                className="flex flex-col gap-1.5 px-3 py-2.5 text-sm sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-semibold tabular-nums text-foreground">
                    {invoice.id ? (
                      <Link
                        to="/admin/facturen/$id"
                        params={{ id: invoice.id }}
                        className="rounded-sm text-primary underline-offset-4 hover:underline"
                      >
                        {invoice.invoice_number ?? t("admin.customers.detail.draft")}
                      </Link>
                    ) : (
                      (invoice.invoice_number ?? t("admin.customers.detail.draft"))
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {invoice.invoice_date
                      ? t("admin.customers.detail.invoiceDate", {
                          date: formatDate(invoice.invoice_date),
                        })
                      : null}
                    {invoice.due_date
                      ? ` · ${t("admin.customers.detail.dueDate", { date: formatDate(invoice.due_date) })}`
                      : null}
                  </p>
                  {invoice.currency && invoice.total_amount !== null ? (
                    <p className="text-xs tabular-nums text-foreground">
                      {t("admin.customers.detail.total", {
                        amount: formatMoney(invoice.total_amount, invoice.currency),
                      })}
                      {invoice.balance_due && Number(invoice.balance_due) > 0
                        ? ` · ${t("admin.customers.detail.balance", {
                            amount: formatMoney(invoice.balance_due, invoice.currency),
                          })}`
                        : null}
                    </p>
                  ) : null}
                </div>
                <InvoiceStatusBadge invoice={invoice} className="self-start" />
              </li>
            ))}
          </ul>
          <div>
            <h3 className="mb-2 text-sm font-bold text-primary">
              {t("admin.customers.detail.paymentsTitle")}
            </h3>
            {(query.data?.payments.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("admin.customers.detail.paymentsEmpty")}
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {query.data?.payments.map((payment) => {
                  const invoice = numbers.get(payment.invoice_id);
                  return (
                    <li key={payment.id} className="flex flex-wrap items-center gap-2 tabular-nums">
                      <span
                        className={payment.voided_at ? "text-muted-foreground line-through" : ""}
                      >
                        {t("admin.customers.detail.paymentFor", {
                          amount: invoice?.currency
                            ? formatMoney(payment.amount, invoice.currency)
                            : formatNumber(payment.amount),
                          date: formatDate(payment.paid_on),
                          invoice: invoice?.invoice_number ?? "–",
                        })}{" "}
                        · {t(`admin.customers.detail.paymentMethods.${payment.method}`)}
                      </span>
                      {payment.voided_at ? (
                        <Badge variant="neutral">{t("admin.customers.detail.paymentVoided")}</Badge>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

function DocumentItem({ document, uploader }: { document: CustomerDocument; uploader: string }) {
  const t = useT();
  const [opening, setOpening] = useState(false);
  const Icon = document.mime_type.startsWith("image/") ? ImageIcon : FileText;
  const download = async () => {
    setOpening(true);
    try {
      // Content-Disposition: attachment, so the file downloads and the page stays.
      window.location.assign(await documentDownloadUrl(document));
    } catch (error) {
      toast.error(`${t("admin.customers.detail.downloadFailed")} ${errorMessage(error)}`);
    } finally {
      setOpening(false);
    }
  };
  const label = t("admin.customers.detail.download", { name: document.original_filename });
  return (
    <li className="flex items-center gap-2 px-3 py-2.5">
      <Icon className="size-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="break-all font-semibold text-foreground">{document.original_filename}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {t(`portal.documentKinds.${document.kind}`)} · {formatFileSize(document.size_bytes)} ·{" "}
          {formatDateTime(document.created_at)} · {uploader}
        </p>
        {document.order ? (
          <Link
            to="/admin/orders/$id"
            params={{ id: document.order_id }}
            className="text-xs font-semibold text-primary underline-offset-4 hover:underline"
          >
            {t("admin.customers.detail.documentOrder", { reference: document.order.reference })}
          </Link>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 text-primary"
        onClick={() => void download()}
        disabled={opening}
        title={label}
      >
        {opening ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
        <span className="sr-only">{label}</span>
      </Button>
    </li>
  );
}

export function CustomerDocumentsSection({
  userId,
  customerId,
  customerUserId,
}: {
  userId: string;
  customerId: string;
  customerUserId: string | null;
}) {
  const t = useT();
  const documents = useQuery(customerDocumentsQueryOptions(userId, customerId));
  const uploaders = (documents.data ?? []).flatMap((d) =>
    d.uploaded_by && d.uploaded_by !== customerUserId ? [d.uploaded_by] : [],
  );
  const people = useQuery({
    ...peopleQueryOptions(userId, uploaders),
    enabled: uploaders.length > 0,
  });
  return (
    <Section
      title={t("admin.customers.detail.documentsTitle")}
      icon={Paperclip}
      id="customer-documents"
      description={t("admin.customers.detail.documentsIntro")}
    >
      {documents.isError ? (
        <LoadError
          title={t("admin.customers.detail.documentsLoadFailed")}
          error={documents.error}
          onRetry={() => void documents.refetch()}
        />
      ) : documents.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : documents.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("admin.customers.detail.documentsEmpty")}
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {documents.data.map((document) => (
            <DocumentItem
              key={document.id}
              document={document}
              uploader={
                document.uploaded_by && document.uploaded_by === customerUserId
                  ? t("admin.order.documents.byCustomer")
                  : t("admin.order.documents.byStaff", {
                      name: personName(document.uploaded_by, people.data, customerUserId),
                    })
              }
            />
          ))}
        </ul>
      )}
    </Section>
  );
}
