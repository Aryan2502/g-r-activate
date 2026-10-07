// @vitest-environment node
/**
 * P8 e-mail and payment reminders against the real migrations (SPEC §19,
 * §35.12). The app's server code runs unchanged with the service-role
 * stand-in (supabase-standin.ts serviceClient: BYPASSRLS and the
 * service_role grants, as supabaseAdmin), and fetch is mocked: nothing
 * reaches Resend.
 *
 * - sendEmail(): the claim is the real unique index of email_logs; a failed
 *   or skipped row is re-claimed; the table's checks (sent ⇔ sent_at) hold.
 * - runPaymentReminders(): the windows on real invoices (invoice_overview),
 *   the reminder columns only after a SENT overdue reminder (the immutability
 *   trigger allows exactly those columns), job_runs rows, idempotent per day,
 *   and a reminder sent but never booked is booked by the next run.
 * - sendInvoiceReminderNow(): at most ONE reminder per invoice per Suriname
 *   day by any route (the daily run, the bulk button, this button); the
 *   scheduled key when the run would send that reminder today anyway; past
 *   the maximum only when confirmed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { serviceClient } from "./supabase-standin";

const current = vi.hoisted(() => ({ admin: null as unknown }));
vi.mock("@/server/admin-client", () => ({
  loadAdminClient: async () => current.admin,
  loadStorageAdmin: async () => current.admin,
}));

import { addDays } from "@/lib/email/reminders";
import { todayInSuriname } from "@/lib/format";
import { sendEmail } from "@/server/email";
import { runPaymentReminders, sendInvoiceReminderNow, type ServiceDb } from "@/server/reminders";

import { type AuthUser, type Db, createAuthUser, createDb } from "./harness";

/** The stand-in implements the subset of the query builder the server code uses. */
const serviceDb = (d: Db) => serviceClient(d) as unknown as ServiceDb;

let db: Db;
let staff: AuthUser;
const TODAY = todayInSuriname();
const APP = "https://portal.example.com";

type Row = Record<string, unknown>;
const rows = async <T = Row>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows;

/** fetch → Resend, mocked: ok with an id, or the status given per call. */
let resend: { calls: { key: string; body: { to: string[]; subject: string; text: string } }[] };
let failNext: number[] = [];
function mockResend() {
  resend = { calls: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      resend.calls.push({
        key: headers["Idempotency-Key"] ?? "",
        body: JSON.parse(String(init.body)) as { to: string[]; subject: string; text: string },
      });
      const status = failNext.shift();
      if (status) {
        return new Response(JSON.stringify({ name: "application_error", message: "boom" }), {
          status,
        });
      }
      return new Response(JSON.stringify({ id: `re_${resend.calls.length}` }), { status: 200 });
    }),
  );
}

const configure = (on: boolean) => {
  vi.stubEnv("RESEND_API_KEY", on ? "re_test" : "");
  vi.stubEnv("EMAIL_FROM", on ? "G&R <noreply@example.com>" : "");
};

async function customer(name: string, email: string | null, login = true): Promise<string> {
  if (login && email) {
    const user = await createAuthUser(db, {
      email,
      meta: { full_name: name, phone: "+597 8000001" },
    });
    return (
      await rows<{ id: string }>("select id from public.customers where user_id = $1", [user.id])
    )[0]!.id;
  }
  return (
    await rows<{ id: string }>(
      "insert into public.customers (full_name, email, phone, account_type) values ($1, $2, '8000009', 'personal') returning id",
      [name, email],
    )
  )[0]!.id;
}

/** An issued invoice of `amount` (one customs line), with its dates set as time would. */
async function invoice(customerId: string, dueOffset: number, amount = 50): Promise<string> {
  const id = (
    await rows<{ id: string }>(
      "insert into public.invoices (customer_id, due_date) values ($1, $2::date + 7) returning id",
      [customerId, TODAY],
    )
  )[0]!.id;
  await db.query(
    "insert into public.invoice_items (invoice_id, line_type, description, amount, vat_exempt) values ($1, 'customs', 'Douane', $2, true)",
    [id, amount],
  );
  await db.transaction(async (tx) => {
    await tx.query(
      `select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true),
              set_config('request.jwt.claim.sub', $1::text, true)`,
      [staff.id],
    );
    await tx.query("select public.issue_invoice($1)", [id]);
  });
  // Fixture only: issued invoices are immutable, so age it past the triggers.
  await db.transaction(async (tx) => {
    await tx.exec("set local session_replication_role = replica");
    await tx.query(
      "update public.invoices set invoice_date = $2::date + $3::int - 7, due_date = $2::date + $3::int where id = $1",
      [id, TODAY, dueOffset],
    );
  });
  return id;
}

