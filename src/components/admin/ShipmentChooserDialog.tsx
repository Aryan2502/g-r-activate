import { useId, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Info, Loader2, PackagePlus, Plane } from "lucide-react";
import { toast } from "sonner";

import { Callout, FieldError } from "@/components/admin/Callout";
import { LoadError } from "@/components/portal/Section";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { adminKeys } from "@/lib/admin/keys";
import {
  addOrdersToShipment,
  adminShipmentsQueryOptions,
  candidateRefusal,
  isShipmentDone,
  membersByShipment,
  shipmentMembersQueryOptions,
  summarizeShipment,
  type Shipment,
} from "@/lib/admin/shipments";
import type { AdminStatusMap } from "@/lib/admin/statuses";
import { errorMessage } from "@/lib/errors";
import { formatNumber } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { paths } from "@/lib/paths";
import type { ServiceType, StatusStage } from "@/lib/portal/orders";

export interface ChooserOrder {
  id: string;
  reference: string;
  service_type: ServiceType;
  shipment_id: string | null;
  created_at: string;
  stage: StatusStage | null;
}

/**
 * "Aan zending toevoegen" from the order list (a selection) or an order page:
 * pick a shipment still under way; only orders of its service type that are
 * not finished go in (the same rule and the same update as on the shipment
 * page). The dialog says up front which orders will be skipped.
 */
