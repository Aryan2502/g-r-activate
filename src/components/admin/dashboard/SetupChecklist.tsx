import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronRight, Info, ListTodo, RotateCw } from "lucide-react";

import { DashboardPanel, PanelLoadError } from "@/components/admin/dashboard/Panel";
import { Button } from "@/components/ui/button";
import {
  bankAccountsQueryOptions,
  companySettingsQueryOptions,
  serviceRatesQueryOptions,
  warehouseAddressesAdminQueryOptions,
} from "@/lib/admin/settings-queries";
import { setupChecklist, type SetupItem, type SystemStatus } from "@/lib/admin/system-status";
import { useT, type Translate } from "@/lib/i18n";

function itemText(t: Translate, item: SetupItem): string {
  switch (item.key) {
    case "bankAccounts":
      return t("admin.home.setup.bankAccounts", { currencies: item.currencies.join(", ") });
    case "serviceRate":
      return t("admin.home.setup.serviceRate", {
        service: t(`portal.serviceTypes.${item.serviceType}`).toLowerCase(),
      });
    case "appUrl":
      return item.fromVercel ? t("admin.home.setup.appUrlVercel") : t("admin.home.setup.appUrl");
    case "cronSilent":
      return item.neverRan ? t("admin.home.setup.cronNeverRan") : t("admin.home.setup.cronSilent");
    default:
      return t(`admin.home.setup.${item.key}`);
  }
}

/**
 * "Nog in te stellen" (SPEC §35.8): what is still missing, from the
 * settings rows (everyone) and the server's configuration (admins). Hidden
 * when nothing is missing or while it is not known yet. A source that failed
 * to load is said so, with a retry, never silently left out (its items would
 * look done). Staff cannot change settings: for them one line with the count.
 */
export function SetupChecklist({
  userId,
  isAdmin,
  system,
}: {
  userId: string;
  isAdmin: boolean;
  /** systemStatusFn's answer (admins); null for staff. */
  system: SystemStatus | null | undefined;
}) {
  const t = useT();
  const settings = useQuery(companySettingsQueryOptions(userId));
  const bankAccounts = useQuery(bankAccountsQueryOptions(userId));
  const warehouseAddresses = useQuery(warehouseAddressesAdminQueryOptions(userId));
  const serviceRates = useQuery(serviceRatesQueryOptions(userId));
  const failed = [settings, bankAccounts, warehouseAddresses, serviceRates].filter(
    (q) => q.isError,
  );
  const items = setupChecklist({
    settings: settings.data,
    bankAccounts: bankAccounts.data,
    warehouseAddresses: warehouseAddresses.data,
    serviceRates: serviceRates.data,
    system,
  });
  if (items.length === 0 && failed.length === 0) return null;
  const retry = () => {
    for (const q of failed) void q.refetch();
  };

  if (!isAdmin) {
    return (
      <section
        aria-label={t("admin.home.setup.title")}
        className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-card px-4 py-3 text-sm shadow-sm sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="flex min-w-0 items-start gap-2 text-foreground">
          <ListTodo className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span>
            {failed.length > 0
              ? t("admin.home.setup.staffUnknown")
              : t(
                  items.length === 1
                    ? "admin.home.setup.staffSummaryOne"
                    : "admin.home.setup.staffSummaryMany",
                  { count: items.length },
                )}
          </span>
        </p>
        {failed.length > 0 ? (
          <Button variant="outline" size="sm" className="self-start" onClick={retry}>
            <RotateCw aria-hidden />
            {t("common.retry")}
          </Button>
        ) : null}
      </section>
    );
  }

  const serverItems = items.some((i) => i.section === null);
  return (
    <DashboardPanel
      title={t("admin.home.setup.title")}
      icon={<ListTodo />}
      description={t("admin.home.setup.intro")}
      className="border-warning/40"
    >
      {failed.length > 0 ? (
        <div className="mb-3">
          <PanelLoadError error={failed[0]?.error} onRetry={retry} />
          <p className="mt-2 text-xs text-muted-foreground">{t("admin.home.setup.partial")}</p>
        </div>
      ) : null}
      {items.length > 0 ? (
        <ul className="divide-y rounded-md border">
          {items.map((item) => {
            const text = itemText(t, item);
            const Icon = item.tone === "warning" ? AlertTriangle : Info;
            return (
              <li
                key={`${item.key}${"serviceType" in item ? item.serviceType : ""}`}
                className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="flex min-w-0 items-start gap-2 text-foreground">
                  <Icon
                    className={
                      item.tone === "warning"
                        ? "mt-0.5 size-4 shrink-0 text-warning"
                        : "mt-0.5 size-4 shrink-0 text-info"
                    }
                    aria-hidden
                  />
                  <span>{text}</span>
                </p>
                {item.section ? (
                  <Link
                    to="/admin/instellingen"
                    hash={`${item.section}-title`}
                    className="inline-flex min-h-8 shrink-0 items-center gap-1 self-start text-sm font-semibold text-primary underline-offset-4 hover:underline sm:self-center"
                    aria-label={t("admin.home.setup.openLabel", { item: text })}
                  >
                    {t("admin.home.setup.open")}
                    <ChevronRight className="size-4" aria-hidden />
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {serverItems ? (
        <p className="mt-3 text-xs text-muted-foreground">{t("admin.home.setup.deployment")}</p>
      ) : null}
    </DashboardPanel>
  );
}
