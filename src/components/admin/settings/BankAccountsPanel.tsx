import { useId, useState, type FormEvent } from "react";
import { useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { AlertTriangle, CircleCheck, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Problem } from "@/components/admin/customers/CustomerActionDialogs";
import { TextField } from "@/components/admin/customers/CustomerFormFields";
import { fieldErrorsOf } from "@/components/admin/customers/form-state";
import { Callout } from "@/components/admin/Callout";
import { UnsavedBadge } from "@/components/admin/settings/unsaved";
import { useUnsavedChanges } from "@/components/admin/settings/unsaved-context";
import { LoadError, Muted } from "@/components/portal/Section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { adminKeys } from "@/lib/admin/keys";
import {
  CURRENCIES,
  activeAccountByCurrency,
  bankAccountChange,
  bankAccountSchema,
  isUnset,
  saveBankAccount,
  type BankAccount,
  type BankAccountValues,
} from "@/lib/admin/settings";
import { errorMessage } from "@/lib/errors";
import type { CurrencyCode } from "@/lib/format";
import { useT } from "@/lib/i18n";

const FIELDS = ["bankName", "accountHolder", "accountNumber"] as const;
type Field = (typeof FIELDS)[number];

/**
 * "Bankrekeningen" (SPEC §35.8): the active account per currency (USD, EUR,
 * SRD), printed under BETALINGSGEGEVENS. The seed has three empty rows;
 * while one is incomplete the dashboard and the invoice preview warn.
 */
export function BankAccountsPanel({
  userId,
  isAdmin,
  accounts,
}: {
  userId: string;
  isAdmin: boolean;
  accounts: UseQueryResult<BankAccount[]>;
}) {
  const t = useT();
  if (accounts.isError) {
    return (
      <LoadError
        title={t("admin.settings.bank.loadFailed")}
        error={accounts.error}
        onRetry={() => void accounts.refetch()}
      />
    );
  }
  if (accounts.isPending) return <Skeleton className="h-40 w-full" />;
  const active = activeAccountByCurrency(accounts.data);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {CURRENCIES.map((currency) => (
        <BankAccountCard
          key={currency}
          userId={userId}
          isAdmin={isAdmin}
          currency={currency}
          account={active.get(currency) ?? null}
        />
      ))}
    </div>
  );
}

