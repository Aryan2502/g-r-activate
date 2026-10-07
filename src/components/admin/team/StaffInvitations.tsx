import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MailX, RotateCw } from "lucide-react";
import { toast } from "sonner";

import { InvitationStateBadge } from "@/components/admin/customers/CustomerBadges";
import { ShareLinkPanel } from "@/components/admin/customers/ShareLinkPanel";
import { useLinkGuard } from "@/components/admin/customers/link-guard";
import { UnsharedLinkPrompt } from "@/components/admin/customers/one-time-link";
import { LoadError } from "@/components/portal/Section";
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
import { Badge } from "@/components/ui/badge";
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
import {
  RESEND_DAILY_LIMIT,
  invitationShareText,
  invitationState,
  resendAvailability,
  sendsToday,
} from "@/lib/admin/invitations";
import { adminKeys } from "@/lib/admin/keys";
import { peopleQueryOptions } from "@/lib/admin/orders";
import { staffInvitationsQueryOptions } from "@/lib/admin/team-queries";
import { errorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { submitResendInvitation, type ResendResponse } from "@/lib/server-fns/customers.functions";

type Resent = Extract<ResendResponse, { ok: true }>;

/** Re-renders every few seconds while a resend wait runs ("kan over N seconden"). */
function useTicker(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 5_000);
    return () => window.clearInterval(timer);
  }, [active]);
}

/**
 * Open (and expired) staff invitations. Admins resend them (a new token: the
 * old link stops working; once a minute, five times a day) or revoke them;
 * staff only see them. resendInvitationFn and revokeInvitation are the same
 * as for customers: RLS lets only admins touch staff invitations.
 */
export function StaffInvitations({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const t = useT();
  const invitations = useQuery(staffInvitationsQueryOptions(userId));
  const inviters = useQuery({
    ...peopleQueryOptions(
      userId,
      invitations.data?.flatMap((i) => (i.created_by ? [i.created_by] : [])) ?? [],
    ),
    enabled: (invitations.data?.length ?? 0) > 0,
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
  if (invitations.isPending) return <Skeleton className="h-20 w-full" />;
  if (invitations.data.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("admin.team.invitationsNone")}</p>;
  }
  return (
    <ul className="divide-y rounded-md border">
      {invitations.data.map((invitation) => (
        <InvitationRow
          key={invitation.id}
          userId={userId}
          invitation={invitation}
          isAdmin={isAdmin}
          inviter={
            invitation.created_by ? (inviters.data?.get(invitation.created_by) ?? null) : null
          }
        />
      ))}
    </ul>
  );
}

function InvitationRow({
  userId,
  invitation,
  isAdmin,
  inviter,
}: {
  userId: string;
  invitation: InvitationSummary;
  isAdmin: boolean;
  inviter: string | null;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [resent, setResent] = useState<Resent | null>(null);
  const guard = useLinkGuard(resent?.link ?? null, () => setResent(null));
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const state = invitationState(invitation);
  const live = resendAvailability(invitation, new Date());
  useTicker(!live.ok && live.reason === "wait");
  const hintId = `staff-invitation-${invitation.id}-hint`;
  const role = invitation.staff_role ?? "staff";

  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.team(userId) });

  const resend = useMutation({
    mutationFn: () => submitResendInvitation({ invitationId: invitation.id }),
    onSuccess: async (result) => {
      setResent(result);
      toast.success(t("admin.invitations.section.resent"));
      await refresh();
    },
    onError: (e) =>
      toast.error(`${t("admin.invitations.section.resendFailed")} ${errorMessage(e)}`),
  });

  const revoke = useMutation({
    mutationFn: () => revokeInvitation(supabase, invitation.id),
    onSuccess: async () => {
      setConfirmRevoke(false);
      toast.success(t("admin.invitations.section.revoked"));
      await refresh();
    },
    onError: (e) =>
      toast.error(`${t("admin.invitations.section.revokeFailed")} ${errorMessage(e)}`),
  });

  return (
    <li className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 space-y-1.5 text-sm">
        <p className="break-all font-semibold text-foreground">{invitation.email}</p>
        <div className="flex flex-wrap items-center gap-2">
          <InvitationStateBadge state={state} />
          <Badge variant={role === "admin" ? "default" : "neutral"}>
            {t("admin.team.invitation.role", { role: t(`admin.roles.${role}`).toLowerCase() })}
          </Badge>
        </div>
        <p className="text-muted-foreground tabular-nums">
          {state === "expired"
            ? `${t("admin.invitations.section.expiredOn")} ${formatDateTime(invitation.expires_at)}`
            : `${t("admin.invitations.section.expires")} ${formatDateTime(invitation.expires_at)}`}
          {invitation.last_sent_at
            ? ` · ${t("admin.invitations.section.lastSent")} ${formatDateTime(invitation.last_sent_at)}`
            : null}
          {sendsToday(invitation) >= 2
            ? ` (${t("admin.invitations.section.sentToday", {
                count: sendsToday(invitation),
                max: RESEND_DAILY_LIMIT,
              })})`
            : null}
        </p>
        {inviter ? (
          <p className="text-muted-foreground">
            {t("admin.team.invitation.sentBy", { name: inviter })}
          </p>
        ) : null}
      </div>
      {isAdmin ? (
        <div className="space-y-1.5 lg:max-w-xs lg:text-right">
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Button
              size="sm"
              onClick={() => resend.mutate()}
              disabled={resend.isPending || !live.ok}
              aria-describedby={hintId}
              aria-label={`${t("admin.invitations.section.resend")}: ${invitation.email}`}
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
              aria-label={`${t("admin.invitations.section.revoke")}: ${invitation.email}`}
            >
              <MailX aria-hidden />
              {t("admin.invitations.section.revoke")}
            </Button>
          </div>
          <p id={hintId} className="text-xs text-muted-foreground" aria-live="polite">
            {!live.ok
              ? live.reason === "wait"
                ? t("admin.invitations.section.resendWait", { seconds: live.seconds })
                : t("admin.invitations.section.resendLimit")
              : t("admin.invitations.section.resendHint")}
          </p>
        </div>
      ) : null}

      <Dialog open={resent !== null} onOpenChange={(open) => !open && guard.requestClose()}>
        <DialogContent
          className="max-h-[92vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-card sm:max-w-xl"
          {...guard.contentProps}
        >
          <DialogHeader>
            <DialogTitle className="font-heading text-primary">
              {t("admin.team.invite.linkTitle", { email: invitation.email })}
            </DialogTitle>
            <DialogDescription>{t("admin.invitations.section.resendHint")}</DialogDescription>
          </DialogHeader>
          {resent ? (
            <ShareLinkPanel
              link={resent.link}
              label={t("admin.invitations.linkLabel")}
              copyLabel={t("admin.invitations.copy")}
              shareText={invitationShareText({
                kind: "staff",
                fullName: null,
                customerCode: null,
                email: resent.invitation.email,
                link: resent.link,
              })}
              phone={null}
              emailed={resent.emailed}
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
              {t("admin.invitations.section.revokeText", { email: invitation.email })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={revoke.isPending}>
              {t("admin.team.block.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={revoke.isPending}
              onClick={(e) => {
                e.preventDefault();
                revoke.mutate();
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
    </li>
  );
}
