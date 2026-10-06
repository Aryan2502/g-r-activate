import { useQuery } from "@tanstack/react-query";
import {
  Outlet,
  createFileRoute,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { LayoutDashboard, RotateCw } from "lucide-react";

import { AppShell, type ShellNavItem } from "@/components/layout/AppShell";
import { PagePending } from "@/components/layout/PagePending";
import { StatusScreen } from "@/components/layout/StatusScreen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { staffProfileQueryOptions } from "@/lib/admin/dashboard";
import { requireArea } from "@/lib/auth/guards";
import { useSignOut } from "@/lib/auth/use-sign-out";
import { errorMessage } from "@/lib/errors";
import { t, useT } from "@/lib/i18n";
import { paths } from "@/lib/paths";
import { NOINDEX_META } from "@/lib/seo";

// Client-only (SPEC §35.2). Staff only: customers are sent to /portal.
export const Route = createFileRoute("/admin")({
  ssr: false,
  beforeLoad: ({ context, location }) =>
    requireArea("admin", { queryClient: context.queryClient, location }),
  head: () => ({
    meta: [NOINDEX_META, { title: t("meta.pageTitle", { page: t("admin.areaName") }) }],
  }),
  pendingComponent: () => <PagePending />,
  errorComponent: AdminError,
  component: AdminLayout,
});

const nav: ShellNavItem[] = [
  { to: paths.admin, label: t("admin.nav.dashboard"), icon: LayoutDashboard, exact: true },
];

function AdminLayout() {
  const t = useT();
  const { auth } = Route.useRouteContext();
  const profile = useQuery(staffProfileQueryOptions(auth.userId));
  const { signOut, signingOut } = useSignOut();
  const role = auth.role === "admin" ? t("admin.roles.admin") : t("admin.roles.staff");

  return (
    <AppShell
      areaName={t("admin.areaName")}
      homePath={paths.admin}
      nav={nav}
      onSignOut={signOut}
      signingOut={signingOut}
      identity={
        <div className="space-y-1.5">
          {profile.data ? (
            <p className="truncate font-semibold text-foreground">{profile.data}</p>
          ) : null}
          <p className="truncate text-muted-foreground">{auth.email}</p>
          <Badge variant={auth.role === "admin" ? "default" : "neutral"}>{role}</Badge>
        </div>
      }
    >
      <Outlet />
    </AppShell>
  );
}

function AdminError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <StatusScreen
      title={t("errors.errorTitle")}
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
