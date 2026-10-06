// @vitest-environment node
/**
 * The one-time SQL in docs/DEPLOYMENT.md §4 (first administrator), run exactly
 * as the owner would run it in the Supabase SQL editor: as the superuser, with
 * no JWT, against the real migrations and triggers.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type Db,
  asUser,
  confirmAuthUser,
  createAuthUser,
  createDb,
  expectSqlError,
} from "./harness";

const DEPLOYMENT_MD = path.resolve(__dirname, "../../../docs/DEPLOYMENT.md");

function firstAdminSql(email: string): string {
  const doc = readFileSync(DEPLOYMENT_MD, "utf8");
  const match =
    /<!-- first-admin-sql:start[^>]*-->\s*```sql\n([\s\S]*?)```\s*<!-- first-admin-sql:end -->/.exec(
      doc,
    );
  if (!match?.[1]) throw new Error("first-admin SQL block not found in docs/DEPLOYMENT.md");
  expect(match[1].match(/<ADMIN_EMAIL>/g)).toHaveLength(2);
  return match[1].replaceAll("<ADMIN_EMAIL>", email);
}

type CustomerRow = {
  id: string;
  user_id: string | null;
  status: string;
  disabled_reason: string | null;
  disabled_at: string | null;
  customer_code: string;
};

async function customersByEmail(db: Db, email: string): Promise<CustomerRow[]> {
  const { rows } = await db.query<CustomerRow>(
    `select id, user_id, status::text, disabled_reason, disabled_at::text, customer_code
       from public.customers where lower(email) = lower($1)`,
    [email],
  );
  return rows;
}

async function roles(db: Db, userId: string): Promise<string[]> {
  const { rows } = await db.query<{ role: string }>(
    "select role::text from public.user_roles where user_id = $1 order by 1",
    [userId],
  );
  return rows.map((r) => r.role);
}

describe("docs/DEPLOYMENT.md: first administrator SQL", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it("makes a signed-up owner admin and unlinks (never deletes) the customer record", async () => {
    const owner = await createAuthUser(db, {
      email: "owner@example.com",
      meta: { full_name: "Owner Example", phone: "+5978897500", terms_version: "1" },
    });
    const [before] = await customersByEmail(db, owner.email);
    expect(before).toMatchObject({ user_id: owner.id, status: "active" });

    // Mixed case and spaces, as an owner might paste it.
    const result = await db.exec(firstAdminSql(" Owner@Example.com "));
    expect(result.at(-1)?.rows).toEqual([
      { email: "owner@example.com", roles: ["admin"], linked_customer: null },
    ]);

    expect(await roles(db, owner.id)).toEqual(["admin"]);
    const after = await customersByEmail(db, owner.email);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      id: before!.id,
      customer_code: before!.customer_code,
      user_id: null,
      status: "disabled",
      disabled_reason: "bootstrap admin",
    });
    expect(after[0]!.disabled_at).not.toBeNull();

    const seen = await asUser(db, owner.id, async (tx) => {
      const { rows } = await tx.query<{
        is_admin: boolean;
        is_staff: boolean;
        own_customer: string | null;
        customers: number;
      }>(
        `select public.is_admin(), public.is_staff(), public.current_customer_id() as own_customer,
                (select count(*)::int from public.customers) as customers`,
      );
      return rows[0];
    });
    expect(seen).toEqual({ is_admin: true, is_staff: true, own_customer: null, customers: 1 });
  });

  it("is safe to run twice", async () => {
    const owner = await createAuthUser(db, { email: "owner@example.com" });
    await db.exec(firstAdminSql(owner.email));
    await db.exec(firstAdminSql(owner.email));
    expect(await roles(db, owner.id)).toEqual(["admin"]);
    expect(await customersByEmail(db, owner.email)).toHaveLength(1);
  });

  it("run before the e-mail is confirmed, no customer record is ever created", async () => {
    const owner = await createAuthUser(db, { email: "owner@example.com", confirmed: false });
    await db.exec(firstAdminSql(owner.email));
    await confirmAuthUser(db, owner.id);
    expect(await roles(db, owner.id)).toEqual(["admin"]);
    expect(await customersByEmail(db, owner.email)).toEqual([]);
  });

  it("refuses an address without an account and changes nothing", async () => {
    await expectSqlError(db.exec(firstAdminSql("nobody@example.com")), /Geen account gevonden/);
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.user_roles",
    );
    expect(rows[0]?.n).toBe(0);
  });

  it("keeps a customer record that already has orders linked", async () => {
    const owner = await createAuthUser(db, { email: "owner@example.com" });
    const [customer] = await customersByEmail(db, owner.email);
    await asUser(
      db,
      owner.id,
      (tx) => tx.query("insert into public.orders (customer_id) values ($1)", [customer!.id]),
      { commit: true },
    );

    await db.exec(firstAdminSql(owner.email));

    expect(await roles(db, owner.id)).toEqual(["admin"]);
    expect(await customersByEmail(db, owner.email)).toEqual([
      expect.objectContaining({ user_id: owner.id, status: "active" }),
    ]);
  });
});

describe("docs/DEPLOYMENT.md: public sign-up switch", () => {
  it("turns public sign-up off for public_company_info() and the sign-up trigger", async () => {
    const db = await createDb();
    try {
      const doc = readFileSync(DEPLOYMENT_MD, "utf8");
      const sql =
        /<!-- signup-switch-sql:start[^>]*-->\s*```sql\n([\s\S]*?)```\s*<!-- signup-switch-sql:end -->/.exec(
          doc,
        )?.[1];
      if (!sql) throw new Error("sign-up switch SQL block not found in docs/DEPLOYMENT.md");
      await db.exec(sql);

      const { rows } = await db.query<{ public_signup_enabled: boolean }>(
        "select public_signup_enabled from public.public_company_info()",
      );
      expect(rows).toEqual([{ public_signup_enabled: false }]);
      const user = await createAuthUser(db, {
        email: "late@example.com",
        meta: { full_name: "Late Signup", phone: "+5978897500", terms_version: "1" },
      });
      expect(await customersByEmail(db, user.email)).toEqual([]);
    } finally {
      await db.close();
    }
  });
});
