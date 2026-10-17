import "@tanstack/react-start/server-only";

import type { InvitationKind } from "@/lib/admin/invitations";
import { invitationLink } from "@/lib/admin/invitations";
import { invitationEmailKey, welcomeEmailKey } from "@/lib/email/keys";
import type { EmailOutcome } from "@/lib/email/outcome";
import { fullAddressText } from "@/lib/portal/warehouse";
import { sendEmail, toEmailOutcome } from "@/server/email";
import { invitationEmail, welcomeEmail } from "@/server/email-templates/accounts";
import {
  appUrlOrNull,
  loadCompany,
  noAppUrlOutcome,
  type NotificationDb,
} from "@/server/notification-data";

/**
 * Invitation e-mails (SPEC §5, §35.6, §35.12). Load with
 * `await import("@/server/invitation-notifications")` inside a server handler.
 */

export interface InvitationSentEvent {
  /** The staff member's own client (invitations: staff read, RLS). */
  db: NotificationDb;
  invitationId: string;
  kind: InvitationKind;
  /** The address on the invitation (the customer's record or the staff member's). */
  email: string;
  customerId: string | null;
  /** For the greeting of a staff invitation (staff invitations store no name). */
  fullName?: string | null;
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
 * "Uitnodiging": the link on getAppUrl() — never the staff member's browser
 * origin, unlike the link shown on screen. Key
 * invite:<id>:<send_count>:<Suriname day of last_sent_at>, so every new token
 * ("Opnieuw versturen") is e-mailed once.
 */
export async function onInvitationSent(
  event: InvitationSentEvent,
): Promise<{ email: EmailOutcome }> {
  const appUrl = appUrlOrNull();
  if (!appUrl) return { email: noAppUrlOutcome("invitation") };
  const { db } = event;

  const { data: invitation, error } = await db
    .from("invitations")
    .select("id, kind, email, customer_id, staff_role, expires_at, last_sent_at, send_count")
    .eq("id", event.invitationId)
    .single();
  if (error) throw error;
  let fullName = event.fullName ?? null;
  let customerCode: string | null = null;
  if (invitation.customer_id) {
    const { data: customer } = await db
      .from("customers")
      .select("full_name, customer_code")
      .eq("id", invitation.customer_id)
      .maybeSingle();
    fullName = customer?.full_name ?? fullName;
    customerCode = customer?.customer_code ?? null;
  }

  const brand = await loadCompany(db, appUrl);
  const content = invitationEmail({
    brand,
    kind: invitation.kind,
    fullName,
    customerCode,
    staffRole: invitation.staff_role,
    email: invitation.email,
    link: invitationLink(appUrl, event.token),
    expiresAt: invitation.expires_at,
    resend: event.resend,
  });
  const result = await sendEmail({
    ...content,
    kind: "invitation",
    to: invitation.email,
    idempotencyKey: invitationEmailKey(
      invitation.id,
      invitation.send_count,
      invitation.last_sent_at ?? new Date(),
    ),
    customerId: invitation.customer_id,
    replyTo: brand.email,
  });
  return { email: toEmailOutcome(result) };
}

export interface InvitationRedeemedEvent {
  /**
   * The service-role client the redemption already runs with (SPEC §35.2:
   * invitation redemption, after the token check). The person has no
   * session in this request yet; it reads only the redeemed customer's own
   * record and the active US addresses.
   */
  admin: NotificationDb;
  invitationId: string;
  kind: InvitationKind;
  /** The login address (the invitation's). */
  email: string;
  customerId: string | null;
  /** The login that now holds the customer record or the staff role. */
  userId: string;
}

const SERVICE_TITLES: Record<string, string> = { air: "Luchtvracht", sea: "Zeevracht" };

/**
 * "Welkom", once per accepted invitation (invite:<id>:welcome): for a
 * customer with the GR code and the personal US shipping address(es), for
 * staff a short note with the link to /admin.
 */
export async function onInvitationRedeemed(
  event: InvitationRedeemedEvent,
): Promise<{ email: EmailOutcome }> {
  const appUrl = appUrlOrNull();
  if (!appUrl) return { email: noAppUrlOutcome("welcome") };
  const db = event.admin;

  let fullName: string | null = null;
  let customerCode: string | null = null;
  const addresses: { title: string; lines: string[] }[] = [];
  if (event.kind === "customer" && event.customerId) {
    const { data: customer, error } = await db
      .from("customers")
      .select("full_name, customer_code")
      .eq("id", event.customerId)
      .single();
    if (error) throw error;
    fullName = customer.full_name;
    customerCode = customer.customer_code;
    const { data: rows, error: addressError } = await db
      .from("warehouse_addresses")
      .select(
        "id, label, service_type, recipient_name_template, address_line1, address_line2_template, city, state, zip, country, phone",
      )
      .eq("is_active", true)
      .order("service_type")
      .order("label");
    if (addressError) throw addressError;
    for (const address of rows) {
      const service = SERVICE_TITLES[address.service_type] ?? address.service_type;
      addresses.push({
        title: address.label?.trim() ? `${address.label.trim()} (${service})` : service,
        lines: fullAddressText(address, {
          fullName: customer.full_name,
          customerCode: customer.customer_code,
        }).split("\n"),
      });
    }
  } else {
    const { data: profile } = await db
      .from("profiles")
      .select("display_name")
      .eq("id", event.userId)
      .maybeSingle();
    fullName = profile?.display_name ?? null;
  }

  const brand = await loadCompany(db, appUrl);
  const content = welcomeEmail({
    brand,
    kind: event.kind,
    fullName,
    customerCode,
    email: event.email,
    addresses,
  });
  const result = await sendEmail({
    ...content,
    kind: "welcome",
    to: event.email,
    idempotencyKey: welcomeEmailKey(event.invitationId),
    customerId: event.customerId,
    replyTo: brand.email,
  });
  return { email: toEmailOutcome(result) };
}
