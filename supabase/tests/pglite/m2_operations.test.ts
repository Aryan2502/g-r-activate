// @vitest-environment node
/**
 * Migration 2 (operations): shipment statuses, orders, shipments, the status
 * history, order documents with their storage bucket, and internal notes.
 *
 * Fixtures are created as the superuser or through createAuthUser (which runs
 * the real auth.users trigger); every access rule is asserted through
 * asUser/asAnon/asService, never through db.query. The database is shared by
 * the whole file, so each test creates its own orders and filters by them.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AuthUser,
  type Db,
  type Transaction,
  applyMigrations,
  asAnon,
  asService,
  asUser,
  createAuthUser,
  createDb,
  expectSqlError,
  listMigrations,
  withSavepoint,
} from "./harness";

type Q = Pick<Transaction, "query">;

const M2_TABLES = [
  "shipment_statuses",
  "shipments",
  "orders",
  "shipment_status_history",
  "order_documents",
  "internal_notes",
];

// SPEC §35.7: what a customer may enter and later edit while the order is registered.
const CUSTOMER_EDITABLE = [
  "order_type",
  "service_type",
  "store_vendor",
  "vendor_order_number",
  "description",
  "quantity",
  "estimated_value",
  "estimated_value_currency",
  "purchase_date",
  "expected_delivery_date",
  "customer_note",
  "tracking_number",
  "carrier",
  "declared_weight_lbs",
  "supplier_name",
  "client_po_number",
  "purchase_mode",
];
// Staff also write these directly; customers only set parent_order_id on insert.
const STAFF_EDITABLE = ["measured_weight_lbs", "shipment_id", "parent_order_id"];
// Set by triggers or the RPCs, never by a client.
const SYSTEM_COLUMNS = [
  "id",
  "reference",
  "customer_id",
  "created_by_role",
  "tracking_number_normalized",
  "status",
  "received_at",
  "received_by",
  "picked_up_at",
  "picked_up_by_name",
  "handed_over_by",
  "cancellation_requested_at",
  "created_at",
  "created_by",
  "updated_at",
  "updated_by",
];

async function rows<T>(tx: Q, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await tx.query<T>(sql, params)).rows;
}

async function one<T>(tx: Q, sql: string, params: unknown[] = []): Promise<T> {
  const r = await rows<T>(tx, sql, params);
  expect(r).toHaveLength(1);
  return r[0] as T;
}

interface Order {
  id: string;
  reference: string;
  customer_id: string;
  created_by_role: string;
  order_type: string;
  service_type: string;
  description: string | null;
  tracking_number: string | null;
  tracking_number_normalized: string | null;
  declared_weight_lbs: string | null;
  measured_weight_lbs: string | null;
  status: string;
  shipment_id: string | null;
  parent_order_id: string | null;
  received_at: Date | null;
  received_by: string | null;
  picked_up_at: Date | null;
  picked_up_by_name: string | null;
  handed_over_by: string | null;
  cancellation_requested_at: Date | null;
  created_by: string | null;
  updated_by: string | null;
}

interface StatusResult {
  order_id: string;
  history_id: number | null;
  customer_id: string;
  notify: boolean;
}

interface History {
  id: number;
  order_id: string;
  from_status: string;
  to_status: string;
  changed_by: string | null;
  customer_message: string | null;
}

interface People {
  admin: AuthUser;
  staff: AuthUser;
  alice: AuthUser;
  bob: AuthUser;
  carol: AuthUser;
  nobody: AuthUser;
  aliceCustomer: string;
  bobCustomer: string;
  carolCustomer: string;
  daveCustomer: string;
}

async function customerIdOf(db: Db, userId: string): Promise<string> {
  const r = await rows<{ id: string }>(db, "select id from public.customers where user_id = $1", [
    userId,
  ]);
  if (!r[0]) throw new Error(`no customer for ${userId}`);
  return r[0].id;
}

/**
 * Admin (bootstrapped as SPEC §35.4 describes), a staff member, two active
 * customers (alice, bob), a disabled one (carol), a login without a customer
 * record (nobody) and a customer without a login (dave).
 */
async function seedPeople(db: Db): Promise<People> {
  const admin = await createAuthUser(db, { email: "admin@example.com" });
  await db.query("insert into public.user_roles (user_id, role) values ($1, 'admin')", [admin.id]);
  await db.query(
    `update public.customers set user_id = null, status = 'disabled', disabled_reason = 'bootstrap admin'
      where user_id = $1`,
    [admin.id],
  );
  const staff = await createAuthUser(db, { email: "staff@example.com", confirmed: false });
  await db.query("insert into public.user_roles (user_id, role) values ($1, 'staff')", [staff.id]);

  const alice = await createAuthUser(db, {
    email: "alice@example.com",
    meta: { full_name: "Alice Jansen", phone: "+597 8000001" },
  });
  const bob = await createAuthUser(db, {
    email: "bob@example.com",
    meta: { full_name: "Bob Bakker", phone: "+597 8000002" },
  });
  const carol = await createAuthUser(db, {
    email: "carol@example.com",
    meta: { full_name: "Carol Kromo", phone: "+597 8000003" },
  });
  await db.query("update public.customers set status = 'disabled' where user_id = $1", [carol.id]);
  const nobody = await createAuthUser(db, { email: "nobody@example.com", confirmed: false });

  const dave = await asUser(
    db,
    staff.id,
    (tx) =>
      one<{ id: string }>(
        tx,
        "select id from public.create_customer(_full_name => 'Dave Doorn', _phone => '+597 8000004')",
      ),
    { commit: true },
  );

  return {
    admin,
    staff,
    alice,
    bob,
    carol,
    nobody,
    aliceCustomer: await customerIdOf(db, alice.id),
    bobCustomer: await customerIdOf(db, bob.id),
    carolCustomer: await customerIdOf(db, carol.id),
    daveCustomer: dave.id,
  };
}

function insertSql(table: string, values: Record<string, unknown>): string {
  const cols = Object.keys(values);
  return `insert into ${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`;
}

/** Inserts an order as `userId` the way the portal would (PostgREST insert). */
async function insertOrder(
  db: Db,
  userId: string,
  values: Record<string, unknown>,
  opts: { commit?: boolean } = { commit: true },
): Promise<Order> {
  return asUser(
    db,
    userId,
    (tx) => one<Order>(tx, insertSql("public.orders", values), Object.values(values)),
    opts,
  );
}

async function changeStatus(
  tx: Q,
  ids: string[],
  to: string,
  message: string | null = null,
  pickedUpBy: string | null = null,
): Promise<StatusResult[]> {
  return rows<StatusResult>(
    tx,
    "select * from public.change_order_status($1::uuid[], $2, $3, $4) order by order_id",
    [ids, to, message, pickedUpBy],
  );
}

async function orderRow(db: Db, id: string): Promise<Order> {
  return one<Order>(db, "select * from public.orders where id = $1", [id]);
}

function objectPath(customerId: string, orderId: string, ext = "pdf"): string {
  return `${customerId}/${orderId}/${randomUUID()}.${ext}`;
}

// What the Storage API inserts on upload, under the caller's RLS.
async function uploadObject(tx: Q, path: string): Promise<void> {
  await tx.query(
    `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
     values ('order-documents', $1, auth.uid(), auth.uid()::text, '{"mimetype": "application/pdf", "size": 1000}')`,
    [path],
  );
}

// What the Storage API runs for a delete: it opts in to SQL deletes on storage
// tables (Supabase refuses them otherwise) and the caller's RLS decides.
async function deleteObject(tx: Q, path: string): Promise<number | undefined> {
  await tx.query("select set_config('storage.allow_delete_query', 'true', true)");
  const r = await tx.query(
    "delete from storage.objects where bucket_id = 'order-documents' and name = $1",
    [path],
  );
  await tx.query("select set_config('storage.allow_delete_query', 'false', true)");
  return r.affectedRows;
}

let db: Db;
let p: People;
let year: number;

beforeAll(async () => {
  db = await createDb();
  p = await seedPeople(db);
  year = (
    await one<{ y: number }>(
      db,
      "select extract(year from now() at time zone 'America/Paramaribo')::int as y",
    )
  ).y;
});

afterAll(async () => {
  await db?.close();
});

/** A fresh order for alice, committed. */
async function aliceOrder(extra: Record<string, unknown> = {}): Promise<Order> {
  return insertOrder(db, p.alice.id, {
    customer_id: p.aliceCustomer,
    description: "Schoenen",
    ...extra,
  });
}

