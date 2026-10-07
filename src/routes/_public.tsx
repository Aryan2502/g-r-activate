import { Outlet, createFileRoute } from "@tanstack/react-router";

import { PublicLayout } from "@/components/layout/PublicLayout";
import { loadPublicCompanyInfo } from "@/lib/company-info";
import { publicSeo } from "@/lib/seo";
import { getSiteOrigin } from "@/lib/site-origin";

// Public pages share one public_company_info() read (the only RPC anon may call)
// and the share/SEO tags (og:image with the brand image, og:url, canonical).
export const Route = createFileRoute("/_public")({
  loader: async () => ({ info: await loadPublicCompanyInfo(), siteOrigin: getSiteOrigin() }),
  staleTime: 5 * 60_000,
  head: ({ loaderData, matches }) =>
    publicSeo(loaderData?.siteOrigin ?? null, matches.at(-1)?.pathname ?? "/"),
  component: PublicLayoutRoute,
});

function PublicLayoutRoute() {
  const { info } = Route.useLoaderData();
  return (
    <PublicLayout info={info}>
      <Outlet />
    </PublicLayout>
  );
}
