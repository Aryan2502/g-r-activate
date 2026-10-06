import { describe, expect, it } from "vitest";

import { parseAuthCallback } from "./callback";

describe("parseAuthCallback()", () => {
  it("reads a session from Supabase's default link (fragment)", () => {
    expect(
      parseAuthCallback(
        "https://gr.example/auth/confirm#access_token=a.b.c&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery",
      ),
    ).toEqual({ type: "recovery", hasSession: true, errorCode: null, errorDescription: null });
  });

  it("reads an expired-link error from the query or the fragment", () => {
    expect(
      parseAuthCallback(
        "https://gr.example/auth/confirm#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
      ),
    ).toEqual({
      type: null,
      hasSession: false,
      errorCode: "otp_expired",
      errorDescription: "Email link is invalid or has expired",
    });
    expect(parseAuthCallback("https://gr.example/?error=access_denied")?.errorCode).toBe(
      "access_denied",
    );
  });

  it("ignores ordinary URLs and our own token_hash links", () => {
    expect(parseAuthCallback("https://gr.example/portal")).toBeNull();
    expect(parseAuthCallback("https://gr.example/#hoe-het-werkt")).toBeNull();
    expect(
      parseAuthCallback("https://gr.example/auth/confirm?token_hash=abc&type=email"),
    ).toBeNull();
    expect(parseAuthCallback("not a url")).toBeNull();
  });
});
