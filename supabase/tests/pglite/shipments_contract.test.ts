// @vitest-environment node
/**
 * Shipments and status configuration (P4 part B) against the real
 * migrations. The app's own write code (lib/admin/shipments.ts,
 * lib/admin/status-config.ts and the status change of
 * lib/admin/order-actions.ts) runs unchanged against a small stand-in for
 * supabase-js that turns from().insert/update/select chains and rpc() into
 * SQL inside the caller's transaction, so the payloads and filters are
 * exactly what the browser sends. Every write is checked both ways: who may
 * (staff for shipments, admins for statuses) can; the others cannot.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Some app modules create the browser client on import; nothing here calls it.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  changeOrderStatus,
  changeStatusInputSchema,
  createOrderForCustomer,
  createOrderInputSchema,
  receiveOrder,
} from "@/lib/admin/order-actions";
import {
  addOrdersToShipment,
  createShipment,
  emptyShipmentForm,
  openShipmentOrders,
  removeOrdersFromShipment,
  shipmentCandidates,
  summarizeShipment,
  updateShipment,
  validateShipmentForm,
  type Shipment,
  type ShipmentFormValues,
} from "@/lib/admin/shipments";
import {
  createStatus,
  deactivationImpact,
  emptyNewStatusForm,
  groupStatusesByStage,
  setStatusActive,
  statusFormFromRow,
  updateStatus,
  validateNewStatusForm,
  validateStatusForm,
} from "@/lib/admin/status-config";
import { selectableStatuses, type AdminStatusMap, type StatusRow } from "@/lib/admin/statuses";
import { toAppError } from "@/lib/errors";
import type { OrderFieldsInput } from "@/lib/portal/order-fields";
import type { ServiceType } from "@/lib/portal/orders";

import {
  type AuthUser,
  type Db,
  type Transaction,
  asUser,
  createAuthUser,
  createDb,
  expectSqlError,
  withSavepoint,
} from "./harness";

type Row = Record<string, unknown>;
type DbResult = { data: unknown; error: unknown };

// ---------------------------------------------------------------------------
// supabase-js stand-in: the chains the shipment and status code uses
// ---------------------------------------------------------------------------

const IDENT = /^[a-z_][a-z0-9_]*$/;
const COLUMNS = /^[a-z_][a-z0-9_]*(\s*,\s*[a-z_][a-z0-9_]*)*$/;

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`bad identifier ${name}`);
  return name;
}

function columns(list: string): string {
  if (!COLUMNS.test(list)) throw new Error(`bad columns ${list}`);
  return list;
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

async function run(tx: Transaction, sql: string, params: unknown[]): Promise<DbResult> {
  try {
    const r = await withSavepoint(tx, () => tx.query<Row>(sql, params));
    return { data: r.rows, error: null };
  } catch (error) {
    return { data: null, error: pgError(error) };
  }
}

type Mode =
  | { kind: "select"; columns: string }
  | { kind: "insert"; row: Row }
  | { kind: "update"; patch: Row };

function pgClient(tx: Transaction) {
  const client = {
    async rpc(name: string, args: Record<string, unknown> = {}): Promise<DbResult> {
      const keys = Object.keys(args).map(ident);
      const r = await run(
        tx,
        `select * from public.${ident(name)}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`,
        keys.map((k) => args[k]),
      );
      if (r.error) return r;
      const rows = r.data as Row[];
      const first = rows[0];
      if (rows.length === 1 && first && Object.keys(first).length === 1 && name in first) {
        return { data: first[name], error: null };
      }
      return r;
    },
    from(table: string) {
      ident(table);
      let mode: Mode | null = null;
      let returning = "*";
      const filters: { column: string; op: "eq" | "in"; value: unknown }[] = [];
      const where = (params: unknown[]) =>
        filters.length === 0
          ? ""
          : ` where ${filters
              .map((f) => {
                params.push(f.value);
                return f.op === "eq"
                  ? `${f.column} = $${params.length}`
                  : `${f.column} = any($${params.length})`;
              })
              .join(" and ")}`;
      const exec = async (): Promise<DbResult> => {
        if (!mode) throw new Error("no statement");
        const params: unknown[] = [];
        let sql: string;
        if (mode.kind === "select") {
          sql = `select ${mode.columns} from public.${table}`;
          sql += where(params);
        } else if (mode.kind === "insert") {
          const row = mode.row;
          const cols = Object.keys(row).map(ident);
          params.push(...cols.map((c) => row[c]));
          sql = `insert into public.${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning ${returning}`;
        } else {
          const patch = mode.patch;
          const sets = Object.keys(patch).map((c) => {
            params.push(patch[c]);
            return `${ident(c)} = $${params.length}`;
          });
          sql = `update public.${table} set ${sets.join(", ")}${where(params)} returning ${returning}`;
        }
        return run(tx, sql, params);
      };
      const builder = {
        select(list: string) {
          if (mode === null) mode = { kind: "select", columns: columns(list) };
          else returning = columns(list);
          return builder;
        },
        insert(row: Row) {
          mode = { kind: "insert", row };
          return builder;
        },
        update(patch: Row) {
          mode = { kind: "update", patch };
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push({ column: ident(column), op: "eq", value });
          return builder;
        },
        in(column: string, value: unknown[]) {
          filters.push({ column: ident(column), op: "in", value });
          return builder;
        },
        async single(): Promise<DbResult> {
          const r = await exec();
          if (r.error) return r;
          const rows = r.data as Row[];
          if (rows.length !== 1) {
            return { data: null, error: { code: "PGRST116", message: "JSON object requested" } };
          }
          return { data: rows[0], error: null };
        },
        async maybeSingle(): Promise<DbResult> {
          const r = await exec();
          if (r.error) return r;
          return { data: (r.data as Row[])[0] ?? null, error: null };
        },
        then<T>(resolve: (value: DbResult) => T, reject?: (reason: unknown) => T) {
          return exec().then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return client as unknown as Parameters<typeof createShipment>[0] &
    Parameters<typeof changeOrderStatus>[0];
}

async function expectAppError(action: Promise<unknown>, code: string) {
  const error = await action.then(
    () => {
      throw new Error(`expected ${code}, but it succeeded`);
    },
    (e: unknown) => e,
  );
  const app = toAppError(error);
  expect(app.code, app.message).toBe(code);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let db: Db;
let staff: AuthUser;
let admin: AuthUser;
let alice: AuthUser;
let bob: AuthUser;
let carol: AuthUser;
let aliceCustomer: string;
let bobCustomer: string;

async function customerIdOf(userId: string): Promise<string> {
  const r = await db.query<{ id: string }>("select id from public.customers where user_id = $1", [
    userId,
  ]);
  if (!r.rows[0]) throw new Error("no customer");
  return r.rows[0].id;
}

const form = (serviceType: ServiceType): OrderFieldsInput => ({
  orderType: "personal",
  serviceType,
  storeVendor: "Amazon",
  vendorOrderNumber: "112-1",
  description: "Doos",
  quantity: "1",
  estimatedValue: "",
  estimatedValueCurrency: "USD",
  purchaseDate: "",
  expectedDeliveryDate: "",
  trackingNumber: `1Z ${randomUUID().slice(0, 8)}`,
  carrier: "UPS",
  declaredWeightLbs: "",
  customerNote: "",
  supplierName: "",
  clientPoNumber: "",
  purchaseMode: "",
});

/** "Order aanmaken voor klant", received at once with a weight. */
async function receivedOrder(customerId: string, serviceType: ServiceType = "air", lbs = 2.5) {
  return asUser(
    db,
    staff.id,
    async (tx) => {
      const client = pgClient(tx);
      const order = await createOrderForCustomer(
        client,
        createOrderInputSchema.parse({
          customerId,
          fields: form(serviceType),
          parentOrderId: null,
          measuredWeightLbs: "",
        }),
      );
      await receiveOrder(client, { orderId: order.id, measuredWeightLbs: lbs });
      return order.id;
    },
    { commit: true },
  );
}

