import "@tanstack/react-start/server-only";

import { getServiceRoleKey } from "@/server/env";
import type { AdminClient } from "@/server/invitations";

/**
 * The service-role client, for the uses SPEC §35.2 allows (auth.admin.*,
 * invitation lookup and redemption after the token check). Throws
 * MissingEnvError("SUPABASE_SERVICE_ROLE_KEY") when the key is not set, so
 * callers can answer "not configured" instead of a generic failure.
 */
export async function loadAdminClient(): Promise<AdminClient> {
  getServiceRoleKey();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
