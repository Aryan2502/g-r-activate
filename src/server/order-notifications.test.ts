import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb } from "@/test/fake-supabase";

import type { SendEmailInput, SendEmailResult } from "./email";

const sent = vi.hoisted(() => ({
  calls: [] as SendEmailInput[],
  next: null as null | ((input: SendEmailInput) => SendEmailResult | Promise<SendEmailResult>),
}));
vi.mock("@/server/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./email")>()),
  sendEmail: vi.fn(async (input: SendEmailInput) => {
    sent.calls.push(input);
    return sent.next
      ? sent.next(input)
      : { status: "sent", logId: "l1", providerMessageId: "re_1" };
  }),
}));

// pause() between provider calls: no real waiting in tests.
vi.mock("@/server/notification-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./notification-data")>()),
  pause: async () => {},
}));

const { onOrderRegistered, onOrderStatusChanged, statusFollowUps } =
  await import("./order-notifications");

const APP = "https://portal.example.com";
const ALICE = "c0000000-0000-4000-8000-000000000001";
const BOB = "c0000000-0000-4000-8000-000000000002";
const CAROL = "c0000000-0000-4000-8000-000000000003";
const O1 = "a0000000-0000-4000-8000-000000000001";
const O2 = "a0000000-0000-4000-8000-000000000002";
const O3 = "a0000000-0000-4000-8000-000000000003";

function tables() {
  return {
    company_settings: [
      {
        company_name: "G&R SOLUTIONS N.V.",
        tagline: "CUSTOMS BROKERAGE & LOGISTICS",
        email: "info@grsolutions.sr",
        phone: "5978897500",
        address: "kwattaweg #22",
        pickup_address: "Kwattaweg #22, Paramaribo",
        pickup_hours: "ma–vr 9:00–17:00",
        pickup_instructions: "Neem een geldig legitimatiebewijs en uw klantcode mee",
      },
    ],
    customers: [
      {
        id: ALICE,
        full_name: "Alice <b>Jansen</b>",
        customer_code: "GR00042",
        email: "alice@example.com",
        phone: "8000001",
        user_id: "u-alice",
        status: "active",
      },
      {
        id: BOB,
        full_name: "Bob Bakker",
        customer_code: "GR00017",
        email: "bob@example.com",
        phone: null,
        user_id: null,
        status: "invited",
      },
      {
        id: CAROL,
        full_name: "Carol Zonder Mail",
        customer_code: "GR00018",
        email: null,
        phone: "8000003",
        user_id: null,
        status: "active",
      },
    ],
    invitations: [
      {
        id: "i1",
        customer_id: BOB,
        accepted_at: null,
        revoked_at: null,
        expires_at: "2999-01-01T00:00:00Z",
      },
    ],
    orders: [
      {
        id: O1,
        customer_id: ALICE,
        reference: "ORD-2026-00012",
        order_type: "personal",
        service_type: "air",
        store_vendor: "Amazon",
        vendor_order_number: "112-334",
        description: "Schoenen",
        tracking_number: "1Z999",
        carrier: "UPS",
        declared_weight_lbs: 3.5,
        expected_delivery_date: "2026-10-20",
        parent_order_id: null,
      },
      {
        id: O2,
        customer_id: ALICE,
        reference: "ORD-2026-00013",
        order_type: "b2b",
        service_type: "air",
        store_vendor: "Shein",
        vendor_order_number: null,
        description: null,
        tracking_number: null,
        carrier: null,
        declared_weight_lbs: null,
        expected_delivery_date: null,
        parent_order_id: O1,
      },
      {
        id: O3,
        customer_id: BOB,
        reference: "ORD-2026-00014",
        order_type: "personal",
        service_type: "sea",
        store_vendor: "eBay",
        vendor_order_number: null,
        description: "Onderdelen",
        tracking_number: "TBA1",
        carrier: null,
        declared_weight_lbs: null,
        expected_delivery_date: null,
        parent_order_id: null,
      },
    ],
    shipment_statuses: [
      {
        code: "ready_for_pickup",
        label_nl: "Klaar voor afhalen",
        customer_description_nl: "Uw pakket ligt klaar bij G&R.",
        stage: "ready_for_pickup",
      },
      {
        code: "action_required",
        label_nl: "Actie vereist – documenten nodig",
        customer_description_nl: null,
        stage: "action_required",
      },
    ],
  };
}

