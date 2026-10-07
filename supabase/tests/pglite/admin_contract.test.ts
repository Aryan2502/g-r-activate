// @vitest-environment node
/**
 * The staff side of orders (src/lib/admin, P4) against the real migrations.
 * The app's own action code (lib/admin/order-actions.ts, used by the server
 * functions) runs here unchanged against a tiny stand-in for supabase-js that
 * turns client.rpc() / from().select|insert into SQL inside the caller's
 * transaction, so the RPC names, argument names and payloads are exactly what
 * production sends. Every write is checked both ways: staff can, a customer
 * cannot.
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
  pickUpOrders,
  pickupInputSchema,
  receiveOrder,
  updateMeasuredWeight,
  type ChangeStatusInput,
} from "@/lib/admin/order-actions";
import { indexBilling, orderBilling, type BillingInvoice } from "@/lib/admin/orders";
import {
  B2B_CUSTOMS_DOCUMENT_KINDS,
  canReceive,
  canSetWeightDirectly,
  mustReceiveFirst,
} from "@/lib/admin/statuses";
import { toAppError } from "@/lib/errors";
import { DOCUMENT_MIME_TYPES, documentStoragePath } from "@/lib/portal/documents";
import type { OrderFieldsInput } from "@/lib/portal/order-fields";
import { currentStatusMessage, type StatusStage } from "@/lib/portal/orders";
import { checkRole } from "@/lib/server-fns/middleware";

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

type Q = Pick<Transaction, "query">;
type Row = Record<string, unknown>;
type DbResult = { data: unknown; error: unknown };

const TODAY = "(now() at time zone 'America/Paramaribo')::date";

// ---------------------------------------------------------------------------
// supabase-js stand-in: only the calls lib/admin/order-actions.ts makes
// ---------------------------------------------------------------------------

const IDENT = /^[a-z_][a-z0-9_]*$/;
const COLUMNS = /^[a-z_][a-z0-9_]*(\s*,\s*[a-z_][a-z0-9_]*)*$/;

function pgError(error: unknown) {
  const e = error as { code?: string; message?: string; hint?: string; detail?: string };
  return {
    code: e.code ?? null,
    message: e.message ?? String(error),
    hint: e.hint ?? null,
    details: e.detail ?? null,
  };
}

/** Runs one statement in a savepoint and answers like PostgREST: { data, error }. */
async function run(
  tx: Transaction,
  sql: string,
  params: unknown[],
): Promise<{ rows: Row[] } | { error: unknown }> {
  try {
    return { rows: (await withSavepoint(tx, () => tx.query<Row>(sql, params))).rows };
  } catch (error) {
    return { error: pgError(error) };
  }
}

function pgClient(tx: Transaction) {
  const client = {
    async rpc(name: string, args: Record<string, unknown> = {}): Promise<DbResult> {
      if (!IDENT.test(name)) throw new Error(`bad rpc ${name}`);
      const keys = Object.keys(args);
      for (const k of keys) if (!IDENT.test(k)) throw new Error(`bad arg ${k}`);
      const r = await run(
        tx,
        `select * from public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`,
        keys.map((k) => args[k]),
      );
      if ("error" in r) return { data: null, error: r.error };
      // A scalar function comes back as one column named after it.
      const first = r.rows[0];
      if (r.rows.length === 1 && first && Object.keys(first).length === 1 && name in first) {
        return { data: first[name], error: null };
      }
      return { data: r.rows, error: null };
    },
    from(table: string) {
      if (!IDENT.test(table)) throw new Error(`bad table ${table}`);
      return {
        select: (columns: string) => {
          if (!COLUMNS.test(columns)) throw new Error(`bad columns ${columns}`);
          return {
            eq: (column: string, value: unknown) => ({
              maybeSingle: async (): Promise<DbResult> => {
                if (!IDENT.test(column)) throw new Error(`bad column ${column}`);
                const r = await run(
                  tx,
                  `select ${columns} from public.${table} where ${column} = $1 limit 1`,
                  [value],
                );
                if ("error" in r) return { data: null, error: r.error };
                return { data: r.rows[0] ?? null, error: null };
              },
            }),
          };
        },
        update: (row: Row) => ({
          eq: (column: string, value: unknown) => ({
            select: (columns: string) => ({
              single: async (): Promise<DbResult> => {
                if (!IDENT.test(column)) throw new Error(`bad column ${column}`);
                if (!COLUMNS.test(columns)) throw new Error(`bad columns ${columns}`);
                const cols = Object.keys(row);
                for (const c of cols) if (!IDENT.test(c)) throw new Error(`bad column ${c}`);
                const r = await run(
                  tx,
                  `update public.${table} set ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")} where ${column} = $${cols.length + 1} returning ${columns}`,
                  [...cols.map((c) => row[c]), value],
                );
                if ("error" in r) return { data: null, error: r.error };
                // PostgREST's .single() on zero rows (RLS hid it): PGRST116.
                if (r.rows.length !== 1) {
                  return { data: null, error: { code: "PGRST116", message: "0 rows" } };
                }
                return { data: r.rows[0], error: null };
              },
            }),
          }),
        }),
        insert: (row: Row) => ({
          select: (columns: string) => ({
            single: async (): Promise<DbResult> => {
              if (!COLUMNS.test(columns)) throw new Error(`bad columns ${columns}`);
              const cols = Object.keys(row);
              for (const c of cols) if (!IDENT.test(c)) throw new Error(`bad column ${c}`);
              const r = await run(
                tx,
                `insert into public.${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning ${columns}`,
                cols.map((c) => row[c]),
              );
              if ("error" in r) return { data: null, error: r.error };
              return { data: r.rows[0] ?? null, error: null };
            },
          }),
        }),
      };
    },
  };
  return client as unknown as Parameters<typeof changeOrderStatus>[0];
}

