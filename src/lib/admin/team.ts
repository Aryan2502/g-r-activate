import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { Constants, type Database } from "@/integrations/supabase/types";
import {
  CUSTOMER_SUMMARY_COLUMNS,
  INVITATION_COLUMNS,
  optionalPhone,
  optionalText,
  reasonText,
  requiredEmail,
  type CustomerSummary,
  type InvitationSummary,
  type TokenFactory,
} from "@/lib/admin/customer-actions";
import { CodedError } from "@/lib/errors";
import { t } from "@/lib/i18n";

/**
 * The team (SPEC §35.4, /admin/team): staff and admins, their role, staff
 * invitations and deactivating a login. Apart from the server functions
 * (lib/server-fns/team.functions.ts) so it runs in PGlite contract tests
 * with a stand-in client. Everything here uses the caller's OWN client:
 * team_members() and log_team_login_change() (migration
 * 20261007150000_p5_customers.sql), set_user_role (last-admin protection),
 * RLS on invitations (staff invitations: admins only) and invitations_guard
 * (one open invitation per address, resend limits). Only the ban itself
 * (auth.admin) needs the service role, in the server function.
 */

type Client = Pick<SupabaseClient<Database>, "rpc" | "from">;
export type AppRole = Database["public"]["Enums"]["app_role"];
/** admin, staff (enum order). */
export const APP_ROLES = Constants.public.Enums.app_role;

export interface TeamMember {
  userId: string;
  displayName: string | null;
  /** null when the list came from the fallback (migration not applied yet). */
  email: string | null;
  roles: AppRole[];
  /** The login is banned (Deactiveren); null when unknown (fallback). */
  blocked: boolean | null;
  lastSignInAt: string | null;
  memberSince: string | null;
}

export interface TeamList {
  members: TeamMember[];
  /**
   * false: team_members() does not exist yet (migration not applied), so
   * the list comes from user_roles + profiles: no e-mail addresses, no
   * deactivation state, and staff see only themselves.
   */
  complete: boolean;
}

/** An admin is also staff (is_staff); the highest role is the one shown. */
export function effectiveRole(roles: readonly AppRole[]): AppRole {
  return roles.includes("admin") ? "admin" : "staff";
}

// ---------------------------------------------------------------------------
// RPCs that arrive with migration 20261007150000_p5_customers.sql
// ---------------------------------------------------------------------------

/**
 * Not yet in the generated types: team_members() and
 * log_team_login_change() arrive with migration
 * 20261007150000_p5_customers.sql, and types.ts is regenerated from the live
 * database after it is applied. This narrow signature stands in until then;
 * the answers are checked with zod, so nothing untyped leaks out.
 */
type PendingRpc = (
  fn: "team_members" | "log_team_login_change",
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;

/** PostgREST's "function not found" (the migration is not applied yet), or Postgres' own. */
const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);

export function isMissingFunction(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && MISSING_FUNCTION.has(code);
}

function pendingRpc(client: Client): PendingRpc {
  const rpc = client.rpc as unknown as PendingRpc;
  return (fn, args) => rpc.call(client, fn, args);
}

const teamRowSchema = z.object({
  user_id: z.string(),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
  roles: z.array(z.enum(APP_ROLES)),
  blocked: z.boolean().nullable(),
  last_sign_in_at: z.string().nullable(),
  member_since: z.string().nullable(),
});

/**
 * The team, sorted by name (team_members(): staff and admins may call it).
 * Without the migration: user_roles (admins read all rows, staff only their
 * own) with names from profiles.
 */
