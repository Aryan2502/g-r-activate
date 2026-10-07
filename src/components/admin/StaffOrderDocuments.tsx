import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FileText,
  Image as ImageIcon,
  Info,
  Loader2,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { LoadError, Section } from "@/components/portal/Section";
import { UploadDocumentDialog } from "@/components/portal/UploadDocumentDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { adminKeys } from "@/lib/admin/keys";
import {
  adminOrderDocumentsQueryOptions,
  peopleQueryOptions,
  personName,
  type StaffOrderDocument,
} from "@/lib/admin/orders";
import { B2B_CUSTOMS_DOCUMENT_KINDS } from "@/lib/admin/statuses";
import { errorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { DOCUMENTS_BUCKET, documentDownloadUrl, formatFileSize } from "@/lib/portal/documents";

/**
 * Documents of an order for staff (SPEC §35.7): the customer's and G&R's
 * uploads. Staff upload into the order's folder at any stage, download via a
 * 5-minute signed URL under a safe name (documentDownloadName), and delete
 * (RLS: staff only): first the row, then the stored object.
 */
export function StaffOrderDocuments({
  userId,
  customerId,
  orderId,
  customerUserId,
  isB2b,
}: {
  userId: string;
  customerId: string;
  orderId: string;
  /** The customer's login, to show "Door de klant". */
  customerUserId: string | null;
  isB2b: boolean;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const documents = useQuery(adminOrderDocumentsQueryOptions(userId, orderId));
  const uploaders = (documents.data ?? []).flatMap((d) => (d.uploaded_by ? [d.uploaded_by] : []));
  const people = useQuery({
    ...peopleQueryOptions(userId, uploaders),
    enabled: uploaders.length > 0,
  });
  const missingCustoms =
    isB2b &&
    documents.data !== undefined &&
    !documents.data.some((d) => (B2B_CUSTOMS_DOCUMENT_KINDS as readonly string[]).includes(d.kind));
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: adminKeys.orderDocuments(userId, orderId) });

  return (
    <Section
      title={t("portal.order.documents.title")}
      icon={Paperclip}
      id="order-documents"
      description={t("admin.order.documents.intro")}
      actions={
        <UploadDocumentDialog
          userId={userId}
          customerId={customerId}
          orderId={orderId}
          defaultKind={isB2b ? "commercial_invoice" : "purchase_invoice"}
          onUploaded={refresh}
          trigger={
            <Button variant="outline" size="sm">
              <Upload aria-hidden />
              {t("portal.order.documents.upload")}
            </Button>
          }
        />
      }
    >
      {missingCustoms ? (
        <p className="mb-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm leading-6 text-foreground">
          <Info className="mt-1 size-4 shrink-0 text-warning" aria-hidden />
          {t("admin.order.documents.missingCustoms")}
        </p>
      ) : null}
      {documents.isError ? (
        <LoadError
          title={t("portal.order.documents.loadFailed")}
          error={documents.error}
          onRetry={() => void documents.refetch()}
        />
      ) : documents.isPending ? (
        <Skeleton className="h-12 w-full" />
      ) : documents.data.length === 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">
          {t("portal.order.documents.empty")}
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {documents.data.map((doc) => (
            <DocumentRow
              key={doc.id}
              document={doc}
              uploader={
                doc.uploaded_by && doc.uploaded_by === customerUserId
                  ? t("admin.order.documents.byCustomer")
                  : t("admin.order.documents.byStaff", {
                      name: personName(doc.uploaded_by, people.data, customerUserId),
                    })
              }
              onDeleted={refresh}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function DocumentRow({
  document,
  uploader,
  onDeleted,
}: {
  document: StaffOrderDocument;
  uploader: string;
  onDeleted: () => Promise<unknown>;
}) {
  const t = useT();
  const [opening, setOpening] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const Icon = document.mime_type.startsWith("image/") ? ImageIcon : FileText;

  const download = async () => {
    setOpening(true);
    try {
      // Content-Disposition: attachment, so the file downloads and the page stays.
      window.location.assign(await documentDownloadUrl(document));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setOpening(false);
    }
  };

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("order_documents")
        .delete()
        .eq("id", document.id)
        // RLS hides nothing from staff, but .single() turns "nothing deleted" into an error.
        .select("id")
        .single();
      if (error) throw error;
      const storage = await supabase.storage.from(DOCUMENTS_BUCKET).remove([document.storage_path]);
      return { storageLeft: Boolean(storage.error) };
    },
    onSuccess: async ({ storageLeft }) => {
      setConfirming(false);
      if (storageLeft) toast.warning(t("admin.order.documents.storageLeft"));
      else toast.success(t("admin.order.documents.deleted"));
      await onDeleted();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <li className="flex items-center gap-2 px-3 py-2.5">
      <Icon className="size-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="break-all font-semibold text-foreground">{document.original_filename}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {t(`portal.documentKinds.${document.kind}`)} · {formatFileSize(document.size_bytes)} ·{" "}
          {formatDateTime(document.created_at)} · {uploader}
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
          {t("portal.order.documents.download", { name: document.original_filename })}
        </span>
      </Button>
      <AlertDialog
        open={confirming}
        onOpenChange={(next) => !remove.isPending && setConfirming(next)}
      >
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-destructive hover:bg-destructive-soft hover:text-destructive"
          onClick={() => setConfirming(true)}
          title={t("admin.order.documents.delete", { name: document.original_filename })}
        >
          <Trash2 aria-hidden />
          <span className="sr-only">
            {t("admin.order.documents.delete", { name: document.original_filename })}
          </span>
        </Button>
        <AlertDialogContent className="w-[calc(100%-2rem)] rounded-lg bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading text-primary">
              {t("admin.order.documents.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {t("admin.order.documents.deleteText", { name: document.original_filename })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={remove.isPending}>
              {t("admin.status.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                remove.mutate();
              }}
            >
              {remove.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {remove.isPending
                ? t("admin.order.documents.deleting")
                : t("admin.order.documents.deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