/** Throws the PostgREST-style error the way supabase-js callers see it. */
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
let colleague: AuthUser;
let alice: AuthUser;
let bob: AuthUser;
let aliceCustomer: string;
let bobCustomer: string;
let daveCustomer: string; // no login
let carolCustomer: string; // disabled

async function customerIdOf(userId: string): Promise<string> {
  const r = await db.query<{ id: string }>("select id from public.customers where user_id = $1", [
    userId,
  ]);
  if (!r.rows[0]) throw new Error("no customer");
  return r.rows[0].id;
}

const form = (extra: Partial<OrderFieldsInput> = {}): OrderFieldsInput => ({
  orderType: "personal",
  serviceType: "air",
  storeVendor: "Amazon",
  vendorOrderNumber: "112-1",
  description: "Doos zonder aanmelding",
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
  ...extra,
});

/** "Order aanmaken voor klant", as createOrderForCustomerFn does it. */
async function staffCreates(
  customerId: string,
  extra: Partial<OrderFieldsInput> = {},
  parentOrderId: string | null = null,
) {
  return asUser(
    db,
    staff.id,
    (tx) =>
      createOrderForCustomer(
        pgClient(tx),
        createOrderInputSchema.parse({
          customerId,
          fields: form(extra),
          parentOrderId,
          measuredWeightLbs: "",
        }),
      ),
    { commit: true },
  );
}

const statusInput = (
  orderIds: string[],
  toStatus: string,
  extra: Partial<ChangeStatusInput> = {},
) => changeStatusInputSchema.parse({ orderIds, toStatus, notifyCustomer: true, ...extra });

async function staffMoves(
  orderIds: string[],
  toStatus: string,
  extra: Partial<ChangeStatusInput> = {},
) {
  return asUser(
    db,
    staff.id,
    (tx) => changeOrderStatus(pgClient(tx), statusInput(orderIds, toStatus, extra)),
    {
      commit: true,
    },
  );
}

async function orderRow(id: string): Promise<Row> {
  const r = await db.query<Row>("select * from public.orders where id = $1", [id]);
  if (!r.rows[0]) throw new Error("no order");
  return r.rows[0];
}

async function uploadObject(tx: Q, path: string, mime = "application/pdf"): Promise<void> {
  await tx.query(
    `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
     values ('order-documents', $1, auth.uid(), auth.uid()::text, jsonb_build_object('mimetype', $2::text, 'size', 1000))`,
    [path, mime],
  );
}

beforeAll(async () => {
  db = await createDb();
  staff = await createAuthUser(db, { email: "maria.staff@example.com", confirmed: false });
  colleague = await createAuthUser(db, { email: "kenneth.staff@example.com", confirmed: false });
  for (const u of [staff, colleague]) {
    await db.query("insert into public.user_roles (user_id, role) values ($1, 'staff')", [u.id]);
  }
  await db.query("update public.profiles set display_name = 'Maria' where id = $1", [staff.id]);
  await db.query("update public.profiles set display_name = 'Kenneth' where id = $1", [
    colleague.id,
  ]);
  alice = await createAuthUser(db, {
    email: "alice@example.com",
    meta: { full_name: "Alice Jansen", phone: "+597 8000001" },
  });
  bob = await createAuthUser(db, {
    email: "bob@example.com",
    meta: { full_name: "Bob Bakker", phone: "+597 8000002" },
  });
  const carol = await createAuthUser(db, {
    email: "carol@example.com",
    meta: { full_name: "Carol Kromo", phone: "+597 8000003" },
  });
  aliceCustomer = await customerIdOf(alice.id);
  bobCustomer = await customerIdOf(bob.id);
  carolCustomer = await customerIdOf(carol.id);
  await db.query("update public.customers set status = 'disabled' where id = $1", [carolCustomer]);
  daveCustomer = await asUser(
    db,
    staff.id,
    async (tx) =>
      (
        await tx.query<{ id: string }>(
          "select id from public.create_customer(_full_name => 'Dave Doorn', _phone => '+597 8000004')",
        )
      ).rows[0]!.id,
    { commit: true },
  );
  await db.query("update public.service_rates set rate_per_lb = 4.5 where service_type = 'air'");
  await db.query(
    `update public.company_bank_accounts
        set bank_name = 'Testbank', account_holder = 'G&R SOLUTIONS N.V.', account_number = '1234567'
      where currency = 'USD'`,
  );
});

afterAll(async () => {
  await db?.close();
});

// ---------------------------------------------------------------------------

describe("role check (requireStaff / requireAdmin, returned as data)", () => {
  it("is_staff() through the caller's own client: staff pass, a customer gets 42501", async () => {
    expect(await asUser(db, staff.id, (tx) => checkRole(pgClient(tx), "staff"))).toBeNull();
    expect(await asUser(db, staff.id, (tx) => checkRole(pgClient(tx), "admin"))).toMatchObject({
      code: "42501",
    });
    expect(await asUser(db, alice.id, (tx) => checkRole(pgClient(tx), "staff"))).toMatchObject({
      code: "42501",
    });
  });
});

