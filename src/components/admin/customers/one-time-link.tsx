import { useEffect, useRef } from "react";
import { TriangleAlert } from "lucide-react";

import { Callout } from "@/components/admin/Callout";
import { Button } from "@/components/ui/button";
import type { LinkGuard } from "@/components/admin/customers/link-guard";
import { useT } from "@/lib/i18n";

/** "Link nog niet gekopieerd – toch sluiten?", inside the dialog, focused when it appears. */
export function UnsharedLinkPrompt({ guard }: { guard: LinkGuard }) {
  const t = useT();
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (guard.asking) back.current?.focus();
  }, [guard.asking]);
  if (!guard.asking) return null;
  return (
    <div role="alert">
      <Callout
        tone="warning"
        icon={TriangleAlert}
        title={t("admin.invitations.unshared.title")}
        actions={
          <>
            <Button ref={back} type="button" size="sm" onClick={guard.keepOpen}>
              {t("admin.invitations.unshared.back")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={guard.confirmClose}>
              {t("admin.invitations.unshared.close")}
            </Button>
          </>
        }
      >
        <p>{t("admin.invitations.unshared.text")}</p>
      </Callout>
    </div>
  );
}
