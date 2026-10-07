import type { Database } from "@/integrations/supabase/types";
import {
  SERVICE_TYPES,
  incompleteBankCurrencies,
  isPlaceholderText,
  isUnset,
  type BankAccount,
  type CompanySettings,
  type ServiceRate,
  type ServiceType,
  type SettingsSectionId,
} from "@/lib/admin/settings";
import type { CurrencyCode } from "@/lib/format";

/**
 * The admin dashboard's setup checklist (SPEC §35.8) and "Systeemstatus"
 * panel (SPEC §35.2). The checklist is derived from settings rows every
 * staff member can read, plus, for admins, the server's configuration as
 * booleans (systemStatusFn). Pure, so it is unit-tested.
 */

/** job_runs.job of the payment reminders (SPEC §35.12, P8). */
export const REMINDER_JOB = "payment_reminders";

export interface SystemStatus {
  serviceRoleKey: boolean;
  appUrl: boolean;
  appUrlFromVercel: boolean;
  email: boolean;
  cronSecret: boolean;
  lastReminderRun: {
    status: Database["public"]["Enums"]["job_run_status"];
    trigger: Database["public"]["Enums"]["job_trigger"];
    startedAt: string;
    finishedAt: string | null;
  } | null;
}

export type SetupItem =
  | { key: "bankAccounts"; tone: "warning"; section: SettingsSectionId; currencies: CurrencyCode[] }
  | { key: "warehouseAddress"; tone: "warning"; section: SettingsSectionId }
  | { key: "noService"; tone: "warning"; section: SettingsSectionId }
  | { key: "serviceRate"; tone: "warning"; section: SettingsSectionId; serviceType: ServiceType }
  | { key: "pickupHours"; tone: "info"; section: SettingsSectionId }
  | { key: "termsPlaceholder"; tone: "info"; section: SettingsSectionId }
  | { key: "prohibitedPlaceholder"; tone: "info"; section: SettingsSectionId }
  | { key: "serviceRoleKey"; tone: "warning"; section: null }
  | { key: "appUrl"; tone: "warning" | "info"; section: null; fromVercel: boolean }
  | { key: "email"; tone: "info"; section: null };

export interface SetupInput {
  bankAccounts?: readonly BankAccount[] | undefined;
  /** Active addresses only matter: customers see only those. */
  warehouseAddresses?: readonly { is_active: boolean }[] | undefined;
  serviceRates?:
    readonly Pick<ServiceRate, "service_type" | "enabled" | "rate_per_lb">[] | undefined;
  settings?:
    | Pick<CompanySettings, "pickup_hours" | "terms_markdown" | "prohibited_goods_markdown">
    | undefined;
  /** Admins only (null for staff, undefined while loading). */
  system?: SystemStatus | null | undefined;
}

/**
 * What still needs setting up, most important first. A source that has not
 * loaded (undefined) adds nothing, so the list never claims something is
 * missing when it simply is not known yet.
 */
export function setupChecklist(input: SetupInput): SetupItem[] {
  const items: SetupItem[] = [];
  if (input.system) {
    if (!input.system.serviceRoleKey) {
      items.push({ key: "serviceRoleKey", tone: "warning", section: null });
    }
    if (!input.system.appUrl) {
      items.push({
        key: "appUrl",
        tone: input.system.appUrlFromVercel ? "info" : "warning",
        section: null,
        fromVercel: input.system.appUrlFromVercel,
      });
    }
  }
  if (input.bankAccounts) {
    const currencies = incompleteBankCurrencies(input.bankAccounts);
    if (currencies.length > 0) {
      items.push({ key: "bankAccounts", tone: "warning", section: "bankrekeningen", currencies });
    }
  }
  if (input.warehouseAddresses && !input.warehouseAddresses.some((a) => a.is_active)) {
    items.push({ key: "warehouseAddress", tone: "warning", section: "us-adressen" });
  }
  if (input.serviceRates) {
    const enabled = input.serviceRates.filter((r) => r.enabled);
    if (enabled.length === 0)
      items.push({ key: "noService", tone: "warning", section: "tarieven" });
    for (const type of SERVICE_TYPES) {
      const rate = enabled.find((r) => r.service_type === type);
      if (rate && rate.rate_per_lb === null) {
        items.push({ key: "serviceRate", tone: "warning", section: "tarieven", serviceType: type });
      }
    }
  }
  if (input.settings) {
    if (isUnset(input.settings.pickup_hours)) {
      items.push({ key: "pickupHours", tone: "info", section: "afhalen" });
    }
    if (isPlaceholderText(input.settings.terms_markdown)) {
      items.push({ key: "termsPlaceholder", tone: "info", section: "teksten" });
    }
    if (isPlaceholderText(input.settings.prohibited_goods_markdown)) {
      items.push({ key: "prohibitedPlaceholder", tone: "info", section: "teksten" });
    }
  }
  if (input.system && !input.system.email) {
    items.push({ key: "email", tone: "info", section: null });
  }
  return items;
}
