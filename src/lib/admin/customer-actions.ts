import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { Constants, type Database } from "@/integrations/supabase/types";
import { parseCustomerCode } from "@/lib/admin/orders";
import { CodedError } from "@/lib/errors";
import { t } from "@/lib/i18n";
import { phoneDigits } from "@/lib/phone";

/**
 * Customer management actions (SPEC §5, §13, §35.5, §35.6), apart from the
 * server functions (lib/server-fns/customers.functions.ts) so they run in
 * PGlite contract tests with a stand-in client. Everything here uses the
 * STAFF MEMBER's own client: RLS, customers_guard (who may change status,
 * e-mail, login), customers_set_code (unique GR codes with the Dutch
 * "GR00017 is al toegewezen aan …") and invitations_guard (one open
 * invitation, resend limits, the customer's own address) decide. The service
 * role is never needed for these writes.
 */

type Client = Pick<SupabaseClient<Database>, "rpc" | "from">;
type CustomerRow = Database["public"]["Tables"]["customers"]["Row"];
type CustomerInsert = Database["public"]["Tables"]["customers"]["Insert"];
export type AccountType = Database["public"]["Enums"]["account_type"];
export const ACCOUNT_TYPES = Constants.public.Enums.account_type;

// ---------------------------------------------------------------------------
// Field rules (shared by the dialogs and the server functions)
// ---------------------------------------------------------------------------

const tooLong = (max: number) => t("auth.validation.tooLong", { max });

/** Optional text: '' → null, otherwise trimmed and at most `max` characters. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, tooLong(max))
    .transform((v) => (v ? v : null));

const requiredName = z
  .string()
  .trim()
  .min(1, t("admin.customers.form.nameRequired"))
  .max(200, tooLong(200));

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Optional e-mail: '' → null, otherwise lower case (customers_email_check). */
export const optionalEmail = z
  .string()
  .trim()
  .max(320, tooLong(320))
  .refine((v) => v === "" || EMAIL.test(v), t("auth.validation.emailInvalid"))
  .transform((v) => (v ? v.toLowerCase() : null));

export const requiredEmail = z
  .string()
  .trim()
  .min(1, t("admin.customers.form.emailRequired"))
  .max(320, tooLong(320))
  .refine((v) => v === "" || EMAIL.test(v), t("auth.validation.emailInvalid"))
  .transform((v) => v.toLowerCase());

/** Optional phone/WhatsApp: '' → null, otherwise the same rules as sign-up ("+5978897500"). */
export const optionalPhone = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (value === "" || value.replace(/\D/g, "") === "597") return;
    if (!phoneDigits(value) || value.length > 50) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: t("auth.validation.phoneInvalid") });
    }
  })
  .transform((value) =>
    value === "" || value.replace(/\D/g, "") === "597" ? null : `+${phoneDigits(value) ?? ""}`,
  );

/** Required phone/WhatsApp ("Klant toevoegen"): the sign-up rules, in staff wording. */
export const requiredPhone = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (value.replace(/\D/g, "").replace(/^597/, "") === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: t("admin.customers.form.phoneRequired"),
      });
    } else if (!phoneDigits(value) || value.length > 50) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: t("auth.validation.phoneInvalid") });
    }
  })
  .transform((value) => `+${phoneDigits(value) ?? ""}`);

/**
 * An existing GR code as staff type it ("GR00017", "gr 17", "17"); '' means
 * "generate a new one". Output: 'GR00017' or null (private.parse_customer_code).
 */
export const optionalCustomerCode = z
  .string()
  .trim()
  .refine((v) => v === "" || parseCustomerCode(v) !== null, t("admin.customers.form.codeInvalid"))
  .transform((v) => (v ? parseCustomerCode(v) : null));

/** 'GR00017' → 17, for customers.customer_number. */
export function customerNumberOf(code: string): number {
  return Number(code.replace(/^GR/i, ""));
}

