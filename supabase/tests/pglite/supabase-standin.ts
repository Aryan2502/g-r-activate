/// <reference types="node" />
/**
 * A small supabase-js stand-in for contract tests: the app's own query and
 * RPC code runs unchanged against PGlite with a user's access, each request
 * its own committed transaction as `authenticated` (asUser), so RLS, the
 * column grants, the triggers and the RPC guards behave as in production.
 *
 * Supported: from(table).select(columns or `*`, with many-to-one embeds such
 * as `order:orders(reference)`, also next to `*`), insert/upsert(…, { onConflict, ignoreDuplicates:
 * true })/update/delete, eq/neq/in/is/not(…,'is',null)/gt/gte/lt/lte,
 * order, range, limit, single, maybeSingle; rpc(name, args) returns the row
 * (a function returning one composite) or the rows (a set-returning function)
 * as PostgREST does. Rows come back as PostgREST sends them: numeric as
 * numbers, dates as 'YYYY-MM-DD', instants as ISO strings, json as objects.
 */
import { type Db, type Transaction, asService, asUser, withSavepoint } from "./harness";

type Row = Record<string, unknown>;
export type DbResult = { data: unknown; error: unknown };
type Run = (sql: string, params: unknown[]) => Promise<{ rows: Row[] } | { error: unknown }>;

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (name: string) => {
  if (!IDENT.test(name)) throw new Error(`bad identifier ${name}`);
  return name;
};

/** Splits a select list on top-level commas (not inside an embed's parentheses). */
function splitColumns(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of list) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

let aliasSeq = 0;

/**
 * A select list as SQL over `from` (the table alias). An embed
 * `alias:table(cols)` is a many-to-one join through `<alias>_id`, as the
 * app's embeds are; RLS applies to the embedded table as in PostgREST.
 */
function selectSql(list: string, from: string): string {
  if (list.trim() === "*") return `${from}.*`;
  return splitColumns(list)
    .map((item) => {
      if (item === "*") return `${from}.*`;
      const embed = /^([a-z_]+):([a-z_]+)(?:!inner)?\((.*)\)$/s.exec(item);
      if (!embed) return `${from}.${ident(item)}`;
      const [, alias = "", table = "", cols = ""] = embed;
      const t = `e${(aliasSeq += 1)}`;
      const fields = splitColumns(cols)
        .map((c) => {
          const nested = /^([a-z_]+):/.exec(c);
          const key = nested?.[1] ?? c;
          const sql = nested ? selectSql(c, t) : `${t}.${ident(c)}`;
          return `'${ident(key)}', ${nested ? sql.replace(/ as "[a-z_]+"$/, "") : sql}`;
        })
        .join(", ");
      return `(select json_build_object(${fields}) from public.${ident(table)} ${t} where ${t}.id = ${from}.${ident(alias)}_id) as "${ident(alias)}"`;
    })
    .join(", ");
}

