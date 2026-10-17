import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, Tag, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { adminKeys } from "@/lib/admin/keys";
import {
  LABEL_COLORS,
  LABEL_COLOR_STYLES,
  LABEL_MAX_LENGTH,
  addOrderLabels,
  labelInputSchema,
  labelsInUse,
  orderLabelsQueryOptions,
  removeOrderLabel,
  type LabelColor,
  type OrderLabel,
} from "@/lib/admin/order-labels";
import { errorMessage } from "@/lib/errors";
import { formatNumber } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Order labels (SPEC §36): free text and a colour, put on orders by the team
 * (e.g. "Air", "Ocean"). Customers never see them.
 */

export function LabelChip({
  label,
  color,
  onRemove,
  removing,
  className,
}: {
  label: string;
  color: LabelColor;
  onRemove?: () => void;
  removing?: boolean;
  className?: string;
}) {
  const t = useT();
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold leading-5",
        className,
      )}
      style={LABEL_COLOR_STYLES[color]}
    >
      <span className="truncate">{label}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={removing}
          className="-mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          aria-label={t("admin.labels.remove", { label })}
          title={t("admin.labels.remove", { label })}
        >
          {removing ? (
            <Loader2 className="size-3 animate-spin" aria-hidden />
          ) : (
            <X className="size-3" aria-hidden />
          )}
        </button>
      ) : null}
    </span>
  );
}

/** The labels of one order, read-only (lists and cards). */
export function OrderLabelList({
  labels,
  className,
}: {
  labels: readonly OrderLabel[] | undefined;
  className?: string;
}) {
  const t = useT();
  if (!labels?.length) return null;
  return (
    <ul aria-label={t("admin.labels.listLabel")} className={cn("flex flex-wrap gap-1", className)}>
      {labels.map((l) => (
        <li key={l.id} className="min-w-0">
          <LabelChip label={l.label} color={l.color} />
        </li>
      ))}
    </ul>
  );
}

/**
 * "Label toevoegen": pick a label already in use, or type one and pick a
 * colour. Works for one order (order page) and for a selection (list).
 */
