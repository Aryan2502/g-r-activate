import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Loader2, MailCheck, Send } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { AuthCard } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { addressIndependentFailure, authErrorMessage } from "@/lib/auth/auth-errors";
import { forgotPasswordSchema } from "@/lib/auth/schemas";
import { confirmRedirectUrl } from "@/lib/auth/urls";
import { t, useT } from "@/lib/i18n";
import { paths } from "@/lib/paths";

export const Route = createFileRoute("/_auth/wachtwoord-vergeten")({
  validateSearch: (search: Record<string, unknown>): { email?: string } =>
    typeof search["email"] === "string" ? { email: search["email"] } : {},
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("auth.forgot.title") }) }] }),
  component: ForgotPasswordPage,
});

type FormInput = z.input<typeof forgotPasswordSchema>;
type FormOutput = z.output<typeof forgotPasswordSchema>;

function ForgotPasswordPage() {
  const t = useT();
  const { email } = Route.useSearch();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: email ?? "" },
  });

  async function onSubmit(values: FormOutput) {
    const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: confirmRedirectUrl(),
    });
    // Only failures unrelated to the address are shown, so the page never
    // reveals whether an account exists (SPEC §35.6).
    if (addressIndependentFailure(error)) {
      toast.error(authErrorMessage(error));
      return;
    }
    if (error) console.error("resetPasswordForEmail failed", error);
    setSentTo(values.email);
    toast.success(t("auth.forgot.sentToast"));
  }

  const backToLogin = (
    <p>
      <Link
        to={paths.login}
        className="inline-flex items-center gap-1 text-primary hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("auth.forgot.backToLogin")}
      </Link>
    </p>
  );

  if (sentTo) {
    return (
      <AuthCard title={t("auth.forgot.sentTitle")} footer={backToLogin}>
        <div
          className="flex gap-3 rounded-md border bg-success-soft px-4 py-3 text-sm text-foreground"
          role="status"
        >
          <MailCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <p>{t("auth.forgot.sentText", { email: sentTo })}</p>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">{t("auth.forgot.spamHint")}</p>
        <Button variant="outline" className="mt-4 w-full" onClick={() => setSentTo(null)}>
          {t("auth.confirm.requestNew")}
        </Button>
      </AuthCard>
    );
  }

  const submitting = form.formState.isSubmitting;
  return (
    <AuthCard
      title={t("auth.forgot.title")}
      description={t("auth.forgot.intro")}
      footer={backToLogin}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("auth.fields.email")}</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    autoFocus
                    className="h-10"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="h-10 w-full" disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
            {submitting ? t("auth.forgot.submitting") : t("auth.forgot.submit")}
          </Button>
        </form>
      </Form>
    </AuthCard>
  );
}
