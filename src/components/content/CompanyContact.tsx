import { Mail, MessageCircle, Phone } from "lucide-react";

import type { PublicCompanyInfo } from "@/lib/company-info";
import { useT } from "@/lib/i18n";
import { formatPhone, phoneDigits, telHref } from "@/lib/phone";
import { cn } from "@/lib/utils";

/** G&R's email, phone and WhatsApp from company_settings; nothing when unknown. */
export function CompanyContact({
  info,
  className,
}: {
  info: PublicCompanyInfo | null | undefined;
  className?: string;
}) {
  const t = useT();
  if (!info || (!info.email && !info.phone)) return null;
  const tel = telHref(info.phone);
  const whatsapp = phoneDigits(info.phone);
  const linkClass =
    "inline-flex items-center gap-2 text-foreground underline-offset-4 hover:text-primary hover:underline";

  return (
    <div className={cn("rounded-md border bg-cream px-4 py-3 text-left text-sm", className)}>
      <p className="font-semibold text-primary">{t("common.contactTitle")}</p>
      <ul className="mt-2 space-y-1.5">
        {info.email ? (
          <li>
            <a href={`mailto:${info.email}`} className={linkClass}>
              <Mail className="size-4 text-primary" aria-hidden />
              {info.email}
            </a>
          </li>
        ) : null}
        {info.phone && tel ? (
          <li>
            <a href={tel} className={cn(linkClass, "tabular-nums")}>
              <Phone className="size-4 text-primary" aria-hidden />
              {formatPhone(info.phone)}
            </a>
          </li>
        ) : null}
        {whatsapp ? (
          <li>
            <a
              href={`https://wa.me/${whatsapp}`}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              <MessageCircle className="size-4 text-primary" aria-hidden />
              {t("common.whatsapp")}
            </a>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
