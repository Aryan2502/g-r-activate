import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const { cronSilent, runState, setupChecklist } = await import("./system-status");

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

describe("the daily schedule (P8 review)", () => {
  const NOW = new Date("2026-10-08T15:00:00Z");
  const run = (startedAt: string, trigger: "cron" | "manual" = "cron") => ({
    status: "succeeded" as const,
    trigger,
    startedAt,
    finishedAt: startedAt,
  });

  it("warns when CRON_SECRET is set but no automatic run started in the last 26 hours", () => {
    const fresh = { ...system, lastCronReminderRun: run("2026-10-08T12:00:05Z") };
    expect(cronSilent(fresh, NOW)).toBe(false);
    const stale = { ...system, lastCronReminderRun: run("2026-10-07T12:00:05Z") };
    expect(cronSilent(stale, NOW)).toBe(true);
    // A manual run today does not hide the stopped schedule.
    expect(
      setupChecklist({
        system: { ...stale, lastReminderRun: run("2026-10-08T14:00:00Z", "manual") },
        now: NOW,
      }),
    ).toEqual([{ key: "cronSilent", tone: "warning", section: null, neverRan: false }]);
    expect(setupChecklist({ system: { ...system, lastCronReminderRun: null }, now: NOW })).toEqual([
      { key: "cronSilent", tone: "warning", section: null, neverRan: true },
    ]);
    // Not known (an older server): no claim.
    expect(cronSilent(system, NOW)).toBe(false);
  });

  it("without CRON_SECRET it names that instead", () => {
    expect(
      setupChecklist({ system: { ...system, cronSecret: false, lastCronReminderRun: null } }),
    ).toEqual([{ key: "cronSecret", tone: "warning", section: null }]);
  });

  it("a run still 'running' after 15 minutes is shown as abandoned", () => {
    expect(runState({ status: "running", started_at: "2026-10-08T14:50:00Z" }, NOW)).toBe(
      "running",
    );
    expect(runState({ status: "running", startedAt: "2026-10-08T14:40:00Z" }, NOW)).toBe(
      "abandoned",
    );
    expect(runState({ status: "failed", started_at: "2026-10-01T00:00:00Z" }, NOW)).toBe("failed");
  });
});
