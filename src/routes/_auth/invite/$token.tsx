import { useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  KeyRound,
  Link2Off,
  Loader2,
  LogIn,
  LogOut,
  MailX,
  ServerCrash,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthPending } from "@/components/auth/AuthPending";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { CompanyContact } from "@/components/content/CompanyContact";
import { AuthCard } from "@/components/layout/AuthLayout";
import { LoadError } from "@/components/portal/Section";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage } from "@/lib/auth/auth-errors";
import {
  inviteLoginSchema,
  invitePasswordSchema,
  type InviteLoginData,
  type InviteLoginValues,
  type InvitePasswordData,
  type InvitePasswordValues,
} from "@/lib/auth/invite-schemas";
import { signOut, useSession } from "@/lib/auth/session";
import { useGoToArea } from "@/lib/auth/use-go-to-area";
import { errorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { t, useT } from "@/lib/i18n";
import { paths } from "@/lib/paths";
import {
  fetchInvitation,
  submitRedeem,
  submitRedeemAsUser,
  type InvitationPageState,
} from "@/lib/server-fns/invitations.functions";

/**
 * /invite/$token (SPEC §35.6): the invitee chooses a password (paths a and
 * b) or, when their address already has a confirmed login (path c), signs in
 * with it and accepts. The page knows only what getInvitationFn returns: a
 * first name, a masked e-mail, the GR code and the state. After redemption
 * the browser signs in; customers land on /portal, staff on /admin.
 * noindex comes from the _auth layout; robots.txt disallows /invite.
 */
export const Route = createFileRoute("/_auth/invite/$token")({
  ssr: false,
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("invite.pageTitle") }) }] }),
  pendingComponent: () => <AuthPending />,
  component: InvitePage,
});

const authRoute = getRouteApi("/_auth");
type Open = Extract<InvitationPageState, { status: "open" }>;