// A business account needs a company name (customers_business_company_check).
// A discriminated union keeps every rule field-level, so all errors show on
// the first submit (an object-level refinement waits for the other fields).
const accountFields = <T extends z.ZodRawShape>(shape: T) =>
  z.discriminatedUnion("accountType", [
    z.object({ ...shape, accountType: z.literal("personal"), companyName: optionalText(200) }),
    z.object({
      ...shape,
      accountType: z.literal("business"),
      companyName: z
        .string()
        .trim()
        .min(1, t("admin.customers.form.companyRequired"))
        .max(200, tooLong(200)),
    }),
  ]);

/** "Klant toevoegen" (SPEC §35.5): name and phone required, no invitation. */
export const addCustomerSchema = accountFields({
  fullName: requiredName,
  phone: requiredPhone,
  email: optionalEmail,
  code: optionalCustomerCode,
  kkfNumber: optionalText(50),
  contactPerson: optionalText(200),
  address: optionalText(500),
  district: optionalText(100),
});
export type AddCustomerValues = z.input<typeof addCustomerSchema>;
export type AddCustomerData = z.output<typeof addCustomerSchema>;

/** "Klant uitnodigen" (SPEC §5, §35.6): name and e-mail; phone and an existing GR code optional. */
export const inviteNewCustomerSchema = accountFields({
  fullName: requiredName,
  email: requiredEmail,
  phone: optionalPhone,
  code: optionalCustomerCode,
});
export type InviteNewCustomerValues = z.input<typeof inviteNewCustomerSchema>;
export type InviteNewCustomerData = z.output<typeof inviteNewCustomerSchema>;

/**
 * "Gegevens wijzigen" on the customer page. The e-mail is applied only for
 * admins (customers_guard); staff see it read-only.
 */
export const customerContactSchema = accountFields({
  fullName: requiredName,
  phone: optionalPhone,
  email: optionalEmail,
  kkfNumber: optionalText(50),
  contactPerson: optionalText(200),
  address: optionalText(500),
  district: optionalText(100),
});
export type CustomerContactValues = z.input<typeof customerContactSchema>;
export type CustomerContactData = z.output<typeof customerContactSchema>;

/** A required reason (code change, disabling, enabling): at most 500 characters (audit_log/disabled_reason). */
export const reasonText = z
  .string()
  .trim()
  .min(1, t("admin.customers.form.reasonRequired"))
  .max(500, tooLong(500));

// Server function inputs (validated again on the server).
export const inviteCustomerInputSchema = z.union([
  z.object({ mode: z.literal("existing"), customerId: z.string().uuid() }),
  z.object({ mode: z.literal("new"), customer: inviteNewCustomerSchema }),
]);
export type InviteCustomerInput = z.input<typeof inviteCustomerInputSchema>;
export type InviteCustomerData = z.output<typeof inviteCustomerInputSchema>;

export const invitationIdInputSchema = z.object({ invitationId: z.string().uuid() });
export type InvitationIdInput = z.input<typeof invitationIdInputSchema>;

export const setCustomerDisabledInputSchema = z.object({
  customerId: z.string().uuid(),
  disabled: z.boolean(),
  reason: reasonText,
});
export type SetCustomerDisabledInput = z.input<typeof setCustomerDisabledInputSchema>;
export type SetCustomerDisabledData = z.output<typeof setCustomerDisabledInputSchema>;

export const customerIdInputSchema = z.object({ customerId: z.string().uuid() });
export type CustomerIdInput = z.input<typeof customerIdInputSchema>;

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

/** What the dialogs and conflict messages need to know about a customer. */
export type CustomerSummary = Pick<
  CustomerRow,
  | "id"
  | "customer_code"
  | "full_name"
  | "company_name"
  | "account_type"
  | "status"
  | "user_id"
  | "email"
  | "phone"
>;

