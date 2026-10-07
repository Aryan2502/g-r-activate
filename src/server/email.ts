import "@tanstack/react-start/server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import type { EmailKind } from "@/lib/email/keys";
import type { EmailOutcome } from "@/lib/email/outcome";
import { MissingEnvError, getResendConfig, type ResendConfig } from "@/server/env";

/**
 * Transactional e-mail through Resend's REST API (SPEC §24, §35.12). Called
 * ONLY from server code, after the database write it reports has committed.
 * Load with `await import("@/server/email")` inside a server handler.
 *
 * 1. Claim: insert the email_logs row first (insert … on conflict
 *    (idempotency_key) do nothing). Only the request that inserted it, or that
 *    re-claims a row in state 'failed' or 'skipped_no_provider' (or a 'queued'
 *    row abandoned for 10 minutes by a crashed request), sends. Everyone else
 *    gets 'duplicate'.
 * 2. Send: POST https://api.resend.com/emails with the same key as
 *    Idempotency-Key (Resend answers a repeat within 24 h with the first
 *    result instead of sending again). From EMAIL_FROM; Reply-To
 *    EMAIL_REPLY_TO, else the caller's fallback, else company_settings.email.
 * 3. Record: status 'sent' with the provider id, or 'failed' with the error.
 *
 * Without RESEND_API_KEY or EMAIL_FROM nothing is sent: the row says
 * 'skipped_no_provider' and the caller hears 'skipped_no_provider'. Nothing
 * here throws: every problem comes back as status 'failed'.
 *
 * Who writes email_logs: always the service role, and only this module
 * (SPEC §35.2 "email-log bookkeeping"). email_logs is staff-READ-only under
 * RLS with no client write grant (SPEC §35.3), so a customer's request
 * (order confirmation), an anonymous one (welcome after redemption) and a
 * staff request all log the same way. The e-mail's CONTENT is read by the
 * caller with the client of the person acting (RLS applies), except after an
 * invitation redemption, which already runs with the service role.
 */

export type EmailLogStatus = Database["public"]["Enums"]["email_status"];

export interface SendEmailInput {
  kind: EmailKind;
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  customerId?: string | null;
  invoiceId?: string | null;
  orderId?: string | null;
  /** Reply-To when EMAIL_REPLY_TO is not set (usually company_settings.email). */
  replyTo?: string | null;
}

export type SendEmailResult =
  | { status: "sent"; logId: string; providerMessageId: string | null }
  | { status: "skipped_no_provider"; logId: string | null }
  | { status: "failed"; logId: string | null; error: string }
  | { status: "duplicate"; logId: string; previous: EmailLogStatus };

/** sendEmail's answer as the staff screens report it. */
export function toEmailOutcome(result: SendEmailResult): EmailOutcome {
  switch (result.status) {
    case "sent":
      return "sent";
    case "skipped_no_provider":
      return "skipped";
    case "duplicate":
      return result.previous === "skipped_no_provider" ? "skipped" : "duplicate";
    default:
      return "failed";
  }
}

export interface EmailLogRow {
  id: string;
  status: EmailLogStatus;
  updated_at: string;
}

/** What sendEmail needs from email_logs; supabaseLogStore() is the real one. */
export interface EmailLogStore {
  /** insert … on conflict (idempotency_key) do nothing; the new row's id, or null on conflict. */
  claim(row: Database["public"]["Tables"]["email_logs"]["Insert"]): Promise<string | null>;
  find(idempotencyKey: string): Promise<EmailLogRow | null>;
  /**
   * Takes over `row` only while it still has the status it was read with
   * (one atomic UPDATE … WHERE status = …), and a 'queued' row only while it
   * is older than `staleBefore`. False: another request got there first.
   */
  reclaim(
    row: EmailLogRow,
    update: Database["public"]["Tables"]["email_logs"]["Update"],
    staleBefore: string,
  ): Promise<boolean>;
  finish(id: string, update: Database["public"]["Tables"]["email_logs"]["Update"]): Promise<void>;
  companyEmail(): Promise<string | null>;
}

