import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";
import { ArrowLeft, RotateCw } from "lucide-react";

import { InvoicePrintView } from "@/components/invoice/InvoicePrintView";
import { PagePending } from "@/components/layout/PagePending";
import { StatusScreen } from "@/components/layout/StatusScreen";
import { Button } from "@/components/ui/button";
import { requireArea } from "@/lib/auth/guards";
import { errorMessage } from "@/lib/errors";
import { t, useT } from "@/lib/i18n";
import { fromIssuedInvoice, printTitle } from "@/lib/invoice/model";
import { customerQueryOptions } from "@/lib/portal/customer";
import { portalInvoiceQueryOptions } from "@/lib/portal/invoices";
import { NOINDEX_META } from "@/lib/seo";

/**
 * /portal/facturen/$id/print (SPEC §18, §35.11 "Opslaan als PDF"): the
 * customer's own issued invoice ALONE, outside the portal shell (the
 * trailing underscores opt out of the /portal layout and the invoice page),
 * from its snapshots, then the browser's print dialog. Its own guard:
 * customers only, client-only like /portal; RLS and the explicit customer
 * filter keep it to their own non-draft invoices.
 */
export const Route = createFileRoute("/portal_/facturen/$id_/print")({
  ssr: false,
  beforeLoad: ({ context, location }) =>
    requireArea("portal", { queryClient: context.queryClient, location }),
  loader: async ({ context, params }) => {
    const userId = context.auth.userId;
    const customer = await context.queryClient.ensureQueryData(customerQueryOptions(userId));
    if (!customer) return { title: null };
    const data = await context.queryClient.ensureQueryData(
      portalInvoiceQueryOptions(userId, customer.id, params.id),
    );
    return { title: data ? printTitle(fromIssuedInvoice(data.invoice, data.items)) : null };
  },
  head: ({ loaderData }) => ({
    meta: [NOINDEX_META, { title: loaderData?.title ?? t("invoicePrint.title") }],
  }),
  pendingComponent: () => <PagePending />,
  errorComponent: PrintError,
  component: PortalInvoicePrint,
});

const BACK =
  "inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline";

function PortalInvoicePrint() {
  const t = useT();
  const { id } = Route.useParams();
  const { auth } = Route.useRouteContext();
  const customer = useQuery(customerQueryOptions(auth.userId));
  const invoice = useQuery({
    ...portalInvoiceQueryOptions(auth.userId, customer.data?.id ?? "", id),
    enabled: Boolean(customer.data),
  });

  const failed = customer.isError ? customer : invoice.isError ? invoice : null;
  if (failed) {
    return (
      <StatusScreen
        title={t("invoicePrint.loadFailed")}
        description={errorMessage(failed.error)}
        actions={
          <Button onClick={() => void failed.refetch()}>
            <RotateCw aria-hidden />
            {t("common.retry")}
          </Button>
        }
      />
    );
  }
  const back = (
    <Link to="/portal/facturen/$id" params={{ id }} className={BACK}>
      <ArrowLeft className="size-4" aria-hidden />
      {t("invoicePrint.back")}
    </Link>
  );
  if (customer.isPending || (customer.data && invoice.isPending)) return <PagePending />;
  if (!customer.data || !invoice.data) {
    return (
      <StatusScreen
        code="404"
        title={t("invoicePrint.notFound")}
        description={t("invoicePrint.notFoundText")}
        actions={
          <Link to="/portal/facturen" className={BACK}>
            <ArrowLeft className="size-4" aria-hidden />
            {t("portal.invoices.detail.back")}
          </Link>
        }
      />
    );
  }
  return (
    <InvoicePrintView
      model={fromIssuedInvoice(invoice.data.invoice, invoice.data.items)}
      back={back}
    />
  );
}

function PrintError({ error, reset }: ErrorComponentProps) {
  return (
    <StatusScreen
      title={t("invoicePrint.loadFailed")}
      description={errorMessage(error)}
      actions={
        <Button onClick={reset}>
          <RotateCw aria-hidden />
          {t("common.retry")}
        </Button>
      }
    />
  );
}
