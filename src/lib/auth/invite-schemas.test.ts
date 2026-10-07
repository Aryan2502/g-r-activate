import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";

import { inviteLoginSchema, invitePasswordSchema } from "./invite-schemas";

const messages = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => Object.fromEntries((result.error?.issues ?? []).map((i) => [i.path.join("."), i.message]));

describe("invitePasswordSchema() (/invite: paths a and b)", () => {
  it("a customer chooses a password of at least 8 characters and accepts the terms", () => {
    const schema = invitePasswordSchema({ kind: "customer" });
    expect(
      messages(
        schema.safeParse({
          displayName: "",
          password: "kort",
          confirm: "kort",
          acceptTerms: false,
        }),
      ),
    ).toEqual({
      password: t("auth.validation.passwordMin"),
      acceptTerms: t("auth.validation.termsRequired"),
    });
    expect(
      messages(
        schema.safeParse({
          displayName: "",
          password: "lang-genoeg",
          confirm: "anders-123",
          acceptTerms: true,
        }),
      ),
    ).toEqual({ confirm: t("auth.validation.passwordMismatch") });
    expect(
      schema.safeParse({
        displayName: "",
        password: "lang-genoeg",
        confirm: "lang-genoeg",
        acceptTerms: true,
      }).success,
    ).toBe(true);
  });

  it("a new staff member gives their name instead of accepting customer terms", () => {
    const schema = invitePasswordSchema({ kind: "staff" });
    expect(
      messages(
        schema.safeParse({
          displayName: " ",
          password: "lang-genoeg",
          confirm: "lang-genoeg",
          acceptTerms: false,
        }),
      ),
    ).toEqual({ displayName: t("invite.staffNameRequired") });
  });
});

describe("inviteLoginSchema() (/invite: path c)", () => {
  it("needs the e-mail and password of the existing login", () => {
    expect(
      messages(
        inviteLoginSchema({ kind: "staff" }).safeParse({
          email: "",
          password: "",
          acceptTerms: false,
        }),
      ),
    ).toEqual({
      email: t("auth.validation.emailRequired"),
      password: t("auth.validation.passwordRequired"),
    });
    expect(
      inviteLoginSchema({ kind: "customer" }).parse({
        email: " Maria@Example.com ",
        password: "x",
        acceptTerms: true,
      }),
    ).toEqual({ email: "maria@example.com", password: "x", acceptTerms: true });
  });
});
