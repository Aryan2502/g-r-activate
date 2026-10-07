import "@tanstack/react-start/server-only";

import { getRequest } from "@tanstack/react-start/server";

import { toTransportError, type TransportError } from "@/lib/errors";
import { t } from "@/lib/i18n";
import { MissingEnvError } from "@/server/env";
import { screenLinkBase } from "@/server/links";

/**
 * Server-only helpers of the admin server functions (customers, team).
 * Load with `await import("@/server/fn-helpers")` inside a handler.
 */

/** A missing service-role key, as a message for staff (never the variable's value). */
export function serviceFailure(error: unknown): TransportError {
  if (error instanceof MissingEnvError) {
    return { message: t("admin.serviceRoleMissing"), code: null, hint: null };
  }
  return toTransportError(error);
}

/** The base of a link shown on screen only (APP_URL, else the browser's origin). */
export function screenBase() {
  return screenLinkBase(getRequest());
}
