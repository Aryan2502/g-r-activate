/**
 * What happened to an e-mail, as the staff screens report it (SPEC §29: no
 * silent failures). The server answers with these; the dialogs and toasts
 * turn them into Dutch with emailOutcomeText().
 *
 * - sent: the provider (Resend) accepted it;
 * - skipped: e-mail is not configured (RESEND_API_KEY / EMAIL_FROM missing):
 *   logged as skipped_no_provider, nothing went out;
 * - failed: the provider or the network refused it (logged as failed; a later
 *   attempt with the same key may retry it);
 * - duplicate: this exact e-mail was sent (or is being sent) already;
 * - no_address: the customer record has no e-mail address.
 */
import { t } from "@/lib/i18n";

export type EmailOutcome = "sent" | "skipped" | "failed" | "duplicate" | "no_address";

export const EMAIL_OUTCOMES: readonly EmailOutcome[] = [
  "sent",
  "skipped",
  "failed",
  "duplicate",
  "no_address",
];

export type EmailOutcomeCounts = Record<EmailOutcome, number>;

export function countOutcomes(outcomes: readonly EmailOutcome[]): EmailOutcomeCounts {
  const counts: EmailOutcomeCounts = {
    sent: 0,
    skipped: 0,
    failed: 0,
    duplicate: 0,
    no_address: 0,
  };
  for (const o of outcomes) counts[o] += 1;
  return counts;
}

/** One e-mail to one customer ("factuur aangemaakt", "betaling ontvangen", "order bevestigd"). */
export function emailOutcomeText(outcome: EmailOutcome): string {
  return t(`email.outcome.${outcome}`);
}

/** The invitation dialogs: the link is always shown; this says whether it was e-mailed too. */
export function invitationEmailText(outcome: EmailOutcome, email: string | null): string {
  if (outcome === "sent") {
    return email ? t("email.invitation.sent", { email }) : t("email.outcome.sent");
  }
  return t(`email.invitation.${outcome}`);
}

/**
 * A status change for one or more customers ("statusupdate", at most one
 * e-mail per customer): one sentence with what happened, worst news first,
 * or null when no e-mail was meant to go out.
 */
export function statusEmailSummary(outcomes: readonly EmailOutcome[]): string | null {
  if (outcomes.length === 0) return null;
  const c = countOutcomes(outcomes);
  if (outcomes.length === 1) return emailOutcomeText(outcomes[0] ?? "skipped");
  if (c.skipped === outcomes.length) return t("email.status.skippedAll");
  const parts: string[] = [];
  if (c.sent > 0) {
    parts.push(
      c.sent === 1 ? t("email.status.sentOne") : t("email.status.sentMany", { count: c.sent }),
    );
  }
  if (c.failed > 0) {
    parts.push(
      c.failed === 1
        ? t("email.status.failedOne")
        : t("email.status.failedMany", { count: c.failed }),
    );
  }
  if (c.no_address > 0) {
    parts.push(
      c.no_address === 1
        ? t("email.status.noAddressOne")
        : t("email.status.noAddressMany", { count: c.no_address }),
    );
  }
  if (c.skipped > 0) {
    parts.push(t("email.status.skippedSome", { count: c.skipped }));
  }
  if (c.duplicate > 0) {
    parts.push(
      c.duplicate === 1
        ? t("email.status.duplicateOne")
        : t("email.status.duplicateMany", { count: c.duplicate }),
    );
  }
  return parts.join(" ");
}

/** Whether staff should see the outcome as a problem (toast tone, callout). */
export function isEmailProblem(outcome: EmailOutcome): boolean {
  return outcome === "failed" || outcome === "no_address" || outcome === "skipped";
}
