import type { SupabaseClient } from "@supabase/supabase-js";
import { createMiddleware } from "@tanstack/react-start";
import { setResponseStatus } from "@tanstack/react-start/server";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { t } from "@/lib/i18n";

/**
 * Role checks for privileged server functions (SPEC §35.2):
 *
 *   createServerFn({ method: "POST" })
 *     .middleware([requireStaff])        // runs requireSupabaseAuth first
 *     .validator(schema)
 *     .handler(({ context, data }) => context.supabase.rpc(...));
 *
 * The role comes from public.is_staff()/is_admin() called with the caller's own
 * client, never from anything the browser sends.
 */

export type RequiredRole = "staff" | "admin";

/** Thrown when the caller lacks the role; the client sees status 403 and SQLSTATE 42501. */
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

async function enforce(client: SupabaseClient<Database>, role: RequiredRole): Promise<void> {
  try {
    await assertRole(client, role);
  } catch (error) {
    setResponseStatus(error instanceof ForbiddenError ? 403 : 500);
    throw error;
  }
}

export const requireStaff = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    await enforce(context.supabase, "staff");
    return next();
  });

export const requireAdmin = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    await enforce(context.supabase, "admin");
    return next();
  });