async function moveAs(
  userId: string,
  ids: string[],
  to: string,
  message: string | null = null,
  pickedUpBy: string | null = null,
): Promise<StatusResult[]> {
  return asUser(db, userId, (tx) => changeStatus(tx, ids, to, message, pickedUpBy), {
    commit: true,
  });
}

// ---------------------------------------------------------------------------

describe("schema", () => {
  it("is idempotent: re-running keeps admin edits and restores the bucket settings", async () => {
    const all = listMigrations();
    const m2 = all.find((m) => m.name === "operations");
    if (!m2) throw new Error("operations migration not found");
    // Later migrations extend m2's objects (e.g. column grants on internal_notes),
    // so re-run it against the state it produced itself.
    const own = await createDb({ migrations: false });
    const fingerprint = `
      select (select count(*) from public.shipment_statuses)::int as statuses,
             (select count(*) from storage.buckets)::int as buckets,
             (select count(*) from pg_policies where schemaname in ('public', 'storage'))::int as policies,
             (select count(*) from pg_trigger where not tgisinternal)::int as triggers,
             (select count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace
               where n.nspname in ('public', 'private'))::int as constraints,
             (select count(*) from pg_indexes where schemaname in ('public', 'private'))::int as indexes,
             (select string_agg(c.relname || '=' || coalesce(c.relacl::text, ''), ';' order by c.relname)
                from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public') as table_acl,
             (select string_agg(a.attrelid::regclass::text || '.' || a.attname || '=' || a.attacl::text, ';'
                                order by a.attrelid::regclass::text, a.attnum)
                from pg_attribute a join pg_class c on c.oid = a.attrelid
                join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and a.attacl is not null) as column_acl`;
    try {
      await applyMigrations(
        own,
        all.filter((m) => m.version <= m2.version),
      );
      await own.transaction(async (tx) => {
        const before = await one(tx, fingerprint);
        await tx.query(
          "update public.shipment_statuses set label_nl = 'Eigen label' where code = 'pending'",
        );
        await tx.query(
          "update storage.buckets set file_size_limit = 1, public = true where id = 'order-documents'",
        );
        await tx.exec(m2.sql);
        expect(await one(tx, fingerprint)).toEqual(before);
        expect(
          await one(tx, "select label_nl from public.shipment_statuses where code = 'pending'"),
        ).toEqual({ label_nl: "Eigen label" });
        expect(
          await one(
            tx,
            "select public, file_size_limit from storage.buckets where id = 'order-documents'",
          ),
        ).toEqual({ public: false, file_size_limit: 10485760 });
        await tx.rollback();
      });
    } finally {
      await own.close();
    }
  });

  it("defines the operations enums", async () => {
    const enums = await rows<{ typname: string; labels: string[] }>(
      db,
      `select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as labels
         from pg_type t join pg_enum e on e.enumtypid = t.oid
         join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' group by t.typname order by 1`,
    );
    expect(Object.fromEntries(enums.map((e) => [e.typname, e.labels]))).toMatchObject({
      status_stage: [
        "registered",
        "us_warehouse",
        "in_transit",
        "arrived_sr",
        "at_customs",
        "cleared",
        "ready_for_pickup",
        "completed",
        "cancelled",
        "action_required",
      ],
      order_type: ["personal", "b2b"],
      order_creator_role: ["customer", "staff"],
      purchase_mode: ["customer_purchased", "gr_purchases"],
      order_document_kind: [
        "purchase_invoice",
        "commercial_invoice",
        "packing_list",
        "customs_document",
        "other",
      ],
    });
  });

  it("seeds the §11 statuses with Dutch labels, mapped to stages", async () => {
    const statuses = await rows(
      db,
      `select code, label_nl, stage::text, is_terminal, customer_visible, notify_customer, active
         from public.shipment_statuses order by sort_order`,
    );
    const s = (
      code: string,
      label_nl: string,
      stage: string,
      notify_customer: boolean,
      is_terminal = false,
    ) => ({
      code,
      label_nl,
      stage,
      is_terminal,
      customer_visible: true,
      notify_customer,
      active: true,
    });
    expect(statuses).toEqual([
      s("order_registered", "Order aangemeld", "registered", false),
      s("pending", "In behandeling", "registered", false),
      s("awaiting_shipment", "Wacht op verzending door de winkel", "registered", false),
      s("arrived_us_warehouse", "Aangekomen in US-magazijn", "us_warehouse", true),
      s("in_transit", "Onderweg naar Suriname", "in_transit", true),
      s("arrived_suriname", "Aangekomen in Suriname", "arrived_sr", true),
      s("at_customs", "Bij de douane", "at_customs", false),
      s("customs_cleared", "Ingeklaard", "cleared", false),
      s("ready_for_pickup", "Klaar voor afhalen", "ready_for_pickup", true),
      s("picked_up", "Afgehaald", "completed", false, true),
      s("delivered", "Bezorgd", "completed", false, true),
      s("documents_required", "Actie vereist – documenten nodig", "action_required", true),
      s("cancelled", "Geannuleerd", "cancelled", true, true),
    ]);
    const undescribed = await rows(
      db,
      "select code from public.shipment_statuses where coalesce(btrim(customer_description_nl), '') = ''",
    );
    expect(undescribed).toEqual([]);
  });

  it("creates the private order-documents bucket with the SPEC limits", async () => {
    expect(
      await one(
        db,
        "select id, name, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'order-documents'",
      ),
    ).toEqual({
      id: "order-documents",
      name: "order-documents",
      public: false,
      file_size_limit: 10485760,
      allowed_mime_types: [
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/heic",
      ],
    });
  });

  it("links staff_tasks.order_id to orders", async () => {
    await expectSqlError(
      db.query(
        "insert into public.staff_tasks (kind, order_id, body) values ('order_cancellation_request', $1, 'x')",
        [randomUUID()],
      ),
      "23503",
    );
  });

  it("keeps the order number counter out of the API roles' reach", async () => {
    const r = await one<Record<string, boolean>>(
      db,
      `select has_table_privilege('authenticated', 'private.order_reference_counters', 'select') as auth_select,
              has_table_privilege('service_role', 'private.order_reference_counters', 'select') as service_select,
              has_sequence_privilege('authenticated', 'public.shipment_status_history_id_seq', 'usage') as auth_seq`,
    );
    expect(r).toEqual({ auth_select: false, service_select: false, auth_seq: false });
    await expectSqlError(
      asUser(db, p.staff.id, (tx) => tx.query("select private.next_order_reference()")),
      "42501",
    );
  });

  it("lets clients write only the order columns meant for them", async () => {
    const cols = await rows<{ name: string; ins: boolean; upd: boolean }>(
      db,
      `select a.attname as name,
              has_column_privilege('authenticated', a.attrelid, a.attname, 'INSERT') as ins,
              has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE') as upd
         from pg_attribute a
        where a.attrelid = 'public.orders'::regclass and a.attnum > 0 and not a.attisdropped`,
    );
    const sorted = (xs: string[]) => [...xs].sort();
    // Every column is classified: a new column must be added to one of the lists.
    expect(sorted(cols.map((c) => c.name))).toEqual(
      sorted([...CUSTOMER_EDITABLE, ...STAFF_EDITABLE, ...SYSTEM_COLUMNS]),
    );
    expect(sorted(cols.filter((c) => c.ins).map((c) => c.name))).toEqual(
      sorted([...CUSTOMER_EDITABLE, ...STAFF_EDITABLE, "customer_id"]),
    );
    expect(sorted(cols.filter((c) => c.upd).map((c) => c.name))).toEqual(
      sorted([...CUSTOMER_EDITABLE, ...STAFF_EDITABLE]),
    );
    const anyAnon = await one<{ any: boolean }>(
      db,
      `select bool_or(has_column_privilege('anon', 'public.orders'::regclass, a.attname, 'SELECT, INSERT, UPDATE')) as any
         from pg_attribute a where a.attrelid = 'public.orders'::regclass and a.attnum > 0`,
    );
    expect(anyAnon.any).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("orders: customers", () => {
  it("registers an order for the customer; the trigger fills reference, status and authorship", async () => {
    const o = await aliceOrder({
      store_vendor: "Amazon",
      vendor_order_number: "112-7",
      tracking_number: " 1z 999-aa1 ",
      carrier: "UPS",
      declared_weight_lbs: 3.5,
      estimated_value: 49.99,
      purchase_date: "2026-10-01",
    });
    expect(o.reference).toMatch(new RegExp(`^ORD-${year}-\\d{5}$`));
    expect(o).toMatchObject({
      customer_id: p.aliceCustomer,
      status: "order_registered",
      created_by_role: "customer",
      created_by: p.alice.id,
      updated_by: p.alice.id,
      tracking_number_normalized: "1Z999AA1",
      declared_weight_lbs: "3.50",
      measured_weight_lbs: null,
      order_type: "personal",
      service_type: "air",
    });

    // Edits keep the normalised tracking number in step.
    const edited = await asUser(
      db,
      p.alice.id,
      (tx) =>
        one<Order>(
          tx,
          "update public.orders set tracking_number = 'tba-123 456' where id = $1 returning *",
          [o.id],
        ),
      { commit: true },
    );
    expect(edited.tracking_number_normalized).toBe("TBA123456");
  });

  it("numbers references per Suriname year, without gaps from rolled-back inserts", async () => {
    const own = await createDb();
    try {
      const op = await seedPeople(own);
      const add = (commit: boolean) =>
        insertOrder(own, op.alice.id, { customer_id: op.aliceCustomer }, { commit });
      expect((await add(true)).reference).toBe(`ORD-${year}-00001`);
      await add(false);
      expect((await add(true)).reference).toBe(`ORD-${year}-00002`);
      expect(
        await rows(own, "select year, last_number from private.order_reference_counters"),
      ).toEqual([{ year, last_number: 2 }]);

      // Past 99999 the number gets more digits instead of stopping all orders.
      await own.query("update private.order_reference_counters set last_number = 99998");
      expect((await add(true)).reference).toBe(`ORD-${year}-99999`);
      expect((await add(true)).reference).toBe(`ORD-${year}-100000`);
    } finally {
      await own.close();
    }
  });

  it("drops the staff-only values a customer sends and refuses system columns", async () => {
    const shipment = await asUser(
      db,
      p.staff.id,
      (tx) =>
        one<{ id: string }>(
          tx,
          "insert into public.shipments (shipment_number) values ('AIR-RESET') returning id",
        ),
      { commit: true },
    );
    const o = await aliceOrder({ measured_weight_lbs: 99, shipment_id: shipment.id });
    expect(o.measured_weight_lbs).toBeNull();
    expect(o.shipment_id).toBeNull();

    const now = new Date().toISOString();
    const values: Record<string, unknown> = {
      id: randomUUID(),
      reference: "ORD-2020-00001",
      created_by_role: "staff",
      status: "in_transit",
      received_at: now,
      received_by: p.staff.id,
      picked_up_at: now,
      picked_up_by_name: "Iemand",
      handed_over_by: p.staff.id,
      cancellation_requested_at: now,
      created_at: now,
      created_by: p.bob.id,
      updated_at: now,
      updated_by: p.bob.id,
    };
    expect(Object.keys(values).sort()).toEqual(
      SYSTEM_COLUMNS.filter(
        (c) => !["customer_id", "tracking_number_normalized"].includes(c),
      ).sort(),
    );
    for (const user of [p.alice.id, p.staff.id]) {
      await asUser(db, user, async (tx) => {
        for (const [col, value] of Object.entries(values)) {
          await expectSqlError(
            withSavepoint(tx, () =>
              tx.query(`insert into public.orders (customer_id, ${col}) values ($1, $2)`, [
                p.aliceCustomer,
                value,
              ]),
            ),
            "42501",
          );
        }
        await expectSqlError(
          withSavepoint(tx, () =>
            tx.query(
              "insert into public.orders (customer_id, tracking_number_normalized) values ($1, 'X')",
              [p.aliceCustomer],
            ),
          ),
          /tracking_number_normalized/,
        );
      });
    }
  });

  it("refuses orders for someone else, without an active customer record, or from anon", async () => {
    const insert = (userId: string, customerId: string) =>
      insertOrder(db, userId, { customer_id: customerId }, { commit: false });
    await expectSqlError(insert(p.alice.id, p.bobCustomer), "42501");
    await expectSqlError(insert(p.carol.id, p.carolCustomer), "42501");
    await expectSqlError(insert(p.nobody.id, p.aliceCustomer), "42501");
    await expectSqlError(
      asAnon(db, (tx) =>
        tx.query("insert into public.orders (customer_id) values ($1)", [p.aliceCustomer]),
      ),
      "42501",
    );
  });

  // Public sign-up is open, so one account must not be able to flood the
  // order book or the shared yearly reference series.
  it("caps the open orders a customer registers themselves; staff are not limited", async () => {
    const own = await createDb();
    try {
      const op = await seedPeople(own);
      await own.query("update public.company_settings set max_open_orders_per_customer = 3");
      const mine = (n: number) =>
        asUser(
          own,
          op.alice.id,
          async (tx) =>
            (
              await tx.query<{ id: string }>(
                `insert into public.orders (customer_id)
                 select $1::uuid from generate_series(1, $2::int) returning id`,
                [op.aliceCustomer, n],
              )
            ).rows.map((r) => r.id),
          { commit: true },
        );

      // A bulk insert (PostgREST POST with an array) is one statement: all or nothing.
      const tooMany = await expectSqlError(mine(4), "54000");
      expect(tooMany.hint).toBe("open_order_limit");
      expect(tooMany.message).toMatch(/al 3 aangemelde orders/);
      expect(await rows(own, "select id from public.orders")).toEqual([]);

      const [first, second] = await mine(3);
      await expectSqlError(mine(1), "54000");

      // Staff register more for the same customer, and those do not use up her slots.
      await asUser(
        own,
        op.staff.id,
        (tx) =>
          tx.query("insert into public.orders (customer_id) values ($1), ($1)", [op.aliceCustomer]),
        { commit: true },
      );
      await expectSqlError(mine(1), "54000");

      // An order G&R received, or cancelled, is no longer open.
      await asUser(
        own,
        op.staff.id,
        async (tx) => {
          await tx.query("select * from public.receive_order($1, 2)", [first!]);
          await changeStatus(tx, [second!], "cancelled");
        },
        { commit: true },
      );
      expect(await mine(2)).toHaveLength(2);
      await expectSqlError(mine(1), "54000");

      // Other customers have their own allowance.
      expect(
        (await insertOrder(own, op.bob.id, { customer_id: op.bobCustomer })).reference,
      ).toMatch(/^ORD-/);
    } finally {
      await own.close();
    }
  });

  it("offers customers only enabled services (sea is off by default)", async () => {
    await expectSqlError(
      insertOrder(
        db,
        p.alice.id,
        { customer_id: p.aliceCustomer, service_type: "sea" },
        { commit: false },
      ),
      "22023",
    );
    const o = await aliceOrder();
    await expectSqlError(
      asUser(db, p.alice.id, (tx) =>
        tx.query("update public.orders set service_type = 'sea' where id = $1", [o.id]),
      ),
      "22023",
    );
    const bySstaff = await insertOrder(
      db,
      p.staff.id,
      { customer_id: p.aliceCustomer, service_type: "sea" },
      { commit: false },
    );
    expect(bySstaff.service_type).toBe("sea");
  });

  it("customers edit their fields only while the order is registered", async () => {
    const o = await aliceOrder();
    const update = (userId: string, set: string, params: unknown[] = []) =>
      asUser(
        db,
        userId,
        (tx) => tx.query(`update public.orders set ${set} where id = $1`, [o.id, ...params]),
        { commit: true },
      );

    const ok = await update(
      p.alice.id,
      "description = 'Laptop', declared_weight_lbs = 4, customer_note = 'Breekbaar'",
    );
    expect(ok.affectedRows).toBe(1);
    expect(await orderRow(db, o.id)).toMatchObject({
      description: "Laptop",
      declared_weight_lbs: "4.00",
      updated_by: p.alice.id,
    });

    await expectSqlError(update(p.alice.id, "measured_weight_lbs = 1"), "42501");
    await expectSqlError(update(p.alice.id, "status = 'in_transit'"), "42501");
    await expectSqlError(update(p.alice.id, "customer_id = $2", [p.bobCustomer]), "42501");
    expect((await update(p.bob.id, "description = 'Gekaapt'")).affectedRows).toBe(0);
    expect((await update(p.carol.id, "description = 'Gekaapt'")).affectedRows).toBe(0);

    // Still the 'registered' stage: editable.
    await moveAs(p.staff.id, [o.id], "awaiting_shipment");
    expect((await update(p.alice.id, "description = 'Laptop 2'")).affectedRows).toBe(1);

    await moveAs(p.staff.id, [o.id], "in_transit");
    await expectSqlError(update(p.alice.id, "description = 'Te laat'"), "55000");
    expect((await orderRow(db, o.id)).description).toBe("Laptop 2");
  });

  it("nobody deletes orders", async () => {
    const o = await aliceOrder();
    for (const user of [p.alice.id, p.staff.id, p.admin.id]) {
      await expectSqlError(
        asUser(db, user, (tx) => tx.query("delete from public.orders where id = $1", [o.id])),
        "42501",
      );
    }
  });

  it("customers see only their own orders; disabled customers and anon see none", async () => {
    const a = await aliceOrder();
    const b = await insertOrder(db, p.bob.id, { customer_id: p.bobCustomer });
    const visible = (userId: string) =>
      asUser(db, userId, (tx) =>
        rows<{ id: string }>(tx, "select id from public.orders where id = any($1::uuid[])", [
          [a.id, b.id],
        ]),
      );
    expect(await visible(p.alice.id)).toEqual([{ id: a.id }]);
    expect(await visible(p.bob.id)).toEqual([{ id: b.id }]);
    expect(await visible(p.carol.id)).toEqual([]);
    expect(await visible(p.nobody.id)).toEqual([]);
    expect((await visible(p.staff.id)).length).toBe(2);
    await expectSqlError(
      asAnon(db, (tx) => tx.query("select * from public.orders")),
      "42501",
    );
  });

  it("links extra packages to a root order of the same customer", async () => {
    const parent = await aliceOrder();
    const child = await aliceOrder({ parent_order_id: parent.id });
    expect(child.parent_order_id).toBe(parent.id);

    await expectSqlError(aliceOrder({ parent_order_id: child.id }), "22023");
    const bobs = await insertOrder(db, p.bob.id, { customer_id: p.bobCustomer });
    await expectSqlError(aliceOrder({ parent_order_id: bobs.id }), "22023");

    // Customers cannot regroup after the fact; staff can, within the rules.
    const loose = await aliceOrder();
    await expectSqlError(
      asUser(db, p.alice.id, (tx) =>
        tx.query("update public.orders set parent_order_id = $2 where id = $1", [
          loose.id,
          parent.id,
        ]),
      ),
      "42501",
    );
    await asUser(db, p.staff.id, async (tx) => {
      await tx.query("update public.orders set parent_order_id = $2 where id = $1", [
        loose.id,
        parent.id,
      ]);
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("update public.orders set parent_order_id = $2 where id = $1", [
            parent.id,
            loose.id,
          ]),
        ),
        "22023",
      );
    });
    const single = await aliceOrder();
    await expectSqlError(
      asUser(db, p.staff.id, (tx) =>
        tx.query("update public.orders set parent_order_id = id where id = $1", [single.id]),
      ),
      "22023",
    );
  });

  it("validates order values; B2B fields belong to B2B orders", async () => {
    const bad: Record<string, unknown>[] = [
      { supplier_name: "Leverancier" },
      { purchase_mode: "gr_purchases" },
      { quantity: 0 },
      { estimated_value: -1 },
      { declared_weight_lbs: 0 },
      { purchase_date: "2026-10-05", expected_delivery_date: "2026-10-01" },
    ];
    await asUser(db, p.alice.id, async (tx) => {
      for (const extra of bad) {
        const values = { customer_id: p.aliceCustomer, ...extra };
        await expectSqlError(
          withSavepoint(tx, () =>
            tx.query(insertSql("public.orders", values), Object.values(values)),
          ),
          "23514",
        );
      }
      const b2b = {
        customer_id: p.aliceCustomer,
        order_type: "b2b",
        supplier_name: "Leverancier",
        client_po_number: "PO-1",
        purchase_mode: "customer_purchased",
      };
      const o = await one<Order>(tx, insertSql("public.orders", b2b), Object.values(b2b));
      expect(o.order_type).toBe("b2b");
    });
  });
});

// ---------------------------------------------------------------------------

describe("orders: staff", () => {
  it("staff register orders for any active customer, including one without a login", async () => {
    const o = await insertOrder(db, p.staff.id, {
      customer_id: p.daveCustomer,
      tracking_number: "9400 1000",
      measured_weight_lbs: 2.25,
    });
    expect(o).toMatchObject({
      customer_id: p.daveCustomer,
      created_by_role: "staff",
      created_by: p.staff.id,
      status: "order_registered",
      measured_weight_lbs: "2.25",
      received_at: null,
    });
    await expectSqlError(
      insertOrder(db, p.staff.id, { customer_id: p.carolCustomer }, { commit: false }),
      "55000",
    );
  });

  it("staff edit order details at any stage but never status, receiving, pickup or ownership", async () => {
    const o = await aliceOrder();
    await moveAs(p.staff.id, [o.id], "in_transit");
    await asUser(db, p.staff.id, async (tx) => {
      const r = await tx.query(
        "update public.orders set description = 'Herzien', measured_weight_lbs = 7 where id = $1",
        [o.id],
      );
      expect(r.affectedRows).toBe(1);
      const now = new Date().toISOString();
      const protectedValues: Record<string, unknown> = {
        status: "ready_for_pickup",
        reference: "ORD-2020-00001",
        customer_id: p.bobCustomer,
        received_at: now,
        received_by: p.staff.id,
        picked_up_at: now,
        picked_up_by_name: "Iemand",
        handed_over_by: p.staff.id,
        cancellation_requested_at: now,
        created_by_role: "customer",
        created_by: p.bob.id,
      };
      for (const [col, value] of Object.entries(protectedValues)) {
        await expectSqlError(
          withSavepoint(tx, () =>
            tx.query(`update public.orders set ${col} = $2 where id = $1`, [o.id, value]),
          ),
          "42501",
        );
      }
    });
  });

  it("the service role only reads orders", async () => {
    const o = await aliceOrder();
    await asService(db, async (tx) => {
      expect((await rows(tx, "select id from public.orders where id = $1", [o.id])).length).toBe(1);
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("update public.orders set description = 'x' where id = $1", [o.id]),
        ),
        "42501",
      );
    });
  });

  it("the triggers still hold if a later migration widens the column grants", async () => {
    const o = await aliceOrder();
    const widened = "(status, received_at, created_by, reference)";
    await db.query(`grant insert ${widened}, update ${widened} on public.orders to authenticated`);
    try {
      const sneaky = await insertOrder(
        db,
        p.alice.id,
        {
          customer_id: p.aliceCustomer,
          status: "ready_for_pickup",
          received_at: new Date().toISOString(),
          created_by: p.bob.id,
          reference: "ORD-2020-00001",
        },
        { commit: false },
      );
      expect(sneaky).toMatchObject({
        status: "order_registered",
        received_at: null,
        created_by: p.alice.id,
      });
      expect(sneaky.reference).toMatch(new RegExp(`^ORD-${year}-`));

      for (const user of [p.alice.id, p.staff.id, p.admin.id]) {
        for (const set of [
          "status = 'ready_for_pickup'",
          "received_at = now()",
          "reference = 'X'",
        ]) {
          await expectSqlError(
            asUser(db, user, (tx) =>
              tx.query(`update public.orders set ${set} where id = $1`, [o.id]),
            ),
            "42501",
          );
        }
      }
    } finally {
      await db.query(
        `revoke insert ${widened}, update ${widened} on public.orders from authenticated`,
      );
    }
  });
});

