import { describe, expect, it } from "vitest";

import {
  firstStatusChange,
  invitationEmailKey,
  invoiceEmailKey,
  manualReminderKey,
  orderConfirmationKey,
  orderStatusEmailKey,
  welcomeEmailKey,
} from "./keys";

const ID = "6f1c0d2e-8a4b-4c3d-9e5f-0a1b2c3d4e5f";

describe("e-mail idempotency keys (SPEC §35.12)", () => {
  it("invoice:<id>:<kind>:<seq>", () => {
    expect(invoiceEmailKey(ID, "invoice_issued", 1)).toBe(`invoice:${ID}:invoice_issued:1`);
    expect(invoiceEmailKey(ID, "payment_reminder_overdue", 3)).toBe(
      `invoice:${ID}:payment_reminder_overdue:3`,
    );
    expect(manualReminderKey(ID, "payment_reminder_overdue", "2026-10-07")).toBe(
      `invoice:${ID}:payment_reminder_overdue:manual-2026-10-07`,
    );
  });

  it("order:<id>:status:<history_id> of the first change; one key per action", () => {
    const a = "a0000000-0000-4000-8000-000000000001";
    const b = "a0000000-0000-4000-8000-000000000002";
    expect(orderStatusEmailKey([b, a], [41, 40])).toBe(`order:${a}:status:40`);
    expect(firstStatusChange([b, a], [41, 40])).toEqual({ orderId: a, historyId: 40 });
    // The same orders in a later action have new history rows: a new key.
    expect(orderStatusEmailKey([b, a], [51, 50])).not.toBe(orderStatusEmailKey([b, a], [41, 40]));
    expect(() => orderStatusEmailKey([a], [])).toThrow();
    expect(orderConfirmationKey(a)).toBe(`order:${a}:order_confirmation:1`);
  });

  it("invite:<id>:<send_count>:<day>: a resend on another day never reuses a key", () => {
    // send_count restarts at 1 on every Suriname day (invitations_guard).
    const monday = invitationEmailKey(ID, 1, "2026-10-05T15:00:00Z");
    const tuesday = invitationEmailKey(ID, 1, "2026-10-06T15:00:00Z");
    expect(monday).toBe(`invite:${ID}:1:2026-10-05`);
    expect(tuesday).not.toBe(monday);
    // 02:00 UTC is still the previous day in Paramaribo (UTC−3).
    expect(invitationEmailKey(ID, 2, "2026-10-06T02:00:00Z")).toBe(`invite:${ID}:2:2026-10-05`);
    expect(welcomeEmailKey(ID)).toBe(`invite:${ID}:welcome`);
  });

  it("every key fits email_logs (≤ 200 characters)", () => {
    expect(manualReminderKey(ID, "payment_reminder_due_soon", "2026-10-07").length).toBeLessThan(
      200,
    );
  });
});
