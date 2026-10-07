import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Loader2, MailX, RotateCw, Send } from "lucide-react";
import { toast } from "sonner";

import { InvitationStateBadge } from "@/components/admin/customers/CustomerBadges";
import { ShareLinkPanel } from "@/components/admin/customers/ShareLinkPanel";
import { useLinkGuard } from "@/components/admin/customers/link-guard";
import { UnsharedLinkPrompt } from "@/components/admin/customers/one-time-link";
import { DetailItem, DetailList, LoadError } from "@/components/portal/Section";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { revokeInvitation, type InvitationSummary } from "@/lib/admin/customer-actions";
import { currentInvitation, type CustomerRow } from "@/lib/admin/customers";
import {
  RESEND_DAILY_LIMIT,
  invitationShareText,
  invitationState,
  resendAvailability,
  sendsToday,
} from "@/lib/admin/invitations";
import { adminKeys } from "@/lib/admin/keys";
import { errorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { submitResendInvitation, type ResendResponse } from "@/lib/server-fns/customers.functions";

type Resent = Extract<ResendResponse, { ok: true }>;

/**
 * Re-renders every few seconds while a wait is running, for "kan over N
 * seconden". The render itself reads the clock, so the count never starts
 * from a stale moment (a resend right after the page loaded showed 62 s).
 */
function useTicker(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 5_000);
    return () => window.clearInterval(timer);
  }, [active]);
}

/**
 * The invitation part of the customer page (SPEC §35.6): its state, and for
 * an open or expired one "Opnieuw versturen" (a new token: the old link stops
 * working; once a minute, five times a day) and "Intrekken". The link itself
 * exists only in the answer to a (re)send, so the panel shows it then, with
 * "Kopieer uitnodigingslink" and "Deel via WhatsApp".
 */
