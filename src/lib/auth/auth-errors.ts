import { t } from "@/lib/i18n";

export type AuthErrorKind =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "banned"
  | "rate_limited"
  | "weak_password"
  | "same_password"
  | "link_invalid"
  | "session_missing"
  | "signup_disabled"
  | "user_exists"
  | "invalid_email"
  | "email_not_authorized"
  | "network"
  | "unknown";

const BY_CODE: Record<string, AuthErrorKind> = {
  invalid_credentials: "invalid_credentials",
  email_not_confirmed: "email_not_confirmed",
  user_banned: "banned",
  over_request_rate_limit: "rate_limited",
  over_email_send_rate_limit: "rate_limited",
  weak_password: "weak_password",
  same_password: "same_password",
  otp_expired: "link_invalid",
  flow_state_expired: "link_invalid",
  flow_state_not_found: "link_invalid",
  session_not_found: "session_missing",
  session_expired: "session_missing",
  refresh_token_not_found: "session_missing",
  refresh_token_already_used: "session_missing",
  signup_disabled: "signup_disabled",
  email_provider_disabled: "signup_disabled",
  user_already_exists: "user_exists",
  email_exists: "user_exists",
  email_address_invalid: "invalid_email",
  email_address_not_authorized: "email_not_authorized",
};

// Older Auth servers send no code; match their English messages.
const BY_MESSAGE: [RegExp, AuthErrorKind][] = [
  [/invalid login credentials/i, "invalid_credentials"],
  [/email not confirmed/i, "email_not_confirmed"],
  [/user is banned/i, "banned"],
  [/rate limit|too many requests|only request this after/i, "rate_limited"],
  [/token has expired|is invalid or has expired|otp.*expired/i, "link_invalid"],
  [/auth session missing/i, "session_missing"],
  [/signups not allowed/i, "signup_disabled"],
  [/already registered/i, "user_exists"],
  [/different from the old password/i, "same_password"],
  [/password should be|weak password/i, "weak_password"],
  [/failed to fetch|networkerror|load failed|fetch failed/i, "network"],
];

/** Classifies a Supabase Auth error (AuthError or a URL `error_code`). */
export function classifyAuthError(error: unknown): AuthErrorKind {
  if (typeof error === "string") return BY_CODE[error] ?? "unknown";
  if (error === null || typeof error !== "object") return "unknown";
  const e = error as { code?: unknown; status?: unknown; message?: unknown; name?: unknown };

  if (typeof e.code === "string" && BY_CODE[e.code]) return BY_CODE[e.code] as AuthErrorKind;
  if (e.name === "AuthRetryableFetchError" || e.status === 0) return "network";
  if (e.name === "AuthSessionMissingError") return "session_missing";
  if (e.name === "AuthWeakPasswordError") return "weak_password";
  if (e.status === 429) return "rate_limited";

  const message = typeof e.message === "string" ? e.message : "";
  for (const [pattern, kind] of BY_MESSAGE) {
    if (pattern.test(message)) return kind;
  }
  return "unknown";
}

/**
 * True for Auth's mail-sending limits (per-address frequency or the project's
 * email quota). Auth only reaches them for addresses that have an account, so
 * the reset and resend forms treat them as "sent" to reveal nothing (SPEC §35.6).
 */
export function isEmailSendLimit(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code === "over_email_send_rate_limit") return true;
  if (typeof e.code === "string") return false;
  const message = typeof e.message === "string" ? e.message : "";
  return /only request this after|email rate limit exceeded/i.test(message);
}

/**
 * What the reset and resend forms may show: only failures that do not depend
 * on the address (network, per-IP limit). Anything else counts as "sent".
 */
export function addressIndependentFailure(error: unknown): boolean {
  if (!error || isEmailSendLimit(error)) return false;
  const kind = classifyAuthError(error);
  return kind === "network" || kind === "rate_limited";
}

export function authErrorMessage(error: unknown): string {
  switch (classifyAuthError(error)) {
    case "invalid_credentials":
      return t("auth.errors.invalidCredentials");
    case "email_not_confirmed":
      return t("auth.errors.emailNotConfirmed");
    case "banned":
      return t("auth.errors.banned");
    case "rate_limited":
      return t("auth.errors.rateLimited");
    case "weak_password":
      return t("auth.errors.weakPassword");
    case "same_password":
      return t("auth.errors.samePassword");
    case "link_invalid":
      return t("auth.errors.linkInvalid");
    case "session_missing":
      return t("auth.errors.sessionMissing");
    case "signup_disabled":
      return t("auth.errors.signupDisabled");
    case "user_exists":
      return t("auth.errors.userExists");
    case "invalid_email":
      return t("auth.errors.invalidEmail");
    case "email_not_authorized":
      return t("auth.errors.emailNotAuthorized");
    case "network":
      return t("toast.networkError");
    case "unknown":
      return t("toast.genericError");
  }
}
