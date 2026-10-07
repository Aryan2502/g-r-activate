import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { t } from "@/lib/i18n";

import {
  addCustomerSchema,
  contactUpdate,
  customerContactSchema,
  customerNumberOf,
  disableLoginPlan,
  inviteCustomerInputSchema,
  inviteNewCustomerSchema,
  optionalCustomerCode,
  optionalPhone,
  setCustomerDisabledInputSchema,
} from "./customer-actions";

const issues = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => Object.fromEntries((result.error?.issues ?? []).map((i) => [i.path.join("."), i.message]));

describe("GR codes as staff type them (SPEC §35.5)", () => {
  it("normalises 'gr 17', 'GR00017' and '17'; empty means 'generate one'", () => {
    for (const typed of ["gr 17", "GR00017", " 17 ", "gr00017"]) {
      expect(optionalCustomerCode.parse(typed), typed).toBe("GR00017");
    }
    expect(optionalCustomerCode.parse("")).toBeNull();
    expect(customerNumberOf("GR00017")).toBe(17);
  });

  it("refuses anything else with the Dutch hint", () => {
    for (const typed of ["GR123456", "0", "GR", "abc", "GR-17x"]) {
      const result = optionalCustomerCode.safeParse(typed);
      expect(result.success, typed).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(t("admin.customers.form.codeInvalid"));
    }
  });
});

describe("'Klant toevoegen' (name and phone required)", () => {
  const valid = {
    accountType: "personal" as const,
    fullName: "Maria Pinas",
    phone: "889 7500",
    email: "",
    code: "",
    companyName: "",
    kkfNumber: "",
    contactPerson: "",
    address: "",
    district: "",
  };

  it("normalises the phone and empties optional fields to null", () => {
    expect(addCustomerSchema.parse(valid)).toEqual({
      ...valid,
      phone: "+5978897500",
      email: null,
      code: null,
      companyName: null,
      kkfNumber: null,
      contactPerson: null,
      address: null,
      district: null,
    });
  });

  it("shows every missing field at once, company name included for a business", () => {
    const result = addCustomerSchema.safeParse({
      ...valid,
      accountType: "business",
      fullName: " ",
      phone: "+597 ",
      email: "geen-adres",
      code: "GR1234567",
    });
    expect(issues(result)).toEqual({
      fullName: t("admin.customers.form.nameRequired"),
      phone: t("admin.customers.form.phoneRequired"),
      email: t("auth.validation.emailInvalid"),
      code: t("admin.customers.form.codeInvalid"),
      companyName: t("admin.customers.form.companyRequired"),
    });
  });
});

describe("'Klant uitnodigen' (name and e-mail; phone and code optional)", () => {
  it("lower-cases the e-mail and accepts a missing phone", () => {
    expect(
      inviteNewCustomerSchema.parse({
        accountType: "personal",
        fullName: "John Doe",
        email: " John@Example.com ",
        phone: "",
        code: "GR 17",
        companyName: "",
      }),
    ).toMatchObject({ email: "john@example.com", phone: null, code: "GR00017" });
  });

  it("requires the e-mail", () => {
    const result = inviteNewCustomerSchema.safeParse({
      accountType: "personal",
      fullName: "John Doe",
      email: "",
      phone: "",
      code: "",
      companyName: "",
    });
    expect(issues(result)).toEqual({ email: t("admin.customers.form.emailRequired") });
  });

  it("server input: an existing customer by id, or a new one with the same rules", () => {
    expect(
      inviteCustomerInputSchema.safeParse({
        mode: "existing",
        customerId: "c0c0c0c0-0000-4000-8000-000000000001",
      }).success,
    ).toBe(true);
    expect(inviteCustomerInputSchema.safeParse({ mode: "existing", customerId: "x" }).success).toBe(
      false,
    );
    expect(
      inviteCustomerInputSchema.safeParse({ mode: "new", customer: { fullName: "x" } }).success,
    ).toBe(false);
  });
});

