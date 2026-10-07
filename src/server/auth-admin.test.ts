import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BAN_DURATION,
  createRecoveryLink,
  setLoginBanned,
  type AuthAdminClient,
} from "./auth-admin";
import { createInvitationToken, hashInvitationToken } from "./invitation-tokens";
import { screenLinkBase } from "./links";

afterEach(() => {
  vi.unstubAllEnvs();
});

function fakeAuth(overrides: Record<string, unknown> = {}) {
  const admin = {
    updateUserById: vi.fn(async () => ({ data: { user: {} }, error: null })),
    getUserById: vi.fn(async () => ({
      data: { user: { id: "u1", email: "maria@example.com" } },
      error: null,
    })),
    generateLink: vi.fn(async () => ({
      data: { properties: { hashed_token: "hashed123" }, user: {} },
      error: null,
    })),
    ...overrides,
  };
  return { client: { auth: { admin } } as unknown as AuthAdminClient, admin };
}

describe("setLoginBanned() (SPEC §35.5)", () => {
  it("bans with a ~100 year duration and lifts it with 'none'", async () => {
    const { client, admin } = fakeAuth();
    await setLoginBanned(client, "u1", true);
    expect(admin.updateUserById).toHaveBeenLastCalledWith("u1", { ban_duration: "876000h" });
    expect(BAN_DURATION).toBe("876000h");
    await setLoginBanned(client, "u1", false);
    expect(admin.updateUserById).toHaveBeenLastCalledWith("u1", { ban_duration: "none" });
  });

  it("throws the Auth error, so the caller can report that the login did not change", async () => {
    const { client } = fakeAuth({
      updateUserById: vi.fn(async () => ({ data: null, error: { message: "not allowed" } })),
    });
    await expect(setLoginBanned(client, "u1", true)).rejects.toMatchObject({
      message: "not allowed",
    });
  });
});

describe("createRecoveryLink() (SPEC §35.6)", () => {
  it("builds the /auth/confirm link from hashed_token for the login's own address", async () => {
    const { client, admin } = fakeAuth();
    expect(await createRecoveryLink(client, "u1", "https://portal.example.com")).toBe(
      "https://portal.example.com/auth/confirm?token_hash=hashed123&type=recovery",
    );
    expect(admin.getUserById).toHaveBeenCalledWith("u1");
    expect(admin.generateLink).toHaveBeenCalledWith({
      type: "recovery",
      email: "maria@example.com",
    });
  });
});

describe("invitation tokens", () => {
  it("are 32 random bytes in base64url, stored only as lowercase hex SHA-256", async () => {
    const a = await createInvitationToken();
    const b = await createInvitationToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).toBe(await hashInvitationToken(a.token));
    // A known vector: sha256("abc").
    expect(await hashInvitationToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("screenLinkBase(): links shown to staff", () => {
  const request = (headers: Record<string, string>, url = "https://preview.example.dev/_server") =>
    new Request(url, { headers });

  it("uses APP_URL when it is set", () => {
    vi.stubEnv("APP_URL", "https://portal.example.com");
    expect(screenLinkBase(request({ origin: "https://evil.example" }))).toEqual({
      base: "https://portal.example.com",
      source: "app_url",
    });
  });

  it("falls back to the browser's origin without APP_URL (preview), never for e-mails", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(screenLinkBase(request({ origin: "https://id-preview.lovable.app" }))).toEqual({
      base: "https://id-preview.lovable.app",
      source: "request",
    });
    expect(screenLinkBase(request({ origin: "null" }))).toEqual({
      base: "https://preview.example.dev",
      source: "request",
    });
    expect(() => screenLinkBase(undefined)).toThrow(/APP_URL/);
  });
});
