import type { ComponentType, ReactNode, SVGProps } from "react";
import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router";
import {
  Building2,
  ChevronDown,
  CircleCheck,
  ClipboardList,
  FileCheck2,
  LogIn,
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
  UserPlus,
  UserRound,
} from "lucide-react";

import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/button";
import type { PublicCompanyInfo } from "@/lib/company-info";
import { t, useT, type PlainTranslationKey } from "@/lib/i18n";
import { paths } from "@/lib/paths";
import { formatPhone, telHref } from "@/lib/phone";
import { pageMeta } from "@/lib/seo";

const publicRoute = getRouteApi("/_public");

// SPEC §7 / §33: what G&R does, the five steps, customs and logistics,
// tracking, invoices online, CTAs and contact from public_company_info().
// Every statement describes the app or the company settings; no prices,
// addresses, hours or testimonials are invented here.
export const Route = createFileRoute("/_public/")({
  head: () => ({ meta: pageMeta(t("meta.title"), t("home.seo.description")) }),
  component: HomePage,
});

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
type Item = { icon: Icon; title: PlainTranslationKey; text: PlainTranslationKey };

const steps: Item[] = [
  { icon: ShoppingCart, title: "home.howItWorks.step1Title", text: "home.howItWorks.step1Text" },
  { icon: Tag, title: "home.howItWorks.step2Title", text: "home.howItWorks.step2Text" },
  { icon: ClipboardList, title: "home.howItWorks.step3Title", text: "home.howItWorks.step3Text" },
  { icon: Truck, title: "home.howItWorks.step4Title", text: "home.howItWorks.step4Text" },
  { icon: PackageCheck, title: "home.howItWorks.step5Title", text: "home.howItWorks.step5Text" },
];

const orderTypes: Item[] = [
  { icon: UserRound, title: "home.orderTypes.personalTitle", text: "home.orderTypes.personalText" },
  { icon: Building2, title: "home.orderTypes.b2bTitle", text: "home.orderTypes.b2bText" },
];

const services: Item[] = [
  { icon: FileCheck2, title: "home.services.customsTitle", text: "home.services.customsText" },
  { icon: Plane, title: "home.services.airTitle", text: "home.services.airText" },
  { icon: PackageSearch, title: "home.services.trackingTitle", text: "home.services.trackingText" },
  { icon: ReceiptText, title: "home.services.billingTitle", text: "home.services.billingText" },
];

const faq: { q: PlainTranslationKey; a: PlainTranslationKey }[] = [
  { q: "home.faq.q1", a: "home.faq.a1" },
  { q: "home.faq.q2", a: "home.faq.a2" },
  { q: "home.faq.q3", a: "home.faq.a3" },
  { q: "home.faq.q4", a: "home.faq.a4" },
  { q: "home.faq.q5", a: "home.faq.a5" },
];

const highlights: PlainTranslationKey[] = [
  "home.hero.highlight1",
  "home.hero.highlight2",
  "home.hero.highlight3",
];

const container = "mx-auto max-w-6xl px-4 sm:px-6 lg:px-8";
const textLink =
  "font-medium text-primary underline underline-offset-4 hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm";

/** Splits a translated sentence around its {link} placeholder. */
function withLink(sentence: (marker: string) => string, link: ReactNode) {
  const marker = "\u0000";
  const [before, after = ""] = sentence(marker).split(marker);
  return (
    <>
      {before}
      {link}
      {after}
    </>
  );
}

function HomePage() {
  const info = publicRoute.useLoaderData({ select: (data) => data.info });
  const signupEnabled = info?.public_signup_enabled ?? false;

  return (
    <>
      <Hero signupEnabled={signupEnabled} />
      <HowItWorks info={info} />
      <OrderTypes />
      <Services />
      <Faq />
      <CallToAction info={info} signupEnabled={signupEnabled} />
    </>
  );
}

