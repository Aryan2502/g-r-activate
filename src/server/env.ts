import "@tanstack/react-start/server-only";

/**
 * Server-only configuration (SPEC §35.2). Each getter reads and validates only
 * its own variable when it is first needed, so a missing CRON_SECRET breaks
 * /api/cron/* and nothing else. Load with `await import("@/server/env")` inside
 * a server handler; client code never imports this file.
 */

export class MissingEnvError extends Error {
  readonly variable: string;

  constructor(variable: string, reason = "is not set") {
    super(`Server configuration: ${variable} ${reason}.`);
    this.name = "MissingEnvError";
    this.variable = variable;
  }
}

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function requireVar(name: string): string {
  const value = read(name);
  if (!value) throw new MissingEnvError(name);
  return value;
}

/** SUPABASE_SERVICE_ROLE_KEY: only for the uses SPEC §35.2 allows. */
export function getServiceRoleKey(): string {
  return requireVar("SUPABASE_SERVICE_ROLE_KEY");
}

/** CRON_SECRET: bearer token of /api/cron/* requests; at least 32 characters. */
export function getCronSecret(): string {
  const value = requireVar("CRON_SECRET");
  if (value.length < 32) throw new MissingEnvError("CRON_SECRET", "must be at least 32 characters");
  return value;
}

function normalizeAppUrl(variable: string, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MissingEnvError(variable, "is not a valid URL");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new MissingEnvError(variable, "must use https");
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new MissingEnvError(variable, "must be an origin such as https://example.com");
  }
  return url.origin;
}

/**
 * Public base URL for links in emails and invitations: APP_URL, else Vercel's
 * production domain. Never derived from the Host header or window.location.
 */
export function getAppUrl(): string {
  const appUrl = read("APP_URL");
  if (appUrl) return normalizeAppUrl("APP_URL", appUrl);
  const vercel = read("VERCEL_PROJECT_PRODUCTION_URL");
  if (vercel) return normalizeAppUrl("VERCEL_PROJECT_PRODUCTION_URL", `https://${vercel}`);
  throw new MissingEnvError("APP_URL");
}

export interface ResendConfig {
  apiKey: string;
  from: string;
  replyTo: string | null;
}

/**
 * Resend settings, or null when RESEND_API_KEY or EMAIL_FROM is missing:
 * email is optional and then becomes a `skipped_no_provider` log row.
 */
export function getResendConfig(): ResendConfig | null {
  const apiKey = read("RESEND_API_KEY");
  const from = read("EMAIL_FROM");
  if (!apiKey || !from) return null;
  return { apiKey, from, replyTo: read("EMAIL_REPLY_TO") ?? null };
}
