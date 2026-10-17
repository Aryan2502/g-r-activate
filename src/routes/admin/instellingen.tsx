import { useEffect, useRef, type ComponentType, type SVGProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, useLocation } from "@tanstack/react-router";
import {
  Bell,
  Building2,
  FileText,
  Hash,
  Landmark,
  Lock,
  MapPin,
  PackageCheck,
  Scale,
  ScrollText,
  Workflow,
} from "lucide-react";

import { Callout } from "@/components/admin/Callout";
import { BankAccountsPanel } from "@/components/admin/settings/BankAccountsPanel";
import { CompanySettingsSection } from "@/components/admin/settings/CompanySettingsSection";
import { NumberingPanel } from "@/components/admin/settings/NumberingPanel";
import { RatesPanel } from "@/components/admin/settings/RatesPanel";
import { UnsavedChangesProvider } from "@/components/admin/settings/unsaved";
import { WarehousePanel } from "@/components/admin/settings/WarehousePanel";
import { ShellPageHeader } from "@/components/layout/AppShell";
import { LoadError, Section } from "@/components/portal/Section";
import { Skeleton } from "@/components/ui/skeleton";
import { COMPANY_SECTIONS, type SettingsSectionId } from "@/lib/admin/settings";
import {
  bankAccountsQueryOptions,
  companySettingsQueryOptions,
  serviceRatesQueryOptions,
  warehouseAddressesAdminQueryOptions,
} from "@/lib/admin/settings-queries";
import { formatDateTime } from "@/lib/format";
import { t, useT } from "@/lib/i18n";

/**
 * /admin/instellingen (SPEC §35.8: never hardcoded): company details,
 * invoice settings and texts, reminders, how G&R works (sign-up, pay before
 * pickup, delivery, open-order limit), pickup details, terms and prohibited
 * goods, numbering (invoice counter, next customer code), bank accounts, US
 * warehouse addresses and service rates. Admins edit with their own client
 * (RLS: admins only; every change is audited by the database); staff read.
 */
export const Route = createFileRoute("/admin/instellingen")({
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("admin.settings.title") }) }] }),
  component: SettingsPage,
});

const adminRoute = getRouteApi("/admin");

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** Page order: what customers and invoices need first. */
const ORDER: readonly { id: SettingsSectionId; icon: Icon }[] = [
  { id: "bedrijf", icon: Building2 },
  { id: "bankrekeningen", icon: Landmark },
  { id: "us-adressen", icon: MapPin },
  { id: "tarieven", icon: Scale },
  { id: "facturen", icon: FileText },
  { id: "nummering", icon: Hash },
  { id: "herinneringen", icon: Bell },
  { id: "werkwijze", icon: Workflow },
  { id: "afhalen", icon: PackageCheck },
  { id: "teksten", icon: ScrollText },
];

function SettingsPage() {
  const t = useT();
  const { auth } = adminRoute.useRouteContext();
  const isAdmin = auth.role === "admin";
  const settings = useQuery(companySettingsQueryOptions(auth.userId));
  const accounts = useQuery(bankAccountsQueryOptions(auth.userId));
  const addresses = useQuery(warehouseAddressesAdminQueryOptions(auth.userId));
  const rates = useQuery(serviceRatesQueryOptions(auth.userId));
  useScrollToHash(settings.isSuccess);

  const header = (
    <ShellPageHeader title={t("admin.settings.title")} description={t("admin.settings.intro")} />
  );

  if (settings.isError) {
    return (
      <>
        {header}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <LoadError
            title={t("admin.settings.loadFailed")}
            error={settings.error}
            onRetry={() => void settings.refetch()}
          />
        </div>
      </>
    );
  }
  if (settings.isPending) {
    return (
      <>
        {header}
        <div className="space-y-4" aria-busy="true">
          <span className="sr-only">{t("common.loading")}</span>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }

  const row = settings.data;
  const companySection = (id: SettingsSectionId, icon: Icon) => {
    const section = COMPANY_SECTIONS.find((s) => s.id === id);
    if (!section) return null;
    return (
      <CompanySettingsSection
        key={id}
        userId={auth.userId}
        section={section}
        settings={row}
        editable={isAdmin}
        icon={icon}
      />
    );
  };
  const panel = (id: SettingsSectionId, icon: Icon) => {
    const props = {
      id,
      title: t(`admin.settings.sections.${id}`),
      icon,
      description: t(`admin.settings.intros.${id}`),
    };
    switch (id) {
      case "bankrekeningen":
        return (
          <Section key={id} {...props}>
            <BankAccountsPanel userId={auth.userId} isAdmin={isAdmin} accounts={accounts} />
          </Section>
        );
      case "us-adressen":
        return (
          <Section key={id} {...props}>
            <WarehousePanel userId={auth.userId} isAdmin={isAdmin} addresses={addresses} />
          </Section>
        );
      case "tarieven":
        return (
          <Section key={id} {...props}>
            <RatesPanel userId={auth.userId} isAdmin={isAdmin} rates={rates} />
          </Section>
        );
      case "nummering":
        return (
          <Section key={id} {...props}>
            <NumberingPanel
              userId={auth.userId}
              isAdmin={isAdmin}
              prefix={row.invoice_number_prefix}
            />
          </Section>
        );
      default:
        return companySection(id, icon);
    }
  };

  return (
    <UnsavedChangesProvider>
      {header}
      <div className="space-y-6">
        {isAdmin ? null : (
          <Callout tone="neutral" icon={Lock} title={t("admin.settings.readOnly")} />
        )}
        <nav
          aria-label={t("admin.settings.contents")}
          className="rounded-lg border bg-card p-4 shadow-sm"
        >
          <p className="text-sm font-semibold text-foreground">{t("admin.settings.contents")}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {ORDER.map(({ id, icon: SectionIcon }) => (
              <li key={id}>
                <a
                  href={`#${id}-title`}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm text-primary hover:bg-cream"
                >
                  <SectionIcon className="size-4" aria-hidden />
                  {t(`admin.settings.sections.${id}`)}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground tabular-nums">
            {t("admin.settings.lastChanged", { date: formatDateTime(row.updated_at) })}
          </p>
        </nav>
        {ORDER.map(({ id, icon }) => panel(id, icon))}
      </div>
    </UnsavedChangesProvider>
  );
}

/**
 * The page loads its data after navigation, so a link such as
 * /admin/instellingen#bankrekeningen-title (from the dashboard checklist)
 * scrolls once the section exists.
 */
function useScrollToHash(ready: boolean) {
  const { hash } = useLocation();
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !hash || done.current === hash) return;
    const target = document.getElementById(hash.replace(/^#/, ""));
    if (!target) return;
    done.current = hash;
    target.scrollIntoView({ block: "start" });
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }, [ready, hash]);
}
