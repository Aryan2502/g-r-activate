import { afterEach, describe, expect, it, vi } from "vitest";

import type { ResendConfig } from "./env";

import {
  ABANDONED_CLAIM_MS,
  RESEND_ENDPOINT,
  sendEmail,
  toEmailOutcome,
  type EmailLogRow,
  type EmailLogStore,
  type SendEmailInput,
} from "./email";

/**
 * sendEmail() with an in-memory email_logs (unique idempotency_key, the
 * status/sent_at rule of the table) and a mocked fetch: nothing reaches
 * Resend. The same code against the real table runs in
 * supabase/tests/pglite/email_contract.test.ts.
 */

type Row = EmailLogRow & {
  idempotency_key: string;
  kind: string;
  recipient: string;
  provider_message_id: string | null;
  error: string | null;
  sent_at: string | null;
  customer_id: string | null;
  invoice_id: string | null;
  order_id: string | null;
};

let clock = Date.parse("2026-10-07T12:00:00Z");
const now = () => new Date(clock);

function memoryStore(opts: { companyEmail?: string | null } = {}) {
  const rows: Row[] = [];
  let seq = 0;
  const touch = () => new Date(clock + seq++).toISOString();
  const check = (r: Row) => {
    if ((r.status === "sent") !== (r.sent_at !== null)) throw new Error("email_logs_sent_check");
  };
  const store: EmailLogStore = {
    claim: vi.fn(async (row) => {
      if (rows.some((r) => r.idempotency_key === row.idempotency_key)) return null;
      const r: Row = {
        id: `log-${rows.length + 1}`,
        idempotency_key: row.idempotency_key,
        kind: row.kind,
        status: row.status ?? "queued",
        recipient: row.recipient,
        provider_message_id: null,
        error: null,
        sent_at: null,
        customer_id: row.customer_id ?? null,
        invoice_id: row.invoice_id ?? null,
        order_id: row.order_id ?? null,
        updated_at: touch(),
      };
      check(r);
      rows.push(r);
      return r.id;
    }),
    find: vi.fn(async (key) => {
      const r = rows.find((x) => x.idempotency_key === key);
      return r ? { id: r.id, status: r.status, updated_at: r.updated_at } : null;
    }),
    reclaim: vi.fn(async (row, update, staleBefore) => {
      const r = rows.find((x) => x.id === row.id);
      if (!r || r.status !== row.status) return false;
      if (r.status === "queued" && !(r.updated_at < staleBefore)) return false;
      Object.assign(r, update, { updated_at: touch() });
      check(r);
      return true;
    }),
    finish: vi.fn(async (id, update) => {
      const r = rows.find((x) => x.id === id);
      if (!r) throw new Error("no row");
      Object.assign(r, update, { updated_at: touch() });
      check(r);
    }),
    companyEmail: vi.fn(async () => opts.companyEmail ?? null),
  };
  return { store, rows };
}

const CONFIG: ResendConfig = {
  apiKey: "re_test_key",
  from: "G&R Solutions <noreply@mail.example.com>",
  replyTo: null,
};

const input = (extra: Partial<SendEmailInput> = {}): SendEmailInput => ({
  kind: "invoice_issued",
  to: "Alice@Example.com ",
  subject: "Factuur INV-2026-0001",
  html: "<p>Hallo</p>",
  text: "Hallo",
  idempotencyKey: "invoice:i1:invoice_issued:1",
  customerId: "c1",
  invoiceId: "i1",
  ...extra,
});

function resendOk(id = "re_msg_1") {
  return vi.fn(async () => new Response(JSON.stringify({ id }), { status: 200 }));
}

function resendError(status: number, name: string, message: string) {
  return vi.fn(
    async () => new Response(JSON.stringify({ statusCode: status, name, message }), { status }),
  );
}

afterEach(() => {
  clock = Date.parse("2026-10-07T12:00:00Z");
});

