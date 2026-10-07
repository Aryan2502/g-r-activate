import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { House, RotateCw } from "lucide-react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthSync } from "@/components/auth/AuthSync";
import { StatusScreen } from "@/components/layout/StatusScreen";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { BRAND_BACKGROUND_HEX, brandAssets } from "@/lib/brand";
import { t } from "@/lib/i18n";
import { securityHeaders } from "@/lib/security-headers";

function NotFoundComponent() {
  return (
    <StatusScreen
      code="404"
      title={t("errors.notFoundTitle")}
      description={t("errors.notFoundText")}
      actions={
        <Button asChild>
          <Link to="/">
            <House aria-hidden />
            {t("common.backHome")}
          </Link>
        </Button>
      }
    />
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <StatusScreen
      title={t("errors.errorTitle")}
      description={t("errors.errorText")}
      actions={
        <>
          <Button
            onClick={() => {
              void router.invalidate();
              reset();
            }}
          >
            <RotateCw aria-hidden />
            {t("common.retry")}
          </Button>
          <Button asChild variant="outline">
            <a href="/">
              <House aria-hidden />
              {t("common.backHome")}
            </a>
          </Button>
        </>
      }
    />
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: t("meta.title") },
      { name: "description", content: t("meta.description") },
      { name: "theme-color", content: BRAND_BACKGROUND_HEX },
      { property: "og:title", content: t("meta.title") },
      { property: "og:description", content: t("meta.description") },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "nl_SR" },
      { property: "og:site_name", content: t("brand.appName") },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: brandAssets.favicon, sizes: "16x16 32x32 48x48" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: brandAssets.icon192 },
      { rel: "icon", type: "image/png", sizes: "512x512", href: brandAssets.icon512 },
      { rel: "apple-touch-icon", sizes: "180x180", href: brandAssets.appleTouchIcon },
      { rel: "manifest", href: brandAssets.manifest },
    ],
  }),
  headers: () => securityHeaders(import.meta.env.DEV),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="nl">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <AuthSync />
      <Toaster closeButton />
    </QueryClientProvider>
  );
}
