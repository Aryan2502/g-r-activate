import { useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Loader2, LogOut, Menu } from "lucide-react";

import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useT } from "@/lib/i18n";
import { activeNavPath } from "@/lib/nav";
import { cn } from "@/lib/utils";

export interface ShellNavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Active only on this exact path (for area index pages). */
  exact?: boolean;
}

interface AppShellProps {
  /** "Klantportaal" / "Beheer". */
  areaName: string;
  homePath: string;
  nav: ShellNavItem[];
  /** Who is signed in (name, GR code or role). */
  identity: ReactNode;
  onSignOut: () => void;
  signingOut: boolean;
  /** Wider content column, for operational tables (admin). */
  wide?: boolean;
  children: ReactNode;
}

/**
 * Signed-in layout for the portal and admin areas: a sidebar on desktop, a top
 * bar with a slide-in menu on mobile (SPEC §25).
 */
export function AppShell({
  areaName,
  homePath,
  nav,
  identity,
  onSignOut,
  signingOut,
  wide = false,
  children,
}: AppShellProps) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  // One highlighted item: the most specific match (e.g. "Order aanmelden"
  // on /portal/orders/nieuw, "Orders" on an order's page).
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const activeTo = activeNavPath(nav, pathname);

  const navList = (onNavigate?: () => void) => (
    <nav aria-label={t("shell.navLabel", { area: areaName })} className="flex flex-col gap-1">
      {nav.map((item) => {
        const active = item.to === activeTo;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            activeOptions={{ exact: true }}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-cream hover:text-primary",
              active && "bg-cream text-primary",
            )}
          >
            <item.icon className="size-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const account = (
    <div className="space-y-3 border-t pt-4">
      <div className="text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("shell.signedInAs")}
        </p>
        <div className="mt-1">{identity}</div>
      </div>
      <Button
        variant="outline"
        className="w-full justify-start"
        onClick={onSignOut}
        disabled={signingOut}
      >
        {signingOut ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
        {t("auth.signOut.button")}
      </Button>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r bg-card lg:flex">
        <div className="flex h-16 items-center border-b px-4">
          <Link to={homePath} className="rounded-md">
            <BrandLogo variant="lockup" size="sm" priority />
            <span className="sr-only"> {t("shell.homeLinkHint", { area: areaName })}</span>
          </Link>
        </div>
        <div className="flex flex-1 flex-col justify-between gap-6 overflow-y-auto p-4">
          <div className="space-y-3">
            <p className="px-3 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
              {areaName}
            </p>
            {navList()}
          </div>
          {account}
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b bg-card px-4 lg:hidden">
        <Link to={homePath} className="flex items-center gap-3 rounded-md">
          <BrandLogo variant="monogram" size="md" priority />
          <span className="font-heading text-sm font-bold text-primary">{areaName}</span>
        </Link>
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon">
              <Menu aria-hidden />
              <span className="sr-only">{t("shell.openNav")}</span>
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="flex w-[85vw] max-w-xs flex-col gap-6 bg-card"
            aria-describedby={undefined}
          >
            <SheetTitle className="font-heading text-base text-primary">{areaName}</SheetTitle>
            <div className="flex flex-1 flex-col justify-between gap-6">
              {navList(() => setMenuOpen(false))}
              {account}
            </div>
          </SheetContent>
        </Sheet>
      </header>

      <main className="lg:pl-72">
        <div
          className={cn(
            "mx-auto w-full px-4 py-8 sm:px-6 lg:py-10",
            wide ? "max-w-[96rem] lg:px-6" : "max-w-5xl lg:px-10",
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}

/** Page heading used inside the shell. */
export function ShellPageHeader({
  title,
  description,
  className,
}: {
  title: string;
  description?: ReactNode;
  /** E.g. "mb-0" when the header sits in a row with its own spacing. */
  className?: string;
}) {
  return (
    <div className={cn("mb-8", className)}>
      <h1 className="text-2xl text-primary sm:text-3xl">{title}</h1>
      {description ? <div className="mt-2 text-sm text-muted-foreground">{description}</div> : null}
    </div>
  );
}
