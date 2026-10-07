import type { EmailOutcome } from "@/lib/email/outcome";
import { t } from "@/lib/i18n";

/**
 * "Deel via WhatsApp" after a status change (SPEC §35.12: WhatsApp is the
 * main channel while e-mail is not configured, and the fallback when an
 * e-mail could not go out). For every customer whose "statusupdate" e-mail
 * was not sent, the server returns one StatusFollowUp with the message
 * already written; the dialog lists them with a WhatsApp button each.
 * Pure, so the wording is unit-tested.
 */

/** Why the customer still has to be told: their e-mail did not go out. */
export type FollowUpReason = Extract<EmailOutcome, "skipped" | "failed" | "no_address">;

export function needsFollowUp(outcome: EmailOutcome): outcome is FollowUpReason {
  return outcome === "skipped" || outcome === "failed" || outcome === "no_address";
}

export interface StatusFollowUp {
  customerId: string;
  reason: FollowUpReason;
  /** "Maria Pinas" or the company name. */
  customerName: string;
  customerCode: string | null;
  phone: string | null;
  /** The changed orders of this customer, by reference. */
  references: string[];
  /** The Dutch WhatsApp message (staff can still edit it in WhatsApp). */
  text: string;
}

export interface StatusShareInput {
  /** Used for the greeting (first word); null: "Goedendag,". */
  customerName: string | null;
  orders: readonly { id: string; reference: string }[];
  status: { label: string; description: string | null; stage: string };
  /** What staff wrote for the customer, if anything. */
  message: string | null;
  /** Pickup details from the settings; only printed for ready_for_pickup. */
  pickup: { address: string | null; hours: string | null; instructions: string | null } | null;
  /** Origin for portal links, only for a customer with a login (SPEC §35.12). */
  portalBase: string | null;
  companyName: string;
}

const filled = (s: string | null | undefined): s is string => Boolean(s?.trim());

/** The WhatsApp version of the "statusupdate" e-mail for one customer. */
export function statusShareText(input: StatusShareInput): string {
  const first = input.customerName?.trim().split(/\s+/, 1)[0] ?? "";
  const one = input.orders.length === 1 ? input.orders[0] : undefined;
  const lines: string[] = [
    first
      ? t("admin.status.share.greeting", { name: first })
      : t("admin.status.share.greetingNoName"),
    "",
    one
      ? t("admin.status.share.one", { reference: one.reference, status: input.status.label })
      : t("admin.status.share.many", {
          references: input.orders.map((o) => o.reference).join(", "),
          status: input.status.label,
        }),
  ];
  if (filled(input.status.description)) lines.push(input.status.description.trim());
  if (filled(input.message)) {
    lines.push(
      "",
      input.status.stage === "action_required"
        ? t("admin.status.share.action", { message: input.message.trim() })
        : t("admin.status.share.message", { message: input.message.trim() }),
    );
  }
  if (input.status.stage === "ready_for_pickup" && input.pickup) {
    const pickup = [
      filled(input.pickup.address)
        ? t("admin.status.share.pickupAddress", { address: input.pickup.address.trim() })
        : null,
      filled(input.pickup.hours)
        ? t("admin.status.share.pickupHours", { hours: input.pickup.hours.trim() })
        : null,
      filled(input.pickup.instructions)
        ? t("admin.status.share.pickupInstructions", {
            instructions: input.pickup.instructions.trim(),
          })
        : null,
    ].filter((l): l is string => l !== null);
    if (pickup.length > 0) lines.push("", t("admin.status.share.pickupTitle"), ...pickup);
  }
  if (input.portalBase) {
    const base = input.portalBase.replace(/\/+$/, "");
    lines.push(
      "",
      one
        ? t("admin.status.share.portalOne", { link: `${base}/portal/orders/${one.id}` })
        : t("admin.status.share.portalMany", { link: `${base}/portal/orders` }),
    );
  }
  lines.push("", t("admin.status.share.closing"), input.companyName);
  return lines.join("\n");
}
