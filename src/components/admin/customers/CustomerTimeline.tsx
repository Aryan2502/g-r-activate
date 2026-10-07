import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { History } from "lucide-react";

import { LoadError, Section } from "@/components/portal/Section";
import { Skeleton } from "@/components/ui/skeleton";
import type { InvitationSummary } from "@/lib/admin/customer-actions";
import {
  buildCustomerTimeline,
  customerAuditQueryOptions,
  type CustomerRow,
  type TimelineEvent,
} from "@/lib/admin/customers";
import { peopleQueryOptions, personName } from "@/lib/admin/orders";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";

function useEventText() {
  const t = useT();
  return (event: TimelineEvent): string => {
    switch (event.kind) {
      case "created":
        return event.detail
          ? t("admin.customers.timeline.created", { code: event.detail })
          : t("admin.customers.timeline.createdNoCode");
      case "edited":
        return t("admin.customers.timeline.edited", { fields: event.detail ?? "" });
      case "email_changed":
        return t("admin.customers.timeline.email_changed", { detail: event.detail ?? "" });
      case "code_changed":
        return t("admin.customers.timeline.code_changed", { detail: event.detail ?? "" });
      case "invited":
        return t("admin.customers.timeline.invited", { detail: event.detail ?? "" });
      case "disabled":
        return event.detail
          ? `${t("admin.customers.timeline.disabled")} · ${event.detail}`
          : t("admin.customers.timeline.disabled");
      default:
        return t(`admin.customers.timeline.${event.kind}`);
    }
  };
}

/**
 * The customer's history in readable Dutch (SPEC §35.13 subset: created,
 * edited, disabled, code assigned/changed, plus the invitations). Admins
 * read it from audit_log (who and when for every change); staff, who may not
 * read the audit log, get the events the rows themselves record.
 */
export function CustomerTimeline({
  userId,
  isAdmin,
  customer,
  invitations,
}: {
  userId: string;
  isAdmin: boolean;
  customer: CustomerRow;
  invitations: UseQueryResult<InvitationSummary[]>;
}) {
  const t = useT();
  const text = useEventText();
  const invitationIds = (invitations.data ?? []).map((i) => i.id);
  const audit = useQuery({
    ...customerAuditQueryOptions(userId, customer.id, invitationIds),
    enabled: isAdmin && invitations.data !== undefined,
  });
  const events =
    invitations.data && (!isAdmin || audit.data)
      ? buildCustomerTimeline({ customer, invitations: invitations.data, audit: audit.data })
      : null;
  const actorIds = (events ?? []).flatMap((e) =>
    e.actorId && e.actorId !== customer.user_id ? [e.actorId] : [],
  );
  const people = useQuery({
    ...peopleQueryOptions(userId, actorIds),
    enabled: actorIds.length > 0,
  });
  const failed = invitations.isError ? invitations : audit.isError ? audit : null;

  return (
    <Section
      title={t("admin.customers.detail.timelineTitle")}
      icon={History}
      id="customer-timeline"
      description={
        isAdmin
          ? t("admin.customers.detail.timelineIntroAdmin")
          : t("admin.customers.detail.timelineIntroStaff")
      }
    >
      {failed ? (
        <LoadError
          title={t("admin.customers.detail.timelineLoadFailed")}
          error={failed.error}
          onRetry={() => void failed.refetch()}
        />
      ) : !events ? (
        <Skeleton className="h-24 w-full" />
      ) : events.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.customers.detail.timelineEmpty")}</p>
      ) : (
        <ol className="relative space-y-4 border-l border-border pl-5">
          {[...events].reverse().map((event) => (
            <li key={event.key} className="relative">
              <span
                className="absolute -left-[1.6rem] top-1.5 size-2.5 rounded-full border-2 border-card bg-primary"
                aria-hidden
              />
              <p className="break-words text-sm font-medium leading-6 text-foreground">
                {text(event)}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatDateTime(event.at)}
                {" · "}
                {event.actorId
                  ? t("admin.customers.timeline.by", {
                      name: personName(event.actorId, people.data, customer.user_id),
                    })
                  : t("admin.customers.timeline.system")}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
