// @vitest-environment node
/**
 * The customer portal (src/lib/portal, P3) against the real migrations: what
 * the browser and registerOrderFn send must pass the triggers, checks and
 * policies, and what the database lets through must be handled by the app.
 * Payloads are built with the app's own code, not copied by hand.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// documents.ts creates the browser client on import; nothing here calls it.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  DOCUMENT_MIME_TYPES,
  documentDownloadName,
  documentStoragePath,
} from "@/lib/portal/documents";
import { toOrderColumns, type OrderFieldsInput } from "@/lib/portal/order-fields";
import { orderRegistrationFieldsSchema } from "@/lib/portal/order-schema";

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
type Order = {
  id: string;
  reference: string;
  status: string;
  customer_id: string;
  store_vendor: string | null;
  vendor_order_number: string | null;
  parent_order_id: string | null;
};

let db: Db;
let alice: AuthUser;
let bob: AuthUser;
let staff: AuthUser;
let promoted: AuthUser;
let aliceCustomer: string;
let bobCustomer: string;

async function customerIdOf(userId: string): Promise<string> {
  const r = await db.query<{ id: string }>("select id from public.customers where user_id = $1", [
    userId,
  ]);
  if (!r.rows[0]) throw new Error("no customer");
  return r.rows[0].id;
}

function insertSql(table: string, values: Record<string, unknown>): string {
  const cols = Object.keys(values);
  return `insert into ${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`;
}

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

const personalForm: OrderFieldsInput = {
  orderType: "personal",
  serviceType: "air",
  storeVendor: "Amazon",
  vendorOrderNumber: "",
  description: "Schoenen",
  quantity: "1",
  estimatedValue: "49,95",
  estimatedValueCurrency: "USD",
  purchaseDate: daysAgo(3),
  expectedDeliveryDate: "",
  trackingNumber: "",
  carrier: "",
  declaredWeightLbs: "",
  customerNote: "<img src=x onerror=alert(1)>",
  supplierName: "",
  clientPoNumber: "",
  purchaseMode: "",
};

/** What registerOrder() inserts: toOrderColumns(fields) + customer_id + parent_order_id. */
function registrationPayload(
  customerId: string,
  form: Partial<OrderFieldsInput> = {},
  parent: string | null = null,
) {
  const fields = orderRegistrationFieldsSchema.parse({ ...personalForm, ...form });
  return { ...toOrderColumns(fields), customer_id: customerId, parent_order_id: parent };
}

async function register(user: AuthUser, customerId: string, form: Partial<OrderFieldsInput> = {}) {
  const values = registrationPayload(customerId, form);
  return asUser(
    db,
    user.id,
    async (tx) =>
      (await tx.query<Order>(insertSql("public.orders", values), Object.values(values))).rows[0]!,
    { commit: true },
  );
}

/** What the Storage API inserts on upload, under the caller's RLS. */
async function uploadObject(tx: Q, path: string, mime = "application/pdf"): Promise<void> {
  await tx.query(
    `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
     values ('order-documents', $1, auth.uid(), auth.uid()::text, jsonb_build_object('mimetype', $2::text, 'size', 1000))`,
    [path, mime],
  );
}

async function deleteObject(tx: Q, path: string): Promise<number | undefined> {
  await tx.query("select set_config('storage.allow_delete_query', 'true', true)");
  const r = await tx.query(
    "delete from storage.objects where bucket_id = 'order-documents' and name = $1",
    [path],
  );
  await tx.query("select set_config('storage.allow_delete_query', 'false', true)");
  return r.affectedRows;
}

/** What uploadOrderDocument() inserts after the storage upload. */
function documentRow(order: Order, path: string, mime: string, originalFilename: string) {
  return {
    order_id: order.id,
    customer_id: order.customer_id,
    kind: "purchase_invoice",
    storage_path: path,
    original_filename: originalFilename,
    mime_type: mime,
    size_bytes: 1000,
  };
}

