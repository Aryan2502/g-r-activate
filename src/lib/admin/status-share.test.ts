import { describe, expect, it } from "vitest";

import { needsFollowUp, statusShareText } from "./status-share";

const base = {
  customerName: "Maria Pinas",
  orders: [{ id: "o1", reference: "ORD-2026-00012" }],
  status: {
    label: "Klaar voor afhalen",
    description: "Uw pakket ligt klaar.",
    stage: "ready_for_pickup",
  },
  message: null,
  pickup: { address: "Kwattaweg #22", hours: "ma–vr 9–17", instructions: null },
  portalBase: null,
  companyName: "G&R SOLUTIONS N.V.",
};

describe("statusShareText()", () => {
  it("one order, ready for pickup, no login", () => {
    expect(statusShareText(base)).toBe(
      [
        "Beste Maria,",
        "",
        "De status van uw order ORD-2026-00012 is gewijzigd naar: Klaar voor afhalen.",
        "Uw pakket ligt klaar.",
        "",
        "Afhalen:",
        "Adres: Kwattaweg #22",
        "Openingstijden: ma–vr 9–17",
        "",
        "Met vriendelijke groet,",
        "G&R SOLUTIONS N.V.",
      ].join("\n"),
    );
  });

  it("several orders, an action message and the portal link for a login", () => {
    const text = statusShareText({
      ...base,
      customerName: null,
      orders: [
        { id: "o1", reference: "ORD-2026-00012" },
        { id: "o2", reference: "ORD-2026-00013" },
      ],
      status: { label: "Actie vereist", description: null, stage: "action_required" },
      message: "Upload de factuur.",
      portalBase: "https://portal.example.com/",
    });
    expect(text).toContain("Goedendag,");
    expect(text).toContain("uw orders ORD-2026-00012, ORD-2026-00013");
    expect(text).toContain("Wat wij van u nodig hebben: Upload de factuur.");
    expect(text).not.toContain("Afhalen:");
    expect(text).toContain(
      "Bekijk uw orders in het klantportaal: https://portal.example.com/portal/orders",
    );
  });

  it("one order with a login links to that order", () => {
    expect(statusShareText({ ...base, portalBase: "https://p.example.com" })).toContain(
      "Bekijk uw order in het klantportaal: https://p.example.com/portal/orders/o1",
    );
  });

  it("only e-mails that did not go out need a follow-up", () => {
    expect(
      ["sent", "duplicate", "skipped", "failed", "no_address"].filter((o) =>
        needsFollowUp(o as never),
      ),
    ).toEqual(["skipped", "failed", "no_address"]);
  });
});
