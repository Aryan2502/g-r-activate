import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Problem } from "@/components/admin/customers/CustomerActionDialogs";
import { SettingInput } from "@/components/admin/settings/SettingFields";
import { UnsavedBadge } from "@/components/admin/settings/unsaved";
import { useUnsavedChanges } from "@/components/admin/settings/unsaved-context";
import { DetailItem, DetailList, Muted, Section } from "@/components/portal/Section";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { adminKeys } from "@/lib/admin/keys";
import {
  formatInvoiceNumber,
  isUnset,
  parseDecimalInput,
  parseSection,
  paymentTermsWarnings,
  saveCompanySettings,
  sectionInputValues,
  type CompanySettings,
  type SettingField,
  type SettingKey,
  type SettingsSection,
} from "@/lib/admin/settings";
import { errorMessage } from "@/lib/errors";
import { formatNumber, todayInSuriname } from "@/lib/format";
import { useT } from "@/lib/i18n";

/**
 * One section of company_settings on /admin/instellingen. Admins edit it
 * (only the changed columns are written; RLS: admins only; the audit trigger
 * records them); staff see the values, "Nog niet ingesteld" where empty.
 */
export function CompanySettingsSection({
  userId,
  section,
  settings,
  editable,
  icon,
  children,
}: {
  userId: string;
  section: SettingsSection;
  settings: CompanySettings;
  editable: boolean;
  icon: NonNullable<Parameters<typeof Section>[0]["icon"]>;
  /** Extra content under the fields (e.g. the numbering forms). */
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <Section
      id={section.id}
      title={t(section.title)}
      icon={icon}
      {...(section.intro ? { description: t(section.intro) } : {})}
      className="scroll-mt-24"
    >
      {editable ? (
        <SectionForm
          // Reset only when this section's own values change in the database,
          // so saving another section keeps unsaved edits here.
          key={JSON.stringify(sectionInputValues(section, settings))}
          userId={userId}
          section={section}
          settings={settings}
        />
      ) : (
        <SectionValues section={section} settings={settings} />
      )}
      {children}
    </Section>
  );
}

function SectionForm({
  userId,
  section,
  settings,
}: {
  userId: string;
  section: SettingsSection;
  settings: CompanySettings;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  // What the database holds now (the form remounts when that changes).
  const [baseline, setBaseline] = useState(() => sectionInputValues(section, settings));
  const [values, setValues] = useState(baseline);
  const [errors, setErrors] = useState<Partial<Record<SettingKey, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const title = t(section.title);
  const dirty = section.fields.some((f) => (values[f.key] ?? "") !== (baseline[f.key] ?? ""));
  useUnsavedChanges(
    `section:${section.id}`,
    { label: title, anchor: `${section.id}-title` },
    dirty,
  );

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof saveCompanySettings>[1]) =>
      saveCompanySettings(supabase, patch, settings),
    onSuccess: async (saved) => {
      if (!saved) {
        // Only the notation differed ("14 " for 14): nothing left to save.
        setBaseline(values);
        toast.info(t("admin.settings.unchanged"));
        return;
      }
      toast.success(t("admin.settings.saved", { section: title }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.config(userId) }),
        queryClient.invalidateQueries({ queryKey: adminKeys.settings(userId) }),
      ]);
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(`${t("admin.settings.failed", { section: title })} ${errorMessage(e)}`);
    },
  });

  const set = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const parsed = parseSection(section, values);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      const first = section.fields.find((f) => parsed.errors[f.key]);
      if (first) document.getElementById(`${id}-${first.key}`)?.focus();
      return;
    }
    save.mutate(parsed.values);
  };

  return (
    <form noValidate onSubmit={submit} className="min-w-0 space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {section.fields.map((field) => (
          <div
            key={field.key}
            className={
              field.kind === "markdown" || field.kind === "switch" ? "md:col-span-2" : undefined
            }
          >
            <SettingInput
              idPrefix={id}
              field={field}
              value={values[field.key] ?? ""}
              onChange={(v) => set(field.key, v)}
              error={errors[field.key]}
              extra={fieldExtra(field, values)}
            />
          </div>
        ))}
      </div>
      <Problem prefix={t("admin.settings.failed", { section: title })} message={problem} />
      <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-end">
        <UnsavedBadge dirty={dirty} />
        <Button
          type="submit"
          disabled={save.isPending}
          variant={dirty ? "default" : "outline"}
          className="w-full sm:w-auto"
        >
          {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          {save.isPending ? t("admin.settings.saving") : t("admin.settings.save")}
          <span className="sr-only">: {title}</span>
        </Button>
      </div>
    </form>
  );
}

/** Live help under a field: the terms text check and the invoice number example. */
function fieldExtra(field: SettingField, values: Record<string, string>): ReactNode {
  if (field.key === "payment_terms_text") {
    const days = /^\d+$/.test(values["payment_term_days"]?.trim() ?? "")
      ? Number(values["payment_term_days"])
      : null;
    const percent = parseDecimalInput(values["late_fee_percent"] ?? "");
    const warnings = paymentTermsWarnings(values["payment_terms_text"] ?? "", days, percent);
    return warnings.length > 0 ? <TermsWarnings warnings={warnings} /> : null;
  }
  if (field.key === "invoice_number_prefix") {
    return <InvoiceNumberExample prefix={values["invoice_number_prefix"] ?? ""} />;
  }
  return null;
}

function TermsWarnings({ warnings }: { warnings: string[] }) {
  const t = useT();
  return (
    <div className="space-y-1 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-foreground">
      {warnings.map((w) => (
        <p key={w} className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          {w}
        </p>
      ))}
      <p className="text-xs text-muted-foreground">{t("admin.settings.invoice.termsCheck")}</p>
    </div>
  );
}

function InvoiceNumberExample({ prefix }: { prefix: string }) {
  const t = useT();
  const year = Number(todayInSuriname().slice(0, 4));
  return (
    <span className="text-xs text-muted-foreground">
      {t("admin.settings.invoice.example", {
        number: formatInvoiceNumber(prefix.trim(), year, 1),
      })}
    </span>
  );
}

/** What staff see: the values, "Nog niet ingesteld" where empty. */
function SectionValues({
  section,
  settings,
}: {
  section: SettingsSection;
  settings: CompanySettings;
}) {
  const t = useT();
  return (
    <DetailList>
      {section.fields.map((field) => (
        <DetailItem key={field.key} label={t(field.label)}>
          <SettingValue field={field} value={settings[field.key]} />
        </DetailItem>
      ))}
    </DetailList>
  );
}

function SettingValue({ field, value }: { field: SettingField; value: unknown }) {
  const t = useT();
  if (field.kind === "switch")
    return <>{value ? t("admin.settings.on") : t("admin.settings.off")}</>;
  if (isUnset(value)) return <Muted>{t("admin.settings.notSet")}</Muted>;
  if (field.kind === "select") {
    const option = field.options?.find((o) => o.value === value);
    return <>{option ? t(option.label) : String(value)}</>;
  }
  if (field.kind === "integer" || field.kind === "decimal") {
    const n = Number(value);
    const text = formatNumber(n, Number.isInteger(n) ? 0 : 2);
    return <span className="tabular-nums">{field.unit ? `${text} ${t(field.unit)}` : text}</span>;
  }
  if (field.kind === "markdown" || field.kind === "textarea") {
    return <span className="block whitespace-pre-wrap break-words">{String(value)}</span>;
  }
  return <>{String(value)}</>;
}
