import "@tanstack/react-start/server-only";

import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { INVOICE_LABELS } from "@/lib/invoice/labels";
import {
  formatPercent,
  itemRows,
  paymentInstruction,
  referencesText,
  summaryRows,
  type InvoiceRenderModel,
} from "@/lib/invoice/model";
import {
  endSentence,
  greeting,
  renderEmail,
  type EmailBlock,
  type EmailBrand,
  type EmailContent,
} from "@/server/email-templates/layout";
import { accessBlocks, type PortalAccess } from "@/server/email-templates/orders";

/**
 * "Factuur aangemaakt", "Betaling bijna verschuldigd", "Betalingsherinnering"
 * and "Betaling ontvangen" (SPEC §19, §24, §35.12). Everything comes from the
 * issued invoice and its snapshots (InvoiceRenderModel via fromIssuedInvoice),
 * never from today's settings: the company, bank account, payment terms and
 * late-fee percentage are the ones printed on the invoice.
 */

export interface InvoiceEmailBase {
  appUrl: string;
  invoiceId: string;
  model: InvoiceRenderModel;
  access: PortalAccess;
  recipient: string;
}

/** The company as printed on the invoice (issuer_snapshot). */
export function invoiceBrand(appUrl: string, model: InvoiceRenderModel): EmailBrand {
  return {
    appUrl,
    companyName: model.issuer.companyName,
    tagline: model.issuer.tagline,
    email: model.issuer.email,
    phone: model.issuer.phone,
    address: model.issuer.address,
  };
}

const numberOf = (model: InvoiceRenderModel) =>
  model.meta.invoiceNumber ?? INVOICE_LABELS.draftNumber;

/**
 * The invoice's lines: freight rows (weight × price per lb, and their
 * amount), then the summary rows, whose amounts stand in the "Bedrag" column
 * (never under "Prijs per lbs", also not in the text version). Three columns,
 * so the labels keep their room on a phone.
 */
function linesTable(model: InvoiceRenderModel): EmailBlock {
  const summary = summaryRows(model);
  const total = summary.find((r) => r.emphasis);
  const amounts = new Map(model.lines.map((l) => [l.key, l.amount]));
  const money = (n: number | undefined) =>
    n === undefined ? "" : formatMoney(n, model.meta.currency);
  return {
    type: "table",
    head: [
      INVOICE_LABELS.items,
      `${INVOICE_LABELS.weight} × ${INVOICE_LABELS.pricePerLb.toLowerCase()}`,
      "Bedrag",
    ],
    numeric: [1, 2],
    widths: ["46%", null, null],
    rows: [
      ...itemRows(model).map((r) => [
        r.detail ? `${r.description}\n${r.detail}` : r.description,
        [r.weight, r.rate].filter((v) => v !== "").join(" × "),
        money(amounts.get(r.key)),
      ]),
      ...summary.filter((r) => !r.emphasis).map((r) => [r.label, r.weight ?? "", r.amount ?? ""]),
    ],
    ...(total ? { total: [total.label, "", total.amount ?? ""] } : {}),
  };
}

/** BETALINGSGEGEVENS for the invoice currency, the instruction line and the terms. */
function paymentBlocks(model: InvoiceRenderModel): EmailBlock[] {
  const currency = model.meta.currency;
  const account = model.issuer.bankAccounts.find((a) => a.currency === currency);
  const blocks: EmailBlock[] = [{ type: "heading", text: "Betalingsgegevens" }];
  if (account?.accountNumber) {
    const rows: [string, string][] = [["Rekeningnummer:", account.accountNumber]];
    if (account.bankName) rows.push(["Bank:", account.bankName]);
    if (account.accountHolder) rows.push(["Ten name van:", account.accountHolder]);
    blocks.push({ type: "details", rows });
  } else {
    blocks.push({
      type: "paragraph",
      text: `Neem contact met ons op voor de betaalgegevens in ${currency}.`,
    });
  }
  blocks.push({ type: "paragraph", strong: true, text: paymentInstruction(model) });
  if (model.issuer.paymentTermsText) {
    blocks.push(
      { type: "heading", text: "Betalingsvoorwaarden" },
      { type: "paragraph", text: model.issuer.paymentTermsText },
    );
  }
  return blocks;
}

