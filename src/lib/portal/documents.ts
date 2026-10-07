import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { Constants, type Database } from "@/integrations/supabase/types";
import { t } from "@/lib/i18n";
import { portalKeys } from "@/lib/portal/orders";

/**
 * Order documents (SPEC §35.7). The browser uploads straight to the private
 * bucket 'order-documents' (files never pass through a server function), at
 * {customer_id}/{order_id}/{uuid}.{ext} — never the user's file name — and
 * then records the upload in order_documents. The bucket, the storage
 * policies and the order_documents trigger enforce the same rules again.
 */

export const DOCUMENTS_BUCKET = "order-documents";
/** Bucket file_size_limit: 10 MB. */
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
/**
 * Upload limits for customers (migration 20261008120000_p10_review_hardening.sql):
 * files per order folder, and new files per customer per 24 hours. Staff are
 * not limited. The storage policy refuses more (HTTP 403).
 */
export const DOCUMENT_MAX_PER_ORDER = 20;
export const DOCUMENT_MAX_PER_DAY = 40;
/** Signed download links live 5 minutes (SPEC §35.7). */
export const SIGNED_URL_SECONDS = 300;

export type DocumentKind = Database["public"]["Enums"]["order_document_kind"];
export const DOCUMENT_KINDS: readonly DocumentKind[] = Constants.public.Enums.order_document_kind;

/** The bucket's allowed MIME types and the extension stored in the path (order_documents_mime_check). */
export const DOCUMENT_MIME_TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
} as const;
export type DocumentMimeType = keyof typeof DOCUMENT_MIME_TYPES;

const EXTENSION_MIME: Record<string, DocumentMimeType> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

/** For <input accept>: extensions too, because some browsers give HEIC files no type. */
export const DOCUMENT_ACCEPT = [
  ...Object.keys(DOCUMENT_MIME_TYPES),
  ...Object.keys(EXTENSION_MIME).map((ext) => `.${ext}`),
].join(",");

const isDocumentMime = (type: string): type is DocumentMimeType =>
  Object.hasOwn(DOCUMENT_MIME_TYPES, type);

/**
 * The MIME type to upload with, or null when the file is not allowed. The
 * browser's type wins; only an empty type (common for HEIC) falls back to the
 * file extension.
 */
export function documentMimeType(file: { name: string; type: string }): DocumentMimeType | null {
  const type = file.type.trim().toLowerCase();
  if (type) return isDocumentMime(type) ? type : null;
  const ext = /\.([a-z0-9]+)$/i.exec(file.name.trim())?.[1]?.toLowerCase();
  return ext ? (EXTENSION_MIME[ext] ?? null) : null;
}

export type DocumentCheck =
  | { ok: true; mimeType: DocumentMimeType; extension: string }
  | { ok: false; reason: "type" | "size" | "empty" };

export function checkDocument(file: { name: string; type: string; size: number }): DocumentCheck {
  const mimeType = documentMimeType(file);
  if (!mimeType) return { ok: false, reason: "type" };
  if (file.size <= 0) return { ok: false, reason: "empty" };
  if (file.size > DOCUMENT_MAX_BYTES) return { ok: false, reason: "size" };
  return { ok: true, mimeType, extension: DOCUMENT_MIME_TYPES[mimeType] };
}

/** {customer_id}/{order_id}/{uuid}.{ext} — the only path shape the table and policies accept. */
export function documentStoragePath(
  customerId: string,
  orderId: string,
  fileId: string,
  extension: string,
): string {
  return `${customerId}/${orderId}/${fileId.toLowerCase()}.${extension}`;
}

/** Stored file name: what the customer recognises, trimmed to the column's 255 characters. */
export function storedFileName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "document";
  if (trimmed.length <= 255) return trimmed;
  const ext = /(\.[a-z0-9]{1,8})$/i.exec(trimmed)?.[1] ?? "";
  return trimmed.slice(0, 255 - ext.length) + ext;
}

export type OrderDocument = Pick<
  Database["public"]["Tables"]["order_documents"]["Row"],
  | "id"
  | "kind"
  | "original_filename"
  | "mime_type"
  | "size_bytes"
  | "storage_path"
  | "uploaded_by"
  | "created_at"
>;

const DOCUMENT_COLUMNS =
  "id, kind, original_filename, mime_type, size_bytes, storage_path, uploaded_by, created_at" as const;

