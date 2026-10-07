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

/** A run still 'running' after this long was killed (src/server/reminders.ts STALE_RUN_MS). */
export const STALE_RUN_MS = 15 * 60_000;
/** The daily run fires every 24 h; without an automatic run for this long it has stopped. */
export const CRON_SILENCE_MS = 26 * 60 * 60_000;

export interface JobRunSummary {
  status: Database["public"]["Enums"]["job_run_status"];
  trigger: Database["public"]["Enums"]["job_trigger"];
  startedAt: string;
  finishedAt: string | null;
}

export interface SystemStatus {
  serviceRoleKey: boolean;
  appUrl: boolean;
  appUrlFromVercel: boolean;
  email: boolean;
  cronSecret: boolean;
  /** The last run of the payment reminders, automatic or by hand. */
  lastReminderRun: JobRunSummary | null;
  /** The last AUTOMATIC run (pg_cron → /api/cron/payment-reminders). */
  lastCronReminderRun?: JobRunSummary | null;
}

export type RunState = "running" | "succeeded" | "failed" | "abandoned";

/** A job run's status as shown: 'running' long after it started means it was killed. */
export function runState(
  run: { status: JobRunSummary["status"]; started_at?: string; startedAt?: string },
  now: Date = new Date(),
): RunState {
  if (run.status !== "running") return run.status;
  const started = Date.parse(run.started_at ?? run.startedAt ?? "");
  return Number.isFinite(started) && now.getTime() - started > STALE_RUN_MS
    ? "abandoned"
    : "running";
}

/**
 * Whether the daily schedule looks stopped: CRON_SECRET is set (so the
 * schedule is meant to run) but no automatic run started in the last 26
 * hours. The causes (Vault secrets missing or different from CRON_SECRET, an
 * app_url that redirects) never reach the app, so this is the only sign.
 */
export function cronSilent(system: SystemStatus, now: Date = new Date()): boolean {
  if (!system.cronSecret || system.lastCronReminderRun === undefined) return false;
  const last = system.lastCronReminderRun;
  if (!last) return true;
  const started = Date.parse(last.startedAt);
  return !Number.isFinite(started) || now.getTime() - started > CRON_SILENCE_MS;
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
  | { key: "email"; tone: "info"; section: null }
  | { key: "cronSecret"; tone: "warning"; section: null }
  | { key: "cronSilent"; tone: "warning"; section: null; neverRan: boolean };

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
  now?: Date;
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
  if (input.system && !input.system.cronSecret) {
    items.push({ key: "cronSecret", tone: "warning", section: null });
  } else if (input.system && cronSilent(input.system, input.now)) {
    items.push({
      key: "cronSilent",
      tone: "warning",
      section: null,
      neverRan: !input.system.lastCronReminderRun,
    });
  }
  if (input.system && !input.system.email) {
    items.push({ key: "email", tone: "info", section: null });
  }
  return items;
}