beforeAll(async () => {
  db = await createDb();
  alice = await createAuthUser(db, {
    email: "alice@example.com",
    meta: { full_name: "Alice Jansen", phone: "+597 8000001" },
  });
  bob = await createAuthUser(db, {
    email: "bob@example.com",
    meta: { full_name: "Bob Bakker", phone: "+597 8000002" },
  });
  staff = await createAuthUser(db, { email: "staff@example.com", confirmed: false });
  await db.query("insert into public.user_roles (user_id, role) values ($1, 'staff')", [staff.id]);
  // An existing customer promoted to staff keeps the active customer record.
  promoted = await createAuthUser(db, {
    email: "promoted@example.com",
    meta: { full_name: "Sam Staff", phone: "+597 8000009" },
  });
  await db.query("insert into public.user_roles (user_id, role) values ($1, 'staff')", [
    promoted.id,
  ]);
  aliceCustomer = await customerIdOf(alice.id);
  bobCustomer = await customerIdOf(bob.id);
});

afterAll(async () => {
  await db?.close();
});

describe("order registration payload (registerOrder → orders insert)", () => {
  it("is accepted; reference and status come from the trigger; a forged customer is refused", async () => {
    const o = await register(alice, aliceCustomer);
    expect(o.customer_id).toBe(aliceCustomer);
    expect(o.status).toBe("order_registered");
    expect(o.reference).toMatch(/^ORD-\d{4}-\d{5,}$/);

    const forged = registrationPayload(bobCustomer);
    await expectSqlError(
      asUser(db, alice.id, (tx) =>
        tx.query(insertSql("public.orders", forged), Object.values(forged)),
      ),
      "42501",
    );
    // Bob cannot hang a package off alice's order.
    const sibling = registrationPayload(bobCustomer, {}, o.id);
    await expectSqlError(
      asUser(db, bob.id, (tx) =>
        tx.query(insertSql("public.orders", sibling), Object.values(sibling)),
      ),
      "22023",
    );
  });

  it("a B2B purchase G&R still has to make goes in without store, value or purchase date", async () => {
    const o = await register(alice, aliceCustomer, {
      orderType: "b2b",
      purchaseMode: "gr_purchases",
      supplierName: "Acme Supply",
      clientPoNumber: "PO-9",
      storeVendor: "",
      estimatedValue: "",
      purchaseDate: "",
    });
    const row = await db.query<Record<string, unknown>>(
      "select store_vendor, estimated_value, purchase_date, supplier_name, purchase_mode from public.orders where id = $1",
      [o.id],
    );
    expect(row.rows[0]).toEqual({
      store_vendor: null,
      estimated_value: null,
      purchase_date: null,
      supplier_name: "Acme Supply",
      purchase_mode: "gr_purchases",
    });
  });
});

