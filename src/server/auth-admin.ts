import "@tanstack/react-start/server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { recoveryLink } from "@/lib/admin/invitations";

/**
 * auth.admin.* calls of the customer and team pages (SPEC §35.2: the service
 * role only for these). The admin client is passed in, so tests can replace
 * it. Load with `await import("@/server/auth-admin")` inside a server handler.
 */

export type AuthAdminClient = Pick<SupabaseClient<Database>, "auth">;

/** ~100 years: Supabase's way to block a login until it is lifted again. */
export const BAN_DURATION = "876000h";

/**
 * Blocks or unblocks a login (SPEC §35.5: disabling a customer). The login
 * page shows the banned error as "Uw account is gedeactiveerd".
 */
export async function setLoginBanned(
  admin: AuthAdminClient,
  userId: string,
  banned: boolean,
): Promise<void> {
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: banned ? BAN_DURATION : "none",
  });
  if (error) throw error;
}

/**
 * "Wachtwoord-resetlink maken" (SPEC §35.6): a recovery link for the login's
 * current address, built from hashed_token so it goes through /auth/confirm
 * ("Doorgaan" before the token is used). generateLink sends no e-mail.
 */
export async function createRecoveryLink(
  admin: AuthAdminClient,
  userId: string,
  base: string,
): Promise<string> {
  const { data: found, error } = await admin.auth.admin.getUserById(userId);
  if (error) throw error;
  const email = found.user?.email;
  if (!email) throw new Error("login has no e-mail address");
  const { data, error: linkError } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  if (linkError) throw linkError;
  return recoveryLink(base, data.properties.hashed_token);
}
