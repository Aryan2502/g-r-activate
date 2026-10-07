import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { LegalPage } from "@/components/content/LegalPage";
import { t } from "@/lib/i18n";
import { pageMeta } from "@/lib/seo";

const publicRoute = getRouteApi("/_public");

export const Route = createFileRoute("/_public/verboden-goederen")({
  head: () => ({
    meta: pageMeta(
      t("meta.pageTitle", { page: t("legal.prohibitedTitle") }),
      t("legal.prohibitedDescription"),
    ),
  }),
  component: ProhibitedGoodsPage,
});

function ProhibitedGoodsPage() {
  const info = publicRoute.useLoaderData({ select: (data) => data.info });
  return (
    <LegalPage
      title={t("legal.prohibitedTitle")}
      markdown={info?.prohibited_goods_markdown}
      loaded={info !== null}
    />
  );
}