function PrimaryActions({ signupEnabled }: { signupEnabled: boolean }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
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
    <section aria-labelledby="home-title" className="border-b bg-paper">
      <div
        className={`${container} grid items-center gap-8 py-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:py-14 lg:gap-14 lg:py-20`}
      >
        <div className="order-2 md:order-1">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-grey">
            {t("home.hero.eyebrow")}
          </p>
          <h1
            id="home-title"
            className="mt-3 text-3xl leading-tight text-primary sm:text-4xl lg:text-[2.75rem]"
          >
            {t("home.hero.title")}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-foreground/85 lg:text-lg lg:leading-8">
            {t("home.hero.intro")}
          </p>
          <p className="mt-3 max-w-xl text-base leading-7 text-foreground/85">
            {t("home.hero.portalIntro")}
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
      <div className="border-t bg-card">
        <ul
          aria-label={t("home.hero.highlightsLabel")}
          className={`${container} grid gap-3 py-5 text-sm font-medium text-foreground sm:grid-cols-3 sm:gap-6`}
        >
          {highlights.map((key) => (
            <li key={key} className="flex items-start gap-2.5">
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              {t(key)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function SectionHeading({ id, title, intro }: { id: string; title: string; intro: string }) {
  return (
    <div className="max-w-2xl">
      <h2 id={id} className="text-2xl text-foreground sm:text-3xl">
        {title}
      </h2>
      <div className="mt-3 h-1 w-12 rounded-full bg-primary" aria-hidden />
      <p className="mt-4 text-base leading-7 text-muted-foreground">{intro}</p>
    </div>
  );
}

/** Step 2: how the shipping label must read (SPEC §35.8 recipient/line-2 templates). */
function AddressExample() {
  const t = useT();
  const code = (
    <span className="font-heading font-bold tracking-wide text-primary tabular-nums">
      {t("home.howItWorks.addressExample.code")}
    </span>
  );
  const rows: [string, ReactNode][] = [
    [
      t("home.howItWorks.addressExample.nameLabel"),
      <>
        {t("home.howItWorks.addressExample.nameValue")} {code}
      </>,
    ],
    [
      t("home.howItWorks.addressExample.line1Label"),
      t("home.howItWorks.addressExample.line1Value"),
    ],
    [t("home.howItWorks.addressExample.line2Label"), code],
  ];
  return (
    <figure className="mt-3 rounded-md border bg-cream px-4 py-3 text-sm">
      <figcaption className="font-semibold text-foreground">
        {t("home.howItWorks.addressExample.title")}
      </figcaption>
      <dl className="mt-2 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {t("home.howItWorks.addressExample.note")}
      </p>
    </figure>
  );
}

function PickupDetails({ info }: { info: PublicCompanyInfo | null }) {
  const t = useT();
  if (!info?.pickup_address && !info?.pickup_hours && !info?.pickup_instructions) return null;
  return (
    <div className="mt-3 rounded-md border bg-cream px-4 py-3 text-sm text-foreground">
      {info.pickup_address ? (
        <p className="flex items-start gap-2 font-medium">
          <MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          {t("home.howItWorks.pickupAddress", { address: info.pickup_address })}
        </p>
      ) : null}
      {info.pickup_hours ? (
        <p className="mt-1 whitespace-pre-line pl-6">
          {t("home.howItWorks.pickupHours", { hours: info.pickup_hours })}
        </p>
      ) : null}
      {info.pickup_instructions ? (
        <p className="mt-1 pl-6 text-muted-foreground">{info.pickup_instructions}</p>
      ) : null}
    </div>
  );
}

function HowItWorks({ info }: { info: PublicCompanyInfo | null }) {
  const t = useT();
  const lastIndex = steps.length - 1;

  return (
    <section
      id="hoe-het-werkt"
      aria-labelledby="hoe-het-werkt-title"
      className="scroll-mt-16 border-b bg-card py-14 lg:py-20"
    >
      <div
        className={`${container} grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] lg:gap-16`}
      >
        <div className="lg:sticky lg:top-24 lg:self-start">
          <SectionHeading
            id="hoe-het-werkt-title"
            title={t("home.howItWorks.title")}
            intro={t("home.howItWorks.intro")}
          />
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
              <div className="min-w-0 flex-1 pt-1.5">
                <h3 className="flex items-start gap-2 text-base text-foreground sm:text-lg">
                  <step.icon className="mt-[0.3em] size-4 shrink-0 text-brand-grey" aria-hidden />
                  {t(step.title)}
                </h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground sm:text-[15px] sm:leading-7">
                  {t(step.text)}
                </p>
                {index === 1 ? <AddressExample /> : null}
                {index === 2 ? (
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {withLink(
                      (link) => t("home.howItWorks.step3Prohibited", { link }),
                      <Link to="/verboden-goederen" className={textLink}>
                        {t("home.howItWorks.step3ProhibitedLink")}
                      </Link>,
                    )}
                  </p>
                ) : null}
                {index === lastIndex ? <PickupDetails info={info} /> : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function CardGrid({ items, columns }: { items: Item[]; columns: string }) {
  const t = useT();
  return (
    <ul className={`mt-10 grid gap-4 ${columns}`}>
      {items.map((item) => (
        <li key={item.title} className="rounded-lg border bg-card p-6">
          <span className="flex size-10 items-center justify-center rounded-md bg-cream text-primary">
            <item.icon className="size-5" aria-hidden />
          </span>
          <h3 className="mt-4 text-base text-foreground">{t(item.title)}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{t(item.text)}</p>
        </li>
      ))}
    </ul>
  );
}

function OrderTypes() {
  const t = useT();
  return (
    <section aria-labelledby="soort-order-title" className="border-b py-14 lg:py-20">
      <div className={container}>
        <SectionHeading
          id="soort-order-title"
          title={t("home.orderTypes.title")}
          intro={t("home.orderTypes.intro")}
        />
        <CardGrid items={orderTypes} columns="md:grid-cols-2" />
      </div>
    </section>
  );
}

function Services() {
  const t = useT();
  return (
    <section aria-labelledby="diensten-title" className="border-b bg-card py-14 lg:py-20">
      <div className={container}>
        <SectionHeading
          id="diensten-title"
          title={t("home.services.title")}
          intro={t("home.services.intro")}
        />
        <CardGrid items={services} columns="sm:grid-cols-2 lg:grid-cols-4" />
      </div>
    </section>
  );
}

function Faq() {
  const t = useT();
  const questions = [
    ...faq.map(({ q, a }) => ({ q: t(q), a: <>{t(a)}</> })),
    {
      q: t("home.faq.q6"),
      a: withLink(
        (link) => t("home.faq.a6", { link }),
        <Link to="/verboden-goederen" className={textLink}>
          {t("home.faq.a6Link")}
        </Link>,
      ),
    },
  ];
  return (
    <section id="vragen" aria-labelledby="vragen-title" className="scroll-mt-16 py-14 lg:py-20">
      <div
        className={`${container} grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] lg:gap-16`}
      >
        <SectionHeading id="vragen-title" title={t("home.faq.title")} intro={t("home.faq.intro")} />
        <div className="divide-y rounded-lg border bg-card">
          {questions.map(({ q, a }) => (
            <details key={q} className="group px-5 py-1 sm:px-6">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-3 text-left font-heading text-[15px] font-semibold text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <span>{q}</span>
                <ChevronDown
                  className="size-4 shrink-0 text-primary group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="pb-4 text-sm leading-6 text-muted-foreground">{a}</p>
            </details>
          ))}
        </div>
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
    <section aria-labelledby="beginnen-title" className="pb-16 lg:pb-24">
      <div className={container}>
        <div className="flex flex-col gap-8 rounded-lg border bg-cream p-6 sm:p-10 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <h2 id="beginnen-title" className="text-2xl text-primary">
              {t("home.cta.title")}
            </h2>
            <p className="mt-3 text-base leading-7 text-foreground/85">
              {signupEnabled ? t("home.cta.textSignup") : t("home.cta.textNoSignup")}
            </p>
            {info?.email || phoneLink ? (
              <div className="mt-5 text-sm">
                <p className="text-muted-foreground">{t("home.cta.contact")}</p>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                  {info?.email ? (
                    <a href={`mailto:${info.email}`} className={`${linkClass} break-all`}>
                      <Mail className="size-4 shrink-0" aria-hidden />
                      {info.email}
                    </a>
                  ) : null}
                  {phoneLink && info?.phone ? (
                    <a href={phoneLink} className={`${linkClass} tabular-nums`}>
                      <Phone className="size-4 shrink-0" aria-hidden />
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
