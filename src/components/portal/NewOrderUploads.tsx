import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  PackageCheck,
  RotateCw,
  XCircle,
} from "lucide-react";

import { Section } from "@/components/portal/Section";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useT } from "@/lib/i18n";
import {
  uploadSummary,
  type QueuedDocument,
  type UploadState,
  type UploadStatus,
} from "@/lib/portal/document-queue";
import { formatFileSize } from "@/lib/portal/documents";
import { cn } from "@/lib/utils";

const STATUS_ICON = {
  waiting: Clock,
  uploading: Loader2,
  done: CheckCircle2,
  failed: XCircle,
} satisfies Record<UploadStatus, unknown>;

/**
 * After "Order aanmelden" with documents: the order exists, the files go up
 * one by one, each with its own status. A failed upload never undoes the
 * order; the customer retries here or later on the order page.
 */
export function NewOrderUploads({
  order,
  queue,
  states,
  onRetry,
}: {
  order: { id: string; reference: string };
  queue: readonly QueuedDocument[];
  states: readonly UploadState[];
  onRetry: () => void;
}) {
  const t = useT();
  const summary = uploadSummary(states);

  // The form above is gone (with the focused submit button): bring the
  // progress into view and give keyboard and screen reader users a place to start.
  useEffect(() => {
    const heading = document.getElementById("new-order-uploads-title");
    if (!heading) return;
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: "start" });
  }, []);
  const finishedWithErrors = !summary.busy && summary.failed > 0;

  return (
    <Section
      title={t("portal.newOrder.upload.title", { reference: order.reference })}
      icon={PackageCheck}
      id="new-order-uploads"
      description={summary.busy ? t("portal.newOrder.upload.text") : undefined}
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <p
            id="new-order-upload-progress"
            className="text-sm font-medium tabular-nums"
            aria-live="polite"
          >
            {t(
              summary.total === 1
                ? "portal.newOrder.upload.progressOne"
                : "portal.newOrder.upload.progress",
              { done: summary.done, total: summary.total },
            )}
          </p>
          <Progress value={summary.percent} aria-labelledby="new-order-upload-progress" />
        </div>

        <ul className="divide-y rounded-md border">
          {queue.map((doc, i) => {
            const state = states[i] ?? { status: "waiting" as const };
            const Icon = STATUS_ICON[state.status];
            return (
              <li key={doc.key} className="flex items-start gap-3 px-3 py-3 text-sm">
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{doc.file.name}</p>
                  <p className="text-muted-foreground">
                    {t(`portal.documentKinds.${doc.kind}`)} ·{" "}
                    <span className="tabular-nums">{formatFileSize(doc.file.size)}</span>
                  </p>
                  {state.status === "failed" && state.error ? (
                    <p className="mt-1 text-destructive">{state.error}</p>
                  ) : null}
                </div>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold",
                    state.status === "done" && "text-success",
                    state.status === "failed" && "text-destructive",
                    (state.status === "waiting" || state.status === "uploading") &&
                      "text-muted-foreground",
                  )}
                >
                  <Icon
                    className={cn("size-4", state.status === "uploading" && "animate-spin")}
                    aria-hidden
                  />
                  {t(`portal.newOrder.upload.status.${state.status}`)}
                </span>
              </li>
            );
          })}
        </ul>

        {finishedWithErrors ? (
          <div
            role="alert"
            className="flex gap-3 rounded-lg border-2 border-warning/40 bg-warning-soft p-4 text-sm"
          >
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
            <div className="min-w-0 space-y-3">
              <div>
                <h3 className="text-base font-bold text-foreground">
                  {t("portal.newOrder.upload.failedTitle")}
                </h3>
                <p className="mt-1 leading-6 text-foreground">
                  {t("portal.newOrder.upload.failedText", { reference: order.reference })}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" className="h-11 sm:h-9" onClick={onRetry}>
                  <RotateCw aria-hidden />
                  {t("portal.newOrder.upload.retry")}
                </Button>
                <Button asChild variant="outline" className="h-11 sm:h-9">
                  <Link to="/portal/orders/$id" params={{ id: order.id }} replace>
                    {t("portal.newOrder.upload.toOrder")}
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Section>
  );
}