const shipmentForm = (extra: Partial<ShipmentFormValues> = {}): ShipmentFormValues => ({
  ...emptyShipmentForm(),
  shipmentNumber: `LUCHT-${randomUUID().slice(0, 6)}`,
  carrier: "Amerijet",
  awbOrContainerNumber: "810-12345675",
  ...extra,
});

async function staffCreatesShipment(extra: Partial<ShipmentFormValues> = {}): Promise<Shipment> {
  const v = validateShipmentForm(shipmentForm(extra));
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  return asUser(db, staff.id, (tx) => createShipment(pgClient(tx), v.columns), { commit: true });
}

async function statusMap(): Promise<AdminStatusMap> {
  const r = await db.query<StatusRow>("select * from public.shipment_statuses");
  return new Map(r.rows.map((s) => [s.code, s]));
}

async function ordersOf(ids: string[]) {
  return (
    await db.query<Row>("select * from public.orders where id = any($1::uuid[]) order by id", [ids])
  ).rows;
}

beforeAll(async () => {
  db = await createDb();
  staff = await createAuthUser(db, { email: "maria.staff@example.com", confirmed: false });
  admin = await createAuthUser(db, { email: "rene.admin@example.com", confirmed: false });
  await db.query("insert into public.user_roles (user_id, role) values ($1, 'staff')", [staff.id]);
  await db.query("insert into public.user_roles (user_id, role) values ($1, 'admin')", [admin.id]);
  alice = await createAuthUser(db, {
    email: "alice@example.com",
    meta: { full_name: "Alice Jansen", phone: "+597 8000001" },
  });
  bob = await createAuthUser(db, {
    email: "bob@example.com",
    meta: { full_name: "Bob Bakker", phone: "+597 8000002" },
  });
  carol = await createAuthUser(db, {
    email: "carol@example.com",
    meta: { full_name: "Carol Kromo", phone: "+597 8000003" },
  });
  aliceCustomer = await customerIdOf(alice.id);
  bobCustomer = await customerIdOf(bob.id);
});

