import "@tanstack/react-start/server-only";

import {
  MissingEnvError,
  getAppUrl,
  getCronSecret,
  getResendConfig,
  getServiceRoleKey,
} from "@/server/env";

/**
 * The "Systeemstatus" panel (SPEC §35.2): whether the server is configured,
 * as booleans only. No value, length or prefix of any variable ever leaves
 * this function. Load with `await import("@/server/system-status")` inside a
 * server handler.
 */
export interface ConfigStatus {
  /** SUPABASE_SERVICE_ROLE_KEY is set (invitations, deactivating, reset links). */
  serviceRoleKey: boolean;
  /** APP_URL is set and a valid origin. */
  appUrl: boolean;
  /** No APP_URL, but Vercel's production domain stands in for links. */
  appUrlFromVercel: boolean;
  /** RESEND_API_KEY and EMAIL_FROM are both set. */
  email: boolean;
  /** CRON_SECRET is set and long enough (payment reminders, P8). */
  cronSecret: boolean;
}

function works(getter: () => unknown): boolean {
  try {
    getter();
    return true;
  } catch (error) {
    if (error instanceof MissingEnvError) return false;
    throw error;
  }
}

export function configStatus(): ConfigStatus {
  const appUrlSet = Boolean(process.env["APP_URL"]?.trim());
  const linksWork = works(getAppUrl);
  return {
    serviceRoleKey: works(getServiceRoleKey),
    appUrl: appUrlSet && linksWork,
    appUrlFromVercel: !appUrlSet && linksWork,
    email: getResendConfig() !== null,
    cronSecret: works(getCronSecret),
  };
}
