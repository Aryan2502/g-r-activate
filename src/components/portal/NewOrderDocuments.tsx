import { useId, useRef, useState } from "react";
import { AlertTriangle, FileText, FileUp, Trash2 } from "lucide-react";

import { Section } from "@/components/portal/Section";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/lib/i18n";
import {
  MAX_ORDER_FILES,
  addToQueue,
  type QueuedDocument,
  type RejectedFile,
} from "@/lib/portal/document-queue";
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_KINDS,
  formatFileSize,
  type DocumentKind,
} from "@/lib/portal/documents";

/**
 * Optional documents in the registration form (SPEC §9). Files are checked
 * here (type, size, empty) and only uploaded once the order exists; refused
 * files are listed with the reason and never queued.
 */
export function NewOrderDocuments({
  queue,
  onChange,
  defaultKind,
  isB2b,
  disabled,
}: {
  queue: readonly QueuedDocument[];
  onChange: (queue: QueuedDocument[]) => void;
  defaultKind: DocumentKind;
  isB2b: boolean;
  disabled?: boolean;
}) {
  const t = useT();
  const id = useId();
  const off = disabled === true;
  const inputRef = useRef<HTMLInputElement>(null);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);

  const choose = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const result = addToQueue(queue, Array.from(files), defaultKind);
    setRejected(result.rejected);
    onChange(result.queue);
    // The same file can be chosen again after removing it.
    if (inputRef.current) inputRef.current.value = "";
  };

  const reason = (r: RejectedFile) =>
    r.reason === "tooMany"
      ? t("portal.newOrder.documents.tooMany", { max: MAX_ORDER_FILES })
      : t(`portal.upload.errors.${r.reason}`);

  return (
    <Section
      title={t("portal.newOrder.documents.title")}
      icon={FileText}
      id={`${id}-documents`}
      description={
        <>
          {t("portal.newOrder.documents.intro")}
          {isB2b ? (
            <span className="mt-2 block">{t("portal.newOrder.documents.b2bHint")}</span>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        <div>
          {/* The browser's own file button would show English text: a Dutch
              label acts as the button, the input stays focusable. */}
          <input
            ref={inputRef}
            id={`${id}-file`}
            type="file"
            multiple
            accept={DOCUMENT_ACCEPT}
            disabled={off || queue.length >= MAX_ORDER_FILES}
            aria-describedby={rejected.length ? `${id}-rejected` : undefined}
            onChange={(e) => choose(e.target.files)}
            className="peer sr-only"
          />
          <label
            htmlFor={`${id}-file`}
            className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border bg-cream px-4 text-sm font-semibold text-primary hover:bg-secondary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-50 sm:h-10"
          >
            <FileUp className="size-4" aria-hidden />
            {t("portal.newOrder.documents.choose")}
          </label>
        </div>

        {rejected.length ? (
          <div
            id={`${id}-rejected`}
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive-soft px-3 py-2.5 text-sm text-destructive"
          >
            <ul className="space-y-1">
              {rejected.map((r) => (
                <li key={`${r.name}-${r.reason}`} className="flex items-start gap-1.5 break-words">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0">
                    {t("portal.newOrder.documents.rejected", { name: r.name, reason: reason(r) })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {queue.length ? (
          <ul
            aria-label={t("portal.newOrder.documents.listLabel")}
            className="divide-y rounded-md border"
          >
            {queue.map((doc) => (
              <li
                key={doc.key}
                className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="flex min-w-0 items-center gap-2 text-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {doc.file.name}
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {formatFileSize(doc.file.size)}
                  </span>
                </p>
                <div className="flex items-center gap-2">
                  <Select
                    value={doc.kind}
                    disabled={off}
                    onValueChange={(v) =>
                      onChange(
                        queue.map((d) =>
                          d.key === doc.key
                            ? { ...d, kind: DOCUMENT_KINDS.find((k) => k === v) ?? "other" }
                            : d,
                        ),
                      )
                    }
                  >
                    <SelectTrigger
                      className="h-11 min-w-0 flex-1 sm:h-10 sm:w-52 sm:flex-none"
                      aria-label={t("portal.newOrder.documents.kindFor", { name: doc.file.name })}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {t(`portal.documentKinds.${k}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11 shrink-0 sm:size-10"
                    disabled={off}
                    aria-label={t("portal.newOrder.documents.remove", { name: doc.file.name })}
                    onClick={() => onChange(queue.filter((d) => d.key !== doc.key))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("portal.newOrder.documents.none")}</p>
        )}
      </div>
    </Section>
  );
}
