import { useQuery } from "@tanstack/react-query";
import {
  Outlet,
  createFileRoute,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { LayoutDashboard, Loader2, LogOut, RotateCw, UserRound } from "lucide-react";

import { AppShell, type ShellNavItem } from "@/components/layout/AppShell";
import { PagePending } from "@/components/layout/PagePending";
import { StatusScreen } from "@/components/layout/StatusScreen";
import { NoCustomerScreen } from "@/components/portal/NoCustomerScreen";
import { Button } from "@/components/ui/button";
import { requireArea } from "@/lib/auth/guards";
import { useSignOut } from "@/lib/auth/use-sign-out";
import { errorMessage } from "@/lib/errors";
import { t, useT } from "@/lib/i18n";
import { paths } from "@/lib/paths";
import { customerQueryOptions } from "@/lib/portal/customer";
import { NOINDEX_META } from "@/lib/seo";

// Client-only (SPEC §35.2): the session lives in the browser's storage.
export const Route = createFileRoute("/portal")({
  ssr: false,
  beforeLoad: ({ context, location }) =>
    requireArea("portal", { queryClient: context.queryClient, location }),
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(customerQueryOptions(context.auth.userId));
  },
  head: () => ({
    meta: [NOINDEX_META, { title: t("meta.pageTitle", { page: t("portal.areaName") }) }],
  }),
  pendingComponent: () => <PagePending />,
  errorComponent: PortalError,
  component: PortalLayout,
});

const nav: ShellNavItem[] = [
  { to: paths.portal, label: t("portal.nav.dashboard"), icon: LayoutDashboard, exact: true },
  { to: paths.portalProfile, label: t("portal.nav.profile"), icon: UserRound },
];

function PortalLayout() {
  const t = useT();
  const { auth } = Route.useRouteContext();
  const customer = useQuery(customerQueryOptions(auth.userId));
  const { signOut, signingOut } = useSignOut();

  if (customer.isPending) return <PagePending />;

  if (customer.isError) {
    return (
      <StatusScreen
        title={t("portal.loadFailed")}
        description={errorMessage(customer.error)}
        actions={
          <>
            <Button onClick={() => void customer.refetch()}>
              <RotateCw aria-hidden />
              {t("common.retry")}
            </Button>
            <Button variant="outline" onClick={signOut} disabled={signingOut}>
              {signingOut ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <LogOut aria-hidden />
              )}
              {t("auth.signOut.button")}
            </Button>
          </>
        }
      />
    );
  }

  if (!customer.data) {
    return (
      <NoCustomerScreen
        userId={auth.userId}
        email={auth.email}
        onSignOut={signOut}
        signingOut={signingOut}
      />
    );
  }

  return (
    <AppShell
      areaName={t("portal.areaName")}
      homePath={paths.portal}
      nav={nav}
      onSignOut={signOut}
      signingOut={signingOut}
      identity={
        <>
          <p className="truncate font-semibold text-foreground">{customer.data.full_name}</p>
          <p className="font-heading text-sm font-bold tracking-wide text-primary tabular-nums">
            {customer.data.customer_code}
          </p>
        </>
      }
    >
      <Outlet />
    </AppShell>
  );
}

function PortalError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <StatusScreen
      title={t("portal.loadFailed")}
      description={errorMessage(error)}
      actions={
        <Button
          onClick={() => {
            reset();
            void router.invalidate();
          }}
        >
          <RotateCw aria-hidden />
          {t("common.retry")}
        </Button>
      }
    />
  );
}
