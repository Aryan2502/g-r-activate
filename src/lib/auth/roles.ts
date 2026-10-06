import type { SupabaseClient } from "@supabase/supabase-js";
import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { AppRole } from "@/lib/auth/redirect";

/**
 * The signed-in user's role, from the is_admin()/is_staff() RPCs (SPEC §35.4:
 * never from metadata or JWT claims). Anyone without a staff role is a customer.
 */
export async function getRole(client: SupabaseClient<Database> = supabase): Promise<AppRole> {
  const [admin, staff] = await Promise.all([client.rpc("is_admin"), client.rpc("is_staff")]);
  if (admin.error) throw admin.error;
  if (staff.error) throw staff.error;
  if (admin.data === true) return "admin";
  return staff.data === true ? "staff" : "customer";
}

export const roleQueryKey = (userId: string) => ["auth", userId, "role"] as const;

export const roleQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: roleQueryKey(userId),
    queryFn: () => getRole(),
    staleTime: 60_000,
  });
