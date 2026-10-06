import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router";
import { AlertTriangle, Loader2, LogIn } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { ResendConfirmation } from "@/components/auth/ResendConfirmation";
import { CompanyContact } from "@/components/content/CompanyContact";
import { AuthCard } from "@/components/layout/AuthLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { authErrorMessage, classifyAuthError, type AuthErrorKind } from "@/lib/auth/auth-errors";
import { loginSchema } from "@/lib/auth/schemas";
import { currentSession } from "@/lib/auth/session";
import { useGoToArea } from "@/lib/auth/use-go-to-area";
import { errorMessage } from "@/lib/errors";
import { t, useT } from "@/lib/i18n";
import { paths } from "@/lib/paths";

const authRoute = getRouteApi("/_auth");

export const Route = createFileRoute("/_auth/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search["redirect"] === "string" ? { redirect: search["redirect"] } : {},
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("auth.login.title") }) }] }),
  component: LoginPage,
});

type LoginInput = z.input<typeof loginSchema>;
type LoginOutput = z.output<typeof loginSchema>;

function LoginPage() {
  const t = useT();
  const info = authRoute.useLoaderData();
  const { redirect } = Route.useSearch();
  const goToArea = useGoToArea();
  const [failure, setFailure] = useState<{
    kind: AuthErrorKind;
    message: string;
    email: string;
  } | null>(null);

  const form = useForm<LoginInput, unknown, LoginOutput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  // Someone who is still signed in goes straight to their area.
  useEffect(() => {
    let active = true;
    void currentSession().then((session) => {
      if (active && session) void goToArea(session.user.id, redirect);
    });
    return () => {
      active = false;
    };
    // Runs once on arrival; later sign-ins are handled by onSubmit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(values: LoginOutput) {
    setFailure(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword(values);
      if (error) {
        // Shown inline only: a toast would cover the recovery UI below the form.
        setFailure({
          kind: classifyAuthError(error),
          message: authErrorMessage(error),
          email: values.email,
        });
        return;
      }
      toast.success(t("auth.login.success"));
      await goToArea(data.user.id, redirect);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const submitting = form.formState.isSubmitting;
  const typedEmail = form.watch("email").trim();
  const signupEnabled = info?.public_signup_enabled ?? false;

  return (
    <AuthCard
      title={t("auth.login.title")}
      description={t("auth.login.intro")}
      footer={
        <>
          {signupEnabled ? (
            <p>
              {t("auth.login.noAccount")}{" "}
              <Link to={paths.signup} className="font-medium text-primary hover:underline">
                {t("auth.login.signupLink")}
              </Link>
            </p>
          ) : null}
          <p>{t("auth.login.existingCustomer")}</p>
        </>
      }
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
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-baseline justify-between gap-2">
                  <FormLabel>{t("auth.fields.password")}</FormLabel>
                  <Link
                    to={paths.forgotPassword}
                    search={typedEmail ? { email: typedEmail } : {}}
                    className="text-sm text-primary hover:underline"
                  >
                    {t("auth.login.forgotPassword")}
                  </Link>
                </div>
                <FormControl>
                  <PasswordInput autoComplete="current-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {failure ? (
            <Alert variant="destructive" className="bg-destructive-soft">
              <AlertTriangle aria-hidden />
              <AlertDescription>{failure.message}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" className="h-10 w-full" disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" aria-hidden /> : <LogIn aria-hidden />}
            {submitting ? t("auth.login.submitting") : t("auth.login.submit")}
          </Button>
        </form>
      </Form>

      {failure?.kind === "email_not_confirmed" ? (
        <ResendConfirmation email={failure.email} className="mt-6" />
      ) : null}
      {failure?.kind === "banned" ? <CompanyContact info={info} className="mt-6" /> : null}
    </AuthCard>
  );
}
