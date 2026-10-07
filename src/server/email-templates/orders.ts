import "@tanstack/react-start/server-only";

import { formatDate, formatLbs } from "@/lib/format";
import {
  greeting,
  renderEmail,
  type EmailBlock,
  type EmailBrand,
  type EmailContent,
} from "@/server/email-templates/layout";

/**
 * "Order bevestigd" and "Statusupdate" (SPEC §24, §35.12). Links to
 * /portal/orders/<id> only for a customer who can log in; everyone else gets
 * the details in the e-mail itself (and a word about an open invitation).
 */

/** Whether the e-mail may link to /portal (SPEC §35.12: never without a login). */
export type PortalAccess = { login: true } | { login: false; invitationOpen: boolean };

export interface EmailCustomer {
  fullName: string;
  customerCode: string;
  email: string;
}

export function accessBlocks(access: PortalAccess): EmailBlock[] {
  if (access.login || !access.invitationOpen) return [];
  return [
    {
      type: "note",
      text: "U heeft nog geen account voor het klantportaal. Er staat een uitnodiging voor u klaar: gebruik de link uit onze uitnodiging om een wachtwoord te kiezen, of vraag ons om een nieuwe link.",
    },
  ];
}

const ORDER_TYPES: Record<string, string> = { personal: "Persoonlijk", b2b: "Zakelijk (B2B)" };
const SERVICE_TYPES: Record<string, string> = { air: "Luchtvracht", sea: "Zeevracht" };

export interface ConfirmedOrder {
  id: string;
  reference: string;
  orderType: string;
  serviceType: string;
  storeVendor: string | null;
  vendorOrderNumber: string | null;
  description: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  declaredWeightLbs: number | null;
  expectedDeliveryDate: string | null;
  /** The order this one is an extra package of. */
  parentReference: string | null;
}

export interface OrderConfirmationInput {
  brand: EmailBrand;
  customer: EmailCustomer;
  access: PortalAccess;
  createdBy: "customer" | "staff";
  order: ConfirmedOrder;
}

function orderRows(order: ConfirmedOrder): [string, string][] {
  const rows: [string, string | null][] = [
    ["Referentie:", order.reference],
    ["Soort order:", ORDER_TYPES[order.orderType] ?? order.orderType],
    ["Verzendwijze:", SERVICE_TYPES[order.serviceType] ?? order.serviceType],
    ["Winkel:", order.storeVendor],
    ["Ordernummer winkel:", order.vendorOrderNumber],
    ["Omschrijving:", order.description],
    ["Trackingnummer:", order.trackingNumber ?? "Nog niet bekend"],
    ["Vervoerder:", order.carrier],
    [
      "Opgegeven gewicht:",
      order.declaredWeightLbs !== null ? formatLbs(order.declaredWeightLbs) : null,
    ],
    [
      "Verwachte levering:",
      order.expectedDeliveryDate ? formatDate(order.expectedDeliveryDate) : null,
    ],
    ["Extra pakket bij:", order.parentReference],
  ];
  return rows.filter((r): r is [string, string] => r[1] !== null && r[1].trim() !== "");
}

export function orderConfirmationEmail(input: OrderConfirmationInput): EmailContent {
  const { order, customer } = input;
  const base = input.brand.appUrl.replace(/\/+$/, "");
  const company = input.brand.companyName || "G&R Solutions N.V.";
  const blocks: EmailBlock[] = [
    { type: "paragraph", text: greeting(customer.fullName) },
    {
      type: "paragraph",
      text:
        input.createdBy === "staff"
          ? `${company} heeft order ${order.reference} voor u aangemaakt. Hieronder staan de gegevens.`
          : `Bedankt! Uw order ${order.reference} is aangemeld. Hieronder staan de gegevens zoals wij ze hebben ontvangen.`,
    },
    { type: "details", rows: orderRows(order) },
    {
      type: "paragraph",
      text: `Laat het pakket bezorgen op uw persoonlijk US-verzendadres, met uw klantcode ${customer.customerCode} achter uw naam én op adresregel 2. Wij laten het u weten zodra het pakket in ons magazijn is ontvangen.`,
    },
  ];
  if (!order.trackingNumber) {
    blocks.push({
      type: "note",
      text: input.access.login
        ? "Heeft u het trackingnummer? Vul het aan in het klantportaal, dan herkennen wij uw pakket sneller."
        : "Heeft u het trackingnummer? Stuur het ons (bijvoorbeeld als antwoord op deze e-mail), dan herkennen wij uw pakket sneller.",
    });
  }
  if (input.access.login) {
    blocks.push({
      type: "button",
      label: "Order bekijken",
      href: `${base}/portal/orders/${order.id}`,
    });
  }
  blocks.push(...accessBlocks(input.access));
  return renderEmail({
    brand: input.brand,
    subject: `Order ${order.reference} is aangemeld`,
    preheader: `Uw order ${order.reference}${order.storeVendor ? ` (${order.storeVendor})` : ""} is bij ons bekend.`,
    title: "Order bevestigd",
    blocks,
    reason: `Deze e-mail is verstuurd naar ${customer.email} omdat er een order op uw klantcode ${customer.customerCode} is aangemeld.`,
  });
}