describe("Order aanmaken voor klant (createOrderForCustomer)", () => {
  it("staff create for a customer without login; the database makes it a staff order in the initial status", async () => {
    const created = await staffCreates(daveCustomer, { serviceType: "sea" });
    const row = await orderRow(created.id);
    expect(created.reference).toMatch(/^ORD-\d{4}-\d{5,}$/);
    expect(row).toMatchObject({
      customer_id: daveCustomer,
      created_by_role: "staff",
      created_by: staff.id,
      status: "order_registered",
      // Staff may use a service type customers cannot pick (sea is disabled).
      service_type: "sea",
      received_at: null,
    });
  });

  it("refuses a disabled customer (55000), and a customer cannot do it for someone else (42501)", async () => {
    await asUser(db, staff.id, async (tx) => {
      await expectAppError(
        createOrderForCustomer(
          pgClient(tx),
          createOrderInputSchema.parse({
            customerId: carolCustomer,
            fields: form(),
            parentOrderId: null,
            measuredWeightLbs: "",
          }),
        ),
        "55000",
      );
    });
    await asUser(db, alice.id, async (tx) => {
      await expectAppError(
        createOrderForCustomer(
          pgClient(tx),
          createOrderInputSchema.parse({
            customerId: bobCustomer,
            fields: form(),
            parentOrderId: null,
            measuredWeightLbs: "",
          }),
        ),
        "42501",
      );
    });
  });

  it("an extra package hangs off the root order with its purchase details; another customer's root is refused", async () => {
    const root = await staffCreates(aliceCustomer, {
      orderType: "b2b",
      storeVendor: "Alibaba",
      vendorOrderNumber: "PO-9",
      purchaseMode: "customer_purchased",
    });
    const child = await staffCreates(aliceCustomer, { storeVendor: "Iets anders" }, root.id);
    const grandchild = await staffCreates(aliceCustomer, {}, child.id);
    for (const id of [child.id, grandchild.id]) {
      expect(await orderRow(id)).toMatchObject({
        parent_order_id: root.id,
        order_type: "b2b",
        store_vendor: "Alibaba",
        vendor_order_number: "PO-9",
      });
    }
    await asUser(db, staff.id, async (tx) => {
      const app = await expectAppError(
        createOrderForCustomer(
          pgClient(tx),
          createOrderInputSchema.parse({
            customerId: bobCustomer,
            fields: form(),
            parentOrderId: root.id,
            measuredWeightLbs: "",
          }),
        ),
        "22023",
      );
      expect(app.message).toContain("hoofdorder");
    });
  });
});

describe("Ontvangen in US-magazijn (receiveOrder)", () => {
  it("records the measured weight and who received it, moves to the US warehouse; again only corrects the weight", async () => {
    const o = await staffCreates(aliceCustomer);
    const first = await asUser(
      db,
      staff.id,
      (tx) => receiveOrder(pgClient(tx), { orderId: o.id, measuredWeightLbs: 2.456 }),
      {
        commit: true,
      },
    );
    expect(first.changed).toEqual([o.id]);
    // arrived_us_warehouse has notify_customer on: one e-mail for alice.
    expect(first.emails).toEqual([
      { customerId: aliceCustomer, orderIds: [o.id], historyIds: [expect.any(Number)] },
    ]);
    const row = await orderRow(o.id);
    expect(row).toMatchObject({
      status: "arrived_us_warehouse",
      measured_weight_lbs: "2.46",
      received_by: staff.id,
    });
    const receivedAt = row["received_at"];

    const again = await asUser(
      db,
      colleague.id,
      (tx) => receiveOrder(pgClient(tx), { orderId: o.id, measuredWeightLbs: 3 }),
      {
        commit: true,
      },
    );
    expect(again).toMatchObject({ changed: [], unchanged: [o.id], emails: [] });
    expect(await orderRow(o.id)).toMatchObject({
      measured_weight_lbs: "3.00",
      received_by: staff.id,
      received_at: receivedAt,
    });
    const history = await db.query(
      "select * from public.shipment_status_history where order_id = $1",
      [o.id],
    );
    expect(history.rows).toHaveLength(1);
  });

  it("a customer cannot receive (42501)", async () => {
    const o = await staffCreates(aliceCustomer);
    await asUser(db, alice.id, async (tx) => {
      await expectAppError(
        receiveOrder(pgClient(tx), { orderId: o.id, measuredWeightLbs: 1 }),
        "42501",
      );
    });
  });

  it("canReceive() offers the action exactly where receive_order accepts it", async () => {
    const cases: [string, boolean][] = [
      ["order_registered", false],
      ["arrived_us_warehouse", true],
      ["in_transit", true],
      ["documents_required", false],
      ["documents_required", true],
      ["ready_for_pickup", true],
      ["cancelled", false],
    ];
    const stages = new Map(
      (
        await db.query<{ code: string; stage: StatusStage }>(
          "select code, stage from public.shipment_statuses",
        )
      ).rows.map((r) => [r.code, r.stage]),
    );
    const outcomes: boolean[] = [];
    for (const [code, receivedFirst] of cases) {
      const o = await staffCreates(aliceCustomer);
      if (receivedFirst) {
        await asUser(
          db,
          staff.id,
          (tx) => receiveOrder(pgClient(tx), { orderId: o.id, measuredWeightLbs: 1 }),
          { commit: true },
        );
      }
      if (code !== "order_registered" && code !== "arrived_us_warehouse") {
        await staffMoves([o.id], code, { customerMessage: "Graag de factuur uploaden." });
      }
      const row = await orderRow(o.id);
      const offered = canReceive(
        stages.get(String(row["status"])) ?? null,
        (row["received_at"] as string | null) ?? null,
      );
      const accepted = await asUser(db, staff.id, async (tx) => {
        const r = await receiveOrder(pgClient(tx), { orderId: o.id, measuredWeightLbs: 5 }).then(
          () => true,
          () => false,
        );
        return r;
      });
      expect(offered, `${code} received=${receivedFirst}`).toBe(accepted);
      outcomes.push(accepted);
    }
    // Both answers occur, so the comparison is not vacuous.
    expect(outcomes).toContain(true);
    expect(outcomes).toContain(false);
  });
});

