import { Plane, Ship } from "lucide-react";

import { StageIcon } from "@/components/portal/StatusBadges";
import { Badge } from "@/components/ui/badge";
import type { StageCount } from "@/lib/admin/shipments";
import { formatNumber } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { stageTone, type ServiceType } from "@/lib/portal/orders";
import { cn } from "@/lib/utils";

/** "Luchtvracht" / "Zeevracht" with a plane or ship icon. */
export function ServiceTypeLabel({ type, className }: { type: ServiceType; className?: string }) {
  const t = useT();
  const Icon = type === "sea" ? Ship : Plane;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Icon className="size-4 shrink-0 text-primary" aria-hidden />
      {t(`portal.serviceTypes.${type}`)}
    </span>
  );
}

/**
 * Where the orders of a shipment are: one badge per stage with its count,
 * in journey order (icon + text, never colour alone).
 */
export function StageSummary({
  stages,
  className,
}: {
  stages: readonly StageCount[];
  className?: string;
}) {
  const t = useT();
  if (stages.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {stages.map(({ stage, count }) => (
        <li key={stage ?? "unknown"}>
          <Badge variant={stageTone(stage)} className="whitespace-nowrap">
            <StageIcon stage={stage} className="size-3.5 shrink-0" />
            <span className="tabular-nums">{formatNumber(count, 0)}</span>
            <span aria-hidden>×</span>
            <span>{stage ? t(`portal.stages.${stage}`) : t("portal.statusUnknown")}</span>
          </Badge>
        </li>
      ))}
    </ul>
  );
}
