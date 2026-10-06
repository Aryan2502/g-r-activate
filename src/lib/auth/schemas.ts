import { z } from "zod";

import { t } from "@/lib/i18n";
import { phoneDigits } from "@/lib/phone";

// Limits mirror the customers table checks (SPEC §35.5) and GoTrue's bcrypt cap.
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;
export const PHONE_PREFIX = "+597 ";

const tooLong = (max: number) => t("auth.validation.tooLong", { max });

export const emailField = z
  .string()
  .trim()
  .min(1, t("auth.validation.emailRequired"))
  .pipe(z.string().max(320, tooLong(320)).email(t("auth.validation.emailInvalid")))
  .transform((value) => value.toLowerCase());

export const newPasswordField = z
  .string()
  .min(PASSWORD_MIN, t("auth.validation.passwordMin"))
  .max(PASSWORD_MAX, t("auth.validation.passwordMax"));

/** Required phone/WhatsApp number; local Surinamese numbers get +597. Output: "+5978897500". */
export const phoneField = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (value.replace(/\D/g, "").replace(/^597/, "") === "") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: t("auth.validation.phoneRequired") });
    } else if (!phoneDigits(value) || value.length > 50) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: t("auth.validation.phoneInvalid") });
    }
  })
  .transform((value) => `+${phoneDigits(value) ?? ""}`);

const optionalText = (max: number) => z.string().trim().max(max, tooLong(max));

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, t("auth.validation.passwordRequired")),
});

// Every rule is field-level so all errors show on the first submit; an
// object-level refinement would be skipped while another field fails.
const signupFields = {
  fullName: z.string().trim().min(1, t("auth.validation.fullNameRequired")).max(200, tooLong(200)),
  phone: phoneField,
  email: emailField,
  password: newPasswordField,
  acceptTerms: z.boolean().refine((accepted) => accepted, t("auth.validation.termsRequired")),
};

export const signupSchema = z.discriminatedUnion("accountType", [
  z.object({
    ...signupFields,
    accountType: z.literal("personal"),
    companyName: optionalText(200),
  }),
  z.object({
    ...signupFields,
    accountType: z.literal("business"),
    companyName: optionalText(200).min(1, t("auth.validation.companyRequired")),
  }),
]);

export const forgotPasswordSchema = z.object({ email: emailField });

export const setPasswordSchema = z
  .object({ password: newPasswordField, confirm: z.string() })
  .refine((value) => value.password === value.confirm, {
    path: ["confirm"],
    message: t("auth.validation.passwordMismatch"),
  });

/** What update_my_contact accepts (SPEC §35.5); empty strings clear a field. */
export const contactSchema = z.object({
  phone: phoneField,
  address: optionalText(500),
  district: optionalText(100),
  contactPerson: optionalText(200),
});

export type LoginValues = z.input<typeof loginSchema>;
export type SignupValues = z.input<typeof signupSchema>;
export type SignupData = z.output<typeof signupSchema>;
export type ForgotPasswordValues = z.input<typeof forgotPasswordSchema>;
export type SetPasswordValues = z.input<typeof setPasswordSchema>;
export type ContactValues = z.input<typeof contactSchema>;
export type ContactData = z.output<typeof contactSchema>;

/** raw_user_meta_data for signUp: display fields only (SPEC §35.6). */
export function signupMetadata(data: SignupData, termsVersion: string) {
  return {
    full_name: data.fullName,
    phone: data.phone,
    account_type: data.accountType,
    company_name: data.accountType === "business" ? data.companyName : null,
    terms_version: termsVersion,
  };
}
