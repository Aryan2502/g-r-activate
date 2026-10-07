// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Db,
  type MigrationFile,
  MigrationError,
  applyMigrations,
  asAnon,
  asGoTrue,
  asService,
  asUser,
  confirmAuthUser,
  createAuthUser,
  createDb,
  expectSqlError,
  listMigrations,
  withSavepoint,
} from "./harness";

// Most checks share one stub-only database (no project migrations) and rely on
// the default ROLLBACK of the as* helpers; tests that commit create their own.
let db: Db;

beforeAll(async () => {
  db = await createDb({ migrations: false });
});

afterAll(async () => {
  await db?.close();
});

async function one<T>(q: Promise<{ rows: T[] }>): Promise<T> {
  const { rows } = await q;
  expect(rows).toHaveLength(1);
  return rows[0] as T;
}

describe("supabase stub", () => {
  it("runs Postgres 17 like the hosted project", async () => {
    const r = await one(
      db.query<{ v: string }>("select current_setting('server_version_num') as v"),
    );
    expect(r.v.slice(0, 2)).toBe("17");
  });

  it("creates Supabase's roles and schemas", async () => {
    const roles = await db.query<{
      rolname: string;
      rolcanlogin: boolean;
      rolbypassrls: boolean;
      rolsuper: boolean;
    }>(
      `select rolname, rolcanlogin, rolbypassrls, rolsuper from pg_roles
        where rolname in ('anon', 'authenticated', 'service_role', 'supabase_auth_admin', 'supabase_storage_admin')
        order by rolname`,
    );
    expect(roles.rows).toEqual([
      { rolname: "anon", rolcanlogin: false, rolbypassrls: false, rolsuper: false },
      { rolname: "authenticated", rolcanlogin: false, rolbypassrls: false, rolsuper: false },
      { rolname: "service_role", rolcanlogin: false, rolbypassrls: true, rolsuper: false },
      { rolname: "supabase_auth_admin", rolcanlogin: true, rolbypassrls: false, rolsuper: false },
      {
        rolname: "supabase_storage_admin",
        rolcanlogin: true,
        rolbypassrls: false,
        rolsuper: false,
      },
    ]);

    const schemas = await db.query<{ nspname: string }>(
      `select nspname from pg_namespace
        where nspname in ('auth', 'storage', 'extensions', 'vault', 'cron', 'net', 'supabase_migrations')
        order by 1`,
    );
    // pg_cron and pg_net are available on Supabase but not installed in a
    // fresh project: their schemas appear only once a migration enables them.
    expect(schemas.rows.map((r) => r.nspname)).toEqual([
      "auth",
      "extensions",
      "storage",
      "supabase_migrations",
      "vault",
    ]);
  });

  it("has pgcrypto/uuid-ossp in extensions and built-in sha256", async () => {
    const r = await one(
      db.query<{ a: string; b: string; uuid: string }>(
        `select encode(extensions.digest('x', 'sha256'), 'hex') as a,
                encode(sha256('x'::bytea), 'hex') as b,
                extensions.uuid_generate_v4()::text as uuid`,
      ),
    );
    expect(r.a).toBe(r.b);
    expect(r.uuid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("enables RLS on storage tables and provides storage.foldername()", async () => {
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'storage' and c.relkind = 'r' order by 1`,
    );
    expect(rls.rows).toEqual([
      { relname: "buckets", relrowsecurity: true },
      { relname: "objects", relrowsecurity: true },
    ]);
    const r = await one(
      db.query<{ f: string[] }>("select storage.foldername('cust-1/order-2/doc.pdf') as f"),
    );
    expect(r.f).toEqual(["cust-1", "order-2"]);
  });

  it("stubs vault", async () => {
    await db.transaction(async (tx) => {
      await tx.query("select vault.create_secret('s3cret', 'cron_secret')");
      const s = await tx.query<{ v: string }>(
        "select decrypted_secret as v from vault.decrypted_secrets where name = 'cron_secret'",
      );
      expect(s.rows[0]?.v).toBe("s3cret");
      await tx.rollback();
    });
  });

  it("refuses direct deletes from storage tables unless the session opts in like the Storage API", async () => {
    for (const sql of [
      "delete from storage.objects where bucket_id = 'no-such-bucket'",
      "delete from storage.buckets where id = 'no-such-bucket'",
    ]) {
      // Even the SQL editor, and even when no row matches.
      const err = await expectSqlError(db.query(sql), "42501");
      expect(err.message).toMatch(/Use the Storage API/);
      await expectSqlError(
        asService(db, (tx) => tx.query(sql)),
        "42501",
      );
      await db.transaction(async (tx) => {
        await tx.query("select set_config('storage.allow_delete_query', 'true', true)");
        expect((await tx.query(sql)).affectedRows).toBe(0);
        await tx.rollback();
      });
    }
  });

  it("keeps vault and auth.users away from the API roles", async () => {
    await expectSqlError(
      asService(db, (tx) => tx.query("select * from vault.decrypted_secrets")),
      "42501",
    );
    await expectSqlError(
      asUser(db, crypto.randomUUID(), (tx) => tx.query("select * from auth.users")),
      "42501",
    );
  });
});

describe("request context (asUser / asAnon / asService)", () => {
  it("makes auth.uid(), auth.role(), auth.jwt() behave like PostgREST", async () => {
    const alice = await createAuthUser(db, {
      email: "Alice@Example.com",
      meta: { full_name: "Alice" },
    });
    expect(alice.email).toBe("alice@example.com");

    const ctx = await asUser(db, alice.id, (tx) =>
      one(
        tx.query<{ uid: string; role: string; email: string; meta: unknown; cur: string }>(
          `select auth.uid()::text as uid, auth.role() as role, auth.jwt() ->> 'email' as email,
                  auth.jwt() -> 'user_metadata' as meta, current_user::text as cur`,
        ),
      ),
    );
    expect(ctx).toEqual({
      uid: alice.id,
      role: "authenticated",
      email: "alice@example.com",
      meta: { full_name: "Alice" },
      cur: "authenticated",
    });

    const anon = await asAnon(db, (tx) =>
      one(
        tx.query<{ uid: string | null; role: string; cur: string }>(
          "select auth.uid() as uid, auth.role() as role, current_user::text as cur",
        ),
      ),
    );
    expect(anon).toEqual({ uid: null, role: "anon", cur: "anon" });

    const svc = await asService(db, (tx) =>
      one(
        tx.query<{ role: string; cur: string }>(
          "select auth.role() as role, current_user::text as cur",
        ),
      ),
    );
    expect(svc).toEqual({ role: "service_role", cur: "service_role" });

    // Everything is transaction-local: back to the superuser with no JWT.
    const after = await one(
      db.query<{ uid: string | null; cur: string }>(
        "select auth.uid() as uid, current_user::text as cur",
      ),
    );
    expect(after).toEqual({ uid: null, cur: "postgres" });
  });

  it("lets tests override claims", async () => {
    const r = await asUser(
      db,
      crypto.randomUUID(),
      (tx) => one(tx.query<{ aal: string }>("select auth.jwt() ->> 'aal' as aal")),
      { claims: { aal: "aal2" } },
    );
    expect(r.aal).toBe("aal2");
  });

  it("refuses to use the db handle inside a block instead of hanging", async () => {
    await expect(asAnon(db, () => db.query("select 1"))).rejects.toThrow(/use its tx argument/);
    await expect(db.transaction(() => db.query("select 1"))).rejects.toThrow(/use its tx argument/);
    await expect(asAnon(db, () => asAnon(db, async () => 1))).rejects.toThrow(/Nested/);
    // The db is usable again afterwards.
    expect((await db.query("select 1 as x")).rows).toEqual([{ x: 1 }]);
  });
});

describe("Supabase defaults that migrations must override", () => {
  it("anon/authenticated see nothing in an RLS table without policies; service_role bypasses", async () => {
    await db.exec(`
      create table public.harness_rls (id int primary key, note text);
      alter table public.harness_rls enable row level security;
      insert into public.harness_rls values (1, 'secret');
    `);
    try {
      const user = await createAuthUser(db, { email: "rls@example.com" });
      expect((await asAnon(db, (tx) => tx.query("select * from public.harness_rls"))).rows).toEqual(
        [],
      );
      expect(
        (await asUser(db, user.id, (tx) => tx.query("select * from public.harness_rls"))).rows,
      ).toEqual([]);
      expect(
        (await asService(db, (tx) => tx.query("select * from public.harness_rls"))).rows,
      ).toHaveLength(1);
      // Default privileges allow the INSERT, RLS rejects the row (also 42501).
      await expectSqlError(
        asAnon(db, (tx) => tx.query("insert into public.harness_rls values (2, 'x')")),
        /row-level security/,
      );
    } finally {
      await db.exec("drop table public.harness_rls");
    }
  });

  it("grants ALL on new public tables, sequences and functions to the API roles", async () => {
    await db.exec(`
      create table public.harness_defaults (id bigint generated by default as identity primary key);
      create function public.harness_fn() returns int language sql as 'select 1';
      create schema harness_private;
      create table harness_private.t (id int);
    `);
    try {
      const r = await one(
        db.query<Record<string, boolean>>(`
          select has_table_privilege('anon', 'public.harness_defaults', 'select,insert,update,delete') as anon_tbl,
                 has_table_privilege('authenticated', 'public.harness_defaults', 'truncate') as auth_truncate,
                 has_sequence_privilege('authenticated', 'public.harness_defaults_id_seq', 'usage') as auth_seq,
                 has_function_privilege('anon', 'public.harness_fn()', 'execute') as anon_fn,
                 has_schema_privilege('anon', 'harness_private', 'usage') as anon_private_schema,
                 has_table_privilege('anon', 'harness_private.t', 'select') as anon_private_tbl`),
      );
      expect(r).toEqual({
        anon_tbl: true,
        auth_truncate: true,
        auth_seq: true,
        anon_fn: true,
        anon_private_schema: false,
        anon_private_tbl: false,
      });

      // ...so access only disappears once a migration revokes it.
      await db.exec("revoke all on public.harness_defaults from anon, authenticated");
      await expectSqlError(
        asAnon(db, (tx) => tx.query("select * from public.harness_defaults")),
        "42501",
      );
      await expectSqlError(
        asAnon(db, (tx) => tx.query("select * from public.harness_defaults")),
        /permission denied for table harness_defaults/,
      );
    } finally {
      await db.exec(`
        drop table public.harness_defaults;
        drop function public.harness_fn();
        drop schema harness_private cascade;
      `);
    }
  });

  it("rejects DDL that Supabase refuses in its managed schemas", async () => {
    await expectSqlError(db.query("create index on auth.users (created_at)"), "42501");
    await expectSqlError(
      db.query("alter table storage.objects enable row level security"),
      /storage\.objects/,
    );
    await expectSqlError(db.query("create table auth.extra (id int)"), "42501");

    // ...but allows what Supabase allows: auth triggers and storage policies.
    await db.transaction(async (tx) => {
      await tx.exec(`
        create function public.harness_noop() returns trigger language plpgsql security definer
          set search_path = '' as $$ begin return new; end $$;
        drop trigger if exists harness_t on auth.users;
        create trigger harness_t after insert on auth.users for each row execute function public.harness_noop();
        create policy harness_p on storage.objects for select to authenticated
          using (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text);
        drop policy harness_p on storage.objects;
        drop function public.harness_noop() cascade;
      `);
      await tx.rollback();
    });
  });
});

describe("auth.users triggers run like GoTrue", () => {
  it("fires as supabase_auth_admin: SECURITY INVOKER trigger functions fail, DEFINER ones work", async () => {
    const own = await createDb({ migrations: false });
    try {
      await own.exec(`
        create table public.harness_profiles (id uuid primary key, by_role text, confirmed boolean);
        create function public.harness_invoker() returns trigger language plpgsql as $$
          begin insert into public.harness_profiles values (new.id, current_user, false); return new; end $$;
        create trigger harness_invoker after insert on auth.users
          for each row execute function public.harness_invoker();
      `);
      // The classic "Database error saving new user".
      await expectSqlError(createAuthUser(own, { email: "a@example.com" }), "42501");

      await own.exec(`
        drop trigger harness_invoker on auth.users;
        create function public.harness_definer() returns trigger language plpgsql security definer
          set search_path = '' as $$
          begin
            insert into public.harness_profiles values (new.id, current_user, new.email_confirmed_at is not null)
            on conflict (id) do update set confirmed = excluded.confirmed;
            return new;
          end $$;
        create trigger harness_definer after insert or update of email_confirmed_at on auth.users
          for each row execute function public.harness_definer();
      `);
      const u = await createAuthUser(own, { email: "b@example.com", confirmed: false });
      // A definer function runs as its owner (postgres), whoever fired the trigger.
      expect(
        (
          await own.query("select by_role, confirmed from public.harness_profiles where id = $1", [
            u.id,
          ])
        ).rows,
      ).toEqual([{ by_role: "postgres", confirmed: false }]);
      await confirmAuthUser(own, u.id);
      expect(
        (await own.query("select confirmed from public.harness_profiles where id = $1", [u.id]))
          .rows,
      ).toEqual([{ confirmed: true }]);

      const ctx = await asGoTrue(own, (tx) =>
        one(
          tx.query<{ cur: string; uid: string | null }>(
            "select current_user::text as cur, auth.uid() as uid",
          ),
        ),
      );
      expect(ctx).toEqual({ cur: "supabase_auth_admin", uid: null });
    } finally {
      await own.close();
    }
  });
});

describe("transactions and assertions", () => {
  it("rolls back by default and commits on request", async () => {
    const own = await createDb({ migrations: false });
    try {
      await own.exec(`
        create table public.harness_tx (id int);
        alter table public.harness_tx enable row level security;
        create policy harness_tx_all on public.harness_tx for all to authenticated using (true) with check (true);
      `);
      const u = await createAuthUser(own, { email: "tx@example.com" });
      await asUser(own, u.id, (tx) => tx.query("insert into public.harness_tx values (1)"));
      expect((await own.query("select count(*)::int as n from public.harness_tx")).rows).toEqual([
        { n: 0 },
      ]);
      await asUser(own, u.id, (tx) => tx.query("insert into public.harness_tx values (2)"), {
        commit: true,
      });
      expect((await own.query("select count(*)::int as n from public.harness_tx")).rows).toEqual([
        { n: 1 },
      ]);
    } finally {
      await own.close();
    }
  });

  it("refuses to report a commit when the transaction was aborted", async () => {
    await expect(
      asAnon(
        db,
        async (tx) => {
          await tx.query("select 1/0").catch(() => undefined);
        },
        { commit: true },
      ),
    ).rejects.toThrow(/current transaction is aborted/);
  });

  it("withSavepoint allows several expected failures in one block", async () => {
    await asAnon(db, async (tx) => {
      await expectSqlError(
        withSavepoint(tx, () => tx.query("select * from vault.secrets")),
        "42501",
      );
      await expectSqlError(
        withSavepoint(tx, () => tx.query("select 1/0")),
        "22012",
      );
      expect((await tx.query("select current_user::text as cur")).rows).toEqual([{ cur: "anon" }]);
    });
  });

  it("expectSqlError fails when the statement succeeds or fails differently", async () => {
    await expect(expectSqlError(db.query("select 1"), "42501")).rejects.toThrow(/succeeded/);
    await expect(expectSqlError(db.query("select 1/0"), "42501")).rejects.toThrow(/22012/);
    await expect(expectSqlError(db.query("select 1"), "permission denied")).rejects.toThrow(
      /not a SQLSTATE/,
    );
  });
});

describe("migrations", () => {
  const mig = (file: string, sql: string): MigrationFile => {
    const [version = "", ...rest] = file.replace(/\.sql$/, "").split("_");
    return { file, version, name: rest.join("_"), sql };
  };

  it("applies files in order, one transaction each, and names the failing file and line", async () => {
    const own = await createDb({ migrations: false });
    try {
      const err = await applyMigrations(own, [
        mig("20260101000000_one.sql", "create table public.m1 (id int);"),
        mig(
          "20260101000001_two.sql",
          "create table public.m2 (id int);\n-- comment\nselect nope from public.m2;\n",
        ),
        mig("20260101000002_three.sql", "create table public.m3 (id int);"),
      ]).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(MigrationError);
      expect((err as MigrationError).message).toMatch(
        /^Migration 20260101000001_two\.sql failed at line 3: column "nope"/,
      );
      expect((err as MigrationError).code).toBe("42703");

      const tables = await own.query<{ t: string }>(
        "select tablename as t from pg_tables where schemaname = 'public' and tablename like 'm_' order by 1",
      );
      expect(tables.rows.map((r) => r.t)).toEqual(["m1"]); // m2 rolled back, m3 never ran
      const history = await own.query<{ version: string }>(
        "select version from supabase_migrations.schema_migrations order by 1",
      );
      expect(history.rows.map((r) => r.version)).toEqual(["20260101000000"]);
    } finally {
      await own.close();
    }
  });

  it("reproduces in-transaction restrictions of supabase db push", async () => {
    const own = await createDb({ migrations: false });
    try {
      // A new enum value cannot be used in the transaction that added it.
      await expectSqlError(
        applyMigrations(own, [
          mig("20260101000000_enum.sql", "create type public.e as enum ('a');"),
          mig(
            "20260101000001_enum_b.sql",
            "alter type public.e add value 'b';\nselect 'b'::public.e;",
          ),
        ]),
        "55P04",
      );
    } finally {
      await own.close();
    }
  });

  it("has no cron or net until a migration enables pg_cron / pg_net, as on a fresh project", async () => {
    const own = await createDb({ migrations: false });
    try {
      // The scheduler migration of SPEC §35.12 without its create-extension
      // lines fails here as it would in `supabase db push`.
      await expectSqlError(
        applyMigrations(own, [
          mig("20260101000000_jobs.sql", "select cron.schedule('j', '0 12 * * *', 'select 1');"),
        ]),
        "3F000",
      );
      await expectSqlError(
        applyMigrations(own, [
          mig("20260101000000_http.sql", "select net.http_post('https://example.com');"),
        ]),
        "3F000",
      );
    } finally {
      await own.close();
    }
  });

  it("installs the pg_cron and pg_net stubs where a migration creates the extensions", async () => {
    const own = await createDb({ migrations: false });
    try {
      await applyMigrations(own, [
        mig(
          "20260101000000_scheduler.sql",
          `-- create extension pg_cron;  (a comment is not a statement)
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
select cron.schedule('payment-reminders', '0 12 * * *', $$select 1$$);
select net.http_post('https://app.example.com/api/cron/x', '{"a":1}'::jsonb,
  headers := '{"Authorization": "Bearer t"}'::jsonb);`,
        ),
        // A later file may say it again with "if not exists".
        mig("20260101000001_again.sql", "create extension if not exists pg_cron;"),
      ]);

      const job = await one(
        own.query<{ id: string; jobname: string; schedule: string }>(
          "select jobid::text as id, jobname, schedule from cron.job",
        ),
      );
      expect(job).toMatchObject({ jobname: "payment-reminders", schedule: "0 12 * * *" });
      // Scheduling the same name again updates that job.
      const again = await one(
        own.query<{ id: string }>(
          "select cron.schedule('payment-reminders', '5 12 * * *', 'select 2')::text as id",
        ),
      );
      expect(again.id).toBe(job.id);

      // pg_net's real queue: an enum method, required headers, a bytea body.
      const q = await one(
        own.query<{ method: string; type: string; body: unknown; headers: unknown }>(
          `select method::text, format_type(a.atttypid, a.atttypmod) as type,
                  convert_from(q.body, 'UTF8')::jsonb as body, q.headers
             from net.http_request_queue q
             join pg_attribute a on a.attrelid = 'net.http_request_queue'::regclass and a.attname = 'body'`,
        ),
      );
      expect(q).toEqual({
        method: "POST",
        type: "bytea",
        body: { a: 1 },
        headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      });
      expect(
        (
          await one(
            own.query<{ n: boolean }>(
              "select to_regclass('net.http_request_queue') is not null and not exists (select 1 from pg_attribute where attrelid = 'net.http_request_queue'::regclass and attname = 'created_at') as n",
            ),
          )
        ).n,
      ).toBe(true);

      // As on Supabase (pg_net >= 0.12 + its grant_pg_net_access hook): the API
      // roles may call pg_net once it is enabled, and a migration (run as the
      // non-owner postgres there) cannot revoke it. Clients are kept out by
      // `net` not being an exposed schema of the Data API.
      const rights = await one(
        own.query<{ anon: boolean; authenticated: boolean }>(
          `select has_function_privilege('anon', 'net.http_post(text, jsonb, jsonb, jsonb, integer)', 'execute') as anon,
                  has_function_privilege('authenticated', 'net.http_post(text, jsonb, jsonb, jsonb, integer)', 'execute') as authenticated`,
        ),
      );
      expect(rights).toEqual({ anon: true, authenticated: true });

      // postgres reads cron.job but changes jobs only through the functions.
      for (const sql of [
        "insert into cron.job (schedule, command, jobname) values ('* * * * *', 'select 1', 'x')",
        "update cron.job set active = false",
        "delete from cron.job",
      ]) {
        await expectSqlError(own.query(sql), "42501");
      }
      await expectSqlError(
        own.query("select cron.unschedule('does-not-exist')"),
        /could not find valid entry/,
      );
      await expectSqlError(
        own.query("select cron.schedule('x', '* * *', 'select 1')"),
        /invalid schedule/,
      );
      expect(
        (await one(own.query<{ ok: boolean }>("select cron.unschedule('payment-reminders') as ok")))
          .ok,
      ).toBe(true);
      // The API roles cannot reach the scheduler at all.
      await expectSqlError(
        asService(own, (tx) => tx.query("select * from cron.job")),
        "42501",
      );
      // Cron and net stay managed schemas: no tables of our own in them.
      await expectSqlError(own.query("create table cron.mine (id int)"), "42501");
    } finally {
      await own.close();
    }
  });

  it("creating an installed extension again fails like Postgres, at the right line", async () => {
    const own = await createDb({ migrations: false });
    try {
      const err = await applyMigrations(own, [
        mig("20260101000000_net.sql", "create extension pg_net;"),
        mig("20260101000001_net_again.sql", "select 1;\n\ncreate extension pg_net;\n"),
      ]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MigrationError);
      expect((err as MigrationError).code).toBe("42710");

      const late = await applyMigrations(own, [
        mig(
          "20260101000002_after.sql",
          "create extension if not exists pg_cron;\nselect 1;\nselect nope from cron.job;\n",
        ),
      ]).catch((e: unknown) => e);
      expect((late as MigrationError).message).toMatch(/at line 3: column "nope"/);
    } finally {
      await own.close();
    }
  });

  it("rejects migration files the CLI would silently skip", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "harness-mig-"));
    try {
      writeFileSync(path.join(dir, "20260101000000_ok.sql"), "select 1;");
      expect(listMigrations(dir).map((m) => m.version)).toEqual(["20260101000000"]);
      writeFileSync(path.join(dir, "create_tables.sql"), "select 1;");
      expect(() => listMigrations(dir)).toThrow(/does not match/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies every file in supabase/migrations cleanly", async () => {
    const files = listMigrations();
    const full = await createDb();
    try {
      const history = await full.query<{ version: string }>(
        "select version from supabase_migrations.schema_migrations order by 1",
      );
      expect(history.rows.map((r) => r.version)).toEqual(files.map((f) => f.version));
    } finally {
      await full.close();
    }
  });
});