describe("Status wijzigen (changeOrderStatus), single and bulk", () => {
  it("one call moves the whole selection, writes history 'door Maria' with the message, plans one e-mail per customer", async () => {
    const a1 = await staffCreates(aliceCustomer);
    const a2 = await staffCreates(aliceCustomer);
    const b1 = await staffCreates(bobCustomer);
    const result = await staffMoves([a1.id, a2.id, b1.id], "in_transit", {
      customerMessage: "Vlucht van dinsdag",
    });
    expect(result.changed.sort()).toEqual([a1.id, a2.id, b1.id].sort());
    expect(result.emails).toHaveLength(2);
    expect(result.emails.find((e) => e.customerId === aliceCustomer)?.orderIds.sort()).toEqual(
      [a1.id, a2.id].sort(),
    );

    const history = await db.query<Row>(
      "select order_id, from_status, to_status, changed_by, customer_message from public.shipment_status_history where order_id = any($1::uuid[])",
      [[a1.id, a2.id, b1.id]],
    );
    expect(history.rows).toHaveLength(3);
    for (const h of history.rows) {
      expect(h).toMatchObject({
        from_status: "order_registered",
        to_status: "in_transit",
        changed_by: staff.id,
        customer_message: "Vlucht van dinsdag",
      });
    }
    // The name behind changed_by: staff read every profile.
    const names = await asUser(db, colleague.id, (tx) =>
      tx.query<{ display_name: string }>("select display_name from public.profiles where id = $1", [
        staff.id,
      ]),
    );
    expect(names.rows).toEqual([{ display_name: "Maria" }]);
    // The customer sees the change and the message, never another customer's order.
    const seen = await asUser(db, alice.id, (tx) =>
      tx.query<Row>(
        "select order_id, customer_message from public.shipment_status_history where order_id = any($1::uuid[])",
        [[a1.id, a2.id, b1.id]],
      ),
    );
    expect(seen.rows.map((r) => r["order_id"]).sort()).toEqual([a1.id, a2.id].sort());
    const staffNames = await asUser(db, alice.id, (tx) =>
      tx.query("select display_name from public.profiles where id = $1", [staff.id]),
    );
    expect(staffNames.rows).toEqual([]);

    // Again: nothing changes, no e-mail.
    const again = await staffMoves([a1.id, b1.id], "in_transit");
    expect(again).toMatchObject({ changed: [], emails: [] });
    expect(again.unchanged.sort()).toEqual([a1.id, b1.id].sort());
  });

  it("'Klant e-mailen' off, or a status the customer cannot see, plans no e-mail", async () => {
    const o = await staffCreates(bobCustomer);
    expect((await staffMoves([o.id], "in_transit", { notifyCustomer: false })).emails).toEqual([]);
    await db.query(
      `insert into public.shipment_statuses (code, label_nl, stage, sort_order, customer_visible, notify_customer)
       values ('weighing_check', 'Interne controle', 'in_transit', 55, false, true) on conflict do nothing`,
    );
    const hidden = await staffMoves([o.id], "weighing_check");
    expect(hidden.changed).toEqual([o.id]);
    expect(hidden.emails).toEqual([]);
  });

  it("'Actie vereist' needs a message (22023); with one the customer can read it", async () => {
    const o = await staffCreates(aliceCustomer);
    await asUser(db, staff.id, async (tx) => {
      const app = await expectAppError(
        changeOrderStatus(pgClient(tx), statusInput([o.id], "documents_required")),
        "22023",
      );
      expect(app.message).toContain("Schrijf de klant");
    });
    await staffMoves([o.id], "documents_required", {
      customerMessage: "Upload de aankoopfactuur.",
    });
    const seen = await asUser(db, alice.id, (tx) =>
      tx.query("select customer_message from public.shipment_status_history where order_id = $1", [
        o.id,
      ]),
    );
    expect(seen.rows).toEqual([{ customer_message: "Upload de aankoopfactuur." }]);
  });

  it("inactive statuses are refused (the dialog only offers active ones)", async () => {
    const o = await staffCreates(aliceCustomer);
    await db.query("update public.shipment_statuses set active = false where code = 'pending'");
    try {
      await asUser(db, staff.id, async (tx) => {
        await expectAppError(
          changeOrderStatus(pgClient(tx), statusInput([o.id], "pending")),
          "22023",
        );
      });
    } finally {
      await db.query("update public.shipment_statuses set active = true where code = 'pending'");
    }
  });

  it("a customer cannot change a status or hand over (42501)", async () => {
    const o = await staffCreates(aliceCustomer);
    await asUser(db, alice.id, async (tx) => {
      await expectAppError(
        changeOrderStatus(pgClient(tx), statusInput([o.id], "in_transit")),
        "42501",
      );
      await expectAppError(
        pickUpOrders(
          pgClient(tx),
          pickupInputSchema.parse({
            orderIds: [o.id],
            toStatus: "picked_up",
            pickedUpByName: "Alice",
            overrideReason: "Ik wil het nu",
            notifyCustomer: false,
          }),
        ),
        "42501",
      );
    });
  });
});