afterAll(async () => {
  await db?.close();
});

// ---------------------------------------------------------------------------
// Shipments
// ---------------------------------------------------------------------------

describe("Zending aanmaken en wijzigen (createShipment / updateShipment)", () => {
  it("staff create a shipment with the form's columns; times are stored as Suriname time", async () => {
    const s = await staffCreatesShipment({
      departedAt: "2026-10-07T21:30",
      customerNote: "Vlucht via Miami",
    });
    const row = (await db.query<Row>("select * from public.shipments where id = $1", [s.id]))
      .rows[0];
    expect(row).toMatchObject({
      service_type: "air",
      carrier: "Amerijet",
      awb_or_container_number: "810-12345675",
      customer_note: "Vlucht via Miami",
      arrived_at: null,
      created_by: staff.id,
    });
    expect(new Date(String(row?.["departed_at"])).toISOString()).toBe("2026-10-08T00:30:00.000Z");
  });

  it("a shipment number is unique whatever its case (23505, own message)", async () => {
    const s = await staffCreatesShipment({ shipmentNumber: "ZEE-2026-01", serviceType: "sea" });
    const v = validateShipmentForm(shipmentForm({ shipmentNumber: "zee-2026-01" }));
    if (!v.ok) throw new Error("form");
    await asUser(db, staff.id, async (tx) => {
      const app = await expectAppError(createShipment(pgClient(tx), v.columns), "23505");
      expect(app.message).toBe("Er bestaat al een zending met nummer zee-2026-01.");
    });
    expect(s.shipment_number).toBe("ZEE-2026-01");
  });

  it("the database refuses an arrival before departure too (the form already does)", async () => {
    await asUser(db, staff.id, async (tx) => {
      await expectAppError(
        createShipment(pgClient(tx), {
          shipment_number: "X-1",
          service_type: "air",
          carrier: null,
          awb_or_container_number: null,
          departed_at: "2026-10-08T00:00:00Z",
          arrived_at: "2026-10-07T00:00:00Z",
          customer_note: null,
        }),
        "23514",
      );
    });
  });

  it("staff edit it; a customer can neither create nor change a shipment, nor delete one", async () => {
    const s = await staffCreatesShipment();
    const edited = validateShipmentForm(
      shipmentForm({ shipmentNumber: s.shipment_number, arrivedAt: "2026-10-09T08:00" }),
    );
    if (!edited.ok) throw new Error("form");
    await asUser(db, staff.id, (tx) => updateShipment(pgClient(tx), s.id, edited.columns), {
      commit: true,
    });
    const row = (
      await db.query<Row>("select arrived_at, updated_by from public.shipments where id = $1", [
        s.id,
      ])
    ).rows[0];
    expect(new Date(String(row?.["arrived_at"])).toISOString()).toBe("2026-10-09T11:00:00.000Z");
    expect(row?.["updated_by"]).toBe(staff.id);

    await asUser(db, alice.id, async (tx) => {
      await expectAppError(createShipment(pgClient(tx), edited.columns), "42501");
      // RLS hides the row from the update: reported, not a silent success.
      await expectAppError(
        updateShipment(pgClient(tx), s.id, { ...edited.columns, carrier: "Iemand anders" }),
        "P0002",
      );
    });
    await asUser(db, staff.id, async (tx) => {
      await expectSqlError(
        withSavepoint(tx, () => tx.query("delete from public.shipments where id = $1", [s.id])),
        "42501",
      );
    });
    expect(
      (await db.query<Row>("select carrier from public.shipments where id = $1", [s.id])).rows[0],
    ).toEqual({ carrier: "Amerijet" });
  });
});

