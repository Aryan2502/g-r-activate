import { afterEach, describe, expect, it, vi } from "vitest";

import { t } from "@/lib/i18n";
import { toAppError } from "@/lib/errors";

import { hashInvitationToken } from "./invitation-tokens";
import {
  destinationOf,
  lookupInvitation,
  redeemForUser,
  redeemWithPassword,
  type AdminClient,
} from "./invitations";

/**
 * The redemption paths of SPEC §35.6 against a stand-in for supabaseAdmin:
 * get_invitation / admin_auth_user_by_email / redeem_invitation (rpc), the
 * customer pre-check and the terms bookkeeping (from), and auth.admin.*.
 * The database half (redeem_invitation itself) is proven in PGlite
 * (supabase/tests/pglite/customers_contract.test.ts).
 */

const TOKEN = "A".repeat(43);
const INVITATION_ID = "1a1a1a1a-0000-4000-8000-000000000001";
const CUSTOMER_ID = "c0c0c0c0-0000-4000-8000-000000000001";
const NEW_USER_ID = "11111111-1111-4111-8111-111111111111";
const EXISTING_USER_ID = "22222222-2222-4222-8222-222222222222";

type Invitation = {
  invitation_id: string;
  kind: "customer" | "staff";
  email: string;
  staff_role: "admin" | "staff" | null;
  customer_id: string | null;
  customer_code: string | null;
  full_name: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  is_expired: boolean;
};

const openInvitation = (extra: Partial<Invitation> = {}): Invitation => ({
  invitation_id: INVITATION_ID,
  kind: "customer",
  email: "maria.pinas@example.com",
  staff_role: null,
  customer_id: CUSTOMER_ID,
  customer_code: "GR00017",
  full_name: "Maria Pinas",
  expires_at: "2026-10-14T12:00:00Z",
  accepted_at: null,
  revoked_at: null,
  is_expired: false,
  ...extra,
});

interface FakeOptions {
  invitation?: Invitation | null;
  authUser?: { id: string; email: string; email_confirmed_at: string | null } | null;
  customer?: { status: string; user_id: string | null; email: string | null };
  redeemError?: { code: string; message: string } | null;
  createUserError?: { code: string; message: string; status: number } | null;
}

