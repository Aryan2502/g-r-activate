import type { ComponentType, SVGProps } from "react";
import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router";
import {
  ClipboardList,
  FileCheck2,
  Mail,
  MapPin,
  PackageCheck,
  PackageSearch,
  Phone,
  Plane,
  ReceiptText,
  ShoppingCart,
  Tag,
  Truck,
  LogIn,
  UserPlus,
} from "lucide-react";

import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/button";
import type { PublicCompanyInfo } from "@/lib/company-info";
import { useT, type PlainTranslationKey } from "@/lib/i18n";
import { paths } from "@/lib/paths";
import { formatPhone, telHref } from "@/lib/phone";

const publicRoute = getRouteApi("/_public");

export const Route = createFileRoute("/_public/")({
  component: HomePage,
});

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const steps: { icon: Icon; title: PlainTranslationKey; text: PlainTranslationKey }[] = [
  { icon: ShoppingCart, title: "home.howItWorks.step1Title", text: "home.howItWorks.step1Text" },
  { icon: Tag, title: "home.howItWorks.step2Title", text: "home.howItWorks.step2Text" },
  { icon: ClipboardList, title: "home.howItWorks.step3Title", text: "home.howItWorks.step3Text" },
  { icon: Truck, title: "home.howItWorks.step4Title", text: "home.howItWorks.step4Text" },
  { icon: PackageCheck, title: "home.howItWorks.step5Title", text: "home.howItWorks.step5Text" },
];

const services: { icon: Icon; title: PlainTranslationKey; text: PlainTranslationKey }[] = [
  { icon: FileCheck2, title: "home.services.customsTitle", text: "home.services.customsText" },
  { icon: Plane, title: "home.services.airTitle", text: "home.services.airText" },
  { icon: PackageSearch, title: "home.services.trackingTitle", text: "home.services.trackingText" },
  { icon: ReceiptText, title: "home.services.billingTitle", text: "home.services.billingText" },
];

const container = "mx-auto max-w-6xl px-4 sm:px-6 lg:px-8";

function HomePage() {
  const info = publicRoute.useLoaderData();
  const signupEnabled = info?.public_signup_enabled ?? false;

  return (
    <>
      <Hero signupEnabled={signupEnabled} />
      <HowItWorks info={info} />
      <Services />
      <CallToAction info={info} signupEnabled={signupEnabled} />
    </>
  );
}

