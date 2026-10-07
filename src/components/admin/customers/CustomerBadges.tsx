import {
  Ban,
  Briefcase,
  CircleCheck,
  KeyRound,
  MailCheck,
  MailQuestion,
  MailX,
  Send,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { InvitationState } from "@/lib/admin/invitations";
import { customerStatusTone, type AccountType, type CustomerStatus } from "@/lib/admin/customers";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const STATUS_ICONS = { active: CircleCheck, invited: Send, disabled: Ban } as const;

/** Actief / Uitgenodigd / Gedeactiveerd: text plus icon, never colour alone (SPEC §35.10). */
export function CustomerStatusBadge({
  status,
  className,
}: {
  status: CustomerStatus;
  className?: string;
}) {
  const t = useT();
  const Icon = STATUS_ICONS[status];
  return (
    <Badge variant={customerStatusTone(status)} className={className}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {t(`admin.customers.statuses.${status}`)}
    </Badge>
  );
}

export function AccountTypeBadge({ type, className }: { type: AccountType; className?: string }) {
  const t = useT();
  if (type === "business") {
    return (
      <Badge variant="outline" className={cn("border-primary/40 text-primary", className)}>
        <Briefcase className="size-3.5 shrink-0" aria-hidden />
        {t("admin.customers.accountTypes.business")}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={className}>
      <UserRound className="size-3.5 shrink-0" aria-hidden />
      {t("admin.customers.accountTypes.personal")}
    </Badge>
  );
}

/** "Zonder login" for customers who cannot sign in (yet). */
export function NoLoginBadge({ className }: { className?: string }) {
  const t = useT();
  return (
    <Badge variant="outline" className={cn("px-1.5 py-0 text-[0.7rem]", className)}>
      <KeyRound className="size-3 shrink-0" aria-hidden />
      {t("admin.customers.noLogin")}
    </Badge>
  );
}

const INVITATION_ICONS = {
  open: Send,
  expired: MailQuestion,
  accepted: MailCheck,
  revoked: MailX,
} as const;

export function InvitationStateBadge({
  state,
  className,
}: {
  state: InvitationState;
  className?: string;
}) {
  const t = useT();
  const Icon = INVITATION_ICONS[state];
  return (
    <Badge
      variant={state === "open" ? "info" : state === "expired" ? "warning" : "neutral"}
      className={className}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {t(`admin.customers.invitationStates.${state}`)}
    </Badge>
  );
}