async function reminderState(id: string) {
  return (
    await rows<{ reminder_count: number; first: boolean; last: string | null }>(
      "select reminder_count, first_reminder_sent_at is not null as first, last_reminder_sent_at::text as last from public.invoices where id = $1",
      [id],
    )
  )[0]!;
}

const run = (today = TODAY) =>
  runPaymentReminders({ trigger: "cron" }, { db: serviceDb(db), today, pause: async () => {} });

beforeAll(async () => {
  db = await createDb();
  staff = await createAuthUser(db, { email: "staff@example.com" });
  await db.query("insert into public.user_roles (user_id, role) values ($1, 'staff')", [staff.id]);
  await db.query(
    "update public.customers set user_id = null, status = 'disabled', disabled_reason = 'team login' where user_id = $1",
    [staff.id],
  );
  await db.query(
    "update public.company_bank_accounts set bank_name = 'DSB', account_holder = 'G&R', account_number = '1234567' where currency = 'USD' and is_active",
  );
  current.admin = serviceClient(db);
});

afterAll(async () => {
  await db?.close();
});

beforeEach(() => {
  failNext = [];
  mockResend();
  configure(true);
  vi.stubEnv("APP_URL", APP);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sendEmail() against email_logs", () => {
  const base = {
    kind: "welcome" as const,
    to: "x@example.com",
    subject: "Welkom",
    html: "<p>Welkom</p>",
    text: "Welkom",
  };

  it("claims with the unique key, sends once, records sent with the provider id", async () => {
    const first = await sendEmail({ ...base, idempotencyKey: "test:contract:1" });
    const again = await sendEmail({ ...base, idempotencyKey: "test:contract:1" });
    expect(first).toMatchObject({ status: "sent", providerMessageId: "re_1" });
    expect(again).toMatchObject({ status: "duplicate", previous: "sent" });
    expect(resend.calls).toHaveLength(1);
    expect(
      await rows(
        "select status, provider_message_id, sent_at is not null as sent from public.email_logs where idempotency_key = 'test:contract:1'",
      ),
    ).toEqual([{ status: "sent", provider_message_id: "re_1", sent: true }]);
  });

  it("skipped without a provider; failed on a refusal; both re-claimed by a later attempt", async () => {
    configure(false);
    expect(await sendEmail({ ...base, idempotencyKey: "test:contract:2" })).toMatchObject({
      status: "skipped_no_provider",
    });
    configure(true);
    failNext = [500];
    expect(await sendEmail({ ...base, idempotencyKey: "test:contract:2" })).toMatchObject({
      status: "failed",
      error: "Resend 500 application_error: boom",
    });
    expect(
      await rows(
        "select status, error from public.email_logs where idempotency_key = 'test:contract:2'",
      ),
    ).toEqual([{ status: "failed", error: "Resend 500 application_error: boom" }]);
    expect(await sendEmail({ ...base, idempotencyKey: "test:contract:2" })).toMatchObject({
      status: "sent",
    });
    expect(
      await rows(
        "select status, error, count(*) over () as n from public.email_logs where idempotency_key = 'test:contract:2'",
      ),
    ).toEqual([{ status: "sent", error: null, n: 1 }]);
  });
});