// ---------------------------------------------------------------------------

describe("change_order_status", () => {
  it("is refused to customers, disabled customers and anon", async () => {
    const o = await aliceOrder();
    for (const user of [p.alice.id, p.carol.id, p.nobody.id]) {
      await expectSqlError(
        asUser(db, user, (tx) => changeStatus(tx, [o.id], "in_transit")),
        "42501",
      );
    }
    await expectSqlError(
      asAnon(db, (tx) => changeStatus(tx, [o.id], "in_transit")),
      "42501",
    );
    expect((await orderRow(db, o.id)).status).toBe("order_registered");
  });

  it("moves one or many orders, records history with the message and reports whom to notify", async () => {
    const a = await aliceOrder();
    const b = await insertOrder(db, p.bob.id, { customer_id: p.bobCustomer });
    const result = await moveAs(p.staff.id, [a.id, b.id, a.id], "in_transit", "  Vlucht PY 731  ");

    expect(result).toHaveLength(2);
    const byOrder = Object.fromEntries(result.map((r) => [r.order_id, r]));
    expect(byOrder[a.id]).toMatchObject({ customer_id: p.aliceCustomer, notify: true });
    expect(byOrder[b.id]).toMatchObject({ customer_id: p.bobCustomer, notify: true });

    const history = await rows<History>(
      db,
      "select * from public.shipment_status_history where order_id = any($1::uuid[]) order by order_id",
      [[a.id, b.id]],
    );
    expect(history).toHaveLength(2);
    for (const h of history) {
      expect(h).toMatchObject({
        from_status: "order_registered",
        to_status: "in_transit",
        changed_by: p.staff.id,
        customer_message: "Vlucht PY 731",
      });
      expect(byOrder[h.order_id]?.history_id).toBe(h.id);
    }
    expect(await orderRow(db, a.id)).toMatchObject({
      status: "in_transit",
      updated_by: p.staff.id,
    });

    const audit = await rows<{ actor_id: string; changed_columns: string[] }>(
      db,
      "select actor_id, changed_columns from public.audit_log where table_name = 'orders' and record_id = $1 and action = 'UPDATE'",
      [a.id],
    );
    expect(audit).toEqual([{ actor_id: p.staff.id, changed_columns: ["status"] }]);
  });

  it("validates the status, the selection and the inputs each stage needs", async () => {
    const o = await aliceOrder();
    await asUser(db, p.admin.id, async (tx) => {
      const fails = (
        code: string,
        ids: string[],
        to: string,
        message: string | null = null,
        pickedUpBy: string | null = null,
      ) =>
        expectSqlError(
          withSavepoint(tx, () => changeStatus(tx, ids, to, message, pickedUpBy)),
          code,
        );
      await fails("22023", [o.id], "bestaat_niet");
      await tx.query("update public.shipment_statuses set active = false where code = 'pending'");
      await fails("22023", [o.id], "pending");
      await fails("22023", [], "in_transit");
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("select * from public.change_order_status(array[null]::uuid[], 'in_transit')"),
        ),
        "22023",
      );
      await fails("P0002", [o.id, randomUUID()], "in_transit");
      await fails("22023", [o.id], "picked_up");
      await fails("22023", [o.id], "picked_up", null, "   ");
      await fails("22023", [o.id], "in_transit", null, "Iemand");
      await fails("22023", [o.id], "documents_required");
      await fails("22023", [o.id], "in_transit", "x".repeat(2001));
    });
    expect((await orderRow(db, o.id)).status).toBe("order_registered");
    expect(
      await rows(db, "select 1 from public.shipment_status_history where order_id = $1", [o.id]),
    ).toEqual([]);
  });

  it("reports orders already in the target status as unchanged", async () => {
    const a = await aliceOrder();
    const b = await aliceOrder();
    await moveAs(p.staff.id, [a.id], "in_transit");
    const result = await moveAs(p.staff.id, [a.id, b.id], "in_transit");
    expect(result.find((r) => r.order_id === a.id)).toEqual({
      order_id: a.id,
      history_id: null,
      customer_id: p.aliceCustomer,
      notify: false,
    });
    expect(result.find((r) => r.order_id === b.id)?.history_id).toEqual(expect.any(Number));
    expect(
      await rows(db, "select 1 from public.shipment_status_history where order_id = $1", [a.id]),
    ).toHaveLength(1);
  });

  it("records the pickup on a completed stage and clears it when corrected", async () => {
    const o = await aliceOrder();
    await moveAs(p.staff.id, [o.id], "ready_for_pickup");
    const [done] = await moveAs(p.staff.id, [o.id], "picked_up", null, " Alice Jansen ");
    expect(done?.notify).toBe(false);
    const picked = await orderRow(db, o.id);
    expect(picked).toMatchObject({
      status: "picked_up",
      picked_up_by_name: "Alice Jansen",
      handed_over_by: p.staff.id,
    });
    expect(picked.picked_up_at).toBeInstanceOf(Date);

    await moveAs(p.staff.id, [o.id], "ready_for_pickup");
    expect(await orderRow(db, o.id)).toMatchObject({
      status: "ready_for_pickup",
      picked_up_at: null,
      picked_up_by_name: null,
      handed_over_by: null,
    });
  });

  it("asks for a message when documents are required, and never leaks it to a later change", async () => {
    const o = await aliceOrder();
    await asUser(db, p.staff.id, async (tx) => {
      const [r] = await changeStatus(tx, [o.id], "documents_required", "Upload de packing list");
      expect(r?.notify).toBe(true);
      expect(
        await one(
          tx,
          `select current_setting('app.status_message', true) as message,
                  current_setting('app.order_internal_write', true) as internal`,
        ),
      ).toEqual({ message: "", internal: "" });
      await changeStatus(tx, [o.id], "order_registered");
      const history = await rows<History>(
        tx,
        "select * from public.shipment_status_history where order_id = $1 order by id",
        [o.id],
      );
      expect(history.map((h) => [h.to_status, h.customer_message])).toEqual([
        ["documents_required", "Upload de packing list"],
        ["order_registered", null],
      ]);
    });
  });

  it("notifies only for statuses that are customer-visible and set to notify", async () => {
    const o = await aliceOrder();
    await asUser(db, p.admin.id, async (tx) => {
      expect((await changeStatus(tx, [o.id], "pending"))[0]?.notify).toBe(false);
      await tx.query(
        "update public.shipment_statuses set customer_visible = false where code = 'in_transit'",
      );
      expect((await changeStatus(tx, [o.id], "in_transit"))[0]?.notify).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------

describe("status history", () => {
  it("customers read their own orders' history for customer-visible statuses only", async () => {
    const a = await aliceOrder();
    const b = await insertOrder(db, p.bob.id, { customer_id: p.bobCustomer });
    await moveAs(p.staff.id, [a.id, b.id], "pending");
    await moveAs(p.staff.id, [a.id, b.id], "in_transit", "Onderweg");
    const seen = (userId: string) =>
      asUser(db, userId, (tx) =>
        rows<{ order_id: string; to_status: string; customer_message: string | null }>(
          tx,
          `select order_id, to_status, customer_message from public.shipment_status_history
            where order_id = any($1::uuid[]) order by id`,
          [[a.id, b.id]],
        ),
      );
    expect(await seen(p.alice.id)).toEqual([
      { order_id: a.id, to_status: "pending", customer_message: null },
      { order_id: a.id, to_status: "in_transit", customer_message: "Onderweg" },
    ]);
    expect((await seen(p.bob.id)).map((h) => h.order_id)).toEqual([b.id, b.id]);
    expect(await seen(p.carol.id)).toEqual([]);
    expect(await seen(p.staff.id)).toHaveLength(4);
    await expectSqlError(
      asAnon(db, (tx) => tx.query("select * from public.shipment_status_history")),
      "42501",
    );

    await asUser(
      db,
      p.admin.id,
      (tx) =>
        tx.query(
          "update public.shipment_statuses set customer_visible = false where code = 'pending'",
        ),
      { commit: true },
    );
    try {
      expect((await seen(p.alice.id)).map((h) => h.to_status)).toEqual(["in_transit"]);
      expect(
        await asUser(db, p.alice.id, (tx) =>
          rows(tx, "select code from public.shipment_statuses where code = 'pending'"),
        ),
      ).toEqual([]);
      expect(await seen(p.staff.id)).toHaveLength(4);
    } finally {
      await db.query(
        "update public.shipment_statuses set customer_visible = true where code = 'pending'",
      );
    }
  });

  it("is append-only: no client role writes it", async () => {
    const o = await aliceOrder();
    await moveAs(p.staff.id, [o.id], "pending");
    const statements = [
      [
        "insert into public.shipment_status_history (order_id, from_status, to_status) values ($1, 'pending', 'cancelled')",
        [o.id],
      ],
      [
        "update public.shipment_status_history set customer_message = 'x' where order_id = $1",
        [o.id],
      ],
      ["delete from public.shipment_status_history where order_id = $1", [o.id]],
    ] as const;
    for (const user of [p.alice.id, p.staff.id, p.admin.id]) {
      await asUser(db, user, async (tx) => {
        for (const [sql, params] of statements) {
          await expectSqlError(
            withSavepoint(tx, () => tx.query(sql, [...params])),
            "42501",
          );
        }
      });
    }
    await asService(db, async (tx) => {
      for (const [sql, params] of statements) {
        await expectSqlError(
          withSavepoint(tx, () => tx.query(sql, [...params])),
          "42501",
        );
      }
    });
  });
});

// ---------------------------------------------------------------------------

describe("receive_order", () => {
  const receive = (userId: string, orderId: string, lbs: number | null) =>
    asUser(
      db,
      userId,
      (tx) => rows<StatusResult>(tx, "select * from public.receive_order($1, $2)", [orderId, lbs]),
      { commit: true },
    );

  it("is refused to customers and anon", async () => {
    const o = await aliceOrder();
    await expectSqlError(receive(p.alice.id, o.id, 5), "42501");
    await expectSqlError(
      asAnon(db, (tx) => tx.query("select * from public.receive_order($1, 5)", [o.id])),
      "42501",
    );
  });

  it("records the weight and moves the order to the first active US-warehouse status", async () => {
    const o = await aliceOrder();
    const [r] = await receive(p.staff.id, o.id, 12.345);
    expect(r).toMatchObject({ order_id: o.id, customer_id: p.aliceCustomer, notify: true });
    const after = await orderRow(db, o.id);
    expect(after).toMatchObject({
      status: "arrived_us_warehouse",
      measured_weight_lbs: "12.35",
      received_by: p.staff.id,
    });
    expect(after.received_at).toBeInstanceOf(Date);
    const history = await rows<History>(
      db,
      "select * from public.shipment_status_history where order_id = $1",
      [o.id],
    );
    expect(history).toEqual([
      expect.objectContaining({
        id: r?.history_id,
        from_status: "order_registered",
        to_status: "arrived_us_warehouse",
        changed_by: p.staff.id,
        customer_message: null,
      }),
    ]);

    // Receiving again while in the warehouse only corrects the weight.
    const [again] = await receive(p.admin.id, o.id, 13);
    expect(again).toEqual({
      order_id: o.id,
      history_id: null,
      customer_id: p.aliceCustomer,
      notify: false,
    });
    const corrected = await orderRow(db, o.id);
    expect(corrected).toMatchObject({ measured_weight_lbs: "13.00", received_by: p.staff.id });
    expect(corrected.received_at).toEqual(after.received_at);
  });

  it("validates the weight, the order and its stage", async () => {
    const o = await aliceOrder();
    await expectSqlError(receive(p.staff.id, o.id, 0), "22023");
    await expectSqlError(receive(p.staff.id, o.id, -2), "22023");
    await expectSqlError(receive(p.staff.id, o.id, null), "22023");
    await expectSqlError(receive(p.staff.id, randomUUID(), 2), "P0002");
    await moveAs(p.staff.id, [o.id], "in_transit");
    await expectSqlError(receive(p.staff.id, o.id, 2), "55000");
    await moveAs(p.staff.id, [o.id], "cancelled");
    await expectSqlError(receive(p.staff.id, o.id, 2), "55000");

    // A package that needed documents before it arrived can still be received.
    const waiting = await aliceOrder();
    await moveAs(p.staff.id, [waiting.id], "documents_required", "Stuur de factuur");
    expect((await receive(p.staff.id, waiting.id, 1))[0]?.history_id).toEqual(expect.any(Number));
  });

  it("uses the next active US-warehouse status, and refuses when there is none", async () => {
    const a = await aliceOrder();
    const b = await aliceOrder();
    await asUser(db, p.admin.id, async (tx) => {
      await tx.query(
        `insert into public.shipment_statuses (code, label_nl, stage, sort_order)
         values ('miami_warehouse', 'In magazijn Miami', 'us_warehouse', 45)`,
      );
      await tx.query(
        "update public.shipment_statuses set active = false where code = 'arrived_us_warehouse'",
      );
      await tx.query("select * from public.receive_order($1, 3)", [a.id]);
      expect(await one(tx, "select status from public.orders where id = $1", [a.id])).toEqual({
        status: "miami_warehouse",
      });
      await tx.query(
        "update public.shipment_statuses set active = false where code = 'miami_warehouse'",
      );
      await expectSqlError(tx.query("select * from public.receive_order($1, 3)", [b.id]), "55000");
    });
  });
});

// ---------------------------------------------------------------------------

describe("request_order_cancellation", () => {
  const request = (userId: string, orderId: string) =>
    asUser(
      db,
      userId,
      (tx) =>
        one<{ at: Date }>(tx, "select public.request_order_cancellation($1) as at", [orderId]),
      { commit: true },
    );

  it("the owner asks once; staff get one task, resolved when the order is cancelled", async () => {
    const o = await aliceOrder();
    const first = await request(p.alice.id, o.id);
    expect(first.at).toBeInstanceOf(Date);
    const second = await request(p.alice.id, o.id);
    expect(second.at).toEqual(first.at);
    expect((await orderRow(db, o.id)).cancellation_requested_at).toEqual(first.at);

    const tasks = await asUser(db, p.staff.id, (tx) =>
      rows<{ kind: string; customer_id: string; body: string; resolved_at: Date | null }>(
        tx,
        "select kind, customer_id, body, resolved_at from public.staff_tasks where order_id = $1",
        [o.id],
      ),
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      kind: "order_cancellation_request",
      customer_id: p.aliceCustomer,
      resolved_at: null,
    });
    expect(tasks[0]?.body).toContain(o.reference);
    expect(tasks[0]?.body).toContain("Alice Jansen");

    await moveAs(p.staff.id, [o.id], "cancelled", "Op uw verzoek geannuleerd");
    expect(
      await rows(db, "select resolved_by from public.staff_tasks where order_id = $1", [o.id]),
    ).toEqual([{ resolved_by: p.staff.id }]);
  });

  it("only the owning active customer may ask", async () => {
    const o = await aliceOrder();
    for (const user of [p.bob.id, p.carol.id, p.nobody.id, p.staff.id, p.admin.id]) {
      await expectSqlError(request(user, o.id), "42501");
    }
    await expectSqlError(request(p.alice.id, randomUUID()), "42501");
    await expectSqlError(
      asAnon(db, (tx) => tx.query("select public.request_order_cancellation($1)", [o.id])),
      "42501",
    );
    expect((await orderRow(db, o.id)).cancellation_requested_at).toBeNull();
  });

  it("refuses orders that are already completed or cancelled", async () => {
    const done = await aliceOrder();
    await moveAs(p.staff.id, [done.id], "picked_up", null, "Alice");
    await expectSqlError(request(p.alice.id, done.id), "55000");
    const cancelled = await aliceOrder();
    await moveAs(p.staff.id, [cancelled.id], "cancelled");
    await expectSqlError(request(p.alice.id, cancelled.id), "55000");
  });
});

// ---------------------------------------------------------------------------

describe("shipments", () => {
  it("staff manage shipments; customers see only shipments that hold one of their orders", async () => {
    const o = await aliceOrder();
    const s = await asUser(
      db,
      p.staff.id,
      async (tx) => {
        const created = await one<{ id: string; created_by: string }>(
          tx,
          `insert into public.shipments (shipment_number, carrier, awb_or_container_number, customer_note)
           values ('AIR-2026-001', 'Surinam Airways', '123-45678901', 'Vertrek vrijdag') returning id, created_by`,
        );
        await tx.query("update public.orders set shipment_id = $2 where id = $1", [
          o.id,
          created.id,
        ]);
        await tx.query("update public.shipments set departed_at = now() where id = $1", [
          created.id,
        ]);
        return created;
      },
      { commit: true },
    );
    expect(s.created_by).toBe(p.staff.id);

    const visible = (userId: string) =>
      asUser(db, userId, (tx) =>
        rows(tx, "select shipment_number, customer_note from public.shipments where id = $1", [
          s.id,
        ]),
      );
    expect(await visible(p.alice.id)).toEqual([
      { shipment_number: "AIR-2026-001", customer_note: "Vertrek vrijdag" },
    ]);
    expect(await visible(p.bob.id)).toEqual([]);
    expect(await visible(p.carol.id)).toEqual([]);
    expect(await visible(p.admin.id)).toHaveLength(1);
    await expectSqlError(
      asAnon(db, (tx) => tx.query("select * from public.shipments")),
      "42501",
    );

    await expectSqlError(
      asUser(db, p.alice.id, (tx) =>
        tx.query("insert into public.shipments (shipment_number) values ('AIR-KLANT')"),
      ),
      "42501",
    );
    const upd = await asUser(db, p.alice.id, (tx) =>
      tx.query("update public.shipments set customer_note = 'x' where id = $1", [s.id]),
    );
    expect(upd.affectedRows).toBe(0);
    await expectSqlError(
      asUser(db, p.staff.id, (tx) =>
        tx.query("delete from public.shipments where id = $1", [s.id]),
      ),
      "42501",
    );

    const audit = await rows(
      db,
      "select action from public.audit_log where table_name = 'shipments' and record_id = $1 order by id",
      [s.id],
    );
    expect(audit).toEqual([{ action: "INSERT" }, { action: "UPDATE" }]);
  });

  it("shipment numbers are unique regardless of case", async () => {
    await asUser(db, p.staff.id, async (tx) => {
      await tx.query("insert into public.shipments (shipment_number) values ('SEA-7')");
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("insert into public.shipments (shipment_number) values ('sea-7')"),
        ),
        "23505",
      );
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("insert into public.shipments (shipment_number) values (' SEA-8')"),
        ),
        "23514",
      );
    });
  });
});

