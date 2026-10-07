import "@tanstack/react-start/server-only";

import { MissingEnvError, getCronSecret } from "@/server/env";

/**
 * The bearer check of /api/cron/* (SPEC §35.12): `Authorization: Bearer
 * <CRON_SECRET>`, compared as SHA-256 digests with timingSafeEqual, so
 * neither the comparison time nor a length difference reveals anything about
 * the secret. 500 while CRON_SECRET is not set (or too short), 401 on any
 * mismatch. Nothing else from the request is read. (Not Lovable's generated
 * cron-auth.ts: SPEC §35.2 rules out LOVABLE_CRON_SECRET.)
 */
export type CronAuthorization = { ok: true } | { ok: false; status: 401 | 500 };

const BEARER = /^Bearer ([^\s,]+)$/;

export async function authorizeCron(authorization: string | null): Promise<CronAuthorization> {
  let secret: string;
  try {
    secret = getCronSecret();
  } catch (error) {
    if (error instanceof MissingEnvError) return { ok: false, status: 500 };
    throw error;
  }
  const presented = BEARER.exec(authorization ?? "")?.[1] ?? "";
  const { createHash, timingSafeEqual } = await import("node:crypto");
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  // Always compare (also for an empty token), so a missing header takes as long as a wrong one.
  const matches = timingSafeEqual(digest(presented), digest(secret));
  return matches && presented !== "" ? { ok: true } : { ok: false, status: 401 };
}
