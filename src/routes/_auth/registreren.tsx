import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, createFileRoute, getRouteApi, useNavigate, useRouter } from "@tanstack/react-router";
import { AlertTriangle, Loader2, LogIn, MailCheck, RotateCw, UserPlus } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { ResendConfirmation } from "@/components/auth/ResendConfirmation";
import { AuthCard } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { authErrorMessage } from "@/lib/auth/auth-errors";
import { PHONE_PREFIX, signupMetadata, signupSchema } from "@/lib/auth/schemas";
import { confirmRedirectUrl } from "@/lib/auth/urls";
import { errorMessage } from "@/lib/errors";
import { t, useT } from "@/lib/i18n";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";

const authRoute = getRouteApi("/_auth");

export const Route = createFileRoute("/_auth/registreren")({
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("auth.signup.title") }) }] }),
  component: SignupPage,
});

type FormInput = z.input<typeof signupSchema>;
type FormOutput = z.output<typeof signupSchema>;

function SignupPage() {
  const t = useT();
  const router = useRouter();
  const info = authRoute.useLoaderData();
  const [inboxFor, setInboxFor] = useState<string | null>(null);

  const loginFooter = (
    <>
      <p>
        {t("auth.signup.haveAccount")}{" "}
        <Link to={paths.login} className="font-medium text-primary hover:underline">
          {t("auth.signup.loginLink")}
        </Link>
      </p>
      <p>{t("auth.signup.existingCustomer")}</p>
    </>
  );

  if (info === null) {
    return (
      <AuthCard title={t("auth.signup.title")} footer={loginFooter}>
        <div role="alert" className="flex flex-col items-start gap-4">
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="size-4" aria-hidden />
            {t("auth.signup.loadFailed")}
          </p>
          <Button variant="outline" onClick={() => void router.invalidate()}>
            <RotateCw aria-hidden />
            {t("common.retry")}
          </Button>
        </div>
      </AuthCard>
    );
  }

  if (!info.public_signup_enabled) {
    return (
      <AuthCard
        title={t("auth.signup.disabledTitle")}
        description={t("auth.signup.disabledText")}
        footer={loginFooter}
      >
        <Button asChild className="w-full">
          <Link to={paths.login}>
            <LogIn aria-hidden />
            {t("auth.login.submit")}
          </Link>
        </Button>
      </AuthCard>
    );
  }

  if (inboxFor) {
    return (
      <AuthCard title={t("auth.signup.checkInboxTitle")} footer={loginFooter}>
        <div
          className="flex gap-3 rounded-md border bg-success-soft px-4 py-3 text-sm text-foreground"
          role="status"
        >
          <MailCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <p>{t("auth.signup.checkInboxText", { email: inboxFor })}</p>
        </div>
        <ResendConfirmation email={inboxFor} className="mt-6" />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t("auth.signup.title")}
      description={t("auth.signup.intro")}
      footer={loginFooter}
      className="max-w-lg"
    >
      <SignupForm termsVersion={info.terms_version ?? "1"} onCheckInbox={setInboxFor} />
    </AuthCard>
  );
}

function SignupForm({
  termsVersion,
  onCheckInbox,
}: {
  termsVersion: string;
  onCheckInbox: (email: string) => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      fullName: "",
      phone: PHONE_PREFIX,
      email: "",
      password: "",
      accountType: "personal",
      companyName: "",
      acceptTerms: false,
    },
  });
  const isBusiness = form.watch("accountType") === "business";

  async function onSubmit(values: FormOutput) {
    try {
      const { data, error } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
        options: {
          emailRedirectTo: confirmRedirectUrl(),
          data: signupMetadata(values, termsVersion),
        },
      });
      if (error) {
        toast.error(authErrorMessage(error));
        return;
      }
      // With "Confirm email" on there is no session yet (SPEC §35.6). An
      // address that already has an account gets the same answer.
      if (data.session) {
        toast.success(t("auth.signup.created"));
        await navigate({ href: paths.portal, replace: true });
        return;
      }
      onCheckInbox(values.email);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const submitting = form.formState.isSubmitting;
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-5">
        <FormField
          control={form.control}
          name="fullName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("auth.fields.fullName")}</FormLabel>
              <FormControl>
                <Input autoComplete="name" autoFocus className="h-10" {...field} />
              </FormControl>
              <FormDescription>{t("auth.fields.fullNameHint")}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("auth.fields.phone")}</FormLabel>
              <FormControl>
                <Input type="tel" autoComplete="tel" inputMode="tel" className="h-10" {...field} />
              </FormControl>
              <FormDescription>{t("auth.fields.phoneHint")}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
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
              <FormLabel>{t("auth.fields.password")}</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" {...field} />
              </FormControl>
              <FormDescription>{t("auth.fields.passwordHint")}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="accountType"
          render={({ field }) => (
            <FormItem>
              <FormLabel id="signup-account-type-label">{t("auth.fields.accountType")}</FormLabel>
              <FormControl>
                <RadioGroup
                  aria-labelledby="signup-account-type-label"
                  value={field.value}
                  onValueChange={field.onChange}
                  className="grid grid-cols-2 gap-3"
                >
                  {(["personal", "business"] as const).map((type) => (
                    <label
                      key={type}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm",
                        field.value === type ? "border-primary bg-cream" : "border-border",
                      )}
                    >
                      <RadioGroupItem value={type} />
                      {t(type === "personal" ? "auth.fields.personal" : "auth.fields.business")}
                    </label>
                  ))}
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {isBusiness ? (
          <FormField
            control={form.control}
            name="companyName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("auth.fields.companyName")}</FormLabel>
                <FormControl>
                  <Input autoComplete="organization" className="h-10" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
        <FormField
          control={form.control}
          name="acceptTerms"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-start gap-3">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                    className="mt-0.5"
                  />
                </FormControl>
                <FormLabel className="text-sm font-normal leading-5">
                  {t("auth.signup.termsBefore")}{" "}
                  <a
                    href="/voorwaarden"
                    target="_blank"
                    rel="noopener"
                    className="font-medium text-primary underline underline-offset-4"
                  >
                    {t("auth.signup.termsLink")}
                  </a>{" "}
                  {t("auth.signup.termsAfter")}{" "}
                  <span className="text-muted-foreground tabular-nums">
                    {t("auth.signup.termsVersion", { version: termsVersion })}
                  </span>
                </FormLabel>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="h-10 w-full" disabled={submitting}>
          {submitting ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
          {submitting ? t("auth.signup.submitting") : t("auth.signup.submit")}
        </Button>
      </form>
    </Form>
  );
}