function BankAccountCard({
  userId,
  isAdmin,
  currency,
  account,
}: {
  userId: string;
  isAdmin: boolean;
  currency: CurrencyCode;
  account: BankAccount | null;
}) {
  const t = useT();
  const complete =
    account !== null && !isUnset(account.account_number) && !isUnset(account.bank_name);
  return (
    <div className="min-w-0 space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">
          {t(`admin.settings.currencies.${currency}`)}
        </h3>
        {complete ? (
          <Badge variant="success">
            <CircleCheck className="size-3.5 shrink-0" aria-hidden />
            {t("admin.settings.bank.complete")}
          </Badge>
        ) : (
          <Badge variant="warning">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            {t("admin.settings.notSet")}
          </Badge>
        )}
      </div>
      {complete ? null : (
        <p className="text-xs text-muted-foreground">{t("admin.settings.bank.incomplete")}</p>
      )}
      {isAdmin ? (
        <BankAccountForm
          key={`${account?.id ?? currency}:${account?.bank_name ?? ""}:${account?.account_holder ?? ""}:${account?.account_number ?? ""}`}
          userId={userId}
          currency={currency}
          account={account}
        />
      ) : account ? (
        <dl className="space-y-2 text-sm">
          {(
            [
              ["admin.settings.bank.bankName", account.bank_name],
              ["admin.settings.bank.accountHolder", account.account_holder],
              ["admin.settings.bank.accountNumber", account.account_number],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-semibold text-muted-foreground">{t(label)}</dt>
              <dd className="break-words text-foreground tabular-nums">
                {value ?? <Muted>{t("admin.settings.notSet")}</Muted>}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("admin.settings.bank.noRow", { currency })}
        </p>
      )}
    </div>
  );
}

function BankAccountForm({
  userId,
  currency,
  account,
}: {
  userId: string;
  currency: CurrencyCode;
  account: BankAccount | null;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const [baseline] = useState<BankAccountValues>(() => ({
    bankName: account?.bank_name ?? "",
    accountHolder: account?.account_holder ?? "",
    accountNumber: account?.account_number ?? "",
  }));
  const [values, setValues] = useState<BankAccountValues>(baseline);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  // Emptying a complete account takes the payment details off new invoices: ask.
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const dirty = FIELDS.some((f) => values[f].trim() !== baseline[f].trim());
  useUnsavedChanges(
    `bank:${currency}`,
    { label: t("admin.settings.sections.bankrekeningen"), anchor: "bankrekeningen-title" },
    dirty,
  );

  const save = useMutation({
    mutationFn: (data: Parameters<typeof saveBankAccount>[2]) =>
      saveBankAccount(supabase, { id: account?.id ?? null, currency }, data),
    onSuccess: async () => {
      toast.success(t("admin.settings.bank.saved", { currency }));
      await queryClient.invalidateQueries({ queryKey: adminKeys.config(userId) });
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(`${t("admin.settings.bank.failed", { currency })} ${errorMessage(e)}`);
    },
  });

  const set = (field: Field, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setConfirmEmpty(false);
  };

  const submit = (e: FormEvent, confirmed = false) => {
    e.preventDefault();
    setProblem(null);
    const parsed = bankAccountSchema.safeParse(values);
    if (!parsed.success) {
      const found = fieldErrorsOf<Field>(parsed.error);
      setErrors(found);
      const first = FIELDS.find((f) => found[f]);
      if (first) document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    const change = bankAccountChange(account, parsed.data);
    if (change === "unchanged") {
      toast.info(t("admin.settings.unchanged"));
      return;
    }
    if (change === "emptied" && !confirmed) {
      setConfirmEmpty(true);
      return;
    }
    setConfirmEmpty(false);
    save.mutate(parsed.data);
  };

  return (
    <form noValidate onSubmit={submit} className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("admin.settings.bank.fieldsHint")}</p>
      <TextField
        idPrefix={id}
        field="bankName"
        label={t("admin.settings.bank.bankName")}
        value={values.bankName}
        onChange={(v) => set("bankName", v)}
        error={errors.bankName}
        autoComplete="off"
        maxLength={200}
      />
      <TextField
        idPrefix={id}
        field="accountHolder"
        label={t("admin.settings.bank.accountHolder")}
        value={values.accountHolder}
        onChange={(v) => set("accountHolder", v)}
        error={errors.accountHolder}
        optional
        autoComplete="off"
        maxLength={200}
      />
      <TextField
        idPrefix={id}
        field="accountNumber"
        label={t("admin.settings.bank.accountNumber")}
        value={values.accountNumber}
        onChange={(v) => set("accountNumber", v)}
        error={errors.accountNumber}
        autoComplete="off"
        spellCheck={false}
        maxLength={100}
      />
      <Problem prefix={t("admin.settings.bank.failed", { currency })} message={problem} />
      {confirmEmpty ? (
        <div role="alert">
          <Callout
            tone="warning"
            icon={AlertTriangle}
            title={t("admin.settings.bank.emptyTitle", { currency })}
            actions={
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={(e) => submit(e, true)}
                >
                  {t("admin.settings.bank.emptyConfirm")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmEmpty(false)}
                >
                  {t("admin.settings.bank.emptyCancel")}
                </Button>
              </>
            }
          >
            <p>{t("admin.settings.bank.emptyText", { currency })}</p>
          </Callout>
        </div>
      ) : null}
      <UnsavedBadge dirty={dirty} />
      <Button
        type="submit"
        disabled={save.isPending}
        variant={dirty ? "default" : "outline"}
        className="w-full"
      >
        {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
        {save.isPending ? t("admin.settings.saving") : t("admin.settings.bank.save", { currency })}
      </Button>
    </form>
  );
}
