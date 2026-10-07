import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { AlertTriangle, Ban, CircleCheck, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Callout } from "@/components/admin/Callout";
import { Problem, ReasonField } from "@/components/admin/customers/CustomerActionDialogs";
import { ShareLinkPanel } from "@/components/admin/customers/ShareLinkPanel";
import { useLinkGuard } from "@/components/admin/customers/link-guard";
import { UnsharedLinkPrompt } from "@/components/admin/customers/one-time-link";
import { RolePicker } from "@/components/admin/team/RolePicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { reasonText } from "@/lib/admin/customer-actions";
import { recoveryShareText } from "@/lib/admin/invitations";
import { adminKeys } from "@/lib/admin/keys";
import {
  changeTeamRole,
  effectiveRole,
  memberName,
  pendingInvitationsBy,
  type AppRole,
  type TeamMember,
} from "@/lib/admin/team";
import { roleQueryKey } from "@/lib/auth/roles";
import { errorMessage, toAppError } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import {
  submitTeamLoginBlocked,
  submitTeamRecoveryLink,
  type TeamRecoveryLinkResponse,
} from "@/lib/server-fns/team.functions";

const DIALOG = "max-h-[92vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-card";

// ---------------------------------------------------------------------------
// "Rol wijzigen" (set_user_role with the admin's own client)
// ---------------------------------------------------------------------------

/**
 * Medewerker ↔ Beheerder. The database keeps at least one admin who can sign
 * in (set_user_role); a refusal is explained. Changing your own role reloads
 * the area, so the menu and pages follow the new rights at once.
 */
