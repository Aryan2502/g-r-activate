import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, NotebookPen } from "lucide-react";
import { toast } from "sonner";

import { FieldError } from "@/components/admin/Callout";
import { LoadError, Section } from "@/components/portal/Section";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { adminKeys } from "@/lib/admin/keys";
import { adminOrderNotesQueryOptions, peopleQueryOptions, personName } from "@/lib/admin/orders";
import { errorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";

const NOTE_MAX = 5000;

/**
 * Staff-only remarks on an order (SPEC §35.3): internal_notes, which only
 * staff can read or write (RLS); never in a customer-readable column. The
 * database stamps the author and the time (internal_notes_stamp).
 */
export function InternalNotes({
  userId,
  customerId,
  orderId,
}: {
  userId: string;
  customerId: string;
  orderId: string;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const notes = useQuery(adminOrderNotesQueryOptions(userId, orderId));
  const authors = (notes.data ?? []).flatMap((n) => (n.created_by ? [n.created_by] : []));
  const people = useQuery({
    ...peopleQueryOptions(userId, authors),
    enabled: authors.length > 0,
  });
  const [body, setBody] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const error = !body.trim()
    ? t("admin.order.notes.required")
    : body.trim().length > NOTE_MAX
      ? t("admin.order.notes.tooLong")
      : null;

  const add = useMutation({
    mutationFn: async () => {
      const { error: insertError } = await supabase
        .from("internal_notes")
        .insert({ customer_id: customerId, order_id: orderId, body: body.trim() });
      if (insertError) throw insertError;
    },
    onSuccess: async () => {
      setBody("");
      setSubmitted(false);
      toast.success(t("admin.order.notes.added"));
      await queryClient.invalidateQueries({ queryKey: adminKeys.orderNotes(userId, orderId) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (error) {
      document.getElementById(`${id}-body`)?.focus();
      return;
    }
    add.mutate();
  };
  const shown = submitted ? error : null;

  return (
    <Section
      title={t("admin.order.notes.title")}
      icon={NotebookPen}
      id="order-notes"
      description={
        <span className="inline-flex items-center gap-1.5">
          <Lock className="size-3.5" aria-hidden />
          {t("admin.order.notes.intro")}
        </span>
      }
    >
      <form noValidate onSubmit={submit} className="space-y-2">
        <Label htmlFor={`${id}-body`}>{t("admin.order.notes.label")}</Label>
        <Textarea
          id={`${id}-body`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder={t("admin.order.notes.placeholder")}
          aria-invalid={shown ? true : undefined}
          aria-describedby={shown ? `${id}-body-error` : undefined}
        />
        <FieldError id={`${id}-body-error`} message={shown} />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={add.isPending}>
            {add.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {add.isPending ? t("admin.order.notes.adding") : t("admin.order.notes.add")}
          </Button>
        </div>
      </form>

      <div className="mt-4 border-t pt-4">
        {notes.isError ? (
          <LoadError
            title={t("admin.order.notes.loadFailed")}
            error={notes.error}
            onRetry={() => void notes.refetch()}
          />
        ) : notes.isPending ? (
          <Skeleton className="h-14 w-full" />
        ) : notes.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("admin.order.notes.empty")}</p>
        ) : (
          <ul className="space-y-3">
            {notes.data.map((note) => (
              <li key={note.id} className="rounded-md border bg-cream/40 px-3 py-2.5 text-sm">
                <p className="whitespace-pre-line break-words leading-6 text-foreground">
                  {note.body}
                </p>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {t("admin.order.notes.by", {
                    name: personName(note.created_by, people.data, null),
                    date: formatDateTime(note.created_at),
                  })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
