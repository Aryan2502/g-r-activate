/**
 * Parameters Supabase's own email links put on the redirect URL: a session in
 * the fragment (`#access_token=…&type=recovery`) or an error
 * (`error_code=otp_expired`). supabase-js stores the session and then clears
 * the fragment, so the values are read once when the app boots.
 */
export interface AuthCallback {
  type: string | null;
  hasSession: boolean;
  errorCode: string | null;
  errorDescription: string | null;
}

export function parseAuthCallback(href: string): AuthCallback | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const params = new URLSearchParams(url.search);
  new URLSearchParams(url.hash.replace(/^#/, "")).forEach((value, key) => params.set(key, value));

  const hasSession = params.has("access_token");
  const error = params.get("error");
  const errorCode = params.get("error_code") ?? error;
  const errorDescription = params.get("error_description");
  if (!hasSession && !errorCode && !errorDescription) return null;
  return {
    type: params.get("type"),
    hasSession,
    errorCode: errorCode ?? (errorDescription ? "unspecified_error" : null),
    errorDescription,
  };
}

/** The callback in the URL the app was opened with (null on the server or when absent). */
export const bootAuthCallback: AuthCallback | null =
  typeof window === "undefined" ? null : parseAuthCallback(window.location.href);
