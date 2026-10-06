import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { LegalPage } from "@/components/content/LegalPage";
import { t } from "@/lib/i18n";

const publicRoute = getRouteApi("/_public");

export const Route = createFileRoute("/_public/verboden-goederen")({
  head: () => ({
    meta: [{ title: t("meta.pageTitle", { page: t("legal.prohibitedTitle") }) }],
  }),
  component: ProhibitedGoodsPage,
});

function ProhibitedGoodsPage() {
  const info = publicRoute.useLoaderData();
  return (
    <LegalPage
      title={t("legal.prohibitedTitle")}
      markdown={info?.prohibited_goods_markdown}
      loaded={info !== null}
    />
  );
}