export const CUSTOMER_SUMMARY_COLUMNS =
  "id, customer_code, full_name, company_name, account_type, status, user_id, email, phone" as const;

async function customerById(db: Client, id: string): Promise<CustomerSummary | null> {
  const { data, error } = await db
    .from("customers")
    .select(CUSTOMER_SUMMARY_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** "Klant toevoegen": create_customer (staff), which numbers the customer or takes the given code. */
export async function addCustomer(db: Client, input: AddCustomerData): Promise<CustomerSummary> {
  const { data, error } = await db.rpc("create_customer", {
    _full_name: input.fullName,
    _phone: input.phone,
    _account_type: input.accountType,
    ...(input.email ? { _email: input.email } : {}),
    ...(input.code ? { _code: input.code } : {}),
    ...(input.companyName && input.accountType === "business"
      ? { _company_name: input.companyName }
      : {}),
    ...(input.kkfNumber ? { _kkf_number: input.kkfNumber } : {}),
    ...(input.contactPerson ? { _contact_person: input.contactPerson } : {}),
    ...(input.address ? { _address: input.address } : {}),
    ...(input.district ? { _district: input.district } : {}),
  });
  if (error) throw error;
  return data;
}

/**
 * Whether the customer has orders or issued invoices, which freezes the GR
 * code (private.customer_has_activity; a draft invoice does not count).
 */
export async function customerHasActivity(db: Client, customerId: string): Promise<boolean> {
  const orders = await db.from("orders").select("id").eq("customer_id", customerId).limit(1);
  if (orders.error) throw orders.error;
  if (orders.data.length > 0) return true;
  const invoices = await db
    .from("invoices")
    .select("id")
    .eq("customer_id", customerId)
    .neq("status", "draft")
    .limit(1);
  if (invoices.error) throw invoices.error;
  return invoices.data.length > 0;
}

type ContactColumns = Pick<
  CustomerRow,
  | "full_name"
  | "account_type"
  | "company_name"
  | "phone"
  | "kkf_number"
  | "contact_person"
  | "address"
  | "district"
  | "email"
>;

/**
 * The changes "Gegevens wijzigen" writes: only fields that really changed
 * (a phone typed in another notation is the same number), so the audit log
 * names what changed; the e-mail only when an admin may change it.
 */
export function contactUpdate(
  values: CustomerContactData,
  { includeEmail }: { includeEmail: boolean },
  current?: Partial<ContactColumns>,
): Partial<ContactColumns> {
  const all: Partial<ContactColumns> = {
    full_name: values.fullName,
    account_type: values.accountType,
    company_name: values.accountType === "business" ? values.companyName : null,
    phone: values.phone,
    kkf_number: values.kkfNumber,
    contact_person: values.contactPerson,
    address: values.address,
    district: values.district,
    ...(includeEmail ? { email: values.email } : {}),
  };
  if (!current) return all;
  const changed: Partial<ContactColumns> = {};
  for (const key of Object.keys(all) as (keyof ContactColumns)[]) {
    const next = all[key] ?? null;
    const before = current[key] ?? null;
    if (key === "phone" && next && before && phoneDigits(next) === phoneDigits(before)) continue;
    if (next !== before) Object.assign(changed, { [key]: next });
  }
  return changed;
}

export async function updateCustomerContact(
  db: Client,
  customerId: string,
  values: CustomerContactData,
  options: { includeEmail: boolean; current?: Partial<ContactColumns> },
): Promise<CustomerSummary> {
  const update = contactUpdate(values, options, options.current);
  const { data, error } = await db
    .from("customers")
    // Nothing changed: an unchanged name still answers with the record.
    .update(Object.keys(update).length > 0 ? update : { full_name: values.fullName })
    .eq("id", customerId)
    .select(CUSTOMER_SUMMARY_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

/** "Code wijzigen" (admin, SPEC §35.5): change_customer_code checks the reason and the activity rule. */
export async function changeCustomerCode(
  db: Client,
  input: { customerId: string; code: string; reason: string },
): Promise<CustomerSummary> {
  const { data, error } = await db.rpc("change_customer_code", {
    _id: input.customerId,
    _code: input.code,
    _reason: input.reason,
  });
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Invitations (SPEC §35.6)
// ---------------------------------------------------------------------------

/** A new token and its hash; the server functions pass src/server/invitation-tokens.ts. */
export type TokenFactory = () => Promise<{ token: string; tokenHash: string }>;

export type InviteConflict =
  /** This e-mail belongs to a customer who already logs in. */
  | {
      kind: "has_login";
      customer: CustomerSummary;
      /** The code staff asked for, when it differs from the customer's. */
      requestedCode: string | null;
      /** No orders or issued invoices yet: an admin can change the code instead. */
      canChangeCode: boolean;
    }
  /** The customer already has an open invitation: resend it on the customer page. */
  | { kind: "already_invited"; customer: CustomerSummary }
  | { kind: "disabled"; customer: CustomerSummary }
  /** The e-mail belongs to a customer with another code than the one typed. */
  | { kind: "other_code"; customer: CustomerSummary; requestedCode: string }
  /** "Uitnodigen" needs an e-mail on the customer record. */
  | { kind: "no_email"; customer: CustomerSummary };

export type InviteResult =
  | {
      status: "invited";
      invitationId: string;
      expiresAt: string;
      customer: CustomerSummary;
      /** Only in the link shown to staff, never stored or logged. */
      token: string;
      /** A new customer record was created for this invitation. */
      customerCreated: boolean;
    }
  | { status: "conflict"; conflict: InviteConflict }
  /** The customer was created, but the invitation itself failed. */
  | { status: "customer_only"; customer: CustomerSummary; error: unknown };

async function openInvitationOf(db: Client, customerId: string): Promise<string | null> {
  const { data, error } = await db
    .from("invitations")
    .select("id")
    .eq("customer_id", customerId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .limit(1);
  if (error) throw error;
  return data[0]?.id ?? null;
}

/** Why an existing customer cannot be invited (yet), or null when they can. */
async function existingConflict(
  db: Client,
  customer: CustomerSummary,
  requestedCode: string | null,
): Promise<InviteConflict | null> {
  const otherCode =
    requestedCode && requestedCode !== customer.customer_code ? requestedCode : null;
  // Disabled first: a disabled customer with a login cannot sign in, so
  // "heeft al een login" would mislead.
  if (customer.status === "disabled") return { kind: "disabled", customer };
  if (customer.user_id) {
    return {
      kind: "has_login",
      customer,
      requestedCode: otherCode,
      canChangeCode: otherCode !== null && !(await customerHasActivity(db, customer.id)),
    };
  }
  if (!customer.email) return { kind: "no_email", customer };
  if (await openInvitationOf(db, customer.id)) return { kind: "already_invited", customer };
  if (otherCode) return { kind: "other_code", customer, requestedCode: otherCode };
  return null;
}

/**
 * "Klant uitnodigen" (SPEC §35.6 steps 1–3): look the e-mail up first and
 * never create a second record for it; otherwise create the customer (status
 * becomes 'invited' with the invitation, so the GR code is reserved), then the
 * invitation with only the token's hash.
 */
export async function inviteCustomer(
  db: Client,
  input: InviteCustomerData,
  newToken: TokenFactory,
): Promise<InviteResult> {
  let customer: CustomerSummary;
  let customerCreated = false;

  if (input.mode === "existing") {
    const found = await customerById(db, input.customerId);
    if (!found) throw new CodedError(t("admin.customers.notFoundTitle"), "P0002");
    const conflict = await existingConflict(db, found, null);
    if (conflict) return { status: "conflict", conflict };
    customer = found;
  } else {
    const values = input.customer;
    const { data: known, error } = await db
      .from("customers")
      .select(CUSTOMER_SUMMARY_COLUMNS)
      .eq("email", values.email)
      .maybeSingle();
    if (error) throw error;
    if (known) {
      const conflict = await existingConflict(db, known, values.code);
      if (conflict) return { status: "conflict", conflict };
      customer = known;
    } else {
      // Not create_customer: that RPC requires a phone number ("Klant toevoegen"),
      // an invitation does not (SPEC §5). RLS and customers_guard allow staff
      // this insert; customers_set_code numbers the customer when no code is
      // given. customer_number has no column default (the trigger assigns it),
      // so the generated Insert type marks it required.
      const row = {
        full_name: values.fullName,
        email: values.email,
        phone: values.phone,
        account_type: values.accountType,
        company_name: values.accountType === "business" ? values.companyName : null,
        ...(values.code ? { customer_number: customerNumberOf(values.code) } : {}),
      } as CustomerInsert;
      const inserted = await db
        .from("customers")
        .insert(row)
        .select(CUSTOMER_SUMMARY_COLUMNS)
        .single();
      if (inserted.error) throw inserted.error;
      customer = inserted.data;
      customerCreated = true;
    }
  }

  const { token, tokenHash } = await newToken();
  const { data: invitation, error } = await db
    .from("invitations")
    .insert({
      kind: "customer",
      customer_id: customer.id,
      email: customer.email ?? "",
      token_hash: tokenHash,
    })
    .select("id, expires_at")
    .single();
  if (error) {
    if (customerCreated) return { status: "customer_only", customer, error };
    throw error;
  }
  return {
    status: "invited",
    invitationId: invitation.id,
    expiresAt: invitation.expires_at,
    customer: { ...customer, status: "invited" },
    token,
    customerCreated,
  };
}

export const INVITATION_COLUMNS =
  "id, kind, customer_id, staff_role, email, expires_at, last_sent_at, send_count, accepted_at, accepted_by, revoked_at, created_at, created_by" as const;

export type InvitationSummary = Pick<
  Database["public"]["Tables"]["invitations"]["Row"],
  | "id"
  | "kind"
  | "customer_id"
  | "staff_role"
  | "email"
  | "expires_at"
  | "last_sent_at"
  | "send_count"
  | "accepted_at"
  | "accepted_by"
  | "revoked_at"
  | "created_at"
  | "created_by"
>;

export interface ResendResult {
  invitation: InvitationSummary;
  customer: CustomerSummary | null;
  token: string;
}

/**
 * "Opnieuw versturen" (SPEC §35.6 step 5): a new token, so the old link stops
 * working. invitations_guard allows it once a minute and five times per
 * Suriname day, and only while the invitation is open; staff invitations
 * need an admin (RLS).
 */
export async function resendInvitation(
  db: Client,
  invitationId: string,
  newToken: TokenFactory,
): Promise<ResendResult> {
  const { token, tokenHash } = await newToken();
  const { data, error } = await db
    .from("invitations")
    .update({ token_hash: tokenHash })
    .eq("id", invitationId)
    .select(INVITATION_COLUMNS)
    .single();
  if (error) {
    // No row: gone, or an invitation this login may not touch (RLS).
    if (error.code === "PGRST116") {
      throw new CodedError(t("admin.invitations.notFound"), "P0002");
    }
    throw error;
  }
  const customer = data.customer_id ? await customerById(db, data.customer_id) : null;
  return { invitation: data, customer, token };
}

/** "Intrekken": the link stops working at once (invitations_guard stamps the time). */
export async function revokeInvitation(db: Client, invitationId: string): Promise<void> {
  const { error } = await db
    .from("invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", invitationId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id")
    .single();
  if (error) {
    if (error.code === "PGRST116") {
      throw new CodedError(t("admin.invitations.notOpen"), "55000");
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Disable / enable (admin, SPEC §35.5)
// ---------------------------------------------------------------------------

export interface DisableResult {
  customer: Pick<CustomerRow, "id" | "user_id" | "status" | "full_name">;
  /** Open invitations revoked with the disabling. */
  revokedInvitations: number;
  /**
   * The linked login belongs to the team (holds a staff or admin role, even
   * a deactivated one): the customer page never (un)bans it. A team login is
   * (de)activated on /admin/team only, with that page's safeguards (never
   * yourself, an admin who can still sign in, the team audit entry).
   */
  teamLogin: boolean;
}

/**
 * What setCustomerDisabledFn does with the linked login after the status
 * changed: nothing without a login; never anything for a team login or the
 * caller's own (the team page's safeguards apply there); otherwise (un)ban.
 */
export function disableLoginPlan(
  result: Pick<DisableResult, "teamLogin"> & { customer: Pick<CustomerRow, "user_id"> },
  callerId: string,
): { action: "none" } | { action: "team" } | { action: "ban"; userId: string } {
  const userId = result.customer.user_id;
  if (!userId) return { action: "none" };
  if (result.teamLogin || userId === callerId) return { action: "team" };
  return { action: "ban", userId };
}

/**
 * Whether a login holds any role, deactivated or not. user_roles directly
 * (admins read every row), not has_role(), which ignores blocked logins.
 */
export async function isTeamLogin(db: Client, userId: string): Promise<boolean> {
  const { data, error } = await db.from("user_roles").select("role").eq("user_id", userId).limit(1);
  if (error) throw error;
  return data.length > 0;
}

/**
 * The database half of "Deactiveren"/"Activeren": the status (and reason)
 * with the admin's own client (customers_guard: admins only; the trigger
 * stamps disabled_at/by), the open invitation revoked on disabling (its link
 * must not work later), and an internal note so staff see who did it and why.
 * The server function then (un)bans the login with the service role, unless
 * it is a team login (checked here first, so a failing check changes nothing).
 */
export async function setCustomerDisabledInDb(
  db: Client,
  input: SetCustomerDisabledData,
): Promise<DisableResult> {
  const before = await customerById(db, input.customerId);
  if (!before) throw new CodedError(t("admin.customers.notFoundTitle"), "P0002");
  let teamLogin = before.user_id ? await isTeamLogin(db, before.user_id) : false;

  const query = db
    .from("customers")
    .update(
      input.disabled
        ? { status: "disabled" as const, disabled_reason: input.reason }
        : { status: "active" as const },
    )
    .eq("id", input.customerId);
  const { data, error } = await (
    input.disabled ? query.neq("status", "disabled") : query.eq("status", "disabled")
  )
    .select("id, user_id, status, full_name")
    .single();
  if (error) {
    if (error.code === "PGRST116") {
      throw new CodedError(
        input.disabled
          ? t("admin.customers.disable.alreadyDisabled")
          : t("admin.customers.disable.notDisabled"),
        "55000",
      );
    }
    throw error;
  }

  // Linked by a redemption between the two reads: check that login too.
  if (data.user_id && data.user_id !== before.user_id) {
    teamLogin = await isTeamLogin(db, data.user_id);
  }

  let revokedInvitations = 0;
  if (input.disabled) {
    const revoked = await db
      .from("invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("customer_id", input.customerId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .select("id");
    if (revoked.error) throw revoked.error;
    revokedInvitations = revoked.data.length;
  }

  const note = await db.from("internal_notes").insert({
    customer_id: input.customerId,
    body: input.disabled
      ? t("admin.customers.disable.noteDisabled", { reason: input.reason })
      : t("admin.customers.disable.noteEnabled", { reason: input.reason }),
  });
  if (note.error) throw note.error;
  return { customer: data, revokedInvitations, teamLogin };
}

// ---------------------------------------------------------------------------
// Password-reset link (SPEC §35.6: "Wachtwoord-resetlink maken")
// ---------------------------------------------------------------------------

export interface RecoveryTarget {
  userId: string;
  fullName: string;
  phone: string | null;
}

/**
 * Checks, with the staff member's own client, that a reset link may be made
 * for this customer's login: it exists and the customer is not disabled. A
 * login that is also part of the team (staff or admin, deactivated or not)
 * gets its reset link on /admin/team only (admins, never for a deactivated
 * member): a reset link takes over the account, and a link made while a
 * member is deactivated would still work once they are reactivated.
 */
export async function recoveryTarget(
  db: Client,
  customerId: string,
  callerIsAdmin: boolean,
): Promise<RecoveryTarget> {
  const customer = await customerById(db, customerId);
  if (!customer) throw new CodedError(t("admin.customers.notFoundTitle"), "P0002");
  if (!customer.user_id) throw new CodedError(t("admin.recovery.noLogin"), "55000");
  if (customer.status === "disabled") throw new CodedError(t("admin.recovery.disabled"), "55000");
  if (await loginInTeam(db, customer.user_id)) {
    throw callerIsAdmin
      ? new CodedError(t("admin.recovery.teamLogin"), "55000")
      : new CodedError(t("admin.recovery.staffOnlyAdmin"), "42501");
  }
  return { userId: customer.user_id, fullName: customer.full_name, phone: customer.phone };
}

/**
 * Whether a login is a team member, deactivated ones included, as any staff
 * member may ask: team_members() (P5 migration) lists blocked members too.
 * Before that migration has_role() does not yet ignore blocked logins, so
 * it answers the same question.
 */
async function loginInTeam(db: Client, userId: string): Promise<boolean> {
  type TeamRpc = (fn: "team_members") => PromiseLike<{
    data: { user_id: string }[] | null;
    error: { code?: string; message: string } | null;
  }>;
  const team = await (db.rpc as unknown as TeamRpc).call(db, "team_members");
  if (!team.error) return (team.data ?? []).some((m) => m.user_id === userId);
  if (!MISSING_FUNCTION.includes(team.error.code ?? "")) throw team.error;
  for (const role of ["admin", "staff"] as const) {
    const { data, error } = await db.rpc("has_role", { _user_id: userId, _role: role });
    if (error) throw error;
    if (data === true) return true;
  }
  return false;
}

export type RecoveryAudit = "audited" | "noted" | "unaudited";

const MISSING_FUNCTION = ["PGRST202", "42883"];

/**
 * Records "Wachtwoord-resetlink maken" BEFORE the link is created, and throws
 * when that fails so no link is made without a trace (P10 review: the link
 * signs in as that login). log_recovery_link() (migration
 * 20261008120000_p10_review_hardening.sql) writes an audit_log row with the
 * staff member as actor; it also refuses a team login unless the caller is an
 * admin. Until that migration is applied the function does not exist: for a
 * customer the staff-only note is then written first instead ("noted"); for
 * a team login (no customer record) the link is made as before
 * ("unaudited").
 */
export async function logRecoveryLink(
  db: Client,
  userId: string,
  customerId: string | null,
): Promise<RecoveryAudit> {
  type LogRpc = (
    fn: "log_recovery_link",
    args: { _user_id: string },
  ) => PromiseLike<{ error: { code?: string; message: string } | null }>;
  const { error } = await (db.rpc as unknown as LogRpc).call(db, "log_recovery_link", {
    _user_id: userId,
  });
  if (!error) return "audited";
  if (!MISSING_FUNCTION.includes(error.code ?? "")) throw error;
  if (!customerId) return "unaudited";
  await noteRecoveryLink(db, customerId);
  return "noted";
}

/** Leaves a staff-only trace of who made a reset link (internal_notes stamps the author). */
export async function noteRecoveryLink(db: Client, customerId: string): Promise<void> {
  const { error } = await db
    .from("internal_notes")
    .insert({ customer_id: customerId, body: t("admin.recovery.note") });
  if (error) throw error;
}
