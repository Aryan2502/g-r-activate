import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hash, Loader2, Lock, Save, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Callout } from "@/components/admin/Callout";
import { Problem } from "@/components/admin/customers/CustomerActionDialogs";
import { UnsavedBadge } from "@/components/admin/settings/unsaved";
import { useUnsavedChanges } from "@/components/admin/settings/unsaved-context";
import { TextField } from "@/components/admin/customers/CustomerFormFields";
import { DetailItem, DetailList, LoadError } from "@/components/portal/Section";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { nextCustomerNumberQueryOptions } from "@/lib/admin/customers";
import { adminKeys } from "@/lib/admin/keys";
import {
  formatInvoiceNumber,
  invoiceCounterSchema,
  nextCustomerNumberSchema,
  setInvoiceCounter,
  setNextCustomerNumber,
} from "@/lib/admin/settings";
import { invoiceCounterQueryOptions } from "@/lib/admin/settings-queries";
import { errorMessage } from "@/lib/errors";
import { todayInSuriname } from "@/lib/format";
import { useT } from "@/lib/i18n";

const asCode = (n: number) => `GR${String(n).padStart(5, "0")}`;

/**
 * "Nummering" (SPEC §35.8, §35.9, §35.5): this year's invoice counter
 * (set_invoice_counter, admins; refused once the year has an issued invoice)
 * and the next generated customer code (peek/set_next_customer_number;
 * only upwards). Both RPCs check everything again and audit the change.
 */
export function NumberingPanel({
  userId,
  isAdmin,
  prefix,
}: {
  userId: string;
  isAdmin: boolean;
  /** company_settings.invoice_number_prefix, for the preview. */
  prefix: string;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <InvoiceCounter userId={userId} isAdmin={isAdmin} prefix={prefix} />
      <NextCustomerCode userId={userId} isAdmin={isAdmin} />
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Hash;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-3 rounded-md border p-4">
      <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <Icon className="size-4 text-primary" aria-hidden />
        {title}
      </h3>
      {children}
    </div>
  );
}

