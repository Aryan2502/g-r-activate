import { describe, expect, it } from "vitest";

import {
  addDays,
  daysBetween,
  manualReminderKind,
  nextReminder,
  remindedOn,
  reminderDue,
  type ReminderInvoice,
  type ReminderSettings,
} from "./reminders";

/** SPEC §35.12 windows, with the seeded settings: 2 days before, every 7 days, at most 3. */
const SETTINGS: ReminderSettings = { dueSoonDays: 2, intervalDays: 7, maxOverdueReminders: 3 };

const invoice = (extra: Partial<ReminderInvoice> = {}): ReminderInvoice => ({
  status: "open",
  dueDate: "2026-10-10",
  balanceDue: 45,
  reminderCount: 0,
  lastReminderSentAt: null,
  dueSoonSent: false,
  ...extra,
});

describe("addDays / daysBetween", () => {
  it("works on calendar dates across months and years", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-01", "2026-10-08")).toBe(7);
    expect(daysBetween("2026-10-08", "2026-10-01")).toBe(-7);
  });
});

describe("reminderDue(): before the due date (due_soon)", () => {
  it("due_date − due_soon_days ≤ today < due_date, once", () => {
    expect(reminderDue(invoice(), SETTINGS, "2026-10-07")).toBeNull();
    expect(reminderDue(invoice(), SETTINGS, "2026-10-08")).toEqual({
      kind: "payment_reminder_due_soon",
      seq: 1,
    });
    // A missed day is caught up while still before the due date.
    expect(reminderDue(invoice(), SETTINGS, "2026-10-09")).toEqual({
      kind: "payment_reminder_due_soon",
      seq: 1,
    });
    expect(reminderDue(invoice({ dueSoonSent: true }), SETTINGS, "2026-10-09")).toBeNull();
  });

  it("nothing on the due date itself (not overdue yet), nothing with due_soon_days 0", () => {
    expect(reminderDue(invoice(), SETTINGS, "2026-10-10")).toBeNull();
    expect(reminderDue(invoice(), { ...SETTINGS, dueSoonDays: 0 }, "2026-10-09")).toBeNull();
  });
});

describe("reminderDue(): after the due date (overdue, repeat)", () => {
  it("the first overdue reminder the day after the due date while reminder_count = 0", () => {
    expect(reminderDue(invoice(), SETTINGS, "2026-10-11")).toEqual({
      kind: "payment_reminder_overdue",
      seq: 1,
    });
    // Also weeks later if the job never ran (windows, not exact days).
    expect(reminderDue(invoice(), SETTINGS, "2026-11-30")).toEqual({
      kind: "payment_reminder_overdue",
      seq: 1,
    });
  });

  it("repeats when today ≥ last_reminder_sent_at (Suriname date) + interval, while count < max", () => {
    // Sent 2026-10-11 at 23:30 Suriname = 2026-10-12T02:30Z: its date is the 11th.
    const after1 = invoice({ reminderCount: 1, lastReminderSentAt: "2026-10-12T02:30:00Z" });
    expect(reminderDue(after1, SETTINGS, "2026-10-17")).toBeNull();
    expect(reminderDue(after1, SETTINGS, "2026-10-18")).toEqual({
      kind: "payment_reminder_overdue",
      seq: 2,
    });
    const after3 = invoice({ reminderCount: 3, lastReminderSentAt: "2026-10-25T12:00:00Z" });
    expect(reminderDue(after3, SETTINGS, "2026-12-01")).toBeNull();
  });

  it("max_overdue_reminders 0 = no reminders after the due date at all", () => {
    expect(
      reminderDue(invoice(), { ...SETTINGS, maxOverdueReminders: 0 }, "2026-10-11"),
    ).toBeNull();
  });

  it("only open or partly paid invoices with a balance", () => {
    for (const status of ["draft", "paid", "cancelled"] as const) {
      expect(reminderDue(invoice({ status }), SETTINGS, "2026-10-11"), status).toBeNull();
    }
    expect(reminderDue(invoice({ balanceDue: 0 }), SETTINGS, "2026-10-11")).toBeNull();
    expect(reminderDue(invoice({ status: "partially_paid" }), SETTINGS, "2026-10-11")).toEqual({
      kind: "payment_reminder_overdue",
      seq: 1,
    });
  });
});