// ---------------------------------------------------------------------------

describe("shipment statuses", () => {
  it("active customers read customer-visible statuses, inactive ones included; staff read all", async () => {
    await db.query(
      `insert into public.shipment_statuses (code, label_nl, stage, sort_order, customer_visible, active)
       values ('internal_check', 'Interne controle', 'us_warehouse', 41, false, true),
              ('old_status', 'Oude status', 'in_transit', 51, true, false)`,
    );
    try {
      const codes = (userId: string) =>
        asUser(db, userId, async (tx) =>
          (await rows<{ code: string }>(tx, "select code from public.shipment_statuses")).map(
            (r) => r.code,
          ),
        );
      const alice = await codes(p.alice.id);
      expect(alice).toContain("old_status");
      expect(alice).not.toContain("internal_check");
      expect(alice).toHaveLength(14);
      expect(await codes(p.staff.id)).toHaveLength(15);
      expect(await codes(p.carol.id)).toEqual([]);
      expect(await codes(p.nobody.id)).toEqual([]);
    } finally {
      await db.query(
        "delete from public.shipment_statuses where code in ('internal_check', 'old_status')",
      );
    }
  });

  it("only admins add or edit statuses; codes are permanent and nothing is deleted", async () => {
    const insert =
      "insert into public.shipment_statuses (code, label_nl, stage, sort_order) values ('extra_check', 'Extra controle', 'at_customs', 75)";
    await expectSqlError(
      asUser(db, p.staff.id, (tx) => tx.query(insert)),
      "42501",
    );
    await expectSqlError(
      asUser(db, p.alice.id, (tx) => tx.query(insert)),
      "42501",
    );
    const staffUpdate = await asUser(db, p.staff.id, (tx) =>
      tx.query("update public.shipment_statuses set label_nl = 'x' where code = 'pending'"),
    );
    expect(staffUpdate.affectedRows).toBe(0);

    await asUser(db, p.admin.id, async (tx) => {
      await tx.query(insert);
      const r = await tx.query(
        "update public.shipment_statuses set label_nl = 'Extra douanecontrole', notify_customer = true where code = 'extra_check'",
      );
      expect(r.affectedRows).toBe(1);
      for (const sql of [
        "update public.shipment_statuses set code = 'other' where code = 'extra_check'",
        "delete from public.shipment_statuses where code = 'extra_check'",
        "update public.shipment_statuses set created_by = null where code = 'extra_check'",
      ]) {
        await expectSqlError(
          withSavepoint(tx, () => tx.query(sql)),
          "42501",
        );
      }
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query(
            "insert into public.shipment_statuses (code, label_nl, stage) values ('Bad Code', 'x', 'in_transit')",
          ),
        ),
        "23514",
      );
      const audit = await rows(
        tx,
        "select action, changed_columns from public.audit_log where table_name = 'shipment_statuses' and record_id = 'extra_check' order by id",
      );
      expect(audit).toEqual([
        { action: "INSERT", changed_columns: null },
        { action: "UPDATE", changed_columns: ["label_nl", "notify_customer"] },
      ]);
    });
  });

  it("keeps at least one active 'registered' status so new orders can start", async () => {
    await asUser(db, p.admin.id, async (tx) => {
      await tx.query(
        "update public.shipment_statuses set active = false where code in ('pending', 'awaiting_shipment')",
      );
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query(
            "update public.shipment_statuses set active = false where code = 'order_registered'",
          ),
        ),
        "55000",
      );
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query(
            "update public.shipment_statuses set stage = 'in_transit' where code = 'order_registered'",
          ),
        ),
        "55000",
      );
      // The initial status follows sort_order among the active ones.
      await tx.query("update public.shipment_statuses set active = true where code = 'pending'");
      await tx.query("update public.shipment_statuses set sort_order = 5 where code = 'pending'");
      const o = await one<Order>(
        tx,
        "insert into public.orders (customer_id) values ($1) returning *",
        [p.daveCustomer],
      );
      expect(o.status).toBe("pending");
    });
  });
});