describe("runPaymentReminders()", () => {
  it("sends what each window asks, books overdue reminders, records the run, and is idempotent", async () => {
    const alice = await customer("Alice Jansen", "alice@example.com");
    const bob = await customer("Bob Bakker", "bob@example.com", false);
    const carol = await customer("Carol Zonder Mail", null, false);

    const dueSoon = await invoice(alice, 2); // due in 2 days: the reminder before the due date
    const notYet = await invoice(alice, 5); // window not open yet
    const overdue = await invoice(bob, -1); // first overdue reminder
    const noEmail = await invoice(carol, -3);
    const repeat = await invoice(alice, -20);
    await db.transaction(async (tx) => {
      await tx.exec("set local session_replication_role = replica");
      await tx.query(
        "update public.invoices set reminder_count = 1, first_reminder_sent_at = now() - interval '19 days', last_reminder_sent_at = now() - interval '8 days' where id = $1",
        [repeat],
      );
    });
    const paid = await invoice(alice, -10, 20);
    await db.query(
      "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, false)",
      [staff.id],
    );
    await db.query("select public.record_payment($1)", [paid]);
    await db.query("select set_config('request.jwt.claims', '', false)");

    const result = await run();
    expect(result.status).toBe("succeeded");
    expect(result.stats).toMatchObject({
      due_soon: 1,
      overdue: 3,
      sent: 3,
      no_address: 1,
      failed: 0,
    });

    const keys = resend.calls.map((c) => c.key).sort();
    expect(keys).toEqual(
      [
        `invoice:${dueSoon}:payment_reminder_due_soon:1`,
        `invoice:${overdue}:payment_reminder_overdue:1`,
        `invoice:${repeat}:payment_reminder_overdue:2`,
      ].sort(),
    );
    const toBob = resend.calls.find((c) => c.key.startsWith(`invoice:${overdue}`))!;
    expect(toBob.body.to).toEqual(["bob@example.com"]);
    expect(toBob.body.subject).toMatch(/^Betalingsherinnering: factuur INV-/);
    expect(toBob.body.text).toContain("opslag van 15%");
    expect(toBob.body.text).not.toContain(`${APP}/portal`);
    const toAliceRepeat = resend.calls.find((c) => c.key.startsWith(`invoice:${repeat}`))!;
    expect(toAliceRepeat.body.subject).toMatch(/^2e betalingsherinnering/);
    expect(toAliceRepeat.body.text).toContain(`${APP}/portal/facturen/${repeat}`);

    // Bookkeeping: only the overdue reminders count; the one before the due date does not.
    expect(await reminderState(overdue)).toMatchObject({ reminder_count: 1, first: true });
    expect(await reminderState(repeat)).toMatchObject({ reminder_count: 2, first: true });
    expect(await reminderState(dueSoon)).toMatchObject({ reminder_count: 0, first: false });
    expect(await reminderState(notYet)).toMatchObject({ reminder_count: 0 });
    expect(await reminderState(noEmail)).toMatchObject({ reminder_count: 0 });

    const runRow = (
      await rows<{ job: string; trigger: string; status: string; finished: boolean; stats: Row }>(
        "select job, trigger, status, finished_at is not null as finished, stats from public.job_runs where id = $1",
        [result.runId],
      )
    )[0]!;
    expect(runRow).toMatchObject({
      job: "payment_reminders",
      trigger: "cron",
      status: "succeeded",
      finished: true,
    });
    expect(runRow.stats).toMatchObject({ sent: 3, no_address: 1 });

    // The same day again: nothing new (windows closed, keys taken).
    const again = await run();
    expect(again.stats.sent).toBe(0);
    expect(resend.calls).toHaveLength(3);

    // Eight days later the first overdue invoice is due for its second reminder.
    const later = await run(addDays(TODAY, 8));
    expect(resend.calls.map((c) => c.key)).toContain(
      `invoice:${overdue}:payment_reminder_overdue:2`,
    );
    expect(later.stats.sent).toBeGreaterThanOrEqual(1);
  });

  it("not configured: nothing is booked, and the next run after configuring sends", async () => {
    const dave = await customer("Dave", "dave@example.com", false);
    const inv = await invoice(dave, -2);
    configure(false);
    const skipped = await run();
    expect(skipped.stats.skipped).toBeGreaterThanOrEqual(1);
    expect(await reminderState(inv)).toMatchObject({ reminder_count: 0 });
    expect(await rows("select status from public.email_logs where invoice_id = $1", [inv])).toEqual(
      [{ status: "skipped_no_provider" }],
    );

    configure(true);
    await run();
    expect(await reminderState(inv)).toMatchObject({ reminder_count: 1 });
    expect(await rows("select status from public.email_logs where invoice_id = $1", [inv])).toEqual(
      [{ status: "sent" }],
    );
  });

  it("a refused reminder marks the run failed and is retried by the next run", async () => {
    const erin = await customer("Erin", "erin@example.com", false);
    const inv = await invoice(erin, -2);
    // Others may be due too; fail every send of this run.
    failNext = Array.from({ length: 20 }, () => 500);
    const failed = await run();
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/kon(den)? niet worden verstuurd/);
    expect(await reminderState(inv)).toMatchObject({ reminder_count: 0 });
    failNext = [];
    const retried = await run();
    expect(retried.status).toBe("succeeded");
    expect(await reminderState(inv)).toMatchObject({ reminder_count: 1 });
  });

  it("a reminder that was sent but never booked is booked by the next run, not sent again", async () => {
    const fay = await customer("Fay", "fay@example.com", false);
    const inv = await invoice(fay, -2);
    await db.query(
      `insert into public.email_logs (kind, recipient, idempotency_key, status, sent_at, invoice_id, customer_id)
       values ('payment_reminder_overdue', 'fay@example.com', $1, 'sent', now() - interval '1 hour', $2, $3)`,
      [`invoice:${inv}:payment_reminder_overdue:1`, inv, fay],
    );
    await run();
    expect(resend.calls.filter((c) => c.key.startsWith(`invoice:${inv}`))).toEqual([]);
    expect(await reminderState(inv)).toMatchObject({ reminder_count: 1, first: true });
  });

  it("closes a run a killed request left 'running', not one that is still going", async () => {
    const [killed, busy] = await Promise.all(
      ["20 minutes", "2 minutes"].map(
        async (ago) =>
          (
            await rows<{ id: string }>(
              `insert into public.job_runs (job, trigger, status, started_at)
               values ('payment_reminders', 'cron', 'running', now() - $1::interval) returning id`,
              [ago],
            )
          )[0]!.id,
      ),
    );
    await run();
    const state = await rows<{ id: string; status: string; error: string | null }>(
      "select id, status, error from public.job_runs where id = any($1::uuid[])",
      [[killed, busy]],
    );
    expect(state.find((r) => r.id === killed)).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/^Afgebroken/),
    });
    expect(state.find((r) => r.id === busy)).toMatchObject({ status: "running", error: null });
  });

  it("leaves out invoices past their due date that had every reminder", async () => {
    const nora = await customer("Nora", "nora@example.com", false);
    const done = await invoice(nora, -60);
    await db.transaction(async (tx) => {
      await tx.exec("set local session_replication_role = replica");
      await tx.query(
        "update public.invoices set reminder_count = 3, last_reminder_sent_at = now() - interval '20 days' where id = $1",
        [done],
      );
    });
    const open = (
      await rows<{ n: number }>(
        `select count(*)::int as n from public.invoice_overview
          where status in ('open', 'partially_paid') and balance_due > 0
            and due_date <= $1::date + 2`,
        [TODAY],
      )
    )[0]!.n;
    const result = await run();
    expect(result.stats.checked).toBeLessThan(open);
    expect(resend.calls.filter((c) => c.key.startsWith(`invoice:${done}`))).toEqual([]);
  });
});

