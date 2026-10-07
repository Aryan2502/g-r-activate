import "@tanstack/react-start/server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  firstName,
  isInvitationToken,
  maskEmail,
  type AppRole,
  type InvitationKind,
} from "@/lib/admin/invitations";
import { authErrorMessage } from "@/lib/auth/auth-errors";
import { CodedError } from "@/lib/errors";
import { t } from "@/lib/i18n";
import { paths } from "@/lib/paths";
import { hashInvitationToken } from "@/server/invitation-tokens";

/**
 * Invitation lookup and redemption (SPEC §35.6), the only work in this
 * phase that needs the service role besides auth.admin.*. Every function
 * first checks the token's shape, hashes it and finds the invitation by that
 * hash (get_invitation / redeem_invitation are service-role-only), so the
 * service role never acts on anything the token does not prove. The admin
 * client is passed in, so tests can replace it.
 * Load with `await import("@/server/invitations")` inside a server handler.
 */

export type AdminClient = Pick<SupabaseClient<Database>, "rpc" | "from" | "auth">;

type InvitationRecord = Database["public"]["Functions"]["get_invitation"]["Returns"][number];

/** What the /invite page may know: no ids, no full e-mail, no hash. */
export type InvitationLookup =
  | { status: "invalid" }
  | { status: "expired" | "revoked" | "accepted"; kind: InvitationKind }
  | {
      status: "open";
      kind: InvitationKind;
      firstName: string | null;
      maskedEmail: string;
      customerCode: string | null;
      staffRole: AppRole | null;
      /**
       * A confirmed login already exists for the address (path c): the
       * invitee logs in with that password instead of choosing one.
       */
      existingAccount: boolean;
      expiresAt: string;
    };

type Found = { record: InvitationRecord; tokenHash: string };

async function findInvitation(admin: AdminClient, token: string): Promise<Found | null> {
  if (!isInvitationToken(token)) return null;
  const tokenHash = await hashInvitationToken(token);
  const { data, error } = await admin.rpc("get_invitation", { _token_hash: tokenHash });
  if (error) throw error;
  const record = data[0];
  return record ? { record, tokenHash } : null;
}

function stateOf(record: InvitationRecord): "open" | "expired" | "revoked" | "accepted" {
  if (record.accepted_at) return "accepted";
  if (record.revoked_at) return "revoked";
  return record.is_expired ? "expired" : "open";
}

async function authUserByEmail(admin: AdminClient, email: string) {
  const { data, error } = await admin.rpc("admin_auth_user_by_email", { _email: email });
  if (error) throw error;
  return data[0] ?? null;
}

export async function lookupInvitation(
  admin: AdminClient,
  token: string,
): Promise<InvitationLookup> {
  const found = await findInvitation(admin, token);
  if (!found) return { status: "invalid" };
  const { record } = found;
  const state = stateOf(record);
  if (state !== "open") return { status: state, kind: record.kind };
  const user = await authUserByEmail(admin, record.email);
  return {
    status: "open",
    kind: record.kind,
    firstName: firstName(record.full_name),
    maskedEmail: maskEmail(record.email),
    customerCode: record.kind === "customer" ? record.customer_code : null,
    staffRole: record.kind === "staff" ? record.staff_role : null,
    existingAccount: Boolean(user?.email_confirmed_at),
    expiresAt: record.expires_at,
  };
}

/** Where the invitee goes after signing in (SPEC §35.6). */
export function destinationOf(kind: InvitationKind): string {
  return kind === "staff" ? paths.admin : paths.portal;
}

export type RedeemOutcome =
  | {
      ok: true;
      kind: InvitationKind;
      /** The address of the login, so the browser can sign in with the new password. */
      email: string;
      destination: string;
      invitationId: string;
      customerId: string | null;
      userId: string;
    }
  /** Path c: a confirmed login exists; the invitee signs in first (redeemForUser). */
  | { ok: false; reason: "needs_login" }
  /** Invalid, expired, revoked or already accepted. */
  | { ok: false; reason: "state"; status: "invalid" | "expired" | "revoked" | "accepted" };

/**
 * The checks redeem_invitation makes on the customer record, made BEFORE a
 * login is created or changed, so a refusal leaves Auth untouched. A record
 * already linked to `userId` itself (a repeated path c) is fine.
 */
