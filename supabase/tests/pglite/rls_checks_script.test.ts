// @vitest-environment node
/**
 * supabase/tests/rls_checks.sql (SPEC §35.15) is the script the owner runs in
 * the Supabase SQL editor. This file runs that exact file, unchanged, the way
 * the editor does (one multi-statement query as postgres), against every
 * migration:
 *
 * - it passes and ends with "ALLE RLS-CONTROLES GESLAAGD";
 * - it leaves nothing behind (rows, sequences, counters), also when the
 *   database already holds other customers' data, and can run again;
 * - it FAILS, with a message naming who saw or changed what, when a policy,
 *   grant, guard or trigger is broken. Each mutation is applied inside the
 *   script's own transaction, right before its checks start, so the rollback
 *   undoes it again.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, asUser, createAuthUser, createDb } from "./harness";

const SCRIPT_PATH = path.resolve(__dirname, "../rls_checks.sql");
const SCRIPT = readFileSync(SCRIPT_PATH, "utf8");
const CHECKS_HEADER = "-- 3. CONTROLES";
const SUCCESS = "ALLE RLS-CONTROLES GESLAAGD";

interface RunResult {
  rows: Record<string, unknown>[];
  notices: string[];
}

async function runScript(db: Db, sql: string = SCRIPT): Promise<RunResult> {
  const notices: string[] = [];
  const results = await db.exec(sql, { onNotice: (n) => notices.push(n.message ?? "") });
  return { rows: results.at(-1)?.rows ?? [], notices };
}

/** Runs the script with `mutation` executed just before the checks; returns the error. */
async function runBroken(db: Db, mutation: string): Promise<Error> {
  // A function, so "$$" in the mutation is not read as a replacement pattern.
  const sql = SCRIPT.replace(CHECKS_HEADER, () => `${mutation}\n${CHECKS_HEADER}`);
  let error: Error | undefined;
  try {
    await db.exec(sql);
  } catch (err) {
    error = err as Error;
  }
  // The failed statement leaves the script's transaction open (aborted), as in
  // the SQL editor; end it the way the header tells the owner to.
  await db.exec("rollback");
  if (!error) throw new Error("the script passed although the database was broken");
  return error;
}

/** Everything the script could leave behind if its rollback did not cover it. */
async function footprint(db: Db) {
  const { rows } = await db.query<Record<string, string>>(`
    select
      (select count(*) from auth.users)::text as auth_users,
      (select count(*) from public.profiles)::text as profiles,
      (select count(*) from public.user_roles)::text as user_roles,
      (select count(*) from public.customers)::text as customers,
      (select count(*) from public.orders)::text as orders,
      (select count(*) from public.shipments)::text as shipments,
      (select count(*) from public.shipment_status_history)::text as history,
      (select count(*) from public.order_documents)::text as documents,
      (select count(*) from storage.objects)::text as objects,
      (select count(*) from public.invoices)::text as invoices,
      (select count(*) from public.invoice_items)::text as items,
      (select count(*) from public.payments)::text as payments,
      (select count(*) from public.internal_notes)::text as notes,
      (select count(*) from public.invitations)::text as invitations,
      (select count(*) from public.staff_tasks)::text as tasks,
      (select count(*) from public.email_logs)::text as email_logs,
      (select count(*) from public.job_runs)::text as job_runs,
      (select count(*) from public.audit_log)::text as audit_log,
      (select count(*) from public.shipment_statuses)::text as statuses,
      (select string_agg(service_type || ':' || enabled, ',' order by service_type) from public.service_rates) as rates,
      (select md5(to_jsonb(s)::text) from public.company_settings s) as settings,
      (select last_value || ':' || is_called from private.customer_number_seq) as customer_number_seq,
      (select coalesce(string_agg(year || ':' || last_number, ','), '') from private.order_reference_counters) as order_refs,
      (select coalesce(string_agg(year || ':' || last_number, ','), '') from public.invoice_number_counters) as invoice_counters,
      (select count(*) from private.retired_customer_numbers)::text as retired_numbers`);
  return rows[0];
}

