// @vitest-environment node
/**
 * Migration 20261008090000_p8_reminders.sql (SPEC §35.12) against the
 * Supabase stand-in: pg_cron and pg_net enabled, exactly one daily job at
 * 12:00 UTC (09:00 Suriname) that calls private.invoke_payment_reminders(),
 * which reads app_url and cron_secret from Vault and queues one POST to the
 * cron endpoint with the bearer header, or quietly does nothing without them;
 * no function a client may call reaches pg_net (the migration does not try
 * to revoke pg_net itself: on Supabase it cannot); the orphan-upload lookup
 * is service_role only and never returns anything younger than 24 h.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type AuthUser,
  type Db,
  MIGRATIONS_DIR,
  applyMigrations,
  asAnon,
  asService,
  asUser,
  createAuthUser,
  createDb,
  expectSqlError,
} from "./harness";

const FILE = "20261008090000_p8_reminders.sql";
const SQL = readFileSync(path.join(MIGRATIONS_DIR, FILE), "utf8");

let db: Db;
let staff: AuthUser;
let alice: AuthUser;

type Row = Record<string, unknown>;

async function rows<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function setSecret(name: string, value: string | null) {
  await db.query("delete from vault.secrets where name = $1", [name]);
  if (value !== null) await db.query("select vault.create_secret($1, $2)", [value, name]);
}

async function invoke(): Promise<string | null> {
  const r = await rows<{ id: string | null }>(
    "select private.invoke_payment_reminders()::text as id",
  );
  return r[0]?.id ?? null;
}

async function queue() {
  return rows<{
    method: string;
    url: string;
    headers: Record<string, string>;
    body: unknown;
    timeout: number;
  }>(
    `select method::text, url, headers, convert_from(body, 'UTF8')::jsonb as body,
            timeout_milliseconds as timeout
       from net.http_request_queue order by id`,
  );
}

beforeAll(async () => {
  db = await createDb();
  staff = await createAuthUser(db, { email: "staff@example.com" });
  await db.query("insert into public.user_roles (user_id, role) values ($1, 'staff')", [staff.id]);
  alice = await createAuthUser(db, {
    email: "alice@example.com",
    meta: { full_name: "Alice Jansen", phone: "+597 8000001" },
  });
});

afterAll(async () => {
  await db?.close();
});

describe("schedule", () => {
  it("enables pg_cron and pg_net and schedules one daily job at 12:00 UTC (09:00 Suriname)", async () => {
    expect(
      await rows("select nspname from pg_namespace where nspname in ('cron', 'net') order by 1"),
    ).toEqual([{ nspname: "cron" }, { nspname: "net" }]);
    expect(await rows("select jobname, schedule, command, active from cron.job")).toEqual([
      {
        jobname: "gr-payment-reminders",
        schedule: "0 12 * * *",
        command: "select private.invoke_payment_reminders()",
        active: true,
      },
    ]);
  });

  it("running the migration again keeps exactly one job and removes hand-made copies", async () => {
    const own = await createDb();
    try {
      // A copy of the same call under another name, as if made in the dashboard.
      await own.query(
        "select cron.schedule('handmatig', '30 12 * * *', 'select private.invoke_payment_reminders();')",
      );
      await own.query("select cron.schedule('iets-anders', '0 3 * * *', 'select 1')");
      await applyMigrations(own, [
        { file: FILE, version: "20991231000000", name: "p8_reminders_again", sql: SQL },
      ]);
      const jobs = await own.query<{ jobname: string; schedule: string }>(
        "select jobname, schedule from cron.job order by jobname",
      );
      expect(jobs.rows).toEqual([
        { jobname: "gr-payment-reminders", schedule: "0 12 * * *" },
        { jobname: "iets-anders", schedule: "0 3 * * *" },
      ]);
    } finally {
      await own.close();
    }
  });
});

describe("private.invoke_payment_reminders()", () => {
  it("does nothing while the Vault secrets are missing, also when only one is set", async () => {
    await db.query("delete from net.http_request_queue");
    await setSecret("app_url", null);
    await setSecret("cron_secret", null);
    expect(await invoke()).toBeNull();
    await setSecret("app_url", "https://portal.example.com");
    expect(await invoke()).toBeNull();
    await setSecret("app_url", null);
    await setSecret("cron_secret", "s".repeat(40));
    expect(await invoke()).toBeNull();
    await setSecret("app_url", "   ");
    expect(await invoke()).toBeNull();
    expect(await queue()).toEqual([]);
  });

  it("queues one POST to the endpoint with the bearer secret, without a trailing slash", async () => {
    await db.query("delete from net.http_request_queue");
    const secret = "a".repeat(64);
    await setSecret("app_url", "https://portal.example.com/");
    await setSecret("cron_secret", secret);
    expect(await invoke()).not.toBeNull();
    expect(await queue()).toEqual([
      {
        method: "POST",
        url: "https://portal.example.com/api/cron/payment-reminders",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
        body: {},
        timeout: 60000,
      },
    ]);
  });

  it("refuses an app_url that is not an origin (no path, no plain http except localhost)", async () => {
    await setSecret("cron_secret", "b".repeat(40));
    for (const bad of [
      "http://portal.example.com",
      "https://portal.example.com/api",
      "https://user@evil.example.com",
      "portal.example.com",
      "https://portal.example.com?x=1",
    ]) {
      await db.query("delete from net.http_request_queue");
      await setSecret("app_url", bad);
      expect(await invoke(), bad).toBeNull();
      expect(await queue(), bad).toEqual([]);
    }
    await setSecret("app_url", "http://localhost:8080");
    expect(await invoke()).not.toBeNull();
    expect((await queue()).map((q) => q.url)).toEqual([
      "http://localhost:8080/api/cron/payment-reminders",
    ]);
    await db.query("delete from net.http_request_queue");
  });

  it("is reachable by no API role (only pg_cron, as postgres, calls it)", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(
        (
          await rows<{ ok: boolean }>(
            "select has_function_privilege($1, 'private.invoke_payment_reminders()', 'execute') as ok",
            [role],
          )
        )[0]?.ok,
        role,
      ).toBe(false);
    }
    await expectSqlError(
      asService(db, (tx) => tx.query("select private.invoke_payment_reminders()")),
      "42501",
    );
  });
});

describe("pg_net and the client roles (review P8)", () => {
  it("as on Supabase (pg_net >= 0.12): EXECUTE and USAGE stay with PUBLIC, the hook adds anon/authenticated", async () => {
    // Documented, not fixed: the migration role cannot change it on Supabase.
    expect(
      (
        await rows(
          `select has_function_privilege('anon', 'net.http_post(text, jsonb, jsonb, jsonb, integer)', 'execute') as anon_exec,
                  has_function_privilege('authenticated', 'net.http_post(text, jsonb, jsonb, jsonb, integer)', 'execute') as auth_exec,
                  has_schema_privilege('anon', 'net', 'usage') as anon_usage`,
        )
      )[0],
    ).toEqual({ anon_exec: true, auth_exec: true, anon_usage: true });
  });

  it("no function an API role may call reaches pg_net", async () => {
    const reaching = await rows<{ fn: string; role: string }>(
      `select p.oid::regprocedure::text as fn, r.role
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
        where n.nspname not in ('net', 'cron', 'pg_catalog', 'information_schema')
          and p.prosrc ~* 'net[.]http_'
          and has_function_privilege(r.role, p.oid, 'execute')`,
    );
    expect(reaching).toEqual([]);
    // The one function that does is private and pg_cron's (postgres) only.
    expect(
      await rows(
        `select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname not in ('net', 'cron') and p.prosrc ~* 'net[.]http_'`,
      ),
    ).toEqual([{ fn: "private.invoke_payment_reminders()" }]);
  });

  it("the migration does not REVOKE on net: as Supabase's non-owner postgres that only prints warnings", async () => {
    expect(SQL).not.toMatch(/^\s*revoke\b[^;]*\bschema\s+net\b/im);
    expect(SQL).not.toMatch(/^\s*revoke\b[^;]*\bnet\./im);
    expect(SQL).not.toMatch(/raise\s+warning[^;]*anon/i);

    // Why: hosted Supabase's ownership and grants, with a plain role playing
    // the "postgres" that runs `supabase db push` (PGlite's superuser plays
    // supabase_admin, the owner).
    const pg = new PGlite();
    const notices: string[] = [];
    try {
      await pg.exec(`
        create role hosted_postgres nosuperuser;
        create role anon nologin;
        create role authenticated nologin;
        create schema net;
        create function net.http_post(url text, body jsonb default '{}'::jsonb) returns bigint
          language sql as 'select 1::bigint';
        grant usage on schema net to public;
        grant usage on schema net to hosted_postgres, anon, authenticated;
      `);
      await pg.exec("set role hosted_postgres");
      await pg.exec(
        `revoke execute on all functions in schema net from anon, authenticated;
         revoke usage on schema net from anon, authenticated;`,
        { onNotice: (n) => notices.push(`${n.severity}: ${n.message}`) },
      );
      await pg.exec("reset role");
      const { rows: after } = await pg.query(
        `select has_function_privilege('anon', 'net.http_post(text, jsonb)', 'execute') as exec,
                has_schema_privilege('anon', 'net', 'usage') as usage`,
      );
      expect(after[0]).toEqual({ exec: true, usage: true });
      expect(notices).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/no privileges could be revoked for "http_post"/),
          expect.stringMatching(/no privileges could be revoked for "net"/),
        ]),
      );
    } finally {
      await pg.close();
    }
  });
});

describe("public.orphan_order_document_objects()", () => {
  async function object(name: string, bucket: string, hoursAgo: number) {
    await db.query(
      `insert into storage.objects (bucket_id, name, created_at)
       values ($1, $2, now() - make_interval(hours => $3))`,
      [bucket, name, hoursAgo],
    );
  }

  it("lists only order-documents objects older than 24 h without an order_documents row", async () => {
    const customer = (
      await rows<{ id: string }>("select id from public.customers where user_id = $1", [alice.id])
    )[0]!.id;
    const order = (
      await rows<{ id: string }>(
        `insert into public.orders (customer_id, description, store_vendor) values ($1, 'Pakket', 'Amazon') returning id`,
        [customer],
      )
    )[0]!.id;
    const kept = `${customer}/${order}/11111111-1111-4111-8111-111111111111.pdf`;
    const orphanOld = `${customer}/${order}/22222222-2222-4222-8222-222222222222.pdf`;
    const orphanFresh = `${customer}/${order}/33333333-3333-4333-8333-333333333333.pdf`;
    await object(kept, "order-documents", 48);
    await object(orphanOld, "order-documents", 30);
    await object(orphanFresh, "order-documents", 2);
    await db.query(
      "insert into storage.buckets (id, name) values ('elders', 'elders') on conflict do nothing",
    );
    await object(`${customer}/x/elders.pdf`, "elders", 72);
    await db.query(
      `insert into public.order_documents (order_id, customer_id, kind, storage_path, original_filename, mime_type, size_bytes)
       values ($1, $2, 'other', $3, 'factuur.pdf', 'application/pdf', 1000)`,
      [order, customer, kept],
    );

    const found = await asService(db, (tx) =>
      tx.query<{ name: string }>("select name from public.orphan_order_document_objects()"),
    );
    expect(found.rows.map((r) => r.name)).toEqual([orphanOld]);

    // Asking for younger files changes nothing: 24 hours is the floor.
    const young = await asService(db, (tx) =>
      tx.query<{ name: string }>("select name from public.orphan_order_document_objects(0, 10)"),
    );
    expect(young.rows.map((r) => r.name)).toEqual([orphanOld]);
  });

  it("is service_role only", async () => {
    await expectSqlError(
      asUser(db, staff.id, (tx) =>
        tx.query("select * from public.orphan_order_document_objects()"),
      ),
      "42501",
    );
    await expectSqlError(
      asAnon(db, (tx) => tx.query("select * from public.orphan_order_document_objects()")),
      "42501",
    );
  });
});

describe("e-mail log and job runs (read by the admin pages)", () => {
  it("staff read email_logs and job_runs; customers read neither; no client writes", async () => {
    await db.query(
      `insert into public.email_logs (kind, recipient, idempotency_key, status)
       values ('invoice_issued', 'alice@example.com', 'test:p8:1', 'skipped_no_provider')`,
    );
    await db.query(
      "insert into public.job_runs (job, trigger, status, finished_at) values ('payment_reminders', 'cron', 'succeeded', now())",
    );
    const seen = await asUser(db, staff.id, async (tx) => ({
      logs: (await tx.query("select id from public.email_logs where idempotency_key = 'test:p8:1'"))
        .rows.length,
      runs: (await tx.query("select id from public.job_runs where job = 'payment_reminders'")).rows
        .length,
    }));
    expect(seen).toEqual({ logs: 1, runs: 1 });
    const customer = await asUser(db, alice.id, async (tx) => ({
      logs: (await tx.query("select id from public.email_logs")).rows.length,
      runs: (await tx.query("select id from public.job_runs")).rows.length,
    }));
    expect(customer).toEqual({ logs: 0, runs: 0 });
    await expectSqlError(
      asUser(db, staff.id, (tx) =>
        tx.query(
          "insert into public.email_logs (kind, recipient, idempotency_key) values ('welcome', 'x@example.com', 'test:p8:2')",
        ),
      ),
      "42501",
    );
    await expectSqlError(
      asUser(db, staff.id, (tx) =>
        tx.query(
          "insert into public.job_runs (job, trigger) values ('payment_reminders', 'manual')",
        ),
      ),
      "42501",
    );
  });
});

describe("docs/DEPLOYMENT.md §7.2: the Vault SQL", () => {
  function vaultSql(appUrl: string, secret: string): string {
    const doc = readFileSync(path.resolve(__dirname, "../../../docs/DEPLOYMENT.md"), "utf8");
    const match =
      /<!-- vault-sql:start[^>]*-->\s*```sql\n([\s\S]*?)```\s*<!-- vault-sql:end -->/.exec(doc);
    if (!match?.[1]) throw new Error("Vault SQL block not found in docs/DEPLOYMENT.md");
    expect(match[1]).toContain("'<https://prod-domain>'");
    expect(match[1]).toContain("'<same value as CRON_SECRET>'");
    return match[1]
      .replaceAll("<https://prod-domain>", appUrl)
      .replaceAll("<same value as CRON_SECRET>", secret);
  }

  it("run as written in the SQL editor, it arms the job", async () => {
    await setSecret("app_url", null);
    await setSecret("cron_secret", null);
    await db.query("delete from net.http_request_queue");
    const secret = "c".repeat(64);
    await db.exec(vaultSql("https://portal.example.com", secret));
    expect(await invoke()).not.toBeNull();
    expect(await queue()).toMatchObject([
      {
        url: "https://portal.example.com/api/cron/payment-reminders",
        headers: { Authorization: `Bearer ${secret}` },
      },
    ]);
  });
});
