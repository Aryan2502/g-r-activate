import "@tanstack/react-start/server-only";

import { formatPhone } from "@/lib/phone";

/**
 * The branded frame of every G&R e-mail (SPEC §24, §35.12, §35.14): the logo
 * band on #EEEBE4, brown headings, cream info boxes, a footer with the
 * company's contact lines. Inline styles and tables only, so mail clients
 * render it; a plain-text version is built from the same blocks.
 *
 * Content is passed as BLOCKS of plain text, never as HTML: renderEmail()
 * escapes every string, so a customer's name, a vendor or a staff message can
 * never inject markup. Links (buttons, link blocks) must start with the
 * app's own base URL (getAppUrl()), never a request's origin.
 *
 * The wording is Dutch, written in the templates themselves like the invoice
 * labels (SPEC §35.0: e-mails always use G&R's Dutch wording).
 */

export interface EmailBrand {
  /** getAppUrl(): the origin every link and the logo use. */
  appUrl: string;
  companyName: string;
  tagline: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export type EmailBlock =
  | { type: "paragraph"; text: string; strong?: boolean }
  | { type: "heading"; text: string }
  | { type: "button"; label: string; href: string }
  | { type: "link"; label: string; href: string }
  | { type: "details"; rows: readonly (readonly [label: string, value: string])[] }
  | { type: "message"; title: string; text: string }
  | { type: "list"; items: readonly string[] }
  | {
      type: "table";
      head: readonly string[];
      rows: readonly (readonly string[])[];
      /** Columns (0-based) printed right-aligned, e.g. amounts. */
      numeric?: readonly number[];
      /** Columns kept on one line, e.g. order references. */
      nowrap?: readonly number[];
      /** Width per column (e.g. "40%"), so a narrow screen does not squeeze the labels. */
      widths?: readonly (string | null)[];
      /** A last row in bold, e.g. the total. */
      total?: readonly string[];
    }
  | { type: "address"; title: string; lines: readonly string[] }
  | { type: "note"; text: string };

export const COLORS = {
  brown: "#713A28",
  cream: "#F5F2EC",
  border: "#D8D2C9",
  paper: "#EEEBE4",
  background: "#FAF8F4",
  text: "#2B2724",
  muted: "#6B645C",
  grey: "#54514C",
} as const;

const FONT = "Inter, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
const HEADING_FONT = "Montserrat, Inter, Arial, sans-serif";

/** Escapes text for HTML content and attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Escaped text with its line breaks kept. */
function multiline(value: string): string {
  return escapeHtml(value.trim()).replace(/\r?\n/g, "<br />");
}

/** The first word of a name, for "Beste Alice,"; null when there is none. */
export function firstNameOf(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/, 1)[0];
  return first ? first : null;
}

/** "Beste Alice,"; without a name `fallback` ("Beste klant," for customers). */
export function greeting(fullName: string | null | undefined, fallback = "Beste klant,"): string {
  const name = firstNameOf(fullName);
  return name ? `Beste ${name},` : fallback;
}

