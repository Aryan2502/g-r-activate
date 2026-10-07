import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router";
import { ArrowLeft, FileSearch } from "lucide-react";

import { InvoiceBuilder } from "@/components/admin/invoices/InvoiceBuilder";
import { IssuedInvoiceView } from "@/components/admin/invoices/IssuedInvoiceView";
import { ShellPageHeader } from "@/components/layout/AppShell";
import { LoadError } from "@/components/portal/Section";
import { Skeleton } from "@/components/ui/skeleton";
import { invoiceDraftQueryOptions } from "@/lib/admin/invoice-queries";
import { customersQueryOptions } from "@/lib/admin/orders";
import { t, useT } from "@/lib/i18n";

/**
 * /admin/facturen/$id: a draft opens the builder (SPEC §35.9 "Draft
 * editing"); an issued, paid or cancelled invoice shows the document,
 * rendered only from its snapshots (fromIssuedInvoice), with its status
 * from invoice_overview, its payments and the invoice actions
 * (IssuedInvoiceView).
 */
export const Route = createFileRoute("/admin/facturen/$id")({
  head: () => ({
    meta: [{ title: t("meta.pageTitle", { page: t("admin.invoices.detail.documentTitle") }) }],
  }),
  component: InvoicePage,
});

const adminRoute = getRouteApi("/admin");
const BACK_LINK =
  "mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline print:hidden";

function InvoicePage() {
  const t = useT();
  const { id } = Route.useParams();
  const { auth } = adminRoute.useRouteContext();
  const draft = useQuery(invoiceDraftQueryOptions(auth.userId, id));
  const customers = useQuery(customersQueryOptions(auth.userId));

  if (draft.isError) {
    return (
      <LoadError
        title={t("admin.invoiceBuilder.loadFailed")}
        error={draft.error}
        onRetry={() => void draft.refetch()}
      />
    );
  }
  if (draft.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (!draft.data) {
    // Inside the admin shell: a card, not a second full-page <main>.
    return (
      <>
        <Link to="/admin/facturen" className={BACK_LINK}>
          <ArrowLeft className="size-4" aria-hidden />
          {t("admin.invoices.detail.back")}
        </Link>
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h1 className="flex items-center gap-2 text-xl text-primary">
            <FileSearch className="size-5" aria-hidden />
            {t("admin.invoiceBuilder.notFound")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("admin.invoiceBuilder.notFoundText")}
          </p>
        </div>
      </>
    );
  }

  const { invoice, items } = draft.data;
  const customer = (customers.data ?? []).find((c) => c.id === invoice.customer_id);
  const back = customer ? (
    <Link to="/admin/klanten/$id" params={{ id: customer.id }} className={BACK_LINK}>
      <ArrowLeft className="size-4" aria-hidden />
      {t("admin.invoiceBuilder.backToCustomer", { name: customer.full_name })}
    </Link>
  ) : (
    <Link to="/admin/orders" className={BACK_LINK}>
      <ArrowLeft className="size-4" aria-hidden />
      {t("admin.invoiceBuilder.back")}
    </Link>
  );

  if (invoice.status === "draft") {
    return (
      <InvoiceBuilder
        key={invoice.id}
        userId={auth.userId}
        mode={{ kind: "draft", invoiceId: invoice.id, invoice, items }}
        header={
          <>
            {back}
            <ShellPageHeader
              title={t("admin.invoiceBuilder.titleDraft")}
              description={t("admin.invoiceBuilder.introDraft")}
              className="mb-6"
            />
          </>
        }
        leaveTo={{ to: "/admin/klanten/$id", id: invoice.customer_id }}
      />
    );
  }
  return (
    <IssuedInvoiceView
      userId={auth.userId}
      role={auth.role}
      invoiceId={invoice.id}
      back={
        <Link to="/admin/facturen" className={BACK_LINK}>
          <ArrowLeft className="size-4" aria-hidden />
          {t("admin.invoices.detail.back")}
        </Link>
      }
    />
  );
}
