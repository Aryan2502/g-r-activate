import { useId, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, Loader2, Plus, Save } from "lucide-react";
import { toast } from "sonner";

import { Callout, FieldError } from "@/components/admin/Callout";
import { refreshStatuses } from "@/components/admin/status-config-mutations";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  STATUS_LIMITS,
  createStatus,
  deactivationImpact,
  emptyNewStatusForm,
  setStatusActive,
  statusFormFromRow,
  suggestSortOrder,
  suggestStatusCode,
  updateStatus,
  validateNewStatusForm,
  validateStatusForm,
  type NewStatusFormValues,
  type StatusFormErrors,
  type StatusFormField,
} from "@/lib/admin/status-config";
import { STAGE_DISPLAY_ORDER, type AdminStatusMap, type StatusRow } from "@/lib/admin/statuses";
import { errorMessage } from "@/lib/errors";
import { formatNumber } from "@/lib/format";
import { useT } from "@/lib/i18n";
import type { StatusStage } from "@/lib/portal/orders";

const FIELD_ORDER: readonly StatusFormField[] = [
  "stage",
  "labelNl",
  "code",
  "customerDescriptionNl",
  "sortOrder",
];

export type StatusDialogTarget =
  { mode: "edit"; status: StatusRow } | { mode: "create"; stage: StatusStage | "" };

/**
 * "Status toevoegen" / "Status wijzigen" (admins only; RLS refuses anyone
 * else). Editing changes the label, the customer description, the sort order
 * and the flags; the code and stage of an existing status stay as they are.
 */
