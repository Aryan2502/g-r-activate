import { CheckCircle2, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { whatsappHref } from "@/lib/admin/invitations";
import type { StatusFollowUp } from "@/lib/admin/status-share";
import { useT } from "@/lib/i18n";
import { phoneDigits } from "@/lib/phone";

/**
 * After a status change: the customers whose "statusupdate" e-mail did not
 * go out (e-mail not configured, failed, no address), each with a WhatsApp
 * button that opens the message ready to send (SPEC §35.12: WhatsApp is the
 * main channel until e-mail is configured). Shown inside the status dialog
 * in place of the form; "Klaar" closes it.
 */
export function StatusFollowUpView({
  followUps,
  onClose,
}: {
  followUps: readonly StatusFollowUp[];
  onClose: () => void;
}) {
  const t = useT();
  const allSkipped = followUps.every((f) => f.reason === "skipped");
  return (
    <div className="min-w-0 space-y-5">
      <DialogHeader>
        <DialogTitle className="font-heading text-primary">
          {t("admin.status.followUp.title")}
        </DialogTitle>
        <DialogDescription>
          {allSkipped ? t("admin.status.followUp.introSkipped") : t("admin.status.followUp.intro")}
        </DialogDescription>
      </DialogHeader>
      <ul className="divide-y rounded-md border text-sm">
        {followUps.map((f) => (
          <li
            key={f.customerId}
            className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="break-words font-semibold text-foreground">
                {f.customerName}{" "}
                {f.customerCode ? (
                  <span className="text-primary tabular-nums">{f.customerCode}</span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {t("admin.status.followUp.orders", { references: f.references.join(", ") })} ·{" "}
                {t(`admin.status.followUp.reason.${f.reason}`)}
              </p>
              {phoneDigits(f.phone) === null ? (
                <p className="text-xs text-muted-foreground">
                  {t("admin.status.followUp.noPhone")}
                </p>
              ) : null}
            </div>
            <Button asChild size="sm" variant="outline" className="shrink-0">
              <a
                href={whatsappHref(f.phone, f.text)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("admin.status.followUp.whatsappLabel", { name: f.customerName })}
              >
                <MessageCircle aria-hidden />
                {t("admin.status.followUp.whatsapp")}
              </a>
            </Button>
          </li>
        ))}
      </ul>
      <DialogFooter>
        <Button type="button" onClick={onClose}>
          <CheckCircle2 aria-hidden />
          {t("admin.status.followUp.close")}
        </Button>
      </DialogFooter>
    </div>
  );
}