describe("'Gegevens wijzigen'", () => {
  const values = customerContactSchema.parse({
    accountType: "personal",
    fullName: "Maria Pinas",
    phone: "",
    email: "Nieuw@Example.com",
    companyName: "Weg BV",
    kkfNumber: "",
    contactPerson: "",
    address: "Kwattaweg 1",
    district: "",
  });

  it("writes the e-mail only for admins (customers_guard), and no company for a private customer", () => {
    expect(contactUpdate(values, { includeEmail: false })).toEqual({
      full_name: "Maria Pinas",
      account_type: "personal",
      company_name: null,
      phone: null,
      kkf_number: null,
      contact_person: null,
      address: "Kwattaweg 1",
      district: null,
    });
    expect(contactUpdate(values, { includeEmail: true })).toMatchObject({
      email: "nieuw@example.com",
    });
  });

  it("writes only what changed; the same phone in another notation is no change", () => {
    expect(
      contactUpdate(
        values,
        { includeEmail: true },
        {
          full_name: "Maria Pinas",
          account_type: "personal",
          company_name: null,
          phone: null,
          kkf_number: null,
          contact_person: null,
          address: "Oud adres",
          district: null,
          email: "nieuw@example.com",
        },
      ),
    ).toEqual({ address: "Kwattaweg 1" });
    const withPhone = customerContactSchema.parse({
      accountType: "personal",
      fullName: "Maria Pinas",
      phone: "+597 889 7500",
      email: "",
      companyName: "",
      kkfNumber: "",
      contactPerson: "",
      address: "",
      district: "",
    });
    expect(
      contactUpdate(withPhone, { includeEmail: false }, { phone: "+5978897500", full_name: "x" }),
    ).toEqual({ full_name: "Maria Pinas", account_type: "personal" });
  });

  it("an optional phone still has to be a real number when filled in", () => {
    expect(optionalPhone.parse("")).toBeNull();
    expect(optionalPhone.parse("+597")).toBeNull();
    expect(optionalPhone.safeParse("12").success).toBe(false);
    expect(optionalPhone.parse("+31 6 12345678")).toBe("+31612345678");
  });
});

describe("disabling needs a reason", () => {
  it("refuses an empty or too long reason", () => {
    const base = { customerId: "c0c0c0c0-0000-4000-8000-000000000001", disabled: true };
    expect(setCustomerDisabledInputSchema.safeParse({ ...base, reason: " " }).success).toBe(false);
    expect(
      setCustomerDisabledInputSchema.safeParse({ ...base, reason: "x".repeat(501) }).success,
    ).toBe(false);
    expect(setCustomerDisabledInputSchema.parse({ ...base, reason: " Verhuisd " }).reason).toBe(
      "Verhuisd",
    );
  });
});

describe("Deactiveren: what happens to the linked login (disableLoginPlan)", () => {
  const ADMIN = "a0a0a0a0-0000-4000-8000-000000000001";
  const LOGIN = "b0b0b0b0-0000-4000-8000-000000000002";
  it("bans an ordinary customer's login, nothing without one", () => {
    expect(disableLoginPlan({ customer: { user_id: LOGIN }, teamLogin: false }, ADMIN)).toEqual({
      action: "ban",
      userId: LOGIN,
    });
    expect(disableLoginPlan({ customer: { user_id: null }, teamLogin: false }, ADMIN)).toEqual({
      action: "none",
    });
  });
  it("never touches a team login or the caller's own: /admin/team keeps its safeguards", () => {
    expect(disableLoginPlan({ customer: { user_id: LOGIN }, teamLogin: true }, ADMIN)).toEqual({
      action: "team",
    });
    expect(disableLoginPlan({ customer: { user_id: ADMIN }, teamLogin: false }, ADMIN)).toEqual({
      action: "team",
    });
  });
});