describe("Afgeven aan klant (pickUpOrders) with pay_before_pickup", () => {
  async function invoicedReadyOrder() {
    const o = await staffCreates(aliceCustomer);
    const invoice = await asUser(
      db,
      staff.id,
      async (tx) => {
        await receiveOrder(pgClient(tx), { orderId: o.id, measuredWeightLbs: 2 });
        const draft = (
          await tx.query<{ id: string }>(
            `insert into public.invoices (customer_id, currency, invoice_date, due_date)
             values ($1, 'USD', ${TODAY}, ${TODAY} + 7) returning id`,
            [aliceCustomer],
          )
        ).rows[0]!;
        await tx.query(
          `insert into public.invoice_items (invoice_id, order_id, line_type, description, weight_lbs, rate_per_lb)
           values ($1, $2, 'freight', 'Amazon – order 112-1', 2, 4.5)`,
          [draft.id, o.id],
        );
        return (
          await tx.query<{ id: string; invoice_number: string }>(
            "select id, invoice_number from public.issue_invoice($1)",
            [draft.id],
          )
        ).rows[0]!;
      },
      { commit: true },
    );
    await staffMoves([o.id], "ready_for_pickup");
    return { orderId: o.id, invoice };
  }

  it("the list's billing columns read what pay_before_pickup checks", async () => {
    const { orderId, invoice } = await invoicedReadyOrder();
    const billing = await asUser(db, staff.id, async (tx) => {
      const items = await tx.query<{ invoice_id: string; order_id: string | null }>(
        "select invoice_id, order_id from public.invoice_items where order_id = $1",
        [orderId],
      );
      const invoices = await tx.query<BillingInvoice>(
        `select id, invoice_number, status, is_overdue, balance_due::float8 as balance_due, currency,
                total_amount::float8 as total_amount, amount_paid::float8 as amount_paid, invoice_date, due_date
           from public.invoice_overview where id = any($1::uuid[])`,
        [items.rows.map((i) => i.invoice_id)],
      );
      return orderBilling(orderId, indexBilling(invoices.rows, items.rows));
    });
    expect(billing).toMatchObject({
      payment: "open",
      hasOpenInvoice: true,
      unpaid: [{ currency: "USD", amount: 9 }],
    });
    expect(billing.invoices.map((i) => i.invoice_number)).toEqual([invoice.invoice_number]);
  });

  it("an unpaid order is refused with the hint the dialog acts on; 'Toch afgeven' with a reason hands it over, audited", async () => {
    const { orderId, invoice } = await invoicedReadyOrder();
    const input = {
      orderIds: [orderId],
      toStatus: "picked_up",
      pickedUpByName: " Jan Jansen ",
      notifyCustomer: true,
    };
    await asUser(db, staff.id, async (tx) => {
      const app = await expectAppError(
        pickUpOrders(pgClient(tx), pickupInputSchema.parse(input)),
        "55000",
      );
      expect(app.hint).toBe("pay_before_pickup");
      expect(app.message).toContain(invoice.invoice_number);
      await expectAppError(
        changeOrderStatus(
          pgClient(tx),
          statusInput([orderId], "picked_up", { pickedUpByName: "Jan" }),
        ),
        "55000",
      );
    });
    expect((await orderRow(orderId))["status"]).toBe("ready_for_pickup");

    const done = await asUser(
      db,
      staff.id,
      (tx) =>
        pickUpOrders(
          pgClient(tx),
          pickupInputSchema.parse({ ...input, overrideReason: "Betaalt morgen contant" }),
        ),
      { commit: true },
    );
    expect(done.changed).toEqual([orderId]);
    const row = await orderRow(orderId);
    expect(row).toMatchObject({
      status: "picked_up",
      picked_up_by_name: "Jan Jansen",
      handed_over_by: staff.id,
    });
    expect(row["picked_up_at"]).not.toBeNull();
    const audit = await db.query<{ reason: string }>(
      "select reason from public.audit_log where table_name = 'orders' and record_id = $1 and reason is not null",
      [orderId],
    );
    expect(audit.rows.map((r) => r.reason)).toEqual([
      "Afgegeven zonder volledige betaling: Betaalt morgen contant",
    ]);
  });

  it("without an open invoice a completed status needs only the collector's name", async () => {
    const o = await staffCreates(bobCustomer);
    await asUser(db, staff.id, async (tx) => {
      await expectAppError(
        changeOrderStatus(pgClient(tx), statusInput([o.id], "picked_up")),
        "22023",
      );
    });
    const done = await asUser(
      db,
      staff.id,
      (tx) =>
        pickUpOrders(
          pgClient(tx),
          pickupInputSchema.parse({
            orderIds: [o.id],
            toStatus: "picked_up",
            pickedUpByName: "Bob",
            notifyCustomer: false,
          }),
        ),
      { commit: true },
    );
    expect(done.changed).toEqual([o.id]);
  });
});