export async function loadTeam(db: Client): Promise<TeamList> {
  const { data, error } = await pendingRpc(db)("team_members");
  if (!error) {
    const rows = z.array(teamRowSchema).parse(data ?? []);
    return {
      complete: true,
      members: rows.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name?.trim() || null,
        email: r.email,
        roles: r.roles,
        blocked: r.blocked,
        lastSignInAt: r.last_sign_in_at,
        memberSince: r.member_since,
      })),
    };
  }
  if (!isMissingFunction(error)) throw error;

  const roles = await db.from("user_roles").select("user_id, role, created_at").order("created_at");
  if (roles.error) throw roles.error;
  const byUser = new Map<string, { roles: AppRole[]; since: string }>();
  for (const r of roles.data) {
    const entry = byUser.get(r.user_id) ?? { roles: [], since: r.created_at };
    entry.roles.push(r.role);
    byUser.set(r.user_id, entry);
  }
  const ids = [...byUser.keys()];
  const names = new Map<string, string | null>();
  if (ids.length > 0) {
    const profiles = await db.from("profiles").select("id, display_name").in("id", ids);
    if (profiles.error) throw profiles.error;
    for (const p of profiles.data) names.set(p.id, p.display_name?.trim() || null);
  }
  const members = ids.map((userId): TeamMember => ({
    userId,
    displayName: names.get(userId) ?? null,
    email: null,
    roles: [...(byUser.get(userId)?.roles ?? [])].sort(
      (a, b) => APP_ROLES.indexOf(a) - APP_ROLES.indexOf(b),
    ),
    blocked: null,
    lastSignInAt: null,
    memberSince: byUser.get(userId)?.since ?? null,
  }));
  return { complete: false, members: sortTeam(members) };
}

/** By name (or e-mail), case-insensitive, as team_members() orders them. */
export function sortTeam(members: readonly TeamMember[]): TeamMember[] {
  const key = (m: TeamMember) => (m.displayName ?? m.email ?? m.userId).toLocaleLowerCase("nl");
  return [...members].sort((a, b) => key(a).localeCompare(key(b), "nl"));
}

/** What a team member is called on the page. */
export function memberName(member: Pick<TeamMember, "displayName" | "email">): string {
  return member.displayName ?? member.email ?? t("admin.team.unnamed");
}

// ---------------------------------------------------------------------------
// Roles (set_user_role: admins only, refuses to remove the last admin)
// ---------------------------------------------------------------------------

async function setRole(db: Client, userId: string, role: AppRole, grant: boolean) {
  const { error } = await db.rpc("set_user_role", { _user_id: userId, _role: role, _grant: grant });
  if (error) throw error;
}

/**
 * "Rol wijzigen": Beheerder adds the admin role (a staff row may stay: the
 * highest role counts); Medewerker makes sure the staff role exists, then
 * removes admin. If the database refuses that (the last admin), the staff
 * role this call added is taken back, so nothing changed. Order matters:
 * removing admin first would leave a moment without any role, and
 * user_roles_revoke_invitations would revoke the member's open invitations.
 */
export async function changeTeamRole(
  db: Client,
  member: Pick<TeamMember, "userId" | "roles">,
  role: AppRole,
): Promise<{ changed: boolean }> {
  if (effectiveRole(member.roles) === role) return { changed: false };
  if (role === "admin") {
    await setRole(db, member.userId, "admin", true);
    return { changed: true };
  }
  const addedStaff = !member.roles.includes("staff");
  if (addedStaff) await setRole(db, member.userId, "staff", true);
  try {
    await setRole(db, member.userId, "admin", false);
  } catch (error) {
    if (addedStaff) {
      // Still an admin, so taking the staff row back revokes nothing.
      await setRole(db, member.userId, "staff", false).catch((undo: unknown) => {
        console.error("[changeTeamRole] could not take the staff role back", undo);
      });
    }
    throw error;
  }
  return { changed: true };
}

// ---------------------------------------------------------------------------
// Deactivating a login (the ban is the server function's job)
// ---------------------------------------------------------------------------

export const teamLoginInputSchema = z.object({
  userId: z.string().uuid(),
  blocked: z.boolean(),
  reason: reasonText,
});
export type TeamLoginInput = z.input<typeof teamLoginInputSchema>;
export type TeamLoginData = z.output<typeof teamLoginInputSchema>;