function InvitePage() {
  const t = useT();
  const { token } = Route.useParams();
  // Never cached across tokens, never refetched behind the invitee's back.
  const lookup = useQuery({
    queryKey: ["invite", token],
    queryFn: () => fetchInvitation(token),
    staleTime: Infinity,
    gcTime: 0,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  // A state learned while redeeming (e.g. the link was revoked meanwhile).
  const [override, setOverride] = useState<InvitationPageState | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const state = override ?? lookup.data;

  if (lookup.isError) {
    return (
      <AuthCard title={t("invite.pageTitle")}>
        <LoadError
          title={t("invite.loadFailed")}
          error={lookup.error}
          onRetry={() => void lookup.refetch()}
        />
      </AuthCard>
    );
  }
  if (!state) {
    return (
      <AuthCard title={t("invite.pageTitle")}>
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t("invite.loading")}
        </p>
      </AuthCard>
    );
  }
  if (state.status !== "open") return <StateScreen state={state} />;
  if (state.existingAccount || needsLogin) {
    return <ExistingAccount token={token} invitation={state} onState={setOverride} />;
  }
  return (
    <ChoosePassword
      token={token}
      invitation={state}
      onState={setOverride}
      onNeedsLogin={() => setNeedsLogin(true)}
    />
  );
}

// ---------------------------------------------------------------------------
// Invalid, expired, revoked, accepted, not configured
// ---------------------------------------------------------------------------

function StateScreen({ state }: { state: Exclude<InvitationPageState, Open> }) {
  const t = useT();
  const info = authRoute.useLoaderData();
  const screens = {
    invalid: { icon: Link2Off, title: t("invite.invalidTitle"), text: t("invite.invalidText") },
    unavailable: {
      icon: ServerCrash,
      title: t("invite.unavailableTitle"),
      text: t("invite.unavailableText"),
    },
    expired: { icon: Clock, title: t("invite.expiredTitle"), text: t("invite.expiredText") },
    revoked: { icon: MailX, title: t("invite.revokedTitle"), text: t("invite.revokedText") },
    accepted: {
      icon: CheckCircle2,
      title: t("invite.acceptedTitle"),
      text: t("invite.acceptedText"),
    },
  } as const;
  const screen = screens[state.status];
  const Icon = screen.icon;
  return (
    <AuthCard
      title={screen.title}
      description={
        <span className="flex items-start gap-2">
          <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span>{screen.text}</span>
        </span>
      }
    >
      {state.status === "accepted" ? (
        <Button asChild className="h-10 w-full">
          <Link to={paths.login}>
            <LogIn aria-hidden />
            {t("invite.toLogin")}
          </Link>
        </Button>
      ) : (
        <CompanyContact info={info} />
      )}
    </AuthCard>
  );
}

// ---------------------------------------------------------------------------
// The greeting: first name, masked e-mail, GR code
// ---------------------------------------------------------------------------

function Greeting({ invitation }: { invitation: Open }) {
  const t = useT();
  return (
    <div className="space-y-3 rounded-md border bg-cream/60 px-4 py-3 text-sm">
      <dl className="space-y-3">
        <div>
          <dt className="text-xs font-semibold text-muted-foreground">{t("invite.email")}</dt>
          <dd className="mt-0.5 font-medium text-foreground">{invitation.maskedEmail}</dd>
          <dd className="text-xs text-muted-foreground">{t("invite.emailHint")}</dd>
        </div>
        {invitation.customerCode ? (
          <div>
            <dt className="text-xs font-semibold text-muted-foreground">{t("invite.code")}</dt>
            <dd className="mt-0.5 font-heading text-xl font-bold text-primary tabular-nums">
              {invitation.customerCode}
            </dd>
            <dd className="text-xs text-muted-foreground">{t("invite.codeHint")}</dd>
          </div>
        ) : null}
      </dl>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarClock className="size-3.5" aria-hidden />
        {t("invite.validUntil", { date: formatDateTime(invitation.expiresAt) })}
      </p>
    </div>
  );
}

function title(invitation: Open) {
  return invitation.firstName
    ? t("invite.welcome", { name: invitation.firstName })
    : t("invite.welcomeNoName");
}

function intro(invitation: Open) {
  return invitation.kind === "staff"
    ? t("invite.introStaff", {
        role: t(`admin.roles.${invitation.staffRole ?? "staff"}`).toLowerCase(),
      })
    : t("invite.introCustomer");
}

/**
 * The terms checkbox, as on /registreren (customers only). Rendered inside a
 * FormField's render, so the label and message belong to that field.
 */
function TermsItem({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const t = useT();
  const info = authRoute.useLoaderData();
  return (
    <FormItem>
      <div className="flex items-start gap-3">
        <FormControl>
          <Checkbox
            checked={checked}
            onCheckedChange={(next) => onChange(next === true)}
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
          {info?.terms_version ? (
            <span className="text-muted-foreground tabular-nums">
              {t("auth.signup.termsVersion", { version: info.terms_version })}
            </span>
          ) : null}
        </FormLabel>
      </div>
      <FormMessage />
    </FormItem>
  );
}

function Failure({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" className="bg-destructive-soft">
      <AlertTriangle aria-hidden />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** The new staff member's name for "door Maria" (their own profile row; RLS allows it). */
async function saveDisplayName(userId: string, name: string) {
  const { error } = await supabase.from("profiles").update({ display_name: name }).eq("id", userId);
  if (error) console.warn("[invite] display name not saved", error);
}

// ---------------------------------------------------------------------------
// Paths a and b: choose a password
// ---------------------------------------------------------------------------

function ChoosePassword({
  token,
  invitation,
  onState,
  onNeedsLogin,
}: {
  token: string;
  invitation: Open;
  onState: (state: InvitationPageState) => void;
  onNeedsLogin: () => void;
}) {
  const t = useT();
  const goToArea = useGoToArea();
  const [failure, setFailure] = useState<string | null>(null);
  // The full login address, once the token holder has proven it (the page
  // only showed it masked): in the success message, or for signing in by hand.
  const [signInFailed, setSignInFailed] = useState<string | null>(null);
  const form = useForm<InvitePasswordValues, unknown, InvitePasswordData>({
    resolver: zodResolver(invitePasswordSchema({ kind: invitation.kind })),
    defaultValues: { displayName: "", password: "", confirm: "", acceptTerms: false },
  });

  async function onSubmit(values: InvitePasswordData) {
    setFailure(null);
    try {
      const result = await submitRedeem({
        token,
        password: values.password,
        acceptTerms: values.acceptTerms,
      });
      if ("needsLogin" in result) {
        onNeedsLogin();
        return;
      }
      if ("state" in result) {
        onState({ status: result.state, kind: invitation.kind });
        return;
      }
      const { data, error } = await supabase.auth.signInWithPassword({
        email: result.email,
        password: values.password,
      });
      if (error) {
        setSignInFailed(result.email);
        return;
      }
      if (invitation.kind === "staff" && values.displayName) {
        await saveDisplayName(data.user.id, values.displayName);
      }
      toast.success(t("invite.successEmail", { email: result.email }), { duration: 10_000 });
      await goToArea(data.user.id, result.destination);
    } catch (error) {
      setFailure(errorMessage(error));
    }
  }

  if (signInFailed !== null) {
    return (
      <AuthCard
        title={t("invite.success")}
        description={t("invite.successSignInFailed", { email: signInFailed })}
      >
        <Button asChild className="h-10 w-full">
          <Link to={paths.login}>
            <LogIn aria-hidden />
            {t("invite.toLogin")}
          </Link>
        </Button>
      </AuthCard>
    );
  }

  const submitting = form.formState.isSubmitting;
  return (
    <AuthCard title={title(invitation)} description={intro(invitation)}>
      <div className="space-y-5">
        <Greeting invitation={invitation} />
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
            {invitation.kind === "staff" ? (
              <FormField
                control={form.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("invite.staffName")}</FormLabel>
                    <FormControl>
                      <Input autoComplete="name" className="h-10" {...field} />
                    </FormControl>
                    <FormDescription>{t("invite.staffNameHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("auth.fields.newPassword")}</FormLabel>
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
            {invitation.kind === "customer" ? (
              <FormField
                control={form.control}
                name="acceptTerms"
                render={({ field }) => (
                  <TermsItem checked={field.value} onChange={field.onChange} />
                )}
              />
            ) : null}
            <Failure message={failure} />
            <Button type="submit" className="h-10 w-full" disabled={submitting}>
              {submitting ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <KeyRound aria-hidden />
              )}
              {submitting ? t("invite.submitting") : t("invite.submit")}
            </Button>
          </form>
        </Form>
      </div>
    </AuthCard>
  );
}

// ---------------------------------------------------------------------------
// Path c: an existing, confirmed login
// ---------------------------------------------------------------------------

function ExistingAccount({
  token,
  invitation,
  onState,
}: {
  token: string;
  invitation: Open;
  onState: (state: InvitationPageState) => void;
}) {
  const t = useT();
  const session = useSession();
  const goToArea = useGoToArea();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);
  // Signing in from the form below flips the session while the form still
  // has to accept the invitation: keep the form until it is done.
  const [signingIn, setSigningIn] = useState(false);

  const accept = useMutation({
    mutationFn: async (input: { userId: string; acceptTerms: boolean }) => {
      const result = await submitRedeemAsUser({ token, acceptTerms: input.acceptTerms });
      return { result, userId: input.userId };
    },
    onSuccess: async ({ result, userId }) => {
      if ("state" in result) {
        onState({ status: result.state, kind: invitation.kind });
        return;
      }
      if ("needsLogin" in result) return;
      toast.success(t("invite.success"));
      await goToArea(userId, result.destination);
    },
    onError: (error) => setFailure(errorMessage(error)),
  });

  if (session.status === "loading") return <AuthPending />;

  const header = (children: ReactNode) => (
    <AuthCard
      title={title(invitation)}
      description={
        <>
          <p className="font-semibold text-foreground">{t("invite.existingTitle")}</p>
          <p className="mt-1">{t("invite.existingText")}</p>
        </>
      }
    >
      <div className="space-y-5">
        <Greeting invitation={invitation} />
        {children}
      </div>
    </AuthCard>
  );

  // Already signed in on this device: accept as that login (the database
  // checks that its address is the invitation's).
  if (session.status === "authenticated" && !signingIn) {
    const user = session.session.user;
    return header(
      <div className="space-y-4">
        <p className="text-sm text-foreground">
          {t("invite.signedInAs", { email: user.email ?? "" })}
        </p>
        {invitation.kind === "customer" ? (
          <div className="space-y-1.5">
            <label className="flex items-start gap-3 text-sm leading-5">
              <Checkbox
                checked={acceptTerms}
                onCheckedChange={(checked) => {
                  setAcceptTerms(checked === true);
                  setTermsError(null);
                }}
                className="mt-0.5"
                aria-invalid={termsError ? true : undefined}
              />
              <span>
                {t("auth.signup.termsBefore")}{" "}
                <a
                  href="/voorwaarden"
                  target="_blank"
                  rel="noopener"
                  className="font-medium text-primary underline underline-offset-4"
                >
                  {t("auth.signup.termsLink")}
                </a>{" "}
                {t("auth.signup.termsAfter")}
              </span>
            </label>
            {termsError ? (
              <p className="text-[0.8rem] font-medium text-destructive">{termsError}</p>
            ) : null}
          </div>
        ) : null}
        <Failure message={failure} />
        <Button
          className="h-10 w-full"
          disabled={accept.isPending}
          onClick={() => {
            setFailure(null);
            if (invitation.kind === "customer" && !acceptTerms) {
              setTermsError(t("auth.validation.termsRequired"));
              return;
            }
            accept.mutate({ userId: user.id, acceptTerms });
          }}
        >
          {accept.isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <CheckCircle2 aria-hidden />
          )}
          {accept.isPending ? t("invite.accepting") : t("invite.acceptAsUser")}
        </Button>
        <Button
          variant="outline"
          className="h-10 w-full"
          disabled={accept.isPending}
          onClick={() => {
            setFailure(null);
            void signOut(queryClient);
          }}
        >
          <LogOut aria-hidden />
          {t("invite.otherAccount")}
        </Button>
      </div>,
    );
  }

  return header(
    <SignInAndAccept
      kind={invitation.kind}
      failure={failure}
      onFailure={setFailure}
      onSigningIn={setSigningIn}
      onSignedIn={async (userId, values) => {
        const result = await submitRedeemAsUser({ token, acceptTerms: values.acceptTerms });
        if ("state" in result) {
          onState({ status: result.state, kind: invitation.kind });
          return;
        }
        if ("needsLogin" in result) return;
        toast.success(t("invite.success"));
        await goToArea(userId, result.destination);
      }}
    />,
  );
}

function SignInAndAccept({
  kind,
  failure,
  onFailure,
  onSigningIn,
  onSignedIn,
}: {
  kind: "customer" | "staff";
  failure: string | null;
  onFailure: (message: string | null) => void;
  onSigningIn: (busy: boolean) => void;
  onSignedIn: (userId: string, values: InviteLoginData) => Promise<void>;
}) {
  const t = useT();
  const form = useForm<InviteLoginValues, unknown, InviteLoginData>({
    resolver: zodResolver(inviteLoginSchema({ kind })),
    defaultValues: { email: "", password: "", acceptTerms: false },
  });

  async function onSubmit(values: InviteLoginData) {
    onFailure(null);
    onSigningIn(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      });
      if (error) {
        onFailure(authErrorMessage(error));
        return;
      }
      await onSignedIn(data.user.id, values);
    } catch (error) {
      // Signed in, but not accepted (e.g. another address): the page then
      // shows this login with the message and "Met een ander account inloggen".
      onFailure(errorMessage(error));
    } finally {
      onSigningIn(false);
    }
  }

  const submitting = form.formState.isSubmitting;
  return (
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
                <Link to={paths.forgotPassword} className="text-sm text-primary hover:underline">
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
        {kind === "customer" ? (
          <FormField
            control={form.control}
            name="acceptTerms"
            render={({ field }) => <TermsItem checked={field.value} onChange={field.onChange} />}
          />
        ) : null}
        <Failure message={failure} />
        <Button type="submit" className="h-10 w-full" disabled={submitting}>
          {submitting ? <Loader2 className="animate-spin" aria-hidden /> : <LogIn aria-hidden />}
          {submitting ? t("invite.existingSubmitting") : t("invite.existingSubmit")}
        </Button>
      </form>
    </Form>
  );
}
