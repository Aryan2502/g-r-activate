import "@tanstack/react-start/server-only";

import type { InvitationKind } from "@/lib/admin/invitations";

/**
 * Hook points for invitation e-mails. Load with
 * `await import("@/server/invitation-notifications")` inside a server handler.
 */

export interface InvitationSentEvent {
  invitationId: string;
  kind: InvitationKind;
  /** The address on the invitation (the customer's record or the staff member's). */
  email: string;
  customerId: string | null;
  /**
   * The raw token, for the e-mail's link: `${getAppUrl()}/invite/${token}`.
   * Never log or store it (only its hash is in the database).
   */
  token: string;
  /** "Opnieuw versturen" (a rotated token) rather than a new invitation. */
  resend: boolean;
  /** The staff login that invited. */
  userId: string;
}

/**
 * P8 HOOK: "uitnodiging" e-mail (SPEC §35.12).
 *
 * inviteCustomerFn and resendInvitationFn call this once, after the
 * invitation row is written; a failure here never fails the invitation (the
 * caller logs and moves on). P8 sends the link with Resend, with an
 * idempotency key such as `invitation:<invitationId>:<sendCount>`, and logs
 * `skipped_no_provider` without Resend. The link always goes to
 * getAppUrl(), never to the request's origin.
 *
 * Until P8 nothing is sent: it reports `emailed: false`, and staff copy the
 * link or share it via WhatsApp (the dialogs say so).
 */
export async function onInvitationSent(event: InvitationSentEvent): Promise<{ emailed: boolean }> {
  void event;
  return { emailed: false };
}

export interface InvitationRedeemedEvent {
  invitationId: string;
  kind: InvitationKind;
  customerId: string | null;
  /** The login that now holds the customer record or the staff role. */
  userId: string;
}

/**
 * P8 HOOK: "welkom" e-mail after redemption (SPEC §35.12), with the
 * personal US address for customers. Called once by the redemption server
 * functions after the database linked the invitation; never fails it.
 *
 * Until P8 nothing is sent.
 */
export async function onInvitationRedeemed(event: InvitationRedeemedEvent): Promise<void> {
  void event;
}