describe("P4 review guards (migration p4_order_guards)", () => {
  const handOver = (orderIds: string[], extra: Record<string, unknown> = {}) =>
    pickupInputSchema.parse({
      orderIds,
      toStatus: "picked_up",
      pickedUpByName: "Ricardo Bakker",
      notifyCustomer: false,
      ...extra,
    });

  async function invoicedOrder(customerId: string) {
    const o = await staffCreates(customerId);
    await asUser(
      db,
      staff.id,
      async (tx) => {
        await receiveOrder(pgClient(tx), { orderId: o.id, measuredWeightLbs: 2 });
        const draft = (
          await tx.query<{ id: string }>(
            `insert into public.invoices (customer_id, currency, invoice_date, due_date)
             values ($1, 'USD', ${TODAY}, ${TODAY} + 7) returning id`,
            [customerId],
          )
        ).rows[0]!;
        await tx.query(
          `insert into public.invoice_items (invoice_id, order_id, line_type, description, weight_lbs, rate_per_lb)
           values ($1, $2, 'freight', 'Amazon', 2, 4.5)`,
          [draft.id, o.id],
        );
        await tx.query("select public.issue_invoice($1)", [draft.id]);
      },
      { commit: true },
    );
    return o.id;
  }

  it("a hand-over is per customer: one collector name never lands on another customer's order", async () => {
    const a = (await staffCreates(aliceCustomer)).id;
    const b = (await staffCreates(bobCustomer)).id;
    await staffMoves([a, b], "ready_for_pickup");

    await asUser(db, staff.id, async (tx) => {
      const plain = await expectAppError(pickUpOrders(pgClient(tx), handOver([a, b])), "22023");
      expect(plain.hint).toBe("handover_one_customer");
      expect(plain.message).toContain("Afgeven gaat per klant");
      // "Toch afgeven" is held to the same rule.
      await expectAppError(
        pickUpOrders(pgClient(tx), handOver([a, b], { overrideReason: "Familie" })),
        "22023",
      );
    });
    expect((await orderRow(a))["picked_up_by_name"]).toBeNull();

    // Per customer it works, and Alice reads only her own collector.
    await asUser(
      db,
      staff.id,
      (tx) => pickUpOrders(pgClient(tx), handOver([a], { pickedUpByName: "Alice Jansen" })),
      { commit: true },
    );
    // Alice's order is already picked up, so it no longer counts: Bob's alone moves.
    const bob = await asUser(db, staff.id, (tx) => pickUpOrders(pgClient(tx), handOver([a, b])), {
      commit: true,
    });
    expect(bob).toMatchObject({ changed: [b], unchanged: [a] });
    const seen = await asUser(db, alice.id, (tx) =>
      tx.query("select picked_up_by_name from public.orders where id = $1", [a]),
    );
    expect(seen.rows).toEqual([{ picked_up_by_name: "Alice Jansen" }]);
    // Other statuses still move several customers at once.
    const c = (await staffCreates(aliceCustomer)).id;
    const d = (await staffCreates(bobCustomer)).id;
    expect((await staffMoves([c, d], "pending")).changed.sort()).toEqual([c, d].sort());
  });

  it("'Toch afgeven' records the reason only on the orders that are really unpaid", async () => {
    const unpaid = await invoicedOrder(aliceCustomer);
    const paid = (await staffCreates(aliceCustomer)).id; // never invoiced
    await staffMoves([unpaid, paid], "ready_for_pickup");

    const refused = await asUser(db, staff.id, (tx) =>
      expectAppError(pickUpOrders(pgClient(tx), handOver([unpaid, paid])), "55000"),
    );
    expect(refused.hint).toBe("pay_before_pickup");

    const done = await asUser(
      db,
      staff.id,
      (tx) =>
        pickUpOrders(
          pgClient(tx),
          handOver([unpaid, paid], { overrideReason: "Alice betaalt morgen" }),
        ),
      { commit: true },
    );
    expect(done.changed.sort()).toEqual([unpaid, paid].sort());
    const reasons = async (id: string) =>
      (
        await db.query<{ reason: string }>(
          "select reason from public.audit_log where table_name = 'orders' and record_id = $1 and reason is not null",
          [id],
        )
      ).rows.map((r) => r.reason);
    expect(await reasons(unpaid)).toEqual([
      "Afgegeven zonder volledige betaling: Alice betaalt morgen",
    ]);
    expect(await reasons(paid)).toEqual([]);
    for (const id of [unpaid, paid]) {
      expect(await orderRow(id)).toMatchObject({
        status: "picked_up",
        picked_up_by_name: "Ricardo Bakker",
        handed_over_by: staff.id,
      });
    }
  });

  it("a new 'Actie vereist' message for an order already waiting is a history row the customer reads", async () => {
    const o = (await staffCreates(aliceCustomer)).id;
    await staffMoves([o], "documents_required", {
      customerMessage: "Upload de factuur van Amazon.",
    });
    const second = await staffMoves([o], "documents_required", {
      customerMessage: "Upload ook de paklijst.",
    });
    expect(second.changed).toEqual([o]);
    // The status keeps its notify flag: one e-mail for the new request.
    expect(second.emails).toEqual([
      { customerId: aliceCustomer, orderIds: [o], historyIds: [expect.any(Number)] },
    ]);
    // The same message again changes nothing.
    const same = await staffMoves([o], "documents_required", {
      customerMessage: " Upload ook de paklijst. ",
    });
    expect(same).toMatchObject({ changed: [], unchanged: [o], emails: [] });

    const history = await asUser(
      db,
      alice.id,
      async (tx) =>
        (
          await tx.query<{
            id: number;
            from_status: string;
            to_status: string;
            changed_at: string;
            changed_by: string;
            customer_message: string | null;
          }>(
            "select id, from_status, to_status, changed_at, changed_by, customer_message from public.shipment_status_history where order_id = $1 order by id",
            [o],
          )
        ).rows,
    );
    expect(history.map((h) => [h.from_status, h.to_status, h.customer_message])).toEqual([
      ["order_registered", "documents_required", "Upload de factuur van Amazon."],
      ["documents_required", "documents_required", "Upload ook de paklijst."],
    ]);
    expect(history[1]?.changed_by).toBe(staff.id);
    expect(currentStatusMessage(history, "documents_required")).toBe("Upload ook de paklijst.");
    expect((await orderRow(o))["status"]).toBe("documents_required");
  });

  it("an order moved past the warehouse without receipt can still get its measured weight; the dialog keeps unreceived orders back", async () => {
    // What the status dialog now refuses: registered → in transit without receiving.
    expect(mustReceiveFirst({ stage: "registered", receivedAt: null }, "in_transit")).toBe(true);
    expect(mustReceiveFirst({ stage: "registered", receivedAt: null }, "us_warehouse")).toBe(false);
    expect(mustReceiveFirst({ stage: "registered", receivedAt: null }, "cancelled")).toBe(false);
    expect(
      mustReceiveFirst({ stage: "us_warehouse", receivedAt: "2026-10-07T12:00:00Z" }, "in_transit"),
    ).toBe(false);

    // Orders that got there anyway (older data, imports): receive_order refuses them …
    const o = (await staffCreates(aliceCustomer)).id;
    await staffMoves([o], "in_transit");
    expect(canReceive("in_transit", null)).toBe(false);
    await asUser(db, staff.id, (tx) =>
      expectAppError(receiveOrder(pgClient(tx), { orderId: o, measuredWeightLbs: 3 }), "55000"),
    );
    // … so "Gewicht invullen" writes the staff-editable column directly.
    expect(canSetWeightDirectly("in_transit", null)).toBe(true);
    await asUser(
      db,
      staff.id,
      (tx) => updateMeasuredWeight(pgClient(tx), { orderId: o, measuredWeightLbs: 3.25 }),
      { commit: true },
    );
    expect(await orderRow(o)).toMatchObject({
      measured_weight_lbs: "3.25",
      received_at: null,
      status: "in_transit",
    });
    const audit = await db.query<{ actor_id: string }>(
      "select actor_id from public.audit_log where table_name = 'orders' and record_id = $1 and action = 'UPDATE' order by id desc limit 1",
      [o],
    );
    expect(audit.rows).toEqual([{ actor_id: staff.id }]);
    // A customer cannot.
    await asUser(db, alice.id, (tx) =>
      expectAppError(
        updateMeasuredWeight(pgClient(tx), { orderId: o, measuredWeightLbs: 1 }),
        "42501",
      ),
    );
    expect(canSetWeightDirectly("completed", null)).toBe(false);
    expect(canSetWeightDirectly("us_warehouse", null)).toBe(false);
  });
});

