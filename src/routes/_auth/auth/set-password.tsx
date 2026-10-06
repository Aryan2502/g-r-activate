import { zodResolver } from "@hookform/resolvers/zod";
import { Link, createFileRoute } from "@tanstack/react-router";
import { KeyRound, Loader2, LogIn, Save } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { AuthPending } from "@/components/auth/AuthPending";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { AuthCard } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { authErrorMessage } from "@/lib/auth/auth-errors";
import { setPasswordSchema } from "@/lib/auth/schemas";
import { useSession } from "@/lib/auth/session";
import { useGoToArea } from "@/lib/auth/use-go-to-area";
import { errorMessage } from "@/lib/errors";
import { t, useT } from "@/lib/i18n";
import { paths } from "@/lib/paths";

// Reached from a recovery link (via /auth/confirm) or from the profile page.
export const Route = createFileRoute("/_auth/auth/set-password")({
  ssr: false,
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("auth.setPassword.title") }) }] }),
  pendingComponent: () => <AuthPending />,
  component: SetPasswordPage,
});

type FormInput = z.input<typeof setPasswordSchema>;
type FormOutput = z.output<typeof setPasswordSchema>;

function SetPasswordPage() {
  const t = useT();
  const session = useSession();

  if (session.status === "loading") return <AuthPending />;
  if (session.status === "unauthenticated") {
    return (
      <AuthCard
        title={t("auth.setPassword.noSessionTitle")}
        description={t("auth.setPassword.noSessionText")}
      >
        <div className="flex flex-col gap-3">
          <Button asChild className="h-10 w-full">
            <Link to={paths.forgotPassword}>
              <KeyRound aria-hidden />
              {t("auth.confirm.requestNew")}
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-10 w-full">
            <Link to={paths.login}>
              <LogIn aria-hidden />
              {t("auth.signup.loginLink")}
            </Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <SetPasswordForm userId={session.session.user.id} email={session.session.user.email ?? ""} />
  );
}

function SetPasswordForm({ userId, email }: { userId: string; email: string }) {
  const t = useT();
  const goToArea = useGoToArea();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { password: "", confirm: "" },
  });

  async function onSubmit(values: FormOutput) {
    try {
      const { error } = await supabase.auth.updateUser({ password: values.password });
      if (error) {
        toast.error(authErrorMessage(error));
        return;
      }
      toast.success(t("auth.setPassword.success"));
      await goToArea(userId);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const submitting = form.formState.isSubmitting;
  return (
    <AuthCard
      title={t("auth.setPassword.title")}
      description={
        <>
          <p>{t("auth.setPassword.intro")}</p>
          {email ? <p className="mt-1">{t("auth.setPassword.forAccount", { email })}</p> : null}
        </>
      }
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
          {/* Lets password managers store the new password under the right account. */}
          <input
            type="email"
            name="username"
            autoComplete="username"
            value={email}
            readOnly
            hidden
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("auth.fields.newPassword")}</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="new-password" autoFocus {...field} />
                </FormControl>
                <FormDescription>{t("auth.fields.passwordHint")}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirm"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("auth.fields.confirmPassword")}</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="h-10 w-full" disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            {submitting ? t("auth.setPassword.submitting") : t("auth.setPassword.submit")}
          </Button>
        </form>
      </Form>
    </AuthCard>
  );
}
