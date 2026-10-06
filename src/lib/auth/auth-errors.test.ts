import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";

import {
  addressIndependentFailure,
  authErrorMessage,
  classifyAuthError,
  isEmailSendLimit,
} from "./auth-errors";

describe("classifyAuthError()", () => {
  it("uses the Auth error code", () => {
    expect(classifyAuthError({ code: "invalid_credentials", status: 400 })).toBe(
      "invalid_credentials",
    );
    expect(classifyAuthError({ code: "email_not_confirmed", status: 400 })).toBe(
      "email_not_confirmed",
    );
    expect(classifyAuthError({ code: "user_banned", status: 400 })).toBe("banned");
    expect(classifyAuthError({ code: "otp_expired", status: 403 })).toBe("link_invalid");
    expect(classifyAuthError({ code: "over_email_send_rate_limit", status: 429 })).toBe(
      "rate_limited",
    );
    expect(classifyAuthError({ code: "same_password", status: 422 })).toBe("same_password");
    expect(classifyAuthError({ code: "weak_password", status: 422 })).toBe("weak_password");
  });

  it("falls back to the messages of older Auth servers", () => {
    expect(classifyAuthError({ message: "Email not confirmed", status: 400 })).toBe(
      "email_not_confirmed",
    );
    expect(classifyAuthError({ message: "User is banned", status: 400 })).toBe("banned");
    expect(classifyAuthError({ message: "Invalid login credentials", status: 400 })).toBe(
      "invalid_credentials",
    );
    expect(classifyAuthError({ message: "Token has expired or is invalid", status: 403 })).toBe(
      "link_invalid",
    );
  });

  it("recognises network and session errors", () => {
    expect(classifyAuthError({ name: "AuthRetryableFetchError", status: 0, message: "x" })).toBe(
      "network",
    );
    expect(
      classifyAuthError({ name: "AuthSessionMissingError", message: "Auth session missing!" }),
    ).toBe("session_missing");
    expect(classifyAuthError({ status: 429, message: "x" })).toBe("rate_limited");
  });

  it("accepts a bare error_code from a redirect URL", () => {
    expect(classifyAuthError("otp_expired")).toBe("link_invalid");
    expect(classifyAuthError("nope")).toBe("unknown");
    expect(classifyAuthError(null)).toBe("unknown");
  });
});

describe("addressIndependentFailure()", () => {
  const perAddress = {
    status: 429,
    code: "over_email_send_rate_limit",
    message: "For security purposes, you can only request this after 42 seconds.",
  };

  it("hides the mail-sending limits that only exist for known addresses (SPEC §35.6)", () => {
    expect(isEmailSendLimit(perAddress)).toBe(true);
    expect(isEmailSendLimit({ status: 429, message: "email rate limit exceeded" })).toBe(true);
    expect(addressIndependentFailure(perAddress)).toBe(false);
    expect(
      addressIndependentFailure({ status: 429, message: "only request this after 10 seconds" }),
    ).toBe(false);
    expect(addressIndependentFailure({ status: 500, code: "unexpected_failure" })).toBe(false);
    expect(addressIndependentFailure(null)).toBe(false);
  });

  it("shows network errors and the per-IP request limit", () => {
    expect(addressIndependentFailure({ name: "AuthRetryableFetchError", status: 0 })).toBe(true);
    expect(addressIndependentFailure({ status: 429, code: "over_request_rate_limit" })).toBe(true);
    expect(isEmailSendLimit({ status: 429, code: "over_request_rate_limit" })).toBe(false);
  });
});

describe("authErrorMessage()", () => {
  it("blames the mail setup, not the address, for email_address_not_authorized", () => {
    expect(authErrorMessage({ code: "email_address_not_authorized", status: 400 })).toBe(
      t("auth.errors.emailNotAuthorized"),
    );
  });

  it("has the SPEC §35.5 wording for a disabled (banned) account", () => {
    expect(authErrorMessage({ code: "user_banned" })).toBe(
      "Uw account is gedeactiveerd. Neem contact op met G&R Solutions.",
    );
  });

  it("is Dutch for every outcome", () => {
    expect(authErrorMessage({ code: "invalid_credentials" })).toBe(
      t("auth.errors.invalidCredentials"),
    );
    expect(authErrorMessage({ code: "email_not_confirmed" })).toBe(
      t("auth.errors.emailNotConfirmed"),
    );
    expect(authErrorMessage({ name: "AuthRetryableFetchError", status: 0 })).toBe(
      t("toast.networkError"),
    );
    expect(authErrorMessage(new Error("?"))).toBe(t("toast.genericError"));
  });
});
