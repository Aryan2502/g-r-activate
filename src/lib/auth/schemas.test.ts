import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";

import {
  contactSchema,
  loginSchema,
  setPasswordSchema,
  signupMetadata,
  signupSchema,
} from "./schemas";

const validSignup = {
  fullName: "  Maria  Jansen ",
  phone: "+597 889 7500",
  email: " Maria@Example.COM ",
  password: "geheim123",
  accountType: "personal" as const,
  companyName: "",
  acceptTerms: true,
};

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.error?.issues.map((i) => i.message) ?? [];
}

describe("signupSchema", () => {
  it("normalises a valid sign-up", () => {
    const data = signupSchema.parse(validSignup);
    expect(data.fullName).toBe("Maria  Jansen");
    expect(data.email).toBe("maria@example.com");
    expect(data.phone).toBe("+5978897500");
  });

  it("adds +597 to a local number", () => {
    expect(signupSchema.parse({ ...validSignup, phone: "889 7500" }).phone).toBe("+5978897500");
  });

  it("requires a phone number beyond the prefilled +597", () => {
    expect(messages(signupSchema.safeParse({ ...validSignup, phone: "+597 " }))).toContain(
      t("auth.validation.phoneRequired"),
    );
    for (const phone of ["+597 12", "+597 123", "+597 1234", "+597 889"]) {
      expect(messages(signupSchema.safeParse({ ...validSignup, phone }))).toContain(
        t("auth.validation.phoneInvalid"),
      );
    }
  });

  it("reports every error on the first submit, terms and company name included", () => {
    const result = signupSchema.safeParse({
      fullName: "",
      phone: "+597 ",
      email: "",
      password: "",
      accountType: "business",
      companyName: "",
      acceptTerms: false,
    });
    expect(result.error?.issues.map((i) => i.path.join("."))).toEqual([
      "fullName",
      "phone",
      "email",
      "password",
      "acceptTerms",
      "companyName",
    ]);
  });

  it("requires 8+ character passwords and accepted terms", () => {
    expect(messages(signupSchema.safeParse({ ...validSignup, password: "kort" }))).toContain(
      t("auth.validation.passwordMin"),
    );
    expect(messages(signupSchema.safeParse({ ...validSignup, acceptTerms: false }))).toContain(
      t("auth.validation.termsRequired"),
    );
  });

  it("requires a company name for business accounts only", () => {
    expect(
      messages(
        signupSchema.safeParse({ ...validSignup, accountType: "business", companyName: " " }),
      ),
    ).toContain(t("auth.validation.companyRequired"));
    expect(
      signupSchema.safeParse({
        ...validSignup,
        accountType: "business",
        companyName: "Jansen N.V.",
      }).success,
    ).toBe(true);
  });

  it("puts only display fields in the user metadata (SPEC §35.6)", () => {
    const personal = signupSchema.parse({ ...validSignup, companyName: "ignored" });
    expect(signupMetadata(personal, "3")).toEqual({
      full_name: "Maria  Jansen",
      phone: "+5978897500",
      account_type: "personal",
      company_name: null,
      terms_version: "3",
    });
    const business = signupSchema.parse({
      ...validSignup,
      accountType: "business",
      companyName: "Jansen N.V.",
    });
    expect(signupMetadata(business, "3")).toMatchObject({
      account_type: "business",
      company_name: "Jansen N.V.",
    });
  });
});

describe("other auth forms", () => {
  it("login needs an email and a password", () => {
    expect(messages(loginSchema.safeParse({ email: "", password: "" }))).toEqual([
      t("auth.validation.emailRequired"),
      t("auth.validation.passwordRequired"),
    ]);
    expect(messages(loginSchema.safeParse({ email: "geen-adres", password: "x" }))).toEqual([
      t("auth.validation.emailInvalid"),
    ]);
  });

  it("set-password needs matching passwords of 8 to 72 characters", () => {
    expect(
      setPasswordSchema.safeParse({ password: "geheim123", confirm: "geheim123" }).success,
    ).toBe(true);
    expect(
      messages(setPasswordSchema.safeParse({ password: "geheim123", confirm: "geheim124" })),
    ).toEqual([t("auth.validation.passwordMismatch")]);
    expect(
      messages(setPasswordSchema.safeParse({ password: "a".repeat(73), confirm: "a".repeat(73) })),
    ).toContain(t("auth.validation.passwordMax"));
  });

  it("contact details keep empty strings, which update_my_contact reads as 'clear'", () => {
    expect(
      contactSchema.parse({
        phone: "8897500",
        address: " ",
        district: "Wanica",
        contactPerson: "",
      }),
    ).toEqual({ phone: "+5978897500", address: "", district: "Wanica", contactPerson: "" });
    expect(
      messages(
        contactSchema.safeParse({ phone: "", address: "", district: "", contactPerson: "" }),
      ),
    ).toContain(t("auth.validation.phoneRequired"));
  });
});
