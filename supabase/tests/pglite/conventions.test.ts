// @vitest-environment node
/**
 * SPEC §35.3 conventions, checked against the catalog after ALL migrations.
 * These hold for every object in public/private, so later migrations are held
 * to them without writing anything new. Allow-lists name the deliberate
 * exceptions; extend them only with a reason.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, createDb } from "./harness";

// Read-only helpers and public data that need no access guard (SPEC §35.4, §35.3).
const UNGUARDED_DEFINER_FUNCTIONS = [
  "can_upload_order_object",
  "current_customer_id",
  "has_role",
  "is_admin",
  "is_staff",
  "public_company_info",
];
// The only thing a visitor who is not logged in may call (owner decision).
const ANON_FUNCTIONS = ["public_company_info"];

let db: Db;

beforeAll(async () => {
  db = await createDb();
});

afterAll(async () => {
  await db?.close();
});

async function list<T>(sql: string): Promise<T[]> {
  return (await db.query<T>(sql)).rows;
}

describe("tables and views", () => {
  it("every public table has row level security enabled", async () => {
    const off = await list<{ table: string }>(`
      select c.relname as table from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`);
    expect(off).toEqual([]);
  });

  it("anon holds no privilege on any public table or view", async () => {
    const granted = await list<{ table: string }>(`
      select c.relname as table from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
         and (has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')
              or has_any_column_privilege('anon', c.oid, 'select, insert, update, references'))`);
    expect(granted).toEqual([]);
  });

  it("authenticated never gets truncate, references or trigger", async () => {
    const granted = await list<{ table: string }>(`
      select c.relname as table from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
         and has_table_privilege('authenticated', c.oid, 'truncate, references, trigger')`);
    expect(granted).toEqual([]);
  });

  it("every verb granted to authenticated is backed by a policy for that command", async () => {
    const missing = await list<{ table: string; cmd: string }>(`
      with verbs(cmd, priv) as (
        values ('SELECT', 'select'), ('INSERT', 'insert'), ('UPDATE', 'update'), ('DELETE', 'delete')
      )
      select c.relname as table, v.cmd
        from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join verbs v
       where n.nspname = 'public' and c.relkind in ('r', 'p')
         and (has_table_privilege('authenticated', c.oid, v.priv)
              or (v.cmd <> 'DELETE' and has_any_column_privilege('authenticated', c.oid, v.priv)))
         and not exists (
           select 1 from pg_policies pol
            where pol.schemaname = 'public' and pol.tablename = c.relname and pol.cmd = v.cmd)
       order by 1, 2`);
    expect(missing).toEqual([]);
  });

  it("policies are per command and target authenticated only", async () => {
    const bad = await list<{ policy: string }>(`
      select schemaname || '.' || tablename || '.' || policyname as policy from pg_policies
       where schemaname in ('public', 'storage')
         and (cmd = 'ALL' or roles <> array['authenticated']::name[])`);
    expect(bad).toEqual([]);
  });

  it("views run with the caller's rights", async () => {
    const definer = await list<{ view: string }>(`
      select c.relname as view from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'v'
         and not coalesce(c.reloptions, '{}') && array['security_invoker=true', 'security_invoker=on']`);
    expect(definer).toEqual([]);
  });

  it("API roles get no access to any sequence", async () => {
    const granted = await list<{ seq: string; role: string }>(`
      select n.nspname || '.' || c.relname as seq, r.role
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        cross join (values ('anon'), ('authenticated')) r(role)
       where n.nspname in ('public', 'private') and c.relkind = 'S'
         and has_sequence_privilege(r.role, c.oid, 'usage, select, update')`);
    expect(granted).toEqual([]);
  });

  it("schema private is closed to the API roles", async () => {
    const open = await list<{ role: string }>(`
      select r.role from (values ('anon'), ('authenticated'), ('service_role')) r(role)
       where has_schema_privilege(r.role, 'private', 'usage, create')`);
    expect(open).toEqual([]);
  });

  it("every foreign key is covered by an index", async () => {
    const unindexed = await list<{ fk: string }>(`
      select con.conrelid::regclass::text || '.' || con.conname as fk
        from pg_constraint con join pg_namespace n on n.oid = con.connamespace
       where con.contype = 'f' and n.nspname = 'public'
         and not exists (
           select 1 from pg_index i
            where i.indrelid = con.conrelid
              and (i.indkey::int2[])[0:cardinality(con.conkey) - 1] @> con.conkey
              and (i.indkey::int2[])[0:cardinality(con.conkey) - 1] <@ con.conkey)
       order by 1`);
    expect(unindexed).toEqual([]);
  });

  it("stores amounts as bounded numerics, never floats; weights as numeric(10,2)", async () => {
    const bad = await list<{ col: string; type: string }>(`
      select c.relname || '.' || a.attname as col, format_type(a.atttypid, a.atttypmod) as type
        from pg_attribute a join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
         and (a.atttypid in ('real'::regtype, 'double precision'::regtype, 'money'::regtype)
              or (a.atttypid = 'numeric'::regtype and a.atttypmod = -1)
              or (a.attname like '%\\_lbs' and format_type(a.atttypid, a.atttypmod) <> 'numeric(10,2)'))
       order by 1`);
    expect(bad).toEqual([]);
  });
});

describe("functions", () => {
  it("no function in public or private is executable by PUBLIC", async () => {
    const open = await list<{ fn: string }>(`
      select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.prokind = 'f'
         and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
       order by 1`);
    expect(open).toEqual([]);
  });

  it("nothing in private is executable by an API role", async () => {
    const open = await list<{ fn: string; role: string }>(`
      select p.oid::regprocedure::text as fn, r.role
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
       where n.nspname = 'private' and has_function_privilege(r.role, p.oid, 'execute')
       order by 1, 2`);
    expect(open).toEqual([]);
  });

  it("anon can execute only the allow-listed public functions", async () => {
    const fns = await list<{ name: string }>(`
      select distinct p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
    expect(fns.map((f) => f.name)).toEqual(ANON_FUNCTIONS);
  });

  it("SECURITY DEFINER functions pin an empty search_path", async () => {
    const loose = await list<{ fn: string; config: string[] | null }>(`
      select p.oid::regprocedure::text as fn, p.proconfig as config
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.prosecdef
         and not coalesce(p.proconfig, '{}') && array['search_path=""', 'search_path=']
       order by 1`);
    expect(loose).toEqual([]);
  });

  it("trigger functions live in private and are SECURITY DEFINER", async () => {
    const bad = await list<{ fn: string }>(`
      select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.prorettype = 'trigger'::regtype
         and (n.nspname <> 'private' or not p.prosecdef)
       order by 1`);
    expect(bad).toEqual([]);
  });

  it("every SECURITY DEFINER RPC callable by authenticated raises 42501 on its guard", async () => {
    const unguarded = await list<{ name: string }>(`
      select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
         and has_function_privilege('authenticated', p.oid, 'execute')
         and p.prosrc !~ 'Geen toegang''\\s+using\\s+errcode\\s*=\\s*''42501'''
       order by 1`);
    expect(unguarded.map((f) => f.name)).toEqual(UNGUARDED_DEFINER_FUNCTIONS);
  });

  it("every table trigger in public calls a function in private", async () => {
    // Supabase's own storage triggers (storage.protect_delete) are not ours.
    const bad = await list<{ trigger: string }>(`
      select t.tgrelid::regclass::text || '.' || t.tgname as trigger
        from pg_trigger t join pg_proc p on p.oid = t.tgfoid
        join pg_namespace pn on pn.oid = p.pronamespace
        join pg_class c on c.oid = t.tgrelid join pg_namespace cn on cn.oid = c.relnamespace
       where not t.tgisinternal and cn.nspname in ('public', 'auth', 'storage')
         and pn.nspname <> 'private'
         and not (cn.nspname = 'storage' and pn.nspname = 'storage')
       order by 1`);
    expect(bad).toEqual([]);
  });
});
