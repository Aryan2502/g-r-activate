import "@tanstack/react-start/server-only";

import { formatDate } from "@/lib/format";
import { paths } from "@/lib/paths";
import {
  endSentence,
  greeting,
  renderEmail,
  type EmailBlock,
  type EmailBrand,
  type EmailContent,
} from "@/server/email-templates/layout";

/**
 * "Uitnodiging" and "Welkom" (SPEC §5, §35.6, §35.12). The invitation link is
 * `${APP_URL}/invite/<token>`, built by the caller from getAppUrl() only.
 */

export interface InvitationEmailInput {
  brand: EmailBrand;
  kind: "customer" | "staff";
  fullName: string | null;
  customerCode: string | null;
  staffRole: "admin" | "staff" | null;
  /** The address the person will log in with. */
  email: string;
  link: string;
  expiresAt: string;
  /** "Opnieuw versturen": earlier links no longer work. */
  resend: boolean;
}

export function invitationEmail(input: InvitationEmailInput): EmailContent {
  const company = input.brand.companyName || "G&R Solutions N.V.";
  const until = formatDate(input.expiresAt);
  // A team member is not a customer: no "Beste klant," without a name.
  const blocks: EmailBlock[] = [
    {
      type: "paragraph",
      text: greeting(input.fullName, input.kind === "staff" ? "Goedendag," : undefined),
    },
  ];
  if (input.kind === "staff") {
    blocks.push({
      type: "paragraph",
      text: endSentence(
        `U bent uitgenodigd om als ${input.staffRole === "admin" ? "beheerder" : "medewerker"} mee te werken in G&R Activate, het beheersysteem van ${company}`,
      ),
    });
  } else {
    blocks.push({
      type: "paragraph",
      text: `${company} nodigt u uit voor G&R Activate, het klantportaal waarin u uw orders, zendingen en facturen volgt.`,
    });
    if (input.customerCode) {
      blocks.push({ type: "details", rows: [["Uw klantcode:", input.customerCode]] });
    }
  }
  blocks.push(
    {
      type: "paragraph",
      text: `Kies via de knop hieronder zelf een wachtwoord. Daarna logt u in met ${input.email}.`,
    },
    { type: "button", label: "Account activeren", href: input.link },
    {
      type: "link",
      label: "Werkt de knop niet? Kopieer deze link en plak hem in uw browser:",
      href: input.link,
    },
    {
      type: "note",
      text: `Deze link is persoonlijk en geldig tot ${until}.${input.resend ? " Eerder ontvangen links werken niet meer." : ""} Heeft u deze uitnodiging niet verwacht? Dan kunt u deze e-mail negeren.`,
    },
  );
  return renderEmail({
    brand: input.brand,
    subject:
      input.kind === "staff"
        ? "Uitnodiging voor het team van G&R Activate"
        : `Uw uitnodiging voor het klantportaal van ${company}`,
    preheader: `Kies een wachtwoord voor uw account (geldig tot ${until}).`,
    title: input.kind === "staff" ? "Welkom in het team" : "Uw uitnodiging voor G&R Activate",
    blocks,
    reason: `Deze e-mail is verstuurd naar ${input.email} omdat ${company} u heeft uitgenodigd.`,
  });
}

export interface WelcomeAddress {
  /** e.g. "Luchtvracht – Miami" */
  title: string;
  lines: readonly string[];
}

export interface WelcomeEmailInput {
  brand: EmailBrand;
  kind: "customer" | "staff";
  fullName: string | null;
  customerCode: string | null;
  email: string;
  /** The personal US shipping addresses (active warehouse addresses, filled in). */
  addresses: readonly WelcomeAddress[];
}

export function welcomeEmail(input: WelcomeEmailInput): EmailContent {
  const company = input.brand.companyName || "G&R Solutions N.V.";
  const base = input.brand.appUrl.replace(/\/+$/, "");
  const blocks: EmailBlock[] = [{ type: "paragraph", text: greeting(input.fullName) }];
  if (input.kind === "staff") {
    blocks.push(
      {
        type: "paragraph",
        text: `Uw account voor G&R Activate is geactiveerd. U logt in met ${input.email}.`,
      },
      { type: "button", label: "Naar G&R Activate", href: `${base}${paths.admin}` },
    );
  } else {
    blocks.push({
      type: "paragraph",
      text: `Welkom bij ${company}! Uw account voor het klantportaal is geactiveerd. U logt in met ${input.email}.`,
    });
    if (input.customerCode) {
      blocks.push({ type: "details", rows: [["Uw klantcode:", input.customerCode]] });
    }
    blocks.push({ type: "heading", text: "Uw persoonlijk US-verzendadres" });
    if (input.addresses.length > 0) {
      blocks.push({
        type: "paragraph",
        text: "Laat uw aankopen in de VS naar dit adres sturen. Het staat ook altijd in het klantportaal.",
      });
      for (const address of input.addresses) {
        blocks.push({ type: "address", title: address.title, lines: address.lines });
      }
      if (input.customerCode) {
        blocks.push({
          type: "paragraph",
          strong: true,
          text: `Zet altijd uw klantcode ${input.customerCode} achter uw naam én op adresregel 2.`,
        });
      }
    } else {
      blocks.push({
        type: "paragraph",
        text: "Ons US-adres wordt binnenkort in het klantportaal getoond.",
      });
    }
    blocks.push(
      {
        type: "paragraph",
        text: "In het portaal meldt u uw orders aan, volgt u uw zendingen en bekijkt u uw facturen.",
      },
      { type: "button", label: "Naar het klantportaal", href: `${base}${paths.portal}` },
    );
  }
  return renderEmail({
    brand: input.brand,
    subject:
      input.kind === "staff" ? "Uw account voor G&R Activate is actief" : `Welkom bij ${company}`,
    preheader:
      input.kind === "staff"
        ? "Uw account is geactiveerd."
        : "Uw account is geactiveerd. Hier is uw persoonlijk US-verzendadres.",
    title: input.kind === "staff" ? "Uw account is actief" : "Welkom bij G&R Activate",
    blocks,
    reason: `Deze e-mail is verstuurd naar ${input.email} omdat u uw account heeft geactiveerd.`,
  });
}
