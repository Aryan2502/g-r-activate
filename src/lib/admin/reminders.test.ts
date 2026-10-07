import { describe, expect, it } from "vitest";

import type { PickerCustomer } from "@/lib/admin/orders";

import {
  reminderPortalLink,
  reminderRows,
  reminderShareText,
  runCounts,
  runSummary,
  withoutEmail,
  type EmailLogRow,
  type ReminderInvoiceRow,
  type ReminderOverview,
} from "./reminders";

const TODAY = "2026-10-07";
const SETTINGS = { dueSoonDays: 2, intervalDays: 7, maxOverdueReminders: 3 };

const customer = (id: string, extra: Partial<PickerCustomer> = {}): PickerCustomer => ({
  id,
  customer_code: "GR00042",
  full_name: "Alice Jansen",
  company_name: null,
  account_type: "personal",
  status: "active",
  user_id: null,
  phone: "8000001",
  email: "alice@example.com",
  ...extra,
});

const invoice = (id: string, extra: Partial<ReminderInvoiceRow> = {}): ReminderInvoiceRow => ({
  id,
  invoice_number: `INV-2026-${id}`,
  status: "open",
  customer_id: "c1",
  currency: "USD",
  invoice_date: "2026-09-30",
  due_date: "2026-10-09",
  total_amount: 45,
  amount_paid: 0,
  balance_due: 45,
  is_overdue: false,
  days_overdue: 0,
  reminder_count: 0,
  first_reminder_sent_at: null,
  last_reminder_sent_at: null,
  late_fee_applied_at: null,
  issuer_snapshot: {
    company_name: "G&R SOLUTIONS N.V.",
    bank_accounts: [{ currency: "USD", bank_name: "DSB", account_number: "1234567" }],
  },
  ...extra,
});

const log = (extra: Partial<EmailLogRow>): EmailLogRow => ({
  id: crypto.randomUUID(),
  kind: "payment_reminder_due_soon",
  status: "sent",
  recipient: "alice@example.com",
  invoice_id: "0001",
  order_id: null,
  customer_id: "c1",
  idempotency_key: "invoice:0001:payment_reminder_due_soon:1",
  error: null,
  created_at: "2026-10-07T12:00:00Z",
  updated_at: "2026-10-07T12:00:01Z",
  sent_at: "2026-10-07T12:00:01Z",
  ...extra,
});

describe("reminderRows()", () => {
  it("joins customers, plans the next reminder and knows what went out today", () => {
    const overview: ReminderOverview = {
      settings: SETTINGS,
      invoices: [
        invoice("0001"),
        invoice("0002", { due_date: "2026-10-01", is_overdue: true, days_overdue: 6 }),
      ],
      logs: [
        log({}),
        log({
          invoice_id: "0002",
          kind: "payment_reminder_overdue",
          idempotency_key: `invoice:0002:payment_reminder_overdue:manual-${TODAY}`,
        }),
      ],
    };
    const rows = reminderRows(overview, [customer("c1")], TODAY);
    expect(
      rows.map((r) => [r.invoice.id, r.next, r.manualKind, r.sentToday, r.history.length]),
    ).toEqual([
      // Due on the 9th: the daily run sent the reminder before the due date
      // today (09:00 Suriname) → next is the first overdue one, and the
      // per-invoice button is off for today too (one reminder a day in total).
      [
        "0001",
        { kind: "payment_reminder_overdue", seq: 1, date: "2026-10-10" },
        "payment_reminder_due_soon",
        true,
        1,
      ],
      [
        "0002",
        { kind: "payment_reminder_overdue", seq: 1, date: TODAY },
        "payment_reminder_overdue",
        true,
        1,
      ],
    ]);
    expect(rows[0]!.customer?.id).toBe("c1");
  });

  it("one reminder a day by any route: the daily run's overdue reminder disables the button", () => {
    const overdue = invoice("0003", {
      due_date: "2026-10-04",
      is_overdue: true,
      days_overdue: 3,
      reminder_count: 1,
      first_reminder_sent_at: "2026-10-07T12:00:01Z",
      last_reminder_sent_at: "2026-10-07T12:00:01Z",
    });
    const yesterday = invoice("0004", {
      due_date: "2026-10-01",
      is_overdue: true,
      reminder_count: 1,
      last_reminder_sent_at: "2026-10-07T02:59:00Z", // 23:59 on the 6th in Suriname
    });
    const rows = reminderRows(
      { settings: SETTINGS, invoices: [overdue, yesterday], logs: [] },
      [customer("c1")],
      TODAY,
    );
    expect(rows.map((r) => [r.invoice.id, r.sentToday])).toEqual([
      ["0003", true],
      ["0004", false],
    ]);
    // A queued scheduled reminder (being sent right now) counts as well; a failed one does not.
    const queued = reminderRows(
      {
        settings: SETTINGS,
        invoices: [invoice("0002", { due_date: "2026-10-01", is_overdue: true })],
        logs: [
          log({
            invoice_id: "0002",
            kind: "payment_reminder_overdue",
            status: "queued",
            sent_at: null,
            idempotency_key: "invoice:0002:payment_reminder_overdue:1",
          }),
        ],
      },
      [customer("c1")],
      TODAY,
    );
    expect(queued[0]!.sentToday).toBe(true);
    const failed = reminderRows(
      {
        settings: SETTINGS,
        invoices: [invoice("0002", { due_date: "2026-10-01", is_overdue: true })],
        logs: [
          log({
            invoice_id: "0002",
            kind: "payment_reminder_overdue",
            status: "failed",
            sent_at: null,
          }),
        ],
      },
      [customer("c1")],
      TODAY,
    );
    expect(failed[0]!.sentToday).toBe(false);
  });

  it("knows when every reminder after the due date was sent", () => {
    const rows = reminderRows(
      {
        settings: SETTINGS,
        invoices: [
          invoice("0005", { due_date: "2026-09-01", is_overdue: true, reminder_count: 3 }),
          invoice("0006", { due_date: "2026-09-01", is_overdue: true, reminder_count: 2 }),
        ],
        logs: [],
      },
      [customer("c1")],
      TODAY,
    );
    expect(rows.map((r) => [r.invoice.id, r.maxReached, r.next])).toEqual([
      ["0005", true, { kind: "max_reached" }],
      ["0006", false, { kind: "payment_reminder_overdue", seq: 3, date: TODAY }],
    ]);
  });

  it("a skipped or failed reminder before the due date does not count as sent", () => {
    const rows = reminderRows(
      {
        settings: SETTINGS,
        invoices: [invoice("0001")],
        logs: [log({ status: "skipped_no_provider" })],
      },
      [customer("c1")],
      "2026-10-08",
    );
    expect(rows[0]!.next).toEqual({
      kind: "payment_reminder_due_soon",
      seq: 1,
      date: "2026-10-08",
    });
  });
});