function InvoiceCounter({
  userId,
  isAdmin,
  prefix,
}: {
  userId: string;
  isAdmin: boolean;
  prefix: string;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const year = Number(todayInSuriname().slice(0, 4));
  const counter = useQuery({ ...invoiceCounterQueryOptions(userId, year), enabled: isAdmin });
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = value ?? (counter.data ? String(counter.data.lastNumber) : "");
  const dirty =
    value !== null &&
    counter.data !== undefined &&
    value.trim() !== String(counter.data.lastNumber);
  const section = { label: t("admin.settings.sections.nummering"), anchor: "nummering-title" };
  useUnsavedChanges("numbering:invoice", section, dirty);

  const save = useMutation({
    mutationFn: (lastNumber: number) => setInvoiceCounter(supabase, year, lastNumber),
    onSuccess: async (lastNumber) => {
      toast.success(
        t("admin.settings.numbering.saved", {
          number: formatInvoiceNumber(prefix, year, Number(lastNumber) + 1),
        }),
      );
      setValue(null);
      await queryClient.invalidateQueries({ queryKey: adminKeys.config(userId) });
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(`${t("admin.settings.numbering.failed")} ${errorMessage(e)}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const parsed = invoiceCounterSchema.safeParse({ lastNumber: shown });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? null);
      document.getElementById(`${id}-lastNumber`)?.focus();
      return;
    }
    save.mutate(parsed.data.lastNumber);
  };

  const title = t("admin.settings.numbering.invoiceTitle", { year });
  if (!isAdmin) {
    return (
      <Panel title={title} icon={Hash}>
        <Callout tone="neutral" icon={Lock} title={t("admin.settings.numbering.adminOnly")} />
      </Panel>
    );
  }
  if (counter.isError) {
    return (
      <Panel title={title} icon={Hash}>
        <LoadError
          title={t("admin.settings.numbering.loadFailed")}
          error={counter.error}
          onRetry={() => void counter.refetch()}
        />
      </Panel>
    );
  }
  if (counter.isPending) {
    return (
      <Panel title={title} icon={Hash}>
        <Skeleton className="h-20 w-full" />
      </Panel>
    );
  }

  const next = formatInvoiceNumber(prefix, year, counter.data.lastNumber + 1);
  return (
    <Panel title={title} icon={Hash}>
      <p className="text-sm text-muted-foreground">{t("admin.settings.numbering.invoiceIntro")}</p>
      {counter.data.firstIssued ? null : (
        <p className="text-sm font-semibold text-foreground" aria-live="polite">
          {t("admin.settings.numbering.next", { number: next })}
        </p>
      )}
      {counter.data.firstIssued ? (
        <Callout
          tone="neutral"
          icon={Lock}
          title={t("admin.settings.numbering.locked", { year, number: counter.data.firstIssued })}
        />
      ) : (
        <form noValidate onSubmit={submit} className="space-y-3">
          <TextField
            idPrefix={id}
            field="lastNumber"
            label={t("admin.settings.numbering.lastNumber", { year })}
            value={shown}
            onChange={(v) => {
              setValue(v);
              setError(null);
            }}
            error={error ?? undefined}
            hint={t("admin.settings.numbering.lastNumberHint", {
              year,
              first: formatInvoiceNumber(prefix, year, 1),
            })}
            inputMode="numeric"
            autoComplete="off"
            className="sm:max-w-xs"
          />
          <Problem prefix={t("admin.settings.numbering.failed")} message={problem} />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              type="submit"
              disabled={save.isPending}
              variant={dirty ? "default" : "outline"}
              className="w-full sm:w-auto"
            >
              {save.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Save aria-hidden />
              )}
              {save.isPending ? t("admin.settings.saving") : t("admin.settings.numbering.save")}
            </Button>
            <UnsavedBadge dirty={dirty} />
          </div>
        </form>
      )}
    </Panel>
  );
}

function NextCustomerCode({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const next = useQuery(nextCustomerNumberQueryOptions(userId));
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const dirty = value.trim() !== "";
  useUnsavedChanges(
    "numbering:customer",
    { label: t("admin.settings.sections.nummering"), anchor: "nummering-title" },
    dirty,
  );

  const save = useMutation({
    mutationFn: (n: number) => setNextCustomerNumber(supabase, n),
    onSuccess: async (n) => {
      toast.success(t("admin.settings.numbering.nextSaved", { code: asCode(n) }));
      setValue("");
      await queryClient.invalidateQueries({ queryKey: adminKeys.customers(userId) });
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(`${t("admin.settings.numbering.nextFailed")} ${errorMessage(e)}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const parsed = nextCustomerNumberSchema.safeParse({ code: value });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? null);
      document.getElementById(`${id}-code`)?.focus();
      return;
    }
    save.mutate(parsed.data.code);
  };

  return (
    <Panel title={t("admin.settings.numbering.customerTitle")} icon={UserRound}>
      <p className="text-sm text-muted-foreground">{t("admin.settings.numbering.customerIntro")}</p>
      {next.isError ? (
        <LoadError
          title={t("admin.settings.numbering.nextLoadFailed")}
          error={next.error}
          onRetry={() => void next.refetch()}
        />
      ) : (
        <DetailList>
          <DetailItem label={t("admin.settings.numbering.nextCode")}>
            {next.data ? (
              <span className="font-semibold tabular-nums">{next.data}</span>
            ) : (
              <Skeleton className="h-5 w-20" />
            )}
          </DetailItem>
        </DetailList>
      )}
      {isAdmin ? (
        <form noValidate onSubmit={submit} className="space-y-3">
          <TextField
            idPrefix={id}
            field="code"
            label={t("admin.settings.numbering.nextLabel")}
            value={value}
            onChange={(v) => {
              setValue(v);
              setError(null);
            }}
            error={error ?? undefined}
            hint={t("admin.settings.numbering.nextHint")}
            autoComplete="off"
            spellCheck={false}
            maxLength={20}
            className="sm:max-w-xs"
          />
          <Problem prefix={t("admin.settings.numbering.nextFailed")} message={problem} />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              type="submit"
              disabled={save.isPending}
              variant={dirty ? "default" : "outline"}
              className="w-full sm:w-auto"
            >
              {save.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Save aria-hidden />
              )}
              {save.isPending ? t("admin.settings.saving") : t("admin.settings.numbering.nextSave")}
            </Button>
            <UnsavedBadge dirty={dirty} />
          </div>
        </form>
      ) : null}
    </Panel>
  );
}
