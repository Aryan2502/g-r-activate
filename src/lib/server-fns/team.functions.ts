import { createServerFn } from "@tanstack/react-start";

import { logRecoveryLink } from "@/lib/admin/customer-actions";
import { invitationLink } from "@/lib/admin/invitations";
import { parseActionInput } from "@/lib/admin/order-actions";
import {
  assertRecoveryForMember,
  assertTeamLoginChange,
  inviteStaff,
  inviteStaffSchema,
  loadTeam,
  logTeamLoginChange,
  teamLoginInputSchema,
  teamMemberInputSchema,
  type AppRole,
  type InviteStaffValues,
  type StaffInviteConflict,
  type TeamLoginInput,
  type TeamMemberInput,
} from "@/lib/admin/team";
import type { EmailOutcome } from "@/lib/email/outcome";
import { toTransportError, type TransportError } from "@/lib/errors";
import { logFailure, unwrap, type Failure, type LinkSource } from "@/lib/server-fns/helpers";
import { denied, requireAdmin } from "@/lib/server-fns/middleware";

/**
 * Team server functions (SPEC §35.4, /admin/team), admins only. The
 * invitation row, the audit entry and the role checks use the admin's OWN
 * client (RLS, guarded RPCs). The service role is used only for auth.admin.*:
 * banning/unbanning a login and the reset link (src/server/auth-admin.ts).
 * Role changes need no server function: set_user_role is called with the
 * admin's own client from the page (lib/admin/team.ts changeTeamRole).
 */

// ---------------------------------------------------------------------------
// "Medewerker uitnodigen"
// ---------------------------------------------------------------------------

export type InviteStaffResponse =
  | {
      ok: true;
      status: "invited";
      invitationId: string;
      email: string;
      role: AppRole;
      expiresAt: string;
      link: string;
      linkSource: LinkSource;
      /** The "uitnodiging" e-mail; the link is shown on screen either way. */
      emailOutcome: EmailOutcome;
    }
  | { ok: true; status: "conflict"; conflict: StaffInviteConflict }
  | Failure;

export const inviteStaffFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  // Typing only: the handler parses with zod, so a bad request gets a Dutch answer.
  .validator((input: InviteStaffValues): unknown => input)
  .handler(async ({ context, data }): Promise<InviteStaffResponse> => {
    const access = context.access;
    if (!access.ok) return denied(access);

    let input;
    let result;
    let base;
    try {
      input = parseActionInput(inviteStaffSchema, data);
      base = (await import("@/server/fn-helpers")).screenBase();
      const { createInvitationToken } = await import("@/server/invitation-tokens");
      result = await inviteStaff(access.supabase, input, createInvitationToken);
    } catch (error) {
      logFailure("inviteStaffFn", error);
      return { ok: false, error: toTransportError(error) };
    }
    if (result.status === "conflict") return { ok: true, ...result };

    // The "uitnodiging" e-mail. Never fails the invitation.
    let emailOutcome: EmailOutcome;
    try {
      const { onInvitationSent } = await import("@/server/invitation-notifications");
      ({ email: emailOutcome } = await onInvitationSent({
        db: access.supabase,
        invitationId: result.invitationId,
        kind: "staff",
        email: result.email,
        customerId: null,
        fullName: input.fullName,
        token: result.token,
        resend: false,
        userId: access.userId,
      }));
    } catch (error) {
      console.error("[inviteStaffFn] onInvitationSent failed", error);
      emailOutcome = "failed";
    }
    return {
      ok: true,
      status: "invited",
      invitationId: result.invitationId,
      email: result.email,
      role: result.role,
      expiresAt: result.expiresAt,
      link: invitationLink(base.base, result.token),
      linkSource: base.source,
      emailOutcome,
    };
  });

// ---------------------------------------------------------------------------
// "Deactiveren" / "Activeren" of a team member's login
// ---------------------------------------------------------------------------

