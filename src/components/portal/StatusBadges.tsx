import type { ComponentType, SVGProps } from "react";
import {
  Ban,
  Briefcase,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  ClipboardList,
  Clock,
  FilePen,
  FileSearch,
  MapPin,
  PackageCheck,
  Plane,
  ShieldCheck,
  TriangleAlert,
  Warehouse,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useT } from "@/lib/i18n";
import { invoiceBadgeKey, invoiceBadgeTone, type InvoiceBadgeKey } from "@/lib/portal/invoices";
import { stageTone, type OrderStatusView, type StatusStage } from "@/lib/portal/orders";
import { cn } from "@/lib/utils";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const STAGE_ICONS: Record<StatusStage, Icon> = {
  registered: ClipboardList,
  us_warehouse: Warehouse,
  in_transit: Plane,
  arrived_sr: MapPin,
  at_customs: FileSearch,
  cleared: ShieldCheck,
  ready_for_pickup: PackageCheck,
  completed: CircleCheck,
  cancelled: CircleX,
  action_required: TriangleAlert,
};

function stageIcon(stage: StatusStage | null): Icon {
  return stage ? STAGE_ICONS[stage] : Clock;
}

/** The icon of a stage (a clock when the stage is hidden from the customer). */
export function StageIcon({ stage, className }: { stage: StatusStage | null; className?: string }) {
  const Icon = stageIcon(stage);
  return <Icon className={className} aria-hidden />;
}

/** The order's status: the configured Dutch label plus an icon for its stage (never colour alone). */
export function OrderStatusBadge({
  status,
  className,
}: {
  status: OrderStatusView;
  className?: string;
}) {
  const t = useT();
  const Icon = stageIcon(status.stage);
  return (
    <Badge
      variant={stageTone(status.stage)}
      className={cn("max-w-full whitespace-normal text-left", className)}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span>{status.label ?? t("portal.statusUnknown")}</span>
    </Badge>
  );
}

/** "Zakelijk" badge for B2B orders (SPEC §35.7). */
export function B2bBadge({ className }: { className?: string }) {
  const t = useT();
  return (
    <Badge variant="outline" className={cn("border-primary/40 text-primary", className)}>
      <Briefcase className="size-3.5 shrink-0" aria-hidden />
      {t("portal.orderTypes.b2b")}
    </Badge>
  );
}

const INVOICE_ICONS: Record<InvoiceBadgeKey, Icon> = {
  draft: FilePen,
  open: Clock,
  partially_paid: CircleDashed,
  paid: CircleCheck,
  overdue: CircleAlert,
  cancelled: Ban,
};

/** Openstaand, Deels betaald, Betaald, Achterstallig, Geannuleerd (SPEC §35.10), from invoice_overview. */
export function InvoiceStatusBadge({
  invoice,
  className,
}: {
  invoice: Parameters<typeof invoiceBadgeKey>[0];
  className?: string;
}) {
  const t = useT();
  const key = invoiceBadgeKey(invoice);
  const Icon = INVOICE_ICONS[key];
  return (
    <Badge variant={invoiceBadgeTone(key)} className={className}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {t(`portal.invoiceStatus.${key}`)}
    </Badge>
  );
}