function portalBlocks(input: InvoiceEmailBase, label: string): EmailBlock[] {
  const base = input.appUrl.replace(/\/+$/, "");
  if (!input.access.login) return accessBlocks(input.access);
  return [
    { type: "button", label, href: `${base}/portal/facturen/${input.invoiceId}` },
    { type: "note", text: "In het klantportaal kunt u de factuur ook als PDF opslaan." },
  ];
}

function reason(input: InvoiceEmailBase): string {
  const code = input.model.billTo.customerCode;
  return `Deze e-mail is verstuurd naar ${input.recipient} over de facturen van klantcode ${code}.`;
}

// ---------------------------------------------------------------------------

export function invoiceIssuedEmail(input: InvoiceEmailBase): EmailContent {
  const { model } = input;
  const number = numberOf(model);
  const money = (n: number) => formatMoney(n, model.meta.currency);
  const company = model.issuer.companyName || "G&R Solutions N.V.";
  const refs = model.meta.references.length > 0 ? referencesText(model.meta.references) : null;
  const blocks: EmailBlock[] = [
    { type: "paragraph", text: greeting(model.billTo.fullName) },
    {
      type: "paragraph",
      text: endSentence(
        `Hierbij ontvangt u factuur ${number} van ${company}${refs ? ` voor ${refs}` : ""}`,
      ),
    },
    {
      type: "details",
      rows: [
        [INVOICE_LABELS.invoiceNumber, number],
        [INVOICE_LABELS.customerCode, model.billTo.customerCode],
        [INVOICE_LABELS.date, formatDate(model.meta.invoiceDate)],
        [INVOICE_LABELS.dueDate, formatDate(model.meta.dueDate)],
        [`${INVOICE_LABELS.totalPrice}:`, money(model.totals.totalAmount)],
      ],
    },
    linesTable(model),
  ];
  if (model.meta.customerNote) {
    blocks.push({ type: "message", title: "Opmerkingen", text: model.meta.customerNote });
  }
  blocks.push(
    {
      type: "paragraph",
      text: `Graag ontvangen wij ${money(model.totals.totalAmount)} uiterlijk op ${formatDate(model.meta.dueDate)}.`,
    },
    ...paymentBlocks(model),
    ...portalBlocks(input, "Factuur bekijken"),
  );
  return renderEmail({
    brand: invoiceBrand(input.appUrl, model),
    subject: `Factuur ${number} van ${company}`,
    preheader: `Factuur ${number}: ${money(model.totals.totalAmount)}, te betalen uiterlijk op ${formatDate(model.meta.dueDate)}.`,
    title: "Factuur aangemaakt",
    blocks,
    reason: reason(input),
  });
}

export interface PaymentReminderInput extends InvoiceEmailBase {
  kind: "payment_reminder_due_soon" | "payment_reminder_overdue";
  /** The how-manieth reminder after the due date (1 for the first). */
  seq: number;
  amountPaid: number;
  balanceDue: number;
  daysOverdue: number;
  lateFeeApplied: boolean;
}

