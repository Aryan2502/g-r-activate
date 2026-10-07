import { useId, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileUp, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_KINDS,
  DocumentUploadError,
  checkDocument,
  formatFileSize,
  uploadOrderDocument,
  type DocumentKind,
} from "@/lib/portal/documents";
import { portalKeys } from "@/lib/portal/orders";

/**
 * "Document uploaden" for one order (SPEC §35.7): checks type and size in the
 * browser, uploads straight to the private bucket and records the file. The
 * bucket, storage policies and the order_documents trigger check it again.
 */
export function UploadDocumentDialog({
  userId,
  customerId,
  orderId,
  defaultKind = "purchase_invoice",
  trigger,
}: {
  userId: string;
  customerId: string;
  orderId: string;
  defaultKind?: DocumentKind;
  trigger: ReactNode;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<DocumentKind>(defaultKind);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const reset = () => {
    setKind(defaultKind);
    setFile(null);
    setProblem(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const upload = useMutation({
    mutationFn: (values: { file: File; kind: DocumentKind }) =>
      uploadOrderDocument({ customerId, orderId, ...values }),
    onSuccess: async () => {
      toast.success(t("portal.upload.success"));
      setOpen(false);
      reset();
      await queryClient.invalidateQueries({ queryKey: portalKeys.orderDocuments(userId, orderId) });
    },
    onError: (error) => {
      const message =
        error instanceof DocumentUploadError
          ? t(`portal.upload.errors.${error.reason}`)
          : errorMessage(error);
      setProblem(message);
      toast.error(message);
    },
  });

  const choose = (selected: File | null) => {
    setFile(selected);
    if (!selected) {
      setProblem(null);
      return;
    }
    const check = checkDocument(selected);
    setProblem(check.ok ? null : t(`portal.upload.errors.${check.reason}`));
  };

  const submit = () => {
    if (!file) {
      setProblem(t("portal.upload.errors.required"));
      return;
    }
    const check = checkDocument(file);
    if (!check.ok) {
      setProblem(t(`portal.upload.errors.${check.reason}`));
      return;
    }
    upload.mutate({ file, kind });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (upload.isPending) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-card">
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {t("portal.upload.title")}
          </DialogTitle>
          <DialogDescription>{t("portal.upload.text")}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="min-w-0 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-kind`}>{t("portal.upload.kind")}</Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(DOCUMENT_KINDS.find((k) => k === v) ?? "other")}
            >
              <SelectTrigger id={`${id}-kind`} className="h-10">
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
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-file`}>{t("portal.upload.file")}</Label>
            {/* The browser's own file button would show English text: a
                Dutch label acts as the button, the input stays focusable. */}
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-input bg-background p-1.5">
              <input
                ref={inputRef}
                id={`${id}-file`}
                type="file"
                accept={DOCUMENT_ACCEPT}
                aria-invalid={problem ? true : undefined}
                aria-describedby={`${id}-file-name${problem ? ` ${id}-problem` : ""}`}
                onChange={(e) => choose(e.target.files?.[0] ?? null)}
                className="peer sr-only"
              />
              <label
                htmlFor={`${id}-file`}
                className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-md border bg-cream px-3 py-1.5 text-sm font-semibold text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring hover:bg-secondary"
              >
                <FileUp className="size-4" aria-hidden />
                {t("portal.upload.choose")}
              </label>
              <span
                id={`${id}-file-name`}
                // Wraps under the button when less than 10rem is left, so more of the name shows.
                className="min-w-0 flex-1 basis-40 truncate px-1 text-sm text-muted-foreground"
              >
                {file ? `${file.name} · ${formatFileSize(file.size)}` : t("portal.upload.noFile")}
              </span>
            </div>
            {problem ? (
              <p
                id={`${id}-problem`}
                role="alert"
                className="flex items-start gap-1.5 text-[0.8rem] font-medium text-destructive"
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {problem}
              </p>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={upload.isPending}
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              {t("portal.upload.cancel")}
            </Button>
            <Button type="submit" disabled={upload.isPending}>
              {upload.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Upload aria-hidden />
              )}
              {upload.isPending ? t("portal.upload.uploading") : t("portal.upload.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