export function RoleDialog({
  userId,
  member,
  open,
  onOpenChange,
}: {
  userId: string;
  member: TeamMember;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const current = effectiveRole(member.roles);
  const [role, setRole] = useState<AppRole>(current);
  const [problem, setProblem] = useState<string | null>(null);
  const self = member.userId === userId;
  const name = memberName(member);

  const save = useMutation({
    mutationFn: (next: AppRole) => changeTeamRole(supabase, member, next),
    onSuccess: async (result, next) => {
      const label = t(`admin.roles.${next}`).toLowerCase();
      toast.success(
        result.changed
          ? t("admin.team.role.saved", { name, role: label })
          : t("admin.team.role.unchanged", { name, role: label }),
      );
      await queryClient.invalidateQueries({ queryKey: adminKeys.team(userId) });
      onOpenChange(false);
      if (self && result.changed) {
        await queryClient.invalidateQueries({ queryKey: roleQueryKey(userId) });
        await router.invalidate();
      }
    },
    onError: (e) => {
      const message =
        toAppError(e).code === "55000"
          ? `${errorMessage(e)} ${t("admin.team.role.lastAdmin")}`
          : errorMessage(e);
      setProblem(message);
      toast.error(`${t("admin.team.role.failed")} ${message}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    save.mutate(role);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className={`${DIALOG} sm:max-w-xl`}>
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {t("admin.team.role.title", { name })}
          </DialogTitle>
          <DialogDescription>{t("admin.team.role.intro")}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="min-w-0 space-y-4">
          <RolePicker
            idPrefix={id}
            label={t("admin.team.columns.role")}
            value={role}
            onChange={(next) => {
              setRole(next);
              setProblem(null);
            }}
          />
          {self && current === "admin" && role === "staff" ? (
            <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              {t("admin.team.role.selfWarning")}
            </p>
          ) : null}
          <Problem prefix={t("admin.team.role.failed")} message={problem} />
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={save.isPending}
            >
              {t("admin.team.role.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <ShieldCheck aria-hidden />
              )}
              {save.isPending ? t("admin.team.role.saving") : t("admin.team.role.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// "Deactiveren" / "Activeren" (setTeamLoginBlockedFn: ban + audit)
// ---------------------------------------------------------------------------

export function BlockLoginDialog({
  userId,
  member,
  open,
  onOpenChange,
}: {
  userId: string;
  member: TeamMember;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const blocking = member.blocked !== true;
  const name = memberName(member);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // What the deactivation revokes: the member saw those links, so they all go.
  const pending = useQuery({
    queryKey: adminKeys.teamPendingBy(userId, member.userId),
    queryFn: () => pendingInvitationsBy(supabase, member.userId),
    enabled: open && blocking,
  });

  const run = useMutation({
    mutationFn: (validReason: string) =>
      submitTeamLoginBlocked({ userId: member.userId, blocked: blocking, reason: validReason }),
    onSuccess: async (result) => {
      toast.success(
        blocking ? t("admin.team.block.done", { name }) : t("admin.team.block.undone", { name }),
      );
      if (result.revokedInvitations > 0) {
        toast.info(
          t(
            result.revokedInvitations === 1
              ? "admin.team.block.revokedOne"
              : "admin.team.block.revokedMany",
            { count: result.revokedInvitations },
          ),
        );
      }
      if (!result.logged) {
        toast.warning(
          result.logError
            ? `${t("admin.team.block.notLogged")} ${result.logError.message}`
            : t("admin.team.block.notLogged"),
          { duration: 15_000 },
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.team(userId) }),
        queryClient.invalidateQueries({ queryKey: adminKeys.customers(userId) }),
      ]);
      onOpenChange(false);
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(`${t("admin.team.block.failed")} ${errorMessage(e)}`);
    },
  });
  const customerInvites = (pending.data ?? []).filter((i) => i.kind === "customer");
  const staffInvites = (pending.data ?? []).filter((i) => i.kind === "staff");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const parsed = reasonText.safeParse(reason);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? null);
      document.getElementById(`${id}-reason`)?.focus();
      return;
    }
    setError(null);
    run.mutate(parsed.data);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !run.isPending && onOpenChange(next)}>
      <DialogContent className={`${DIALOG} sm:max-w-lg`}>
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {blocking
              ? t("admin.team.block.title", { name })
              : t("admin.team.block.undoTitle", { name })}
          </DialogTitle>
          <DialogDescription>
            {blocking
              ? t("admin.team.block.text", { name })
              : t("admin.team.block.undoText", {
                  name,
                  role: t(`admin.roles.${effectiveRole(member.roles)}`).toLowerCase(),
                })}
          </DialogDescription>
        </DialogHeader>
        {blocking && pending.isError ? (
          <p className="text-sm text-muted-foreground">{t("admin.team.block.pendingUnknown")}</p>
        ) : null}
        {blocking && (customerInvites.length > 0 || staffInvites.length > 0) ? (
          <Callout
            tone="warning"
            icon={AlertTriangle}
            title={t("admin.team.block.pendingTitle", { name })}
          >
            {customerInvites.length > 0 ? (
              <>
                <p>{t("admin.team.block.pendingCustomers")}</p>
                <ul className="list-disc space-y-1 pl-5">
                  {customerInvites.map((i) => (
                    <li key={i.id}>
                      {i.customer ? (
                        <Link
                          to="/admin/klanten/$id"
                          params={{ id: i.customer.id }}
                          className="font-semibold text-primary underline underline-offset-4"
                        >
                          {i.customer.full_name} ({i.customer.customer_code})
                        </Link>
                      ) : (
                        <span className="break-words">{i.email}</span>
                      )}
                      {i.expired ? ` ${t("admin.team.block.pendingExpired")}` : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {staffInvites.length > 0 ? (
              <p>
                {t(
                  staffInvites.length === 1
                    ? "admin.team.block.pendingStaffOne"
                    : "admin.team.block.pendingStaffMany",
                  { count: staffInvites.length },
                )}
              </p>
            ) : null}
          </Callout>
        ) : null}
        <form noValidate onSubmit={submit} className="min-w-0 space-y-4">
          <ReasonField
            id={`${id}-reason`}
            label={t("admin.team.block.reason")}
            hint={t("admin.team.block.reasonHint")}
            {...(blocking ? { placeholder: t("admin.team.block.reasonPlaceholder") } : {})}
            value={reason}
            onChange={(v) => {
              setReason(v);
              setError(null);
            }}
            error={error}
          />
          <Problem prefix={t("admin.team.block.failed")} message={problem} />
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={run.isPending}
            >
              {t("admin.team.block.cancel")}
            </Button>
            <Button
              type="submit"
              variant={blocking ? "destructive" : "default"}
              disabled={run.isPending}
            >
              {run.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : blocking ? (
                <Ban aria-hidden />
              ) : (
                <CircleCheck aria-hidden />
              )}
              {run.isPending
                ? t("admin.team.block.busy")
                : blocking
                  ? t("admin.team.block.confirm")
                  : t("admin.team.block.undoConfirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// "Wachtwoord-resetlink maken" for a team member (admins)
// ---------------------------------------------------------------------------

export function TeamRecoveryDialog({
  member,
  open,
  onOpenChange,
}: {
  member: TeamMember;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const name = memberName(member);
  const [result, setResult] = useState<Extract<TeamRecoveryLinkResponse, { ok: true }> | null>(
    null,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => submitTeamRecoveryLink({ userId: member.userId }),
    onSuccess: (link) => {
      setResult(link);
      toast.success(t("admin.recovery.created"));
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(`${t("admin.recovery.failed")} ${errorMessage(e)}`);
    },
  });

  const finish = () => {
    onOpenChange(false);
    setResult(null);
    setProblem(null);
  };
  // The link is shown once: closing before it was copied or shared asks first.
  const guard = useLinkGuard(result?.link ?? null, finish);
  const close = (next: boolean) => {
    if (create.isPending) return;
    if (next) onOpenChange(true);
    else guard.requestClose();
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={`${DIALOG} sm:max-w-xl`} {...guard.contentProps}>
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {t("admin.team.recovery.title", { name })}
          </DialogTitle>
          <DialogDescription>{t("admin.team.recovery.intro", { name })}</DialogDescription>
        </DialogHeader>
        {result ? (
          <ShareLinkPanel
            link={result.link}
            label={t("admin.recovery.linkLabel")}
            copyLabel={t("admin.recovery.copy")}
            shareText={recoveryShareText({ fullName: member.displayName, link: result.link })}
            phone={null}
            emailOutcome={null}
            linkSource={result.linkSource}
            notes={[t("admin.recovery.validity")]}
            onShared={guard.markShared}
          />
        ) : (
          <Problem prefix={t("admin.recovery.failed")} message={problem} />
        )}
        <UnsharedLinkPrompt guard={guard} />
        <DialogFooter className="gap-2">
          {result ? (
            <Button onClick={() => close(false)}>{t("admin.recovery.close")}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => close(false)} disabled={create.isPending}>
                {t("admin.recovery.cancel")}
              </Button>
              <Button onClick={() => create.mutate()} disabled={create.isPending}>
                {create.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <KeyRound aria-hidden />
                )}
                {create.isPending ? t("admin.recovery.creating") : t("admin.recovery.create")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
