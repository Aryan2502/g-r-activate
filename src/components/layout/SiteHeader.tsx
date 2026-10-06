import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { LogIn, Menu, UserPlus } from "lucide-react";

import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useT } from "@/lib/i18n";
import { paths } from "@/lib/paths";

interface SiteHeaderProps {
  /** company_settings.public_signup_enabled; false when unknown. */
  signupEnabled: boolean;
}

export function SiteHeader({ signupEnabled }: SiteHeaderProps) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const close = () => setMenuOpen(false);

  return (
    <header className="sticky top-0 z-40 border-b bg-card">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link to="/" className="rounded-md">
          <BrandLogo variant="lockup" size="md" priority />
          <span className="sr-only"> {t("brand.homeLinkHint")}</span>
        </Link>

        <nav aria-label={t("nav.main")} className="hidden items-center gap-1 lg:flex">
          <Button asChild variant="ghost">
            <Link to="/" hash="hoe-het-werkt">
              {t("nav.howItWorks")}
            </Link>
          </Button>
          <Button asChild variant={signupEnabled ? "ghost" : "default"}>
            <Link to={paths.login}>
              <LogIn aria-hidden />
              {t("nav.login")}
            </Link>
          </Button>
          {signupEnabled ? (
            <Button asChild className="ml-1">
              <Link to={paths.signup}>
                <UserPlus aria-hidden />
                {t("nav.signup")}
              </Link>
            </Button>
          ) : null}
        </nav>

        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="lg:hidden">
              <Menu aria-hidden />
              <span className="sr-only">{t("nav.openMenu")}</span>
            </Button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="w-[85vw] max-w-xs bg-card"
            aria-describedby={undefined}
          >
            <SheetTitle className="font-heading text-base text-foreground">
              {t("nav.menu")}
            </SheetTitle>
            <nav aria-label={t("nav.main")} className="mt-6 flex flex-col gap-2">
              <Button asChild variant="ghost" className="justify-start">
                <Link to="/" hash="hoe-het-werkt" onClick={close}>
                  {t("nav.howItWorks")}
                </Link>
              </Button>
              <Button asChild variant="outline" className="justify-start">
                <Link to={paths.login} onClick={close}>
                  <LogIn aria-hidden />
                  {t("nav.login")}
                </Link>
              </Button>
              {signupEnabled ? (
                <Button asChild className="justify-start">
                  <Link to={paths.signup} onClick={close}>
                    <UserPlus aria-hidden />
                    {t("nav.signup")}
                  </Link>
                </Button>
              ) : null}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
