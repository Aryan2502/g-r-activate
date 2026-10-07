import { useId, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Scale } from "lucide-react";
import { toast } from "sonner";

import { FieldError } from "@/components/admin/Callout";
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
  measuredWeightText,
  updateMeasuredWeight,
  weightFromText,
} from "@/lib/admin/order-actions";
import type { ReceiveTarget } from "@/lib/admin/orders";
import {
  firstActiveStatus,
  receiveMode,
  type AdminStatusMap,
  type ReceiveMode,
} from "@/lib/admin/statuses";
import { errorMessage } from "@/lib/errors";
import { formatLbs, formatNumber } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { submitReceive } from "@/lib/server-fns/admin-orders.functions";

/** Where the dialog was opened from may want something after it (e.g. the next scan). */
export interface ReceiveDialogOptions {
  /** After a successful save. */
  onDone?: () => void;
  /** Where focus goes when the dialog closes (default: where it came from). */
  returnFocus?: () => HTMLElement | null;
}

/**
 * "Ontvangen in US-magazijn" (SPEC §35.7, no scanner screen): the measured
 * weight in lbs, then receive_order moves the order to the first active
 * US-warehouse status (receiveOrderFn). While the order is in the US
 * warehouse, the same dialog corrects the weight; past it, it sets the
 * measured weight directly ("Gewicht invullen").
 */
export function ReceiveDialog({
  userId,
  order,
  statuses,
  open,
  onOpenChange,
  options,
}: {
  userId: string;
  order: ReceiveTarget | null;
  statuses: AdminStatusMap;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options?: ReceiveDialogOptions | null;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const mode = order ? receiveMode(order) : "receive";
  return (
    <Dialog open={open && order !== null} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        className="w-[calc(100%-2rem)] rounded-lg bg-card sm:max-w-md"
        onCloseAutoFocus={(event) => {
          const element = options?.returnFocus?.();
          if (!element) return;
          event.preventDefault();
          element.focus();
          if (element instanceof HTMLInputElement) element.select();
        }}
      >
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {mode === "receive"
              ? t("admin.receive.title")
              : mode === "correct" || order?.measured_weight_lbs !== null
                ? t("admin.receive.correctTitle")
                : t("admin.receive.setWeightTitle")}
          </DialogTitle>
          <DialogDescription>
            {order?.customerLabel
              ? t("admin.receive.intro", {
                  reference: order.reference,
                  customer: order.customerLabel,
                })
              : t("admin.receive.introNoCustomer", { reference: order?.reference ?? "" })}
          </DialogDescription>
        </DialogHeader>
        {order ? (
          <ReceiveForm
            userId={userId}
            order={order}
            mode={mode}
            statuses={statuses}
            onBusyChange={setBusy}
            onDone={options?.onDone}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

const weightInput = (n: number | null) => (n === null ? "" : formatNumber(n, 2).replace(/\./g, ""));

function ReceiveForm({
  userId,
  order,
  mode,
  statuses,
  onBusyChange,
  onDone,
  onClose,
}: {
  userId: string;
  order: ReceiveTarget;
  mode: ReceiveMode;
  statuses: AdminStatusMap;
  onBusyChange: (busy: boolean) => void;
  onDone: (() => void) | undefined;
  onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const [weight, setWeight] = useState(weightInput(order.measured_weight_lbs));
  const [submitted, setSubmitted] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const next =
    mode === "receive" && order.stage !== "us_warehouse"
      ? firstActiveStatus(statuses, "us_warehouse")
      : null;

  const check = measuredWeightText.safeParse(weight);
  const error = !weight.trim()
    ? t("admin.receive.weightRequired")
    : check.success
      ? null
      : t("admin.receive.weightInvalid");

  const save = useMutation({
    mutationFn: async () => {
      if (mode !== "weight") {
        await submitReceive({ orderId: order.id, measuredWeightLbs: weight });
        return;
      }
      const lbs = weightFromText(weight);
      if (lbs === null) throw new Error("validated weight missing");
      // A staff-editable column: the staff member's own client, RLS and the audit trigger.
      await updateMeasuredWeight(supabase, { orderId: order.id, measuredWeightLbs: lbs });
    },
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: async () => {
      toast.success(
        mode === "receive"
          ? t("admin.receive.success", { reference: order.reference })
          : t("admin.receive.corrected", { reference: order.reference }),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.orders(userId) }),
        queryClient.invalidateQueries({ queryKey: adminKeys.tasks(userId) }),
      ]);
      onDone?.();
      onClose();
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(errorMessage(e));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setProblem(null);
    if (error) {
      document.getElementById(`${id}-weight`)?.focus();
      return;
    }
    save.mutate();
  };

  const shownError = submitted ? error : null;
  return (
    <form noValidate onSubmit={submit} className="min-w-0 space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-weight`}>{t("admin.receive.weight")}</Label>
        <Input
          id={`${id}-weight`}
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          className="h-11 max-w-40 tabular-nums sm:h-10"
          aria-invalid={shownError ? true : undefined}
          aria-describedby={`${id}-weight-hint${shownError ? ` ${id}-weight-error` : ""}`}
        />
        <p id={`${id}-weight-hint`} className="text-xs text-muted-foreground">
          {order.declared_weight_lbs !== null
            ? t("admin.receive.declared", { weight: formatLbs(order.declared_weight_lbs) })
            : t("admin.receive.notDeclared")}
        </p>
        <FieldError id={`${id}-weight-error`} message={shownError} />
      </div>
      {next ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Scale className="size-4 shrink-0 text-primary" aria-hidden />
          {t("admin.receive.next", { status: next.label_nl })}
        </p>
      ) : mode === "weight" ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Scale className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          {order.received_at
            ? t("admin.receive.weightOnly")
            : t("admin.receive.weightOnlyNotReceived")}
        </p>
      ) : null}
      {problem ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {t("admin.receive.failed")} {problem}
          </span>
        </p>
      ) : null}
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
          {t("admin.receive.cancel")}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Scale aria-hidden />
          )}
          {save.isPending
            ? t("admin.receive.submitting")
            : mode === "receive"
              ? t("admin.receive.submit")
              : t("admin.receive.submitCorrect")}
        </Button>
      </DialogFooter>
    </form>
  );
}
