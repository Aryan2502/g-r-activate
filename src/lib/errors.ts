import { t } from "@/lib/i18n";

/**
 * Turns database, PostgREST, server-function and network errors into one Dutch
 * message for toasts and inline alerts.
 *
 * The migrations raise their own Dutch messages with explicit SQLSTATEs
 * (22023, 23505, 42501, 54000, 55000, P0002) and sometimes a machine-readable
 * hint; those messages are written for end users and are shown as-is. Errors
 * Postgres raises by itself (English text) get a generic Dutch message instead.
 */

export type AppErrorKind =
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid"
  | "state"
  | "limit"
  | "network"
  | "session"
  | "unknown";

/** Hints the migrations attach to errors the UI can act on. */
export type DbErrorHint = "open_order_limit" | "invoice_dates" | "pay_before_pickup";

export interface AppError {
  kind: AppErrorKind;
  message: string;
  code: string | null;
  hint: DbErrorHint | null;
}

const KNOWN_HINTS: readonly DbErrorHint[] = [
  "open_order_limit",
  "invoice_dates",
  "pay_before_pickup",
];

// SQLSTATEs the migrations raise with a user-facing Dutch message.
const OWN_CODES: Record<string, AppErrorKind> = {
  "22023": "invalid",
  "23505": "conflict",
  "42501": "forbidden",
  "54000": "limit",
  "55000": "state",
  P0002: "not_found",
};

// Messages Postgres/PostgREST produce themselves for those same SQLSTATEs.
const NATIVE_MESSAGE =
  /^(duplicate key value|new row violates|permission denied|null value in column|value too long|insert or update on table|update or delete on table|query returned no rows|invalid input|stack depth|index row|could not|cannot|must be|function .* does not exist)/i;

const NETWORK_MESSAGE =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|fetcherror/i;

type ErrorLike = {
  message?: unknown;
  code?: unknown;
  hint?: unknown;
  status?: unknown;
  name?: unknown;
};

function field(error: ErrorLike, key: keyof ErrorLike): string | null {
  const value = error[key];
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function fallback(code: string | null): { kind: AppErrorKind; message: string } {
  switch (code) {
    case "42501":
      return { kind: "forbidden", message: t("apiError.forbidden") };
    case "P0002":
    case "PGRST116":
      return { kind: "not_found", message: t("apiError.notFound") };
    case "23505":
      return { kind: "conflict", message: t("apiError.duplicate") };
    case "23503":
      return { kind: "conflict", message: t("apiError.inUse") };
    case "23502":
      return { kind: "invalid", message: t("apiError.required") };
    case "22001":
      return { kind: "invalid", message: t("apiError.tooLong") };
    case "22023":
    case "23514":
    case "22P02":
    case "22007":
    case "22008":
    case "22003":
      return { kind: "invalid", message: t("apiError.invalidValue") };
    case "55000":
      return { kind: "state", message: t("apiError.invalidState") };
    case "54000":
      return { kind: "limit", message: t("apiError.limit") };
    case "40001":
    case "40P01":
    case "55P03":
      return { kind: "conflict", message: t("apiError.concurrent") };
    case "57014":
      return { kind: "unknown", message: t("apiError.timeout") };
    default:
      if (code && /^PGRST30\d$/.test(code)) {
        return { kind: "session", message: t("apiError.sessionExpired") };
      }
      return { kind: "unknown", message: t("toast.genericError") };
  }
}

/** Classifies any thrown value; never throws. */
export function toAppError(error: unknown): AppError {
  if (error === null || error === undefined || typeof error !== "object") {
    const text = typeof error === "string" ? error : "";
    if (NETWORK_MESSAGE.test(text)) {
      return { kind: "network", message: t("toast.networkError"), code: null, hint: null };
    }
    return { kind: "unknown", message: t("toast.genericError"), code: null, hint: null };
  }

  const e = error as ErrorLike;
  const code = field(e, "code");
  const rawHint = field(e, "hint");
  const hint = KNOWN_HINTS.find((h) => h === rawHint) ?? null;
  const message = field(e, "message");

  if (!code && message && NETWORK_MESSAGE.test(message)) {
    return { kind: "network", message: t("toast.networkError"), code: null, hint: null };
  }
  // A server function's 403 (requireStaff/requireAdmin) carries code 42501 too.
  if (!code && field(e, "status") === "403") {
    return { kind: "forbidden", message: message ?? t("apiError.forbidden"), code: "42501", hint };
  }

  const own = code ? OWN_CODES[code] : undefined;
  if (own && message && !NATIVE_MESSAGE.test(message)) {
    return { kind: own, message, code, hint };
  }
  return { ...fallback(code), code, hint };
}

/** The Dutch message for a toast or alert. */
export function errorMessage(error: unknown): string {
  return toAppError(error).message;
}