describe("manualReminderKind()", () => {
  it("overdue wording after the due date, the friendly one before; none when nothing is owed", () => {
    expect(manualReminderKind(invoice(), "2026-10-11")).toBe("payment_reminder_overdue");
    expect(manualReminderKind(invoice(), "2026-10-10")).toBe("payment_reminder_due_soon");
    expect(manualReminderKind(invoice(), "2026-10-01")).toBe("payment_reminder_due_soon");
    expect(manualReminderKind(invoice({ status: "paid" }), "2026-10-11")).toBeNull();
  });
});

describe("nextReminder() (the overview on /admin/herinneringen)", () => {
  it("today when due, else the day the next window opens", () => {
    expect(nextReminder(invoice(), SETTINGS, "2026-10-01")).toEqual({
      kind: "payment_reminder_due_soon",
      seq: 1,
      date: "2026-10-08",
    });
    expect(nextReminder(invoice(), SETTINGS, "2026-10-08")).toEqual({
      kind: "payment_reminder_due_soon",
      seq: 1,
      date: "2026-10-08",
    });
    expect(nextReminder(invoice({ dueSoonSent: true }), SETTINGS, "2026-10-09")).toEqual({
      kind: "payment_reminder_overdue",
      seq: 1,
      date: "2026-10-11",
    });
    expect(
      nextReminder(
        invoice({ reminderCount: 1, lastReminderSentAt: "2026-10-11T12:00:00Z" }),
        SETTINGS,
        "2026-10-12",
      ),
    ).toEqual({ kind: "payment_reminder_overdue", seq: 2, date: "2026-10-18" });
    expect(
      nextReminder(
        invoice({ reminderCount: 3, lastReminderSentAt: "2026-10-25T12:00:00Z" }),
        SETTINGS,
        "2026-10-30",
      ),
    ).toEqual({ kind: "max_reached" });
  });

  it("nothing planned when the settings turn reminders off or nothing is owed", () => {
    const off = { dueSoonDays: 0, intervalDays: 7, maxOverdueReminders: 0 };
    expect(nextReminder(invoice(), off, "2026-10-01")).toBeNull();
    expect(nextReminder(invoice({ status: "paid" }), SETTINGS, "2026-10-01")).toBeNull();
  });
});

describe("remindedOn(): one reminder per invoice per Suriname day, by any route", () => {
  const TODAY = "2026-10-07";
  const log = (extra: Partial<Parameters<typeof remindedOn>[1][number]>) => ({
    kind: "payment_reminder_overdue",
    status: "sent",
    created_at: "2026-10-07T12:00:00Z",
    updated_at: "2026-10-07T12:00:01Z",
    sent_at: "2026-10-07T12:00:01Z",
    ...extra,
  });

  it("a booked overdue reminder today (09:00 Suriname = 12:00 UTC)", () => {
    expect(remindedOn(TODAY, [], "2026-10-07T12:00:01Z")).toBe(true);
    // 23:59 on the 6th in Suriname is 02:59 UTC on the 7th: yesterday.
    expect(remindedOn(TODAY, [], "2026-10-07T02:59:00Z")).toBe(false);
  });

  it("any reminder log sent today or being sent; not failed, skipped or other kinds", () => {
    expect(remindedOn(TODAY, [log({})], null)).toBe(true);
    expect(remindedOn(TODAY, [log({ kind: "payment_reminder_due_soon" })], null)).toBe(true);
    expect(remindedOn(TODAY, [log({ status: "queued", sent_at: null })], null)).toBe(true);
    // A failed row of yesterday re-claimed today is 'queued' with today's updated_at.
    expect(
      remindedOn(
        TODAY,
        [log({ status: "queued", created_at: "2026-10-06T12:00:00Z", sent_at: null })],
        null,
      ),
    ).toBe(true);
    expect(remindedOn(TODAY, [log({ status: "failed", sent_at: null })], null)).toBe(false);
    expect(remindedOn(TODAY, [log({ status: "skipped_no_provider", sent_at: null })], null)).toBe(
      false,
    );
    expect(remindedOn(TODAY, [log({ kind: "invoice_issued" })], null)).toBe(false);
    expect(
      remindedOn(
        TODAY,
        [log({ sent_at: "2026-10-06T12:00:00Z", created_at: "2026-10-06T12:00:00Z" })],
        null,
      ),
    ).toBe(false);
  });
});