/**
 * Checked before the login is (un)banned: only a team member (customers have
 * their own "Deactiveren" with the customer status), never yourself, and
 * not twice. Throws a CodedError with the Dutch reason.
 */
export function assertTeamLoginChange(
  team: TeamList,
  callerId: string,
  input: Pick<TeamLoginData, "userId" | "blocked">,
): TeamMember {
  const member = team.members.find((m) => m.userId === input.userId);
  if (!member) throw new CodedError(t("admin.team.block.notMember"), "P0002");
  if (input.blocked && input.userId === callerId) {
    throw new CodedError(t("admin.team.block.self"), "55000");
  }
  if (member.blocked === input.blocked) {
    throw new CodedError(
      input.blocked ? t("admin.team.block.alreadyBlocked") : t("admin.team.block.notBlocked"),
      "55000",
    );
  }
  return member;
}

/**
 * After the ban: log_team_login_change() writes the audit entry (who, when,
 * why) and, when blocking, revokes the member's open invitations. null when
 * the migration is not applied yet (nothing logged).
 */
export async function logTeamLoginChange(
  db: Client,
  input: TeamLoginData,
): Promise<{ revokedInvitations: number } | null> {
  const { data, error } = await pendingRpc(db)("log_team_login_change", {
    _user_id: input.userId,
    _blocked: input.blocked,
    _reason: input.reason,
  });
  if (error) {
    if (isMissingFunction(error)) return null;
    throw error;
  }
  return { revokedInvitations: z.number().int().catch(0).parse(data) };
}

/** An invitation that "Deactiveren" will revoke, as the dialog lists it. */
export interface PendingInvitation {
  id: string;
  kind: InvitationSummary["kind"];
  email: string;
  expired: boolean;
  customer: Pick<CustomerSummary, "id" | "full_name" | "customer_code"> | null;
}

/**
 * The invitations a member created that were never accepted or revoked:
 * log_team_login_change revokes them all when the login is deactivated
 * (the member saw those links), so the dialog names the customers who will
 * need a new link. Customer invitations first, by name.
 */
export async function pendingInvitationsBy(
  db: Client,
  userId: string,
  now: Date = new Date(),
): Promise<PendingInvitation[]> {
  const { data, error } = await db
    .from("invitations")
    .select("id, kind, email, expires_at, customer_id")
    .eq("created_by", userId)
    .is("accepted_at", null)
    .is("revoked_at", null);
  if (error) throw error;
  const ids = [...new Set(data.flatMap((i) => (i.customer_id ? [i.customer_id] : [])))];
  const customers = new Map<string, Pick<CustomerSummary, "id" | "full_name" | "customer_code">>();
  if (ids.length > 0) {
    const found = await db.from("customers").select("id, full_name, customer_code").in("id", ids);
    if (found.error) throw found.error;
    for (const c of found.data) customers.set(c.id, c);
  }
  const list = data.map((i): PendingInvitation => ({
    id: i.id,
    kind: i.kind,
    email: i.email,
    expired: Date.parse(i.expires_at) <= now.getTime(),
    customer: i.customer_id ? (customers.get(i.customer_id) ?? null) : null,
  }));
  const key = (i: PendingInvitation) =>
    `${i.kind === "customer" ? 0 : 1}${(i.customer?.full_name ?? i.email).toLocaleLowerCase("nl")}`;
  return list.sort((a, b) => key(a).localeCompare(key(b), "nl"));
}

export const teamMemberInputSchema = z.object({ userId: z.string().uuid() });
export type TeamMemberInput = z.input<typeof teamMemberInputSchema>;

/** A reset link only for a member whose login works (and is part of the team). */
export function assertRecoveryForMember(team: TeamList, userId: string): TeamMember {
  const member = team.members.find((m) => m.userId === userId);
  if (!member) throw new CodedError(t("admin.team.block.notMember"), "P0002");
  if (member.blocked) throw new CodedError(t("admin.team.recovery.blocked"), "55000");
  return member;
}

