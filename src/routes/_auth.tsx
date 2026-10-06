import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AuthLayout } from "@/components/layout/AuthLayout";
import { publicCompanyInfoQueryOptions, type PublicCompanyInfo } from "@/lib/company-info";
import { NOINDEX_META } from "@/lib/seo";

// Sign-in, sign-up and password pages. They read public_company_info() for the
// sign-up switch, terms version and contact details; null means it failed.
export const Route = createFileRoute("/_auth")({
  loader: ({ context }): Promise<PublicCompanyInfo | null> =>
    context.queryClient.ensureQueryData(publicCompanyInfoQueryOptions()).catch((error: unknown) => {
      console.error("public_company_info failed", error);
      return null;
    }),
  staleTime: 5 * 60_000,
  head: () => ({ meta: [NOINDEX_META] }),
  component: AuthLayoutRoute,
});

function AuthLayoutRoute() {
  return (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  );
}
