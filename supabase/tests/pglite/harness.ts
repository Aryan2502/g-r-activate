/// <reference types="node" />
/**
 * Local test harness: an in-process Postgres 17 (PGlite) dressed up as a fresh
 * Supabase project, with every supabase/migrations/*.sql applied the way
 * `supabase db push` applies them. Use it to prove migrations, grants and RLS
 * before they reach the real project.
 *
 * Quick start (vitest, node environment):
 *
 *   const db = await createDb();                      // stub + all migrations
 *   const alice = await createAuthUser(db, { email: "alice@example.com" });
 *   const rows = await asUser(db, alice.id, (tx) => tx.query("select * from public.orders"));
 *   await expectSqlError(asAnon(db, (tx) => tx.query("select * from public.orders")), "42501");
 *   await db.close();
 *
 * Rules that keep tests honest:
 * - `db.query(...)` runs as PGlite's superuser "postgres": like the SQL editor,
 *   it bypasses RLS. Use it for fixtures only, never to assert access rules.
 * - Inside asUser/asAnon/asService/asGoTrue (or db.transaction) use the `tx`
 *   argument. The db handle rejects calls while a transaction is open on it,
 *   because PGlite would otherwise deadlock.
 * - A failed statement aborts the whole transaction. To assert several failures
 *   in one block, wrap each in `withSavepoint(tx, ...)`, or use one block each.
 * - By default these blocks ROLLBACK; pass `{ commit: true }` to keep changes.
 */
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type { Transaction };
export type Db = PGlite;
export type ApiRole = "anon" | "authenticated" | "service_role";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STUB_PATH = path.join(HERE, "supabase-stub.sql");
export const MIGRATIONS_DIR = path.resolve(HERE, "../../migrations");

// Extensions Supabase offers but a fresh project has not installed. PGlite
// cannot load them, so `create extension` of one is replaced by its stub file,
// run at that point of the migration (see applyMigrations).
const STUBBED_EXTENSIONS = {
  pg_cron: { schema: "cron", file: path.join(HERE, "pg_cron-stub.sql") },
  pg_net: { schema: "net", file: path.join(HERE, "pg_net-stub.sql") },
} as const;
type StubbedExtension = keyof typeof STUBBED_EXTENSIONS;

// A `create extension [if not exists] pg_cron|pg_net ...;` statement starting a line.
const CREATE_STUBBED_EXTENSION =
  /^[ \t]*create\s+extension\s+(if\s+not\s+exists\s+)?"?(pg_cron|pg_net)"?(?=[\s;])[^;]*;/gim;

// pgcrypto and uuid-ossp are installed by the stub (as on Supabase); the others
// are only made available so `create extension ... with schema extensions` works.
// A migration needing any other extension must be added here first.
const EXTENSIONS = { pgcrypto, uuid_ossp, pg_trgm, citext, btree_gist, unaccent };

// The CLI only picks up `<digits>_<name>.sql`; SPEC §35.3 fixes 14 digits.
const MIGRATION_NAME = /^(\d{14})_([A-Za-z0-9_-]+)\.sql$/;

export interface MigrationFile {
  file: string;
  version: string;
  name: string;
  sql: string;
}

export class MigrationError extends Error {
  readonly file: string;
  readonly code: string | undefined;
  readonly line: number | undefined;

  constructor(file: string, err: unknown, sql: string) {
    const e = asPgError(err);
    const line = e.position ? lineOf(sql, Number(e.position)) : undefined;
    const extras = [
      e.code && `SQLSTATE ${e.code}`,
      e.detail && `DETAIL: ${e.detail}`,
      e.hint && `HINT: ${e.hint}`,
      e.where && `CONTEXT: ${e.where}`,
    ].filter(Boolean);
    super(
      `Migration ${file} failed${line ? ` at line ${line}` : ""}: ${e.message}` +
        (extras.length ? `\n  ${extras.join("\n  ")}` : ""),
      { cause: err },
    );
    this.name = "MigrationError";
    this.file = file;
    this.code = e.code;
    this.line = line;
  }
}

