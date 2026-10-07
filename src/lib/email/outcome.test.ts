import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";

import {
  countOutcomes,
  emailOutcomeText,
  invitationEmailText,
  statusEmailSummary,
} from "./outcome";

describe("e-mail outcomes as staff read them", () => {
  it("one e-mail", () => {
    expect(emailOutcomeText("sent")).toBe(t("email.outcome.sent"));
    expect(emailOutcomeText("skipped")).toMatch(/nog niet geconfigureerd/);
    expect(emailOutcomeText("no_address")).toMatch(/geen e-mailadres/);
  });

  it("an invitation names the address it went to", () => {
    expect(invitationEmailText("sent", "alice@example.com")).toBe(
      "De link is ook per e-mail verstuurd naar alice@example.com.",
    );
    expect(invitationEmailText("failed", "alice@example.com")).toMatch(/Deel de link zelf/);
  });

  it("a status change for several customers: one sentence per kind of result", () => {
    expect(statusEmailSummary([])).toBeNull();
    expect(statusEmailSummary(["sent"])).toBe(t("email.outcome.sent"));
    expect(statusEmailSummary(["skipped", "skipped"])).toBe(t("email.status.skippedAll"));
    expect(statusEmailSummary(["sent", "sent", "failed", "no_address"])).toBe(
      "2 klanten hebben een e-mail gekregen. Bij 1 klant kon de e-mail niet worden verstuurd. 1 klant heeft geen e-mailadres.",
    );
    // Dutch agreement: "1 was", "2 waren" (review P8).
    expect(statusEmailSummary(["sent", "duplicate"])).toBe(
      "1 klant heeft een e-mail gekregen. 1 was al eerder verstuurd.",
    );
    expect(statusEmailSummary(["sent", "duplicate", "duplicate"])).toBe(
      "1 klant heeft een e-mail gekregen. 2 waren al eerder verstuurd.",
    );
    expect(countOutcomes(["sent", "duplicate", "sent"])).toEqual({
      sent: 2,
      skipped: 0,
      failed: 0,
      duplicate: 1,
      no_address: 0,
    });
  });
});