describe("cancellation requests", () => {
  it("'Order behouden' resolves the task as the dashboard and order page do; the customer cannot touch tasks", async () => {
    const o = await staffCreates(aliceCustomer);
    await asUser(
      db,
      alice.id,
      (tx) => tx.query("select public.request_order_cancellation($1)", [o.id]),
      { commit: true },
    );
    const task = await asUser(
      db,
      staff.id,
      async (tx) =>
        (
          await tx.query<{ id: string }>(
            "select id from public.staff_tasks where order_id = $1 and kind = 'order_cancellation_request' and resolved_at is null",
            [o.id],
          )
        ).rows[0]!,
    );
    expect(task).toBeDefined();
    // The customer sees no tasks and updates none.
    await asUser(db, alice.id, async (tx) => {
      expect((await tx.query("select id from public.staff_tasks")).rows).toEqual([]);
      const r = await tx.query(
        "update public.staff_tasks set resolved_at = now() where id = $1 and resolved_at is null",
        [task.id],
      );
      expect(r.affectedRows ?? 0).toBe(0);
    });
    await asUser(
      db,
      colleague.id,
      (tx) =>
        tx.query(
          "update public.staff_tasks set resolved_at = $2 where id = $1 and resolved_at is null returning id",
          [task.id, new Date().toISOString()],
        ),
      { commit: true },
    );
    const resolved = await db.query<Row>(
      "select resolved_at, resolved_by from public.staff_tasks where id = $1",
      [task.id],
    );
    expect(resolved.rows[0]).toMatchObject({ resolved_by: colleague.id });
    // The order goes on; its request timestamp stays (no client may clear it).
    expect(await orderRow(o.id)).toMatchObject({ status: "order_registered" });
    expect((await orderRow(o.id))["cancellation_requested_at"]).not.toBeNull();
  });

  it("'Order annuleren' is a status change that resolves the request itself", async () => {
    const o = await staffCreates(bobCustomer);
    await asUser(
      db,
      bob.id,
      (tx) => tx.query("select public.request_order_cancellation($1)", [o.id]),
      { commit: true },
    );
    await staffMoves([o.id], "cancelled", { customerMessage: "Op uw verzoek geannuleerd." });
    const tasks = await db.query<Row>(
      "select resolved_at, resolved_by from public.staff_tasks where order_id = $1 and kind = 'order_cancellation_request'",
      [o.id],
    );
    expect(tasks.rows).toHaveLength(1);
    expect(tasks.rows[0]).toMatchObject({ resolved_by: staff.id });
  });
});

