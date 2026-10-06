import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MissingEnvError,
  getAppUrl,
  getCronSecret,
  getResendConfig,
  getServiceRoleKey,
} from "./env";

afterEach(() => {
  vi.unstubAllEnvs();
});

function unset(...names: string[]) {
  for (const name of names) vi.stubEnv(name, "");
}

describe("server env getters", () => {
  it("validate only their own variable, lazily", () => {
    unset("SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET");
    vi.stubEnv("APP_URL", "https://portal.example.com");
    expect(getAppUrl()).toBe("https://portal.example.com");
    expect(() => getServiceRoleKey()).toThrow(MissingEnvError);
    expect(() => getCronSecret()).toThrow(/CRON_SECRET/);
  });

  it("return trimmed values", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "  sb_secret_abc  ");
    expect(getServiceRoleKey()).toBe("sb_secret_abc");
  });

  it("require a long CRON_SECRET", () => {
    vi.stubEnv("CRON_SECRET", "short");
    expect(() => getCronSecret()).toThrow(/at least 32/);
    vi.stubEnv("CRON_SECRET", "x".repeat(32));
    expect(getCronSecret()).toHaveLength(32);
  });

  it("build the app URL from APP_URL, else Vercel's production domain", () => {
    unset("APP_URL");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "g-r-activate.vercel.app");
    expect(getAppUrl()).toBe("https://g-r-activate.vercel.app");

    vi.stubEnv("APP_URL", "https://portal.grsolutions.sr/");
    expect(getAppUrl()).toBe("https://portal.grsolutions.sr");

    unset("APP_URL", "VERCEL_PROJECT_PRODUCTION_URL");
    expect(() => getAppUrl()).toThrow(MissingEnvError);
  });

  it("reject app URLs that are not a plain https origin", () => {
    unset("VERCEL_PROJECT_PRODUCTION_URL");
    for (const bad of ["http://portal.example.com", "https://x.example/pad", "geen url"]) {
      vi.stubEnv("APP_URL", bad);
      expect(() => getAppUrl(), bad).toThrow(MissingEnvError);
    }
    vi.stubEnv("APP_URL", "http://localhost:8080");
    expect(getAppUrl()).toBe("http://localhost:8080");
  });

  it("treat Resend as optional", () => {
    unset("RESEND_API_KEY", "EMAIL_FROM", "EMAIL_REPLY_TO");
    expect(getResendConfig()).toBeNull();
    vi.stubEnv("RESEND_API_KEY", "re_123");
    expect(getResendConfig()).toBeNull();
    vi.stubEnv("EMAIL_FROM", "G&R Solutions <noreply@example.com>");
    expect(getResendConfig()).toEqual({
      apiKey: "re_123",
      from: "G&R Solutions <noreply@example.com>",
      replyTo: null,
    });
    vi.stubEnv("EMAIL_REPLY_TO", "info@example.com");
    expect(getResendConfig()?.replyTo).toBe("info@example.com");
  });
});