beforeEach(() => {
  sent.calls = [];
  sent.next = null;
  vi.stubEnv("APP_URL", APP);
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "G&R <noreply@example.com>");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('onOrderRegistered ("order bevestigd")', () => {
  it("e-mails the customer once per order, with the details and a portal link (login)", async () => {
    const db = fakeDb(tables());
    const result = await onOrderRegistered({
      db,
      orderId: O1,
      reference: "ORD-2026-00012",
      customerId: ALICE,
      parentOrderId: null,
      userId: "u-alice",
      createdBy: "customer",
    });
    expect(result).toEqual({ email: "sent" });
    expect(sent.calls).toHaveLength(1);
    const mail = sent.calls[0]!;
    expect(mail).toMatchObject({
      kind: "order_confirmation",
      to: "alice@example.com",
      idempotencyKey: `order:${O1}:order_confirmation:1`,
      customerId: ALICE,
      orderId: O1,
      replyTo: "info@grsolutions.sr",
      subject: "Order ORD-2026-00012 is aangemeld",
    });
    expect(mail.html).toContain(`href="${APP}/portal/orders/${O1}"`);
    expect(mail.html).toContain(`src="${APP}/brand/gr-logo-banner.jpg"`);
    // Customer text is escaped, never markup.
    expect(mail.html).toContain("Beste Alice,");
    expect(mail.html).not.toContain("<b>Jansen</b>");
    expect(mail.html).toContain("Amazon");
    expect(mail.html).toContain("3,50 lbs");
    expect(mail.text).toContain(`${APP}/portal/orders/${O1}`);
    expect(mail.text).toContain("Trackingnummer: 1Z999");
  });

  it("names the parent order of an extra package", async () => {
    await onOrderRegistered({
      db: fakeDb(tables()),
      orderId: O2,
      reference: "ORD-2026-00013",
      customerId: ALICE,
      parentOrderId: O1,
      userId: "staff-1",
      createdBy: "staff",
    });
    expect(sent.calls[0]!.text).toContain("Extra pakket bij: ORD-2026-00012");
    expect(sent.calls[0]!.text).toContain(
      "G&R SOLUTIONS N.V. heeft order ORD-2026-00013 voor u aangemaakt",
    );
  });

  it("a customer without a login gets the details and the invitation note, never a /portal link", async () => {
    await onOrderRegistered({
      db: fakeDb(tables()),
      orderId: O3,
      reference: "ORD-2026-00014",
      customerId: BOB,
      parentOrderId: null,
      userId: "staff-1",
      createdBy: "staff",
    });
    const mail = sent.calls[0]!;
    expect(mail.html).not.toContain(`${APP}/portal`);
    expect(mail.text).not.toContain(`${APP}/portal`);
    expect(mail.text).toContain("Er staat een uitnodiging voor u klaar");
    expect(mail.text).toContain("Onderdelen");
  });

  it("no e-mail address: nothing is sent ('no_address')", async () => {
    const t = tables();
    t.orders.push({ ...t.orders[2]!, id: "o-carol", customer_id: CAROL });
    expect(
      await onOrderRegistered({
        db: fakeDb(t),
        orderId: "o-carol",
        reference: "ORD-2026-00015",
        customerId: CAROL,
        parentOrderId: null,
        userId: "staff-1",
        createdBy: "staff",
      }),
    ).toEqual({ email: "no_address" });
    expect(sent.calls).toHaveLength(0);
  });

  it("without APP_URL (and no Vercel domain) nothing is rendered: skipped or failed", async () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    const event = {
      db: fakeDb(tables()),
      orderId: O1,
      reference: "ORD-2026-00012",
      customerId: ALICE,
      parentOrderId: null,
      userId: "u-alice",
      createdBy: "customer" as const,
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await onOrderRegistered(event)).toEqual({ email: "failed" });
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await onOrderRegistered(event)).toEqual({ email: "skipped" });
    expect(sent.calls).toHaveLength(0);
    error.mockRestore();
  });

  it("reports what sendEmail did: skipped without provider, duplicate on a repeat", async () => {
    const event = {
      db: fakeDb(tables()),
      orderId: O1,
      reference: "ORD-2026-00012",
      customerId: ALICE,
      parentOrderId: null,
      userId: "u-alice",
      createdBy: "customer" as const,
    };
    sent.next = () => ({ status: "skipped_no_provider", logId: "l1" });
    expect(await onOrderRegistered(event)).toEqual({ email: "skipped" });
    sent.next = () => ({ status: "duplicate", logId: "l1", previous: "sent" });
    expect(await onOrderRegistered(event)).toEqual({ email: "duplicate" });
    sent.next = () => ({ status: "failed", logId: "l1", error: "Resend 500" });
    expect(await onOrderRegistered(event)).toEqual({ email: "failed" });
  });
});

