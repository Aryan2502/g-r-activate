import "@tanstack/react-start/server-only";

import { MissingEnvError, getAppUrl } from "@/server/env";

/**
 * The base of a link that is only SHOWN to staff on screen (an invitation or
 * a password-reset link to copy or share via WhatsApp). APP_URL when it is
 * set (SPEC §35.2); otherwise — e.g. in the Lovable preview without APP_URL —
 * the origin the staff member's browser is using, so the link opens where
 * they are. E-mails never use this fallback: they call getAppUrl() and fail
 * without it.
 */
export function screenLinkBase(request: Request | undefined): {
  base: string;
  source: "app_url" | "request";
} {
  try {
    return { base: getAppUrl(), source: "app_url" };
  } catch (error) {
    if (!(error instanceof MissingEnvError)) throw error;
  }
  const origin = request?.headers.get("origin");
  if (origin && /^https?:\/\/[^/\s]+$/i.test(origin)) return { base: origin, source: "request" };
  if (request?.url) return { base: new URL(request.url).origin, source: "request" };
  throw new MissingEnvError("APP_URL");
}
