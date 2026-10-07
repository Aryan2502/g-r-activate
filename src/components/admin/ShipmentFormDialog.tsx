import { useId, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Eye, Loader2, Plane, Save } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { Constants } from "@/integrations/supabase/types";
import { adminKeys } from "@/lib/admin/keys";
import {
  SHIPMENT_LIMITS,
  createShipment,
  emptyShipmentForm,
  shipmentFormFromRow,
  updateShipment,
  validateShipmentForm,
  type Shipment,
  type ShipmentFormErrors,
  type ShipmentFormField,
  type ShipmentFormValues,
} from "@/lib/admin/shipments";
import { errorMessage } from "@/lib/errors";
import { formatDateTime, surinameDateTimeToIso } from "@/lib/format";
import { useT } from "@/lib/i18n";
import type { ServiceType } from "@/lib/portal/orders";

/** Field order of the form, for focusing the first problem. */
const FIELDS: readonly ShipmentFormField[] = [
  "shipmentNumber",
  "serviceType",
  "carrier",
  "awbOrContainerNumber",
  "departedAt",
  "arrivedAt",
  "customerNote",
];

/**
 * "Zending aanmaken" / "Gegevens wijzigen" (SPEC §35.7): number, service
 * type, carrier, AWB or container number, departure and arrival (Suriname
 * time) and a note for the customers. Written with the staff member's own
 * client (RLS: staff insert/update shipments). Customers with an order in the
 * shipment see all of it in the portal.
 */
