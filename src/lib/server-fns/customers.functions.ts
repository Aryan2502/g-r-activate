import { createServerFn } from "@tanstack/react-start";

import {
  customerIdInputSchema,
  disableLoginPlan,
  invitationIdInputSchema,
  inviteCustomer,
  inviteCustomerInputSchema,
  noteRecoveryLink,
  recoveryTarget,
  resendInvitation,
  setCustomerDisabledInDb,
  setCustomerDisabledInputSchema,
  type CustomerIdInput,
  type CustomerSummary,
  type InvitationIdInput,
  type InvitationSummary,
  type InviteConflict,
  type InviteCustomerInput,
  type SetCustomerDisabledInput,
} from "@/lib/admin/customer-actions";
import { invitationLink } from "@/lib/admin/invitations";
import { parseActionInput } from "@/lib/admin/order-actions";
import type { EmailOutcome } from "@/lib/email/outcome";
import { toTransportError, type TransportError } from "@/lib/errors";
import { logFailure, unwrap, type Failure, type LinkSource } from "@/lib/server-fns/helpers";
import { denied, requireAdmin, requireStaff } from "@/lib/server-fns/middleware";

/**
 * Customer management server functions (SPEC §5, §13, §35.5, §35.6). Each
 * runs requireStaff/requireAdmin and returns failures as data. Database
 * writes use the staff member's OWN client (context.access.supabase): the
 * invitation row, the customer record, the status. The service role is used
 * only for auth.admin.* (ban/unban, the reset link), loaded inside the
 * handler (src/server/admin-client.ts).
 *
 * Invitation links: the raw token appears only in the link returned here,
 * once; the database stores its hash. The link's base is APP_URL, or, for
 * this on-screen link only, the origin of the staff member's browser
 * (src/server/links.ts). The e-mail (src/server/invitation-notifications.ts)
 * always links to APP_URL and reports what happened (EmailOutcome), so the
 * dialogs say whether the link was e-mailed too.
 */

// ---------------------------------------------------------------------------
// "Klant uitnodigen" / "Uitnodigen"
// ---------------------------------------------------------------------------

export type InviteResponse =
  | {
      ok: true;
      status: "invited";
      invitationId: string;
      expiresAt: string;
      customer: CustomerSummary;
      link: string;
      linkSource: LinkSource;
      /** The "uitnodiging" e-mail; the link is shown on screen either way. */
      emailOutcome: EmailOutcome;
      customerCreated: boolean;
    }
  | { ok: true; status: "conflict"; conflict: InviteConflict }
  | { ok: true; status: "customer_only"; customer: CustomerSummary; error: TransportError }
  | Failure;

export const inviteCustomerFn = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  // Typing only: the handler parses with zod, so a bad request gets a Dutch answer.
  .validator((input: InviteCustomerInput): unknown => input)
  .handler(async ({ context, data }): Promise<InviteResponse> => {
    const access = context.access;
    if (!access.ok) return denied(access);

    let result;
    let base;
    try {
      const input = parseActionInput(inviteCustomerInputSchema, data);
      base = (await import("@/server/fn-helpers")).screenBase();
      const { createInvitationToken } = await import("@/server/invitation-tokens");
      result = await inviteCustomer(access.supabase, input, createInvitationToken);
    } catch (error) {
      logFailure("inviteCustomerFn", error);
      return { ok: false, error: toTransportError(error) };
    }
    if (result.status === "conflict") return { ok: true, ...result };
    if (result.status === "customer_only") {
      logFailure("inviteCustomerFn/invitation", result.error);
      return {
        ok: true,
        status: "customer_only",
        customer: result.customer,
        error: toTransportError(result.error),
      };
    }

    // The "uitnodiging" e-mail. Never fails the invitation.
    let emailOutcome: EmailOutcome;
    try {
      const { onInvitationSent } = await import("@/server/invitation-notifications");
      ({ email: emailOutcome } = await onInvitationSent({
        db: access.supabase,
        invitationId: result.invitationId,
        kind: "customer",
        email: result.customer.email ?? "",
        customerId: result.customer.id,
        token: result.token,
        resend: false,
        userId: access.userId,
      }));
    } catch (error) {
      console.error("[inviteCustomerFn] onInvitationSent failed", error);
      emailOutcome = "failed";
    }
    return {
      ok: true,
      status: "invited",
      invitationId: result.invitationId,
      expiresAt: result.expiresAt,
      customer: result.customer,
      link: invitationLink(base.base, result.token),
      linkSource: base.source,
      emailOutcome,
      customerCreated: result.customerCreated,
    };
  });

// ---------------------------------------------------------------------------
// "Opnieuw versturen" (customer and staff invitations; RLS decides who may)
// ---------------------------------------------------------------------------

export type ResendResponse =
  | {
      ok: true;
      invitation: InvitationSummary;
      customer: CustomerSummary | null;
      link: string;
      linkSource: LinkSource;
      /** The "uitnodiging" e-mail; the link is shown on screen either way. */
      emailOutcome: EmailOutcome;
    }
  | Failure;

