import { Loader2 } from "lucide-react";

import { BrandLogo } from "@/components/brand/BrandLogo";
import { useT } from "@/lib/i18n";

/** Full-page loading state for the signed-in areas (session, role, customer record). */
export function PagePending({ label }: { label?: string }) {
  const t = useT();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background px-4">
      <BrandLogo variant="monogram" size="lg" priority />
      <p
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
        {label ?? t("common.loading")}
      </p>
    </main>
  );
}
