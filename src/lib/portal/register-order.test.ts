import { afterAll, describe, expect, it, vi } from "vitest";

import {
  CodedError,
  errorMessage,
  fromTransportError,
  toAppError,
  toTransportError,
} from "@/lib/errors";
import { t } from "@/lib/i18n";
import { orderRegistrationFieldsSchema, type RegisterOrderData } from "./order-schema";
import { loadRootOrder, registerOrder } from "./register-order";

// The form's date window is relative to today: pin today (7 October 2026).
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-10-07T15:00:00Z"));
afterAll(() => {
  vi.useRealTimers();
});

const CUSTOMER = "c0c0c0c0-0000-4000-8000-000000000001";
const ROOT = "a0000000-0000-4000-8000-000000000001";
const CHILD = "a0000000-0000-4000-8000-000000000004";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown };

/** A fake of the few supabase-js calls registerOrder makes, recording each call. */
function fakeClient({
  customerId = CUSTOMER as string | null,
  isStaff = false,
  rpcError = null as unknown,
  orders = [] as Row[],
  insertResult = {
    data: { id: "new-id", reference: "ORD-2026-00012" },
    error: null,
  } as Result,
} = {}) {
  const calls: { op: string; table?: string; args?: unknown }[] = [];
  const client = {
    rpc: vi.fn((name: string) => {
      calls.push({ op: "rpc", args: name });
      return Promise.resolve({
        data: name === "is_staff" ? isStaff : customerId,
        error: rpcError,
      });
    }),
    from: vi.fn((table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => ({
          maybeSingle: () => {
            calls.push({ op: "select", table, args: { columns, column, value } });
            return Promise.resolve({
              data: orders.find((o) => o[column] === value) ?? null,
              error: null,
            });
          },
        }),
      }),
      insert: (row: Row) => {
        calls.push({ op: "insert", table, args: row });
        return {
          select: (columns: string) => ({
            single: () => {
              calls.push({ op: "returning", table, args: columns });
              return Promise.resolve(insertResult);
            },
          }),
        };
      },
    })),
  };
  return { client: client as unknown as Parameters<typeof registerOrder>[0], calls };
}

const fields = orderRegistrationFieldsSchema.parse({
  orderType: "personal",
  serviceType: "air",
  storeVendor: "Amazon",
  vendorOrderNumber: "",
  description: "Keukenmixer",
  quantity: "1",
  estimatedValue: "149,99",
  estimatedValueCurrency: "USD",
  purchaseDate: "2026-01-02",
  expectedDeliveryDate: "",
  trackingNumber: " 1Z999AA10123456784 ",
  carrier: "UPS",
  declaredWeightLbs: "",
  customerNote: "",
  supplierName: "",
  clientPoNumber: "",
  purchaseMode: "",
});

const input = (patch: Partial<RegisterOrderData> = {}): RegisterOrderData => ({
  fields,
  prohibitedGoodsAccepted: true,
  parentOrderId: null,
  ...patch,
});

const rootRow = {
  id: ROOT,
  parent_order_id: null,
  order_type: "b2b",
  service_type: "air",
  store_vendor: "Alibaba",
  vendor_order_number: "PO-88812",
  estimated_value_currency: "USD",
  purchase_date: "2026-01-01",
  supplier_name: "Shenzhen Pack Co.",
  client_po_number: null,
  purchase_mode: "gr_purchases",
  status_info: { stage: "registered" },
};

