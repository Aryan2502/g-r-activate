import { useState } from "react";
import type { ZodError } from "zod";

/**
 * Form state of the customer dialogs: controlled string values validated with
 * the zod schemas of lib/admin/customer-actions.ts on submit, every error at
 * once, focus on the first (kept apart from the field components, so those
 * files export components only).
 */

export type FieldErrors<F extends string> = Partial<Record<F, string>>;

/** The first message per field of a failed zod parse. */
export function fieldErrorsOf<F extends string>(error: ZodError): FieldErrors<F> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    if (field && !(field in errors)) errors[field] = issue.message;
  }
  return errors as FieldErrors<F>;
}

/** Controlled string values with per-field errors that clear when the field changes. */
export function useFormValues<F extends string>(initial: Record<F, string>) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors<F>>({});
  const set = (field: F, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };
  return { values, set, errors, setErrors };
}

/** Focuses the first field (in `order`) that has an error. */
export function focusFirstError<F extends string>(
  idPrefix: string,
  order: readonly F[],
  errors: FieldErrors<F>,
) {
  const first = order.find((f) => errors[f]);
  if (first) document.getElementById(`${idPrefix}-${first}`)?.focus();
}