export const orderDocumentsQueryOptions = (userId: string, customerId: string, orderId: string) =>
  queryOptions({
    queryKey: portalKeys.orderDocuments(userId, orderId),
    staleTime: 30_000,
    queryFn: async (): Promise<OrderDocument[]> => {
      const { data, error } = await supabase
        .from("order_documents")
        .select(DOCUMENT_COLUMNS)
        .eq("order_id", orderId)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

export type DocumentErrorReason = "type" | "size" | "empty" | "forbidden" | "upload";

/**
 * A file the bucket refused or would refuse (checked before uploading, or
 * reported by Storage); `reason` picks the Dutch message.
 */
export class DocumentUploadError extends Error {
  readonly reason: DocumentErrorReason;

  constructor(reason: DocumentErrorReason, cause?: unknown) {
    super(`Document upload failed: ${reason}`, { cause });
    this.name = "DocumentUploadError";
    this.reason = reason;
  }
}

/** The Dutch message for a refused upload (the limits are named in "forbidden"). */
export function documentErrorMessage(reason: DocumentErrorReason): string {
  return reason === "forbidden"
    ? t("portal.upload.errors.forbidden", {
        perOrder: DOCUMENT_MAX_PER_ORDER,
        perDay: DOCUMENT_MAX_PER_DAY,
      })
    : t(`portal.upload.errors.${reason}`);
}

/**
 * Storage API errors carry an HTTP status and a statusCode string; their
 * messages are English. Network failures are left to errors.ts.
 */
export function classifyStorageError(error: {
  message?: string;
  status?: number | undefined;
  statusCode?: string | undefined;
}): DocumentErrorReason | null {
  const codes = [String(error.status ?? ""), String(error.statusCode ?? "")];
  if (codes.includes("413")) return "size";
  if (codes.includes("415") || /mime/i.test(error.message ?? "")) return "type";
  if (codes.includes("403") || codes.includes("401")) return "forbidden";
  if (codes.some((c) => /^[45]\d\d$/.test(c))) return "upload";
  return null;
}

/**
 * Uploads one file for an order and records it. Customers cannot delete
 * storage objects, so if recording fails the object stays behind unlinked;
 * the error is still raised so the customer can try again.
 */
export async function uploadOrderDocument({
  customerId,
  orderId,
  file,
  kind,
}: {
  customerId: string;
  orderId: string;
  file: File;
  kind: DocumentKind;
}): Promise<OrderDocument> {
  const check = checkDocument(file);
  if (!check.ok) throw new DocumentUploadError(check.reason);

  const path = documentStoragePath(customerId, orderId, crypto.randomUUID(), check.extension);
  const upload = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    // max-age=0: private documents are never served from a browser or CDN
    // cache after the 5-minute signed link has expired (or after sign-out).
    .upload(path, file, { contentType: check.mimeType, upsert: false, cacheControl: "0" });
  if (upload.error) {
    const reason = classifyStorageError(upload.error);
    throw reason ? new DocumentUploadError(reason, upload.error) : upload.error;
  }

  const { data, error } = await supabase
    .from("order_documents")
    .insert({
      order_id: orderId,
      customer_id: customerId,
      kind,
      storage_path: path,
      original_filename: storedFileName(file.name),
      mime_type: check.mimeType,
      size_bytes: file.size,
    })
    .select(DOCUMENT_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

const DOWNLOAD_BASE_MAX = 100;

/**
 * The name a document downloads under. original_filename is whatever the
 * uploader's browser (or a direct API call) sent, so its extension says
 * nothing about the bytes: only storage_path's extension is checked by the
 * database (order_documents_mime_check). The download name is therefore the
 * recognisable part of the original name, reduced to plain ASCII letters,
 * digits, spaces, dots, dashes and underscores, plus the stored extension:
 * 'factuur.pdf.exe' → 'factuur.pdf', 'Factuur #3 coördinaat.pdf' →
 * 'Factuur 3 coordinaat.pdf'. Plain ASCII also survives storage-js, which
 * encodes the download parameter twice. Staff downloads (P5) use it too.
 */
export function documentDownloadName(
  document: Pick<OrderDocument, "storage_path" | "original_filename">,
): string {
  const extension = /\.([a-z0-9]+)$/i.exec(document.storage_path)?.[1]?.toLowerCase() ?? "";
  let base = document.original_filename
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ._-]+/g, " ");
  // Drop extension-like suffixes ('.pdf.exe', '.html'; not the '.05' of a
  // date): the stored extension is what the name ends in, whatever is left.
  const suffix = /\.(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{1,8}\s*$/;
  for (let i = 0; i < 5 && suffix.test(base); i += 1) base = base.replace(suffix, "");
  base = base
    .replace(/\s+/g, " ")
    .replace(/^[\s._-]+|[\s._-]+$/g, "")
    .slice(0, DOWNLOAD_BASE_MAX)
    .replace(/[\s._-]+$/, "");
  return `${base || "document"}${extension ? `.${extension}` : ""}`;
}

/** A 5-minute link that downloads the file under a safe version of its original name. */
export async function documentDownloadUrl(
  document: Pick<OrderDocument, "storage_path" | "original_filename">,
) {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(document.storage_path, SIGNED_URL_SECONDS, {
      download: documentDownloadName(document),
    });
  if (error) throw error;
  return data.signedUrl;
}

/** '2,4 MB' / '312 kB' for the documents list. */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}