class Query implements PromiseLike<DbResult> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  /** upsert(…, { onConflict, ignoreDuplicates: true }): on conflict (…) do nothing. */
  private conflict: string | null = null;
  private cols = "*";
  private returning: string | null = null;
  private values: Row[] = [];
  private where: string[] = [];
  private params: unknown[] = [];
  private orderBy: string[] = [];
  private window = "";

  constructor(
    private readonly run: Run,
    private readonly table: string,
  ) {}

  select(list = "*") {
    if (this.op === "select") this.cols = list;
    else this.returning = list;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.values = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row | Row[], opts: { onConflict: string; ignoreDuplicates: true }) {
    if (!opts.ignoreDuplicates) throw new Error("upsert() supports ignoreDuplicates only");
    this.op = "insert";
    this.values = Array.isArray(rows) ? rows : [rows];
    this.conflict = opts.onConflict
      .split(",")
      .map((c) => ident(c.trim()))
      .join(", ");
    return this;
  }
  update(row: Row) {
    this.op = "update";
    this.values = [row];
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  private param(v: unknown) {
    this.params.push(v);
    return `$${this.params.length}`;
  }
  eq(c: string, v: unknown) {
    this.where.push(`t.${ident(c)} = ${this.param(v)}`);
    return this;
  }
  neq(c: string, v: unknown) {
    this.where.push(`t.${ident(c)} <> ${this.param(v)}`);
    return this;
  }
  in(c: string, v: unknown[]) {
    this.where.push(`t.${ident(c)} = any(${this.param(v)})`);
    return this;
  }
  is(c: string, v: null) {
    if (v !== null) throw new Error("is() supports null only");
    this.where.push(`t.${ident(c)} is null`);
    return this;
  }
  gt(c: string, v: unknown) {
    this.where.push(`t.${ident(c)} > ${this.param(v)}`);
    return this;
  }
  gte(c: string, v: unknown) {
    this.where.push(`t.${ident(c)} >= ${this.param(v)}`);
    return this;
  }
  lt(c: string, v: unknown) {
    this.where.push(`t.${ident(c)} < ${this.param(v)}`);
    return this;
  }
  lte(c: string, v: unknown) {
    this.where.push(`t.${ident(c)} <= ${this.param(v)}`);
    return this;
  }
  not(c: string, op: "is", v: null) {
    if (op !== "is" || v !== null) throw new Error("not() supports ('is', null) only");
    this.where.push(`t.${ident(c)} is not null`);
    return this;
  }
  order(c: string, opts: { ascending?: boolean } = {}) {
    this.orderBy.push(`t.${ident(c)} ${opts.ascending === false ? "desc" : "asc"}`);
    return this;
  }
  range(from: number, to: number) {
    this.window = ` limit ${to - from + 1} offset ${from}`;
    return this;
  }
  limit(n: number) {
    this.window = ` limit ${n}`;
    return this;
  }

  private sql(): { sql: string; params: unknown[] } {
    const table = `public.${ident(this.table)}`;
    const where = this.where.length ? ` where ${this.where.join(" and ")}` : "";
    const returning = ` returning ${this.returning ? selectSql(this.returning, "t") : "*"}`;
    if (this.op === "select") {
      const order = this.orderBy.length ? ` order by ${this.orderBy.join(", ")}` : "";
      return {
        sql: `select ${selectSql(this.cols, "t")} from ${table} t${where}${order}${this.window}`,
        params: this.params,
      };
    }
    if (this.op === "delete") {
      return { sql: `delete from ${table} t${where}${returning}`, params: this.params };
    }
    const keys = [...new Set(this.values.flatMap((r) => Object.keys(r)))].map(ident);
    if (this.op === "insert") {
      const params: unknown[] = [];
      const tuples = this.values.map(
        (r) =>
          `(${keys
            .map((k) => {
              params.push(r[k] ?? null);
              return `$${params.length}`;
            })
            .join(", ")})`,
      );
      const conflict = this.conflict ? ` on conflict (${this.conflict}) do nothing` : "";
      return {
        sql: `insert into ${table} as t (${keys.join(", ")}) values ${tuples.join(", ")}${conflict}${returning}`,
        params,
      };
    }
    const row = this.values[0] ?? {};
    const shift = (s: string) =>
      s.replace(/\$(\d+)/g, (_, d: string) => `$${Number(d) + keys.length}`);
    const shifted = this.where.length ? ` where ${this.where.map(shift).join(" and ")}` : "";
    return {
      sql: `update ${table} as t set ${keys.map((k, i) => `${k} = $${i + 1}`).join(", ")}${shifted}${returning}`,
      params: [...keys.map((k) => row[k]), ...this.params],
    };
  }

  private rows() {
    const { sql, params } = this.sql();
    return this.run(sql, params);
  }

  async single(): Promise<DbResult> {
    const r = await this.rows();
    if ("error" in r) return { data: null, error: r.error };
    if (r.rows.length !== 1) return { data: null, error: { code: "PGRST116", message: "0 rows" } };
    return { data: r.rows[0], error: null };
  }

  async maybeSingle(): Promise<DbResult> {
    const r = await this.rows();
    if ("error" in r) return { data: null, error: r.error };
    return { data: r.rows[0] ?? null, error: null };
  }

  then<A = DbResult, B = never>(
    onfulfilled?: ((value: DbResult) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.rows()
      .then((r) => ("error" in r ? { data: null, error: r.error } : { data: r.rows, error: null }))
      .then(onfulfilled, onrejected);
  }
}

const NUMERIC_OID = 1700;
const DATE_OID = 1082;

function asJson(result: { rows: Row[]; fields: { name: string; dataTypeID: number }[] }): Row[] {
  const numeric = new Set(
    result.fields.filter((f) => f.dataTypeID === NUMERIC_OID).map((f) => f.name),
  );
  const dates = new Set(result.fields.filter((f) => f.dataTypeID === DATE_OID).map((f) => f.name));
  return result.rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value instanceof Date
          ? dates.has(key)
            ? value.toISOString().slice(0, 10)
            : value.toISOString()
          : numeric.has(key) && typeof value === "string"
            ? Number(value)
            : value,
      ]),
    ),
  );
}

function pgError(error: unknown) {
  const e = error as { code?: string; message?: string; hint?: string; detail?: string };
  return {
    code: e.code ?? null,
    message: e.message ?? String(error),
    hint: e.hint ?? null,
    details: e.detail ?? null,
  };
}

/** A supabase-js-like client acting as this user (or, for userId null, refusing everything). */
export function userClient(db: Db, userId: string) {
  return clientFor(db, (fn) => asUser(db, userId, fn, { commit: true }));
}

/** supabaseAdmin's SQL side: the service-role key (BYPASSRLS, its own grants). */
export function serviceClient(db: Db) {
  return clientFor(db, (fn) => asService(db, fn, { commit: true }));
}

function clientFor(db: Db, as: (fn: (tx: Transaction) => Promise<unknown>) => Promise<unknown>) {
  const run: Run = async (sql, params) => {
    try {
      const result = (await as((tx: Transaction) =>
        withSavepoint(tx, () => tx.query<Row>(sql, params)),
      )) as { rows: Row[]; fields: { name: string; dataTypeID: number }[] };
      return { rows: asJson(result) };
    } catch (error) {
      return { error: pgError(error) };
    }
  };
  return {
    from: (table: string) => new Query(run, table),
    async rpc(name: string, args: Record<string, unknown> = {}): Promise<DbResult> {
      const fn = ident(name);
      const meta = await db.query<{ proretset: boolean }>(
        "select p.proretset from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1",
        [fn],
      );
      const keys = Object.keys(args).map(ident);
      const r = await run(
        `select * from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`,
        keys.map((k) => args[k]),
      );
      if ("error" in r) return { data: null, error: r.error };
      return meta.rows[0]?.proretset
        ? { data: r.rows, error: null }
        : { data: r.rows[0] ?? null, error: null };
    },
  };
}
