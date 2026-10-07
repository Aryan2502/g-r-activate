import { Link } from "@tanstack/react-router";
import { Building2, ChevronRight, ShoppingBag, type LucideIcon } from "lucide-react";

import { useT, type PlainTranslationKey } from "@/lib/i18n";
import type { OrderType } from "@/lib/portal/orders";

const OPTIONS = [
  {
    type: "personal",
    icon: ShoppingBag,
    title: "portal.newOrder.typeStep.personalTitle",
    text: "portal.newOrder.typeStep.personalText",
  },
  {
    type: "b2b",
    icon: Building2,
    title: "portal.newOrder.typeStep.b2bTitle",
    text: "portal.newOrder.typeStep.b2bText",
  },
] as const satisfies readonly {
  type: OrderType;
  icon: LucideIcon;
  title: PlainTranslationKey;
  text: PlainTranslationKey;
}[];

/**
 * Step 1 of "Order aanmelden" (SPEC §9): personal or business order. The
 * choice goes into the URL (?type=…), so the back button returns here and
 * the form keeps what was already typed.
 */
export function OrderTypeChooser({ headingId }: { headingId: string }) {
  const t = useT();
  return (
    <section aria-labelledby={headingId} className="rounded-lg border bg-card p-5 shadow-sm sm:p-6">
      <h2 id={headingId} className="text-lg text-foreground">
        {t("portal.newOrder.typeStep.heading")}
      </h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {OPTIONS.map(({ type, icon: Icon, title, text }) => (
          <li key={type} className="min-w-0">
            <Link
              to="/portal/orders/nieuw"
              search={{ type }}
              className="group flex h-full min-h-24 items-start gap-4 rounded-lg border-2 border-border bg-card p-4 transition-colors hover:border-primary hover:bg-cream focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-md bg-secondary text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-heading text-base font-bold text-primary">
                  {t(title)}
                </span>
                <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                  {t(text)}
                </span>
              </span>
              <ChevronRight
                className="mt-3 size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