/** Reads `dir` like the Supabase CLI does, but fails loudly on misnamed files. */
export function listMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const seen = new Set<string>();
  return files.map((file) => {
    const m = MIGRATION_NAME.exec(file);
    if (!m) {
      throw new Error(
        `Migration file name ${file} does not match <YYYYMMDDHHMMSS>_<name>.sql; supabase db push would skip it`,
      );
    }
    const version = m[1] as string;
    if (seen.has(version)) throw new Error(`Duplicate migration version ${version} (${file})`);
    seen.add(version);
    return { file, version, name: m[2] as string, sql: readFileSync(path.join(dir, file), "utf8") };
  });
}

/**
 * Applies migrations in the given order, each in its own transaction and
 * recorded in supabase_migrations.schema_migrations, like `supabase db push`.
 * That also reproduces transaction-only failures (e.g. using an enum value
 * added by ALTER TYPE ... ADD VALUE in the same file).
 */
export async function applyMigrations(db: Db, migrations: MigrationFile[]): Promise<void> {
  for (const m of migrations) {
    try {
      await db.transaction(async (tx) => {
        await execMigrationSql(tx, m.sql);
        await tx.query(
          "insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)",
          [m.version, m.name, [m.sql]],
        );
      });
    } catch (err) {
      throw new MigrationError(m.file, err, m.sql);
    }
    // No session reset between files: the CLI pushes every file over one
    // connection, so a session-level SET in one file leaks into the next there too.
  }
}

/**
 * Runs a migration's SQL, installing the pg_cron / pg_net stub exactly where
 * the file says `create extension`. Each piece is padded with whitespace in
 * place of the text before it, so error positions still point into the file.
 * Exported for tests that replay migrations inside their own transaction
 * (e.g. idempotency checks): plain `tx.exec(sql)` would hit PGlite's missing
 * pg_cron / pg_net.
 */
export async function execMigrationSql(tx: Transaction, sql: string): Promise<void> {
  let done = 0;
  const run = async (end: number) => {
    const piece = sql.slice(done, end);
    if (piece.trim()) await tx.exec(sql.slice(0, done).replace(/[^\n]/g, " ") + piece);
  };
  for (const m of sql.matchAll(CREATE_STUBBED_EXTENSION)) {
    await run(m.index);
    await installExtensionStub(tx, m[2]!.toLowerCase() as StubbedExtension, Boolean(m[1]));
    done = m.index + m[0].length;
  }
  await run(sql.length);
}

async function installExtensionStub(
  tx: Transaction,
  name: StubbedExtension,
  ifNotExists: boolean,
): Promise<void> {
  const ext = STUBBED_EXTENSIONS[name];
  const { rows } = await tx.query<{ installed: boolean; guard: string }>(
    `select to_regnamespace($1) is not null as installed,
            coalesce(current_setting('supabase_stub.allow_reserved_ddl', true), '') as guard`,
    [ext.schema],
  );
  if (rows[0]?.installed) {
    if (ifNotExists) return;
    await tx.exec(
      `do $$ begin raise exception 'extension "${name}" already exists' using errcode = '42710'; end $$`,
    );
  }
  await tx.query("select set_config('supabase_stub.allow_reserved_ddl', 'on', true)");
  await tx.exec(readFileSync(ext.file, "utf8"));
  await tx.query("select set_config('supabase_stub.allow_reserved_ddl', $1, true)", [
    rows[0]?.guard ?? "",
  ]);
}

export interface CreateDbOptions {
  /**
   * Apply supabase/migrations/*.sql after the stub (default true). Pass false
   * for a bare Supabase project, e.g. to apply migrations one by one with
   * applyMigrations() and test a data migration against older rows.
   */
  migrations?: boolean;
}

// Booting PGlite + stub + migrations costs seconds, so each distinct input set is
// built once per worker and every createDb() restores a copy of that data dir.
const snapshots = new Map<string, Promise<Blob>>();

