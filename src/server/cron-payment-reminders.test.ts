import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ reminders: 0, cleanup: 0, fail: false }));
vi.mock("@/server/reminders", () => ({
  runPaymentReminders: vi.fn(async (opts: { trigger: string }) => {
    calls.reminders += 1;
    if (calls.fail) throw new Error("Server configuration: SUPABASE_SERVICE_ROLE_KEY is not set.");
    expect(opts).toEqual({ trigger: "cron" });
    return {
      runId: "r1",
      status: "succeeded",
      stats: { checked: 2, sent: 1, skipped: 0, failed: 0, duplicate: 0, no_address: 1 },
      error: null,
    };
  }),
}));
vi.mock("@/server/admin-client", () => ({ loadStorageAdmin: async () => ({}) }));
vi.mock("@/server/storage-cleanup", () => ({
  cleanupOrphanUploads: vi.fn(async () => {
    calls.cleanup += 1;
    return { status: "succeeded", stats: { found: 0, removed: 0, failed: 0 }, error: null };
  }),
}));

import { authorizeCron } from "./cron-secret";
import { handlePaymentRemindersCron } from "./cron-payment-reminders";

const SECRET = "s".repeat(48);
const request = (
  authorization?: string,
  url = "https://portal.example.com/api/cron/payment-reminders",
) => new Request(url, { method: "POST", headers: authorization ? { authorization } : {} });

beforeEach(() => {
  calls.reminders = 0;
  calls.cleanup = 0;
  calls.fail = false;
  vi.stubEnv("CRON_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authorizeCron() (SPEC §35.12)", () => {
  it("accepts exactly 'Bearer <CRON_SECRET>'", async () => {
    expect(await authorizeCron(`Bearer ${SECRET}`)).toEqual({ ok: true });
  });

  it("401 on a wrong, missing, prefixed or differently cased token", async () => {
    for (const header of [
      null,
      "",
      "Bearer ",
      `Bearer ${SECRET}x`,
      `Bearer ${SECRET.slice(1)}`,
      `bearer${SECRET}`,
      SECRET,
      `Basic ${SECRET}`,
      `Bearer ${SECRET.toUpperCase()}`,
      `Bearer ${SECRET}, Bearer other`,
    ]) {
      expect(await authorizeCron(header), String(header)).toEqual({ ok: false, status: 401 });
    }
  });

  it("500 while CRON_SECRET is not set or too short (never 'open')", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(await authorizeCron("Bearer ")).toEqual({ ok: false, status: 500 });
    expect(await authorizeCron(`Bearer ${SECRET}`)).toEqual({ ok: false, status: 500 });
    vi.stubEnv("CRON_SECRET", "kort");
    expect(await authorizeCron("Bearer kort")).toEqual({ ok: false, status: 500 });
  });
});

describe("/api/cron/payment-reminders", () => {
  it("runs the reminders and the clean-up after the check, answering counts only", async () => {
    const response = await handlePaymentRemindersCron(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      reminders: {
        status: "succeeded",
        stats: { checked: 2, sent: 1, skipped: 0, failed: 0, duplicate: 0, no_address: 1 },
      },
      cleanup: { status: "succeeded", stats: { found: 0, removed: 0, failed: 0 } },
    });
    expect(calls).toMatchObject({ reminders: 1, cleanup: 1 });
  });

  it("does nothing on 401 or 500", async () => {
    expect((await handlePaymentRemindersCron(request())).status).toBe(401);
    expect((await handlePaymentRemindersCron(request("Bearer nope"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    const unset = await handlePaymentRemindersCron(request(`Bearer ${SECRET}`));
    expect(unset.status).toBe(500);
    expect(await unset.json()).toEqual({ ok: false, error: "cron_secret_not_configured" });
    expect(calls).toMatchObject({ reminders: 0, cleanup: 0 });
  });

  it("ignores the query string and body: no parameter changes what runs", async () => {
    const response = await handlePaymentRemindersCron(
      request(
        `Bearer ${SECRET}`,
        "https://portal.example.com/api/cron/payment-reminders?trigger=manual&today=2020-01-01",
      ),
    );
    expect(response.status).toBe(200);
  });

  it("500 when the run cannot start (e.g. no service-role key)", async () => {
    calls.fail = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handlePaymentRemindersCron(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "reminders_not_started" });
    error.mockRestore();
  });
});
