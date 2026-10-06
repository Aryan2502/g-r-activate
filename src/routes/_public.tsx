import { Outlet, createFileRoute } from "@tanstack/react-router";

import { PublicLayout } from "@/components/layout/PublicLayout";
import { loadPublicCompanyInfo } from "@/lib/company-info";

// Public pages share one public_company_info() read (the only RPC anon may call).
export const Route = createFileRoute("/_public")({
  loader: () => loadPublicCompanyInfo(),
  staleTime: 5 * 60_000,
  component: PublicLayoutRoute,
});

function PublicLayoutRoute() {
  const info = Route.useLoaderData();
  return (
    <PublicLayout info={info}>
      <Outlet />
    </PublicLayout>
  );
}