// ---------------------------------------------------------------------------
// Staff invitations (SPEC §35.6: same token rules as customers)
// ---------------------------------------------------------------------------

/** "Medewerker uitnodigen": e-mail and role; name and phone only for the WhatsApp message. */
export const inviteStaffSchema = z.object({
  email: requiredEmail,
  role: z.enum(APP_ROLES),
  fullName: optionalText(200),
  phone: optionalPhone,
});
export type InviteStaffValues = z.input<typeof inviteStaffSchema>;
export type InviteStaffData = z.output<typeof inviteStaffSchema>;

export type StaffInviteConflict =
  /** The address already belongs to a team member. */
  | { kind: "member"; member: TeamMember }
  /** An open staff invitation exists: resend it on the team page. */
  | { kind: "already_invited"; invitation: InvitationSummary }
  /** The address has an open CUSTOMER invitation. */
  | { kind: "customer_invited"; invitation: InvitationSummary; customer: CustomerSummary | null }
  /** The address belongs to a customer: a staff login should use its own address. */
  | { kind: "customer"; customer: CustomerSummary };

export type StaffInviteResult =
  | {
      status: "invited";
      invitationId: string;
      expiresAt: string;
      email: string;
      role: AppRole;
      /** Only in the link shown to the admin, never stored or logged. */
      token: string;
    }
  | { status: "conflict"; conflict: StaffInviteConflict };

/**
 * Why this address cannot get a staff invitation, or null. A customer record
 * that was disabled and has no login (the first admin's own sign-up, SPEC
 * §35.4) does not stand in the way.
 */
async function staffInviteConflict(
  db: Client,
  email: string,
  team: TeamList,
): Promise<StaffInviteConflict | null> {
  const member = team.members.find((m) => m.email?.toLowerCase() === email);
  if (member) return { kind: "member", member };

  const open = await db
    .from("invitations")
    .select(INVITATION_COLUMNS)
    .eq("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .maybeSingle();
  if (open.error) throw open.error;
  if (open.data) {
    if (open.data.kind === "staff") return { kind: "already_invited", invitation: open.data };
    let customer: CustomerSummary | null = null;
    if (open.data.customer_id) {
      const found = await db
        .from("customers")
        .select(CUSTOMER_SUMMARY_COLUMNS)
        .eq("id", open.data.customer_id)
        .maybeSingle();
      if (found.error) throw found.error;
      customer = found.data;
    }
    return { kind: "customer_invited", invitation: open.data, customer };
  }

  const customer = await db
    .from("customers")
    .select(CUSTOMER_SUMMARY_COLUMNS)
    .eq("email", email)
    .maybeSingle();
  if (customer.error) throw customer.error;
  if (customer.data && (customer.data.user_id || customer.data.status !== "disabled")) {
    return { kind: "customer", customer: customer.data };
  }
  return null;
}

/**
 * "Medewerker uitnodigen" with the admin's own client: the invitation row
 * (kind staff, the role, only the token's SHA-256). RLS and
 * invitations_guard allow it for admins only; redeeming it on /invite grants
 * the role (redeem_invitation).
 */
export async function inviteStaff(
  db: Client,
  input: InviteStaffData,
  newToken: TokenFactory,
): Promise<StaffInviteResult> {
  const team = await loadTeam(db);
  const conflict = await staffInviteConflict(db, input.email, team);
  if (conflict) return { status: "conflict", conflict };

  const { token, tokenHash } = await newToken();
  const { data, error } = await db
    .from("invitations")
    .insert({ kind: "staff", staff_role: input.role, email: input.email, token_hash: tokenHash })
    .select("id, expires_at")
    .single();
  if (error) {
    // invitations_one_open_per_email: someone invited this address just now.
    if (error.code === "23505") {
      throw new CodedError(t("admin.team.invite.alreadyInvitedRace"), "23505");
    }
    throw error;
  }
  return {
    status: "invited",
    invitationId: data.id,
    expiresAt: data.expires_at,
    email: input.email,
    role: input.role,
    token,
  };
}
