import { describe, expect, it } from "vitest";

import {
  INVITATION_TOKEN_PATTERN,
  firstName,
  invitationLink,
  invitationShareText,
  invitationState,
  isInvitationToken,
  maskEmail,
  recoveryLink,
  recoveryShareText,
  resendAvailability,
  sendsToday,
  whatsappHref,
} from "./invitations";

const at = (iso: string) => new Date(iso);

describe("invitationState()", () => {
  const base = { accepted_at: null, revoked_at: null, expires_at: "2026-10-14T12:00:00Z" };

  it("is open until it expires, then expired", () => {
    expect(invitationState(base, at("2026-10-14T11:59:59Z"))).toBe("open");
    expect(invitationState(base, at("2026-10-14T12:00:00Z"))).toBe("expired");
  });

  it("accepted wins over revoked over expired, as redeem_invitation checks them", () => {
    const old = at("2026-12-01T00:00:00Z");
    expect(
      invitationState({ ...base, accepted_at: "2026-10-02T00:00:00Z", revoked_at: "x" }, old),
    ).toBe("accepted");
    expect(invitationState({ ...base, revoked_at: "2026-10-02T00:00:00Z" }, old)).toBe("revoked");
  });
});

describe("resendAvailability(): the limits of invitations_guard", () => {
  it("allows a resend a minute after the last one", () => {
    const sent = { last_sent_at: "2026-10-07T15:00:00Z", send_count: 1 };
    expect(resendAvailability(sent, at("2026-10-07T15:00:20Z"))).toEqual({
      ok: false,
      reason: "wait",
      seconds: 40,
    });
    expect(resendAvailability(sent, at("2026-10-07T15:01:00Z"))).toEqual({ ok: true });
  });

  it("stops at five sends per Suriname day, and allows them again the next day", () => {
    // 2026-10-07 23:30 in Paramaribo is 2026-10-08 02:30 UTC.
    const sent = { last_sent_at: "2026-10-08T02:30:00Z", send_count: 5 };
    expect(resendAvailability(sent, at("2026-10-08T02:45:00Z"))).toEqual({
      ok: false,
      reason: "daily_limit",
    });
    // 00:10 the next morning in Paramaribo.
    expect(resendAvailability(sent, at("2026-10-08T03:10:00Z"))).toEqual({ ok: true });
  });

  it("never blocks an invitation that was never sent", () => {
    expect(resendAvailability({ last_sent_at: null, send_count: 0 })).toEqual({ ok: true });
  });
});

describe("sendsToday(): the day's count the page shows ('vandaag 3 van 5 keer')", () => {
  it("counts only when the last link was made on this Suriname day", () => {
    const sent = { last_sent_at: "2026-10-08T02:30:00Z", send_count: 3 }; // 23:30 in Paramaribo
    expect(sendsToday(sent, at("2026-10-08T02:45:00Z"))).toBe(3);
    expect(sendsToday(sent, at("2026-10-08T03:10:00Z"))).toBe(0); // the next morning
    expect(sendsToday({ last_sent_at: null, send_count: 0 })).toBe(0);
  });
});

describe("tokens and links", () => {
  it("accepts exactly 43 base64url characters (32 bytes, no padding)", () => {
    expect(isInvitationToken("aZ09-_".repeat(7) + "x")).toBe(true);
    expect(INVITATION_TOKEN_PATTERN.test("A".repeat(43))).toBe(true);
    for (const bad of [
      "A".repeat(42),
      "A".repeat(44),
      `${"A".repeat(42)}=`,
      `${"A".repeat(42)}/`,
    ]) {
      expect(isInvitationToken(bad), bad).toBe(false);
    }
    expect(isInvitationToken(undefined)).toBe(false);
  });

  it("builds ${APP_URL}/invite/<token> and the /auth/confirm recovery link", () => {
    expect(invitationLink("https://portal.example.com/", "tok")).toBe(
      "https://portal.example.com/invite/tok",
    );
    expect(recoveryLink("https://portal.example.com", "pkce_abc+/=")).toBe(
      "https://portal.example.com/auth/confirm?token_hash=pkce_abc%2B%2F%3D&type=recovery",
    );
  });
});

describe("maskEmail() and firstName()", () => {
  it("keeps enough to recognise the address", () => {
    expect(maskEmail("Maria.Pinas@Example.com")).toBe("ma•••@e•••.com");
    expect(maskEmail("jo@g.sr")).toBe("j•••@g•••.sr");
    expect(maskEmail("a@localhost")).toBe("a•••@l•••");
  });

  it("takes the first word of the name", () => {
    expect(firstName("  Maria  Pinas ")).toBe("Maria");
    expect(firstName("")).toBeNull();
    expect(firstName(null)).toBeNull();
  });
});

describe("WhatsApp sharing (SPEC §35.12)", () => {
  it("uses the international digits, 597 for local numbers", () => {
    expect(whatsappHref("+597 889 7500", "Hallo")).toBe("https://wa.me/5978897500?text=Hallo");
    expect(whatsappHref("8897500", "a b")).toBe("https://wa.me/5978897500?text=a%20b");
  });

  it("lets staff pick the chat when there is no usable number", () => {
    expect(whatsappHref(null, "x")).toBe("https://wa.me/?text=x");
    expect(whatsappHref("12", "x")).toBe("https://wa.me/?text=x");
  });

  it("writes a Dutch message with the name, the code, the validity and the link", () => {
    const text = invitationShareText({
      kind: "customer",
      fullName: "Maria Pinas",
      customerCode: "GR00017",
      email: "maria.pinas@example.com",
      link: "https://portal.example.com/invite/tok",
    });
    expect(text).toContain("Beste Maria,");
    expect(text).toContain("GR00017");
    // The /invite page masks the address: the message names it in full.
    expect(text).toContain("U logt in met maria.pinas@example.com.");
    expect(text).toContain("7 dagen");
    expect(text.endsWith("https://portal.example.com/invite/tok")).toBe(true);

    const staff = invitationShareText({
      kind: "staff",
      fullName: null,
      customerCode: null,
      email: "nina@gr.sr",
      link: "L",
    });
    expect(staff).toContain("als medewerker");
    expect(staff).toContain("U logt in met nina@gr.sr.");
    expect(staff).not.toContain("klantcode");

    expect(recoveryShareText({ fullName: "Maria Pinas", link: "R" })).toContain("R");
  });
});
