import { Loader2 } from "lucide-react";

import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Neutral "working on it" state while a session, role or link is being checked. */
export function AuthPending({ label, className }: { label?: string; className?: string }) {
  const t = useT();
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground",
        className,
      )}
    >
      <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
      {label ?? t("auth.checking")}
    </div>
  );
}