export function ShipmentFormDialog({
  userId,
  shipment,
  serviceTypeLocked = false,
  open,
  onOpenChange,
  onCreated,
}: {
  userId: string;
  /** null: create a new shipment. */
  shipment: Shipment | null;
  /** The shipment has orders: its service type stays (orders must match it). */
  serviceTypeLocked?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (shipment: Shipment) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-card sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {shipment
              ? t("admin.shipments.form.editTitle", { number: shipment.shipment_number })
              : t("admin.shipments.form.createTitle")}
          </DialogTitle>
          <DialogDescription>
            {shipment ? t("admin.shipments.form.editIntro") : t("admin.shipments.form.createIntro")}
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so every opening starts from the saved values. */}
        {open ? (
          <ShipmentForm
            userId={userId}
            shipment={shipment}
            serviceTypeLocked={serviceTypeLocked}
            onBusyChange={setBusy}
            onClose={() => onOpenChange(false)}
            onCreated={onCreated}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ShipmentForm({
  userId,
  shipment,
  serviceTypeLocked,
  onBusyChange,
  onClose,
  onCreated,
}: {
  userId: string;
  shipment: Shipment | null;
  serviceTypeLocked: boolean;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
  onCreated: ((shipment: Shipment) => void) | undefined;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<ShipmentFormValues>(() =>
    shipment ? shipmentFormFromRow(shipment) : emptyShipmentForm(),
  );
  const [errors, setErrors] = useState<ShipmentFormErrors>({});
  const [problem, setProblem] = useState<string | null>(null);

  const set = <K extends ShipmentFormField>(field: K, value: ShipmentFormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    // A corrected field loses its error; the rest stays until the next submit.
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const save = useMutation({
    mutationFn: async (columns: Parameters<typeof createShipment>[1]) => {
      if (shipment) {
        await updateShipment(supabase, shipment.id, columns);
        return null;
      }
      return createShipment(supabase, columns);
    },
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: async (created, columns) => {
      toast.success(
        created
          ? t("admin.shipments.form.created", { number: created.shipment_number })
          : t("admin.shipments.form.saved", { number: columns.shipment_number }),
      );
      // Order pages embed the shipment, so refresh everything under orders.
      await queryClient.invalidateQueries({ queryKey: adminKeys.orders(userId) });
      onClose();
      if (created) onCreated?.(created);
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(errorMessage(e));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const result = validateShipmentForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      const first = FIELDS.find((f) => result.errors[f]);
      if (first) document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    setErrors({});
    save.mutate(result.columns);
  };

  const describedBy = (field: ShipmentFormField, hint = false) =>
    [hint ? `${id}-${field}-hint` : null, errors[field] ? `${id}-${field}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;
  const invalid = (field: ShipmentFormField) => (errors[field] ? true : undefined);
  const chosen = (value: string) => {
    const iso = surinameDateTimeToIso(value);
    return iso ? t("admin.shipments.form.chosen", { value: formatDateTime(iso) }) : null;
  };

  return (
    <form noValidate onSubmit={submit} className="min-w-0 space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-shipmentNumber`}>{t("admin.shipments.form.number")}</Label>
        <Input
          id={`${id}-shipmentNumber`}
          value={values.shipmentNumber}
          onChange={(e) => set("shipmentNumber", e.target.value)}
          maxLength={SHIPMENT_LIMITS.shipmentNumber + 20}
          autoComplete="off"
          spellCheck={false}
          className="h-11 tabular-nums sm:h-10"
          aria-invalid={invalid("shipmentNumber")}
          aria-describedby={describedBy("shipmentNumber", true)}
        />
        <p id={`${id}-shipmentNumber-hint`} className="text-xs text-muted-foreground">
          {t("admin.shipments.form.numberHint")}
        </p>
        <FieldError id={`${id}-shipmentNumber-error`} message={errors.shipmentNumber ?? null} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-serviceType`}>{t("admin.shipments.form.serviceType")}</Label>
        <Select
          value={values.serviceType}
          onValueChange={(v) => {
            const next = Constants.public.Enums.service_type.find((s) => s === v);
            if (next) set("serviceType", next satisfies ServiceType);
          }}
          disabled={serviceTypeLocked}
        >
          <SelectTrigger
            id={`${id}-serviceType`}
            className="h-11 sm:h-10"
            aria-invalid={invalid("serviceType")}
            aria-describedby={describedBy("serviceType", serviceTypeLocked)}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Constants.public.Enums.service_type.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`portal.serviceTypes.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {serviceTypeLocked ? (
          <p id={`${id}-serviceType-hint`} className="text-xs text-muted-foreground">
            {t("admin.shipments.form.serviceTypeLocked")}
          </p>
        ) : null}
        <FieldError id={`${id}-serviceType-error`} message={errors.serviceType ?? null} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${id}-carrier`}>
            {t("admin.shipments.form.carrier")}{" "}
            <span className="font-normal text-muted-foreground">
              ({t("portal.orderForm.optional")})
            </span>
          </Label>
          <Input
            id={`${id}-carrier`}
            value={values.carrier}
            onChange={(e) => set("carrier", e.target.value)}
            maxLength={SHIPMENT_LIMITS.carrier + 20}
            autoComplete="off"
            className="h-11 sm:h-10"
            aria-invalid={invalid("carrier")}
            aria-describedby={describedBy("carrier")}
          />
          <FieldError id={`${id}-carrier-error`} message={errors.carrier ?? null} />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${id}-awbOrContainerNumber`}>
            {t("admin.shipments.form.awb")}{" "}
            <span className="font-normal text-muted-foreground">
              ({t("portal.orderForm.optional")})
            </span>
          </Label>
          <Input
            id={`${id}-awbOrContainerNumber`}
            value={values.awbOrContainerNumber}
            onChange={(e) => set("awbOrContainerNumber", e.target.value)}
            maxLength={SHIPMENT_LIMITS.awbOrContainerNumber + 20}
            autoComplete="off"
            spellCheck={false}
            className="h-11 tabular-nums sm:h-10"
            aria-invalid={invalid("awbOrContainerNumber")}
            aria-describedby={describedBy("awbOrContainerNumber")}
          />
          <FieldError
            id={`${id}-awbOrContainerNumber-error`}
            message={errors.awbOrContainerNumber ?? null}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {(["departedAt", "arrivedAt"] as const).map((field) => {
          const shown = chosen(values[field]);
          return (
            <div key={field} className="min-w-0 space-y-1.5">
              <Label htmlFor={`${id}-${field}`}>
                {t(`admin.shipments.form.${field}`)}{" "}
                <span className="font-normal text-muted-foreground">
                  ({t("portal.orderForm.optional")})
                </span>
              </Label>
              <Input
                id={`${id}-${field}`}
                type="datetime-local"
                value={values[field]}
                onChange={(e) => set(field, e.target.value)}
                className="h-11 min-w-0 tabular-nums sm:h-10"
                aria-invalid={invalid(field)}
                aria-describedby={describedBy(field, shown !== null)}
              />
              {shown ? (
                <p id={`${id}-${field}-hint`} className="text-xs text-muted-foreground">
                  {shown}
                </p>
              ) : null}
              <FieldError id={`${id}-${field}-error`} message={errors[field] ?? null} />
            </div>
          );
        })}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-customerNote`}>
          {t("admin.shipments.form.customerNote")}{" "}
          <span className="font-normal text-muted-foreground">
            ({t("portal.orderForm.optional")})
          </span>
        </Label>
        <Textarea
          id={`${id}-customerNote`}
          value={values.customerNote}
          onChange={(e) => set("customerNote", e.target.value)}
          rows={3}
          aria-invalid={invalid("customerNote")}
          aria-describedby={describedBy("customerNote", true)}
        />
        <p
          id={`${id}-customerNote-hint`}
          className="flex items-start gap-1.5 text-xs text-muted-foreground"
        >
          <Eye className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t("admin.shipments.form.customerNoteHint")}
        </p>
        <FieldError id={`${id}-customerNote-error`} message={errors.customerNote ?? null} />
      </div>

      {problem ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {t("admin.shipments.form.failed")} {problem}
          </span>
        </p>
      ) : null}

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
          {t("admin.shipments.form.cancel")}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : shipment ? (
            <Save aria-hidden />
          ) : (
            <Plane aria-hidden />
          )}
          {save.isPending
            ? shipment
              ? t("admin.shipments.form.saving")
              : t("admin.shipments.form.creating")
            : shipment
              ? t("admin.shipments.form.save")
              : t("admin.shipments.form.create")}
        </Button>
      </DialogFooter>
    </form>
  );
}
