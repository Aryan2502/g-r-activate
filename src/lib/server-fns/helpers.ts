import {
  fromTransportError,
  toAppError,
  toTransportError,
  type TransportError,
} from "@/lib/errors";

/**
 * Small helpers shared by the privileged server functions of the admin
 * pages (customers, team, system status). This module is also part of the
 * browser bundle (unwrap), so it holds nothing server-only: those helpers
 * live in src/server/fn-helpers.ts, loaded with a dynamic import inside the
 * handlers.
 */

export type Failure = { ok: false; error: TransportError };
export type LinkSource = "app_url" | "request";

/** Expected refusals (validation, state, access) are warnings; the rest is an error. */
export function logFailure(name: string, error: unknown) {
  const kind = toAppError(error).kind;
  const log = kind === "unknown" || kind === "network" ? console.error : console.warn;
  log(`[${name}] failed`, error);
}

/** Browser side: a returned failure is thrown as a CodedError. */
export function unwrap<T extends { ok: true }>(result: T | Failure): T {
  if (!result.ok) throw fromTransportError(result.error);
  return result;
}