/** Ends a sentence with one full stop, also after a name ending in one ("… N.V."). */
export function endSentence(text: string): string {
  const trimmed = text.trimEnd();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function assertAppLink(brand: EmailBrand, href: string) {
  const base = brand.appUrl.replace(/\/+$/, "");
  if (href !== base && !href.startsWith(`${base}/`)) {
    throw new Error("E-mail links must point at APP_URL");
  }
}

function blockHtml(brand: EmailBrand, block: EmailBlock): string {
  const p = `margin:0 0 14px 0; font-size:15px; line-height:1.6; color:${COLORS.text};`;
  switch (block.type) {
    case "paragraph":
      return `<p style="${p}${block.strong ? " font-weight:700;" : ""}">${multiline(block.text)}</p>`;
    case "heading":
      return `<h2 style="margin:22px 0 10px 0; font-family:${HEADING_FONT}; font-size:16px; line-height:1.3; font-weight:700; color:${COLORS.brown};">${escapeHtml(block.text)}</h2>`;
    case "button":
      assertAppLink(brand, block.href);
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px 0;"><tr><td align="center" bgcolor="${COLORS.brown}" style="border-radius:6px;"><a href="${escapeHtml(block.href)}" style="display:inline-block; padding:12px 24px; font-size:15px; font-weight:600; line-height:1.2; color:#FFFFFF; text-decoration:none; border-radius:6px;">${escapeHtml(block.label)}</a></td></tr></table>`;
    case "link":
      assertAppLink(brand, block.href);
      return `<p style="margin:0 0 6px 0; font-size:13px; line-height:1.6; color:${COLORS.muted};">${escapeHtml(block.label)}</p><p style="margin:0 0 16px 0; font-size:13px; line-height:1.6; word-break:break-all;"><a href="${escapeHtml(block.href)}" style="color:${COLORS.brown};">${escapeHtml(block.href)}</a></p>`;
    case "details":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px 0; border-collapse:collapse; border:1px solid ${COLORS.border};">${block.rows
        .map(
          ([label, value]) =>
            `<tr><td style="width:38%; padding:8px 10px; background-color:${COLORS.cream}; border:1px solid ${COLORS.border}; font-size:13px; font-weight:700; color:${COLORS.brown}; vertical-align:top;">${escapeHtml(label)}</td><td style="padding:8px 10px; border:1px solid ${COLORS.border}; font-size:14px; color:${COLORS.text}; vertical-align:top; word-break:break-word;">${multiline(value)}</td></tr>`,
        )
        .join("")}</table>`;
    case "message":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px 0;"><tr><td style="padding:12px 14px; background-color:${COLORS.cream}; border-left:4px solid ${COLORS.brown};"><p style="margin:0 0 6px 0; font-size:13px; font-weight:700; color:${COLORS.brown};">${escapeHtml(block.title)}</p><p style="margin:0; font-size:15px; line-height:1.6; color:${COLORS.text};">${multiline(block.text)}</p></td></tr></table>`;
    case "list":
      return `<ul style="margin:0 0 16px 0; padding-left:20px; font-size:15px; line-height:1.6; color:${COLORS.text};">${block.items
        .map((item) => `<li style="margin:0 0 4px 0;">${multiline(item)}</li>`)
        .join("")}</ul>`;
    case "table": {
      const align = (i: number) => (block.numeric?.includes(i) ? "right" : "left");
      const wrap = (i: number) =>
        block.nowrap?.includes(i) ? "white-space:nowrap;" : "word-break:break-word;";
      const cell = (value: string, i: number, extra = "") =>
        `<td style="padding:7px 8px; border:1px solid ${COLORS.border}; font-size:13px; color:${COLORS.text}; text-align:${align(i)}; vertical-align:top; ${wrap(i)}${extra}">${multiline(value)}</td>`;
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px 0; border-collapse:collapse;"><tr>${block.head
        .map(
          (h, i) =>
            `<th style="padding:7px 8px; background-color:${COLORS.brown}; border:1px solid ${COLORS.brown}; font-size:13px; font-weight:700; color:#FFFFFF; text-align:${align(i)};${block.widths?.[i] && /^\d{1,3}%$/.test(block.widths[i] ?? "") ? ` width:${block.widths[i]};` : ""}">${escapeHtml(h)}</th>`,
        )
        .join("")}</tr>${block.rows
        .map((row) => `<tr>${row.map((v, i) => cell(v, i)).join("")}</tr>`)
        .join("")}${
        block.total
          ? `<tr>${block.total.map((v, i) => cell(v, i, ` background-color:${COLORS.cream}; font-weight:700; color:${COLORS.brown};`)).join("")}</tr>`
          : ""
      }</table>`;
    }
    case "address":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px 0; border:1px solid ${COLORS.border};"><tr><td style="padding:12px 14px; background-color:${COLORS.cream};"><p style="margin:0 0 6px 0; font-size:13px; font-weight:700; color:${COLORS.brown};">${escapeHtml(block.title)}</p><p style="margin:0; font-size:15px; line-height:1.6; color:${COLORS.text};">${block.lines.map((l) => escapeHtml(l)).join("<br />")}</p></td></tr></table>`;
    case "note":
      return `<p style="margin:0 0 12px 0; font-size:13px; line-height:1.6; color:${COLORS.muted};">${multiline(block.text)}</p>`;
  }
}