// ---------------------------------------------------------------------------

describe("order documents and storage", () => {
  async function addDocument(
    tx: Q,
    order: { id: string; customer_id: string },
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string; customer_id: string; uploaded_by: string; storage_path: string }> {
    const path = objectPath(order.customer_id, order.id);
    await uploadObject(tx, path);
    const values = {
      order_id: order.id,
      customer_id: order.customer_id,
      kind: "purchase_invoice",
      storage_path: path,
      original_filename: "factuur.pdf",
      mime_type: "application/pdf",
      size_bytes: 1000,
      ...extra,
    };
    return one(tx, insertSql("public.order_documents", values), Object.values(values));
  }

  it("customers upload into their own order's folder, record the file and read it back", async () => {
    const o = await aliceOrder();
    const doc = await asUser(db, p.alice.id, (tx) => addDocument(tx, o), { commit: true });
    expect(doc).toMatchObject({ customer_id: p.aliceCustomer, uploaded_by: p.alice.id });

    const seen = (userId: string) =>
      asUser(db, userId, async (tx) => ({
        objects: (
          await rows(tx, "select name from storage.objects where name = $1", [doc.storage_path])
        ).length,
        documents: (await rows(tx, "select id from public.order_documents where id = $1", [doc.id]))
          .length,
      }));
    expect(await seen(p.alice.id)).toEqual({ objects: 1, documents: 1 });
    expect(await seen(p.staff.id)).toEqual({ objects: 1, documents: 1 });
    expect(await seen(p.bob.id)).toEqual({ objects: 0, documents: 0 });
    expect(await seen(p.carol.id)).toEqual({ objects: 0, documents: 0 });
    expect(
      await asAnon(db, (tx) =>
        rows(tx, "select name from storage.objects where name = $1", [doc.storage_path]),
      ),
    ).toEqual([]);
    await expectSqlError(
      asAnon(db, (tx) => tx.query("select * from public.order_documents")),
      "42501",
    );
  });

  it("storage keeps customers to the folders of their own orders, without overwrite or delete", async () => {
    const mine = await aliceOrder();
    const bobs = await insertOrder(db, p.bob.id, { customer_id: p.bobCustomer });
    const existing = objectPath(p.aliceCustomer, mine.id);
    await asUser(db, p.alice.id, (tx) => uploadObject(tx, existing), { commit: true });

    await asUser(db, p.alice.id, async (tx) => {
      for (const path of [
        objectPath(p.bobCustomer, bobs.id),
        objectPath(p.aliceCustomer, bobs.id),
        objectPath(p.aliceCustomer, randomUUID()),
        `${p.aliceCustomer}/${mine.id}/extra/${randomUUID()}.pdf`,
        `${p.aliceCustomer}/${randomUUID()}.pdf`,
      ]) {
        await expectSqlError(
          withSavepoint(tx, () => uploadObject(tx, path)),
          "42501",
        );
      }
      const upd = await tx.query("update storage.objects set name = name || '.x' where name = $1", [
        existing,
      ]);
      expect(upd.affectedRows).toBe(0);
      expect(await deleteObject(tx, existing)).toBe(0);
    });
    await expectSqlError(
      asUser(db, p.carol.id, (tx) => uploadObject(tx, objectPath(p.carolCustomer, mine.id))),
      "42501",
    );
    await expectSqlError(
      asAnon(db, (tx) => uploadObject(tx, objectPath(p.aliceCustomer, mine.id))),
      "42501",
    );

    // Staff upload into any order's folder (still shaped customer/order) and delete.
    await asUser(db, p.staff.id, async (tx) => {
      await uploadObject(tx, objectPath(p.bobCustomer, bobs.id));
      await expectSqlError(
        withSavepoint(tx, () => uploadObject(tx, objectPath(p.aliceCustomer, bobs.id))),
        "42501",
      );
      const upd = await tx.query("update storage.objects set name = name where name = $1", [
        existing,
      ]);
      expect(upd.affectedRows).toBe(0);
      expect(await deleteObject(tx, existing)).toBe(1);
    });
  });

  it("validates the recorded file against the order, the bucket rules and the upload", async () => {
    const o = await aliceOrder();
    const bobs = await insertOrder(db, p.bob.id, { customer_id: p.bobCustomer });
    await asUser(db, p.alice.id, async (tx) => {
      const tryAdd = (code: string | RegExp, extra: Record<string, unknown>, order = o) =>
        expectSqlError(
          withSavepoint(tx, () => addDocument(tx, order, extra)),
          code,
        );
      await tryAdd("23514", { mime_type: "image/svg+xml" });
      await tryAdd("23514", { mime_type: "image/png" });
      await tryAdd("23514", { size_bytes: 10485761 });
      await tryAdd("23514", { original_filename: " " });

      // The row must point at an uploaded object in this order's folder.
      const missing = {
        order_id: o.id,
        customer_id: o.customer_id,
        storage_path: objectPath(o.customer_id, o.id),
        original_filename: "a.pdf",
        mime_type: "application/pdf",
        size_bytes: 10,
      };
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query(insertSql("public.order_documents", missing), Object.values(missing)),
        ),
        "22023",
      );
      const elsewhere = { ...missing, storage_path: objectPath(p.bobCustomer, o.id) };
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query(insertSql("public.order_documents", elsewhere), Object.values(elsewhere)),
        ),
        "22023",
      );
      const other = { ...missing, order_id: bobs.id, customer_id: p.aliceCustomer };
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query(insertSql("public.order_documents", other), Object.values(other)),
        ),
        "42501",
      );
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query(
            "insert into public.order_documents (id, order_id, customer_id, storage_path, original_filename, mime_type, size_bytes, uploaded_by) values (gen_random_uuid(), $1, $2, 'x', 'x', 'application/pdf', 1, $3)",
            [o.id, o.customer_id, p.bob.id],
          ),
        ),
        "42501",
      );
    });

    await moveAs(p.staff.id, [o.id], "cancelled");
    // Storage itself refuses the upload into a closed order (order_hardening
    // migration), before the order_documents check is reached.
    await expectSqlError(
      asUser(db, p.alice.id, (tx) => addDocument(tx, o)),
      "42501",
    );
    // Staff can still file paperwork on a closed order; the customer always
    // comes from the order, whatever the client sends.
    const staffDoc = await asUser(db, p.staff.id, (tx) =>
      addDocument(tx, o, { kind: "other", customer_id: p.bobCustomer }),
    );
    expect(staffDoc).toMatchObject({ customer_id: p.aliceCustomer, uploaded_by: p.staff.id });
  });

  it("only staff delete document records", async () => {
    const o = await aliceOrder();
    const doc = await asUser(db, p.alice.id, (tx) => addDocument(tx, o), { commit: true });
    const del = (userId: string) =>
      asUser(db, userId, (tx) =>
        tx.query("delete from public.order_documents where id = $1", [doc.id]),
      );
    expect((await del(p.alice.id)).affectedRows).toBe(0);
    expect((await del(p.staff.id)).affectedRows).toBe(1);
    await expectSqlError(
      asUser(db, p.alice.id, (tx) =>
        tx.query("update public.order_documents set kind = 'other' where id = $1", [doc.id]),
      ),
      "42501",
    );
  });
});