function fakeAdmin(options: FakeOptions = {}) {
  const invitation = options.invitation === undefined ? openInvitation() : options.invitation;
  const calls = {
    rpc: [] as { name: string; args: Record<string, unknown> }[],
    createUser: vi.fn(),
    updateUserById: vi.fn(),
    deleteUser: vi.fn(),
    updates: [] as {
      table: string;
      values: Record<string, unknown>;
      filters: [string, unknown][];
    }[],
  };

  const rpc = async (name: string, args: Record<string, unknown>) => {
    calls.rpc.push({ name, args });
    switch (name) {
      case "get_invitation":
        return { data: invitation ? [invitation] : [], error: null };
      case "admin_auth_user_by_email":
        return { data: options.authUser ? [options.authUser] : [], error: null };
      case "redeem_invitation":
        if (options.redeemError) return { data: null, error: options.redeemError };
        return {
          data: [
            {
              invitation_id: invitation?.invitation_id,
              kind: invitation?.kind,
              customer_id: invitation?.customer_id,
              staff_role: invitation?.staff_role,
            },
          ],
          error: null,
        };
      default:
        throw new Error(`unexpected rpc ${name}`);
    }
  };

  const from = (table: string) => ({
    select: () => {
      const result =
        table === "customers"
          ? (options.customer ?? {
              status: "invited",
              user_id: null,
              email: invitation?.email ?? null,
            })
          : { terms_version: "3" };
      const chain = {
        eq: () => chain,
        maybeSingle: async () => ({ data: result, error: null }),
      };
      return chain;
    },
    update: (values: Record<string, unknown>) => {
      const entry = { table, values, filters: [] as [string, unknown][] };
      calls.updates.push(entry);
      const chain = {
        eq: (column: string, value: unknown) => {
          entry.filters.push([column, value]);
          return chain;
        },
        then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
      };
      return chain;
    },
  });

  calls.createUser.mockImplementation(async () =>
    options.createUserError
      ? { data: { user: null }, error: options.createUserError }
      : { data: { user: { id: NEW_USER_ID } }, error: null },
  );
  calls.updateUserById.mockImplementation(async () => ({
    data: { user: { id: EXISTING_USER_ID } },
    error: null,
  }));
  calls.deleteUser.mockImplementation(async () => ({ data: {}, error: null }));

  const admin = {
    rpc,
    from,
    auth: {
      admin: {
        createUser: calls.createUser,
        updateUserById: calls.updateUserById,
        deleteUser: calls.deleteUser,
      },
    },
  } as unknown as AdminClient;
  return { admin, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lookupInvitation()", () => {
  it("looks the invitation up by the SHA-256 of the token, never by the token", async () => {
    const { admin, calls } = fakeAdmin();
    await lookupInvitation(admin, TOKEN);
    expect(calls.rpc[0]).toEqual({
      name: "get_invitation",
      args: { _token_hash: await hashInvitationToken(TOKEN) },
    });
    expect(JSON.stringify(calls.rpc)).not.toContain(TOKEN);
  });

  it("returns only a first name, a masked e-mail, the GR code and the flags", async () => {
    const { admin } = fakeAdmin();
    const lookup = await lookupInvitation(admin, TOKEN);
    expect(lookup).toEqual({
      status: "open",
      kind: "customer",
      firstName: "Maria",
      maskedEmail: "ma•••@e•••.com",
      customerCode: "GR00017",
      staffRole: null,
      existingAccount: false,
      expiresAt: "2026-10-14T12:00:00Z",
    });
    expect(JSON.stringify(lookup)).not.toContain("maria.pinas@example.com");
    expect(JSON.stringify(lookup)).not.toContain(CUSTOMER_ID);
  });

  it("says an account exists only for a confirmed login (path c)", async () => {
    const unconfirmed = fakeAdmin({
      authUser: {
        id: EXISTING_USER_ID,
        email: "maria.pinas@example.com",
        email_confirmed_at: null,
      },
    });
    expect(await lookupInvitation(unconfirmed.admin, TOKEN)).toMatchObject({
      existingAccount: false,
    });
    const confirmed = fakeAdmin({
      authUser: {
        id: EXISTING_USER_ID,
        email: "maria.pinas@example.com",
        email_confirmed_at: "2026-01-01T00:00:00Z",
      },
    });
    expect(await lookupInvitation(confirmed.admin, TOKEN)).toMatchObject({
      existingAccount: true,
    });
  });

  it("reveals nothing but the state of a used, revoked or expired link", async () => {
    for (const [extra, status] of [
      [{ accepted_at: "2026-10-01T00:00:00Z" }, "accepted"],
      [{ revoked_at: "2026-10-01T00:00:00Z" }, "revoked"],
      [{ is_expired: true }, "expired"],
    ] as const) {
      const { admin, calls } = fakeAdmin({ invitation: openInvitation(extra) });
      expect(await lookupInvitation(admin, TOKEN)).toEqual({ status, kind: "customer" });
      // Not even whether the address has a login.
      expect(calls.rpc.map((c) => c.name)).toEqual(["get_invitation"]);
    }
  });

  it("treats a malformed token as invalid without touching the database", async () => {
    const { admin, calls } = fakeAdmin();
    for (const token of ["", "short", `${TOKEN}A`, `${"A".repeat(42)}=`, "../../etc/passwd"]) {
      expect(await lookupInvitation(admin, token)).toEqual({ status: "invalid" });
    }
    expect(calls.rpc).toEqual([]);
    const unknown = fakeAdmin({ invitation: null });
    expect(await lookupInvitation(unknown.admin, TOKEN)).toEqual({ status: "invalid" });
  });

  it("staff invitations carry the role, never a customer code", async () => {
    const { admin } = fakeAdmin({
      invitation: openInvitation({
        kind: "staff",
        staff_role: "staff",
        customer_id: null,
        customer_code: null,
        full_name: null,
        email: "kim@example.com",
      }),
    });
    expect(await lookupInvitation(admin, TOKEN)).toMatchObject({
      kind: "staff",
      staffRole: "staff",
      customerCode: null,
      firstName: null,
      maskedEmail: "ki•••@e•••.com",
    });
  });
});