function blockText(block: EmailBlock): string {
  switch (block.type) {
    case "paragraph":
    case "note":
      return block.text.trim();
    case "heading":
      return `${block.text.toUpperCase()}\n${"-".repeat(Math.min(60, block.text.length))}`;
    case "button":
    case "link":
      return `${block.label}:\n${block.href}`;
    case "details":
      return block.rows.map(([label, value]) => `${label} ${value}`).join("\n");
    case "message":
      return `${block.title}\n${block.text.trim()}`;
    case "list":
      return block.items.map((i) => `- ${i}`).join("\n");
    case "table": {
      const lines = block.rows.map((row) =>
        row
          .map((v, i) => (i === 0 ? v : `${block.head[i] ?? ""}: ${v}`))
          .filter((v) => v.trim() !== "" && !v.endsWith(": "))
          .join(" · "),
      );
      if (block.total) lines.push(block.total.filter((v) => v.trim() !== "").join(" "));
      return lines.map((l) => `- ${l}`).join("\n");
    }
    case "address":
      return `${block.title}\n${block.lines.join("\n")}`;
  }
}

export interface RenderInput {
  brand: EmailBrand;
  subject: string;
  /** The hidden one-line summary mail clients show next to the subject. */
  preheader: string;
  title: string;
  blocks: readonly EmailBlock[];
  /** Why the recipient gets this e-mail (bottom of the footer). */
  reason: string;
}

function contactLines(brand: EmailBrand): string[] {
  return [
    brand.email ? `E-mail: ${brand.email}` : null,
    brand.phone ? `Telefoon: ${formatPhone(brand.phone)}` : null,
    brand.address ? `Adres: ${brand.address}` : null,
  ].filter((l): l is string => l !== null);
}

export function renderEmail(input: RenderInput): EmailContent {
  const { brand } = input;
  const base = brand.appUrl.replace(/\/+$/, "");
  const company = brand.companyName.trim() || "G&R SOLUTIONS N.V.";
  const tagline = brand.tagline?.trim() || null;
  const contact = contactLines(brand);
  // A subject is one line: a name or label with a line break must not add headers.
  const subject = input.subject.replace(/[\r\n]+/g, " ").trim();

  const html = `<!doctype html>
<html lang="nl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0; padding:0; background-color:${COLORS.background}; color:${COLORS.text}; font-family:${FONT};">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:${COLORS.background};">${escapeHtml(input.preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.background};">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; background-color:#FFFFFF; border:1px solid ${COLORS.border}; border-radius:6px;">
            <tr>
              <td align="center" style="background-color:${COLORS.paper}; border-radius:6px 6px 0 0; padding:20px 24px;">
                <img src="${escapeHtml(`${base}/brand/gr-logo-banner.jpg`)}" width="240" alt="${escapeHtml(`${company}${tagline ? ` – ${tagline}` : ""}`)}" style="display:block; width:240px; max-width:100%; height:auto; border:0;" />
              </td>
            </tr>
            <tr>
              <td style="padding:28px 28px 12px 28px;">
                <h1 style="margin:0 0 16px 0; font-family:${HEADING_FONT}; font-size:21px; line-height:1.3; font-weight:700; color:${COLORS.brown};">${escapeHtml(input.title)}</h1>
                ${input.blocks.map((b) => blockHtml(brand, b)).join("\n                ")}
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid ${COLORS.border}; padding:16px 28px; font-size:12px; line-height:1.6; color:${COLORS.grey};">
                <strong style="color:${COLORS.brown};">${escapeHtml(company)}</strong>${tagline ? ` &nbsp;|&nbsp; ${escapeHtml(tagline)}` : ""}<br />
                ${contact.map((l) => escapeHtml(l)).join(" &nbsp;·&nbsp; ")}${contact.length ? "<br />" : ""}
                ${escapeHtml(input.reason)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

  const text = [
    input.title,
    "=".repeat(Math.min(60, input.title.length)),
    "",
    input.blocks.map(blockText).join("\n\n"),
    "",
    "--",
    `${company}${tagline ? ` | ${tagline}` : ""}`,
    ...contact,
    input.reason,
    "",
  ].join("\n");

  return { subject, html, text };
}