describe("sendInvoiceReminderNow() (per invoice, at most one reminder a day)", () => {
  it("sends the reminder the run would send today, under its key, books it, and refuses a second", async () => {
    const gina = await customer("Gina", "gina@example.com", false);
    const inv = await invoice(gina, -4);
    const db1 = serviceDb(db);
    const first = await sendInvoiceReminderNow({ invoiceId: inv, actorId: staff.id }, { db: db1 });
    expect(first).toEqual({
      status: "sent_or_tried",
      kind: "payment_reminder_overdue",
      outcome: "sent",
    });
    // The daily run would send the 1st overdue reminder today: same key, so
    // the run and a click at the same moment claim one email_logs row.
    expect(resend.calls.at(-1)!.key).toBe(`invoice:${inv}:payment_reminder_overdue:1`);
    expect(await reminderState(inv)).toMatchObject({ reminder_count: 1 });

    const second = await sendInvoiceReminderNow({ invoiceId: inv, actorId: staff.id }, { db: db1 });
    expect(second).toEqual({ status: "already_today", kind: "payment_reminder_overdue" });
    expect(await reminderState(inv)).toMatchObject({ reminder_count: 1 });

    // The daily run that day: not due again (last reminder today).
    await run();
    expect(resend.calls.filter((c) => c.key.startsWith(`invoice:${inv}`))).toHaveLength(1);
  });

  it("after the daily run's reminder the button sends nothing that day (review P8)", async () => {
    const kim = await customer("Kim", "kim@example.com", false);
    const overdue = await invoice(kim, -3);
    const dueSoon = await invoice(kim, 1);
    await run();
    const mine = () =>
      resend.calls.filter(
        (c) => c.key.startsWith(`invoice:${overdue}:`) || c.key.startsWith(`invoice:${dueSoon}:`),
      );
    expect(
      mine()
        .map((c) => c.key)
        .sort(),
    ).toEqual(
      [
        `invoice:${overdue}:payment_reminder_overdue:1`,
        `invoice:${dueSoon}:payment_reminder_due_soon:1`,
      ].sort(),
    );
    for (const [inv, kind] of [
      [overdue, "payment_reminder_overdue"],
      [dueSoon, "payment_reminder_due_soon"],
    ] as const) {
      expect(
        await sendInvoiceReminderNow({ invoiceId: inv, actorId: staff.id }, { db: serviceDb(db) }),
      ).toEqual({ status: "already_today", kind });
    }
    expect(mine()).toHaveLength(2);
    // The max_overdue_reminders budget is untouched: one booked reminder.
    expect(await reminderState(overdue)).toMatchObject({ reminder_count: 1 });
  });

  it("between scheduled reminders it sends an extra one under the day's manual key", async () => {
    const lia = await customer("Lia", "lia@example.com", false);
    const inv = await invoice(lia, -10);
    await db.transaction(async (tx) => {
      await tx.exec("set local session_replication_role = replica");
      await tx.query(
        "update public.invoices set reminder_count = 1, first_reminder_sent_at = now() - interval '3 days', last_reminder_sent_at = now() - interval '3 days' where id = $1",
        [inv],
      );
    });
    const result = await sendInvoiceReminderNow(
      { invoiceId: inv, actorId: staff.id },
      { db: serviceDb(db) },
    );
    expect(result).toMatchObject({ status: "sent_or_tried", outcome: "sent" });
    expect(resend.calls.at(-1)!.key).toBe(
      `invoice:${inv}:payment_reminder_overdue:manual-${TODAY}`,
    );
    expect(resend.calls.at(-1)!.body.subject).toMatch(/^2e betalingsherinnering/);
    expect(await reminderState(inv)).toMatchObject({ reminder_count: 2 });
  });

  it("past max_overdue_reminders: nothing without confirmation, then one more", async () => {
    const max = await customer("Max", "max@example.com", false);
    const inv = await invoice(max, -40);
    await db.transaction(async (tx) => {
      await tx.exec("set local session_replication_role = replica");
      await tx.query(
        "update public.invoices set reminder_count = 3, first_reminder_sent_at = now() - interval '30 days', last_reminder_sent_at = now() - interval '9 days' where id = $1",
        [inv],
      );
    });
    const before = resend.calls.length;
    expect(
      await sendInvoiceReminderNow({ invoiceId: inv, actorId: staff.id }, { db: serviceDb(db) }),
    ).toEqual({ status: "max_reached", kind: "payment_reminder_overdue", max: 3 });
    expect(resend.calls).toHaveLength(before);
    expect(
      await sendInvoiceReminderNow(
        { invoiceId: inv, actorId: staff.id, confirmMax: true },
        { db: serviceDb(db) },
      ),
    ).toMatchObject({ status: "sent_or_tried", outcome: "sent" });
    expect(resend.calls.at(-1)!.key).toBe(
      `invoice:${inv}:payment_reminder_overdue:manual-${TODAY}`,
    );
    expect(await reminderState(inv)).toMatchObject({ reminder_count: 4 });
  });

  it("before the due date it sends the friendly wording without counting it", async () => {
    const hugo = await customer("Hugo", "hugo@example.com", false);
    const inv = await invoice(hugo, 6);
    const result = await sendInvoiceReminderNow(
      { invoiceId: inv, actorId: staff.id },
      { db: serviceDb(db) },
    );
    expect(result).toMatchObject({ kind: "payment_reminder_due_soon", outcome: "sent" });
    expect(resend.calls.at(-1)!.body.subject).toMatch(/^Herinnering: factuur INV-.* vervalt op/);
    expect(await reminderState(inv)).toMatchObject({ reminder_count: 0 });
    // The scheduled "before the due date" reminder then does not go out again.
    await run(addDays(TODAY, 5));
    expect(
      resend.calls.filter((c) => c.key === `invoice:${inv}:payment_reminder_due_soon:1`),
    ).toEqual([]);
  });

  it("a paid invoice gets nothing", async () => {
    const ivo = await customer("Ivo", "ivo@example.com", false);
    const inv = await invoice(ivo, -1, 10);
    await db.query(
      "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, false)",
      [staff.id],
    );
    await db.query("select public.record_payment($1)", [inv]);
    await db.query("select set_config('request.jwt.claims', '', false)");
    expect(
      await sendInvoiceReminderNow({ invoiceId: inv, actorId: staff.id }, { db: serviceDb(db) }),
    ).toEqual({ status: "not_due" });
  });
});