export function CustomerInvitationPanel({
  userId,
  customer,
  invitations,
  onInvite,
}: {
  userId: string;
  customer: CustomerRow;
  invitations: UseQueryResult<InvitationSummary[]>;
  /** Opens "Uitnodigen" (a new invitation). */
  onInvite: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [resent, setResent] = useState<Resent | null>(null);
  // Closing before the link was copied, shared or e-mailed asks first.
  const guard = useLinkGuard(resent && resent.emailOutcome !== "sent" ? resent.link : null, () =>
    setResent(null),
  );
  // Where focus goes after the link dialog: "Opnieuw versturen" is disabled
  // for a minute then, so Radix cannot return focus to it.
  const hintRef = useRef<HTMLParagraphElement>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const invitation = invitations.data ? currentInvitation(invitations.data) : null;
  const state = invitation ? invitationState(invitation) : null;
  const pending = state === "open" || state === "expired";
  const live = invitation ? resendAvailability(invitation, new Date()) : null;
  useTicker(live?.ok === false && live.reason === "wait");

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.customers(userId) }),
      queryClient.invalidateQueries({ queryKey: adminKeys.customerCounts(userId) }),
    ]);

  const resend = useMutation({
    mutationFn: (invitationId: string) => submitResendInvitation({ invitationId }),
    onSuccess: async (result) => {
      setResent(result);
      toast.success(t("admin.invitations.section.resent"));
      await refresh();
    },
    onError: (e) =>
      toast.error(`${t("admin.invitations.section.resendFailed")} ${errorMessage(e)}`),
  });

  const revoke = useMutation({
    mutationFn: (invitationId: string) => revokeInvitation(supabase, invitationId),
    onSuccess: async () => {
      setConfirmRevoke(false);
      toast.success(t("admin.invitations.section.revoked"));
      await refresh();
    },
    onError: (e) =>
      toast.error(`${t("admin.invitations.section.revokeFailed")} ${errorMessage(e)}`),
  });

  if (invitations.isError) {
    return (
      <LoadError
        title={t("admin.invitations.section.loadFailed")}
        error={invitations.error}
        onRetry={() => void invitations.refetch()}
      />
    );
  }
  if (invitations.isPending) return <Skeleton className="h-16 w-full" />;

  const canInvite =
    !customer.user_id && customer.status !== "disabled" && Boolean(customer.email) && !pending;

  return (
    <div className="space-y-3">
      {invitation && state ? (
        <DetailList>
          <DetailItem label={t("admin.customers.columns.status")}>
            <InvitationStateBadge state={state} />
          </DetailItem>
          <DetailItem label={t("admin.invitations.section.sentTo")}>
            <span className="break-all">{invitation.email}</span>
          </DetailItem>
          {state === "accepted" && invitation.accepted_at ? (
            <DetailItem label={t("admin.invitations.section.acceptedOn")}>
              <span className="tabular-nums">{formatDateTime(invitation.accepted_at)}</span>
            </DetailItem>
          ) : state === "revoked" && invitation.revoked_at ? (
            <DetailItem label={t("admin.invitations.section.revokedOn")}>
              <span className="tabular-nums">{formatDateTime(invitation.revoked_at)}</span>
            </DetailItem>
          ) : (
            <DetailItem
              label={
                state === "expired"
                  ? t("admin.invitations.section.expiredOn")
                  : t("admin.invitations.section.expires")
              }
            >
              <span className="tabular-nums">{formatDateTime(invitation.expires_at)}</span>
            </DetailItem>
          )}
          {pending && invitation.last_sent_at ? (
            <DetailItem label={t("admin.invitations.section.lastSent")}>
              <span className="tabular-nums">
                {formatDateTime(invitation.last_sent_at)}
                {sendsToday(invitation) >= 2
                  ? ` (${t("admin.invitations.section.sentToday", {
                      count: sendsToday(invitation),
                      max: RESEND_DAILY_LIMIT,
                    })})`
                  : null}
              </span>
            </DetailItem>
          ) : null}
        </DetailList>
      ) : (
        <p className="text-sm text-muted-foreground">
          {customer.user_id
            ? t("admin.invitations.section.hasLogin")
            : customer.status === "disabled"
              ? t("admin.invitations.section.disabled")
              : !customer.email
                ? t("admin.invitations.section.noEmail")
                : t("admin.invitations.section.none")}
        </p>
      )}

      {pending && invitation && customer.status !== "disabled" && !customer.user_id ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => resend.mutate(invitation.id)}
              disabled={resend.isPending || live?.ok === false}
              aria-describedby="invitation-resend-hint"
            >
              {resend.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <RotateCw aria-hidden />
              )}
              {t("admin.invitations.section.resend")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmRevoke(true)}
              disabled={revoke.isPending}
            >
              <MailX aria-hidden />
              {t("admin.invitations.section.revoke")}
            </Button>
          </div>
          <p
            id="invitation-resend-hint"
            ref={hintRef}
            tabIndex={-1}
            className="text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-live="polite"
          >
            {live?.ok === false
              ? live.reason === "wait"
                ? t("admin.invitations.section.resendWait", { seconds: live.seconds })
                : t("admin.invitations.section.resendLimit")
              : t("admin.invitations.section.resendHint")}
          </p>
        </div>
      ) : canInvite ? (
        <Button size="sm" onClick={onInvite}>
          <Send aria-hidden />
          {t("admin.invitations.section.invite")}
        </Button>
      ) : null}

      <Dialog open={resent !== null} onOpenChange={(open) => !open && guard.requestClose()}>
        <DialogContent
          className="max-h-[92vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-card sm:max-w-xl"
          {...guard.contentProps}
          onCloseAutoFocus={(event) => {
            if (!hintRef.current) return;
            event.preventDefault();
            hintRef.current.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-heading text-primary">
              {t("admin.invitations.section.newLinkTitle", { name: customer.full_name })}
            </DialogTitle>
            <DialogDescription>{t("admin.invitations.section.resendHint")}</DialogDescription>
          </DialogHeader>
          {resent ? (
            <ShareLinkPanel
              link={resent.link}
              label={t("admin.invitations.linkLabel")}
              copyLabel={t("admin.invitations.copy")}
              shareText={invitationShareText({
                kind: "customer",
                fullName: customer.full_name,
                customerCode: customer.customer_code,
                email: resent.invitation.email,
                link: resent.link,
              })}
              phone={customer.phone}
              emailOutcome={resent.emailOutcome}
              emailTo={resent.invitation.email}
              linkSource={resent.linkSource}
              notes={[
                t("admin.invitations.linkOnce"),
                t("admin.invitations.linkValid", {
                  date: formatDateTime(resent.invitation.expires_at),
                }),
              ]}
              onShared={guard.markShared}
            />
          ) : null}
          <UnsharedLinkPrompt guard={guard} />
          <DialogFooter>
            <Button onClick={guard.requestClose}>{t("admin.invitations.section.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmRevoke}
        onOpenChange={(open) => !revoke.isPending && setConfirmRevoke(open)}
      >
        <AlertDialogContent className="w-[calc(100%-2rem)] rounded-lg bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading text-primary">
              {t("admin.invitations.section.revokeTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.invitations.section.revokeText", { email: invitation?.email ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={revoke.isPending}>
              {t("admin.customers.disable.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={revoke.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (invitation) revoke.mutate(invitation.id);
              }}
            >
              {revoke.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {revoke.isPending
                ? t("admin.invitations.section.revoking")
                : t("admin.invitations.section.revokeConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