describe("withoutEmail() and the WhatsApp text", () => {
  it("lists customers without an address whose invoice is due now", () => {
    const overview: ReminderOverview = {
      settings: SETTINGS,
      invoices: [
        invoice("0001", {
          customer_id: "c2",
          due_date: "2026-10-01",
          is_overdue: true,
          balance_due: 30.5,
        }),
        invoice("0002", { customer_id: "c2", due_date: "2026-11-01" }),
        invoice("0003", { customer_id: "c1", due_date: "2026-10-01", is_overdue: true }),
      ],
      logs: [],
    };
    const rows = reminderRows(
      overview,
      [
        customer("c1"),
        customer("c2", { email: null, full_name: "Carol Zonder Mail", customer_code: "GR00018" }),
      ],
      TODAY,
    );
    const list = withoutEmail(rows, TODAY);
    expect(list.map((r) => r.invoice.id)).toEqual(["0001"]);
    expect(reminderShareText(list[0]!)).toBe(
      [
        "Beste Carol,",
        "",
        "Volgens onze administratie is factuur INV-2026-0001 nog niet volledig betaald. De vervaldatum was 01-10-2026; er staat nog USD 30,50 open.",
        "Factuurvaluta: USD · Vermeld bij betaling: INV-2026-0001 / GR00018",
        "Rekeningnummer: 1234567 (DSB)",
        "",
        "Met vriendelijke groet, G&R SOLUTIONS N.V.",
      ].join("\n"),
    );
    // No login: no portal link, whatever the base.
    expect(reminderPortalLink(list[0]!, "https://portal.example.com")).toBeNull();
  });

  it("adds the portal link for an active customer with a login", () => {
    const rows = reminderRows(
      {
        settings: SETTINGS,
        invoices: [invoice("0007", { due_date: "2026-10-01", is_overdue: true })],
        logs: [],
      },
      [customer("c1", { user_id: "u1" })],
      TODAY,
    );
    const link = reminderPortalLink(rows[0]!, "https://portal.example.com/");
    expect(link).toBe("https://portal.example.com/portal/facturen/0007");
    expect(reminderPortalLink(rows[0]!, null)).toBeNull();
    expect(reminderShareText(rows[0]!, link)).toContain(
      "Bekijk de factuur in uw klantportaal: https://portal.example.com/portal/facturen/0007",
    );
  });
});

describe("run statistics", () => {
  it("reads job_runs.stats defensively and summarises only what happened", () => {
    expect(runCounts({ sent: 2, skipped: "x", failed: -1 })).toMatchObject({
      sent: 2,
      skipped: 0,
      failed: 0,
    });
    expect(runCounts(null)).toMatchObject({ sent: 0 });
    expect(runSummary({ sent: 2, no_address: 1 })).toBe("2 verstuurd · 1 zonder e-mailadres");
    expect(runSummary({})).toBe("niets te versturen");
  });
});
