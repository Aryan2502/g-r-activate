import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { House, Loader2, LogOut } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { ResendConfirmation } from "@/components/auth/ResendConfirmation";
import { CompanyContact } from "@/components/content/CompanyContact";
import { PagePending } from "@/components/layout/PagePending";
import { StatusScreen } from "@/components/layout/StatusScreen";
import { Button } from "@/components/ui/button";
import { classifyAuthError } from "@/lib/auth/auth-errors";
import { publicCompanyInfoQueryOptions } from "@/lib/company-info";
import { useT } from "@/lib/i18n";

type Reason = "disabled" | "unconfirmed" | "not_linked";

/**
 * A signed-in customer whose record RLS does not show (SPEC §35.5/§35.6).
 * The Auth user tells the cases apart: banned (disabled customer), e-mail not
 * confirmed yet, or confirmed but not linked. The last has several causes the
 * browser cannot see (an existing record or open invitation for the address,
 * sign-up switched off, a failed insert), so its copy covers all of them.
 */
async function noCustomerReason(): Promise<Reason> {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    if (classifyAuthError(error) === "banned") return "disabled";
    throw error;
  }
  const bannedUntil = data.user.banned_until ? Date.parse(data.user.banned_until) : NaN;
  if (bannedUntil > Date.now()) return "disabled";
  if (!data.user.email_confirmed_at) return "unconfirmed";
  return "not_linked";
}

export function NoCustomerScreen({
  userId,
  email,
  onSignOut,
  signingOut,
}: {
  userId: string;
  email: string;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  const t = useT();
  const reason = useQuery({
    queryKey: ["portal", userId, "no-customer-reason"],
    queryFn: noCustomerReason,
  });
  const company = useQuery(publicCompanyInfoQueryOptions());

  if (reason.isPending) return <PagePending />;

  const kind: Reason = reason.data ?? "not_linked";
  const copy = {
    disabled: {
      title: t("portal.noCustomer.disabledTitle"),
      text: t("portal.noCustomer.disabledText"),
    },
    unconfirmed: {
      title: t("portal.noCustomer.unconfirmedTitle"),
      text: t("portal.noCustomer.unconfirmedText"),
    },
    not_linked: {
      title: t("portal.noCustomer.notLinkedTitle"),
      text: t("portal.noCustomer.notLinkedText"),
    },
  }[kind];

  return (
    <StatusScreen
      title={copy.title}
      description={copy.text}
      actions={
        <>
          <Button onClick={onSignOut} disabled={signingOut}>
            {signingOut ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
            {t("auth.signOut.button")}
          </Button>
          <Button asChild variant="outline">
            <Link to="/">
              <House aria-hidden />
              {t("common.backHome")}
            </Link>
          </Button>
        </>
      }
    >
      {kind === "unconfirmed" ? (
        <ResendConfirmation email={email} />
      ) : (
        <CompanyContact info={company.data} />
      )}
    </StatusScreen>
  );
}
