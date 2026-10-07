import { useId } from "react";
import { Receipt, Scale } from "lucide-react";

import { OrderStatusBadge, B2bBadge } from "@/components/portal/StatusBadges";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { listedOrders, type BuilderOrder } from "@/lib/admin/invoice-builder";
import type { AdminStatusMap } from "@/lib/admin/statuses";
import { formatDate, formatNumber } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { resolveStatus } from "@/lib/portal/orders";
import { cn } from "@/lib/utils";

/**
 * Step 1 of the builder (SPEC §35.9): the customer's orders. By default only
 * orders whose freight is not on another invoice (that is not cancelled);
 * the switch shows the others too, for extra charges such as a separate SRD
 * customs invoice. Picking an order adds its line.
 */
export function BuilderOrders({
  orders,
  statuses,
  selected,
  showInvoiced,
  onShowInvoiced,
  onToggle,
}: {
  orders: readonly BuilderOrder[];
  statuses: AdminStatusMap | undefined;
  selected: readonly string[];
  showInvoiced: boolean;
  onShowInvoiced: (value: boolean) => void;
  onToggle: (order: BuilderOrder, picked: boolean) => void;
}) {
  const t = useT();
  const switchId = useId();
  const cancelled = new Set(
    [...(statuses?.values() ?? [])].filter((s) => s.stage === "cancelled").map((s) => s.code),
  );
  const shown = listedOrders(orders, { showInvoiced, selected, cancelledStatuses: cancelled });
  const anyInvoiced = orders.some((o) => o.freightOn !== null);

  return (
    <div className="space-y-3">
      {anyInvoiced ? (
        <div className="flex items-center gap-2">
          <Switch id={switchId} checked={showInvoiced} onCheckedChange={onShowInvoiced} />
          <label htmlFor={switchId} className="text-sm">
            {t("admin.invoiceBuilder.orders.showInvoiced")}
          </label>
        </div>
      ) : null}
      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.invoiceBuilder.orders.empty")}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.invoiceBuilder.orders.noneOpen")}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {shown.map((order) => {
            const picked = selected.includes(order.id);
            const id = `ib-order-${order.id}`;
            const status = resolveStatus(order.status, statuses ?? new Map());
            const weight = order.measured_weight_lbs ?? order.declared_weight_lbs;
            return (
              <li key={order.id} className={cn("flex gap-3 p-3", picked && "bg-cream/60")}>
                <Checkbox
                  id={id}
                  checked={picked}
                  onCheckedChange={(checked) => onToggle(order, checked === true)}
                  className="mt-1"
                  aria-describedby={`${id}-info`}
                />
                <div className="min-w-0 flex-1">
                  <label htmlFor={id} className="block cursor-pointer">
                    <span className="font-semibold text-primary tabular-nums">
                      {order.reference}
                    </span>{" "}
                    <span className="break-words text-sm">
                      {[order.store_vendor, order.vendor_order_number].filter(Boolean).join(" · ")}
                    </span>
                    <span className="sr-only">
                      {" "}
                      {t("admin.invoiceBuilder.orders.pick", { reference: order.reference })}
                    </span>
                  </label>
                  <div
                    id={`${id}-info`}
                    className="mt-1 flex flex-wrap items-center gap-1.5 text-xs"
                  >
                    <OrderStatusBadge status={status} />
                    {order.order_type === "b2b" ? <B2bBadge /> : null}
                    <Badge variant={order.measured_weight_lbs ? "outline" : "warning"}>
                      <Scale className="size-3.5 shrink-0" aria-hidden />
                      {weight
                        ? t("admin.invoiceBuilder.orders.weighed", { lbs: formatNumber(weight, 2) })
                        : t("admin.invoiceBuilder.orders.noWeight")}
                      {order.measured_weight_lbs ? null : weight ? (
                        <span>· {t("admin.invoiceBuilder.orders.notWeighed")}</span>
                      ) : null}
                    </Badge>
                    {order.freightOn ? (
                      <Badge variant="info">
                        <Receipt className="size-3.5 shrink-0" aria-hidden />
                        {t("admin.invoiceBuilder.orders.billedOn", {
                          invoice:
                            order.freightOn.invoiceNumber ?? t("admin.invoiceBuilder.aDraft"),
                        })}
                      </Badge>
                    ) : null}
                    <span className="text-muted-foreground tabular-nums">
                      {formatDate(order.created_at)}
                    </span>
                  </div>
                  {order.description ? (
                    <p className="mt-1 break-words text-xs text-muted-foreground">
                      {order.description}
                    </p>
                  ) : null}
                  {order.freightOn && picked ? (
                    <p className="mt-1 text-xs text-info">
                      {t("admin.invoiceBuilder.orders.billedHint", {
                        invoice: order.freightOn.invoiceNumber ?? t("admin.invoiceBuilder.aDraft"),
                      })}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