export interface StatusEmailOrder {
  id: string;
  reference: string;
  storeVendor: string | null;
  trackingNumber: string | null;
  description: string | null;
}

export interface StatusUpdateInput {
  brand: EmailBrand;
  customer: EmailCustomer;
  access: PortalAccess;
  status: { label: string; description: string | null; stage: string };
  orders: readonly StatusEmailOrder[];
  /** The message staff wrote for the customer, if any. */
  message: string | null;
  /** Pickup details from the settings, for the ready_for_pickup stage. */
  pickup: { address: string | null; hours: string | null; instructions: string | null } | null;
}

export function statusUpdateEmail(input: StatusUpdateInput): EmailContent {
  const { customer, status, orders } = input;
  const base = input.brand.appUrl.replace(/\/+$/, "");
  const one = orders.length === 1 ? orders[0] : null;
  const action = status.stage === "action_required";
  const blocks: EmailBlock[] = [
    { type: "paragraph", text: greeting(customer.fullName) },
    {
      type: "paragraph",
      text: one
        ? `De status van uw order ${one.reference} is gewijzigd naar: ${status.label}.`
        : `De status van ${orders.length} van uw orders is gewijzigd naar: ${status.label}.`,
    },
  ];
  if (status.description?.trim()) {
    blocks.push({ type: "paragraph", text: status.description });
  }
  if (input.message?.trim()) {
    blocks.push({
      type: "message",
      title: action ? "Wat wij van u nodig hebben" : "Bericht van G&R Solutions",
      text: input.message,
    });
  }
  blocks.push({
    type: "table",
    head: ["Order", "Winkel", "Tracking"],
    nowrap: [0],
    rows: orders.map((o) => [
      o.reference,
      [o.storeVendor, o.description].filter((v) => v && v.trim() !== "").join(" – ") || "–",
      o.trackingNumber ?? "–",
    ]),
  });
  if (status.stage === "ready_for_pickup" && input.pickup) {
    const rows: [string, string][] = [];
    if (input.pickup.address) rows.push(["Adres:", input.pickup.address]);
    if (input.pickup.hours) rows.push(["Openingstijden:", input.pickup.hours]);
    if (input.pickup.instructions) rows.push(["Meenemen:", input.pickup.instructions]);
    if (rows.length > 0) {
      blocks.push({ type: "heading", text: "Afhalen" }, { type: "details", rows });
    }
  }
  if (action) {
    blocks.push({
      type: "paragraph",
      text: input.access.login
        ? "Upload de gevraagde documenten bij de order in het klantportaal."
        : "Stuur de gevraagde documenten als antwoord op deze e-mail.",
    });
  }
  if (input.access.login) {
    blocks.push(
      one
        ? { type: "button", label: "Order bekijken", href: `${base}/portal/orders/${one.id}` }
        : { type: "button", label: "Mijn orders bekijken", href: `${base}/portal/orders` },
    );
  }
  blocks.push(...accessBlocks(input.access));
  return renderEmail({
    brand: input.brand,
    subject: one
      ? `Order ${one.reference}: ${status.label}`
      : `${orders.length} orders: ${status.label}`,
    preheader: one
      ? `Nieuwe status van order ${one.reference}: ${status.label}.`
      : `Nieuwe status van ${orders.length} orders: ${status.label}.`,
    title: action ? "Actie vereist" : "Statusupdate",
    blocks,
    reason: `Deze e-mail is verstuurd naar ${customer.email} over de orders van klantcode ${customer.customerCode}.`,
  });
}
