import type { SupabaseClient } from "@supabase/supabase-js";
import { createMiddleware } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { TransportError } from "@/lib/errors";
import { t } from "@/lib/i18n";

/**
 * Role checks for privileged server functions (SPEC §35.2):
 *
 *   createServerFn({ method: "POST" })
 *     .middleware([requireStaff])        // runs requireSupabaseAuth first
 *     .validator((input: Input): unknown => input)
 *     .handler(async ({ context, data }) => {
 *       const access = context.access;
 *       if (!access.ok) return denied(access);
 *       // access.supabase / access.userId: reachable only after the check
 *     });
 *
 * The role comes from public.is_staff()/is_admin() called with the caller's own
 * client, never from anything the browser sends.
 *
 * A missing role is NOT thrown: TanStack Start sends a thrown error to the
 * browser with its message only, so the 403/42501 would arrive as a generic
 * failure (PROGRESS.md, P2b). The middleware hands the outcome to the handler
 * as `context.access` instead, and the handler RETURNS the failure as data
 * (TransportError, like registerOrderFn).
 *
 * The caller's client, user id and claims are reachable ONLY through a
 * successful `context.access`: the middleware overwrites the `supabase`,
 * `userId` and `claims` that requireSupabaseAuth put in the context with
 * `undefined` (also in the types), so a handler that forgets the check does
 * not compile when it uses them, and has nothing to use at runtime
 * (middleware.test.ts checks every handler of *.functions.ts as well). The
 * database guards every write again (RLS, RPC guards), whatever happens here.
 */

export type RequiredRole = "staff" | "admin";

/** The caller lacks the role; its code is the SQLSTATE the database uses for the same refusal. */
export class ForbiddenError extends Error {
  readonly status = 403;
  readonly code = "42501";

  constructor(message: string = t("apiError.forbidden")) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Calls is_staff()/is_admin() as the caller; throws ForbiddenError unless it returns true. */
export async function assertRole(
  client: Pick<SupabaseClient<Database>, "rpc">,
  role: RequiredRole,
): Promise<void> {
  const { data, error } = await client.rpc(role === "admin" ? "is_admin" : "is_staff");
  if (error) {
    console.error(`[requireRole] ${role} check failed`, error);
    throw new Error(t("apiError.roleCheckFailed"));
  }
  if (data !== true) throw new ForbiddenError();
}

/**
 * The role check as data: null when the caller has the role, else the
 * failure to return to the browser (42501, or "could not check" without a
 * code when the check itself failed: fail closed, but not as "no access").
 */
export async function checkRole(
  client: Pick<SupabaseClient<Database>, "rpc">,
  role: RequiredRole,
): Promise<TransportError | null> {
  try {
    await assertRole(client, role);
    return null;
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { message: error.message, code: error.code, hint: null };
    }
    return { message: t("apiError.roleCheckFailed"), code: null, hint: null };
  }
}

/** What a privileged handler gets in `context.access`. */
export type RoleAccess =
  | { ok: true; role: RequiredRole; supabase: SupabaseClient<Database>; userId: string }
  | { ok: false; error: TransportError };

export async function resolveAccess(
  context: { supabase: SupabaseClient<Database>; userId: string },
  role: RequiredRole,
): Promise<RoleAccess> {
  const denied = await checkRole(context.supabase, role);
  if (denied) {
    console.warn(`[requireRole] ${role} refused for ${context.userId}: ${denied.code ?? "check"}`);
    return { ok: false, error: denied };
  }
  return { ok: true, role, supabase: context.supabase, userId: context.userId };
}

/** A failed role check as the handler's return value. */
export function denied(access: Extract<RoleAccess, { ok: false }>) {
  return { ok: false as const, error: access.error };
}

/**
 * What a privileged handler's context holds besides `access`: the unchecked
 * values of requireSupabaseAuth, removed (fail closed, also for the types).
 */
const WITHOUT_UNCHECKED = { supabase: undefined, userId: undefined, claims: undefined } as const;

export const requireStaff = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const access = await resolveAccess(context, "staff");
    return next({ context: { ...WITHOUT_UNCHECKED, access } });
  });

export const requireAdmin = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const access = await resolveAccess(context, "admin");
    return next({ context: { ...WITHOUT_UNCHECKED, access } });
  });