// ---------------------------------------------------------------------------

describe("internal notes", () => {
  it("staff write and edit notes, admins delete them, customers see none", async () => {
    const o = await aliceOrder();
    const note = await asUser(
      db,
      p.staff.id,
      (tx) =>
        one<{ id: string; created_by: string; customer_id: string; order_id: string }>(
          tx,
          "insert into public.internal_notes (customer_id, order_id, body) values ($1, $2, 'Klant belt vaak') returning *",
          [p.aliceCustomer, o.id],
        ),
      { commit: true },
    );
    expect(note).toMatchObject({ created_by: p.staff.id, order_id: o.id });

    await asUser(db, p.staff.id, async (tx) => {
      const r = await tx.query(
        "update public.internal_notes set body = 'Bijgewerkt' where id = $1",
        [note.id],
      );
      expect(r.affectedRows).toBe(1);
      for (const [sql, params] of [
        [
          "update public.internal_notes set customer_id = $2 where id = $1",
          [note.id, p.bobCustomer],
        ],
        ["update public.internal_notes set created_by = $2 where id = $1", [note.id, p.bob.id]],
      ] as const) {
        await expectSqlError(
          withSavepoint(tx, () => tx.query(sql, [...params])),
          "42501",
        );
      }
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query(
            "insert into public.internal_notes (customer_id, order_id, body) values ($1, $2, 'x')",
            [p.bobCustomer, o.id],
          ),
        ),
        "22023",
      );
      const staffDelete = await tx.query("delete from public.internal_notes where id = $1", [
        note.id,
      ]);
      expect(staffDelete.affectedRows).toBe(0);
    });

    for (const user of [p.alice.id, p.carol.id]) {
      expect(
        await asUser(db, user, (tx) => rows(tx, "select * from public.internal_notes")),
      ).toEqual([]);
    }
    await expectSqlError(
      asUser(db, p.alice.id, (tx) =>
        tx.query("insert into public.internal_notes (customer_id, body) values ($1, 'x')", [
          p.aliceCustomer,
        ]),
      ),
      "42501",
    );
    const adminDelete = await asUser(db, p.admin.id, (tx) =>
      tx.query("delete from public.internal_notes where id = $1", [note.id]),
    );
    expect(adminDelete.affectedRows).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("access summary", () => {
  it("a disabled customer or a login without a customer sees nothing; anon is denied every table", async () => {
    await aliceOrder();
    for (const user of [p.carol.id, p.nobody.id]) {
      await asUser(db, user, async (tx) => {
        for (const t of M2_TABLES) {
          expect(await rows(tx, `select * from public.${t}`), t).toEqual([]);
        }
        expect(
          await rows(tx, "select * from storage.objects where bucket_id = 'order-documents'"),
        ).toEqual([]);
      });
    }
    for (const t of M2_TABLES) {
      await expectSqlError(
        asAnon(db, (tx) => tx.query(`select * from public.${t}`)),
        "42501",
      );
    }
  });

  it("customers cannot call any staff RPC of this migration", async () => {
    const o = await aliceOrder();
    await asUser(db, p.alice.id, async (tx) => {
      for (const sql of [
        "select * from public.change_order_status(array[$1]::uuid[], 'in_transit')",
        "select * from public.receive_order($1, 1)",
      ]) {
        await expectSqlError(
          withSavepoint(tx, () => tx.query(sql, [o.id])),
          "42501",
        );
      }
    });
  });

  it("a GR code is frozen once the customer has an order (SPEC §35.5)", async () => {
    const change = (customerId: string, code: string) =>
      asUser(db, p.admin.id, (tx) =>
        tx.query("select public.change_customer_code($1, $2, 'correctie')", [customerId, code]),
      );
    await aliceOrder();
    const err = await expectSqlError(change(p.aliceCustomer, "GR00041"), "55000");
    expect(err.message).toMatch(/kan niet meer worden gewijzigd/);

    const fresh = await asUser(
      db,
      p.staff.id,
      (tx) =>
        one<{ id: string }>(
          tx,
          "select id from public.create_customer(_full_name => 'Eva Eersel', _phone => '+597 8000005')",
        ),
      { commit: true },
    );
    await change(fresh.id, "GR00042");
  });
});