describe("internal notes (staff only, SPEC §35.3)", () => {
  it("staff add a note; the database stamps the author; customers neither read nor write them", async () => {
    const o = await staffCreates(aliceCustomer);
    const note = await asUser(
      db,
      staff.id,
      async (tx) =>
        (
          await tx.query<Row>(
            "insert into public.internal_notes (customer_id, order_id, body) values ($1, $2, $3) returning created_by",
            [aliceCustomer, o.id, "Klant gebeld, komt vrijdag."],
          )
        ).rows[0]!,
      { commit: true },
    );
    expect(note).toEqual({ created_by: staff.id });
    await asUser(db, alice.id, async (tx) => {
      expect(
        (await tx.query("select id from public.internal_notes where order_id = $1", [o.id])).rows,
      ).toEqual([]);
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query(
            "insert into public.internal_notes (customer_id, order_id, body) values ($1, $2, 'x')",
            [aliceCustomer, o.id],
          ),
        ),
        "42501",
      );
    });
    // A note must belong to the order's customer.
    await asUser(db, staff.id, async (tx) => {
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query(
            "insert into public.internal_notes (customer_id, order_id, body) values ($1, $2, 'x')",
            [bobCustomer, o.id],
          ),
        ),
        "22023",
      );
    });
  });
});

describe("documents for staff", () => {
  it("staff upload into a completed order's folder, then delete the row and the object; customers cannot delete", async () => {
    const o = await staffCreates(aliceCustomer, {
      orderType: "b2b",
      purchaseMode: "customer_purchased",
    });
    await asUser(
      db,
      staff.id,
      (tx) =>
        pickUpOrders(
          pgClient(tx),
          pickupInputSchema.parse({
            orderIds: [o.id],
            toStatus: "picked_up",
            pickedUpByName: "Alice",
            notifyCustomer: false,
          }),
        ),
      { commit: true },
    );
    const path = documentStoragePath(
      aliceCustomer,
      o.id,
      randomUUID(),
      DOCUMENT_MIME_TYPES["application/pdf"],
    );
    const docId = await asUser(
      db,
      staff.id,
      async (tx) => {
        await uploadObject(tx, path);
        // What uploadOrderDocument() inserts; customer_id comes from the order page.
        return (
          await tx.query<{ id: string; uploaded_by: string; customer_id: string }>(
            `insert into public.order_documents (order_id, customer_id, kind, storage_path, original_filename, mime_type, size_bytes)
             values ($1, $2, 'commercial_invoice', $3, 'commercial-invoice.pdf', 'application/pdf', 1000) returning id, uploaded_by, customer_id`,
            [o.id, aliceCustomer, path],
          )
        ).rows[0]!;
      },
      { commit: true },
    );
    expect(docId).toMatchObject({ uploaded_by: staff.id, customer_id: aliceCustomer });
    expect((B2B_CUSTOMS_DOCUMENT_KINDS as readonly string[]).includes("commercial_invoice")).toBe(
      true,
    );

    // The customer sees the document but cannot delete it or its object.
    await asUser(db, alice.id, async (tx) => {
      expect(
        (await tx.query("select id from public.order_documents where id = $1", [docId.id])).rows,
      ).toHaveLength(1);
      expect(
        (await tx.query("delete from public.order_documents where id = $1", [docId.id]))
          .affectedRows ?? 0,
      ).toBe(0);
      await tx.query("select set_config('storage.allow_delete_query', 'true', true)");
      expect(
        (await tx.query("delete from storage.objects where name = $1", [path])).affectedRows ?? 0,
      ).toBe(0);
    });
    // Staff: the row first (.delete().eq('id').select('id').single()), then the object.
    await asUser(
      db,
      staff.id,
      async (tx) => {
        expect(
          (
            await tx.query("delete from public.order_documents where id = $1 returning id", [
              docId.id,
            ])
          ).rows,
        ).toHaveLength(1);
        await tx.query("select set_config('storage.allow_delete_query', 'true', true)");
        expect(
          (
            await tx.query(
              "delete from storage.objects where bucket_id = 'order-documents' and name = $1",
              [path],
            )
          ).affectedRows,
        ).toBe(1);
      },
      { commit: true },
    );
  });
});

describe("dashboard reads", () => {
  it("open tasks are ticked off by staff only, and counts by stage see every customer's orders", async () => {
    const t = await db.query<{ id: string }>(
      "insert into public.staff_tasks (kind, body, email) values ('signup_email_conflict', 'Iemand registreerde met een bekend adres.', 'x@example.com') returning id",
    );
    const id = t.rows[0]!.id;
    await asUser(db, bob.id, async (tx) => {
      expect(
        (
          await tx.query(
            "update public.staff_tasks set resolved_at = now() where id = $1 and resolved_at is null",
            [id],
          )
        ).affectedRows ?? 0,
      ).toBe(0);
    });
    await asUser(
      db,
      staff.id,
      async (tx) => {
        const r = await tx.query(
          "update public.staff_tasks set resolved_at = $2 where id = $1 and resolved_at is null",
          [id, new Date().toISOString()],
        );
        expect(r.affectedRows).toBe(1);
      },
      { commit: true },
    );
    const counts = await asUser(db, staff.id, async (tx) => ({
      registered: Number(
        (
          await tx.query<{ n: string }>(
            "select count(*) as n from public.orders where status = any(select code from public.shipment_statuses where stage = 'registered')",
          )
        ).rows[0]!.n,
      ),
      customers: Number(
        (
          await tx.query<{ n: string }>(
            "select count(distinct customer_id) as n from public.orders",
          )
        ).rows[0]!.n,
      ),
    }));
    expect(counts.registered).toBeGreaterThan(0);
    expect(counts.customers).toBeGreaterThanOrEqual(3);
    const own = await asUser(db, alice.id, (tx) =>
      tx.query("select distinct customer_id from public.orders"),
    );
    expect(own.rows).toEqual([{ customer_id: aliceCustomer }]);
  });
});