describe("Orders toevoegen / uit zending halen", () => {
  it("adds only orders of the shipment's service type; customers then see the shipment and its note", async () => {
    const s = await staffCreatesShipment({ customerNote: "Verwacht donderdag" });
    const a1 = await receivedOrder(aliceCustomer);
    const aSea = await receivedOrder(aliceCustomer, "sea");
    const b1 = await receivedOrder(bobCustomer);

    const result = await asUser(
      db,
      staff.id,
      (tx) => addOrdersToShipment(pgClient(tx), s, [a1, aSea, b1]),
      { commit: true },
    );
    expect(result.done.sort()).toEqual([a1, b1].sort());
    expect(result.skipped).toEqual([aSea]);
    const rows = await ordersOf([a1, aSea, b1]);
    expect(Object.fromEntries(rows.map((r) => [r["id"], r["shipment_id"]]))).toEqual({
      [a1]: s.id,
      [aSea]: null,
      [b1]: s.id,
    });

    const seen = (userId: string) =>
      asUser(db, userId, (tx) =>
        tx.query<Row>("select shipment_number, customer_note from public.shipments where id = $1", [
          s.id,
        ]),
      );
    expect((await seen(alice.id)).rows).toEqual([
      { shipment_number: s.shipment_number, customer_note: "Verwacht donderdag" },
    ]);
    expect((await seen(bob.id)).rows).toHaveLength(1);
    expect((await seen(carol.id)).rows).toEqual([]);

    // Out again: only what is in this shipment; alice no longer sees it.
    const removed = await asUser(
      db,
      staff.id,
      (tx) => removeOrdersFromShipment(pgClient(tx), s.id, [a1, aSea]),
      { commit: true },
    );
    expect(removed).toEqual({ done: [a1], skipped: [aSea] });
    expect((await seen(alice.id)).rows).toEqual([]);
    expect((await seen(bob.id)).rows).toHaveLength(1);
  });

  it("an order moves from one shipment to another; the audit log records who moved it", async () => {
    const first = await staffCreatesShipment();
    const second = await staffCreatesShipment();
    const o = await receivedOrder(aliceCustomer);
    await asUser(db, staff.id, (tx) => addOrdersToShipment(pgClient(tx), first, [o]), {
      commit: true,
    });
    await asUser(db, staff.id, (tx) => addOrdersToShipment(pgClient(tx), second, [o]), {
      commit: true,
    });
    expect((await ordersOf([o]))[0]?.["shipment_id"]).toBe(second.id);
    const audit = await db.query<Row>(
      `select actor_id, changed_columns from public.audit_log
        where table_name = 'orders' and record_id = $1 and 'shipment_id' = any(changed_columns)`,
      [o],
    );
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows.every((r) => r["actor_id"] === staff.id)).toBe(true);
  });

  it("a customer cannot put an order into a shipment or take it out (42501), nor touch another's order", async () => {
    const s = await staffCreatesShipment();
    const mine = await receivedOrder(aliceCustomer);
    const theirs = await receivedOrder(bobCustomer);
    await asUser(db, staff.id, (tx) => addOrdersToShipment(pgClient(tx), s, [theirs]), {
      commit: true,
    });
    await asUser(db, alice.id, async (tx) => {
      await expectAppError(addOrdersToShipment(pgClient(tx), s, [mine]), "42501");
      // Another customer's order is invisible to her: nothing changes.
      expect(await removeOrdersFromShipment(pgClient(tx), s.id, [theirs])).toEqual({
        done: [],
        skipped: [theirs],
      });
    });
    expect((await ordersOf([theirs]))[0]?.["shipment_id"]).toBe(s.id);
  });

  it("an order stays with a shipment of its own service type (migration p4_order_guards)", async () => {
    await db.query("update public.service_rates set enabled = true where service_type = 'sea'");
    try {
      const s = await staffCreatesShipment();
      // A registered order (the customer may still edit it) that staff already put in.
      const o = await asUser(
        db,
        staff.id,
        async (tx) =>
          (
            await createOrderForCustomer(
              pgClient(tx),
              createOrderInputSchema.parse({
                customerId: aliceCustomer,
                fields: form("air"),
                parentOrderId: null,
                measuredWeightLbs: "",
              }),
            )
          ).id,
        { commit: true },
      );
      await asUser(db, staff.id, (tx) => addOrdersToShipment(pgClient(tx), s, [o]), {
        commit: true,
      });

      // The customer can no longer switch it to sea: it would travel in an air shipment.
      await asUser(db, alice.id, async (tx) => {
        const e = await expectSqlError(
          withSavepoint(tx, () =>
            tx.query("update public.orders set service_type = 'sea' where id = $1", [o]),
          ),
          "55000",
        );
        expect(e.message).toContain("zending");
        // Other fields stay editable while it is registered; the portal's PATCH
        // sends the unchanged service type along, which is fine.
        await tx.query(
          "update public.orders set description = 'Twee dozen', service_type = 'air' where id = $1",
          [o],
        );
      });
      // Staff neither: take it out first.
      await asUser(db, staff.id, async (tx) => {
        await expectSqlError(
          withSavepoint(tx, () =>
            tx.query("update public.orders set service_type = 'sea' where id = $1", [o]),
          ),
          "55000",
        );
        // A direct API call cannot put a sea order into an air shipment.
        const sea = await tx.query<{ id: string }>(
          "insert into public.orders (customer_id, description, service_type) values ($1, 'Zeevracht', 'sea') returning id",
          [bobCustomer],
        );
        await expectSqlError(
          withSavepoint(tx, () =>
            tx.query("update public.orders set shipment_id = $1 where id = $2", [
              s.id,
              sea.rows[0]!.id,
            ]),
          ),
          "22023",
        );
        // The shipment keeps its service type while it holds orders …
        const edited = validateShipmentForm(
          shipmentForm({ shipmentNumber: s.shipment_number, serviceType: "sea" }),
        );
        if (!edited.ok) throw new Error("form");
        await expectAppError(updateShipment(pgClient(tx), s.id, edited.columns), "55000");
      });
      expect((await ordersOf([o]))[0]).toMatchObject({ service_type: "air", shipment_id: s.id });

      // … and once it is empty, it may change.
      await asUser(db, staff.id, (tx) => removeOrdersFromShipment(pgClient(tx), s.id, [o]), {
        commit: true,
      });
      const edited = validateShipmentForm(
        shipmentForm({ shipmentNumber: s.shipment_number, serviceType: "sea" }),
      );
      if (!edited.ok) throw new Error("form");
      await asUser(db, staff.id, (tx) => updateShipment(pgClient(tx), s.id, edited.columns), {
        commit: true,
      });
      await asUser(
        db,
        alice.id,
        (tx) => tx.query("update public.orders set service_type = 'sea' where id = $1", [o]),
        { commit: true },
      );
      expect((await ordersOf([o]))[0]).toMatchObject({ service_type: "sea", shipment_id: null });
    } finally {
      await db.query("update public.service_rates set enabled = false where service_type = 'sea'");
    }
  });

  it("candidates and the summary agree with the database", async () => {
    const s = await staffCreatesShipment();
    const a = await receivedOrder(aliceCustomer, "air", 1.25);
    const b = await receivedOrder(bobCustomer, "air", 3);
    const sea = await receivedOrder(bobCustomer, "sea");
    const statuses = await statusMap();
    const views = (await ordersOf([a, b, sea])).map((r) => ({
      id: String(r["id"]),
      service_type: r["service_type"] as ServiceType,
      shipment_id: (r["shipment_id"] as string | null) ?? null,
      created_at: new Date(String(r["created_at"])).toISOString(),
      stage: statuses.get(String(r["status"]))?.stage ?? null,
    }));
    const candidates = shipmentCandidates(views, s).map((o) => o.id);
    expect(candidates.sort()).toEqual([a, b].sort());
    await asUser(db, staff.id, (tx) => addOrdersToShipment(pgClient(tx), s, candidates), {
      commit: true,
    });
    const members = (
      await db.query<Row>(
        "select id, status, customer_id, measured_weight_lbs, service_type from public.orders where shipment_id = $1",
        [s.id],
      )
    ).rows.map((r) => ({
      id: String(r["id"]),
      status: String(r["status"]),
      customer_id: String(r["customer_id"]),
      measured_weight_lbs: Number(r["measured_weight_lbs"]),
      service_type: r["service_type"] as ServiceType,
    }));
    expect(summarizeShipment(s, members, statuses)).toMatchObject({
      orderCount: 2,
      openCount: 2,
      customerCount: 2,
      measuredLbs: 4.25,
      mismatched: 0,
      stages: [{ stage: "us_warehouse", count: 2 }],
    });
  });
});