export function paymentReminderEmail(input: PaymentReminderInput): EmailContent {
  const { model } = input;
  const number = numberOf(model);
  const money = (n: number) => formatMoney(n, model.meta.currency);
  const due = formatDate(model.meta.dueDate);
  const overdue = input.kind === "payment_reminder_overdue";
  const pct = model.issuer.lateFeePercent;

  const rows: [string, string][] = [
    [INVOICE_LABELS.invoiceNumber, number],
    [INVOICE_LABELS.customerCode, model.billTo.customerCode],
    [INVOICE_LABELS.date, formatDate(model.meta.invoiceDate)],
    [INVOICE_LABELS.dueDate, due],
    [`${INVOICE_LABELS.totalPrice}:`, money(model.totals.totalAmount)],
  ];
  if (input.amountPaid > 0) rows.push(["Al betaald:", money(input.amountPaid)]);
  rows.push(["Nog te betalen:", money(input.balanceDue)]);
  if (overdue && input.daysOverdue > 0) {
    rows.push([
      "Dagen te laat:",
      input.daysOverdue === 1 ? "1 dag" : `${formatNumber(input.daysOverdue, 0)} dagen`,
    ]);
  }

  const blocks: EmailBlock[] = [{ type: "paragraph", text: greeting(model.billTo.fullName) }];
  if (overdue) {
    blocks.push({
      type: "paragraph",
      text: `Volgens onze administratie is factuur ${number} nog niet volledig betaald. De vervaldatum was ${due}. Wilt u het openstaande bedrag van ${money(input.balanceDue)} zo snel mogelijk overmaken?`,
    });
  } else {
    blocks.push({
      type: "paragraph",
      text: `Een vriendelijke herinnering: factuur ${number} vervalt op ${due}. Er staat nog ${money(input.balanceDue)} open.`,
    });
  }
  blocks.push({ type: "details", rows });
  if (pct !== null && pct > 0) {
    blocks.push(
      overdue && input.lateFeeApplied
        ? {
            type: "message",
            title: "Opslag te late betaling",
            text: `Volgens de betalingsvoorwaarden op de factuur is een opslag van ${formatPercent(pct)}% op het openstaande bedrag in rekening gebracht. Het bedrag hierboven is inclusief deze opslag.`,
          }
        : {
            type: "message",
            title: "Opslag te late betaling",
            text: overdue
              ? `Volgens de betalingsvoorwaarden op de factuur kan na het verstrijken van de betalingstermijn een opslag van ${formatPercent(pct)}% op het openstaande bedrag in rekening worden gebracht.`
              : `Betaal uiterlijk op ${due}: na het verstrijken van de betalingstermijn kan volgens de betalingsvoorwaarden een opslag van ${formatPercent(pct)}% op het openstaande bedrag in rekening worden gebracht.`,
          },
    );
  }
  blocks.push(...paymentBlocks(model), ...portalBlocks(input, "Factuur bekijken"), {
    type: "note",
    text: "Heeft u inmiddels betaald? Dan kunt u deze herinnering als niet verzonden beschouwen. Vragen over de factuur? Beantwoord deze e-mail of neem contact met ons op.",
  });

  return renderEmail({
    brand: invoiceBrand(input.appUrl, model),
    subject: !overdue
      ? `Herinnering: factuur ${number} vervalt op ${due}`
      : input.seq > 1
        ? `${input.seq}e betalingsherinnering: factuur ${number}`
        : `Betalingsherinnering: factuur ${number}`,
    preheader: overdue
      ? `Factuur ${number} is vervallen: nog ${money(input.balanceDue)} te betalen.`
      : `Factuur ${number} vervalt op ${due}: nog ${money(input.balanceDue)} te betalen.`,
    title: overdue ? "Betalingsherinnering" : "Betaling bijna verschuldigd",
    blocks,
    reason: reason(input),
  });
}

export interface PaymentReceivedInput extends InvoiceEmailBase {
  amountPaid: number;
  paidAt: string | null;
}

export function paymentReceivedEmail(input: PaymentReceivedInput): EmailContent {
  const { model } = input;
  const number = numberOf(model);
  const money = (n: number) => formatMoney(n, model.meta.currency);
  const rows: [string, string][] = [
    [INVOICE_LABELS.invoiceNumber, number],
    [INVOICE_LABELS.customerCode, model.billTo.customerCode],
    [`${INVOICE_LABELS.totalPrice}:`, money(model.totals.totalAmount)],
    ["Ontvangen:", money(input.amountPaid)],
  ];
  if (input.paidAt) rows.push(["Betaald op:", formatDate(input.paidAt)]);
  return renderEmail({
    brand: invoiceBrand(input.appUrl, model),
    subject: `Betaling ontvangen: factuur ${number}`,
    preheader: `Factuur ${number} is volledig betaald. Bedankt!`,
    title: "Betaling ontvangen",
    blocks: [
      { type: "paragraph", text: greeting(model.billTo.fullName) },
      {
        type: "paragraph",
        text: `Bedankt! Wij hebben uw betaling ontvangen: factuur ${number} is volledig betaald.`,
      },
      { type: "details", rows },
      ...portalBlocks(input, "Factuur bekijken"),
    ],
    reason: reason(input),
  });
}