/** A fresh, isolated database. Call `await db.close()` when done. */
export async function createDb(options: CreateDbOptions = {}): Promise<Db> {
  const stubSql = readFileSync(STUB_PATH, "utf8");
  const migrations = options.migrations === false ? [] : listMigrations();
  const key = fingerprint(stubSql, migrations);

  let snapshot = snapshots.get(key);
  if (!snapshot) {
    snapshot = buildSnapshot(stubSql, migrations);
    snapshots.set(key, snapshot);
    snapshot.catch(() => snapshots.delete(key));
  }

  const db = new PGlite({ loadDataDir: await snapshot, extensions: EXTENSIONS });
  await db.waitReady;
  await resetSession(db);
  return guard(db);
}

async function buildSnapshot(stubSql: string, migrations: MigrationFile[]): Promise<Blob> {
  const db = new PGlite({ extensions: EXTENSIONS });
  try {
    await db.waitReady;
    await resetSession(db);
    try {
      await db.exec(stubSql);
    } catch (err) {
      throw new MigrationError("supabase/tests/pglite/supabase-stub.sql", err, stubSql);
    }
    await applyMigrations(db, migrations);
    return await db.dumpDataDir("none");
  } finally {
    await db.close();
  }
}

// What `supabase db push` gets: the postgres role's default search_path, UTC.
async function resetSession(db: Db): Promise<void> {
  await db.exec(`reset role; set search_path = "$user", public, extensions; set timezone = 'UTC';`);
}

function fingerprint(stubSql: string, migrations: MigrationFile[]): string {
  const h = createHash("sha256").update(stubSql);
  for (const ext of Object.values(STUBBED_EXTENSIONS))
    h.update("\0").update(readFileSync(ext.file));
  for (const m of migrations) h.update("\0").update(m.file).update("\0").update(m.sql);
  return h.digest("hex");
}

// ---------------------------------------------------------------------------
// Acting as Supabase's API roles
// ---------------------------------------------------------------------------

export interface RequestOptions {
  /** COMMIT instead of the default ROLLBACK. */
  commit?: boolean;
  /** Extra or overriding JWT claims, merged over the defaults. */
  claims?: Record<string, unknown>;
}

type Body<T> = (tx: Transaction) => Promise<T>;

const openBlocks = new WeakMap<PGlite, number>();

/**
 * Runs `fn` the way PostgREST runs a request with this user's access token:
 * one transaction, `role` = authenticated, `request.jwt.claims` built from the
 * auth.users row (email, app/user metadata), search_path = public, extensions.
 */
export async function asUser<T>(
  db: Db,
  userId: string,
  fn: Body<T>,
  opts: RequestOptions = {},
): Promise<T> {
  return block(db, opts, async (tx) => {
    const { rows } = await tx.query<{
      email: string | null;
      phone: string | null;
      app: Record<string, unknown> | null;
      meta: Record<string, unknown> | null;
      is_anonymous: boolean | null;
    }>(
      `select email, phone, raw_app_meta_data as app, raw_user_meta_data as meta, is_anonymous
         from auth.users where id = $1::uuid`,
      [userId],
    );
    const u = rows[0];
    await setRequest(tx, "authenticated", {
      ...baseClaims("authenticated"),
      sub: userId,
      aud: "authenticated",
      email: u?.email ?? "",
      phone: u?.phone ?? "",
      app_metadata: u?.app ?? {},
      user_metadata: u?.meta ?? {},
      aal: "aal1",
      amr: [{ method: "password", timestamp: nowSeconds() }],
      session_id: "00000000-0000-4000-8000-000000000000",
      is_anonymous: u?.is_anonymous ?? false,
      ...opts.claims,
    });
    return fn(tx);
  });
}

/** Runs `fn` like a request carrying only the anon (publishable) key. */
export async function asAnon<T>(db: Db, fn: Body<T>, opts: RequestOptions = {}): Promise<T> {
  return block(db, opts, async (tx) => {
    await setRequest(tx, "anon", { ...baseClaims("anon"), ...opts.claims });
    return fn(tx);
  });
}

/** Runs `fn` like server code using the service-role key (BYPASSRLS). */
export async function asService<T>(db: Db, fn: Body<T>, opts: RequestOptions = {}): Promise<T> {
  return block(db, opts, async (tx) => {
    await setRequest(tx, "service_role", { ...baseClaims("service_role"), ...opts.claims });
    return fn(tx);
  });
}

