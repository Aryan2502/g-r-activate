import { useEffect, useState, type FormEvent } from "react";
import { Loader2, MailCheck, Send } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addressIndependentFailure, authErrorMessage } from "@/lib/auth/auth-errors";
import { confirmRedirectUrl } from "@/lib/auth/urls";
import { emailField } from "@/lib/auth/schemas";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const COOLDOWN_SECONDS = 60;

interface ResendConfirmationProps {
  /** Known address; when absent the visitor types it. */
  email?: string | undefined;
  title?: string;
  description?: string;
  className?: string;
}

/**
 * Sends the sign-up confirmation mail again. The outcome is worded the same
 * whether or not an account exists, so the form reveals nothing about addresses.
 */
export function ResendConfirmation({
  email,
  title,
  description,
  className,
}: ResendConfirmationProps) {
  const t = useT();
  const [typed, setTyped] = useState(email ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = emailField.safeParse(email ?? typed);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? t("auth.validation.emailInvalid"));
      return;
    }
    setFieldError(null);
    setSending(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: parsed.data,
      options: { emailRedirectTo: confirmRedirectUrl() },
    });
    setSending(false);
    if (addressIndependentFailure(error)) {
      toast.error(authErrorMessage(error));
      return;
    }
    setSent(true);
    setWait(COOLDOWN_SECONDS);
    toast.success(t("auth.resend.sent"));
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      noValidate
      className={cn("rounded-md border bg-cream px-4 py-4 text-left text-sm", className)}
    >
      <p className="font-semibold text-primary">{title ?? t("auth.resend.title")}</p>
      <p className="mt-1 text-muted-foreground">{description ?? t("auth.resend.text")}</p>
      {email === undefined ? (
        <div className="mt-3 space-y-2">
          <Label htmlFor="resend-email">{t("auth.fields.email")}</Label>
          <Input
            id="resend-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            className="h-10 bg-card"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? "resend-email-error" : undefined}
          />
          {fieldError ? (
            <p id="resend-email-error" className="text-[0.8rem] font-medium text-destructive">
              {fieldError}
            </p>
          ) : null}
        </div>
      ) : null}
      {sent ? (
        <p className="mt-3 flex gap-2 text-success" role="status">
          <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("auth.resend.sent")}
        </p>
      ) : null}
      <Button
        type="submit"
        variant="outline"
        className="mt-3 h-auto min-h-9 w-full whitespace-normal bg-card py-2 text-center"
        disabled={sending || wait > 0}
      >
        {sending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
        {sending ? t("auth.resend.sending") : t("auth.resend.button")}
      </Button>
      {wait > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground tabular-nums">
          {t("auth.resend.wait", { seconds: wait })}
        </p>
      ) : null}
    </form>
  );
}
