import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Download,
  FileText,
  Image as ImageIcon,
  Info,
  Loader2,
  Paperclip,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { LoadError, Section } from "@/components/portal/Section";
import { UploadDocumentDialog } from "@/components/portal/UploadDocumentDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import {
  DOCUMENT_MAX_PER_ORDER,
  documentDownloadUrl,
  formatFileSize,
  orderDocumentsQueryOptions,
  type OrderDocument,
} from "@/lib/portal/documents";

/**
 * Documents of one order (SPEC §35.7): listed from order_documents (RLS: own
 * orders), downloaded through a 5-minute signed URL, uploaded via
 * UploadDocumentDialog while the order is not completed or cancelled.
 */
export function OrderDocuments({
  userId,
  customerId,
  orderId,
  canUpload,
  isB2b,
}: {
  userId: string;
  customerId: string;
  orderId: string;
  canUpload: boolean;
  isB2b: boolean;
}) {
  const t = useT();
  const documents = useQuery(orderDocumentsQueryOptions(userId, customerId, orderId));
  // The database refuses more than this per order (migration 20261008120000).
  const full = (documents.data?.length ?? 0) >= DOCUMENT_MAX_PER_ORDER;
  // SPEC §35.7: B2B shipments need a commercial invoice or packing list for customs.
  const missingB2bDocs =
    isB2b &&
    canUpload &&
    documents.data !== undefined &&
    !documents.data.some((d) => d.kind === "commercial_invoice" || d.kind === "packing_list");

  return (
    <Section
      title={t("portal.order.documents.title")}
      icon={Paperclip}
      id="order-documents"
      description={t("portal.order.documents.intro")}
      actions={
        canUpload && !full ? (
          <UploadDocumentDialog
            userId={userId}
            customerId={customerId}
            orderId={orderId}
            trigger={
              <Button variant="outline" size="sm">
                <Upload aria-hidden />
                {t("portal.order.documents.upload")}
              </Button>
            }
          />
        ) : null
      }
    >
      {missingB2bDocs ? (
        <p className="mb-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm leading-6 text-foreground">
          <Info className="mt-1 size-4 shrink-0 text-warning" aria-hidden />
          {t("portal.order.documents.b2bHint")}
        </p>
      ) : null}
      {documents.isError ? (
        <LoadError
          title={t("portal.order.documents.loadFailed")}
          error={documents.error}
          onRetry={() => void documents.refetch()}
        />
      ) : documents.isPending ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-12 w-full" />
        </div>
      ) : documents.data.length === 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">
          {t("portal.order.documents.empty")}
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {documents.data.map((doc) => (
            <DocumentRow key={doc.id} document={doc} userId={userId} />
          ))}
        </ul>
      )}
      {!canUpload ? (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          {t("portal.order.documents.closed")}
        </p>
      ) : full ? (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          {t("portal.order.documents.full", { max: DOCUMENT_MAX_PER_ORDER })}
        </p>
      ) : null}
    </Section>
  );
}

function DocumentRow({ document, userId }: { document: OrderDocument; userId: string }) {
  const t = useT();
  const [opening, setOpening] = useState(false);
  const Icon = document.mime_type.startsWith("image/") ? ImageIcon : FileText;

  const download = async () => {
    setOpening(true);
    try {
      const url = await documentDownloadUrl(document);
      // The signed URL answers with Content-Disposition: attachment, so the
      // file downloads and this page stays open.
      window.location.assign(url);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setOpening(false);
    }
  };

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <Icon className="size-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="break-all font-semibold text-foreground">{document.original_filename}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {t(`portal.documentKinds.${document.kind}`)} · {formatFileSize(document.size_bytes)} ·{" "}
          {formatDateTime(document.created_at)} ·{" "}
          {document.uploaded_by === userId
            ? t("portal.order.documents.byCustomer")
            : t("portal.order.documents.byCompany")}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 text-primary"
        onClick={() => void download()}
        disabled={opening}
        title={t("portal.order.documents.download", { name: document.original_filename })}
      >
        {opening ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
        <span className="sr-only">
          {opening
            ? t("portal.order.documents.downloading")
            : t("portal.order.documents.download", { name: document.original_filename })}
        </span>
      </Button>
    </li>
  );
}
