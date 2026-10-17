// @vitest-environment node
/**
 * Migration 20261017090000_owner_corrections.sql (SPEC §36), applied to a
 * database that already has data from before it, like the live project:
 *
 * 1. customer codes lose their leading zeros (GR00100 → GR100); codes typed
 *    with zeros still mean the same number, and the messages print GR42;
 * 2. the seeded company phone 5978897500 becomes +597 7589695, a number the
 *    owner set himself stays;
 * 3. sea freight is switched on;
 * 4. US addresses with the old default templates get "{GR_CODE} {SERVICE}
 *    {FULL_NAME}" and an empty line 2, other templates stay.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type AuthUser,
  type Db,
  applyMigrations,
  asUser,
  confirmAuthUser,
  createAuthUser,
  createDb,
  execMigrationSql,
  expectSqlError,
  listMigrations,
} from "./harness";

const MIGRATION = "20261017090000_owner_corrections.sql";

let db: Db;
let alice: AuthUser;
let admin: AuthUser;

const all = listMigrations();
const index = all.findIndex((m) => m.file.endsWith(MIGRATION));
const before = all.slice(0, index);
const ours = all[index]!;

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

beforeAll(async () => {
  expect(index).toBeGreaterThan(0);
  db = await createDb({ migrations: false });
  await applyMigrations(db, before);

  alice = await createAuthUser(db, {
    email: "alice@example.com",
    meta: { full_name: "Alice Jansen", phone: "+597 8000001" },
  });
  admin = await createAuthUser(db, { email: "maria@example.com", confirmed: false });
  await db.query("insert into public.user_roles (user_id, role) values ($1, 'admin')", [admin.id]);
  await confirmAuthUser(db, admin.id);
  await db.query(
    `insert into public.warehouse_addresses
       (label, service_type, address_line1, city, state, zip)
     values ('Miami', 'air', '1 Test Street', 'Miami', 'FL', '33101')`,
  );
  await db.query(
    `insert into public.warehouse_addresses
       (label, service_type, recipient_name_template, address_line1, address_line2_template, city, state, zip)
     values ('Eigen', 'sea', '{FULL_NAME} / {GR_CODE}', '2 Dock Road', 'Suite {GR_CODE}', 'Miami', 'FL', '33101')`,
  );

  // What the live database looks like before the migration.
  const old = await rows<{ customer_code: string }>(
    "select customer_code from public.customers where user_id = $1",
    [alice.id],
  );
  expect(old).toEqual([{ customer_code: "GR00100" }]);

  await applyMigrations(db, [ours]);
});

afterAll(async () => {
  await db?.close();
});

describe("customer codes without leading zeros", () => {
  it("rewrites existing codes and writes new ones as GR + number", async () => {
    expect(
      await rows("select customer_number, customer_code from public.customers where user_id = $1", [
        alice.id,
      ]),
    ).toEqual([{ customer_number: 100, customer_code: "GR100" }]);

    const bob = await createAuthUser(db, {
      email: "bob@example.com",
      meta: { full_name: "Bob Pinas", phone: "+597 8000002" },
    });
    expect(
      await rows("select customer_code from public.customers where user_id = $1", [bob.id]),
    ).toEqual([{ customer_code: "GR101" }]);
  });

  it("takes a code typed with zeros and prints codes without them", async () => {
    const result = await asUser(db, admin.id, async (tx) => {
      const legacy = await tx.query<{ customer_code: string }>(
        "select (public.create_customer('Bestaande Klant', '+597 8000003', null, 'GR00042')).customer_code",
      );
      const duplicate = await expectSqlError(
        tx.query("select public.create_customer('Ander', '+597 8000004', null, 'gr 42')"),
        "23505",
      );
      return { code: legacy.rows[0]!.customer_code, message: duplicate.message };
    });
    expect(result).toEqual({
      code: "GR42",
      message: "GR42 is al toegewezen aan Bestaande Klant",
    });
  });

  it("set_next_customer_number speaks in codes without zeros", async () => {
    const err = await asUser(db, admin.id, (tx) =>
      expectSqlError(tx.query("select public.set_next_customer_number(50)"), "22023"),
    );
    expect(err.message).toBe(
      "Het volgende klantnummer moet hoger zijn dan het hoogste bestaande nummer (GR101)",
    );
  });
});

describe("settings", () => {
  it("replaces the seeded phone number, switches sea freight on", async () => {
    expect(await rows("select phone from public.company_settings")).toEqual([
      { phone: "+597 7589695" },
    ]);
    expect(
      await rows("select service_type, enabled from public.service_rates order by service_type"),
    ).toEqual([
      { service_type: "air", enabled: true },
      { service_type: "sea", enabled: true },
    ]);
  });

  it("gives addresses with the old default templates the new ones, and leaves others alone", async () => {
    expect(
      await rows(
        "select label, recipient_name_template, address_line2_template from public.warehouse_addresses order by label",
      ),
    ).toEqual([
      {
        label: "Eigen",
        recipient_name_template: "{FULL_NAME} / {GR_CODE}",
        address_line2_template: "Suite {GR_CODE}",
      },
      {
        label: "Miami",
        recipient_name_template: "{GR_CODE} {SERVICE} {FULL_NAME}",
        address_line2_template: "",
      },
    ]);
  });

  it("can run again, and then keeps a phone number the owner set", async () => {
    await db.query("update public.company_settings set phone = '+597 1234567' where id");
    await db.transaction((tx) => execMigrationSql(tx, ours.sql));
    expect(await rows("select phone from public.company_settings")).toEqual([
      { phone: "+597 1234567" },
    ]);
    expect(
      await rows("select customer_code from public.customers where user_id = $1", [alice.id]),
    ).toEqual([{ customer_code: "GR100" }]);
  });
});