export function AddLabelDialog({
  userId,
  orderIds,
  open,
  onOpenChange,
  onDone,
}: {
  userId: string;
  orderIds: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const many = orderIds.length > 1;
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {many
              ? t("admin.labels.form.titleMany", { count: formatNumber(orderIds.length, 0) })
              : t("admin.labels.form.titleOne")}
          </DialogTitle>
          <DialogDescription>{t("admin.labels.form.intro")}</DialogDescription>
        </DialogHeader>
        {open ? (
          <AddLabelForm
            userId={userId}
            orderIds={orderIds}
            onBusyChange={setBusy}
            onClose={() => onOpenChange(false)}
            onDone={onDone}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AddLabelForm({
  userId,
  orderIds,
  onBusyChange,
  onClose,
  onDone,
}: {
  userId: string;
  orderIds: readonly string[];
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
  onDone: (() => void) | undefined;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const labels = useQuery(orderLabelsQueryOptions(userId));
  const [text, setText] = useState("");
  const [color, setColor] = useState<LabelColor>("blue");
  const [error, setError] = useState<string | null>(null);
  const inUse = labelsInUse(labels.data?.labels ?? []).slice(0, 16);

  const add = useMutation({
    mutationFn: (input: { label: string; color: LabelColor }) =>
      addOrderLabels(supabase, orderIds, input),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: async (added, input) => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.orderLabels(userId) });
      if (added.length === 0) {
        toast.info(
          orderIds.length > 1
            ? t("admin.labels.form.alreadyThereMany")
            : t("admin.labels.form.alreadyThere"),
        );
      } else {
        toast.success(
          added.length > 1
            ? t("admin.labels.form.addedMany", {
                label: input.label,
                count: formatNumber(added.length, 0),
              })
            : t("admin.labels.form.addedOne", { label: input.label }),
        );
      }
      onDone?.();
      onClose();
    },
    onError: (e) => setError(`${t("admin.labels.form.failed")} ${errorMessage(e)}`),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = labelInputSchema.safeParse({ label: text, color });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("admin.labels.form.textRequired"));
      return;
    }
    setError(null);
    add.mutate(parsed.data);
  };

  return (
    <form noValidate onSubmit={submit} className="min-w-0 space-y-5">
      {inUse.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium" id={`${id}-in-use`}>
            {t("admin.labels.form.inUse")}
          </p>
          <ul aria-labelledby={`${id}-in-use`} className="flex flex-wrap gap-2">
            {inUse.map((l) => (
              <li key={l.key}>
                <button
                  type="button"
                  disabled={add.isPending}
                  onClick={() => add.mutate({ label: l.label, color: l.color })}
                  className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  <LabelChip
                    label={l.label}
                    color={l.color}
                    className="cursor-pointer px-2.5 py-1 text-sm hover:brightness-95"
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-text`}>{t("admin.labels.form.text")}</Label>
        <Input
          id={`${id}-text`}
          value={text}
          maxLength={LABEL_MAX_LENGTH}
          autoComplete="off"
          placeholder={t("admin.labels.form.textPlaceholder")}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          className="h-11 sm:h-10"
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("admin.labels.form.color")}</legend>
        <div role="radiogroup" className="flex flex-wrap gap-2">
          {LABEL_COLORS.map((c) => {
            const name = t(`admin.labels.colors.${c}`);
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={name}
                title={name}
                onClick={() => setColor(c)}
                className={cn(
                  "flex size-9 items-center justify-center rounded-full border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  color === c ? "border-foreground" : "border-transparent",
                )}
                style={{ background: LABEL_COLOR_STYLES[c].background }}
              >
                <span
                  className="flex size-6 items-center justify-center rounded-full"
                  style={{ background: LABEL_COLOR_STYLES[c].color }}
                >
                  {color === c ? <Check className="size-3.5 text-white" aria-hidden /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>{t("admin.labels.form.preview")}:</span>
        <LabelChip
          label={text.trim() || t("admin.labels.form.textPlaceholder")}
          color={color}
          className="px-2.5 py-1 text-sm"
        />
      </div>

      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={add.isPending}>
          {t("admin.labels.form.cancel")}
        </Button>
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Tag aria-hidden />}
          {add.isPending ? t("admin.labels.form.saving") : t("admin.labels.form.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The labels on the order page: shown, removed and added in place. */
export function OrderLabelsBar({ userId, orderId }: { userId: string; orderId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const labels = useQuery(orderLabelsQueryOptions(userId));
  const [adding, setAdding] = useState(false);
  const remove = useMutation({
    mutationFn: (label: OrderLabel) => removeOrderLabel(supabase, label.id),
    onSuccess: async (_, label) => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.orderLabels(userId) });
      toast.success(t("admin.labels.removed", { label: label.label }));
    },
    onError: (e) => toast.error(`${t("admin.labels.removeFailed")} ${errorMessage(e)}`),
  });

  if (labels.isPending) return null;
  if (labels.isError) {
    return <p className="mt-3 text-sm text-destructive">{t("admin.labels.loadFailed")}</p>;
  }
  if (!labels.data.available) {
    return <p className="mt-3 text-xs text-muted-foreground">{t("admin.labels.unavailable")}</p>;
  }
  const mine = labels.data.labels.filter((l) => l.order_id === orderId);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {mine.length > 0 ? (
        <ul aria-label={t("admin.labels.listLabel")} className="flex flex-wrap gap-1.5">
          {mine.map((l) => (
            <li key={l.id}>
              <LabelChip
                label={l.label}
                color={l.color}
                className="px-2.5 py-1 text-sm"
                onRemove={() => remove.mutate(l)}
                removing={remove.isPending && remove.variables?.id === l.id}
              />
            </li>
          ))}
        </ul>
      ) : null}
      <Button size="sm" variant="ghost" className="h-8" onClick={() => setAdding(true)}>
        <Plus aria-hidden />
        {t("admin.labels.add")}
      </Button>
      <AddLabelDialog userId={userId} orderIds={[orderId]} open={adding} onOpenChange={setAdding} />
    </div>
  );
}
