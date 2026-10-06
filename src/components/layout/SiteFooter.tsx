import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Clock, Mail, MapPin, Phone } from "lucide-react";

import { BrandLogo } from "@/components/brand/BrandLogo";
import type { PublicCompanyInfo } from "@/lib/company-info";
import { todayInSuriname } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { paths } from "@/lib/paths";
import { formatPhone, telHref } from "@/lib/phone";

function ContactRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 text-primary [&_svg]:size-4" aria-hidden>
        {icon}
      </span>
      <span>
        <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="block text-foreground">{children}</span>
      </span>
    </li>
  );
}

export function SiteFooter({ info }: { info: PublicCompanyInfo | null }) {
  const t = useT();
  const year = todayInSuriname().slice(0, 4);
  const phoneLink = telHref(info?.phone);
  const linkClass = "text-foreground hover:text-primary hover:underline underline-offset-4";

  return (
    <footer className="border-t bg-card">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.2fr_1.4fr_1fr] lg:px-8">
        <div>
          <BrandLogo variant="lockup" size="sm" />
        </div>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-primary">
            {t("footer.contactTitle")}
          </h2>
          {info ? (
            <ul className="mt-4 space-y-3 text-sm">
              {info.email ? (
                <ContactRow icon={<Mail />} label={t("footer.email")}>
                  <a href={`mailto:${info.email}`} className={linkClass}>
                    {info.email}
                  </a>
                </ContactRow>
              ) : null}
              {info.phone ? (
                <ContactRow icon={<Phone />} label={t("footer.phone")}>
                  {phoneLink ? (
                    <a href={phoneLink} className={`${linkClass} tabular-nums`}>
                      {formatPhone(info.phone)}
                    </a>
                  ) : (
                    <span className="tabular-nums">{info.phone}</span>
                  )}
                </ContactRow>
              ) : null}
              {info.address ? (
                <ContactRow icon={<MapPin />} label={t("footer.address")}>
                  {info.address}
                </ContactRow>
              ) : null}
              {info.pickup_address && info.pickup_address !== info.address ? (
                <ContactRow icon={<MapPin />} label={t("footer.pickupAddress")}>
                  {info.pickup_address}
                </ContactRow>
              ) : null}
              {info.pickup_hours ? (
                <ContactRow icon={<Clock />} label={t("footer.pickupHours")}>
                  <span className="whitespace-pre-line">{info.pickup_hours}</span>
                </ContactRow>
              ) : null}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">{t("footer.contactUnavailable")}</p>
          )}
        </div>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-primary">
            {t("footer.infoTitle")}
          </h2>
          <ul className="mt-4 space-y-2 text-sm">
            <li>
              <Link to="/" hash="hoe-het-werkt" className={linkClass}>
                {t("nav.howItWorks")}
              </Link>
            </li>
            <li>
              <Link to="/voorwaarden" className={linkClass}>
                {t("legal.termsTitle")}
              </Link>
            </li>
            <li>
              <Link to="/verboden-goederen" className={linkClass}>
                {t("legal.prohibitedTitle")}
              </Link>
            </li>
            <li>
              <Link to={paths.login} className={linkClass}>
                {t("nav.login")}
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-muted-foreground sm:px-6 lg:px-8">
          {t("footer.copyright", {
            year,
            company: info?.company_name ?? t("brand.companyName"),
          })}
        </p>
      </div>
    </footer>
  );
}
