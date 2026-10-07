import type { ReactNode } from "react";

import { formatNumber } from "@/lib/format";
import { useT } from "@/lib/i18n";

/**
 * The actions for a selection of orders (bulk status change, shipment). It
 * sits after the list and sticks to the bottom of the screen while the list
 * scrolls, so the actions stay in reach of the rows staff just ticked (P4
 * review: at the top of a long list it scrolled out of sight).
 */
export function SelectionBar({
  label,
  count,
  children,
}: {
  /** The region's accessible name. */
  label: string;
  count: number;
  /** The buttons. */
  children: ReactNode;
}) {
  const t = useT();
  if (count === 0) return null;
  return (
    <div className="pointer-events-none sticky bottom-3 z-20 mt-4 flex justify-center">
      <div
        role="region"
        aria-label={label}
        className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-lg border border-primary/30 bg-cream px-3 py-2 shadow-lg"
      >
        <span
          className="text-sm font-semibold text-primary tabular-nums"
          role="status"
          aria-live="polite"
        >
          {t(count === 1 ? "admin.orders.selectedOne" : "admin.orders.selectedMany", {
            count: formatNumber(count, 0),
          })}
        </span>
        {children}
      </div>
    </div>
  );
}
