import { useId, useState, type FormEvent } from "react";
import { useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Problem } from "@/components/admin/customers/CustomerActionDialogs";
import { TextField } from "@/components/admin/customers/CustomerFormFields";
import { fieldErrorsOf } from "@/components/admin/customers/form-state";
import { SelectField, SwitchField } from "@/components/admin/settings/SettingFields";
import { UnsavedBadge } from "@/components/admin/settings/unsaved";
import { useUnsavedChanges } from "@/components/admin/settings/unsaved-context";
import { DetailItem, DetailList, LoadError, Muted } from "@/components/portal/Section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { adminKeys } from "@/lib/admin/keys";
import {
  CURRENCIES,
  ROUNDING_KEYS,
  WEIGHT_ROUNDINGS,
  billableWeight,
  parseDecimalInput,
  saveServiceRate,
  serviceRateInputValues,
  serviceRateSchema,
  type ServiceRate,
  type ServiceRateValues,
} from "@/lib/admin/settings";
import { errorMessage } from "@/lib/errors";
import { formatLbs, formatMoney, roundHalfUp } from "@/lib/format";
import { useT } from "@/lib/i18n";

const FIELDS = ["enabled", "ratePerLb", "currency", "minimumLbs", "rounding"] as const;
type Field = (typeof FIELDS)[number];

/** The example parcel of the live preview. */
const EXAMPLE_LBS = 2.3;

/**
 * "Tarieven" (SPEC §35.8): per service type whether customers may choose it,
 * the rate per lb, its currency, a minimum and the rounding step (always
 * up), with a live example of what a 2,3 lbs parcel costs.
 */
export function RatesPanel({
  userId,
  isAdmin,
  rates,
}: {
  userId: string;
  isAdmin: boolean;
  rates: UseQueryResult<ServiceRate[]>;
}) {
  const t = useT();
  if (rates.isError) {
    return (
      <LoadError
        title={t("admin.settings.rates.loadFailed")}
        error={rates.error}
        onRetry={() => void rates.refetch()}
      />
    );
  }
  if (rates.isPending) return <Skeleton className="h-40 w-full" />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {rates.data.map((rate) => (
        <div key={rate.service_type} className="min-w-0 space-y-3 rounded-md border p-4">
          <h3 className="text-base font-semibold text-foreground">
            {t(`portal.serviceTypes.${rate.service_type}`)}
          </h3>
          {isAdmin ? (
            <RateForm
              key={JSON.stringify(serviceRateInputValues(rate))}
              userId={userId}
              rate={rate}
            />
          ) : (
            <RateValues rate={rate} />
          )}
        </div>
      ))}
    </div>
  );
}

function Example({ values }: { values: ServiceRateValues }) {
  const t = useT();
  const minimum = parseDecimalInput(values.minimumLbs);
  const rate = parseDecimalInput(values.ratePerLb);
  const rounding = WEIGHT_ROUNDINGS.find((r) => r === values.rounding) ?? "none";
  const currency = CURRENCIES.find((c) => c === values.currency) ?? "USD";
  const billable = billableWeight(EXAMPLE_LBS, rounding, minimum);
  return (
    <p className="text-sm text-muted-foreground" aria-live="polite">
      {rate === null
        ? t("admin.settings.rates.exampleNoRate", {
            weight: formatLbs(EXAMPLE_LBS),
            billable: formatLbs(billable),
          })
        : t("admin.settings.rates.example", {
            weight: formatLbs(EXAMPLE_LBS),
            billable: formatLbs(billable),
            rate: formatMoney(rate, currency),
            amount: formatMoney(roundHalfUp(billable * rate, 2), currency),
          })}
    </p>
  );
}

function RateValues({ rate }: { rate: ServiceRate }) {
  const t = useT();
  const values = serviceRateInputValues(rate);
  return (
    <>
      <DetailList>
        <DetailItem label={t("admin.settings.rates.enabled")}>
          {rate.enabled ? t("admin.settings.on") : t("admin.settings.off")}
        </DetailItem>
        <DetailItem label={t("admin.settings.rates.ratePerLb")}>
          {rate.rate_per_lb === null ? (
            <Muted>{t("admin.settings.notSet")}</Muted>
          ) : (
            <span className="tabular-nums">{formatMoney(rate.rate_per_lb, rate.currency)}</span>
          )}
        </DetailItem>
        <DetailItem label={t("admin.settings.rates.minimum")}>
          {rate.minimum_billable_lbs === null ? (
            <Muted>{t("admin.settings.notSet")}</Muted>
          ) : (
            <span className="tabular-nums">{formatLbs(rate.minimum_billable_lbs)}</span>
          )}
        </DetailItem>
        <DetailItem label={t("admin.settings.rates.rounding")}>
          {t(`admin.settings.rates.roundings.${ROUNDING_KEYS[rate.weight_rounding]}`)}
        </DetailItem>
      </DetailList>
      <Example values={values} />
    </>
  );
}

