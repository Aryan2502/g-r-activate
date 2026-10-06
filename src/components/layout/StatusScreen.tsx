import type { ReactNode } from "react";

import { BrandLogo } from "@/components/brand/BrandLogo";
import { cn } from "@/lib/utils";

interface StatusScreenProps {
  title: string;
  description: string;
  /** Large label above the title, e.g. "404". */
  code?: string;
  actions?: ReactNode;
  /** Extra content between the description and the actions. */
  children?: ReactNode;
  className?: string;
}

/** Full-page branded message for 404s, errors and blocked states. */
export function StatusScreen({
  title,
  description,
  code,
  actions,
  children,
  className,
}: StatusScreenProps) {
  return (
    <main
      className={cn(
        "flex min-h-screen items-center justify-center bg-background px-4 py-12",
        className,
      )}
    >
      <div className="w-full max-w-md rounded-lg border bg-card p-8 text-center shadow-sm">
        <BrandLogo variant="monogram" size="lg" className="mx-auto" priority />
        {code ? (
          <p className="mt-6 font-heading text-5xl font-bold text-primary tabular-nums">{code}</p>
        ) : null}
        <h1 className={cn("text-xl text-foreground", code ? "mt-2" : "mt-6")}>{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        {children ? <div className="mt-6">{children}</div> : null}
        {actions ? <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div> : null}
      </div>
    </main>
  );
}
