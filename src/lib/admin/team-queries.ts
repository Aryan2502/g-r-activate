import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { INVITATION_COLUMNS, type InvitationSummary } from "@/lib/admin/customer-actions";
import { adminKeys } from "@/lib/admin/keys";
import { loadTeam, type TeamList } from "@/lib/admin/team";

/**
 * Reads of the team page (/admin/team) with the signed-in user's client.
 * Writes are in team.ts and lib/server-fns/team.functions.ts.
 */

/** Everyone with a role (team_members(): staff read, admins change). */
export const teamQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.teamMembers(userId),
    staleTime: 30_000,
    queryFn: (): Promise<TeamList> => loadTeam(supabase),
  });

/** Staff invitations that are still open or expired (not accepted, not revoked). */
export const staffInvitationsQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.teamInvitations(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<InvitationSummary[]> => {
      const { data, error } = await supabase
        .from("invitations")
        .select(INVITATION_COLUMNS)
        .eq("kind", "staff")
        .is("accepted_at", null)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