export type TeamLoginResponse =
  | {
      ok: true;
      blocked: boolean;
      /** Open invitations of the blocked member that were revoked. */
      revokedInvitations: number;
      /** false: the login changed, but the audit entry could not be written. */
      logged: boolean;
      logError: TransportError | null;
    }
  | Failure;

export const setTeamLoginBlockedFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: TeamLoginInput): unknown => input)
  .handler(async ({ context, data }): Promise<TeamLoginResponse> => {
    const access = context.access;
    if (!access.ok) return denied(access);

    let input;
    try {
      input = parseActionInput(teamLoginInputSchema, data);
      // Who may be (un)blocked comes from the database, as the admin sees it:
      // only team members (customers have their own "Deactiveren"), never yourself.
      const team = await loadTeam(access.supabase);
      assertTeamLoginChange(team, access.userId, input);
    } catch (error) {
      logFailure("setTeamLoginBlockedFn", error);
      return { ok: false, error: toTransportError(error) };
    }

    // The ban first: if it fails, nothing changed and nothing is logged.
    try {
      const { loadAdminClient } = await import("@/server/admin-client");
      const { setLoginBanned } = await import("@/server/auth-admin");
      await setLoginBanned(await loadAdminClient(), input.userId, input.blocked);
    } catch (error) {
      console.error("[setTeamLoginBlockedFn] (un)ban failed", error);
      return { ok: false, error: (await import("@/server/fn-helpers")).serviceFailure(error) };
    }

    try {
      const logged = await logTeamLoginChange(access.supabase, input);
      return {
        ok: true,
        blocked: input.blocked,
        revokedInvitations: logged?.revokedInvitations ?? 0,
        logged: logged !== null,
        logError: null,
      };
    } catch (error) {
      console.error("[setTeamLoginBlockedFn] audit entry failed", error);
      return {
        ok: true,
        blocked: input.blocked,
        revokedInvitations: 0,
        logged: false,
        logError: toTransportError(error),
      };
    }
  });

// ---------------------------------------------------------------------------
// "Wachtwoord-resetlink maken" for a team member
// ---------------------------------------------------------------------------

export type TeamRecoveryLinkResponse = { ok: true; link: string; linkSource: LinkSource } | Failure;

export const createTeamRecoveryLinkFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: TeamMemberInput): unknown => input)
  .handler(async ({ context, data }): Promise<TeamRecoveryLinkResponse> => {
    const access = context.access;
    if (!access.ok) return denied(access);

    let userId;
    try {
      userId = parseActionInput(teamMemberInputSchema, data).userId;
      assertRecoveryForMember(await loadTeam(access.supabase), userId);
      // Fail closed: the audit row comes first (see logRecoveryLink).
      const audit = await logRecoveryLink(access.supabase, userId, null);
      if (audit === "unaudited") {
        console.warn("[createTeamRecoveryLinkFn] log_recovery_link missing: link not audited");
      }
    } catch (error) {
      logFailure("createTeamRecoveryLinkFn", error);
      return { ok: false, error: toTransportError(error) };
    }

    try {
      const base = (await import("@/server/fn-helpers")).screenBase();
      const { loadAdminClient } = await import("@/server/admin-client");
      const { createRecoveryLink } = await import("@/server/auth-admin");
      const link = await createRecoveryLink(await loadAdminClient(), userId, base.base);
      return { ok: true, link, linkSource: base.source };
    } catch (error) {
      console.error("[createTeamRecoveryLinkFn] generateLink failed", error);
      return { ok: false, error: (await import("@/server/fn-helpers")).serviceFailure(error) };
    }
  });

// ---------------------------------------------------------------------------
// Browser side
// ---------------------------------------------------------------------------

export async function submitInviteStaff(input: InviteStaffValues) {
  return unwrap(await inviteStaffFn({ data: input }));
}

export async function submitTeamLoginBlocked(input: TeamLoginInput) {
  return unwrap(await setTeamLoginBlockedFn({ data: input }));
}

export async function submitTeamRecoveryLink(input: TeamMemberInput) {
  return unwrap(await createTeamRecoveryLinkFn({ data: input }));
}
