import { useId, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, PackagePlus, Search, Truck } from "lucide-react";
import { toast } from "sonner";

import { LoadError } from "@/components/portal/Section";
import { B2bBadge, OrderStatusBadge } from "@/components/portal/StatusBadges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { adminKeys } from "@/lib/admin/keys";
import {
  adminOrdersQueryOptions,
  buildOrderViews,
  customerDisplayName,
  exactTrackingMatches,
  matchesAdminSearch,
  type AdminOrderView,
} from "@/lib/admin/orders";
import {
  addOrdersToShipment,
  adminShipmentsQueryOptions,
  candidateRefusal,
  shipmentCandidates,
  type Shipment,
} from "@/lib/admin/shipments";
import type { AdminStatusMap } from "@/lib/admin/statuses";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatNumber } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { resolveStatus } from "@/lib/portal/orders";
import { cn } from "@/lib/utils";

/** Rows shown at once; the search narrows the rest down. */
const SHOWN = 60;

/**
 * "Orders toevoegen" to a shipment (SPEC §35.7): orders of the shipment's
 * service type that are not finished, ready ones first. Staff tick orders or
 * scan/type a tracking number and press Enter to tick it (no scanner screen
 * needed). One update with the staff member's own client puts them in; an
 * order in another shipment moves over.
 */
