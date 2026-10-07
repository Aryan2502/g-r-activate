import type { ReactNode } from "react";
import { Building2, EyeOff, History, UserRound } from "lucide-react";

import { LoadError, Section } from "@/components/portal/Section";
import { StageIcon } from "@/components/portal/StatusBadges";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { personName, type AdminHistoryEntry } from "@/lib/admin/orders";
import type { AdminStatusMap } from "@/lib/admin/statuses";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";

/**
 * The full status history for staff (SPEC §28, §35.13): every change, also
 * to statuses the customer cannot see, as a readable Dutch line
 * "Aangekomen in US-magazijn → Onderweg naar Suriname", with when, who
 * ("door Maria", from profiles) and the message the customer saw.
 */
export function StaffStatusHistory({
  order,
  statuses,
  history,
  people,
  customerUserId,
}: {
  order: { created_at: string; created_by: string | null; created_by_role: "customer" | "staff" };
  statuses: AdminStatusMap;
  history: {
    data: readonly AdminHistoryEntry[] | undefined;
    error: unknown;
    isError: boolean;
    refetch: () => unknown;
  };
  people: ReadonlyMap<string, string | null> | undefined;
  customerUserId: string | null;
}) {
  const t = useT();
  const label = (code: string) => statuses.get(code)?.label_nl ?? code;
  const name = (id: string | null) => personName(id, people, customerUserId);

  return (
    <Section title={t("admin.order.history.title")} icon={History} id="order-history">
      {history.isError ? (
        <LoadError
          title={t("admin.order.history.loadFailed")}
          error={history.error}
          onRetry={() => void history.refetch()}
        />
      ) : !history.data ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <ol>
          <Event
            icon={<StageIcon stage="registered" className="size-4" />}
            title={
              order.created_by_role === "customer"
                ? t("admin.order.history.registeredByCustomer")
                : t("admin.order.history.createdByStaff")
            }
            at={order.created_at}
            by={order.created_by_role === "customer" ? null : name(order.created_by)}
            byCustomer={order.created_by_role === "customer"}
            last={history.data.length === 0}
          />
          {history.data.map((entry, i) => {
            const to = statuses.get(entry.to_status);
            return (
              <Event
                key={entry.id}
                icon={<StageIcon stage={to?.stage ?? null} className="size-4" />}
                title={
                  entry.from_status === entry.to_status
                    ? t("admin.order.history.newMessage", { status: label(entry.to_status) })
                    : t("admin.order.history.change", {
                        from: label(entry.from_status),
                        to: label(entry.to_status),
                      })
                }
                at={entry.changed_at}
                by={name(entry.changed_by)}
                byCustomer={false}
                hidden={to ? !to.customer_visible : false}
                message={entry.customer_message}
                last={i === history.data!.length - 1}
              />
            );
          })}
        </ol>
      )}
    </Section>
  );
}

function Event({
  icon,
  title,
  at,
  by,
  byCustomer,
  hidden = false,
  message,
  last,
}: {
  icon: ReactNode;
  title: string;
  at: string;
  by: string | null;
  byCustomer: boolean;
  hidden?: boolean;
  message?: string | null;
  last: boolean;
}) {
  const t = useT();
  const ByIcon = byCustomer ? UserRound : Building2;
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!last ? (
        <span aria-hidden className="absolute left-4 top-9 h-[calc(100%-2.25rem)] w-px bg-border" />
      ) : null}
      <span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full bg-cream text-primary">
        {icon}
      </span>
      <div className="min-w-0 flex-1 pt-1 text-sm">
        <p className="break-words font-semibold text-foreground">{title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground tabular-nums">
          <time dateTime={at}>{formatDateTime(at)}</time>
          {by ? (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <ByIcon className="size-3.5" aria-hidden />
                {t("admin.order.history.by", { name: by })}
              </span>
            </>
          ) : null}
          {hidden ? (
            <Badge variant="neutral" className="px-1.5 py-0">
              <EyeOff className="size-3 shrink-0" aria-hidden />
              {t("admin.order.history.hidden")}
            </Badge>
          ) : null}
        </div>
        {message?.trim() ? (
          <blockquote className="mt-2 whitespace-pre-line break-words rounded-md border-l-4 border-primary/40 bg-cream px-3 py-2 leading-6 text-foreground">
            <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("admin.order.history.messageLabel")}
            </span>
            {message.trim()}
          </blockquote>
        ) : null}
      </div>
    </li>
  );
}
