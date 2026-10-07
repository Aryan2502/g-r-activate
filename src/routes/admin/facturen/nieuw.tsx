import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";

import { InvoiceBuilder } from "@/components/admin/invoices/InvoiceBuilder";
import { ShellPageHeader } from "@/components/layout/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { orderIdsParam } from "@/lib/admin/invoice-builder";
import { adminKeys } from "@/lib/admin/keys";
import { adminOrderQueryOptions, customersQueryOptions } from "@/lib/admin/orders";
import { t, useT } from "@/lib/i18n";

/**
 * /admin/facturen/nieuw: the invoice builder (SPEC §14, §15, §35.9).
 *
 * "Genereer factuur" on /admin/orders (a selection), /admin/orders/$id and
 * /admin/klanten/$id opens it with ?customer=<id>&orders=<id,id> (one freight
 * line per order is prefilled) and ?from=order|orders|customer for the back
 * link. ?replaces=<cancelled invoice id> starts a correction ("Corrigeren").
 */
const searchSchema = z.object({
  customer: z.string().uuid().optional().catch(undefined),
  /** Order ids, comma-separated. */
  orders: z.string().max(4000).optional().catch(undefined),
  replaces: z.string().uuid().optional().catch(undefined),
  from: z.enum(["order", "orders", "customer"]).optional().catch(undefined),
});
type NewInvoiceSearch = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/admin/facturen/nieuw")({
  validateSearch: (search: Record<string, unknown>): NewInvoiceSearch => searchSchema.parse(search),
  head: () => ({
    meta: [{ title: t("meta.pageTitle", { page: t("admin.invoiceBuilder.title") }) }],
  }),
  component: NewInvoicePage,
});

const adminRoute = getRouteApi("/admin");
const BACK_LINK =
  "mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline";

function NewInvoicePage() {
  const t = useT();
  const { auth } = adminRoute.useRouteContext();
  const search = Route.useSearch();
  const orderIds = orderIdsParam(search.orders);
  const customers = useQuery(customersQueryOptions(auth.userId));
  const firstOrder = orderIds[0] ?? "";
  const order = useQuery({
    ...adminOrderQueryOptions(auth.userId, firstOrder),
    enabled: search.from === "order" && Boolean(firstOrder),
  });
  const replaced = useQuery({
    queryKey: [...adminKeys.invoice(auth.userId, search.replaces ?? ""), "number"] as const,
    enabled: Boolean(search.replaces),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_number, customer_id, currency")
        .eq("id", search.replaces ?? "")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // A correction belongs to the customer of the invoice it replaces.
  const customerId = replaced.data?.customer_id ?? search.customer ?? null;
  const customer = (customers.data ?? []).find((c) => c.id === customerId);

  const back =
    search.from === "order" && order.data ? (
      <Link to="/admin/orders/$id" params={{ id: order.data.id }} className={BACK_LINK}>
        <ArrowLeft className="size-4" aria-hidden />
        {t("admin.invoiceBuilder.backToOrder", { reference: order.data.reference })}
      </Link>
    ) : search.from === "customer" && customer ? (
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

  const header = (
    <>
      {back}
      <ShellPageHeader
        title={t("admin.invoiceBuilder.title")}
        description={t("admin.invoiceBuilder.intro")}
        className="mb-6"
      />
    </>
  );

  // Wait for the replaced invoice so the builder starts with the right customer.
  if (search.replaces && replaced.isPending) {
    return header;
  }

  return (
    <InvoiceBuilder
      key={`${customerId ?? ""}|${orderIds.join(",")}|${search.replaces ?? ""}`}
      userId={auth.userId}
      header={header}
      mode={{
        kind: "new",
        customerId,
        orderIds,
        replacesInvoiceId: replaced.data?.id ?? null,
        replacesNumber: replaced.data?.invoice_number ?? null,
        // A correction keeps the currency of the invoice it replaces.
        currency: replaced.data?.currency ?? null,
      }}
      leaveTo={customerId ? { to: "/admin/klanten/$id", id: customerId } : { to: "/admin/orders" }}
    />
  );
}
