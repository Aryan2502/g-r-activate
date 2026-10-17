// @vitest-environment node
/**
 * Migration 20261017140000_order_labels.sql (SPEC §36):
 *
 * 1. the US address name line becomes just the customer's name, also for
 *    addresses written with an earlier default;
 * 2. order labels: free text + colour, added and removed by the team only,
 *    unique per order ignoring case, audited; customers never see them.
 *
 * The labels are written the way src/lib/admin/order-labels.ts writes them:
 * insert … on conflict (order_id, label_key) do nothing, and delete by id.
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
  expectSqlError,
  listMigrations,
  withSavepoint,
} from "./harness";

const MIGRATION = "20261017140000_order_labels.sql";

let db: Db;
let alice: AuthUser;
let staff: AuthUser;
let admin: AuthUser;
let aliceCustomer: string;
let orderA: string;
let orderB: string;

const all = listMigrations();
const index = all.findIndex((m) => m.file.endsWith(MIGRATION));

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

/** What addOrderLabels() sends: one row per order, duplicates ignored. */
const LABEL_INSERT = `insert into public.order_labels (order_id, label, color)
  select unnest($1::uuid[]), $2, $3
  on conflict (order_id, label_key) do nothing
  returning id, order_id, label, color`;

beforeAll(async () => {
  expect(index).toBeGreaterThan(0);
  db = await createDb({ migrations: false });
  await applyMigrations(db, all.slice(0, index));

  // Addresses as they may be on the live project before this migration.
  await db.query(
    `insert into public.warehouse_addresses
       (label, service_type, recipient_name_template, address_line1, address_line2_template, city, state, zip)
     values ('Oud', 'air', '{FULL_NAME} {GR_CODE}', '1 Old Street', '{GR_CODE}', 'Miami', 'FL', '33101'),
            ('Air/Ocean', 'air', '{GR_CODE} {SERVICE} {FULL_NAME}', '2 New Street', '', 'Miami', 'FL', '33101'),
            ('Eigen', 'sea', 'Attn {FULL_NAME}', '3 Dock Road', 'Suite {GR_CODE}', 'Miami', 'FL', '33101')`,
  );

  await applyMigrations(db, all.slice(index));

  alice = await createAuthUser(db, {
    email: "alice@example.com",
    meta: { full_name: "Alice Jansen", phone: "+597 8000001" },
  });
  staff = await createAuthUser(db, { email: "kevin@example.com", confirmed: false });
  admin = await createAuthUser(db, { email: "maria@example.com", confirmed: false });
  await db.query(
    "insert into public.user_roles (user_id, role) values ($1, 'staff'), ($2, 'admin')",
    [staff.id, admin.id],
  );
  await confirmAuthUser(db, staff.id);
  await confirmAuthUser(db, admin.id);
  aliceCustomer = (
    await rows<{ id: string }>("select id from public.customers where user_id = $1", [alice.id])
  )[0]!.id;
  const make = (description: string) =>
    asUser(
      db,
      alice.id,
      async (tx) =>
        (
          await tx.query<{ id: string }>(
            `insert into public.orders (customer_id, order_type, service_type, store_vendor, description, quantity, tracking_number)
             values ($1, 'personal', 'air', 'Amazon', $2, 1, '1Z999') returning id`,
            [aliceCustomer, description],
          )
        ).rows[0]!.id,
      { commit: true },
    );
  orderA = await make("Schoenen");
  orderB = await make("Koptelefoon");
});

afterAll(async () => {
  await db?.close();
});