describe("sendEmail()", () => {
  it("claims the key, posts to Resend with the Idempotency-Key and records 'sent'", async () => {
    const { store, rows } = memoryStore({ companyEmail: "info@grsolutions.sr" });
    const fetch = resendOk("re_123");
    const result = await sendEmail(input(), { store, fetch, config: CONFIG, now });

    expect(result).toEqual({ status: "sent", logId: "log-1", providerMessageId: "re_123" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RESEND_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer re_test_key",
      "Content-Type": "application/json",
      "Idempotency-Key": "invoice:i1:invoice_issued:1",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      from: "G&R Solutions <noreply@mail.example.com>",
      to: ["alice@example.com"],
      subject: "Factuur INV-2026-0001",
      html: "<p>Hallo</p>",
      text: "Hallo",
      reply_to: "info@grsolutions.sr",
      tags: [{ name: "kind", value: "invoice_issued" }],
    });
    expect(rows).toMatchObject([
      {
        idempotency_key: "invoice:i1:invoice_issued:1",
        kind: "invoice_issued",
        status: "sent",
        recipient: "alice@example.com",
        provider_message_id: "re_123",
        sent_at: now().toISOString(),
        error: null,
        customer_id: "c1",
        invoice_id: "i1",
        order_id: null,
      },
    ]);
    expect(toEmailOutcome(result)).toBe("sent");
  });

  it("is idempotent: the same key again sends nothing and reports 'duplicate'", async () => {
    const { store, rows } = memoryStore();
    const fetch = resendOk();
    await sendEmail(input(), { store, fetch, config: CONFIG, now });
    const again = await sendEmail(input(), { store, fetch, config: CONFIG, now });

    expect(again).toEqual({ status: "duplicate", logId: "log-1", previous: "sent" });
    expect(toEmailOutcome(again)).toBe("duplicate");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
  });

  it("two requests at once: only the one that claimed sends", async () => {
    const { store } = memoryStore();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const fetch = vi.fn(async () => {
      await gate;
      return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
    });
    const first = sendEmail(input(), { store, fetch, config: CONFIG, now });
    const second = await sendEmail(input(), { store, fetch, config: CONFIG, now });
    expect(second).toMatchObject({ status: "duplicate", previous: "queued" });
    release();
    expect(await first).toMatchObject({ status: "sent" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("without RESEND_API_KEY / EMAIL_FROM logs 'skipped_no_provider', sends nothing, never throws", async () => {
    const { store, rows } = memoryStore();
    const fetch = resendOk();
    const result = await sendEmail(input(), { store, fetch, config: null, now });

    expect(result).toEqual({ status: "skipped_no_provider", logId: "log-1" });
    expect(toEmailOutcome(result)).toBe("skipped");
    expect(fetch).not.toHaveBeenCalled();
    expect(rows).toMatchObject([{ status: "skipped_no_provider", sent_at: null }]);

    // Still not configured: the same key stays skipped, no new row, no churn.
    const again = await sendEmail(input(), { store, fetch, config: null, now });
    expect(again).toEqual({ status: "skipped_no_provider", logId: "log-1" });
    expect(store.reclaim).not.toHaveBeenCalled();
  });

  it("a skipped e-mail is sent by a later attempt once e-mail is configured (e.g. a reminder)", async () => {
    const { store, rows } = memoryStore();
    await sendEmail(input(), { store, fetch: resendOk(), config: null, now });
    const fetch = resendOk("re_later");
    const result = await sendEmail(input(), { store, fetch, config: CONFIG, now });
    expect(result).toEqual({ status: "sent", logId: "log-1", providerMessageId: "re_later" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "sent", provider_message_id: "re_later" });
  });

  it("records a refusal by Resend as 'failed' with the reason, and a later attempt re-claims it", async () => {
    const { store, rows } = memoryStore();
    const refused = resendError(422, "validation_error", "Invalid `to` field.");
    const result = await sendEmail(input(), { store, fetch: refused, config: CONFIG, now });

    expect(result).toEqual({
      status: "failed",
      logId: "log-1",
      error: "Resend 422 validation_error: Invalid `to` field.",
    });
    expect(toEmailOutcome(result)).toBe("failed");
    expect(rows[0]).toMatchObject({
      status: "failed",
      sent_at: null,
      error: "Resend 422 validation_error: Invalid `to` field.",
    });

    // Re-claim: the failed row becomes queued again and is sent with the SAME key.
    const fetch = resendOk("re_retry");
    const retry = await sendEmail(input({ to: "alice.new@example.com" }), {
      store,
      fetch,
      config: CONFIG,
      now,
    });
    expect(retry).toEqual({ status: "sent", logId: "log-1", providerMessageId: "re_retry" });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(
      "invoice:i1:invoice_issued:1",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "sent",
      error: null,
      recipient: "alice.new@example.com",
      provider_message_id: "re_retry",
    });
  });

  it("retries once after Resend's rate limit (429), with the same key", async () => {
    const { store, rows } = memoryStore();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ name: "rate_limit_exceeded", message: "Too many requests" }),
          {
            status: 429,
            headers: { "retry-after": "1" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "re_after_wait" }), { status: 200 }),
      );
    const sleep = vi.fn(async () => {});
    const result = await sendEmail(input(), { store, fetch, config: CONFIG, now, sleep });
    expect(result).toMatchObject({ status: "sent", providerMessageId: "re_after_wait" });
    expect(sleep).toHaveBeenCalledWith(1000);
    const keys = fetch.mock.calls.map(
      ([, init]) => ((init as RequestInit).headers as Record<string, string>)["Idempotency-Key"],
    );
    expect(keys).toEqual(["invoice:i1:invoice_issued:1", "invoice:i1:invoice_issued:1"]);
    expect(rows[0]).toMatchObject({ status: "sent" });

    // Still limited after the retry: failed, to be re-claimed by a later attempt.
    const { store: store2 } = memoryStore();
    const limited = vi.fn(
      async () =>
        new Response(JSON.stringify({ name: "rate_limit_exceeded", message: "Too many" }), {
          status: 429,
        }),
    );
    expect(
      await sendEmail(input(), { store: store2, fetch: limited, config: CONFIG, now, sleep }),
    ).toMatchObject({ status: "failed", error: "Resend 429 rate_limit_exceeded: Too many" });
    expect(limited).toHaveBeenCalledTimes(2);
  });

  it("a network error or timeout is 'failed', never thrown", async () => {
    const { store, rows } = memoryStore();
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await sendEmail(input(), { store, fetch, config: CONFIG, now });
    expect(result).toEqual({ status: "failed", logId: "log-1", error: "TypeError: fetch failed" });
    expect(rows[0]).toMatchObject({ status: "failed", error: "TypeError: fetch failed" });
  });

  it("a 'queued' row is in progress: no second send until it is abandoned (10 min)", async () => {
    const { store, rows } = memoryStore();
    rows.push({
      id: "log-x",
      idempotency_key: "invoice:i1:invoice_issued:1",
      kind: "invoice_issued",
      status: "queued",
      recipient: "alice@example.com",
      provider_message_id: null,
      error: null,
      sent_at: null,
      customer_id: "c1",
      invoice_id: "i1",
      order_id: null,
      updated_at: new Date(clock - 60_000).toISOString(),
    });
    const fetch = resendOk();
    expect(await sendEmail(input(), { store, fetch, config: CONFIG, now })).toEqual({
      status: "duplicate",
      logId: "log-x",
      previous: "queued",
    });
    expect(fetch).not.toHaveBeenCalled();

    clock += ABANDONED_CLAIM_MS;
    expect(await sendEmail(input(), { store, fetch, config: CONFIG, now })).toMatchObject({
      status: "sent",
      logId: "log-x",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("losing a re-claim race to another request reports 'duplicate' and sends nothing", async () => {
    const { store, rows } = memoryStore();
    await sendEmail(input(), {
      store,
      fetch: resendError(500, "application_error", "boom"),
      config: CONFIG,
      now,
    });
    // Another request takes the failed row over between our read and our update.
    const realFind = store.find;
    store.find = vi.fn(async (key: string) => {
      const found = await realFind(key);
      if (found && found.status === "failed") {
        const r = rows[0]!;
        r.status = "queued";
        r.error = null;
        r.updated_at = new Date(clock + 999).toISOString();
      }
      return found;
    });
    const fetch = resendOk();
    expect(await sendEmail(input(), { store, fetch, config: CONFIG, now })).toMatchObject({
      status: "duplicate",
      previous: "queued",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Reply-To: EMAIL_REPLY_TO first, then the caller's fallback, then company_settings.email", async () => {
    const replyOf = async (
      config: typeof CONFIG,
      replyTo: string | null,
      company: string | null,
    ) => {
      const { store } = memoryStore({ companyEmail: company });
      const fetch = resendOk();
      await sendEmail(input({ replyTo }), { store, fetch, config, now });
      const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      return (JSON.parse(String(init.body)) as { reply_to?: string }).reply_to ?? null;
    };
    expect(await replyOf({ ...CONFIG, replyTo: "support@g-r.sr" }, "x@y.sr", "info@g-r.sr")).toBe(
      "support@g-r.sr",
    );
    expect(await replyOf(CONFIG, "caller@g-r.sr", "info@g-r.sr")).toBe("caller@g-r.sr");
    expect(await replyOf(CONFIG, null, "info@g-r.sr")).toBe("info@g-r.sr");
    expect(await replyOf(CONFIG, null, null)).toBeNull();
  });

  it("refuses an address that cannot be e-mailed, without logging or sending", async () => {
    const { store, rows } = memoryStore();
    const fetch = resendOk();
    for (const to of ["", "geen-adres", "a@b", "Alice <alice@example.com>"]) {
      expect(await sendEmail(input({ to }), { store, fetch, config: CONFIG, now })).toMatchObject({
        status: "failed",
        logId: null,
      });
    }
    expect(rows).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a log that cannot be written (database down) means: not sent, reported as failed", async () => {
    const { store } = memoryStore();
    store.claim = vi.fn(async () => {
      throw { code: "08006", message: "connection failure" };
    });
    const fetch = resendOk();
    expect(await sendEmail(input(), { store, fetch, config: CONFIG, now })).toEqual({
      status: "failed",
      logId: null,
      error: "connection failure",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a result that cannot be recorded still reports what happened at Resend", async () => {
    const { store } = memoryStore();
    store.finish = vi.fn(async () => {
      throw new Error("db gone");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await sendEmail(input(), { store, fetch: resendOk("re_9"), config: CONFIG, now }),
    ).toEqual({
      status: "sent",
      logId: "log-1",
      providerMessageId: "re_9",
    });
    error.mockRestore();
  });
});