describe('onOrderStatusChanged ("statusupdate")', () => {
  it("one e-mail per customer listing their changed orders, keyed by the first history row", async () => {
    const result = await onOrderStatusChanged({
      db: fakeDb(tables()),
      action: "status",
      toStatus: "ready_for_pickup",
      customerMessage: "Tot morgen! <script>alert(1)</script>",
      emails: [
        { customerId: ALICE, orderIds: [O2, O1], historyIds: [77, 76] },
        { customerId: BOB, orderIds: [O3], historyIds: [78] },
        { customerId: CAROL, orderIds: ["o-x"], historyIds: [79] },
      ],
      userId: "staff-1",
    });
    expect(result).toEqual({ emails: ["sent", "sent", "no_address"] });
    expect(sent.calls.map((c) => [c.to, c.idempotencyKey, c.orderId, c.kind])).toEqual([
      ["alice@example.com", `order:${O1}:status:76`, O1, "status_update"],
      ["bob@example.com", `order:${O3}:status:78`, O3, "status_update"],
    ]);
    const alice = sent.calls[0]!;
    expect(alice.subject).toBe("2 orders: Klaar voor afhalen");
    expect(alice.html).toContain("ORD-2026-00012");
    expect(alice.html).toContain("ORD-2026-00013");
    expect(alice.html).toContain("Uw pakket ligt klaar bij G&amp;R.");
    expect(alice.html).toContain("Kwattaweg #22, Paramaribo");
    expect(alice.html).toContain("ma–vr 9:00–17:00");
    expect(alice.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(alice.html).not.toContain("<script>");
    expect(alice.html).toContain(`href="${APP}/portal/orders"`);
    const bob = sent.calls[1]!;
    expect(bob.subject).toBe("Order ORD-2026-00014: Klaar voor afhalen");
    expect(bob.html).not.toContain(`${APP}/portal`);
  });

  it("'Actie vereist' asks for the documents: in the portal, or by reply without a login", async () => {
    await onOrderStatusChanged({
      db: fakeDb(tables()),
      action: "status",
      toStatus: "action_required",
      customerMessage: "Upload de commerciële factuur.",
      emails: [
        { customerId: ALICE, orderIds: [O1], historyIds: [90] },
        { customerId: BOB, orderIds: [O3], historyIds: [91] },
      ],
      userId: "staff-1",
    });
    expect(sent.calls[0]!.text).toContain("Wat wij van u nodig hebben");
    expect(sent.calls[0]!.text).toContain(
      "Upload de gevraagde documenten bij de order in het klantportaal.",
    );
    expect(sent.calls[1]!.text).toContain(
      "Stuur de gevraagde documenten als antwoord op deze e-mail.",
    );
  });

  it("one failing e-mail does not stop the others", async () => {
    let n = 0;
    sent.next = () => {
      n += 1;
      if (n === 1) throw new Error("boom");
      return { status: "sent", logId: "l2", providerMessageId: "re_2" };
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await onOrderStatusChanged({
      db: fakeDb(tables()),
      action: "pickup",
      toStatus: "ready_for_pickup",
      customerMessage: null,
      emails: [
        { customerId: ALICE, orderIds: [O1], historyIds: [1] },
        { customerId: BOB, orderIds: [O3], historyIds: [2] },
      ],
      userId: "staff-1",
    });
    expect(result).toEqual({ emails: ["failed", "sent"] });
    error.mockRestore();
  });

  it("nothing to e-mail: no queries, no sends", async () => {
    const db = fakeDb(tables());
    expect(
      await onOrderStatusChanged({
        db,
        action: "status",
        toStatus: "ready_for_pickup",
        customerMessage: null,
        emails: [],
        userId: "staff-1",
      }),
    ).toEqual({ emails: [] });
    expect(db.queries).toEqual([]);
  });
});

describe("statusFollowUps (WhatsApp when the statusupdate did not go out)", () => {
  const event = (db: ReturnType<typeof fakeDb>) => ({
    db,
    action: "status" as const,
    toStatus: "ready_for_pickup",
    customerMessage: "Tot morgen!",
    emails: [
      { customerId: ALICE, orderIds: [O1, O2], historyIds: [1, 2] },
      { customerId: BOB, orderIds: [O3], historyIds: [3] },
      { customerId: CAROL, orderIds: [O3], historyIds: [4] },
    ],
    userId: "staff-1",
  });

  it("one message per customer whose e-mail was skipped, failed or had no address", async () => {
    const list = await statusFollowUps(
      event(fakeDb(tables())),
      ["skipped", "sent", "no_address"],
      "https://portal.example.com",
    );
    expect(list.map((f) => [f.customerId, f.reason, f.references, f.phone])).toEqual([
      [ALICE, "skipped", ["ORD-2026-00012", "ORD-2026-00013"], "8000001"],
      [CAROL, "no_address", ["ORD-2026-00014"], "8000003"],
    ]);
    const alice = list[0]!.text;
    expect(alice).toContain(
      "De status van uw orders ORD-2026-00012, ORD-2026-00013 is gewijzigd naar: Klaar voor afhalen.",
    );
    expect(alice).toContain("Bericht: Tot morgen!");
    expect(alice).toContain("Adres: Kwattaweg #22, Paramaribo");
    // Alice can log in: the portal link; Carol cannot.
    expect(alice).toContain(
      "Bekijk uw orders in het klantportaal: https://portal.example.com/portal/orders",
    );
    expect(list[1]!.text).not.toContain("/portal");
  });

  it("nothing when every e-mail went out (or was sent before)", async () => {
    const db = fakeDb(tables());
    expect(await statusFollowUps(event(db), ["sent", "duplicate", "sent"], null)).toEqual([]);
    expect(db.queries).toEqual([]);
  });
});
