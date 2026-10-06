import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { LegalPage } from "@/components/content/LegalPage";
import { t } from "@/lib/i18n";

const publicRoute = getRouteApi("/_public");

export const Route = createFileRoute("/_public/voorwaarden")({
  head: () => ({
    meta: [{ title: t("meta.pageTitle", { page: t("legal.termsTitle") }) }],
  }),
  component: TermsPage,
});

function TermsPage() {
  const info = publicRoute.useLoaderData();
  return (
    <LegalPage
      title={t("legal.termsTitle")}
      markdown={info?.terms_markdown}
      version={info?.terms_version}
      loaded={info !== null}
    />
  );
}
