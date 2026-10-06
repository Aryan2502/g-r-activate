import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/button";
import { todayInSuriname } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Shell for the sign-in, sign-up and password pages: logo bar, centred content. */
export function AuthLayout({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/" className="rounded-md">
            <BrandLogo variant="lockup" size="md" priority />
            <span className="sr-only"> {t("brand.homeLinkHint")}</span>
          </Link>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link to="/">
              <ArrowLeft aria-hidden />
              {t("auth.backHome")}
            </Link>
          </Button>
        </div>
      </header>
      <main className="flex flex-1 justify-center px-4 py-10 sm:py-14">{children}</main>
      <footer className="border-t">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-muted-foreground sm:px-6 lg:px-8">
          {t("footer.copyright", {
            year: todayInSuriname().slice(0, 4),
            company: t("brand.companyName"),
          })}
        </p>
      </footer>
    </div>
  );
}

interface AuthCardProps {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Links under the card, e.g. "Nog geen account?". */
  footer?: ReactNode;
  className?: string;
}

/** The white card every auth page is built from. */
export function AuthCard({ title, description, children, footer, className }: AuthCardProps) {
  return (
    <div className={cn("w-full max-w-md", className)}>
      <section className="rounded-lg border bg-card p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl text-primary">{title}</h1>
        {description ? (
          <div className="mt-2 text-sm leading-6 text-muted-foreground">{description}</div>
        ) : null}
        {children ? <div className="mt-6">{children}</div> : null}
      </section>
      {footer ? (
        <div className="mt-6 space-y-2 text-center text-sm text-muted-foreground">{footer}</div>
      ) : null}
    </div>
  );
}