describe("redeemWithPassword(): paths a and b", () => {
  const input = { token: TOKEN, password: "geheim-wachtwoord", acceptTerms: true };

  it("(a) no login yet: creates a confirmed user with app_metadata.invitation_id, then links it", async () => {
    const { admin, calls } = fakeAdmin();
    const outcome = await redeemWithPassword(admin, input);

    expect(calls.createUser).toHaveBeenCalledWith({
      email: "maria.pinas@example.com",
      password: "geheim-wachtwoord",
      email_confirm: true,
      app_metadata: { invitation_id: INVITATION_ID },
      user_metadata: { full_name: "Maria Pinas" },
    });
    expect(calls.updateUserById).not.toHaveBeenCalled();
    expect(calls.rpc.find((c) => c.name === "redeem_invitation")?.args).toEqual({
      _token_hash: await hashInvitationToken(TOKEN),
      _user_id: NEW_USER_ID,
    });
    expect(outcome).toEqual({
      ok: true,
      kind: "customer",
      email: "maria.pinas@example.com",
      destination: "/portal",
      invitationId: INVITATION_ID,
      customerId: CUSTOMER_ID,
      userId: NEW_USER_ID,
    });
    // The terms accepted on the page, on the record now linked to this login.
    expect(calls.updates).toEqual([
      {
        table: "customers",
        values: { terms_version: "3", terms_accepted_at: expect.any(String) },
        filters: [
          ["id", CUSTOMER_ID],
          ["user_id", NEW_USER_ID],
        ],
      },
    ]);
  });

  it("(b) an unconfirmed login: sets the password and confirms it (the token proves the address)", async () => {
    const { admin, calls } = fakeAdmin({
      authUser: {
        id: EXISTING_USER_ID,
        email: "maria.pinas@example.com",
        email_confirmed_at: null,
      },
    });
    const outcome = await redeemWithPassword(admin, input);
    expect(calls.createUser).not.toHaveBeenCalled();
    expect(calls.updateUserById).toHaveBeenCalledWith(EXISTING_USER_ID, {
      password: "geheim-wachtwoord",
      email_confirm: true,
      app_metadata: { invitation_id: INVITATION_ID },
      // Whatever the pre-registration put there goes; the invitation names the person.
      user_metadata: {
        full_name: "Maria Pinas",
        phone: null,
        company_name: null,
        account_type: null,
        terms_version: null,
      },
    });
    expect(calls.rpc.find((c) => c.name === "redeem_invitation")?.args["_user_id"]).toBe(
      EXISTING_USER_ID,
    );
    expect(outcome).toMatchObject({ ok: true, userId: EXISTING_USER_ID, destination: "/portal" });
  });

  it("(c) a confirmed login: changes nothing and asks the invitee to sign in first", async () => {
    const { admin, calls } = fakeAdmin({
      authUser: {
        id: EXISTING_USER_ID,
        email: "maria.pinas@example.com",
        email_confirmed_at: "2026-01-01T00:00:00Z",
      },
    });
    expect(await redeemWithPassword(admin, input)).toEqual({ ok: false, reason: "needs_login" });
    expect(calls.createUser).not.toHaveBeenCalled();
    expect(calls.updateUserById).not.toHaveBeenCalled();
    expect(calls.rpc.map((c) => c.name)).not.toContain("redeem_invitation");
  });

  it("deletes the login it just created when the database refuses the link", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin, calls } = fakeAdmin({
      redeemError: { code: "55000", message: "Deze uitnodiging is niet meer geldig" },
    });
    await expect(redeemWithPassword(admin, input)).rejects.toMatchObject({ code: "55000" });
    expect(calls.deleteUser).toHaveBeenCalledWith(NEW_USER_ID);
    expect(calls.updates).toEqual([]);
  });

  it("never deletes an existing login (path b) when linking fails", async () => {
    const { admin, calls } = fakeAdmin({
      authUser: {
        id: EXISTING_USER_ID,
        email: "maria.pinas@example.com",
        email_confirmed_at: null,
      },
      redeemError: { code: "55000", message: "Deze uitnodiging is verlopen" },
    });
    await expect(redeemWithPassword(admin, input)).rejects.toMatchObject({ code: "55000" });
    expect(calls.deleteUser).not.toHaveBeenCalled();
  });

  it("refuses a customer invitation without the terms, before touching Auth", async () => {
    const { admin, calls } = fakeAdmin();
    const error = await redeemWithPassword(admin, { ...input, acceptTerms: false }).catch(
      (e: unknown) => e,
    );
    expect(toAppError(error)).toMatchObject({
      code: "22023",
      message: t("auth.validation.termsRequired"),
    });
    expect(calls.createUser).not.toHaveBeenCalled();
  });

  it("checks the customer record first: disabled, linked elsewhere or a changed address", async () => {
    for (const [customer, key] of [
      [{ status: "disabled", user_id: null, email: "maria.pinas@example.com" }, "customerDisabled"],
      [
        { status: "active", user_id: EXISTING_USER_ID, email: "maria.pinas@example.com" },
        "customerLinked",
      ],
      [{ status: "invited", user_id: null, email: "other@example.com" }, "emailChanged"],
    ] as const) {
      const { admin, calls } = fakeAdmin({ customer });
      const error = await redeemWithPassword(admin, input).catch((e: unknown) => e);
      expect(toAppError(error).message).toBe(t(`invite.errors.${key}`));
      expect(calls.createUser).not.toHaveBeenCalled();
      expect(calls.updateUserById).not.toHaveBeenCalled();
    }
  });

  it("answers the state of a used, revoked, expired or unknown link and changes nothing", async () => {
    for (const [invitation, status] of [
      [openInvitation({ accepted_at: "2026-10-01T00:00:00Z" }), "accepted"],
      [openInvitation({ revoked_at: "2026-10-01T00:00:00Z" }), "revoked"],
      [openInvitation({ is_expired: true }), "expired"],
      [null, "invalid"],
    ] as const) {
      const { admin, calls } = fakeAdmin({ invitation });
      expect(await redeemWithPassword(admin, input)).toEqual({
        ok: false,
        reason: "state",
        status,
      });
      expect(calls.createUser).not.toHaveBeenCalled();
    }
  });

  it("turns an Auth refusal (weak password) into a Dutch message", async () => {
    const { admin } = fakeAdmin({
      createUserError: { code: "weak_password", message: "Password is too weak", status: 422 },
    });
    const error = await redeemWithPassword(admin, input).catch((e: unknown) => e);
    expect(toAppError(error).message).toBe(t("auth.errors.weakPassword"));
  });

  it("staff invitations need no terms and lead to /admin", async () => {
    const { admin, calls } = fakeAdmin({
      invitation: openInvitation({
        kind: "staff",
        staff_role: "staff",
        customer_id: null,
        customer_code: null,
        full_name: null,
      }),
    });
    const outcome = await redeemWithPassword(admin, { ...input, acceptTerms: false });
    expect(outcome).toMatchObject({ ok: true, kind: "staff", destination: "/admin" });
    expect(calls.createUser.mock.calls[0]?.[0]).not.toHaveProperty("user_metadata");
    expect(calls.updates).toEqual([]);
  });
});