/**
 * Runs `fn` the way the Auth server (GoTrue) touches auth.users: as
 * supabase_auth_admin, search_path = auth, no JWT. Triggers on auth.users
 * therefore run with that role, which has no rights on public tables, so a
 * trigger function that is not SECURITY DEFINER fails here exactly as on
 * Supabase ("Database error saving new user"). Commits by default.
 */
export async function asGoTrue<T>(
  db: Db,
  fn: Body<T>,
  opts: { commit?: boolean } = {},
): Promise<T> {
  return block(db, { commit: opts.commit ?? true }, async (tx) => {
    await tx.query(
      `select set_config('request.jwt.claims', '', true),
              set_config('request.jwt.claim.sub', '', true),
              set_config('request.jwt.claim.role', '', true),
              set_config('search_path', 'auth', true)`,
    );
    await tx.exec("set local role supabase_auth_admin");
    return fn(tx);
  });
}

export interface AuthUserInput {
  email: string;
  /** Sets email_confirmed_at = now() (default true), like admin.createUser({ email_confirm: true }). */
  confirmed?: boolean;
  /** raw_user_meta_data (signUp `options.data`). */
  meta?: Record<string, unknown>;
  /** Merged over GoTrue's default raw_app_meta_data. */
  appMeta?: Record<string, unknown>;
  id?: string;
  phone?: string;
}

export interface AuthUser {
  id: string;
  email: string;
}

/** Inserts an auth.users row as GoTrue would, so auth triggers fire for real. */
export async function createAuthUser(db: Db, input: AuthUserInput): Promise<AuthUser> {
  return asGoTrue(db, async (tx) => {
    const { rows } = await tx.query<AuthUser>(
      `insert into auth.users
         (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, phone)
       values ('00000000-0000-0000-0000-000000000000', coalesce($1::uuid, gen_random_uuid()),
               'authenticated', 'authenticated', lower($2), case when $3::boolean then now() end,
               $4::jsonb, $5::jsonb, $6)
       returning id, email`,
      [
        input.id ?? null,
        input.email,
        input.confirmed ?? true,
        JSON.stringify({ provider: "email", providers: ["email"], ...input.appMeta }),
        JSON.stringify(input.meta ?? {}),
        input.phone ?? null,
      ],
    );
    const user = rows[0];
    if (!user) throw new Error("createAuthUser: insert returned no row");
    return user;
  });
}

/** The email-confirmation step of sign-up (GoTrue sets email_confirmed_at). */
export async function confirmAuthUser(db: Db, userId: string): Promise<void> {
  await asGoTrue(db, async (tx) => {
    const r = await tx.query(
      "update auth.users set email_confirmed_at = now(), updated_at = now() where id = $1::uuid",
      [userId],
    );
    if (r.affectedRows !== 1) throw new Error(`confirmAuthUser: no auth.users row ${userId}`);
  });
}

async function block<T>(db: Db, opts: { commit?: boolean }, fn: Body<T>): Promise<T> {
  const target = unwrap(db);
  if ((openBlocks.get(target) ?? 0) > 0) {
    throw new Error(
      "Nested asUser/asAnon/asService/asGoTrue on the same db: finish the outer block first",
    );
  }
  return target.transaction(async (tx) => {
    openBlocks.set(target, 1);
    try {
      const result = await fn(tx);
      if (!tx.closed) {
        // COMMIT of an aborted transaction silently rolls back; fail loudly instead.
        if (opts.commit) await tx.query("select 1");
        else await tx.rollback();
      }
      return result;
    } finally {
      openBlocks.set(target, 0);
    }
  });
}

async function setRequest(
  tx: Transaction,
  role: ApiRole,
  claims: Record<string, unknown>,
): Promise<void> {
  const sub = typeof claims["sub"] === "string" ? claims["sub"] : "";
  // Same GUCs PostgREST / the Storage API set; parameters keep claims unescaped-safe.
  await tx.query(
    `select set_config('request.jwt.claims', $1, true),
            set_config('request.jwt.claim.sub', $2, true),
            set_config('request.jwt.claim.role', $3, true),
            set_config('search_path', 'public, extensions', true)`,
    [JSON.stringify(claims), sub, role],
  );
  // `role` comes from the ApiRole union, never from test input.
  await tx.exec(`set local role ${role}`);
}

