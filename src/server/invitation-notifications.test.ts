import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb } from "@/test/fake-supabase";

import type { SendEmailInput } from "./email";

const sent = vi.hoisted(() => ({ calls: [] as SendEmailInput[] }));
vi.mock("@/server/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./email")>()),
  sendEmail: vi.fn(async (input: SendEmailInput) => {
    sent.calls.push(input);
    return { status: "skipped_no_provider", logId: "l1" };
  }),
}));

const { onInvitationRedeemed, onInvitationSent } = await import("./invitation-notifications");

const APP = "https://portal.example.com";
const ALICE = "c0000000-0000-4000-8000-000000000001";
const TOKEN = "a".repeat(43);

const company = [{ company_name: "G&R SOLUTIONS N.V.", email: "info@grsolutions.sr" }];

beforeEach(() => {
  sent.calls = [];
  vi.stubEnv("APP_URL", APP);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('onInvitationSent ("uitnodiging")', () => {
  it("links to APP_URL/invite/<token>, keyed by send_count and the Suriname day", async () => {
    const db = fakeDb({
      company_settings: company,
      invitations: [
        {
          id: "inv-1",
          kind: "customer",
          email: "alice@example.com",
          customer_id: ALICE,
          staff_role: null,
          expires_at: "2026-10-14T12:00:00Z",
          // 01:30 UTC on the 8th is still the 7th in Paramaribo (UTC-3).
          last_sent_at: "2026-10-08T01:30:00Z",
          send_count: 2,
        },
      ],
      customers: [{ id: ALICE, full_name: "Alice Jansen", customer_code: "GR00042" }],
    });
    const result = await onInvitationSent({
      db,
      invitationId: "inv-1",
      kind: "customer",
      email: "alice@example.com",
      customerId: ALICE,
      token: TOKEN,
      resend: true,
      userId: "staff-1",
    });
    // Not configured: logged as skipped, and the dialog says so.
    expect(result).toEqual({ email: "skipped" });
    const mail = sent.calls[0]!;
    expect(mail).toMatchObject({
      kind: "invitation",
      to: "alice@example.com",
      idempotencyKey: "invite:inv-1:2:2026-10-07",
      customerId: ALICE,
    });
    expect(mail.html).toContain(`href="${APP}/invite/${TOKEN}"`);
    expect(mail.text).toContain("GR00042");
    expect(mail.text).toContain("geldig tot 14-10-2026");
    expect(mail.text).toContain("Eerder ontvangen links werken niet meer.");
  });

  it("a staff invitation greets by the name staff typed and names the role", async () => {
    const db = fakeDb({
      company_settings: company,
      invitations: [
        {
          id: "inv-2",
          kind: "staff",
          email: "maria@grsolutions.sr",
          customer_id: null,
          staff_role: "staff",
          expires_at: "2026-10-14T12:00:00Z",
          last_sent_at: "2026-10-07T12:00:00Z",
          send_count: 1,
        },
      ],
    });
    await onInvitationSent({
      db,
      invitationId: "inv-2",
      kind: "staff",
      email: "maria@grsolutions.sr",
      customerId: null,
      fullName: "Maria Pinas",
      token: TOKEN,
      resend: false,
      userId: "admin-1",
    });
    const mail = sent.calls[0]!;
    expect(mail.subject).toBe("Uitnodiging voor het team van G&R Activate");
    expect(mail.text).toContain("Beste Maria,");
    expect(mail.text).toContain("als medewerker");
    expect(mail.idempotencyKey).toBe("invite:inv-2:1:2026-10-07");
  });
});

describe('onInvitationRedeemed ("welkom")', () => {
  it("a customer gets the GR code and the personal US address, once per invitation", async () => {
    const admin = fakeDb({
      company_settings: company,
      customers: [{ id: ALICE, full_name: "Alice Jansen", customer_code: "GR00042" }],
      warehouse_addresses: [
        {
          id: "w1",
          label: "Miami",
          service_type: "air",
          recipient_name_template: "{FULL_NAME} {GR_CODE}",
          address_line1: "8000 NW 25th St",
          address_line2_template: "Suite {GR_CODE}",
          city: "Doral",
          state: "FL",
          zip: "33122",
          country: "USA",
          phone: null,
          is_active: true,
        },
        {
          id: "w2",
          label: "Oud",
          service_type: "sea",
          recipient_name_template: "{FULL_NAME}",
          address_line1: "x",
          address_line2_template: "",
          city: "y",
          state: "",
          zip: "",
          country: "USA",
          phone: null,
          is_active: false,
        },
      ],
    });
    await onInvitationRedeemed({
      admin,
      invitationId: "inv-1",
      kind: "customer",
      email: "alice@example.com",
      customerId: ALICE,
      userId: "u-alice",
    });
    const mail = sent.calls[0]!;
    expect(mail).toMatchObject({
      kind: "welcome",
      to: "alice@example.com",
      idempotencyKey: "invite:inv-1:welcome",
      customerId: ALICE,
      subject: "Welkom bij G&R SOLUTIONS N.V.",
    });
    expect(mail.text).toContain("Miami (Luchtvracht)");
    expect(mail.text).toContain(
      "Alice Jansen GR00042\n8000 NW 25th St\nSuite GR00042\nDoral, FL 33122\nUSA",
    );
    expect(mail.text).not.toContain("Oud");
    expect(mail.text).toContain(
      "Zet altijd uw klantcode GR00042 achter uw naam én op adresregel 2.",
    );
    expect(mail.html).toContain(`href="${APP}/portal"`);
  });

  it("without an active US address the e-mail says it follows in the portal", async () => {
    await onInvitationRedeemed({
      admin: fakeDb({
        company_settings: company,
        customers: [{ id: ALICE, full_name: "Alice Jansen", customer_code: "GR00042" }],
        warehouse_addresses: [],
      }),
      invitationId: "inv-1",
      kind: "customer",
      email: "alice@example.com",
      customerId: ALICE,
      userId: "u-alice",
    });
    expect(sent.calls[0]!.text).toContain(
      "Ons US-adres wordt binnenkort in het klantportaal getoond.",
    );
  });

  it("staff get a short welcome with the link to /admin", async () => {
    await onInvitationRedeemed({
      admin: fakeDb({
        company_settings: company,
        profiles: [{ id: "u-maria", display_name: "Maria Pinas" }],
      }),
      invitationId: "inv-2",
      kind: "staff",
      email: "maria@grsolutions.sr",
      customerId: null,
      userId: "u-maria",
    });
    const mail = sent.calls[0]!;
    expect(mail.subject).toBe("Uw account voor G&R Activate is actief");
    expect(mail.text).toContain("Beste Maria,");
    expect(mail.html).toContain(`href="${APP}/admin"`);
    expect(mail.text).not.toContain("US-verzendadres");
  });
});
