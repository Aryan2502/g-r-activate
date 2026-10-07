import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";
import { ArrowLeft, RotateCw } from "lucide-react";

import { InvoicePrintView } from "@/components/invoice/InvoicePrintView";
import { PagePending } from "@/components/layout/PagePending";
import { StatusScreen } from "@/components/layout/StatusScreen";
import { Button } from "@/components/ui/button";
import { invoiceViewQueryOptions } from "@/lib/admin/invoice-queries";
import { requireArea } from "@/lib/auth/guards";
import { errorMessage } from "@/lib/errors";
import { t, useT } from "@/lib/i18n";
import { fromIssuedInvoice, printTitle } from "@/lib/invoice/model";
import { NOINDEX_META } from "@/lib/seo";

/**
 * /admin/facturen/$id/print (SPEC §35.11 "PDF"; "Download PDF" for staff,
 * also for customers without a login, SPEC §35.12): the issued invoice ALONE,
 * outside the admin shell (the trailing underscores opt out of the /admin
 * layout and the invoice page), rendered from its snapshots, then the
 * browser's print dialog. Its own guard: staff only, client-only like /admin.
 */
export const Route = createFileRoute("/admin_/facturen/$id_/print")({
  ssr: false,
  beforeLoad: ({ context, location }) =>
    requireArea("admin", { queryClient: context.queryClient, location }),
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(
      invoiceViewQueryOptions(context.auth.userId, params.id),
    );
    return {
      title:
        data && data.invoice.status !== "draft"
          ? printTitle(fromIssuedInvoice(data.invoice, data.items))
          : null,
    };
  },
  head: ({ loaderData }) => ({
    meta: [NOINDEX_META, { title: loaderData?.title ?? t("invoicePrint.title") }],
  }),
  pendingComponent: () => <PagePending />,
  errorComponent: PrintError,
  component: AdminInvoicePrint,
});

const BACK =
  "inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline";

function AdminInvoicePrint() {
  const t = useT();
  const { id } = Route.useParams();
  const { auth } = Route.useRouteContext();
  const view = useQuery(invoiceViewQueryOptions(auth.userId, id));

  if (view.isPending) return <PagePending />;
  if (view.isError) {
    return (
      <StatusScreen
        title={t("invoicePrint.loadFailed")}
        description={errorMessage(view.error)}
        actions={
          <Button onClick={() => void view.refetch()}>
            <RotateCw aria-hidden />
            {t("common.retry")}
          </Button>
        }
      />
    );
  }
  const back = (
    <Link to="/admin/facturen/$id" params={{ id }} className={BACK}>
      <ArrowLeft className="size-4" aria-hidden />
      {t("invoicePrint.back")}
    </Link>
  );
  if (!view.data || view.data.invoice.status === "draft") {
    return (
      <StatusScreen
        {...(view.data ? {} : { code: "404" })}
        title={view.data ? t("invoicePrint.title") : t("invoicePrint.notFound")}
        description={view.data ? t("invoicePrint.draft") : t("invoicePrint.notFoundText")}
        actions={back}
      />
    );
  }
  return (
    <InvoicePrintView model={fromIssuedInvoice(view.data.invoice, view.data.items)} back={back} />
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