export const resendInvitationFn = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((input: InvitationIdInput): unknown => input)
  .handler(async ({ context, data }): Promise<ResendResponse> => {
    const access = context.access;
    if (!access.ok) return denied(access);

    let result;
    let base;
    try {
      const input = parseActionInput(invitationIdInputSchema, data);
      base = (await import("@/server/fn-helpers")).screenBase();
      const { createInvitationToken } = await import("@/server/invitation-tokens");
      result = await resendInvitation(access.supabase, input.invitationId, createInvitationToken);
    } catch (error) {
      logFailure("resendInvitationFn", error);
      return { ok: false, error: toTransportError(error) };
    }

    let emailOutcome: EmailOutcome;
    try {
      const { onInvitationSent } = await import("@/server/invitation-notifications");
      ({ email: emailOutcome } = await onInvitationSent({
        db: access.supabase,
        invitationId: result.invitation.id,
        kind: result.invitation.kind,
        email: result.invitation.email,
        customerId: result.invitation.customer_id,
        token: result.token,
        resend: true,
        userId: access.userId,
      }));
    } catch (error) {
      console.error("[resendInvitationFn] onInvitationSent failed", error);
      emailOutcome = "failed";
    }
    return {
      ok: true,
      invitation: result.invitation,
      customer: result.customer,
      link: invitationLink(base.base, result.token),
      linkSource: base.source,
      emailOutcome,
    };
  });

// ---------------------------------------------------------------------------
// "Deactiveren" / "Activeren" (admin, SPEC §35.5)
// ---------------------------------------------------------------------------

export type DisableResponse =
  | {
      ok: true;
      disabled: boolean;
      revokedInvitations: number;
      /**
       * none: no login; updated: (un)banned; failed: the status changed, the
       * login did not; team: the login belongs to the team and is left alone
       * (it is (de)activated on /admin/team, with that page's safeguards).
       */
      login: "none" | "updated" | "failed" | "team";
      loginError: TransportError | null;
    }
  | Failure;

type DisableLogin = Extract<DisableResponse, { ok: true }>["login"];

export const setCustomerDisabledFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: SetCustomerDisabledInput): unknown => input)
  .handler(async ({ context, data }): Promise<DisableResponse> => {
    const access = context.access;
    if (!access.ok) return denied(access);

    let input;
    let result;
    try {
      input = parseActionInput(setCustomerDisabledInputSchema, data);
      result = await setCustomerDisabledInDb(access.supabase, input);
    } catch (error) {
      logFailure("setCustomerDisabledFn", error);
      return { ok: false, error: toTransportError(error) };
    }

    // The status alone already locks a disabled customer out of every row
    // (current_customer_id() is null); the ban also stops the sign-in. Never
    // for a team login (also the caller's own): banning it here would skip
    // every safeguard of the team page, and has_role() ignores a banned
    // login, so it could leave no admin who can sign in.
    let login: DisableLogin = "none";
    let loginError: TransportError | null = null;
    const plan = disableLoginPlan(result, access.userId);
    if (plan.action === "team") {
      login = "team";
    } else if (plan.action === "ban") {
      try {
        const { loadAdminClient } = await import("@/server/admin-client");
        const { setLoginBanned } = await import("@/server/auth-admin");
        await setLoginBanned(await loadAdminClient(), plan.userId, input.disabled);
        login = "updated";
      } catch (error) {
        console.error("[setCustomerDisabledFn] (un)ban failed", error);
        login = "failed";
        loginError = (await import("@/server/fn-helpers")).serviceFailure(error);
      }
    }
    return {
      ok: true,
      disabled: input.disabled,
      revokedInvitations: result.revokedInvitations,
      login,
      loginError,
    };
  });

// ---------------------------------------------------------------------------
// "Wachtwoord-resetlink maken" (SPEC §35.6)
// ---------------------------------------------------------------------------

export type RecoveryLinkResponse =
  | { ok: true; link: string; linkSource: LinkSource; fullName: string; phone: string | null }
  | Failure;

export const createRecoveryLinkFn = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((input: CustomerIdInput): unknown => input)
  .handler(async ({ context, data }): Promise<RecoveryLinkResponse> => {
    const access = context.access;
    if (!access.ok) return denied(access);

    let input;
    let target;
    try {
      input = parseActionInput(customerIdInputSchema, data);
      const admin = await access.supabase.rpc("is_admin");
      if (admin.error) throw admin.error;
      target = await recoveryTarget(access.supabase, input.customerId, admin.data === true);
    } catch (error) {
      logFailure("createRecoveryLinkFn", error);
      return { ok: false, error: toTransportError(error) };
    }

    let link;
    let base;
    try {
      base = (await import("@/server/fn-helpers")).screenBase();
      const { loadAdminClient } = await import("@/server/admin-client");
      const { createRecoveryLink } = await import("@/server/auth-admin");
      link = await createRecoveryLink(await loadAdminClient(), target.userId, base.base);
    } catch (error) {
      console.error("[createRecoveryLinkFn] generateLink failed", error);
      return { ok: false, error: (await import("@/server/fn-helpers")).serviceFailure(error) };
    }

    try {
      await noteRecoveryLink(access.supabase, input.customerId);
    } catch (error) {
      console.error("[createRecoveryLinkFn] note failed", error);
    }
    return {
      ok: true,
      link,
      linkSource: base.source,
      fullName: target.fullName,
      phone: target.phone,
    };
  });

// ---------------------------------------------------------------------------
// Browser side: a returned failure is thrown as a CodedError
// ---------------------------------------------------------------------------

export async function submitInviteCustomer(input: InviteCustomerInput) {
  return unwrap(await inviteCustomerFn({ data: input }));
}

export async function submitResendInvitation(input: InvitationIdInput) {
  return unwrap(await resendInvitationFn({ data: input }));
}

export async function submitSetCustomerDisabled(input: SetCustomerDisabledInput) {
  return unwrap(await setCustomerDisabledFn({ data: input }));
}

export async function submitRecoveryLink(input: CustomerIdInput) {
  return unwrap(await createRecoveryLinkFn({ data: input }));
}
