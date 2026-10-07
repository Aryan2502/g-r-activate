import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

import { FieldError } from "@/components/admin/Callout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/admin/customer-actions";
import {
  customerCodeHolderQueryOptions,
  nextCustomerNumberQueryOptions,
} from "@/lib/admin/customers";
import { parseCustomerCode } from "@/lib/admin/orders";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Form building blocks of the customer dialogs ("Klant toevoegen", "Klant
 * uitnodigen", "Gegevens wijzigen"): plain controlled fields validated with
 * the zod schemas of lib/admin/customer-actions.ts on submit, every error at
 * once, focus on the first.
 */

export function OptionalMark() {
  const t = useT();
  return (
    <span className="font-normal text-muted-foreground">({t("portal.orderForm.optional")})</span>
  );
}

/** Label, input, hint and error, wired with aria-describedby. */
export function TextField({
  idPrefix,
  field,
  label,
  value,
  onChange,
  error,
  hint,
  optional = false,
  extra,
  className,
  ...input
}: {
  idPrefix: string;
  field: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: ReactNode;
  optional?: boolean;
  /** Under the hint, e.g. the live code check. */
  extra?: ReactNode;
  className?: string;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "value" | "onChange" | "className" | "aria-invalid" | "aria-describedby"
>) {
  const id = `${idPrefix}-${field}`;
  const describedBy =
    [hint ? `${id}-hint` : null, extra ? `${id}-extra` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <Label htmlFor={id} className="block leading-5">
        {label} {optional ? <OptionalMark /> : null}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 sm:h-10"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...input}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {extra ? (
        <div id={`${id}-extra`} className="text-xs leading-5" aria-live="polite">
          {extra}
        </div>
      ) : null}
      <FieldError id={`${id}-error`} message={error ?? null} />
    </div>
  );
}

/** Particulier / Zakelijk; a business account needs a company name (shown below it by the caller). */
export function AccountTypeField({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: AccountType;
  onChange: (value: AccountType) => void;
}) {
  const t = useT();
  const labelId = `${idPrefix}-accountType-label`;
  return (
    <div className="space-y-1.5">
      <Label id={labelId} className="block">
        {t("admin.customers.fields.accountType")}
      </Label>
      <RadioGroup
        id={`${idPrefix}-accountType`}
        aria-labelledby={labelId}
        value={value}
        onValueChange={(next) => {
          const type = ACCOUNT_TYPES.find((a) => a === next);
          if (type) onChange(type);
        }}
        className="grid grid-cols-2 gap-3"
      >
        {ACCOUNT_TYPES.map((type) => (
          <label
            key={type}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm sm:min-h-10",
              value === type ? "border-primary bg-cream" : "border-border",
            )}
          >
            <RadioGroupItem value={type} />
            {t(`admin.customers.accountTypes.${type}`)}
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}

/** Waits until typing pauses, so the live check does not query on every key. */
function useDebounced<T>(value: T, ms = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * The optional existing GR code with a live check (SPEC §35.5): the typed
 * code normalised ("gr 17" → GR00017) and who holds it, or the next code the
 * system would give. The database checks it again on save (also numbers given
 * up earlier, which staff cannot see).
 */
export function CustomerCodeField({
  idPrefix,
  userId,
  value,
  onChange,
  error,
  label,
  hint,
  optional = true,
  currentCustomerId,
}: {
  idPrefix: string;
  userId: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  label?: string;
  hint?: string;
  /** false for "Code wijzigen", where a new code is required. */
  optional?: boolean;
  /** "Code wijzigen": this customer's own code is not "taken". */
  currentCustomerId?: string;
}) {
  const t = useT();
  const typed = useDebounced(value.trim());
  const code = typed ? parseCustomerCode(typed) : null;
  const holder = useQuery({
    ...customerCodeHolderQueryOptions(userId, code ?? ""),
    enabled: code !== null,
  });
  const next = useQuery({ ...nextCustomerNumberQueryOptions(userId), enabled: !typed && optional });

  let extra: ReactNode = null;
  if (!typed) {
    extra =
      optional && next.data ? (
        <span className="text-muted-foreground">
          {t("admin.customers.form.codeNext", { code: next.data })}
        </span>
      ) : null;
  } else if (!code) {
    // "17abc": said while typing, not only after the submit.
    extra = error ? null : (
      <span className="inline-flex items-start gap-1.5 font-medium text-destructive">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t("admin.customers.form.codeInvalid")}
      </span>
    );
  } else {
    extra = holder.isPending ? (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        {t("admin.customers.form.codeChecking")}
      </span>
    ) : holder.isError ? (
      <span className="text-muted-foreground">{t("admin.customers.form.codeCheckFailed")}</span>
    ) : holder.data && holder.data.id === currentCustomerId ? (
      <span className="text-muted-foreground">{t("admin.customers.code.same")}</span>
    ) : holder.data ? (
      <span className="inline-flex items-start gap-1.5 font-medium text-destructive">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t("admin.customers.form.codeTaken", { code, name: holder.data.full_name })}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 font-medium text-success">
        <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
        {t("admin.customers.form.codeFree", { code })}
      </span>
    );
  }

  return (
    <TextField
      idPrefix={idPrefix}
      field="code"
      label={label ?? t("admin.customers.fields.existingCode")}
      value={value}
      onChange={onChange}
      error={error}
      optional={optional}
      hint={hint ?? t("admin.customers.form.codeHint")}
      extra={extra}
      autoComplete="off"
      spellCheck={false}
      maxLength={20}
      inputMode="text"
      className="sm:max-w-xs"
    />
  );
}
