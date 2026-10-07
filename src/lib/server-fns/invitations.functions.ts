import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { INVITATION_TOKEN_PATTERN, type InvitationKind } from "@/lib/admin/invitations";
import { newPasswordField } from "@/lib/auth/schemas";
import {
  CodedError,
  fromTransportError,
  toTransportError,
  type TransportError,
} from "@/lib/errors";
import { t } from "@/lib/i18n";

/**
 * The /invite/$token page's server functions (SPEC §35.6). The first two are
 * public: whoever holds the link is the invitee. They use the service role
 * only after checking and hashing the token (src/server/invitations.ts), and
 * answer with as little as the page needs: a first name, a masked e-mail, the
 * GR code and the state. The third runs for a signed-in login (path c).
 * Failures are returned as data (TransportError), like the other server
 * functions.
 */

type Failure = { ok: false; error: TransportError };

/** The page as it can be shown: an InvitationLookup, or "not configured yet". */
export type InvitationPageState =
  | { status: "invalid" | "unavailable" }
  | { status: "expired" | "revoked" | "accepted"; kind: InvitationKind }
  | {
      status: "open";
      kind: InvitationKind;
      firstName: string | null;
      maskedEmail: string;
      customerCode: string | null;
      staffRole: "admin" | "staff" | null;
      existingAccount: boolean;
      expiresAt: string;
    };

const tokenSchema = z.string().regex(INVITATION_TOKEN_PATTERN);

/** Without the service-role key nothing about invitations can be read: say so plainly. */
async function isNotConfigured(error: unknown): Promise<boolean> {
  const { MissingEnvError } = await import("@/server/env");
  return error instanceof MissingEnvError;
}

const unavailable = (): TransportError => ({
  message: t("invite.unavailableText"),
  code: null,
  hint: null,
});

export const getInvitationFn = createServerFn({ method: "POST" })
  .validator((input: { token: string }): unknown => input)
  .handler(async ({ data }): Promise<{ ok: true; state: InvitationPageState } | Failure> => {
    const token = tokenSchema.safeParse((data as { token?: unknown } | null)?.token);
    if (!token.success) return { ok: true, state: { status: "invalid" } };
    try {
      const [{ loadAdminClient }, { lookupInvitation }] = await Promise.all([
        import("@/server/admin-client"),
        import("@/server/invitations"),
      ]);
      const state = await lookupInvitation(await loadAdminClient(), token.data);
      return { ok: true, state };
    } catch (error) {
      if (await isNotConfigured(error)) return { ok: true, state: { status: "unavailable" } };
      console.error("[getInvitationFn] lookup failed", error);
      return { ok: false, error: toTransportError(error) };
    }
  });

const redeemInputSchema = z.object({
  token: tokenSchema,
  password: newPasswordField,
  acceptTerms: z.boolean(),
});
export type RedeemInput = z.input<typeof redeemInputSchema>;

export type RedeemResponse =
  | { ok: true; kind: InvitationKind; email: string; destination: string }
  | { ok: true; needsLogin: true }
  | {
      ok: true;
      state: "invalid" | "expired" | "revoked" | "accepted";
    }
  | Failure;

/**
 * The "welkom" e-mail (with the personal US address for customers). Never
 * fails the redemption. It runs with the service-role client the redemption
 * already uses (the invitee has no session in this request yet), reading only
 * the redeemed customer's record and the active US addresses.
 */
async function afterRedeem(
  admin: Parameters<typeof import("@/server/invitations").redeemForUser>[0],
  outcome: {
    invitationId: string;
    kind: InvitationKind;
    email: string;
    customerId: string | null;
    userId: string;
  },
) {
  try {
    const { onInvitationRedeemed } = await import("@/server/invitation-notifications");
    await onInvitationRedeemed({
      admin,
      invitationId: outcome.invitationId,
      kind: outcome.kind,
      email: outcome.email,
      customerId: outcome.customerId,
      userId: outcome.userId,
    });
  } catch (error) {
    console.error("[redeemInvitation] onInvitationRedeemed failed", error);
  }
}

/** Paths a and b: the invitee chose a password on the page. */
export const redeemInvitationFn = createServerFn({ method: "POST" })
  .validator((input: RedeemInput): unknown => input)
  .handler(async ({ data }): Promise<RedeemResponse> => {
    const parsed = redeemInputSchema.safeParse(data);
    if (!parsed.success) {
      return {
        ok: false,
        error: toTransportError(new CodedError(t("invite.errors.checkFields"), "22023")),
      };
    }
    try {
      const [{ loadAdminClient }, { redeemWithPassword }] = await Promise.all([
        import("@/server/admin-client"),
        import("@/server/invitations"),
      ]);
      const admin = await loadAdminClient();
      const outcome = await redeemWithPassword(admin, parsed.data);
      if (!outcome.ok) {
        return outcome.reason === "needs_login"
          ? { ok: true, needsLogin: true }
          : { ok: true, state: outcome.status };
      }
      await afterRedeem(admin, outcome);
      return {
        ok: true,
        kind: outcome.kind,
        email: outcome.email,
        destination: outcome.destination,
      };
    } catch (error) {
      if (await isNotConfigured(error)) return { ok: false, error: unavailable() };
      console.warn("[redeemInvitationFn] failed", error);
      return { ok: false, error: toTransportError(error) };
    }
  });

const redeemAsUserInputSchema = z.object({ token: tokenSchema, acceptTerms: z.boolean() });
export type RedeemAsUserInput = z.input<typeof redeemAsUserInputSchema>;

/**
 * Path c: the invitee signed in with their existing login first. The user id
 * comes from the verified access token (requireSupabaseAuth), never from the
 * browser; the database links only when that login's e-mail is the
 * invitation's.
 */
export const redeemInvitationAsUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: RedeemAsUserInput): unknown => input)
  .handler(async ({ context, data }): Promise<RedeemResponse> => {
    const parsed = redeemAsUserInputSchema.safeParse(data);
    if (!parsed.success) {
      return {
        ok: false,
        error: toTransportError(new CodedError(t("invite.errors.checkFields"), "22023")),
      };
    }
    try {
      const [{ loadAdminClient }, { redeemForUser }] = await Promise.all([
        import("@/server/admin-client"),
        import("@/server/invitations"),
      ]);
      const admin = await loadAdminClient();
      const outcome = await redeemForUser(admin, {
        ...parsed.data,
        userId: context.userId,
      });
      if (!outcome.ok) {
        return outcome.reason === "needs_login"
          ? { ok: true, needsLogin: true }
          : { ok: true, state: outcome.status };
      }
      await afterRedeem(admin, outcome);
      return {
        ok: true,
        kind: outcome.kind,
        email: outcome.email,
        destination: outcome.destination,
      };
    } catch (error) {
      if (await isNotConfigured(error)) return { ok: false, error: unavailable() };
      console.warn("[redeemInvitationAsUserFn] failed", error);
      return { ok: false, error: toTransportError(error) };
    }
  });

// ---------------------------------------------------------------------------
// Browser side
// ---------------------------------------------------------------------------

export async function fetchInvitation(token: string): Promise<InvitationPageState> {
  const result = await getInvitationFn({ data: { token } });
  if (!result.ok) throw fromTransportError(result.error);
  return result.state;
}

export async function submitRedeem(input: RedeemInput) {
  const result = await redeemInvitationFn({ data: input });
  if (!result.ok) throw fromTransportError(result.error);
  return result;
}

export async function submitRedeemAsUser(input: RedeemAsUserInput) {
  const result = await redeemInvitationAsUserFn({ data: input });
  if (!result.ok) throw fromTransportError(result.error);
  return result;
}
