import type { ReactNode } from "react";
import { Building2, Check, History, UserRound } from "lucide-react";

import { LoadError, Section } from "@/components/portal/Section";
import { StageIcon } from "@/components/portal/StatusBadges";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import {
  journeySteps,
  resolveStatus,
  type OrderDetail,
  type StatusHistoryEntry,
  type StatusMap,
  type StatusStage,
} from "@/lib/portal/orders";
import { cn } from "@/lib/utils";

/**
 * The normal journey of a package (SPEC §10): one step per stage, labelled with
 * the status G&R configured for it. Off the normal path the stages already
 * passed are ticked and the order's own status is the current step: "Actie
 * vereist" with the journey still ahead, or a final "Geannuleerd".
 */
export function JourneyProgress({
  stage,
  label,
  statuses,
  history,
}: {
  stage: StatusStage | null;
  /** The order's own status label, for an off-path step (e.g. which action is required). */
  label: string | null;
  statuses: StatusMap;
  history: readonly StatusHistoryEntry[];
}) {
  const t = useT();
  const reached = history.map((h) => statuses.get(h.to_status)?.stage ?? null);
  const steps = journeySteps(stage, statuses, reached, label);

  return (
    <div>
      <h3 className="text-sm font-semibold text-muted-foreground">
        {t("portal.order.timeline.progress")}
      </h3>
      <ol className="mt-3 space-y-0">
        {steps.map((step, i) => {
          const label = step.label ?? t(`portal.stages.${step.stage}`);
          const last = i === steps.length - 1;
          return (
            <li key={step.stage} className="relative flex gap-3 pb-3 last:pb-0">
              {!last ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-[0.8125rem] top-7 h-[calc(100%-1.75rem)] w-0.5",
                    step.state === "done" ? "bg-primary" : "bg-border",
                  )}
                />
              ) : null}
              <span
                aria-hidden
                className={cn(
                  "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-2",
                  step.state === "done" && "border-primary bg-primary text-primary-foreground",
                  step.state === "current" &&
                    (step.stage === "action_required"
                      ? "border-warning bg-warning-soft text-warning"
                      : step.stage === "cancelled"
                        ? "border-neutral bg-neutral-soft text-neutral"
                        : "border-primary bg-cream text-primary"),
                  step.state === "upcoming" && "border-border bg-card text-muted-foreground",
                )}
              >
                {step.state === "done" ? (
                  <Check className="size-3.5" />
                ) : (
                  <StageIcon stage={step.stage} className="size-3.5" />
                )}
              </span>
              <span
                className={cn(
                  "pt-1 text-sm",
                  step.state === "current" && "font-bold text-primary",
                  step.state === "done" && "text-foreground",
                  step.state === "upcoming" && "text-muted-foreground",
                )}
              >
                {label}
                <span className="sr-only">
                  {" "}
                  (
                  {t(
                    step.state === "done"
                      ? "portal.order.timeline.stepDone"
                      : step.state === "current"
                        ? "portal.order.timeline.stepCurrent"
                        : "portal.order.timeline.stepUpcoming",
                  )}
                  )
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Status history of the order, oldest first, starting with its registration.
 * Rows come from shipment_status_history (RLS: customer_visible statuses of
 * own orders); every change is shown as made by "G&R Solutions".
 */
export function StatusHistory({
  order,
  statuses,
  history,
}: {
  order: Pick<OrderDetail, "created_at" | "created_by_role">;
  statuses: StatusMap;
  history: {
    data: readonly StatusHistoryEntry[] | undefined;
    error: unknown;
    isError: boolean;
    refetch: () => unknown;
  };
}) {
  const t = useT();
  return (
    <Section title={t("portal.order.timeline.title")} icon={History} id="order-history">
      {history.isError ? (
        <LoadError
          title={t("portal.order.timeline.loadFailed")}
          error={history.error}
          onRetry={() => void history.refetch()}
        />
      ) : !history.data ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <HistoryList order={order} statuses={statuses} entries={history.data} />
      )}
    </Section>
  );
}

function HistoryList({
  order,
  statuses,
  entries,
}: {
  order: Pick<OrderDetail, "created_at" | "created_by_role">;
  statuses: StatusMap;
  entries: readonly StatusHistoryEntry[];
}) {
  const t = useT();
  return (
    <ol className="space-y-0">
      <Event
        icon={<StageIcon stage="registered" className="size-4" />}
        title={t("portal.order.timeline.registered")}
        at={order.created_at}
        by={order.created_by_role === "customer" ? "customer" : "company"}
        last={entries.length === 0}
      />
      {entries.map((entry, i) => {
        const status = resolveStatus(entry.to_status, statuses);
        return (
          <Event
            key={entry.id}
            icon={<StageIcon stage={status.stage} className="size-4" />}
            title={status.label ?? t("portal.statusUnknown")}
            description={status.description}
            message={entry.customer_message}
            at={entry.changed_at}
            by="company"
            last={i === entries.length - 1}
          />
        );
      })}
    </ol>
  );
}

function Event({
  icon,
  title,
  description,
  message,
  at,
  by,
  last,
}: {
  icon: ReactNode;
  title: string;
  description?: string | null;
  message?: string | null;
  at: string;
  by: "customer" | "company";
  last: boolean;
}) {
  const t = useT();
  const ByIcon = by === "customer" ? UserRound : Building2;
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!last ? (
        <span aria-hidden className="absolute left-4 top-9 h-[calc(100%-2.25rem)] w-px bg-border" />
      ) : null}
      <span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full bg-cream text-primary">
        {icon}
      </span>
      <div className="min-w-0 flex-1 pt-1 text-sm">
        <p className="font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground tabular-nums">
          <time dateTime={at}>{formatDateTime(at)}</time>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <ByIcon className="size-3.5" aria-hidden />
            {by === "customer"
              ? t("portal.order.timeline.byCustomer")
              : t("portal.order.timeline.byCompany")}
          </span>
        </p>
        {description ? <p className="mt-1 leading-6 text-muted-foreground">{description}</p> : null}
        {message?.trim() ? (
          <blockquote className="mt-2 whitespace-pre-line break-words rounded-md border-l-4 border-primary/40 bg-cream px-3 py-2 leading-6 text-foreground">
            <span className="sr-only">{t("portal.order.actionRequired.messageLabel")}: </span>
            {message.trim()}
          </blockquote>
        ) : null}
      </div>
    </li>
  );
}
