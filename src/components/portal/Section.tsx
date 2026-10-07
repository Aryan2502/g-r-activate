import type { ComponentType, ReactNode, SVGProps } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** White card with a Montserrat heading, as on the profile page. */
export function Section({
  title,
  icon: Icon,
  actions,
  description,
  children,
  className,
  headingLevel = 2,
  id,
}: {
  title: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  actions?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
  id?: string;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section
      aria-labelledby={id ? `${id}-title` : undefined}
      className={cn("min-w-0 rounded-lg border bg-card p-5 shadow-sm sm:p-6", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Heading
            id={id ? `${id}-title` : undefined}
            className="flex scroll-mt-24 items-center gap-2 text-lg text-foreground"
          >
            {Icon ? <Icon className="size-5 shrink-0 text-primary" aria-hidden /> : null}
            {title}
          </Heading>
          {description ? (
            <div className="mt-1 text-sm leading-6 text-muted-foreground">{description}</div>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Inline load error with the Dutch message and a retry button. */
export function LoadError({
  title,
  error,
  onRetry,
  className,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
  className?: string;
}) {
  const t = useT();
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-3 text-sm", className)}>
      <p className="flex items-start gap-2 text-destructive">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {title} {errorMessage(error)}
        </span>
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCw aria-hidden />
        {t("common.retry")}
      </Button>
    </div>
  );
}

/** Label/value rows; stacks on narrow screens. */
export function DetailList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn("divide-y text-sm", className)}>{children}</dl>;
}

export function DetailItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[11rem_1fr] sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

/** Muted text for a field the customer left empty. */
export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}