describe("documents: the client's path and type mapping against the storage policies and checks", () => {
  it("every type the client allows is stored at {customer}/{order}/{uuid}.{ext} and recorded", async () => {
    const o = await register(alice, aliceCustomer);
    for (const [mime, ext] of Object.entries(DOCUMENT_MIME_TYPES)) {
      const path = documentStoragePath(aliceCustomer, o.id, randomUUID(), ext);
      await asUser(
        db,
        alice.id,
        async (tx) => {
          await uploadObject(tx, path, mime);
          const values = documentRow(o, path, mime, `scan.${ext}`);
          await tx.query(insertSql("public.order_documents", values), Object.values(values));
        },
        { commit: true },
      );
    }
    // Bob can neither see (so no signed URL) nor list alice's objects.
    const seen = await asUser(db, bob.id, (tx) =>
      tx.query("select name from storage.objects where name like $1", [`${aliceCustomer}/%`]),
    );
    expect(seen.rows).toEqual([]);
  });

  it("original_filename is free text, so downloads are named after the stored, checked extension", async () => {
    // A direct API call can record any name against a .pdf object; staff (P5)
    // read the same rows. documentDownloadName() never trusts that extension.
    const o = await register(alice, aliceCustomer);
    const names = ["Factuur.html", "factuur.pdf.exe", "invoice.svg", "run.hta"];
    for (const name of names) {
      const path = documentStoragePath(aliceCustomer, o.id, randomUUID(), "pdf");
      await asUser(
        db,
        alice.id,
        async (tx) => {
          await uploadObject(tx, path);
          const values = documentRow(o, path, "application/pdf", name);
          await tx.query(insertSql("public.order_documents", values), Object.values(values));
        },
        { commit: true },
      );
    }
    const rows = await asUser(db, promoted.id, (tx) =>
      tx.query<{ original_filename: string; storage_path: string }>(
        "select original_filename, storage_path from public.order_documents where order_id = $1 order by original_filename",
        [o.id],
      ),
    );
    expect(rows.rows.map((r) => r.original_filename).sort()).toEqual([...names].sort());
    expect(rows.rows.map((r) => documentDownloadName(r)).sort()).toEqual(
      ["Factuur.pdf", "factuur.pdf", "invoice.pdf", "run.pdf"].sort(),
    );
  });

  it("storage refuses an upload into a cancelled order's folder, so no orphan object is left", async () => {
    const o = await register(alice, aliceCustomer);
    await asUser(
      db,
      staff.id,
      (tx) =>
        tx.query("select * from public.change_order_status($1::uuid[], 'cancelled', null, null)", [
          [o.id],
        ]),
      { commit: true },
    );
    const path = documentStoragePath(aliceCustomer, o.id, randomUUID(), "pdf");
    await asUser(db, alice.id, async (tx) => {
      await expectSqlError(
        withSavepoint(tx, () => uploadObject(tx, path)),
        "42501",
      );
    });
  });

  it("storage refuses an upload into another customer's order or a made-up folder", async () => {
    const bobOrder = await register(bob, bobCustomer);
    const paths = [
      documentStoragePath(aliceCustomer, bobOrder.id, randomUUID(), "pdf"),
      documentStoragePath(bobCustomer, bobOrder.id, randomUUID(), "pdf"),
      `${aliceCustomer}/${randomUUID()}/${randomUUID()}.pdf`,
      `${aliceCustomer}/${randomUUID()}.pdf`,
    ];
    await asUser(db, alice.id, async (tx) => {
      for (const path of paths) {
        await expectSqlError(
          withSavepoint(tx, () => uploadObject(tx, path)),
          "42501",
        );
      }
    });
  });

  it("an extra package keeps the main order's type, store and order number; staff may still correct", async () => {
    const root = await register(alice, aliceCustomer);
    await asUser(db, alice.id, async (tx) => {
      const values = {
        ...registrationPayload(aliceCustomer, { storeVendor: "Andere winkel" }),
        parent_order_id: root.id,
      };
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query(insertSql("public.orders", values), Object.values(values)),
        ),
        "22023",
      );
    });
    const child = await asUser(
      db,
      alice.id,
      async (tx) => {
        const values = {
          ...registrationPayload(aliceCustomer),
          store_vendor: root.store_vendor,
          vendor_order_number: root.vendor_order_number,
          parent_order_id: root.id,
        };
        return (await tx.query<Order>(insertSql("public.orders", values), Object.values(values)))
          .rows[0]!;
      },
      { commit: true },
    );
    expect(child.parent_order_id).toBe(root.id);
    await asUser(db, alice.id, async (tx) => {
      await expectSqlError(
        withSavepoint(tx, () =>
          tx.query("update public.orders set store_vendor = 'Anders' where id = $1", [root.id]),
        ),
        "55000",
      );
    });
    await asUser(db, staff.id, async (tx) => {
      await tx.query("update public.orders set store_vendor = 'Gecorrigeerd' where id = $1", [
        root.id,
      ]);
    });
  });
});

describe("why the portal filters on the customer itself", () => {
  it("a login that is staff and still has an active customer record sees every customer's orders under RLS", async () => {
    await register(bob, bobCustomer);
    const r = await asUser(db, promoted.id, async (tx) => ({
      customer: (await tx.query<{ c: string | null }>("select public.current_customer_id() as c"))
        .rows[0]!.c,
      staff: (await tx.query<{ s: boolean }>("select public.is_staff() as s")).rows[0]!.s,
      // ordersQueryOptions without .eq('customer_id', …) would show these as its own.
      foreign: (
        await tx.query(
          "select id from public.orders where customer_id <> public.current_customer_id()",
        )
      ).rows.length,
    }));
    expect(r.customer).not.toBeNull();
    // registerOrder() refuses this login (rpc is_staff), see register-order.test.ts.
    expect(r.staff).toBe(true);
    expect(r.foreign).toBeGreaterThan(0);
  });
});
