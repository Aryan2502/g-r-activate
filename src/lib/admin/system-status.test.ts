import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const { setupChecklist } = await import("./system-status");

const filled = (currency: "USD" | "EUR" | "SRD") => ({
  id: currency,
  currency,
  bank_name: "Hakrinbank",
  account_holder: null,
  account_number: "201.234",
  sort_order: 1,
  is_active: true,
});

const system = {
  serviceRoleKey: true,
  appUrl: true,
  appUrlFromVercel: false,
  email: true,
  cronSecret: true,
  lastReminderRun: null,
};

describe("setupChecklist (SPEC §35.8)", () => {
  it("is empty when everything is set up", () => {
    expect(
      setupChecklist({
        bankAccounts: [filled("USD"), filled("EUR"), filled("SRD")],
        warehouseAddresses: [{ is_active: true }],
        serviceRates: [
          { service_type: "air", enabled: true, rate_per_lb: 4.5 },
          { service_type: "sea", enabled: false, rate_per_lb: null },
        ],
        settings: {
          pickup_hours: "Ma–vr 9–17",
          terms_markdown: "# Voorwaarden",
          prohibited_goods_markdown: "- Wapens",
        },
        system,
      }),
    ).toEqual([]);
  });

  it("names what is missing on a fresh project (the seed)", () => {
    const items = setupChecklist({
      bankAccounts: [
        { ...filled("USD"), bank_name: null, account_number: null },
        { ...filled("EUR"), account_number: " " },
        // SRD has no active row at all.
        { ...filled("SRD"), is_active: false },
      ],
      warehouseAddresses: [{ is_active: false }],
      serviceRates: [
        { service_type: "air", enabled: true, rate_per_lb: null },
        { service_type: "sea", enabled: false, rate_per_lb: null },
      ],
      settings: {
        pickup_hours: null,
        terms_markdown: "_Placeholder: de algemene voorwaarden …_",
        prohibited_goods_markdown: "",
      },
      system: { ...system, serviceRoleKey: false, appUrl: false, email: false },
    });
    expect(items.map((i) => i.key)).toEqual([
      "serviceRoleKey",
      "appUrl",
      "bankAccounts",
      "warehouseAddress",
      "serviceRate",
      "pickupHours",
      "termsPlaceholder",
      "prohibitedPlaceholder",
      "email",
    ]);
    expect(items.find((i) => i.key === "bankAccounts")).toMatchObject({
      currencies: ["USD", "EUR", "SRD"],
      section: "bankrekeningen",
    });
    expect(items.find((i) => i.key === "serviceRate")).toMatchObject({ serviceType: "air" });
    expect(items.find((i) => i.key === "appUrl")).toMatchObject({
      tone: "warning",
      fromVercel: false,
    });
  });

  it("never claims something is missing that simply has not loaded, and staff see no server items", () => {
    expect(setupChecklist({})).toEqual([]);
    expect(setupChecklist({ system: null, serviceRates: [] }).map((i) => i.key)).toEqual([
      "noService",
    ]);
    expect(
      setupChecklist({ system: { ...system, appUrl: false, appUrlFromVercel: true } }),
    ).toEqual([{ key: "appUrl", tone: "info", section: null, fromVercel: true }]);
  });
});