function RateForm({ userId, rate }: { userId: string; rate: ServiceRate }) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const [baseline, setBaseline] = useState<ServiceRateValues>(() => serviceRateInputValues(rate));
  const [values, setValues] = useState<ServiceRateValues>(baseline);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const service = t(`portal.serviceTypes.${rate.service_type}`);
  const dirty = FIELDS.some((f) => values[f] !== baseline[f]);
  useUnsavedChanges(
    `rate:${rate.service_type}`,
    { label: t("admin.settings.sections.tarieven"), anchor: "tarieven-title" },
    dirty,
  );

  const save = useMutation({
    mutationFn: (data: Parameters<typeof saveServiceRate>[2]) =>
      saveServiceRate(supabase, rate.service_type, data),
    onSuccess: async () => {
      setBaseline(values);
      toast.success(t("admin.settings.rates.saved", { service }));
      await queryClient.invalidateQueries({ queryKey: adminKeys.config(userId) });
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(`${t("admin.settings.rates.failed", { service })} ${errorMessage(e)}`);
    },
  });

  const set = <F extends Field>(field: F, value: ServiceRateValues[F]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const parsed = serviceRateSchema.safeParse(values);
    if (!parsed.success) {
      const found = fieldErrorsOf<Field>(parsed.error);
      setErrors(found);
      const first = FIELDS.find((f) => found[f]);
      if (first) document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    save.mutate(parsed.data);
  };

  const enabled = values.enabled === "true";
  return (
    <form noValidate onSubmit={submit} className="space-y-3">
      <SwitchField
        idPrefix={id}
        field="enabled"
        label={t("admin.settings.rates.enabled")}
        checked={enabled}
        onChange={(on) => set("enabled", on ? "true" : "false")}
        hint={t("admin.settings.rates.enabledHint")}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          idPrefix={id}
          field="ratePerLb"
          label={t("admin.settings.rates.ratePerLb")}
          value={values.ratePerLb}
          onChange={(v) => set("ratePerLb", v)}
          error={errors.ratePerLb}
          optional
          inputMode="decimal"
          autoComplete="off"
        />
        <SelectField
          idPrefix={id}
          field="currency"
          label={t("admin.settings.rates.currency")}
          value={values.currency}
          onChange={(v) => {
            const currency = CURRENCIES.find((c) => c === v);
            if (currency) set("currency", currency);
          }}
          options={CURRENCIES.map((c) => ({
            value: c,
            label: t(`admin.settings.currencies.${c}`),
          }))}
          error={errors.currency}
        />
        <TextField
          idPrefix={id}
          field="minimumLbs"
          label={t("admin.settings.rates.minimum")}
          value={values.minimumLbs}
          onChange={(v) => set("minimumLbs", v)}
          error={errors.minimumLbs}
          hint={t("admin.settings.rates.minimumHint")}
          optional
          inputMode="decimal"
          autoComplete="off"
        />
        <SelectField
          idPrefix={id}
          field="rounding"
          label={t("admin.settings.rates.rounding")}
          value={values.rounding}
          onChange={(v) => {
            const rounding = WEIGHT_ROUNDINGS.find((r) => r === v);
            if (rounding) set("rounding", rounding);
          }}
          options={WEIGHT_ROUNDINGS.map((r) => ({
            value: r,
            label: t(`admin.settings.rates.roundings.${ROUNDING_KEYS[r]}`),
          }))}
          error={errors.rounding}
        />
      </div>
      <Example values={values} />
      {enabled && parseDecimalInput(values.ratePerLb) === null ? (
        <p className="flex items-start gap-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("admin.settings.rates.noRate")}
        </p>
      ) : null}
      <Problem prefix={t("admin.settings.rates.failed", { service })} message={problem} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          type="submit"
          disabled={save.isPending}
          variant={dirty ? "default" : "outline"}
          className="w-full sm:w-auto"
        >
          {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          {save.isPending
            ? t("admin.settings.saving")
            : t("admin.settings.rates.save", { service })}
        </Button>
        <UnsavedBadge dirty={dirty} />
      </div>
    </form>
  );
}
