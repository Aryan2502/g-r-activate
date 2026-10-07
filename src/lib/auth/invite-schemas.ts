import { z } from "zod";

import { emailField, newPasswordField } from "@/lib/auth/schemas";
import { t } from "@/lib/i18n";

/**
 * The forms of /invite/$token (SPEC §35.6). A customer accepts the terms; a
 * new staff member gives the name colleagues will see ("door Maria").
 */

const terms = z.boolean().refine((accepted) => accepted, t("auth.validation.termsRequired"));
const anything = z.boolean();

/** Paths a/b: choose a password (min. 8) and confirm it. */
export function invitePasswordSchema({ kind }: { kind: "customer" | "staff" }) {
  return z
    .object({
      displayName:
        kind === "staff"
          ? z
              .string()
              .trim()
              .min(1, t("invite.staffNameRequired"))
              .max(200, t("auth.validation.tooLong", { max: 200 }))
          : z.string().trim().max(200),
      password: newPasswordField,
      confirm: z.string(),
      acceptTerms: kind === "customer" ? terms : anything,
    })
    .refine((value) => value.password === value.confirm, {
      path: ["confirm"],
      message: t("auth.validation.passwordMismatch"),
    });
}
export type InvitePasswordValues = z.input<ReturnType<typeof invitePasswordSchema>>;
export type InvitePasswordData = z.output<ReturnType<typeof invitePasswordSchema>>;

/** Path c: sign in with the existing login, then accept. */
export function inviteLoginSchema({ kind }: { kind: "customer" | "staff" }) {
  return z.object({
    email: emailField,
    password: z.string().min(1, t("auth.validation.passwordRequired")),
    acceptTerms: kind === "customer" ? terms : anything,
  });
}
export type InviteLoginValues = z.input<ReturnType<typeof inviteLoginSchema>>;
export type InviteLoginData = z.output<ReturnType<typeof inviteLoginSchema>>;
