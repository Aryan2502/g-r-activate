import { useEffect, useState } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, KeyRound, Loader2, LogIn } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { AuthPending } from "@/components/auth/AuthPending";
import { ResendConfirmation } from "@/components/auth/ResendConfirmation";
import { AuthCard } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/button";
import { authErrorMessage, classifyAuthError } from "@/lib/auth/auth-errors";
import { bootAuthCallback, parseAuthCallback, type AuthCallback } from "@/lib/auth/callback";
import { currentSession } from "@/lib/auth/session";
import { useGoToArea } from "@/lib/auth/use-go-to-area";
import { errorMessage } from "@/lib/errors";
import { t, useT, type PlainTranslationKey } from "@/lib/i18n";
import { paths } from "@/lib/paths";

const OTP_TYPES = [
  "signup",
  "email",
  "recovery",
  "magiclink",
  "invite",
  "email_change",
] as const satisfies readonly EmailOtpType[];
type OtpType = (typeof OTP_TYPES)[number];

function isOtpType(value: unknown): value is OtpType {
  return typeof value === "string" && (OTP_TYPES as readonly string[]).includes(value);
}

interface ConfirmSearch {
  token_hash?: string;
  type?: string;
}

// Links from our own templates carry ?token_hash&type and are verified only when
// the visitor clicks "Doorgaan", so mail scanners that open links cannot use
// them up. Supabase's default links arrive already verified (session or error
// in the URL fragment). SPEC §35.6.
export const Route = createFileRoute("/_auth/auth/confirm")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): ConfirmSearch => {
    const out: ConfirmSearch = {};
    if (typeof search["token_hash"] === "string") out.token_hash = search["token_hash"];
    if (typeof search["type"] === "string") out.type = search["type"];
    return out;
  },
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("auth.confirm.signupTitle") }) }] }),
  pendingComponent: () => <AuthPending />,
  component: ConfirmPage,
});

function ConfirmPage() {
  const { token_hash: tokenHash, type } = Route.useSearch();
  if (tokenHash && isOtpType(type)) return <VerifyTokenHash tokenHash={tokenHash} type={type} />;
  return <UrlCallback />;
}

const COPY: Record<OtpType, { title: PlainTranslationKey; text: PlainTranslationKey }> = {
  signup: { title: "auth.confirm.signupTitle", text: "auth.confirm.signupText" },
  email: { title: "auth.confirm.signupTitle", text: "auth.confirm.signupText" },
  invite: { title: "auth.confirm.signupTitle", text: "auth.confirm.signupText" },
  recovery: { title: "auth.confirm.recoveryTitle", text: "auth.confirm.recoveryText" },
  magiclink: { title: "auth.confirm.magiclinkTitle", text: "auth.confirm.magiclinkText" },
  email_change: { title: "auth.confirm.emailChangeTitle", text: "auth.confirm.emailChangeText" },
};

function useFinishSignIn() {
  const t = useT();
  const navigate = useNavigate();
  const goToArea = useGoToArea();
  return async (type: string | null, userId: string) => {
    if (type === "recovery") {
      await navigate({ href: paths.setPassword, replace: true });
      return;
    }
    toast.success(type === "magiclink" ? t("auth.confirm.signedIn") : t("auth.confirm.confirmed"));
    await goToArea(userId);
  };
}

function VerifyTokenHash({ tokenHash, type }: { tokenHash: string; type: OtpType }) {
  const t = useT();
  const finish = useFinishSignIn();
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);

  async function verify() {
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error || !data.user) {
        const kind = error ? classifyAuthError(error) : "link_invalid";
        if (kind === "network" || kind === "rate_limited") {
          toast.error(authErrorMessage(error));
        } else {
          if (kind !== "link_invalid") console.error("verifyOtp failed", error);
          setExpired(true);
        }
        return;
      }
      await finish(type, data.user.id);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (expired) return <LinkExpired type={type} />;

  const copy = COPY[type];
  return (
    <AuthCard title={t(copy.title)} description={t(copy.text)}>
      <Button className="h-10 w-full" onClick={() => void verify()} disabled={busy} autoFocus>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowRight aria-hidden />}
        {busy ? t("auth.confirm.verifying") : t("auth.confirm.continue")}
      </Button>
    </AuthCard>
  );
}

type CallbackState =
  { status: "working" } | { status: "expired"; type: string | null } | { status: "invalid" };

function UrlCallback() {
  const finish = useFinishSignIn();
  const [state, setState] = useState<CallbackState>({ status: "working" });

  useEffect(() => {
    let active = true;
    const callback: AuthCallback | null =
      parseAuthCallback(window.location.href) ?? bootAuthCallback;

    void (async () => {
      if (callback?.errorCode) {
        if (active) setState({ status: "expired", type: callback.type });
        return;
      }
      if (!callback?.hasSession) {
        if (active) setState({ status: "invalid" });
        return;
      }
      // supabase-js has already read the session from the URL fragment.
      const session = await currentSession();
      if (!active) return;
      if (!session) {
        setState({ status: "expired", type: callback.type });
        return;
      }
      await finish(callback.type, session.user.id);
    })();

    return () => {
      active = false;
    };
    // Runs once for the URL the page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.status === "expired") return <LinkExpired type={state.type} />;
  if (state.status === "invalid") return <InvalidLink />;
  return <AuthPending label={t("auth.confirm.processing")} />;
}

function LinkExpired({ type }: { type: string | null }) {
  const t = useT();
  const recovery = type === "recovery";
  const confirmation = !recovery && type !== "magiclink";
  return (
    <AuthCard
      title={t("auth.confirm.expiredTitle")}
      description={t("auth.confirm.expiredText")}
      footer={<LoginFooter />}
    >
      {recovery || !confirmation ? (
        <Button asChild className="h-10 w-full">
          <Link to={recovery ? paths.forgotPassword : paths.login}>
            {recovery ? <KeyRound aria-hidden /> : <LogIn aria-hidden />}
            {t("auth.confirm.requestNew")}
          </Link>
        </Button>
      ) : (
        <RequestNewLink withPasswordReset={type === null} />
      )}
    </AuthCard>
  );
}

/** A link with no usable token: offer both kinds of new link. */
function InvalidLink() {
  const t = useT();
  return (
    <AuthCard
      title={t("auth.confirm.invalidTitle")}
      description={t("auth.confirm.invalidText")}
      footer={<LoginFooter />}
    >
      <RequestNewLink withPasswordReset />
    </AuthCard>
  );
}

function RequestNewLink({ withPasswordReset }: { withPasswordReset: boolean }) {
  const t = useT();
  return (
    <>
      <ResendConfirmation
        title={t("auth.confirm.requestNew")}
        description={t("auth.confirm.newConfirmationText")}
      />
      {withPasswordReset ? (
        <Button asChild variant="outline" className="mt-4 w-full">
          <Link to={paths.forgotPassword}>
            <KeyRound aria-hidden />
            {t("auth.forgot.title")}
          </Link>
        </Button>
      ) : null}
    </>
  );
}

function LoginFooter() {
  const t = useT();
  return (
    <p>
      <Link to={paths.login} className="font-medium text-primary hover:underline">
        {t("auth.signup.loginLink")}
      </Link>
    </p>
  );
}