function PrimaryActions({ signupEnabled }: { signupEnabled: boolean }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Button asChild size="lg">
        <Link to={paths.login}>
          <LogIn aria-hidden />
          {t("home.hero.ctaPortal")}
        </Link>
      </Button>
      {signupEnabled ? (
        <Button asChild size="lg" variant="outline">
          <Link to={paths.signup}>
            <UserPlus aria-hidden />
            {t("home.hero.ctaSignup")}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

function Hero({ signupEnabled }: { signupEnabled: boolean }) {
  const t = useT();
  return (
    <section className="border-b bg-paper">
      <div
        className={`${container} grid items-center gap-8 py-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:py-14 lg:gap-14 lg:py-20`}
      >
        <div className="order-2 md:order-1">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-grey">
            {t("home.hero.eyebrow")}
          </p>
          <h1 className="mt-3 text-3xl leading-tight text-primary sm:text-4xl lg:text-[2.75rem]">
            {t("home.hero.title")}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-foreground/85 lg:text-lg lg:leading-8">
            {t("home.hero.intro")}
          </p>
          <div className="mt-8">
            <PrimaryActions signupEnabled={signupEnabled} />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{t("home.hero.existingCustomer")}</p>
        </div>
        <div className="order-1 md:order-2">
          <BrandLogo
            variant="banner"
            priority
            className="mx-auto max-w-[280px] sm:max-w-sm md:max-w-none"
          />
        </div>
      </div>
    </section>
  );
}

function SectionHeading({ title, intro }: { title: string; intro: string }) {
  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl text-foreground sm:text-3xl">{title}</h2>
      <div className="mt-3 h-1 w-12 rounded-full bg-primary" aria-hidden />
      <p className="mt-4 text-base leading-7 text-muted-foreground">{intro}</p>
    </div>
  );
}

function HowItWorks({ info }: { info: PublicCompanyInfo | null }) {
  const t = useT();
  const lastIndex = steps.length - 1;

  return (
    <section id="hoe-het-werkt" className="scroll-mt-16 border-b bg-card py-14 lg:py-20">
      <div
        className={`${container} grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] lg:gap-16`}
      >
        <div className="lg:sticky lg:top-24 lg:self-start">
          <SectionHeading title={t("home.howItWorks.title")} intro={t("home.howItWorks.intro")} />
        </div>
        <ol className="relative">
          {steps.map((step, index) => (
            <li key={step.title} className="relative flex gap-4 pb-9 last:pb-0 sm:gap-5">
              {index < lastIndex ? (
                <span aria-hidden className="absolute top-11 bottom-2 left-[19px] w-px bg-border" />
              ) : null}
              <span
                aria-hidden
                className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-heading text-sm font-bold text-primary-foreground tabular-nums"
              >
                {index + 1}
              </span>
              <div className="min-w-0 pt-1.5">
                <h3 className="flex items-start gap-2 text-base text-foreground sm:text-lg">
                  <step.icon className="mt-[0.3em] size-4 shrink-0 text-brand-grey" aria-hidden />
                  {t(step.title)}
                </h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground sm:text-[15px] sm:leading-7">
                  {t(step.text)}
                </p>
                {index === lastIndex && (info?.pickup_address || info?.pickup_instructions) ? (
                  <div className="mt-3 rounded-md border bg-cream px-4 py-3 text-sm text-foreground">
                    {info.pickup_address ? (
                      <p className="flex items-start gap-2 font-medium">
                        <MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                        {t("home.howItWorks.pickupAddress", { address: info.pickup_address })}
                      </p>
                    ) : null}
                    {info.pickup_instructions ? (
                      <p className="mt-1 pl-6 text-muted-foreground">{info.pickup_instructions}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Services() {
  const t = useT();
  return (
    <section className="py-14 lg:py-20">
      <div className={container}>
        <SectionHeading title={t("home.services.title")} intro={t("home.services.intro")} />
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((service) => (
            <li key={service.title} className="rounded-lg border bg-card p-6">
              <span className="flex size-10 items-center justify-center rounded-md bg-cream text-primary">
                <service.icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-4 text-base text-foreground">{t(service.title)}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{t(service.text)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function CallToAction({
  info,
  signupEnabled,
}: {
  info: PublicCompanyInfo | null;
  signupEnabled: boolean;
}) {
  const t = useT();
  const phoneLink = telHref(info?.phone);
  const linkClass =
    "inline-flex items-center gap-2 font-medium text-primary underline-offset-4 hover:text-primary-hover hover:underline";

  return (
    <section className="pb-16 lg:pb-24">
      <div className={container}>
        <div className="flex flex-col gap-8 rounded-lg border bg-cream p-6 sm:p-10 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <h2 className="text-2xl text-primary">{t("home.cta.title")}</h2>
            <p className="mt-3 text-base leading-7 text-foreground/85">
              {signupEnabled ? t("home.cta.textSignup") : t("home.cta.textNoSignup")}
            </p>
            {info?.email || phoneLink ? (
              <div className="mt-5 text-sm">
                <p className="text-muted-foreground">{t("home.cta.contact")}</p>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                  {info?.email ? (
                    <a href={`mailto:${info.email}`} className={linkClass}>
                      <Mail className="size-4" aria-hidden />
                      {info.email}
                    </a>
                  ) : null}
                  {phoneLink && info?.phone ? (
                    <a href={phoneLink} className={`${linkClass} tabular-nums`}>
                      <Phone className="size-4" aria-hidden />
                      {formatPhone(info.phone)}
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          <div className="shrink-0">
            <PrimaryActions signupEnabled={signupEnabled} />
          </div>
        </div>
      </div>
    </section>
  );
}
