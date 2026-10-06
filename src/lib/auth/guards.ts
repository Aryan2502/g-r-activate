import type { QueryClient } from "@tanstack/react-query";
import { redirect, type ParsedLocation } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { isStaffRole, safeRedirect, type AppRole } from "@/lib/auth/redirect";
import { roleQueryOptions } from "@/lib/auth/roles";
import { paths } from "@/lib/paths";

export interface AuthContext {
  userId: string;
  email: string;
  role: AppRole;
}

/**
 * beforeLoad of /portal and /admin (SPEC §35.2, client-only routes): no session
 * → /login?redirect=…; then the role decides the area. This only routes the
 * user; RLS and the RPC guards are what actually protect the data.
 */
export async function requireArea(
  area: "portal" | "admin",
  { queryClient, location }: { queryClient: QueryClient; location: ParsedLocation },
): Promise<{ auth: AuthContext }> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) {
    const back = safeRedirect(location.href);
    throw redirect({
      href: back ? `${paths.login}?${new URLSearchParams({ redirect: back })}` : paths.login,
    });
  }

  const role = await queryClient.ensureQueryData(roleQueryOptions(session.user.id));
  if (area === "admin" && !isStaffRole(role)) throw redirect({ href: paths.portal });
  if (area === "portal" && isStaffRole(role)) throw redirect({ href: paths.admin });

  return { auth: { userId: session.user.id, email: session.user.email ?? "", role } };
}
