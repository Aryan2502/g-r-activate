import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import {
  Ban,
  CircleCheck,
  CircleHelp,
  Info,
  KeyRound,
  Lock,
  MailPlus,
  MoreHorizontal,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";

import { Callout } from "@/components/admin/Callout";
import { InviteStaffDialog } from "@/components/admin/team/InviteStaffDialog";
import { StaffInvitations } from "@/components/admin/team/StaffInvitations";
import {
  BlockLoginDialog,
  RoleDialog,
  TeamRecoveryDialog,
} from "@/components/admin/team/TeamDialogs";
import { ShellPageHeader } from "@/components/layout/AppShell";
import { LoadError, Muted, Section } from "@/components/portal/Section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { effectiveRole, memberName, type TeamMember } from "@/lib/admin/team";
import { teamQueryOptions } from "@/lib/admin/team-queries";
import { formatDate, formatDateTime } from "@/lib/format";
import { t, useT } from "@/lib/i18n";

/**
 * /admin/team (SPEC §35.4): staff and admins. Admins invite staff (a staff
 * invitation with the same token rules as customers), change roles
 * (set_user_role, which keeps the last admin) and deactivate a login (ban +
 * audit, setTeamLoginBlockedFn); staff see the list read-only.
 */
export const Route = createFileRoute("/admin/team")({
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("admin.team.title") }) }] }),
  component: TeamPage,
});

const adminRoute = getRouteApi("/admin");

type DialogKind = "role" | "block" | "recovery";

function TeamPage() {
  const t = useT();
  const { auth } = adminRoute.useRouteContext();
  const isAdmin = auth.role === "admin";
  const team = useQuery(teamQueryOptions(auth.userId));
  const [inviting, setInviting] = useState(false);
  const [dialog, setDialog] = useState<{ kind: DialogKind; member: TeamMember } | null>(null);
  const open = (kind: DialogKind) => (member: TeamMember) => setDialog({ kind, member });

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <ShellPageHeader
          title={t("admin.team.title")}
          description={t("admin.team.intro")}
          className="mb-0"
        />
        {isAdmin ? (
          <Button className="self-start" onClick={() => setInviting(true)}>
            <UserPlus aria-hidden />
            {t("admin.team.inviteAction")}
          </Button>
        ) : null}
      </div>

      <div className="space-y-6">
        {isAdmin ? null : <Callout tone="neutral" icon={Lock} title={t("admin.team.readOnly")} />}

        <Section title={t("admin.team.membersTitle")} icon={Users} id="team-members">
          {team.isError ? (
            <LoadError
              title={t("admin.team.loadFailed")}
              error={team.error}
              onRetry={() => void team.refetch()}
            />
          ) : team.isPending ? (
            <div className="space-y-3" aria-busy="true">
              <span className="sr-only">{t("common.loading")}</span>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              {team.data.complete ? null : (
                <Callout
                  tone="info"
                  icon={Info}
                  title={isAdmin ? t("admin.team.incomplete") : t("admin.team.incompleteStaff")}
                />
              )}
              {team.data.members.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("admin.team.empty")}</p>
              ) : (
                <>
                  <MembersTable
                    members={team.data.members}
                    selfId={auth.userId}
                    isAdmin={isAdmin}
                    onRole={open("role")}
                    onBlock={open("block")}
                    onRecovery={open("recovery")}
                  />
                  <MemberCards
                    members={team.data.members}
                    selfId={auth.userId}
                    isAdmin={isAdmin}
                    onRole={open("role")}
                    onBlock={open("block")}
                    onRecovery={open("recovery")}
                  />
                </>
              )}
            </div>
          )}
        </Section>

        <Section
          title={t("admin.team.invitationsTitle")}
          icon={MailPlus}
          description={t("admin.team.invitationsIntro")}
          id="team-invitations"
        >
          <StaffInvitations userId={auth.userId} isAdmin={isAdmin} />
        </Section>
      </div>

      {isAdmin ? (
        <InviteStaffDialog userId={auth.userId} open={inviting} onOpenChange={setInviting} />
      ) : null}
      {isAdmin && dialog?.kind === "role" ? (
        <RoleDialog
          key={dialog.member.userId}
          userId={auth.userId}
          member={dialog.member}
          open
          onOpenChange={(next) => !next && setDialog(null)}
        />
      ) : null}
      {isAdmin && dialog?.kind === "block" ? (
        <BlockLoginDialog
          key={dialog.member.userId}
          userId={auth.userId}
          member={dialog.member}
          open
          onOpenChange={(next) => !next && setDialog(null)}
        />
      ) : null}
      {isAdmin && dialog?.kind === "recovery" ? (
        <TeamRecoveryDialog
          key={dialog.member.userId}
          member={dialog.member}
          open
          onOpenChange={(next) => !next && setDialog(null)}
        />
      ) : null}
    </>
  );
}

interface RowProps {
  selfId: string;
  isAdmin: boolean;
  onRole: (member: TeamMember) => void;
  onBlock: (member: TeamMember) => void;
  onRecovery: (member: TeamMember) => void;
}

function MemberIdentity({ member, selfId }: { member: TeamMember; selfId: string }) {
  const t = useT();
  return (
    <div className="min-w-0">
      <p className="break-words font-semibold text-foreground">
        {memberName(member)}
        {member.userId === selfId ? (
          <span className="ml-1.5 font-normal text-muted-foreground">({t("admin.team.you")})</span>
        ) : null}
      </p>
      {member.email && member.displayName ? (
        <p className="break-all text-sm text-muted-foreground">{member.email}</p>
      ) : null}
    </div>
  );
}

