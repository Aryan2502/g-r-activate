import { useId, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, CircleCheck, KeyRound, Loader2, RefreshCcw } from "lucide-react";
import { toast } from "sonner";

import { FieldError } from "@/components/admin/Callout";
import { CustomerCodeField } from "@/components/admin/customers/CustomerFormFields";
import { ShareLinkPanel } from "@/components/admin/customers/ShareLinkPanel";
import { useLinkGuard } from "@/components/admin/customers/link-guard";
import { UnsharedLinkPrompt } from "@/components/admin/customers/one-time-link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { changeCustomerCode, optionalCustomerCode, reasonText } from "@/lib/admin/customer-actions";
import type { CustomerRow } from "@/lib/admin/customers";
import { recoveryShareText } from "@/lib/admin/invitations";
import { adminKeys } from "@/lib/admin/keys";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import {
  submitRecoveryLink,
  submitSetCustomerDisabled,
  type RecoveryLinkResponse,
} from "@/lib/server-fns/customers.functions";

export function Problem({ prefix, message }: { prefix: string; message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {prefix} {message}
      </span>
    </p>
  );
}

/** A required reason (textarea), with its error under it. */
export function ReasonField({
  id,
  label,
  hint,
  placeholder,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  hint: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={520}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
      />
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </p>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Code wijzigen" (admin, SPEC §35.5)
// ---------------------------------------------------------------------------

/**
 * change_customer_code with the admin's own client: a required reason (in the
 * audit log), only while the customer has no orders or issued invoices; the
 * old number is retired, never given to anyone else.
 */
export function ChangeCodeDialog({
  userId,
  customer,
  locked,
  initialCode,
  open,
  onOpenChange,
}: {
  userId: string;
  customer: CustomerRow;
  /** Orders or issued invoices exist: the code is frozen (the database says so too). */
  locked: boolean;
  /** Prefilled from an invitation conflict ("Code wijzigen naar GR00017"). */
  initialCode?: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const [code, setCode] = useState(initialCode ?? "");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ code?: string | undefined; reason?: string | undefined }>(
    {},
  );
  const [problem, setProblem] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: (input: { code: string; reason: string }) =>
      changeCustomerCode(supabase, { customerId: customer.id, ...input }),
    onSuccess: async (saved) => {
      toast.success(
        t("admin.customers.code.success", {
          from: customer.customer_code,
          to: saved.customer_code,
        }),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.customers(userId) }),
        queryClient.invalidateQueries({ queryKey: adminKeys.orders(userId) }),
      ]);
      onOpenChange(false);
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(errorMessage(e));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const parsedCode = optionalCustomerCode.safeParse(code);
    const parsedReason = reasonText.safeParse(reason);
    const next: typeof errors = {};
    if (!parsedCode.success) next.code = parsedCode.error.issues[0]?.message;
    else if (!parsedCode.data) next.code = t("admin.customers.form.codeInvalid");
    else if (parsedCode.data === customer.customer_code) next.code = t("admin.customers.code.same");
    if (!parsedReason.success) next.reason = parsedReason.error.issues[0]?.message;
    setErrors(next);
    if (next.code || next.reason) {
      document.getElementById(next.code ? `${id}-code` : `${id}-reason`)?.focus();
      return;
    }
    if (parsedCode.success && parsedCode.data && parsedReason.success) {
      change.mutate({ code: parsedCode.data, reason: parsedReason.data });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !change.isPending && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {t("admin.customers.code.title", { name: customer.full_name })}
          </DialogTitle>
          <DialogDescription>
            {t("admin.customers.code.intro", { code: customer.customer_code })}
          </DialogDescription>
        </DialogHeader>
        {locked ? (
          <>
            <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              {t("admin.customers.code.locked")}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("admin.customers.code.cancel")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form noValidate onSubmit={submit} className="min-w-0 space-y-4">
            <CustomerCodeField
              idPrefix={id}
              userId={userId}
              label={t("admin.customers.code.newCode")}
              hint={t("admin.customers.code.newCodeHint")}
              optional={false}
              currentCustomerId={customer.id}
              value={code}
              onChange={(v) => {
                setCode(v);
                setErrors((prev) => ({ ...prev, code: undefined }));
              }}
              error={errors.code}
            />
            <ReasonField
              id={`${id}-reason`}
              label={t("admin.customers.code.reason")}
              hint={t("admin.customers.code.reasonHint")}
              placeholder={t("admin.customers.code.reasonPlaceholder")}
              value={reason}
              onChange={(v) => {
                setReason(v);
                setErrors((prev) => ({ ...prev, reason: undefined }));
              }}
              error={errors.reason ?? null}
            />
            <Problem prefix={t("admin.customers.code.failed")} message={problem} />
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={change.isPending}
              >
                {t("admin.customers.code.cancel")}
              </Button>
              <Button type="submit" disabled={change.isPending}>
                {change.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <RefreshCcw aria-hidden />
                )}
                {change.isPending
                  ? t("admin.customers.code.submitting")
                  : t("admin.customers.code.submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// "Deactiveren" / "Activeren" (admin, SPEC §35.5)
// ---------------------------------------------------------------------------

/**
 * setCustomerDisabledFn: the status with the admin's own client, then the
 * login (un)banned with the service role. If the status changed but the
 * login could not be (un)banned, the dialog says so plainly.
 */
export function DisableCustomerDialog({
  userId,
  customer,
  open,
  onOpenChange,
}: {
  userId: string;
  customer: CustomerRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const disabling = customer.status !== "disabled";
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: (validReason: string) =>
      submitSetCustomerDisabled({
        customerId: customer.id,
        disabled: disabling,
        reason: validReason,
      }),
    onSuccess: async (result) => {
      const name = customer.full_name;
      toast.success(
        disabling
          ? t("admin.customers.disable.disabled", { name })
          : t("admin.customers.disable.enabled", { name }),
      );
      if (result.revokedInvitations > 0) toast.info(t("admin.customers.disable.revokedOne"));
      if (result.login === "failed" && result.loginError) {
        toast.warning(
          t("admin.customers.disable.loginFailed", { message: result.loginError.message }),
          { duration: 15_000 },
        );
      }
      if (result.login === "team") {
        toast.info(t("admin.customers.disable.teamLogin"), { duration: 15_000 });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.customers(userId) }),
        queryClient.invalidateQueries({ queryKey: adminKeys.customerCounts(userId) }),
        queryClient.invalidateQueries({ queryKey: adminKeys.orders(userId) }),
      ]);
      onOpenChange(false);
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(errorMessage(e));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const parsed = reasonText.safeParse(reason);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? null);
      document.getElementById(`${id}-reason`)?.focus();
      return;
    }
    setError(null);
    run.mutate(parsed.data);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !run.isPending && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {disabling
              ? t("admin.customers.disable.disableTitle", { name: customer.full_name })
              : t("admin.customers.disable.enableTitle", { name: customer.full_name })}
          </DialogTitle>
          <DialogDescription>
            {disabling
              ? t("admin.customers.disable.disableText")
              : t("admin.customers.disable.enableText")}
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="min-w-0 space-y-4">
          <ReasonField
            id={`${id}-reason`}
            label={t("admin.customers.disable.reason")}
            hint={t("admin.customers.disable.reasonHint")}
            value={reason}
            onChange={(v) => {
              setReason(v);
              setError(null);
            }}
            error={error}
          />
          <Problem prefix={t("admin.customers.disable.failed")} message={problem} />
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={run.isPending}
            >
              {t("admin.customers.disable.cancel")}
            </Button>
            <Button
              type="submit"
              variant={disabling ? "destructive" : "default"}
              disabled={run.isPending}
            >
              {run.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : disabling ? (
                <Ban aria-hidden />
              ) : (
                <CircleCheck aria-hidden />
              )}
              {run.isPending
                ? t("admin.customers.disable.busy")
                : disabling
                  ? t("admin.customers.disable.disableConfirm")
                  : t("admin.customers.disable.enableConfirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// "Wachtwoord-resetlink maken" (SPEC §35.6)
// ---------------------------------------------------------------------------

/**
 * createRecoveryLinkFn: auth.admin.generateLink (no e-mail is sent), shown as
 * a link through /auth/confirm, with "Kopieer resetlink" and "Deel via
 * WhatsApp". Made only on request, so a link is not created by opening.
 */
export function RecoveryLinkDialog({
  customer,
  userId,
  open,
  onOpenChange,
}: {
  customer: CustomerRow;
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<Extract<RecoveryLinkResponse, { ok: true }> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => submitRecoveryLink({ customerId: customer.id }),
    onSuccess: async (link) => {
      setResult(link);
      toast.success(t("admin.recovery.created"));
      // The internal note "Wachtwoord-resetlink gemaakt" appears on the page.
      await queryClient.invalidateQueries({
        queryKey: adminKeys.customerNotes(userId, customer.id),
      });
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(errorMessage(e));
    },
  });
  const finish = () => {
    onOpenChange(false);
    setResult(null);
    setProblem(null);
  };
  // The link is shown once: closing before it was copied or shared asks first.
  const guard = useLinkGuard(result?.link ?? null, finish);
  const close = (next: boolean) => {
    if (create.isPending) return;
    if (next) onOpenChange(true);
    else guard.requestClose();
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-h-[92vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-card sm:max-w-xl"
        {...guard.contentProps}
      >
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {t("admin.recovery.title", { name: customer.full_name })}
          </DialogTitle>
          <DialogDescription>{t("admin.recovery.intro")}</DialogDescription>
        </DialogHeader>
        {result ? (
          <>
            <ShareLinkPanel
              link={result.link}
              label={t("admin.recovery.linkLabel")}
              copyLabel={t("admin.recovery.copy")}
              shareText={recoveryShareText({ fullName: result.fullName, link: result.link })}
              phone={result.phone}
              emailed={null}
              linkSource={result.linkSource}
              notes={[t("admin.recovery.validity")]}
              onShared={guard.markShared}
            />
            <UnsharedLinkPrompt guard={guard} />
            <DialogFooter>
              <Button onClick={() => close(false)}>{t("admin.recovery.close")}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <Problem prefix={t("admin.recovery.failed")} message={problem} />
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => close(false)} disabled={create.isPending}>
                {t("admin.recovery.cancel")}
              </Button>
              <Button onClick={() => create.mutate()} disabled={create.isPending}>
                {create.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <KeyRound aria-hidden />
                )}
                {create.isPending ? t("admin.recovery.creating") : t("admin.recovery.create")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
