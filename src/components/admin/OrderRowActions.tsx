import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRightLeft, ExternalLink, MoreHorizontal, PackageCheck, Scale } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { weightAction } from "@/lib/admin/statuses";
import { useT } from "@/lib/i18n";
import type { StatusStage } from "@/lib/portal/orders";

/**
 * The actions menu of one order row (SPEC §21): open, change status, receive
 * (or set/correct the measured weight) and hand over. The caller opens the dialogs; `extra`
 * adds page-specific items (e.g. "Uit zending halen") at the end.
 */
export function OrderRowActions({
  order,
  onChangeStatus,
  onReceive,
  onPickup,
  extra,
}: {
  order: {
    id: string;
    reference: string;
    stage: StatusStage | null;
    received_at: string | null;
    measured_weight_lbs: number | null;
  };
  onChangeStatus: () => void;
  onReceive: () => void;
  onPickup: () => void;
  /** DropdownMenuItems after a separator. */
  extra?: ReactNode;
}) {
  const t = useT();
  const weight = weightAction(order);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-9 shrink-0 text-primary">
          <MoreHorizontal aria-hidden />
          <span className="sr-only">{t("admin.actions.more", { reference: order.reference })}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuItem asChild>
          <Link to="/admin/orders/$id" params={{ id: order.id }}>
            <ExternalLink aria-hidden />
            {t("admin.actions.open")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onChangeStatus}>
          <ArrowRightLeft aria-hidden />
          {t("admin.actions.changeStatus")}
        </DropdownMenuItem>
        {weight ? (
          <DropdownMenuItem onSelect={onReceive}>
            <Scale aria-hidden />
            {t(`admin.actions.${weight}`)}
          </DropdownMenuItem>
        ) : null}
        {order.stage === "ready_for_pickup" ? (
          <DropdownMenuItem onSelect={onPickup}>
            <PackageCheck aria-hidden />
            {t("admin.actions.pickup")}
          </DropdownMenuItem>
        ) : null}
        {extra ? (
          <>
            <DropdownMenuSeparator />
            {extra}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
