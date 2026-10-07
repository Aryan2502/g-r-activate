import type { ReactNode } from "react";

import { FieldError } from "@/components/admin/Callout";
import { OptionalMark, TextField } from "@/components/admin/customers/CustomerFormFields";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { SettingField } from "@/lib/admin/settings";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Form controls of the settings page: plain controlled fields with label,
 * hint and inline error, wired with aria-describedby, like the customer
 * dialogs (all errors at once, focus on the first).
 */

function describedBy(id: string, hint: boolean, extra: boolean, error: boolean) {
  return (
    [hint ? `${id}-hint` : null, extra ? `${id}-extra` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined
  );
}

export function TextAreaField({
  idPrefix,
  field,
  label,
  value,
  onChange,
  error,
  hint,
  optional = false,
  rows = 4,
  maxLength,
  extra,
  className,
}: {
  idPrefix: string;
  field: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: ReactNode;
  optional?: boolean;
  rows?: number;
  maxLength?: number;
  /** Under the hint, e.g. live warnings. */
  extra?: ReactNode;
  className?: string | undefined;
}) {
  const id = `${idPrefix}-${field}`;
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <Label htmlFor={id} className="block leading-5">
        {label} {optional ? <OptionalMark /> : null}
      </Label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, Boolean(hint), Boolean(extra), Boolean(error))}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {extra ? (
        <div id={`${id}-extra`} aria-live="polite">
          {extra}
        </div>
      ) : null}
      <FieldError id={`${id}-error`} message={error ?? null} />
    </div>
  );
}

export function SelectField({
  idPrefix,
  field,
  label,
  value,
  onChange,
  options,
  error,
  hint,
  className,
}: {
  idPrefix: string;
  field: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  error?: string | undefined;
  hint?: ReactNode;
  className?: string;
}) {
  const id = `${idPrefix}-${field}`;
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <Label htmlFor={id} className="block leading-5">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          id={id}
          className="h-11 sm:h-10"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, Boolean(hint), false, Boolean(error))}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint ? (
        <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} message={error ?? null} />
    </div>
  );
}

export function SwitchField({
  idPrefix,
  field,
  label,
  checked,
  onChange,
  hint,
  className,
}: {
  idPrefix: string;
  field: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: ReactNode;
  className?: string;
}) {
  const t = useT();
  const id = `${idPrefix}-${field}`;
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 rounded-md border bg-cream/40 px-3 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <Label htmlFor={id} className="leading-5">
          {label}
        </Label>
        {hint ? (
          <p id={`${id}-hint`} className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        <span className="text-xs font-semibold text-muted-foreground" aria-hidden>
          {checked ? t("admin.settings.on") : t("admin.settings.off")}
        </span>
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={onChange}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
      </div>
    </div>
  );
}

/** One company_settings field as an input, by its kind. */
export function SettingInput({
  idPrefix,
  field,
  value,
  onChange,
  error,
  extra,
}: {
  idPrefix: string;
  field: SettingField;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  extra?: ReactNode;
}) {
  const t = useT();
  const label = field.unit ? `${t(field.label)} (${t(field.unit)})` : t(field.label);
  const hint = field.hint ? t(field.hint) : undefined;
  const optional = !field.schema.safeParse("").success ? false : field.kind !== "switch";
  switch (field.kind) {
    case "switch":
      return (
        <SwitchField
          idPrefix={idPrefix}
          field={field.key}
          label={label}
          checked={value === "true"}
          onChange={(on) => onChange(on ? "true" : "false")}
          hint={hint}
        />
      );
    case "select":
      return (
        <SelectField
          idPrefix={idPrefix}
          field={field.key}
          label={label}
          value={value}
          onChange={onChange}
          options={(field.options ?? []).map((o) => ({ value: o.value, label: t(o.label) }))}
          error={error}
          hint={hint}
          className="sm:max-w-sm"
        />
      );
    case "textarea":
    case "markdown":
      return (
        <TextAreaField
          idPrefix={idPrefix}
          field={field.key}
          label={label}
          value={value}
          onChange={onChange}
          error={error}
          hint={hint}
          optional={optional}
          rows={field.kind === "markdown" ? 10 : 3}
          extra={extra}
          className={field.kind === "markdown" ? "md:col-span-2" : undefined}
        />
      );
    case "integer":
    case "decimal":
      return (
        <TextField
          idPrefix={idPrefix}
          field={field.key}
          label={label}
          value={value}
          onChange={onChange}
          error={error}
          hint={hint}
          optional={optional}
          extra={extra}
          inputMode={field.kind === "integer" ? "numeric" : "decimal"}
          autoComplete="off"
          className="sm:max-w-xs"
        />
      );
    default:
      return (
        <TextField
          idPrefix={idPrefix}
          field={field.key}
          label={label}
          value={value}
          onChange={onChange}
          error={error}
          hint={hint}
          optional={optional}
          extra={extra}
          type={field.kind === "email" ? "email" : "text"}
          inputMode={field.kind === "email" ? "email" : undefined}
          autoComplete="off"
        />
      );
  }
}
