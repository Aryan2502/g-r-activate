import "@tanstack/react-start/server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { getServiceRoleKey } from "@/server/env";
import type { AdminClient } from "@/server/invitations";

/**
 * The service-role client, for the uses SPEC §35.2 allows (auth.admin.*,
 * invitation lookup and redemption after the token check, e-mail-log
 * bookkeeping, the reminder job after its access check). Throws
 * MissingEnvError("SUPABASE_SERVICE_ROLE_KEY") when the key is not set, so
 * callers can answer "not configured" instead of a generic failure.
 */
export async function loadAdminClient(): Promise<AdminClient> {
  getServiceRoleKey();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** The same client with Storage, for the cron job's clean-up of orphaned uploads. */
export type StorageAdminClient = Pick<SupabaseClient<Database>, "rpc" | "from" | "storage">;

export async function loadStorageAdmin(): Promise<StorageAdminClient> {
  getServiceRoleKey();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
