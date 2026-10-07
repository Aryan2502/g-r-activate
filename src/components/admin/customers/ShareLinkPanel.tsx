import { useId } from "react";
import { Copy, Info, MailX, MessageCircle } from "lucide-react";

import { Callout } from "@/components/admin/Callout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { whatsappHref } from "@/lib/admin/invitations";
import { copyToClipboard } from "@/lib/clipboard";
import { phoneDigits } from "@/lib/phone";
import { useT } from "@/lib/i18n";

/**
 * A link staff hand to the customer themselves (SPEC §35.6, §35.12): the
 * invitation link or a password-reset link, ALWAYS with "Kopieer …" and
 * "Deel via WhatsApp" (wa.me with the customer's number and a Dutch
 * message). Until e-mail exists (P8) this is the only way the link reaches
 * the customer, and the panel says so; it never claims an e-mail went out.
 */
export function ShareLinkPanel({
  link,
  label,
  copyLabel,
  shareText,
  phone,
  emailed,
  linkSource,
  notes,
  onShared,
}: {
  link: string;
  label: string;
  copyLabel: string;
  /** The WhatsApp message, ending with the link. */
  shareText: string;
  phone: string | null;
  /** Whether the server sent it by e-mail (P8); null when e-mail does not apply. */
  emailed: boolean | null;
  linkSource: "app_url" | "request";
  /** Extra lines (validity, "only now"). */
  notes?: readonly string[];
  /** The link was copied or opened in WhatsApp (see useLinkGuard). */
  onShared?: () => void;
}) {
  const t = useT();
  const id = useId();
  const hasPhone = phoneDigits(phone) !== null;
  const base = (() => {
    try {
      return new URL(link).origin;
    } catch {
      return link;
    }
  })();

  return (
    <div className="min-w-0 space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-link`}>{label}</Label>
        <Input
          id={`${id}-link`}
          value={link}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
          onCopy={() => onShared?.()}
          className="h-11 bg-cream/40 font-mono text-xs sm:h-10"
          spellCheck={false}
        />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          onClick={() =>
            void copyToClipboard(link).then((copied) => {
              if (copied) onShared?.();
            })
          }
        >
          <Copy aria-hidden />
          {copyLabel}
        </Button>
        <Button type="button" variant="outline" asChild>
          <a
            href={whatsappHref(phone, shareText)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onShared?.()}
          >
            <MessageCircle aria-hidden />
            {t("admin.invitations.whatsapp")}
          </a>
        </Button>
      </div>
      {!hasPhone ? (
        <p className="text-xs text-muted-foreground">{t("admin.invitations.whatsappNoPhone")}</p>
      ) : null}
      {notes && notes.length > 0 ? (
        <ul className="space-y-1 text-sm text-foreground">
          {notes.map((note) => (
            <li key={note} className="flex items-start gap-2">
              <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {emailed === false ? (
        <Callout tone="warning" icon={MailX} title={t("admin.invitations.emailOff")} />
      ) : emailed === true ? (
        <p className="text-sm text-muted-foreground">{t("admin.invitations.emailSent")}</p>
      ) : null}
      {linkSource === "request" ? (
        <p className="text-xs text-muted-foreground">
          {t("admin.invitations.requestBase", { base })}
        </p>
      ) : null}
    </div>
  );
}