export function ShipmentChooserDialog({
  userId,
  orders,
  statuses,
  open,
  onOpenChange,
  onDone,
}: {
  userId: string;
  orders: readonly ChooserOrder[];
  statuses: AdminStatusMap;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After a successful add (e.g. to clear a selection). */
  onDone?: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const single = orders.length === 1 ? orders[0] : undefined;
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {t("admin.shipments.choose.title")}
          </DialogTitle>
          <DialogDescription>
            {single
              ? t("admin.shipments.choose.introOne", { reference: single.reference })
              : t("admin.shipments.choose.introMany", {
                  count: formatNumber(orders.length, 0),
                })}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <ChooserForm
            userId={userId}
            orders={orders}
            statuses={statuses}
            onBusyChange={setBusy}
            onClose={() => onOpenChange(false)}
            onDone={onDone}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ChooserForm({
  userId,
  orders,
  statuses,
  onBusyChange,
  onClose,
  onDone,
}: {
  userId: string;
  orders: readonly ChooserOrder[];
  statuses: AdminStatusMap;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
  onDone: (() => void) | undefined;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const shipments = useQuery(adminShipmentsQueryOptions(userId));
  const members = useQuery(shipmentMembersQueryOptions(userId));
  const [shipmentId, setShipmentId] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Shipments still under way (or empty); the current one of a single order stays visible.
  const options = useMemo(() => {
    const grouped = membersByShipment(members.data ?? []);
    return (shipments.data ?? []).filter((s) => {
      const summary = summarizeShipment(s, grouped.get(s.id) ?? [], statuses);
      return !isShipmentDone(summary) || orders.some((o) => o.shipment_id === s.id);
    });
  }, [shipments.data, members.data, statuses, orders]);
  const chosen: Shipment | undefined = options.find((s) => s.id === shipmentId);

  const refusals = chosen ? orders.map((o) => candidateRefusal(o, chosen)) : [];
  const eligible = chosen ? orders.filter((_, i) => refusals[i] === null) : [];
  const typeSkipped = refusals.filter((r) => r === "serviceType").length;
  const closedSkipped = refusals.filter((r) => r === "closed").length;

  const save = useMutation({
    mutationFn: (target: Shipment) =>
      addOrdersToShipment(
        supabase,
        target,
        eligible.map((o) => o.id),
      ),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: async (result, target) => {
      toast.success(
        t(
          result.done.length === 1
            ? "admin.shipments.add.addedOne"
            : "admin.shipments.add.addedMany",
          { count: formatNumber(result.done.length, 0), number: target.shipment_number },
        ),
      );
      await queryClient.invalidateQueries({ queryKey: adminKeys.orders(userId) });
      onClose();
      onDone?.();
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(errorMessage(e));
    },
  });

  const error = !chosen ? t("admin.shipments.choose.placeholder") : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setProblem(null);
    if (!chosen) {
      document.getElementById(`${id}-shipment`)?.focus();
      return;
    }
    if (eligible.length === 0) return;
    save.mutate(chosen);
  };

  if (shipments.isError || members.isError) {
    return (
      <LoadError
        title={t("admin.shipments.choose.loadFailed")}
        error={shipments.error ?? members.error}
        onRetry={() => {
          if (shipments.isError) void shipments.refetch();
          if (members.isError) void members.refetch();
        }}
      />
    );
  }
  if (shipments.isPending || members.isPending) {
    return (
      <div className="space-y-2" aria-busy="true">
        <span className="sr-only">{t("common.loading")}</span>
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (options.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-foreground">{t("admin.shipments.choose.none")}</p>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("admin.shipments.add.cancel")}
          </Button>
          <Button asChild>
            <Link to={paths.adminShipments}>
              <Plane aria-hidden />
              {t("admin.shipments.new")}
            </Link>
          </Button>
        </DialogFooter>
      </div>
    );
  }

  const shownError = submitted ? error : null;
  return (
    <form noValidate onSubmit={submit} className="min-w-0 space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-shipment`}>{t("admin.shipments.choose.shipment")}</Label>
        <Select value={shipmentId} onValueChange={setShipmentId}>
          <SelectTrigger
            id={`${id}-shipment`}
            className="h-11 sm:h-10"
            aria-invalid={shownError ? true : undefined}
            aria-describedby={shownError ? `${id}-shipment-error` : undefined}
          >
            <SelectValue placeholder={t("admin.shipments.choose.placeholder")} />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {options.map((s) => {
              const current = orders.length > 0 && orders.every((o) => o.shipment_id === s.id);
              return (
                <SelectItem key={s.id} value={s.id} disabled={current}>
                  {s.shipment_number} · {t(`portal.serviceTypes.${s.service_type}`)}
                  {s.carrier ? ` · ${s.carrier}` : ""}
                  {current ? ` (${t("admin.shipments.choose.current")})` : ""}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <FieldError id={`${id}-shipment-error`} message={shownError} />
      </div>

      {chosen ? (
        eligible.length === 0 ? (
          <Callout
            tone="warning"
            icon={AlertTriangle}
            title={t("admin.shipments.choose.noneMatch")}
          >
            <Skipped typeSkipped={typeSkipped} closedSkipped={closedSkipped} />
          </Callout>
        ) : typeSkipped + closedSkipped > 0 ? (
          <Callout
            tone="info"
            icon={Info}
            title={t(
              eligible.length === 1
                ? "admin.shipments.choose.goingOne"
                : "admin.shipments.choose.goingMany",
              { count: formatNumber(eligible.length, 0) },
            )}
          >
            <Skipped typeSkipped={typeSkipped} closedSkipped={closedSkipped} />
          </Callout>
        ) : (
          <p className="text-sm text-muted-foreground">{t("admin.shipments.choose.allMatch")}</p>
        )
      ) : null}

      {problem ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {t("admin.shipments.add.failed")} {problem}
          </span>
        </p>
      ) : null}

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
          {t("admin.shipments.add.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={save.isPending || (chosen !== undefined && eligible.length === 0)}
        >
          {save.isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <PackagePlus aria-hidden />
          )}
          {save.isPending
            ? t("admin.shipments.add.submitting")
            : t("admin.shipments.choose.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Skipped({ typeSkipped, closedSkipped }: { typeSkipped: number; closedSkipped: number }) {
  const t = useT();
  return (
    <>
      {typeSkipped > 0 ? (
        <p>
          {t(
            typeSkipped === 1
              ? "admin.shipments.choose.typeSkippedOne"
              : "admin.shipments.choose.typeSkippedMany",
            { count: formatNumber(typeSkipped, 0) },
          )}
        </p>
      ) : null}
      {closedSkipped > 0 ? (
        <p>
          {t(
            closedSkipped === 1
              ? "admin.shipments.choose.closedSkippedOne"
              : "admin.shipments.choose.closedSkippedMany",
            { count: formatNumber(closedSkipped, 0) },
          )}
        </p>
      ) : null}
    </>
  );
}