async function assertCustomerRedeemable(
  admin: AdminClient,
  record: InvitationRecord,
  userId: string | null,
) {
  if (record.kind !== "customer" || !record.customer_id) return;
  const { data, error } = await admin
    .from("customers")
    .select("status, user_id, email")
    .eq("id", record.customer_id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new CodedError(t("invite.errors.invalid"), "P0002");
  if (data.status === "disabled")
    throw new CodedError(t("invite.errors.customerDisabled"), "55000");
  if (data.user_id && data.user_id !== userId) {
    throw new CodedError(t("invite.errors.customerLinked"), "55000");
  }
  if (data.email !== record.email) throw new CodedError(t("invite.errors.emailChanged"), "55000");
}

/** Links the invitation in the database, idempotently (customers.user_id or user_roles). */
async function redeem(admin: AdminClient, tokenHash: string, userId: string) {
  const { data, error } = await admin.rpc("redeem_invitation", {
    _token_hash: tokenHash,
    _user_id: userId,
  });
  if (error) throw error;
  const row = data[0];
  if (!row) throw new Error("redeem_invitation returned no row");
  return row;
}

/**
 * The customer accepted the terms on the invitation page: the version in
 * force now, on the record the redemption just linked to this login.
 */
async function recordTermsAcceptance(admin: AdminClient, customerId: string, userId: string) {
  const { data: settings, error } = await admin
    .from("company_settings")
    .select("terms_version")
    .maybeSingle();
  if (error) throw error;
  const { error: updateError } = await admin
    .from("customers")
    .update({
      terms_version: settings?.terms_version ?? null,
      terms_accepted_at: new Date().toISOString(),
    })
    .eq("id", customerId)
    .eq("user_id", userId);
  if (updateError) throw updateError;
}

/**
 * The sign-up form's user_metadata keys (handle_new_user reads them), cleared
 * in path b: GoTrue merges user_metadata and deletes a key set to null.
 */
const STRANGER_METADATA = {
  full_name: null,
  phone: null,
  company_name: null,
  account_type: null,
  terms_version: null,
} as const;

/** Auth errors (weak password, …) in Dutch, with a SQLSTATE-like code for the browser. */
function authFailure(error: unknown): CodedError {
  return new CodedError(authErrorMessage(error), "22023");
}

/**
 * Paths a and b of SPEC §35.6: the invitee chose a password on the
 * invitation page.
 * (a) No login for the address → auth.admin.createUser, confirmed, with
 *     app_metadata.invitation_id (the sign-up trigger then creates nothing).
 * (b) An unconfirmed login → auth.admin.updateUserById with the password and
 *     the confirmation: holding the token proves control of the address.
 * (c) A confirmed login → nothing changes here; the invitee signs in with
 *     their own password and redeemForUser links it.
 * Then redeem_invitation links the record itself (never a trigger). If that
 * fails after (a), the new login is deleted again.
 */
export async function redeemWithPassword(
  admin: AdminClient,
  input: { token: string; password: string; acceptTerms: boolean },
): Promise<RedeemOutcome> {
  const found = await findInvitation(admin, input.token);
  if (!found) return { ok: false, reason: "state", status: "invalid" };
  const { record, tokenHash } = found;
  const state = stateOf(record);
  if (state !== "open") return { ok: false, reason: "state", status: state };
  if (record.kind === "customer" && !input.acceptTerms) {
    throw new CodedError(t("auth.validation.termsRequired"), "22023");
  }
  await assertCustomerRedeemable(admin, record, null);

  const existing = await authUserByEmail(admin, record.email);
  if (existing?.email_confirmed_at) return { ok: false, reason: "needs_login" };

  const appMetadata = { invitation_id: record.invitation_id };
  let userId: string;
  let created = false;
  if (!existing) {
    const { data, error } = await admin.auth.admin.createUser({
      email: record.email,
      password: input.password,
      email_confirm: true,
      app_metadata: appMetadata,
      ...(record.full_name ? { user_metadata: { full_name: record.full_name } } : {}),
    });
    if (error || !data.user) throw authFailure(error);
    userId = data.user.id;
    created = true;
  } else {
    // Whoever pre-registered the address chose this login's metadata; the
    // invitation decides the name (null removes a key), and redeem_invitation
    // takes the profile name from the invitation for a login confirmed this way.
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password: input.password,
      email_confirm: true,
      app_metadata: appMetadata,
      user_metadata: { ...STRANGER_METADATA, full_name: record.full_name ?? null },
    });
    if (error) throw authFailure(error);
    userId = existing.id;
  }

  let row;
  try {
    row = await redeem(admin, tokenHash, userId);
  } catch (error) {
    if (created) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
      if (deleteError)
        console.error("[redeemWithPassword] rollback of the new login failed", deleteError);
    }
    throw error;
  }
  if (row.kind === "customer" && row.customer_id) {
    await recordTermsAcceptance(admin, row.customer_id, userId);
  }
  return {
    ok: true,
    kind: row.kind,
    email: record.email,
    destination: destinationOf(row.kind),
    invitationId: row.invitation_id,
    customerId: row.customer_id ?? null,
    userId,
  };
}

/**
 * Path c: the invitee is signed in (their own, confirmed login). The
 * database links the invitation only when that login's address is the
 * invitation's (42501 otherwise). Repeating it for the same login is fine.
 */
export async function redeemForUser(
  admin: AdminClient,
  input: { token: string; userId: string; acceptTerms: boolean },
): Promise<RedeemOutcome> {
  const found = await findInvitation(admin, input.token);
  if (!found) return { ok: false, reason: "state", status: "invalid" };
  const { record, tokenHash } = found;
  const state = stateOf(record);
  if (state === "expired" || state === "revoked")
    return { ok: false, reason: "state", status: state };
  if (state === "open" && record.kind === "customer" && !input.acceptTerms) {
    throw new CodedError(t("auth.validation.termsRequired"), "22023");
  }
  if (state === "open") await assertCustomerRedeemable(admin, record, input.userId);

  let row;
  try {
    row = await redeem(admin, tokenHash, input.userId);
  } catch (error) {
    // Accepted by someone else: the same answer as for any used link.
    if (state === "accepted") return { ok: false, reason: "state", status: "accepted" };
    throw error;
  }
  if (state === "open" && row.kind === "customer" && row.customer_id) {
    await recordTermsAcceptance(admin, row.customer_id, input.userId);
  }
  return {
    ok: true,
    kind: row.kind,
    email: record.email,
    destination: destinationOf(row.kind),
    invitationId: row.invitation_id,
    customerId: row.customer_id ?? null,
    userId: input.userId,
  };
}