function baseClaims(role: ApiRole): Record<string, unknown> {
  const iat = nowSeconds();
  return { iss: "supabase-stub", role, iat, exp: iat + 3600 };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

export interface PgError {
  message: string;
  code?: string;
  detail?: string;
  hint?: string;
  where?: string;
  position?: string;
}

/**
 * Resolves with the error when `action` fails with the expected SQLSTATE
 * (5-character string, e.g. "42501") or a message matching the RegExp; throws
 * when it succeeds or fails differently.
 */
export async function expectSqlError(
  action: Promise<unknown> | (() => Promise<unknown>),
  expected: string | RegExp,
): Promise<PgError> {
  if (typeof expected === "string" && !/^[0-9A-Z]{5}$/.test(expected)) {
    throw new Error(
      `expectSqlError: "${expected}" is not a SQLSTATE; pass a RegExp to match messages`,
    );
  }
  try {
    await (typeof action === "function" ? action() : action);
  } catch (err) {
    const e = asPgError(err);
    const ok = typeof expected === "string" ? e.code === expected : expected.test(e.message);
    if (!ok) {
      throw new Error(
        `Expected SQL error ${String(expected)} but got ${e.code ?? "no SQLSTATE"}: ${e.message}`,
        { cause: err },
      );
    }
    return e;
  }
  throw new Error(`Expected SQL error ${String(expected)} but the statement succeeded`);
}

let savepointSeq = 0;

/** Runs `fn` inside a savepoint so a failure does not abort the surrounding block. */
export async function withSavepoint<T>(tx: Transaction, fn: () => Promise<T>): Promise<T> {
  const name = `harness_sp_${++savepointSeq}`;
  await tx.exec(`savepoint ${name}`);
  try {
    const result = await fn();
    await tx.exec(`release savepoint ${name}`);
    return result;
  } catch (err) {
    await tx.exec(`rollback to savepoint ${name}`);
    throw err;
  }
}

function asPgError(err: unknown): PgError {
  if (err && typeof err === "object" && "message" in err) {
    const e = err as Record<string, unknown>;
    const str = (k: string) => {
      const v = e[k];
      return typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
    };
    const out: PgError = { message: String(e["message"]) };
    for (const k of ["code", "detail", "hint", "where", "position"] as const) {
      const v = str(k);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return { message: String(err) };
}

function lineOf(sql: string, position: number): number {
  return sql.slice(0, Math.max(0, position - 1)).split("\n").length;
}

// ---------------------------------------------------------------------------
// Deadlock guard: PGlite serialises everything, so calling db.query() while a
// transaction is open on the same db would hang the test until it times out.
// The proxy rejects such calls instead; plain db.transaction() is tracked too.
// ---------------------------------------------------------------------------

const RAW = Symbol("pglite-raw");
const BLOCKED = new Set<PropertyKey>([
  "query",
  "exec",
  "sql",
  "transaction",
  "describeQuery",
  "runExclusive",
]);

function guard(db: PGlite): Db {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === RAW) return target;
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      if (!BLOCKED.has(prop)) return value.bind(target);
      return (...args: unknown[]) => {
        if ((openBlocks.get(target) ?? 0) > 0) {
          return Promise.reject(
            new Error(
              `db.${String(prop)}() called inside an open transaction: use its tx argument`,
            ),
          );
        }
        if (prop === "transaction") {
          const body = args[0] as (tx: Transaction) => Promise<unknown>;
          return target.transaction(async (tx) => {
            openBlocks.set(target, 1);
            try {
              return await body(tx);
            } finally {
              openBlocks.set(target, 0);
            }
          });
        }
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

function unwrap(db: Db): PGlite {
  return ((db as unknown as Record<symbol, PGlite | undefined>)[RAW] ?? db) as PGlite;
}
