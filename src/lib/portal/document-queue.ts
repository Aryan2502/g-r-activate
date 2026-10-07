import { checkDocument, type DocumentKind } from "@/lib/portal/documents";
import type { OrderType } from "@/lib/portal/orders";

/**
 * Documents chosen in the registration form (SPEC §9, §35.7). They are
 * uploaded only after the order row exists (the storage path and the
 * order_documents row need its id), one by one, each with its own status.
 * An upload that fails never undoes the order.
 */

/** At most this many files per registration; more can be added on the order page. */
export const MAX_ORDER_FILES = 10;

export interface QueuedDocument {
  /** Stable per chosen file, for React keys and to skip choosing the same file twice. */
  key: string;
  file: File;
  kind: DocumentKind;
}

export type RejectReason = "type" | "size" | "empty" | "tooMany";

export interface RejectedFile {
  name: string;
  reason: RejectReason;
}

export const fileKey = (file: Pick<File, "name" | "size" | "lastModified">) =>
  `${file.name}:${file.size}:${file.lastModified}`;

/** A purchase invoice for a personal order; customs needs a commercial invoice for B2B. */
export function defaultDocumentKind(orderType: OrderType): DocumentKind {
  return orderType === "b2b" ? "commercial_invoice" : "purchase_invoice";
}

/**
 * Adds chosen files to the queue: files the bucket would refuse (type, size,
 * empty) and files past the maximum are reported, not queued; a file already
 * in the queue is skipped silently.
 */
export function addToQueue(
  queue: readonly QueuedDocument[],
  files: readonly File[],
  kind: DocumentKind,
): { queue: QueuedDocument[]; rejected: RejectedFile[] } {
  const next = [...queue];
  const rejected: RejectedFile[] = [];
  for (const file of files) {
    const key = fileKey(file);
    if (next.some((d) => d.key === key)) continue;
    const check = checkDocument(file);
    if (!check.ok) {
      rejected.push({ name: file.name, reason: check.reason });
    } else if (next.length >= MAX_ORDER_FILES) {
      rejected.push({ name: file.name, reason: "tooMany" });
    } else {
      next.push({ key, file, kind });
    }
  }
  return { queue: next, rejected };
}

export type UploadStatus = "waiting" | "uploading" | "done" | "failed";

export interface UploadState {
  status: UploadStatus;
  /** Dutch message when failed. */
  error?: string;
}

export function uploadSummary(states: readonly UploadState[]) {
  const done = states.filter((s) => s.status === "done").length;
  const failed = states.filter((s) => s.status === "failed").length;
  const busy = states.some((s) => s.status === "waiting" || s.status === "uploading");
  return {
    total: states.length,
    done,
    failed,
    busy,
    percent: states.length ? Math.round((done / states.length) * 100) : 100,
  };
}