describe("registerOrder()", () => {
  it("asks the database who the customer is and inserts only customer-editable columns", async () => {
    const { client, calls } = fakeClient();
    const order = await registerOrder(client, input());
    expect(order).toEqual({
      id: "new-id",
      reference: "ORD-2026-00012",
      customerId: CUSTOMER,
      parentOrderId: null,
    });
    expect(calls.slice(0, 2)).toEqual([
      { op: "rpc", args: "current_customer_id" },
      { op: "rpc", args: "is_staff" },
    ]);
    const insert = calls.find((c) => c.op === "insert");
    expect(insert?.table).toBe("orders");
    expect(insert?.args).toEqual({
      customer_id: CUSTOMER,
      parent_order_id: null,
      order_type: "personal",
      service_type: "air",
      store_vendor: "Amazon",
      vendor_order_number: null,
      description: "Keukenmixer",
      quantity: 1,
      estimated_value: 149.99,
      estimated_value_currency: "USD",
      purchase_date: "2026-01-02",
      expected_delivery_date: null,
      tracking_number: "1Z999AA10123456784",
      carrier: "UPS",
      declared_weight_lbs: null,
      customer_note: null,
      supplier_name: null,
      client_po_number: null,
      purchase_mode: null,
    });
    // id, reference and status are assigned by the database and read back.
    expect(calls.find((c) => c.op === "returning")?.args).toBe("id, reference");
  });

  it("refuses a login without an active customer record (42501), before any insert", async () => {
    const { client, calls } = fakeClient({ customerId: null });
    const error = await registerOrder(client, input()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedError);
    expect(toAppError(error)).toMatchObject({ kind: "forbidden", code: "42501" });
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("refuses a staff login that still has a customer record (42501), before any insert", async () => {
    const { client, calls } = fakeClient({ isStaff: true });
    const error = await registerOrder(client, input()).catch((e: unknown) => e);
    expect(toAppError(error)).toMatchObject({ kind: "forbidden", code: "42501" });
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("passes the open-order limit (54000) through with its Dutch message and hint", async () => {
    const dbError = {
      code: "54000",
      hint: "open_order_limit",
      details: null,
      message:
        "U heeft al 50 aangemelde orders die G&R nog niet heeft ontvangen. Neem contact op met G&R Solutions om meer orders aan te melden.",
    };
    const { client } = fakeClient({ insertResult: { data: null, error: dbError } });
    const error = await registerOrder(client, input()).catch((e: unknown) => e);
    const sent = toTransportError(error);
    expect(sent).toMatchObject({
      code: "54000",
      hint: "open_order_limit",
      message: dbError.message,
    });
    expect(toAppError(sent)).toMatchObject({ kind: "limit", hint: "open_order_limit" });
  });

  it("adds an extra package to the root order, with the root's type, store and order number", async () => {
    const { client, calls } = fakeClient({ orders: [rootRow] });
    const order = await registerOrder(client, input({ parentOrderId: ROOT }));
    expect(order.parentOrderId).toBe(ROOT);
    expect(calls.find((c) => c.op === "insert")?.args).toMatchObject({
      parent_order_id: ROOT,
      order_type: "b2b",
      store_vendor: "Alibaba",
      vendor_order_number: "PO-88812",
    });
  });
});

describe("loadRootOrder()", () => {
  it("follows a link to an extra package up to its root (check_order_parent refuses nesting)", async () => {
    const child = { ...rootRow, id: CHILD, parent_order_id: ROOT };
    const { client, calls } = fakeClient({ orders: [rootRow, child] });
    expect((await loadRootOrder(client, CHILD)).id).toBe(ROOT);
    expect(calls.filter((c) => c.op === "select")).toHaveLength(2);
  });

  it("says 'not found' for an order RLS hides or that does not exist", async () => {
    const { client } = fakeClient({ orders: [] });
    const error = await loadRootOrder(client, ROOT).catch((e: unknown) => e);
    expect(toAppError(error)).toMatchObject({ kind: "not_found", code: "P0002" });
    expect(errorMessage(error)).toBe(t("portal.newOrder.sibling.notFoundText"));
  });

  it("refuses a cancelled purchase", async () => {
    const { client } = fakeClient({
      orders: [{ ...rootRow, status_info: { stage: "cancelled" } }],
    });
    const error = await loadRootOrder(client, ROOT).catch((e: unknown) => e);
    expect(toAppError(error)).toMatchObject({ kind: "state", code: "55000" });
  });
});

describe("toTransportError() / fromTransportError()", () => {
  // A plain, serialisable object: thrown errors reach the browser with their
  // message only, so failures are returned as data.
  const roundTrip = (error: unknown) => {
    const sent = toTransportError(error);
    return { sent, received: fromTransportError(JSON.parse(JSON.stringify(sent))) };
  };

  it("sends only Dutch text: Postgres' own English messages are replaced", () => {
    const { sent, received } = roundTrip({
      code: "23514",
      message: 'new row for relation "orders" violates check constraint "orders_dates_check"',
      details: "Failing row contains (secret)",
    });
    expect(sent).toEqual({ message: t("apiError.invalidValue"), code: "23514", hint: null });
    expect(received).toBeInstanceOf(CodedError);
    expect(toAppError(received)).toMatchObject({ kind: "invalid", code: "23514" });
  });

  it("keeps the database's own Dutch messages", () => {
    const { received } = roundTrip({
      code: "22023",
      message: "Verzending per sea is op dit moment niet beschikbaar",
    });
    expect(errorMessage(received)).toBe("Verzending per sea is op dit moment niet beschikbaar");
  });

  it("keeps the server's own coded errors (parent order, validation)", () => {
    const { received } = roundTrip(
      new CodedError(t("portal.newOrder.sibling.cancelledText"), "55000"),
    );
    expect(toAppError(received)).toMatchObject({
      kind: "state",
      message: t("portal.newOrder.sibling.cancelledText"),
    });
  });

  it("gives an unknown failure the generic message", () => {
    const { sent, received } = roundTrip(new TypeError("x is undefined"));
    expect(sent).toEqual({ message: t("toast.genericError"), code: null, hint: null });
    expect(errorMessage(received)).toBe(t("toast.genericError"));
  });
});