describe("supabase/tests/rls_checks.sql", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it("is one transaction the owner can paste: begin … rollback, then the result line", () => {
    const statements = SCRIPT.split("\n").filter((l) => /^(begin|rollback|commit|end);/i.test(l));
    expect(statements).toEqual(["begin;", "rollback;"]);
    expect(SCRIPT.trimEnd().endsWith(`select '${SUCCESS}' as resultaat;`)).toBe(true);
    expect(SCRIPT.split(CHECKS_HEADER)).toHaveLength(2);
    // No psql meta-commands: the SQL editor would reject them.
    expect(SCRIPT.split("\n").filter((l) => l.startsWith("\\"))).toEqual([]);
  });

  it("passes against all migrations and reports how many checks ran", async () => {
    const { rows, notices } = await runScript(db);
    expect(rows).toEqual([{ resultaat: SUCCESS }]);
    const done = notices.find((n) => n.startsWith(SUCCESS));
    expect(done).toMatch(/^ALLE RLS-CONTROLES GESLAAGD \(\d+ controles\)$/);
    expect(Number(/\((\d+) controles\)/.exec(done ?? "")?.[1])).toBeGreaterThan(400);
  });

  it("leaves nothing behind, also next to real data, and can run again", async () => {
    // Data like a live project: a team member, a customer with an order and an
    // issued, partly paid invoice. A's exact counts must not include any of it.
    const staff = await createAuthUser(db, { email: "maria@example.com" });
    await db.query("insert into public.user_roles (user_id, role) values ($1, 'staff')", [
      staff.id,
    ]);
    await db.query(
      "update public.customers set user_id = null, status = 'disabled' where user_id = $1",
      [staff.id],
    );
    const real = await createAuthUser(db, {
      email: "echte.klant@example.com",
      meta: { full_name: "Echte Klant", phone: "+597 8000000", terms_version: "1" },
    });
    const { rows: cust } = await db.query<{ id: string }>(
      "select id from public.customers where user_id = $1",
      [real.id],
    );
    await asUser(
      db,
      staff.id,
      async (tx) => {
        const order = await tx.query<{ id: string }>(
          "insert into public.orders (customer_id, store_vendor) values ($1, 'Amazon') returning id",
          [cust[0]!.id],
        );
        const inv = await tx.query<{ id: string }>(
          "insert into public.invoices (customer_id) values ($1) returning id",
          [cust[0]!.id],
        );
        await tx.query(
          `insert into public.invoice_items (invoice_id, order_id, line_type, description, weight_lbs, rate_per_lb, amount, vat_exempt)
           values ($1, $2, 'freight', 'Vracht', 2, 5, 10, false)`,
          [inv.rows[0]!.id, order.rows[0]!.id],
        );
        await tx.query("select public.issue_invoice($1)", [inv.rows[0]!.id]);
        await tx.query("select * from public.record_payment($1, 4)", [inv.rows[0]!.id]);
        await tx.query(
          "insert into public.internal_notes (customer_id, body) values ($1, 'Belt liever')",
          [cust[0]!.id],
        );
      },
      { commit: true },
    );

    const before = await footprint(db);
    expect((await runScript(db)).rows).toEqual([{ resultaat: SUCCESS }]);
    expect(await footprint(db)).toEqual(before);
    expect((await runScript(db)).rows).toEqual([{ resultaat: SUCCESS }]);
    expect(await footprint(db)).toEqual(before);
  });

  it("passes on a project whose admin set strict settings, and changes none of them", async () => {
    // The go-live checklist runs the script after the Settings step. The
    // script depends on two settings and sets them itself, inside its own
    // transaction: air freight on, and enough open registrations per customer.
    await db.exec(`
      update public.company_settings set max_open_orders_per_customer = 1, public_signup_enabled = false where id;
      update public.service_rates set enabled = false;`);
    const before = await footprint(db);
    expect((await runScript(db)).rows).toEqual([{ resultaat: SUCCESS }]);
    expect(await footprint(db)).toEqual(before);
  });

  it("refuses to start when test data of an earlier run was committed", async () => {
    await createAuthUser(db, { email: "rls-klant-a@example.com" });
    const err = await runBroken(db, "select 1;");
    expect(err.message).toMatch(/RLS-CONTROLE MISLUKT \[systeem\]: er bestaan al testgegevens/);
  });

  it("a dropped policy fails the script, and the script's rollback restores it", async () => {
    const err = await runBroken(db, "drop policy orders_select on public.orders;");
    expect(err.message).toMatch(
      /RLS-CONTROLE MISLUKT \[klant A\]: ziet niet precies de eigen orders \(verwacht 2, gezien 0\)/,
    );
    const { rows } = await db.query(
      "select 1 from pg_policies where schemaname = 'public' and policyname = 'orders_select'",
    );
    expect(rows).toHaveLength(1);
    expect((await runScript(db)).rows).toEqual([{ resultaat: SUCCESS }]);
  });

  // Each broken database, and the check that must catch it.
  const MUTATIONS: { name: string; sql: string; expected: RegExp }[] = [
    {
      name: "customers see drafts (invoices_select without the status filter)",
      sql: `drop policy invoices_select on public.invoices;
            create policy invoices_select on public.invoices for select to authenticated
              using (customer_id = (select public.current_customer_id()) or (select public.is_staff()));`,
      expected: /\[klant A\]: ziet een conceptfactuur \(verwacht 0, gezien 1\)/,
    },
    {
      name: "customers see voided payments",
      sql: `drop policy payments_select on public.payments;
            create policy payments_select on public.payments for select to authenticated
              using ((select public.is_staff()) or exists (
                select 1 from public.invoices i where i.id = payments.invoice_id
                  and i.customer_id = (select public.current_customer_id()) and i.status <> 'draft'));`,
      expected: /\[klant A\]: ziet een ongedaan gemaakte betaling/,
    },
    {
      name: "customers see status changes that are not customer_visible",
      sql: `drop policy shipment_status_history_select on public.shipment_status_history;
            create policy shipment_status_history_select on public.shipment_status_history
              for select to authenticated using ((select public.is_staff()) or exists (
                select 1 from public.orders o where o.id = shipment_status_history.order_id
                  and o.customer_id = (select public.current_customer_id())));`,
      expected: /\[klant A\]: ziet een statuswijziging die niet voor klanten zichtbaar is/,
    },
    {
      name: "customers read internal notes",
      sql: "create policy internal_notes_leak on public.internal_notes for select to authenticated using (true);",
      expected: /\[klant A\]: leest interne notities \(verwacht 0, gezien 2\)/,
    },
    {
      name: "customers see each other's files in storage",
      sql: `create policy order_documents_leak on storage.objects for select to authenticated
              using (bucket_id = 'order-documents');`,
      expected: /\[klant A\]: ziet het bestand van klant B in storage/,
    },
    {
      name: "customers update their own record directly",
      sql: `drop policy customers_update on public.customers;
            create policy customers_update on public.customers for update to authenticated
              using (id = (select public.current_customer_id()) or (select public.is_staff()))
              with check (id = (select public.current_customer_id()) or (select public.is_staff()));`,
      expected: /\[klant A\]: wijzigt eigen contactgegevens buiten update_my_contact om is gelukt/,
    },
    {
      name: "a staff RPC without its guard",
      sql: `create or replace function public.team_members()
              returns table (user_id uuid, display_name text, email text, roles public.app_role[],
                             blocked boolean, last_sign_in_at timestamptz, member_since timestamptz)
              language sql security definer set search_path = '' as $$
              select null::uuid, null::text, null::text, null::public.app_role[], false, null::timestamptz, null::timestamptz $$;`,
      expected: /\[klant A\]: team_members is gelukt; verwacht fout 42501/,
    },
    {
      // The version before migration 20261008120000: an answer about anyone.
      name: "has_role() tells customers who the admins are",
      sql: `create or replace function public.has_role(_user_id uuid, _role public.app_role)
              returns boolean language sql stable security definer set search_path = '' as $$
              select exists (select 1 from public.user_roles r
                              where r.user_id = _user_id and r.role = _role) $$;`,
      expected:
        /\[klant A\]: weet via has_role\(\) welke login beheerder of medewerker is \(verwacht 0, gezien 2\)/,
    },
    {
      name: "a server-only function opened to signed-in users",
      sql: "grant execute on function public.admin_auth_user_by_email(text) to authenticated;",
      expected:
        /\[systeem\]: public\.admin_auth_user_by_email is aan te roepen door ingelogde gebruikers/,
    },
    {
      name: "a disabled customer still counts as the current customer",
      sql: `create or replace function public.current_customer_id() returns uuid
              language sql stable security definer set search_path = '' as $$
              select c.id from public.customers c where c.user_id = (select auth.uid()) $$;`,
      expected: /\[klant C\]: current_customer_id\(\) is niet leeg/,
    },
    {
      name: "the issued-invoice guard is off",
      sql: "alter table public.invoices disable trigger invoices_guard;",
      expected: /\[medewerker\]: wijzigt de opmerking op uitgegeven factuur A is gelukt/,
    },
    {
      name: "the invoice-line guard is off",
      sql: "alter table public.invoice_items disable trigger invoice_items_guard;",
      expected: /\[medewerker\]: wijzigt een omschrijving op uitgegeven factuur A is gelukt/,
    },
    {
      // Two layers protect payments: no API role holds UPDATE/DELETE, and the
      // guard trigger refuses both. Only both gone together is a hole.
      name: "payments can be changed (server role granted UPDATE, guard left on insert only)",
      sql: `grant update, delete on public.payments to service_role;
            drop trigger payments_guard on public.payments;
            create trigger payments_guard before insert on public.payments
              for each row execute function private.payments_guard();`,
      expected: /\[service_role\]: wijzigt een betaling op factuur A is gelukt/,
    },
    {
      name: "staff may disable customers (customers_guard off)",
      sql: "alter table public.customers disable trigger customers_guard;",
      expected: /\[medewerker\]: deactiveert een klant is gelukt/,
    },
    {
      name: "an admin RPC that only checks for staff",
      sql: `create or replace function public.set_next_customer_number(_next integer) returns integer
              language plpgsql volatile security definer set search_path = '' as $$
              begin
                if not (select public.is_staff()) then
                  raise exception 'Geen toegang' using errcode = '42501';
                end if;
                return _next;
              end $$;`,
      expected: /\[medewerker\]: set_next_customer_number is gelukt; verwacht fout 42501/,
    },
    {
      name: "staff miss rows (email_logs readable by admins only)",
      sql: `drop policy email_logs_select on public.email_logs;
            create policy email_logs_select on public.email_logs for select to authenticated
              using ((select public.is_admin()));`,
      expected: /\[medewerker\]: mist e-maillogs \(verwacht 2, gezien 0\)/,
    },
    {
      name: "admins miss the audit log",
      sql: `drop policy audit_log_select on public.audit_log;
            create policy audit_log_select on public.audit_log for select to authenticated using (false);`,
      expected: /\[beheerder\]: mist auditregels van de testgegevens/,
    },
    {
      name: "anon reads a table",
      sql: `grant select on public.company_settings to anon;
            create policy company_settings_anon on public.company_settings for select to anon using (true);`,
      expected:
        /policy company_settings_anon op public\.company_settings geldt voor anon of public/,
    },
    {
      name: "a table without row level security",
      sql: "alter table public.job_runs disable row level security;",
      expected: /\[systeem\]: tabel public\.job_runs heeft geen row level security/,
    },
  ];

  it.each(MUTATIONS)("fails when $name", async ({ sql, expected }) => {
    const err = await runBroken(db, sql);
    expect(err.message).toMatch(/^RLS-CONTROLE MISLUKT \[/);
    expect(err.message).toMatch(expected);
  });
});