describe("Status voor hele zending wijzigen", () => {
  it("one change_order_status call for the open orders; a picked-up order keeps its pickup; one e-mail per customer", async () => {
    const s = await staffCreatesShipment();
    const a1 = await receivedOrder(aliceCustomer);
    const a2 = await receivedOrder(aliceCustomer);
    const b1 = await receivedOrder(bobCustomer);
    const done = await receivedOrder(bobCustomer);
    await asUser(db, staff.id, (tx) => addOrdersToShipment(pgClient(tx), s, [a1, a2, b1, done]), {
      commit: true,
    });
    await asUser(
      db,
      staff.id,
      (tx) =>
        changeOrderStatus(
          pgClient(tx),
          changeStatusInputSchema.parse({
            orderIds: [done],
            toStatus: "picked_up",
            pickedUpByName: "Bob Bakker",
            notifyCustomer: false,
          }),
        ),
      { commit: true },
    );

    const statuses = await statusMap();
    const views = (await ordersOf([a1, a2, b1, done])).map((r) => ({
      id: String(r["id"]),
      stage: statuses.get(String(r["status"]))?.stage ?? null,
    }));
    const open = openShipmentOrders(views).map((o) => o.id);
    expect(open.sort()).toEqual([a1, a2, b1].sort());

    const result = await asUser(
      db,
      staff.id,
      (tx) =>
        changeOrderStatus(
          pgClient(tx),
          changeStatusInputSchema.parse({
            orderIds: open,
            toStatus: "in_transit",
            customerMessage: "Vlucht van dinsdag",
            notifyCustomer: true,
          }),
        ),
      { commit: true },
    );
    expect(result.changed.sort()).toEqual(open.sort());
    // in_transit notifies: alice gets ONE e-mail for both of her orders.
    expect(result.emails).toHaveLength(2);
    expect(result.emails.find((e) => e.customerId === aliceCustomer)?.orderIds.sort()).toEqual(
      [a1, a2].sort(),
    );
    const rows = await ordersOf([a1, a2, b1, done]);
    for (const r of rows) {
      if (r["id"] === done) {
        expect(r).toMatchObject({ status: "picked_up", picked_up_by_name: "Bob Bakker" });
      } else {
        expect(r["status"]).toBe("in_transit");
      }
    }
    const history = await db.query<Row>(
      "select changed_by, customer_message from public.shipment_status_history where to_status = 'in_transit' and order_id = any($1::uuid[])",
      [open],
    );
    expect(history.rows).toHaveLength(3);
    expect(
      history.rows.every(
        (h) => h["changed_by"] === staff.id && h["customer_message"] === "Vlucht van dinsdag",
      ),
    ).toBe(true);

    // A customer cannot do it.
    await asUser(db, alice.id, async (tx) => {
      await expectAppError(
        changeOrderStatus(
          pgClient(tx),
          changeStatusInputSchema.parse({
            orderIds: [a1],
            toStatus: "arrived_suriname",
            notifyCustomer: false,
          }),
        ),
        "42501",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Status configuration
// ---------------------------------------------------------------------------

describe("Statussen: defaults per stage", () => {
  it("the 'Standaard' status of a stage is the one the database uses", async () => {
    const groups = groupStatusesByStage(await statusMap());
    const initial = (
      await db.query<{ code: string }>("select private.initial_order_status() as code")
    ).rows[0]?.code;
    expect(groups.find((g) => g.stage === "registered")?.defaultCode).toBe(initial);
    const o = await receivedOrder(aliceCustomer);
    expect(groups.find((g) => g.stage === "us_warehouse")?.defaultCode).toBe(
      (await ordersOf([o]))[0]?.["status"],
    );
  });

  it("a new 'registered' status sorted first becomes where new orders start", async () => {
    await asUser(db, admin.id, async (tx) => {
      const client = pgClient(tx);
      const statuses = new Map(
        (await tx.query<StatusRow>("select * from public.shipment_statuses")).rows.map((s) => [
          s.code,
          s,
        ]),
      );
      const v = validateNewStatusForm(
        {
          ...emptyNewStatusForm(statuses, "registered"),
          code: "intake",
          labelNl: "Intake",
          sortOrder: "5",
        },
        statuses,
      );
      if (!v.ok) throw new Error(JSON.stringify(v.errors));
      await createStatus(client, v.columns);
      const order = await createOrderForCustomer(
        client,
        createOrderInputSchema.parse({
          customerId: aliceCustomer,
          fields: form("air"),
          parentOrderId: null,
          measuredWeightLbs: "",
        }),
      );
      const row = await tx.query<Row>("select status from public.orders where id = $1", [order.id]);
      expect(row.rows[0]).toEqual({ status: "intake" });
    });
    // Rolled back: the seeded start status is the default again.
    expect((await statusMap()).has("intake")).toBe(false);
  });
});

describe("Status toevoegen / wijzigen / deactiveren (admins only)", () => {
  it("an admin adds a status: active, terminal for completed, audited", async () => {
    const statuses = await statusMap();
    const v = validateNewStatusForm(
      {
        ...emptyNewStatusForm(statuses, "completed"),
        code: "courier_delivered",
        labelNl: "Bezorgd door koerier",
        customerDescriptionNl: "Een koerier heeft uw pakket bezorgd.",
        notifyCustomer: true,
      },
      statuses,
    );
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    await asUser(db, admin.id, (tx) => createStatus(pgClient(tx), v.columns), { commit: true });
    const row = (await statusMap()).get("courier_delivered");
    expect(row).toMatchObject({
      stage: "completed",
      label_nl: "Bezorgd door koerier",
      is_terminal: true,
      active: true,
      customer_visible: true,
      notify_customer: true,
      sort_order: 111,
      created_by: admin.id,
    });
    const audit = await db.query<Row>(
      "select actor_id, action from public.audit_log where table_name = 'shipment_statuses' and record_id = 'courier_delivered'",
    );
    expect(audit.rows).toEqual([{ actor_id: admin.id, action: "INSERT" }]);

    // Taken code: own message.
    await asUser(db, admin.id, async (tx) => {
      const app = await expectAppError(createStatus(pgClient(tx), v.columns), "23505");
      expect(app.message).toBe("De code courier_delivered bestaat al.");
    });
  });

  it("an admin edits labels, description, sort order and flags; code and stage stay", async () => {
    const before = (await statusMap()).get("customs_cleared");
    if (!before) throw new Error("seed");
    const v = validateStatusForm({
      ...statusFormFromRow(before),
      labelNl: "Vrijgegeven door de douane",
      customerDescriptionNl: "",
      sortOrder: "85",
      notifyCustomer: true,
    });
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    await asUser(db, admin.id, (tx) => updateStatus(pgClient(tx), "customs_cleared", v.columns), {
      commit: true,
    });
    expect((await statusMap()).get("customs_cleared")).toMatchObject({
      code: "customs_cleared",
      stage: "cleared",
      label_nl: "Vrijgegeven door de douane",
      customer_description_nl: null,
      sort_order: 85,
      notify_customer: true,
      updated_by: admin.id,
    });
  });

  it("staff and customers cannot add, change or deactivate statuses; nobody deletes one", async () => {
    const statuses = await statusMap();
    const v = validateNewStatusForm(
      { ...emptyNewStatusForm(statuses, "in_transit"), code: "on_board", labelNl: "Aan boord" },
      statuses,
    );
    if (!v.ok) throw new Error("form");
    const edit = validateStatusForm({
      ...statusFormFromRow(statuses.get("in_transit") as StatusRow),
      labelNl: "Gekaapt",
    });
    if (!edit.ok) throw new Error("form");
    for (const user of [staff, alice]) {
      await asUser(db, user.id, async (tx) => {
        const client = pgClient(tx);
        await expectAppError(createStatus(client, v.columns), "42501");
        const app = await expectAppError(updateStatus(client, "in_transit", edit.columns), "42501");
        expect(app.message).toBe("Alleen een beheerder kan statussen wijzigen.");
        await expectAppError(setStatusActive(client, "in_transit", false), "42501");
      });
    }
    await asUser(db, admin.id, async (tx) => {
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("delete from public.shipment_statuses where code = 'pending'"),
        ),
        "42501",
      );
    });
    expect((await statusMap()).get("in_transit")).toMatchObject({
      label_nl: "Onderweg naar Suriname",
      active: true,
    });
  });

  it("deactivating: orders keep the status, it is no longer offered, and moving to it is refused", async () => {
    const o = await receivedOrder(aliceCustomer);
    await asUser(
      db,
      staff.id,
      (tx) =>
        changeOrderStatus(
          pgClient(tx),
          changeStatusInputSchema.parse({
            orderIds: [o],
            toStatus: "at_customs",
            notifyCustomer: false,
          }),
        ),
      { commit: true },
    );
    const usage = new Map([["at_customs", 1]]);
    expect(deactivationImpact(await statusMap(), "at_customs", usage)).toEqual({
      inUse: 1,
      lastActiveInStage: true,
      blocked: false,
    });
    await asUser(db, admin.id, (tx) => setStatusActive(pgClient(tx), "at_customs", false), {
      commit: true,
    });
    const statuses = await statusMap();
    expect((await ordersOf([o]))[0]?.["status"]).toBe("at_customs");
    expect(
      selectableStatuses(statuses, { deliveryAvailable: true }).map((s) => s.code),
    ).not.toContain("at_customs");
    const other = await receivedOrder(bobCustomer);
    await asUser(db, staff.id, async (tx) => {
      await expectAppError(
        changeOrderStatus(
          pgClient(tx),
          changeStatusInputSchema.parse({
            orderIds: [other],
            toStatus: "at_customs",
            notifyCustomer: false,
          }),
        ),
        "22023",
      );
    });
    // Back on: usable again.
    await asUser(db, admin.id, (tx) => setStatusActive(pgClient(tx), "at_customs", true), {
      commit: true,
    });
    expect((await statusMap()).get("at_customs")?.active).toBe(true);
  });

  it("the last active 'registered' status cannot go (55000), as deactivationImpact says", async () => {
    await asUser(db, admin.id, async (tx) => {
      const client = pgClient(tx);
      for (const code of ["pending", "awaiting_shipment"]) {
        await setStatusActive(client, code, false);
      }
      const statuses = new Map(
        (await tx.query<StatusRow>("select * from public.shipment_statuses")).rows.map((s) => [
          s.code,
          s,
        ]),
      );
      expect(deactivationImpact(statuses, "order_registered", undefined)).toMatchObject({
        lastActiveInStage: true,
        blocked: true,
      });
      const app = await expectAppError(setStatusActive(client, "order_registered", false), "55000");
      expect(app.message).toContain("registered");
    });
  });

  it("without an active US-warehouse status, receiving stops (the warning on the page)", async () => {
    const o = await asUser(
      db,
      staff.id,
      async (tx) =>
        (
          await createOrderForCustomer(
            pgClient(tx),
            createOrderInputSchema.parse({
              customerId: bobCustomer,
              fields: form("air"),
              parentOrderId: null,
              measuredWeightLbs: "",
            }),
          )
        ).id,
      { commit: true },
    );
    await asUser(db, admin.id, async (tx) => {
      const client = pgClient(tx);
      await setStatusActive(client, "arrived_us_warehouse", false);
      // Admins are staff too: receive in the same transaction.
      await expectAppError(receiveOrder(client, { orderId: o, measuredWeightLbs: 1 }), "55000");
    });
  });

  it("a hidden status: the customer reads neither the status nor its history rows", async () => {
    const o = await receivedOrder(aliceCustomer);
    const statuses = await statusMap();
    const v = validateNewStatusForm(
      {
        ...emptyNewStatusForm(statuses, "us_warehouse"),
        code: "repacking",
        labelNl: "Ompakken",
        customerVisible: false,
        notifyCustomer: true,
      },
      statuses,
    );
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    // A hidden status never e-mails, whatever was ticked.
    expect(v.columns.notify_customer).toBe(false);
    await asUser(db, admin.id, (tx) => createStatus(pgClient(tx), v.columns), { commit: true });
    const result = await asUser(
      db,
      staff.id,
      (tx) =>
        changeOrderStatus(
          pgClient(tx),
          changeStatusInputSchema.parse({
            orderIds: [o],
            toStatus: "repacking",
            notifyCustomer: true,
          }),
        ),
      { commit: true },
    );
    expect(result.emails).toEqual([]);
    const seen = await asUser(db, alice.id, async (tx) => ({
      status: (await tx.query("select code from public.shipment_statuses where code = 'repacking'"))
        .rows,
      history: (
        await tx.query("select to_status from public.shipment_status_history where order_id = $1", [
          o,
        ])
      ).rows,
    }));
    expect(seen.status).toEqual([]);
    expect(seen.history).toEqual([{ to_status: "arrived_us_warehouse" }]);
  });
});
