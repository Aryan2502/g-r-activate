import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Copy, UserRound } from "lucide-react";
import { toast } from "sonner";

import { ShellPageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { t, useT } from "@/lib/i18n";
import { paths } from "@/lib/paths";
import { firstName } from "@/lib/portal/customer";
import { usePortalCustomer } from "@/lib/portal/use-portal-customer";

export const Route = createFileRoute("/portal/")({
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("portal.home.title") }) }] }),
  component: PortalHome,
});

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t("toast.copied"));
  } catch {
    toast.error(t("toast.copyFailed"));
  }
}

function PortalHome() {
  const t = useT();
  const { customer } = usePortalCustomer();
  const name = firstName(customer.full_name);

  return (
    <>
      <ShellPageHeader
        title={t("portal.home.welcome", { name })}
        description={t("portal.home.intro")}
      />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section
          aria-labelledby="customer-code-label"
          className="rounded-lg border-2 border-primary/20 bg-card p-6 shadow-sm sm:p-8"
        >
          <p
            id="customer-code-label"
            className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
          >
            {t("portal.home.codeLabel")}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <p className="font-heading text-4xl font-bold tracking-wider text-primary tabular-nums sm:text-5xl">
              {customer.customer_code}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void copyText(customer.customer_code)}
            >
              <Copy aria-hidden />
              {t("portal.home.copyCode")}
            </Button>
          </div>
          <p className="mt-4 max-w-prose text-sm leading-6 text-muted-foreground">
            {t("portal.home.codeHint")}
          </p>
        </section>

        <section className="flex flex-col rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg text-foreground">
            <UserRound className="size-5 text-primary" aria-hidden />
            {t("portal.home.accountTitle")}
          </h2>
          <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">
            {t("portal.home.accountText")}
          </p>
          <Button asChild variant="outline" className="mt-4 self-start">
            <Link to={paths.portalProfile}>
              {t("portal.home.toProfile")}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </section>
      </div>
    </>
  );
}