export function StatusFormDialog({
  userId,
  statuses,
  target,
  onOpenChange,
}: {
  userId: string;
  statuses: AdminStatusMap;
  target: StatusDialogTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={target !== null} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-card sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {target?.mode === "edit"
              ? t("admin.statuses.form.editTitle", { label: target.status.label_nl })
              : t("admin.statuses.form.addTitle")}
          </DialogTitle>
          <DialogDescription>
            {target?.mode === "edit"
              ? t("admin.statuses.form.editIntro", {
                  code: target.status.code,
                  stage: t(`portal.stages.${target.status.stage}`),
                })
              : t("admin.statuses.form.addIntro")}
          </DialogDescription>
        </DialogHeader>
        {target ? (
          <StatusForm
            userId={userId}
            statuses={statuses}
            target={target}
            onBusyChange={setBusy}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StatusForm({
  userId,
  statuses,
  target,
  onBusyChange,
  onClose,
}: {
  userId: string;
  statuses: AdminStatusMap;
  target: StatusDialogTarget;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const creating = target.mode === "create";
  const [values, setValues] = useState<NewStatusFormValues>(() =>
    target.mode === "edit"
      ? {
          ...statusFormFromRow(target.status),
          code: target.status.code,
          stage: target.status.stage,
        }
      : emptyNewStatusForm(statuses, target.stage),
  );
  const [codeTouched, setCodeTouched] = useState(false);
  const [sortTouched, setSortTouched] = useState(false);
  const [errors, setErrors] = useState<StatusFormErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const taken = useMemo(() => new Set(statuses.keys()), [statuses]);

  const set = (patch: Partial<NewStatusFormValues>) => {
    setValues((prev) => ({ ...prev, ...patch }));
    setErrors((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(patch) as StatusFormField[]) delete next[key];
      return next;
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (target.mode === "edit") {
        const result = validateStatusForm(values);
        if (!result.ok) throw new Error("validated before");
        await updateStatus(supabase, target.status.code, result.columns);
        return result.columns.label_nl;
      }
      const result = validateNewStatusForm(values, statuses);
      if (!result.ok) throw new Error("validated before");
      await createStatus(supabase, result.columns);
      return result.columns.label_nl;
    },
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: async (label) => {
      toast.success(
        creating
          ? t("admin.statuses.form.created", { label })
          : t("admin.statuses.form.saved", { label }),
      );
      await refreshStatuses(queryClient, userId);
      onClose();
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(errorMessage(e));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const result = creating ? validateNewStatusForm(values, statuses) : validateStatusForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      const first = FIELD_ORDER.find((f) => result.errors[f]);
      if (first) document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    setErrors({});
    save.mutate();
  };

  const describedBy = (field: StatusFormField, hint: boolean) =>
    [hint ? `${id}-${field}-hint` : null, errors[field] ? `${id}-${field}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;
  const invalid = (field: StatusFormField) => (errors[field] ? true : undefined);

  return (
    <form noValidate onSubmit={submit} className="min-w-0 space-y-4">
      {creating ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-stage`}>{t("admin.statuses.form.stage")}</Label>
          <Select
            value={values.stage}
            onValueChange={(v) => {
              const stage = STAGE_DISPLAY_ORDER.find((s) => s === v);
              if (!stage) return;
              set({
                stage,
                ...(sortTouched ? {} : { sortOrder: String(suggestSortOrder(statuses, stage)) }),
              });
            }}
          >
            <SelectTrigger
              id={`${id}-stage`}
              className="h-11 sm:h-10"
              aria-invalid={invalid("stage")}
              aria-describedby={describedBy("stage", false)}
            >
              <SelectValue placeholder={t("admin.statuses.form.stagePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {STAGE_DISPLAY_ORDER.map((stage) => (
                <SelectItem key={stage} value={stage}>
                  {t(`portal.stages.${stage}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError id={`${id}-stage-error`} message={errors.stage ?? null} />
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-labelNl`}>{t("admin.statuses.form.label")}</Label>
        <Input
          id={`${id}-labelNl`}
          value={values.labelNl}
          onChange={(e) => {
            const labelNl = e.target.value;
            set({
              labelNl,
              ...(creating && !codeTouched ? { code: suggestStatusCode(labelNl, taken) } : {}),
            });
          }}
          maxLength={STATUS_LIMITS.label + 20}
          autoComplete="off"
          className="h-11 sm:h-10"
          aria-invalid={invalid("labelNl")}
          aria-describedby={describedBy("labelNl", true)}
        />
        <p id={`${id}-labelNl-hint`} className="text-xs text-muted-foreground">
          {t("admin.statuses.form.labelHint")}
        </p>
        <FieldError id={`${id}-labelNl-error`} message={errors.labelNl ?? null} />
      </div>

      {creating ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-code`}>{t("admin.statuses.form.code")}</Label>
          <Input
            id={`${id}-code`}
            value={values.code}
            onChange={(e) => {
              setCodeTouched(true);
              set({ code: e.target.value });
            }}
            maxLength={60}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="h-11 font-mono text-sm sm:h-10"
            aria-invalid={invalid("code")}
            aria-describedby={describedBy("code", true)}
          />
          <p id={`${id}-code-hint`} className="text-xs text-muted-foreground">
            {t("admin.statuses.form.codeHint")}
          </p>
          <FieldError id={`${id}-code-error`} message={errors.code ?? null} />
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-customerDescriptionNl`}>
          {t("admin.statuses.form.description")}{" "}
          <span className="font-normal text-muted-foreground">
            ({t("portal.orderForm.optional")})
          </span>
        </Label>
        <Textarea
          id={`${id}-customerDescriptionNl`}
          value={values.customerDescriptionNl}
          onChange={(e) => set({ customerDescriptionNl: e.target.value })}
          rows={3}
          aria-invalid={invalid("customerDescriptionNl")}
          aria-describedby={describedBy("customerDescriptionNl", true)}
        />
        <p id={`${id}-customerDescriptionNl-hint`} className="text-xs text-muted-foreground">
          {t("admin.statuses.form.descriptionHint")}
        </p>
        <FieldError
          id={`${id}-customerDescriptionNl-error`}
          message={errors.customerDescriptionNl ?? null}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-sortOrder`}>{t("admin.statuses.form.sortOrder")}</Label>
        <Input
          id={`${id}-sortOrder`}
          value={values.sortOrder}
          onChange={(e) => {
            setSortTouched(true);
            set({ sortOrder: e.target.value });
          }}
          inputMode="numeric"
          autoComplete="off"
          className="h-11 max-w-40 tabular-nums sm:h-10"
          aria-invalid={invalid("sortOrder")}
          aria-describedby={describedBy("sortOrder", true)}
        />
        <p id={`${id}-sortOrder-hint`} className="text-xs text-muted-foreground">
          {t("admin.statuses.form.sortOrderHint")}
        </p>
        <FieldError id={`${id}-sortOrder-error`} message={errors.sortOrder ?? null} />
      </div>

      <div className="space-y-3 rounded-md border bg-cream/50 px-3 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor={`${id}-visible`}>{t("admin.statuses.form.visible")}</Label>
            <p id={`${id}-visible-hint`} className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {t("admin.statuses.form.visibleHint")}
            </p>
          </div>
          <Switch
            id={`${id}-visible`}
            checked={values.customerVisible}
            onCheckedChange={(on) =>
              set({ customerVisible: on, ...(on ? {} : { notifyCustomer: false }) })
            }
            aria-describedby={`${id}-visible-hint`}
            className="mt-1"
          />
        </div>
        <div className="flex items-start justify-between gap-4 border-t pt-3">
          <div className="min-w-0">
            <Label htmlFor={`${id}-notify`}>{t("admin.statuses.form.notify")}</Label>
            <p id={`${id}-notify-hint`} className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {values.customerVisible
                ? t("admin.statuses.form.notifyHint")
                : t("admin.statuses.form.notifyHidden")}
            </p>
          </div>
          <Switch
            id={`${id}-notify`}
            checked={values.customerVisible && values.notifyCustomer}
            disabled={!values.customerVisible}
            onCheckedChange={(on) => set({ notifyCustomer: on })}
            aria-describedby={`${id}-notify-hint`}
            className="mt-1"
          />
        </div>
      </div>

      {problem ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {t("admin.statuses.form.failed")} {problem}
          </span>
        </p>
      ) : null}

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
          {t("admin.statuses.form.cancel")}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : creating ? (
            <Plus aria-hidden />
          ) : (
            <Save aria-hidden />
          )}
          {save.isPending
            ? creating
              ? t("admin.statuses.form.creating")
              : t("admin.statuses.form.saving")
            : creating
              ? t("admin.statuses.form.create")
              : t("admin.statuses.form.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * "Deactiveren" with what it means: orders in the status keep it, the last
 * active status of a stage leaves nowhere to move orders to (receiving or
 * hand-over stop working), and the last 'registered' one is refused (the
 * database refuses it too, 55000).
 */
export function DeactivateStatusDialog({
  userId,
  statuses,
  status,
  usage,
  onOpenChange,
}: {
  userId: string;
  statuses: AdminStatusMap;
  status: StatusRow | null;
  usage: ReadonlyMap<string, number> | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const impact = status ? deactivationImpact(statuses, status.code, usage) : null;
  const deactivate = useMutation({
    mutationFn: (row: StatusRow) => setStatusActive(supabase, row.code, false),
    onSuccess: async (_, row) => {
      toast.success(t("admin.statuses.deactivated", { label: row.label_nl }));
      await refreshStatuses(queryClient, userId);
      onOpenChange(false);
    },
    onError: (e) => toast.error(`${t("admin.statuses.toggleFailed")} ${errorMessage(e)}`),
  });

  return (
    <AlertDialog
      open={status !== null}
      onOpenChange={(next) => !deactivate.isPending && onOpenChange(next)}
    >
      <AlertDialogContent className="w-[calc(100%-2rem)] rounded-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("admin.statuses.deactivateTitle", { label: status?.label_nl ?? "" })}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>{t("admin.statuses.deactivateText")}</p>
              {impact && impact.inUse > 0 ? (
                <p className="font-medium text-foreground tabular-nums">
                  {t(
                    impact.inUse === 1
                      ? "admin.statuses.deactivateInUseOne"
                      : "admin.statuses.deactivateInUseMany",
                    { count: formatNumber(impact.inUse, 0) },
                  )}
                </p>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {status && impact?.blocked ? (
          <Callout tone="danger" icon={Ban} title={t("admin.statuses.deactivateBlocked")} />
        ) : status && impact?.lastActiveInStage ? (
          <Callout
            tone="warning"
            icon={AlertTriangle}
            title={t("admin.statuses.deactivateLast", {
              stage: t(`portal.stages.${status.stage}`),
            })}
          >
            {status.stage === "us_warehouse" ? (
              <p>{t("admin.statuses.deactivateLastReceive")}</p>
            ) : status.stage === "completed" ? (
              <p>{t("admin.statuses.deactivateLastPickup")}</p>
            ) : null}
          </Callout>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deactivate.isPending}>
            {t("admin.statuses.form.cancel")}
          </AlertDialogCancel>
          {impact?.blocked ? null : (
            <AlertDialogAction
              disabled={deactivate.isPending || !status}
              onClick={(e) => {
                e.preventDefault();
                if (status) deactivate.mutate(status);
              }}
            >
              {deactivate.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {deactivate.isPending
                ? t("admin.statuses.busy")
                : t("admin.statuses.deactivateConfirm")}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
