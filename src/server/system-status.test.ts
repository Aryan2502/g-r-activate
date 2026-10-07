import { afterEach, describe, expect, it, vi } from "vitest";

import { configStatus } from "./system-status";

afterEach(() => {
  vi.unstubAllEnvs();
});

function unset(...names: string[]) {
  for (const name of names) vi.stubEnv(name, "");
}

describe("configStatus (Systeemstatus)", () => {
  it("is all false on a bare server", () => {
    unset(
      "SUPABASE_SERVICE_ROLE_KEY",
      "APP_URL",
      "VERCEL_PROJECT_PRODUCTION_URL",
      "RESEND_API_KEY",
      "EMAIL_FROM",
      "CRON_SECRET",
    );
    expect(configStatus()).toEqual({
      serviceRoleKey: false,
      appUrl: false,
      appUrlFromVercel: false,
      email: false,
      cronSecret: false,
    });
  });

  it("reports booleans only, never a value", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_very_secret_value");
    vi.stubEnv("APP_URL", "https://portal.example.com");
    vi.stubEnv("RESEND_API_KEY", "re_secret");
    vi.stubEnv("EMAIL_FROM", "G&R <noreply@example.com>");
    vi.stubEnv("CRON_SECRET", "c".repeat(40));
    const status = configStatus();
    expect(status).toEqual({
      serviceRoleKey: true,
      appUrl: true,
      appUrlFromVercel: false,
      email: true,
      cronSecret: true,
    });
    const text = JSON.stringify(status);
    for (const secret of ["sb_secret", "re_secret", "portal.example.com", "noreply", "ccc"]) {
      expect(text).not.toContain(secret);
    }
    expect(Object.values(status).every((v) => typeof v === "boolean")).toBe(true);
  });

  it("tells an invalid APP_URL, Vercel's fallback and half an e-mail setup apart", () => {
    unset("VERCEL_PROJECT_PRODUCTION_URL", "EMAIL_FROM");
    vi.stubEnv("APP_URL", "http://portal.example.com");
    expect(configStatus().appUrl).toBe(false);

    unset("APP_URL");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "g-r-activate.vercel.app");
    expect(configStatus()).toMatchObject({ appUrl: false, appUrlFromVercel: true });

    vi.stubEnv("RESEND_API_KEY", "re_123");
    expect(configStatus().email).toBe(false);
    vi.stubEnv("CRON_SECRET", "short");
    expect(configStatus().cronSecret).toBe(false);
  });
});