export function AddOrdersDialog({
  userId,
  shipment,
  statuses,
  open,
  onOpenChange,
}: {
  userId: string;
  shipment: Shipment;
  statuses: AdminStatusMap;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100%-2rem)] flex-col overflow-hidden rounded-lg bg-card sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {t("admin.shipments.add.title", { number: shipment.shipment_number })}
          </DialogTitle>
          <DialogDescription>
            {t("admin.shipments.add.intro", {
              type: t(`portal.serviceTypes.${shipment.service_type}`),
            })}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <AddOrdersForm
            userId={userId}
            shipment={shipment}
            statuses={statuses}
            onBusyChange={setBusy}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AddOrdersForm({
  userId,
  shipment,
  statuses,
  onBusyChange,
  onClose,
}: {
  userId: string;
  shipment: Shipment;
  statuses: AdminStatusMap;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const orders = useQuery(adminOrdersQueryOptions(userId));
  const shipments = useQuery(adminShipmentsQueryOptions(userId));
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const views = useMemo(
    () => (orders.data ? buildOrderViews(orders.data, statuses, undefined, undefined) : []),
    [orders.data, statuses],
  );
  const candidates = useMemo(() => shipmentCandidates(views, shipment), [views, shipment]);
  const visible = useMemo(
    () => (query.trim() ? candidates.filter((o) => matchesAdminSearch(o, query)) : candidates),
    [candidates, query],
  );
  const numbers = useMemo(
    () => new Map((shipments.data ?? []).map((s) => [s.id, s.shipment_number])),
    [shipments.data],
  );

  const toggle = (orderId: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(orderId);
      else next.delete(orderId);
      return next;
    });

  /** Enter (a scanner's last key): tick the order with exactly this tracking number. */
  const scan = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const matches = exactTrackingMatches(views, q);
    const addable = matches.filter((o) => candidateRefusal(o, shipment) === null);
    if (addable.length === 1 && addable[0]) {
      const order = addable[0];
      toggle(order.id, true);
      setQuery("");
      setNotice({
        tone: "ok",
        text: t("admin.shipments.add.scanSelected", { reference: order.reference }),
      });
      return;
    }
    if (addable.length > 1) {
      setNotice({
        tone: "warn",
        text: t("admin.shipments.add.scanMany", { count: addable.length, tracking: q }),
      });
      return;
    }
    const order = matches[0];
    if (!order) {
      // Not a tracking number of any order: leave it as a search.
      if (visible.length === 0) {
        setNotice({ tone: "warn", text: t("admin.shipments.add.scanNotFound", { tracking: q }) });
      }
      return;
    }
    const refusal = candidateRefusal(order, shipment);
    setNotice({
      tone: "warn",
      text:
        refusal === "already"
          ? t("admin.shipments.add.scanAlready", { reference: order.reference })
          : refusal === "serviceType"
            ? t("admin.shipments.add.scanServiceType", {
                reference: order.reference,
                type: t(`portal.serviceTypes.${order.service_type}`).toLowerCase(),
                shipmentType: t(`portal.serviceTypes.${shipment.service_type}`).toLowerCase(),
              })
            : t("admin.shipments.add.scanClosed", { reference: order.reference }),
    });
  };

  const save = useMutation({
    mutationFn: () => addOrdersToShipment(supabase, shipment, [...selected]),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: async (result) => {
      const moved = views.filter(
        (o) =>
          result.done.includes(o.id) && o.shipment_id !== null && o.shipment_id !== shipment.id,
      ).length;
      const parts = [
        t(
          result.done.length === 1
            ? "admin.shipments.add.addedOne"
            : "admin.shipments.add.addedMany",
          { count: formatNumber(result.done.length, 0), number: shipment.shipment_number },
        ),
      ];
      if (moved > 0) {
        parts.push(
          t(moved === 1 ? "admin.shipments.add.movedOne" : "admin.shipments.add.movedMany", {
            count: formatNumber(moved, 0),
          }),
        );
      }
      if (result.skipped.length > 0) {
        parts.push(
          t(
            result.skipped.length === 1
              ? "admin.shipments.add.skippedOne"
              : "admin.shipments.add.skippedMany",
            { count: formatNumber(result.skipped.length, 0) },
          ),
        );
      }
      (result.skipped.length > 0 ? toast.warning : toast.success)(parts.join(" "));
      await queryClient.invalidateQueries({ queryKey: adminKeys.orders(userId) });
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
    if (selected.size === 0) {
      setNotice({ tone: "warn", text: t("admin.shipments.add.selectRequired") });
      document.getElementById(`${id}-q`)?.focus();
      return;
    }
    save.mutate();
  };

  return (
    <form noValidate onSubmit={submit} className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-q`}>{t("admin.shipments.add.search")}</Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id={`${id}-q`}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setNotice(null);
            }}
            onKeyDown={scan}
            placeholder={t("admin.shipments.add.searchPlaceholder")}
            className="h-11 pl-9"
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            aria-describedby={`${id}-notice`}
          />
        </div>
        <p
          id={`${id}-notice`}
          role="status"
          className={cn(
            "min-h-5 text-sm",
            notice?.tone === "warn" ? "font-medium text-warning" : "text-muted-foreground",
          )}
        >
          {notice?.text ?? ""}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
        {orders.isError ? (
          <div className="p-4">
            <LoadError
              title={t("admin.shipments.add.loadFailed")}
              error={orders.error}
              onRetry={() => void orders.refetch()}
            />
          </div>
        ) : orders.isPending ? (
          <div className="space-y-2 p-3" aria-busy="true">
            <span className="sr-only">{t("common.loading")}</span>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : candidates.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("admin.shipments.add.none")}</p>
        ) : visible.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("admin.shipments.add.noMatch")}</p>
        ) : (
          <ul className="divide-y">
            {visible.slice(0, SHOWN).map((order) => (
              <CandidateRow
                key={order.id}
                order={order}
                statuses={statuses}
                checked={selected.has(order.id)}
                onToggle={(on) => toggle(order.id, on)}
                otherShipment={
                  order.shipment_id ? (numbers.get(order.shipment_id) ?? null) : undefined
                }
              />
            ))}
            {visible.length > SHOWN ? (
              <li className="p-3 text-sm text-muted-foreground">
                {t("admin.shipments.add.more", {
                  count: formatNumber(visible.length - SHOWN, 0),
                })}
              </li>
            ) : null}
          </ul>
        )}
      </div>

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

      {/* The count first, then the buttons (full width on phones). */}
      <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
        <p className="text-sm font-semibold text-primary tabular-nums" aria-live="polite">
          {selected.size === 0
            ? t("admin.shipments.add.selectedNone")
            : t(
                selected.size === 1
                  ? "admin.shipments.add.selectedOne"
                  : "admin.shipments.add.selectedMany",
                { count: formatNumber(selected.size, 0) },
              )}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
            {t("admin.shipments.add.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <PackagePlus aria-hidden />
            )}
            {save.isPending
              ? t("admin.shipments.add.submitting")
              : `${t("admin.shipments.add.submit")}${selected.size > 0 ? ` (${formatNumber(selected.size, 0)})` : ""}`}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

function CandidateRow({
  order,
  statuses,
  checked,
  onToggle,
  otherShipment,
}: {
  order: AdminOrderView;
  statuses: AdminStatusMap;
  checked: boolean;
  onToggle: (on: boolean) => void;
  /** undefined: in no shipment; null: in a shipment whose number is unknown. */
  otherShipment: string | null | undefined;
}) {
  const t = useT();
  const id = useId();
  return (
    <li className={cn("flex items-start gap-3 p-3", checked && "bg-cream/60")}>
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onToggle(v === true)}
        aria-label={t("admin.shipments.add.select", { reference: order.reference })}
        className="mt-0.5 size-5"
      />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer space-y-1 text-sm">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-bold text-primary tabular-nums">{order.reference}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDate(order.created_at)}
          </span>
          {order.order_type === "b2b" ? <B2bBadge /> : null}
        </span>
        {order.customer ? (
          <span className="block break-words text-foreground">
            {customerDisplayName(order.customer)}{" "}
            <span className="font-semibold text-primary tabular-nums">
              {order.customer.customer_code}
            </span>
          </span>
        ) : null}
        <span className="block text-xs text-muted-foreground tabular-nums [overflow-wrap:anywhere]">
          {order.tracking_number ?? t("admin.orders.trackingUnknown")}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <OrderStatusBadge status={resolveStatus(order.status, statuses)} />
          {otherShipment !== undefined ? (
            <Badge variant="warning">
              <Truck className="size-3.5 shrink-0" aria-hidden />
              {otherShipment
                ? t("admin.shipments.add.inOther", { number: otherShipment })
                : t("admin.shipments.add.inOtherUnknown")}
            </Badge>
          ) : null}
        </span>
      </label>
    </li>
  );
}
