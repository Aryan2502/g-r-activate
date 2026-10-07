import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Boxes, PackagePlus } from "lucide-react";

import { LoadError, Section } from "@/components/portal/Section";
import { OrderStatusBadge } from "@/components/portal/StatusBadges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/lib/i18n";
import {
  newOrderHref,
  orderGroupQueryOptions,
  orderGroupRoot,
  resolveStatus,
  type OrderDetail,
  type StatusMap,
} from "@/lib/portal/orders";

/**
 * "Extra pakket toevoegen" (SPEC §35.0): a purchase that arrives in several
 * boxes is one root order plus sibling orders with parent_order_id = root.
 * The registration form takes the root as ?parent=<id> (newOrderSearchSchema).
 */
export function OrderSiblings({
  userId,
  customerId,
  order,
  statuses,
}: {
  userId: string;
  customerId: string;
  order: Pick<OrderDetail, "id" | "parent_order_id">;
  statuses: StatusMap;
}) {
  const t = useT();
  const navigate = useNavigate();
  const rootId = orderGroupRoot(order);
  const group = useQuery(orderGroupQueryOptions(userId, customerId, rootId));
  const root = group.data?.find((o) => o.id === rootId);
  const rootStage = root ? resolveStatus(root.status, statuses).stage : null;
  // A cancelled purchase gets no new packages; otherwise the database decides.
  const canAdd = group.isSuccess && rootStage !== "cancelled";
  const addHref = newOrderHref({ parent: rootId });

  return (
    <Section
      title={t("portal.order.siblings.title")}
      icon={Boxes}
      id="order-siblings"
      description={t("portal.order.siblings.intro")}
    >
      {group.isError ? (
        <LoadError
          title={t("portal.order.siblings.loadFailed")}
          error={group.error}
          onRetry={() => void group.refetch()}
        />
      ) : group.isPending ? (
        <Skeleton className="h-12 w-full" />
      ) : (
        <div className="space-y-4">
          {group.data.length > 1 ? (
            <ul className="divide-y rounded-md border">
              {group.data.map((o) => {
                const current = o.id === order.id;
                return (
                  <li
                    key={o.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      {current ? (
                        <span className="font-heading font-bold text-foreground tabular-nums">
                          {o.reference}
                        </span>
                      ) : (
                        <Link
                          to="/portal/orders/$id"
                          params={{ id: o.id }}
                          className="rounded-sm font-heading font-bold text-primary tabular-nums underline-offset-4 hover:underline"
                        >
                          {o.reference}
                        </Link>
                      )}
                      <span className="ml-2 inline-flex flex-wrap gap-1.5 align-middle">
                        <Badge variant="outline">
                          {o.id === rootId
                            ? t("portal.order.siblings.main")
                            : t("portal.order.siblings.extra")}
                        </Badge>
                        {current ? (
                          <Badge variant="secondary">{t("portal.order.siblings.current")}</Badge>
                        ) : null}
                      </span>
                    </div>
                    <OrderStatusBadge status={resolveStatus(o.status, statuses)} />
                  </li>
                );
              })}
            </ul>
          ) : null}
          {canAdd ? (
            <Button asChild variant="outline">
              <a
                href={addHref}
                onClick={(e) => {
                  // Plain clicks stay in the app; modifier clicks open a new tab.
                  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  void navigate({ href: addHref });
                }}
              >
                <PackagePlus aria-hidden />
                {t("portal.order.siblings.add")}
              </a>
            </Button>
          ) : null}
        </div>
      )}
    </Section>
  );
}
