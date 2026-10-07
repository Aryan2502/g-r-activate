import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

/**
 * A read-only, in-memory stand-in for the supabase-js query builder, for
 * unit tests of server code that reads with `db.from(table)…`. Filters:
 * eq, neq, in, is(null), gt, gte, lt, lte; then order, limit, single,
 * maybeSingle or await. Rows come back whole (the select list is ignored).
 * The database itself (RLS, grants) is proven in supabase/tests/pglite.
 */

type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown };

class FakeQuery implements PromiseLike<Result> {
  private filters: ((row: Row) => boolean)[] = [];
  private max: number | null = null;
  private sorts: { column: string; ascending: boolean }[] = [];

  constructor(
    private readonly rows: Row[],
    private readonly log: { table: string; filters: string[] }[],
    private readonly table: string,
  ) {
    log.push({ table, filters: [] });
  }

  private note(text: string) {
    this.log.at(-1)?.filters.push(text);
  }

  select(_columns?: string) {
    return this;
  }
  eq(column: string, value: unknown) {
    this.note(`${column}=${String(value)}`);
    this.filters.push((r) => r[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((r) => r[column] !== value);
    return this;
  }
  in(column: string, values: readonly unknown[]) {
    this.note(`${column} in ${values.length}`);
    this.filters.push((r) => values.includes(r[column]));
    return this;
  }
  is(column: string, value: null) {
    this.filters.push((r) => (r[column] ?? null) === value);
    return this;
  }
  gt(column: string, value: string | number) {
    this.filters.push((r) => (r[column] as string | number) > value);
    return this;
  }
  gte(column: string, value: string | number) {
    this.filters.push((r) => (r[column] as string | number) >= value);
    return this;
  }
  lt(column: string, value: string | number) {
    this.filters.push((r) => (r[column] as string | number) < value);
    return this;
  }
  lte(column: string, value: string | number) {
    this.filters.push((r) => (r[column] as string | number) <= value);
    return this;
  }
  order(column: string, options: { ascending?: boolean } = {}) {
    this.sorts.push({ column, ascending: options.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }

  private result(): Row[] {
    let out = this.rows.filter((r) => this.filters.every((f) => f(r)));
    for (const { column, ascending } of [...this.sorts].reverse()) {
      out = [...out].sort((a, b) => {
        const x = a[column] as string | number;
        const y = b[column] as string | number;
        return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
      });
    }
    return this.max === null ? out : out.slice(0, this.max);
  }

  async single(): Promise<Result> {
    const rows = this.result();
    return rows.length === 1
      ? { data: rows[0], error: null }
      : { data: null, error: { code: "PGRST116", message: `${rows.length} rows` } };
  }

  async maybeSingle(): Promise<Result> {
    return { data: this.result()[0] ?? null, error: null };
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve({ data: this.result(), error: null }).then(onfulfilled, onrejected);
  }
}

/**
 * Typed as the client the code under test expects (`db.from(...)`), plus the
 * log of queries it made.
 */
export type FakeDb = Pick<SupabaseClient<Database>, "from"> & {
  /** Every query made: table and the eq/in filters, in order. */
  queries: { table: string; filters: string[] }[];
};

export function fakeDb(tables: Record<string, Row[]>): FakeDb {
  const queries: { table: string; filters: string[] }[] = [];
  const db = {
    from: (table: string) => new FakeQuery(tables[table] ?? [], queries, table),
    queries,
  };
  return db as unknown as FakeDb;
}
