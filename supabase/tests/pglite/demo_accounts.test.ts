// @vitest-environment node
/**
 * supabase/demo/create_demo_accounts.sql and remove_demo_accounts.sql, run as
 * the owner runs them in the SQL editor. The stub's auth schema lacks a few
 * GoTrue columns and auth.identities, so they are added first; logging in with
 * the generated passwords is checked against a real local Supabase stack
 * (docs/DEMO.md), here only the bcrypt hash is.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, asUser, createDb } from "./harness";

const DEMO = path.resolve(__dirname, "../../demo");
const CREATE = readFileSync(path.join(DEMO, "create_demo_accounts.sql"), "utf8");
const REMOVE = readFileSync(path.join(DEMO, "remove_demo_accounts.sql"), "utf8");

type Cred = { rol: string; email: string; wachtwoord: string; klantcode: string };

let db: Db;

async function createDemo(): Promise<Cred[]> {
  const results = await db.exec(CREATE);
  return results.at(-1)!.rows as Cred[];
}

async function count(sql: string): Promise<number> {
  return Number((await db.query<{ n: string }>(sql)).rows[0]!.n);
}

beforeAll(async () => {
  db = await createDb();
  await db.exec(`
    begin;
    set local supabase_stub.allow_reserved_ddl = on;
    alter table auth.users
      add column if not exists email_change_token_new varchar(255),
      add column if not exists email_change_token_current varchar(255),
      add column if not exists phone_change text,
      add column if not exists phone_change_token varchar(255),
      add column if not exists reauthentication_token varchar(255);
    create table if not exists auth.identities (
      id uuid primary key,
      user_id uuid not null references auth.users (id) on delete cascade,
      provider_id text not null,
      provider text not null,
      identity_data jsonb not null,
      last_sign_in_at timestamptz,
      created_at timestamptz,
      updated_at timestamptz
    );
    commit;
  `);
});

afterAll(async () => {
  await db?.close();
});

describe("demo accounts scripts", () => {
  it("creates two team logins and two customers with working passwords and demo data", async () => {
    const creds = await createDemo();
    expect(creds.map((c) => c.rol)).toEqual(["beheerder", "medewerker", "klant", "zakelijk"]);
    expect(creds[2]!.klantcode).toMatch(/^GR\d{5}$/);
    expect(creds[0]!.klantcode).toBe("–");

    for (const c of creds) {
      const { rows } = await db.query<{ ok: boolean }>(
        `select encrypted_password = extensions.crypt($2, encrypted_password) as ok
           from auth.users where email = $1`,
        [c.email, c.wachtwoord],
      );
      expect(rows[0]?.ok).toBe(true);
    }

    const roles = await db.query<{ email: string; role: string }>(
      `select u.email, r.role::text from public.user_roles r join auth.users u on u.id = r.user_id
        where u.email like 'demo.%' order by 1`,
    );
    expect(roles.rows).toEqual([
      { email: "demo.beheerder@example.com", role: "admin" },
      { email: "demo.medewerker@example.com", role: "staff" },
    ]);
    // Team logins never get a customer record.
    expect(
      await count(`select count(*) as n from public.customers c join auth.users u on u.id = c.user_id
                    where u.email in ('demo.beheerder@example.com', 'demo.medewerker@example.com')`),
    ).toBe(0);

    const klant = await db.query<{ user_id: string }>(
      "select user_id from public.customers where email = 'demo.klant@example.com'",
    );
    const view = await asUser(db, klant.rows[0]!.user_id, async (tx) => ({
      orders: (
        await tx.query<{ status: string }>("select status from public.orders order by 1")
      ).rows.map((r) => r.status),
      invoices: (
        await tx.query<{ status: string }>("select status::text from public.invoices order by 1")
      ).rows.map((r) => r.status),
    }));
    expect(view.orders).toEqual([
      "in_transit",
      "order_registered",
      "picked_up",
      "ready_for_pickup",
    ]);
    expect(view.invoices).toEqual(["open", "paid"]);
  });

  it("running it again only gives new passwords", async () => {
    const before = await count("select count(*) as n from public.orders");
    const first = await db.query<{ encrypted_password: string }>(
      "select encrypted_password from auth.users where email = 'demo.klant@example.com'",
    );
    const creds = await createDemo();
    expect(creds).toHaveLength(4);
    expect(await count("select count(*) as n from public.orders")).toBe(before);
    expect(await count("select count(*) as n from auth.users where email like 'demo.%'")).toBe(4);
    const after = await db.query<{ encrypted_password: string }>(
      "select encrypted_password from auth.users where email = 'demo.klant@example.com'",
    );
    expect(after.rows[0]!.encrypted_password).not.toBe(first.rows[0]!.encrypted_password);
  });

  it("works while public sign-up is switched off, and leaves it off", async () => {
    await db.exec(REMOVE);
    await db.query("update public.company_settings set public_signup_enabled = false where id");
    const creds = await createDemo();
    expect(creds[2]!.klantcode).toMatch(/^GR\d{5}$/);
    const s = await db.query<{ on: boolean }>(
      "select public_signup_enabled as on from public.company_settings where id",
    );
    expect(s.rows[0]!.on).toBe(false);
    await db.query("update public.company_settings set public_signup_enabled = true where id");
  });

  it("the remove script deletes the demo logins and all their data, nothing else", async () => {
    await db.exec(REMOVE);
    expect(await count("select count(*) as n from auth.users where email like 'demo.%'")).toBe(0);
    expect(await count("select count(*) as n from auth.identities")).toBe(0);
    expect(await count("select count(*) as n from public.orders")).toBe(0);
    expect(await count("select count(*) as n from public.invoices")).toBe(0);
    expect(await count("select count(*) as n from public.payments")).toBe(0);
    expect(await count("select count(*) as n from public.customers")).toBe(0);
    expect(await count("select count(*) as n from public.user_roles")).toBe(0);
    // Settings and statuses stay.
    expect(await count("select count(*) as n from public.company_settings")).toBe(1);
    expect(await count("select count(*) as n from public.shipment_statuses")).toBeGreaterThan(0);
  });
});