export interface SendEmailDeps {
  store?: EmailLogStore;
  fetch?: typeof fetch;
  /** Overrides getResendConfig() (tests). */
  config?: ResendConfig | null;
  now?: () => Date;
  /** Waits before retrying a rate-limited request (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

export const RESEND_ENDPOINT = "https://api.resend.com/emails";
/** One retry after Resend's 429 (rate limit), with the same Idempotency-Key. */
const RATE_LIMIT_ATTEMPTS = 2;
/** A 'queued' row this old belongs to a request that died between claim and send. */
export const ABANDONED_CLAIM_MS = 10 * 60_000;
const SEND_TIMEOUT_MS = 15_000;
const MAX_ERROR = 5000;

/** email_logs through the service-role client (bookkeeping only). */
export function supabaseLogStore(client: Pick<SupabaseClient<Database>, "from">): EmailLogStore {
  return {
    async claim(row) {
      const { data, error } = await client
        .from("email_logs")
        .upsert(row, { onConflict: "idempotency_key", ignoreDuplicates: true })
        .select("id");
      if (error) throw error;
      return data[0]?.id ?? null;
    },
    async find(key) {
      const { data, error } = await client
        .from("email_logs")
        .select("id, status, updated_at")
        .eq("idempotency_key", key)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async reclaim(row, update, staleBefore) {
      let query = client
        .from("email_logs")
        .update(update)
        .eq("id", row.id)
        .eq("status", row.status);
      if (row.status === "queued") query = query.lt("updated_at", staleBefore);
      const { data, error } = await query.select("id");
      if (error) throw error;
      return data.length === 1;
    },
    async finish(id, update) {
      const { error } = await client.from("email_logs").update(update).eq("id", id);
      if (error) throw error;
    },
    async companyEmail() {
      const { data, error } = await client.from("company_settings").select("email").maybeSingle();
      if (error) throw error;
      return data?.email?.trim() || null;
    },
  };
}

async function defaultStore(): Promise<EmailLogStore> {
  const { loadAdminClient } = await import("@/server/admin-client");
  return supabaseLogStore(await loadAdminClient());
}

const RECIPIENT = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]+$/;

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

const clip = (s: string) => (s.length > MAX_ERROR ? `${s.slice(0, MAX_ERROR - 1)}…` : s);

/** Whether a row with this status may be taken over by a new attempt with the same key. */
function reclaimable(row: EmailLogRow, now: Date): boolean {
  if (row.status === "failed" || row.status === "skipped_no_provider") return true;
  if (row.status === "queued") {
    const updated = Date.parse(row.updated_at);
    return Number.isFinite(updated) && now.getTime() - updated > ABANDONED_CLAIM_MS;
  }
  return false;
}

export async function sendEmail(
  input: SendEmailInput,
  deps: SendEmailDeps = {},
): Promise<SendEmailResult> {
  const now = deps.now ?? (() => new Date());
  const config = deps.config !== undefined ? deps.config : getResendConfig();
  const to = input.to.trim().toLowerCase();
  if (!RECIPIENT.test(to) || to.length > 320) {
    return { status: "failed", logId: null, error: "Ongeldig e-mailadres" };
  }

  let store: EmailLogStore;
  try {
    store = deps.store ?? (await defaultStore());
  } catch (error) {
    // No service role: nothing can be logged, so nothing is sent (no claim, no
    // protection against sending twice). Without a provider nothing was lost.
    if (!config) return { status: "skipped_no_provider", logId: null };
    const why =
      error instanceof MissingEnvError
        ? "E-maillog niet beschikbaar (service role)"
        : describe(error);
    console.error("[sendEmail] no log store", error);
    return { status: "failed", logId: null, error: why };
  }

  const status: EmailLogStatus = config ? "queued" : "skipped_no_provider";
  const fields = {
    recipient: to,
    customer_id: input.customerId ?? null,
    invoice_id: input.invoiceId ?? null,
    order_id: input.orderId ?? null,
  };

  // 1. Claim.
  let logId: string;
  try {
    const claimed = await store.claim({
      kind: input.kind,
      idempotency_key: input.idempotencyKey,
      status,
      ...fields,
    });
    if (claimed) {
      logId = claimed;
    } else {
      const existing = await store.find(input.idempotencyKey);
      if (!existing) {
        return { status: "failed", logId: null, error: "E-maillog niet gevonden na conflict" };
      }
      if (!reclaimable(existing, now())) {
        return { status: "duplicate", logId: existing.id, previous: existing.status };
      }
      if (!config && existing.status === "skipped_no_provider") {
        return { status: "skipped_no_provider", logId: existing.id };
      }
      const won = await store.reclaim(
        existing,
        { status, error: null, provider_message_id: null, sent_at: null, ...fields },
        new Date(now().getTime() - ABANDONED_CLAIM_MS).toISOString(),
      );
      if (!won) {
        const current = await store.find(input.idempotencyKey);
        return {
          status: "duplicate",
          logId: existing.id,
          previous: current?.status ?? existing.status,
        };
      }
      logId = existing.id;
    }
  } catch (error) {
    console.error("[sendEmail] claim failed", input.kind, error);
    return { status: "failed", logId: null, error: clip(describe(error)) };
  }

  if (!config) return { status: "skipped_no_provider", logId };

  // 2. Send.
  let replyTo = config.replyTo ?? input.replyTo?.trim() ?? null;
  if (!replyTo) {
    try {
      replyTo = await store.companyEmail();
    } catch (error) {
      console.warn("[sendEmail] company e-mail for Reply-To unavailable", error);
    }
  }
  const fetchImpl = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const payload = JSON.stringify({
    from: config.from,
    to: [to],
    subject: input.subject,
    html: input.html,
    text: input.text,
    ...(replyTo ? { reply_to: replyTo } : {}),
    tags: [{ name: "kind", value: input.kind }],
  });
  let outcome: { ok: true; id: string | null } | { ok: false; error: string } = {
    ok: false,
    error: "not sent",
  };
  for (let attempt = 1; attempt <= RATE_LIMIT_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
        },
        body: payload,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      const body = (await response.json().catch(() => null)) as {
        id?: unknown;
        name?: unknown;
        message?: unknown;
      } | null;
      if (response.ok) {
        outcome = { ok: true, id: typeof body?.id === "string" ? body.id.slice(0, 200) : null };
        break;
      }
      const name = typeof body?.name === "string" ? body.name : response.statusText;
      const message = typeof body?.message === "string" ? body.message : "";
      outcome = {
        ok: false,
        error: clip(
          `Resend ${response.status}${name ? ` ${name}` : ""}${message ? `: ${message}` : ""}`,
        ),
      };
      // Resend allows a few requests per second; the same key makes a retry safe.
      if (response.status !== 429 || attempt === RATE_LIMIT_ATTEMPTS) break;
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(
        Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 3000) : 1000,
      );
    } catch (error) {
      outcome = { ok: false, error: clip(describe(error)) };
      break;
    }
  }

  // 3. Record.
  try {
    await store.finish(
      logId,
      outcome.ok
        ? {
            status: "sent",
            provider_message_id: outcome.id,
            sent_at: now().toISOString(),
            error: null,
          }
        : { status: "failed", error: outcome.error, sent_at: null },
    );
  } catch (error) {
    // The e-mail went out (or not) regardless; the row stays 'queued' and a
    // retry after ABANDONED_CLAIM_MS is answered by Resend's idempotency.
    console.error("[sendEmail] could not record the result", input.kind, error);
  }
  if (outcome.ok) return { status: "sent", logId, providerMessageId: outcome.id };
  console.warn("[sendEmail] provider refused", input.kind, outcome.error);
  return { status: "failed", logId, error: outcome.error };
}