describe("redeemForUser(): path c", () => {
  it("links the signed-in login; the database checks that its e-mail is the invitation's", async () => {
    const { admin, calls } = fakeAdmin();
    const outcome = await redeemForUser(admin, {
      token: TOKEN,
      userId: EXISTING_USER_ID,
      acceptTerms: true,
    });
    expect(calls.rpc.find((c) => c.name === "redeem_invitation")?.args).toEqual({
      _token_hash: await hashInvitationToken(TOKEN),
      _user_id: EXISTING_USER_ID,
    });
    expect(calls.createUser).not.toHaveBeenCalled();
    expect(calls.updateUserById).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ ok: true, destination: "/portal", userId: EXISTING_USER_ID });
    expect(calls.updates[0]?.filters).toEqual([
      ["id", CUSTOMER_ID],
      ["user_id", EXISTING_USER_ID],
    ]);
  });

  it("passes the database's refusal of another account's e-mail on (42501)", async () => {
    const { admin } = fakeAdmin({
      redeemError: {
        code: "42501",
        message: "Het e-mailadres van dit account hoort niet bij deze uitnodiging",
      },
    });
    const error = await redeemForUser(admin, {
      token: TOKEN,
      userId: EXISTING_USER_ID,
      acceptTerms: true,
    }).catch((e: unknown) => e);
    expect(toAppError(error)).toMatchObject({
      code: "42501",
      message: "Het e-mailadres van dit account hoort niet bij deze uitnodiging",
    });
  });

  it("repeating it for the same login is fine; for another login it is a used link", async () => {
    const accepted = openInvitation({ accepted_at: "2026-10-01T00:00:00Z" });
    const same = fakeAdmin({ invitation: accepted });
    expect(
      await redeemForUser(same.admin, {
        token: TOKEN,
        userId: EXISTING_USER_ID,
        acceptTerms: false,
      }),
    ).toMatchObject({ ok: true });
    // Terms are recorded only when the invitation was still open.
    expect(same.calls.updates).toEqual([]);

    const other = fakeAdmin({
      invitation: accepted,
      redeemError: { code: "55000", message: "Deze uitnodiging is al gebruikt" },
    });
    expect(
      await redeemForUser(other.admin, { token: TOKEN, userId: NEW_USER_ID, acceptTerms: true }),
    ).toEqual({ ok: false, reason: "state", status: "accepted" });
  });

  it("refuses expired and revoked links without calling redeem", async () => {
    const { admin, calls } = fakeAdmin({ invitation: openInvitation({ is_expired: true }) });
    expect(
      await redeemForUser(admin, { token: TOKEN, userId: EXISTING_USER_ID, acceptTerms: true }),
    ).toEqual({ ok: false, reason: "state", status: "expired" });
    expect(calls.rpc.map((c) => c.name)).toEqual(["get_invitation"]);
  });
});

describe("destinationOf()", () => {
  it("sends customers to /portal and staff to /admin", () => {
    expect(destinationOf("customer")).toBe("/portal");
    expect(destinationOf("staff")).toBe("/admin");
  });
});
