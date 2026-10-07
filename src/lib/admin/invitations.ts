import type { Database } from "@/integrations/supabase/types";
import { t } from "@/lib/i18n";
import { phoneDigits } from "@/lib/phone";

/**
 * Invitation links (SPEC §35.6) as staff and the invitee see them. The token
 * is 32 random bytes in base64url (43 characters) and appears only in the
 * link; the database stores its SHA-256 (src/server/invitation-tokens.ts).
 * These helpers are pure, so the staff pages, the /invite page and the
 * server functions share them.
 */

export type InvitationRow = Database["public"]["Tables"]["invitations"]["Row"];
export type InvitationKind = Database["public"]["Enums"]["invitation_kind"];
export type AppRole = Database["public"]["Enums"]["app_role"];

/** 32 bytes as unpadded base64url. */
export const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** invitations.expires_at default (and every resend): 7 days. */
export const INVITATION_VALID_DAYS = 7;
/** invitations_guard: one resend per minute, five per Suriname day. */
export const RESEND_MIN_INTERVAL_MS = 60_000;
export const RESEND_DAILY_LIMIT = 5;

export function isInvitationToken(value: unknown): value is string {
  return typeof value === "string" && INVITATION_TOKEN_PATTERN.test(value);
}

export type InvitationState = "open" | "expired" | "accepted" | "revoked";

/** Accepted wins over revoked over expired, as redeem_invitation checks them. */
export function invitationState(
  invitation: Pick<InvitationRow, "accepted_at" | "revoked_at" | "expires_at">,
  now: Date = new Date(),
): InvitationState {
  if (invitation.accepted_at) return "accepted";
  if (invitation.revoked_at) return "revoked";
  return Date.parse(invitation.expires_at) <= now.getTime() ? "expired" : "open";
}

const surinameDay = (instant: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Paramaribo" }).format(instant);

export type ResendAvailability =
  | { ok: true }
  | { ok: false; reason: "wait"; seconds: number }
  | { ok: false; reason: "daily_limit" };

/**
 * Whether "Opnieuw versturen" will pass invitations_guard: not within a
 * minute of the last send, and not a sixth time on the same Suriname day.
 * The database decides; this only explains the disabled button.
 */
export function resendAvailability(
  invitation: Pick<InvitationRow, "last_sent_at" | "send_count">,
  now: Date = new Date(),
): ResendAvailability {
  if (!invitation.last_sent_at) return { ok: true };
  const last = new Date(invitation.last_sent_at);
  if (surinameDay(last) === surinameDay(now) && invitation.send_count >= RESEND_DAILY_LIMIT) {
    return { ok: false, reason: "daily_limit" };
  }
  const wait = last.getTime() + RESEND_MIN_INTERVAL_MS - now.getTime();
  if (wait > 0) return { ok: false, reason: "wait", seconds: Math.ceil(wait / 1000) };
  return { ok: true };
}

/**
 * How many times the link was made on this Suriname day (send_count counts
 * per day, as invitations_guard does); 0 when the last one was earlier.
 */
export function sendsToday(
  invitation: Pick<InvitationRow, "last_sent_at" | "send_count">,
  now: Date = new Date(),
): number {
  if (!invitation.last_sent_at) return 0;
  return surinameDay(new Date(invitation.last_sent_at)) === surinameDay(now)
    ? invitation.send_count
    : 0;
}

/**
 * 'maria.pinas@example.com' → 'ma•••@e•••.com': enough for the invitee to
 * recognise the address, nothing for someone who only has the link.
 */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  const keep = local.length <= 2 ? 1 : 2;
  const maskedLocal = `${local.slice(0, keep)}•••`;
  const dot = domain.lastIndexOf(".");
  if (dot <= 0) return `${maskedLocal}@${domain.slice(0, 1)}•••`;
  return `${maskedLocal}@${domain.slice(0, 1)}•••${domain.slice(dot)}`;
}

/** The first word of a full name, for "Welkom, Maria". */
export function firstName(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/** `${base}/invite/<token>` (SPEC §35.6); base is an origin without a trailing slash. */
export function invitationLink(base: string, token: string): string {
  return `${base.replace(/\/+$/, "")}/invite/${token}`;
}

/** A password-reset link from auth.admin.generateLink's hashed_token, via /auth/confirm. */
export function recoveryLink(base: string, hashedToken: string): string {
  const query = new URLSearchParams({ token_hash: hashedToken, type: "recovery" });
  return `${base.replace(/\/+$/, "")}/auth/confirm?${query}`;
}

/**
 * "Deel via WhatsApp" (SPEC §35.12): wa.me with the international digits
 * (597 for local numbers). Without a usable number WhatsApp lets staff pick
 * the chat themselves.
 */
export function whatsappHref(phone: string | null | undefined, text: string): string {
  const digits = phoneDigits(phone);
  return `https://wa.me/${digits ?? ""}?text=${encodeURIComponent(text)}`;
}

/** The Dutch message that goes with an invitation link. */
export function invitationShareText(input: {
  kind: InvitationKind;
  fullName: string | null;
  customerCode: string | null;
  /** The login address: the /invite page shows it masked, so the message names it. */
  email: string | null;
  link: string;
}): string {
  const name = firstName(input.fullName);
  const greeting = name
    ? t("admin.invitations.share.greeting", { name })
    : t("admin.invitations.share.greetingNoName");
  const body =
    input.kind === "staff"
      ? t("admin.invitations.share.staff")
      : input.customerCode
        ? t("admin.invitations.share.customer", { code: input.customerCode })
        : t("admin.invitations.share.customerNoCode");
  const login = input.email ? ` ${t("admin.invitations.share.login", { email: input.email })}` : "";
  return `${greeting} ${body}${login} ${t("admin.invitations.share.link", {
    days: INVITATION_VALID_DAYS,
    link: input.link,
  })}`;
}

/** The Dutch message that goes with a password-reset link. */
export function recoveryShareText(input: { fullName: string | null; link: string }): string {
  const name = firstName(input.fullName);
  const greeting = name
    ? t("admin.invitations.share.greeting", { name })
    : t("admin.invitations.share.greetingNoName");
  return `${greeting} ${t("admin.recovery.share", { link: input.link })}`;
}
