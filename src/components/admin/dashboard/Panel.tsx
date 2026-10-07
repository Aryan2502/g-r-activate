import type { ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** A dashboard card with an icon heading (SPEC §12). */
export function DashboardPanel({
  title,
  icon,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  icon: ReactNode;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-lg border bg-card p-6 shadow-sm", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg text-foreground">
            <span className="text-primary [&_svg]:size-5" aria-hidden>
              {icon}
            </span>
            {title}
          </h2>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function PanelLoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="flex flex-col items-start gap-3 text-sm">
      <p className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="size-4" aria-hidden />
        {t("admin.home.loadFailed")} {errorMessage(error)}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCw aria-hidden />
        {t("common.retry")}
      </Button>
    </div>
  );
}