function RoleBadge({ member }: { member: TeamMember }) {
  const t = useT();
  const role = effectiveRole(member.roles);
  return (
    <Badge variant={role === "admin" ? "default" : "neutral"}>
      <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
      {t(`admin.roles.${role}`)}
    </Badge>
  );
}

function LoginBadge({ member }: { member: TeamMember }) {
  const t = useT();
  if (member.blocked === null) {
    return (
      <Badge variant="outline">
        <CircleHelp className="size-3.5 shrink-0" aria-hidden />
        {t("admin.team.status.unknown")}
      </Badge>
    );
  }
  return member.blocked ? (
    <Badge variant="danger">
      <Ban className="size-3.5 shrink-0" aria-hidden />
      {t("admin.team.status.blocked")}
    </Badge>
  ) : (
    <Badge variant="success">
      <CircleCheck className="size-3.5 shrink-0" aria-hidden />
      {t("admin.team.status.active")}
    </Badge>
  );
}

function LastSignIn({ member }: { member: TeamMember }) {
  const t = useT();
  if (member.email === null) return <Muted>{t("admin.team.status.unknown")}</Muted>;
  return member.lastSignInAt ? (
    <span className="tabular-nums">{formatDateTime(member.lastSignInAt)}</span>
  ) : (
    <Muted>{t("admin.team.neverSignedIn")}</Muted>
  );
}

function MemberActions({
  member,
  selfId,
  isAdmin,
  onRole,
  onBlock,
  onRecovery,
}: RowProps & { member: TeamMember }) {
  const t = useT();
  if (!isAdmin) return null;
  const name = memberName(member);
  const self = member.userId === selfId;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-9 shrink-0 text-primary">
          <MoreHorizontal aria-hidden />
          <span className="sr-only">{t("admin.team.actionsLabel", { name })}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        <DropdownMenuItem onSelect={() => onRole(member)}>
          <ShieldCheck aria-hidden />
          {t("admin.team.role.change")}
        </DropdownMenuItem>
        {member.blocked ? null : (
          <DropdownMenuItem onSelect={() => onRecovery(member)}>
            <KeyRound aria-hidden />
            {t("admin.team.recovery.action")}
          </DropdownMenuItem>
        )}
        {self ? null : (
          <>
            <DropdownMenuSeparator />
            {member.blocked ? (
              <DropdownMenuItem onSelect={() => onBlock(member)}>
                <CircleCheck aria-hidden />
                {t("admin.team.block.undo")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onSelect={() => onBlock(member)}
                className="text-destructive focus:text-destructive"
              >
                <Ban aria-hidden />
                {t("admin.team.block.action")}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MembersTable({ members, ...props }: RowProps & { members: TeamMember[] }) {
  const t = useT();
  const th = "px-3 py-3 font-bold text-primary";
  return (
    <div className="relative hidden overflow-x-auto rounded-md border xl:block">
      <table className="w-full text-sm">
        <caption className="sr-only">{t("admin.team.membersTitle")}</caption>
        <thead className="border-b bg-cream text-left">
          <tr>
            <th scope="col" className={th}>
              {t("admin.team.columns.member")}
            </th>
            <th scope="col" className={th}>
              {t("admin.team.columns.role")}
            </th>
            <th scope="col" className={th}>
              {t("admin.team.columns.status")}
            </th>
            <th scope="col" className={th}>
              {t("admin.team.columns.lastSignIn")}
            </th>
            <th scope="col" className={th}>
              {t("admin.team.columns.since")}
            </th>
            {props.isAdmin ? (
              <th scope="col" className={`${th} text-right`}>
                <span className="sr-only">{t("admin.team.columns.actions")}</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y">
          {members.map((member) => (
            <tr key={member.userId} className="align-top">
              <td className="max-w-80 px-3 py-3">
                <MemberIdentity member={member} selfId={props.selfId} />
              </td>
              <td className="px-3 py-3">
                <RoleBadge member={member} />
              </td>
              <td className="px-3 py-3">
                <LoginBadge member={member} />
              </td>
              <td className="whitespace-nowrap px-3 py-3">
                <LastSignIn member={member} />
              </td>
              <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                {member.memberSince ? formatDate(member.memberSince) : <Muted>–</Muted>}
              </td>
              {props.isAdmin ? (
                <td className="px-3 py-2 text-right">
                  <MemberActions member={member} {...props} />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CardItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 min-w-0 text-sm text-foreground">{children}</dd>
    </div>
  );
}

function MemberCards({ members, ...props }: RowProps & { members: TeamMember[] }) {
  const t = useT();
  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:hidden">
      {members.map((member) => (
        <li key={member.userId} className="min-w-0 rounded-md border p-4">
          <div className="flex items-start justify-between gap-2">
            <MemberIdentity member={member} selfId={props.selfId} />
            <MemberActions member={member} {...props} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-3">
            <CardItem label={t("admin.team.columns.role")}>
              <RoleBadge member={member} />
            </CardItem>
            <CardItem label={t("admin.team.columns.status")}>
              <LoginBadge member={member} />
            </CardItem>
            <CardItem label={t("admin.team.columns.lastSignIn")}>
              <LastSignIn member={member} />
            </CardItem>
            <CardItem label={t("admin.team.columns.since")}>
              <span className="tabular-nums">
                {member.memberSince ? formatDate(member.memberSince) : "–"}
              </span>
            </CardItem>
          </dl>
        </li>
      ))}
    </ul>
  );
}