describe("US address: just the customer's name", () => {
  it("rewrites the earlier defaults and keeps the owner's own templates", async () => {
    expect(
      await rows(
        "select label, recipient_name_template, address_line2_template from public.warehouse_addresses order by label",
      ),
    ).toEqual([
      { label: "Air/Ocean", recipient_name_template: "{FULL_NAME}", address_line2_template: "" },
      {
        label: "Eigen",
        recipient_name_template: "Attn {FULL_NAME}",
        address_line2_template: "Suite {GR_CODE}",
      },
      { label: "Oud", recipient_name_template: "{FULL_NAME}", address_line2_template: "" },
    ]);
    const defaults = await rows<{ column_name: string; column_default: string }>(
      `select column_name, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'warehouse_addresses'
          and column_name in ('recipient_name_template', 'address_line2_template') order by 1`,
    );
    expect(defaults).toEqual([
      { column_name: "address_line2_template", column_default: "''::text" },
      { column_name: "recipient_name_template", column_default: "'{FULL_NAME}'::text" },
    ]);
  });
});

describe("order labels", () => {
  it("the team labels several orders at once; the same label again is ignored, whatever its case", async () => {
    const first = await asUser(
      db,
      staff.id,
      (tx) => tx.query(LABEL_INSERT, [[orderA, orderB], "Air", "blue"]),
      { commit: true },
    );
    expect(first.rows).toHaveLength(2);
    const again = await asUser(
      db,
      admin.id,
      (tx) => tx.query(LABEL_INSERT, [[orderA], "air", "green"]),
      { commit: true },
    );
    expect(again.rows).toEqual([]);
    expect(
      await rows(
        "select order_id, label, color, created_by from public.order_labels order by order_id",
      ),
    ).toEqual(
      [orderA, orderB]
        .sort()
        .map((id) => ({ order_id: id, label: "Air", color: "blue", created_by: staff.id })),
    );
    // A plain insert of a duplicate is refused.
    await expectSqlError(
      asUser(db, staff.id, (tx) =>
        tx.query(
          "insert into public.order_labels (order_id, label, color) values ($1, 'AIR', 'red')",
          [orderA],
        ),
      ),
      "23505",
    );
  });

  it("checks the text and the colour", async () => {
    await asUser(db, staff.id, async (tx) => {
      for (const [label, color] of [
        ["", "blue"],
        [" Air", "blue"],
        ["x".repeat(31), "blue"],
        ["Ocean", "purple"],
      ]) {
        await expectSqlError(
          withSavepoint(tx, () =>
            tx.query(
              "insert into public.order_labels (order_id, label, color) values ($1, $2, $3)",
              [orderA, label, color],
            ),
          ),
          "23514",
        );
      }
      // Authorship comes from the database, not from the client.
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query(
            "insert into public.order_labels (order_id, label, color, created_by) values ($1, 'X', 'grey', $2)",
            [orderA, admin.id],
          ),
        ),
        "42501",
      );
    });
  });

  it("customers neither see nor write labels, not even on their own orders", async () => {
    const seen = await asUser(db, alice.id, (tx) => tx.query("select * from public.order_labels"));
    expect(seen.rows).toEqual([]);
    await expectSqlError(
      asUser(db, alice.id, (tx) => tx.query(LABEL_INSERT, [[orderA], "Spoed", "red"])),
      "42501",
    );
    const deleted = await asUser(db, alice.id, (tx) =>
      tx.query("delete from public.order_labels where order_id = $1", [orderA]),
    );
    expect(deleted.affectedRows).toBe(0);
    // Labels are added and removed, never edited.
    await expectSqlError(
      asUser(db, staff.id, (tx) =>
        tx.query("update public.order_labels set color = 'red' where order_id = $1", [orderA]),
      ),
      "42501",
    );
  });

  it("the team removes a label; adding and removing are in the audit log", async () => {
    const [label] = await rows<{ id: string }>(
      "select id from public.order_labels where order_id = $1",
      [orderB],
    );
    const removed = await asUser(
      db,
      admin.id,
      (tx) => tx.query("delete from public.order_labels where id = $1", [label!.id]),
      { commit: true },
    );
    expect(removed.affectedRows).toBe(1);
    expect(
      await rows(
        "select action, actor_id from public.audit_log where table_name = 'order_labels' and record_id = $1 order by id",
        [label!.id],
      ),
    ).toEqual([
      { action: "INSERT", actor_id: staff.id },
      { action: "DELETE", actor_id: admin.id },
    ]);
  });
});
