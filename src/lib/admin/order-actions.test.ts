import { afterAll, describe, expect, it, vi } from "vitest";

import { CodedError, toAppError } from "@/lib/errors";
import { t } from "@/lib/i18n";

import {
  changeOrderStatus,
  changeStatusInputSchema,
  createOrderForCustomer,
  createOrderInputSchema,
  keepOrderAfterCancellation,
  parseActionInput,
  pickUpOrders,
  pickupInputSchema,
  planStatusEmails,
  receiveInputSchema,
  receiveOrder,
  summarizeStatusChange,
  weightFromText,
} from "./order-actions";

vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-10-07T15:00:00Z"));
afterAll(() => {
  vi.useRealTimers();
});

const A = "a0000000-0000-4000-8000-000000000001";
const B = "a0000000-0000-4000-8000-000000000002";
const C = "a0000000-0000-4000-8000-000000000003";
const CUSTOMER = "c0c0c0c0-0000-4000-8000-000000000001";
const OTHER = "c0c0c0c0-0000-4000-8000-000000000002";

type Row = Record<string, unknown>;

/** A recording fake of the supabase-js calls the actions make. */
function fakeClient({
  rpcData = [] as Row[],
  rpcError = null as unknown,
  status = {
    code: "in_transit",
    customer_visible: true,
    notify_customer: true,
    stage: "in_transit",
  } as Row | null,
  orders = [] as Row[],
  insertResult = { data: { id: "new-id", reference: "ORD-2026-00099" }, error: null } as {
    data: unknown;
    error: unknown;
  },
} = {}) {
  const calls: { op: string; name?: string; table?: string; args?: unknown }[] = [];
  const client = {
    rpc: vi.fn((name: string, args: unknown) => {
      calls.push({ op: "rpc", name, args });
      return Promise.resolve({ data: rpcData, error: rpcError });
    }),
    from: vi.fn((table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => ({
          maybeSingle: () => {
            calls.push({ op: "select", table, args: { columns, column, value } });
            if (table === "shipment_statuses")
              return Promise.resolve({ data: status, error: null });
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
          select: () => ({ single: () => Promise.resolve(insertResult) }),
        };
      },
    })),
  };
  return { client: client as unknown as Parameters<typeof changeOrderStatus>[0], calls };
}

describe("input schemas", () => {
  it("change: 1–1000 order ids, a status code, empty texts become null", () => {
    const parsed = changeStatusInputSchema.parse({
      orderIds: [A, B],
      toStatus: "in_transit",
      customerMessage: "   ",
      pickedUpByName: "",
      notifyCustomer: true,
    });
    expect(parsed).toEqual({
      orderIds: [A, B],
      toStatus: "in_transit",
      customerMessage: null,
      pickedUpByName: null,
      notifyCustomer: true,
    });
    for (const bad of [
      { orderIds: [], toStatus: "in_transit", notifyCustomer: false },
      { orderIds: ["x"], toStatus: "in_transit", notifyCustomer: false },
      { orderIds: [A], toStatus: "In Transit", notifyCustomer: false },
      {
        orderIds: [A],
        toStatus: "in_transit",
        customerMessage: "x".repeat(2001),
        notifyCustomer: false,
      },
    ]) {
      expect(changeStatusInputSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 60)).toBe(
        false,
      );
    }
  });

  it("pickup: the collector's name is required", () => {
    const base = { orderIds: [A], toStatus: "picked_up", notifyCustomer: false };
    expect(pickupInputSchema.safeParse({ ...base, pickedUpByName: " " }).success).toBe(false);
    expect(
      pickupInputSchema.parse({ ...base, pickedUpByName: " Jan ", overrideReason: "" }),
    ).toMatchObject({
      pickedUpByName: "Jan",
      overrideReason: null,
    });
  });

  it("receive: a weight above 0 with at most 2 decimals, Dutch or English mark", () => {
    expect(receiveInputSchema.safeParse({ orderId: A, measuredWeightLbs: "2,5" }).success).toBe(
      true,
    );
    expect(weightFromText("1.234,56")).toBe(1234.56);
    expect(weightFromText("")).toBeNull();
    for (const bad of ["", "0", "-1", "2,555", "abc"]) {
      expect(
        receiveInputSchema.safeParse({ orderId: A, measuredWeightLbs: bad }).success,
        bad,
      ).toBe(false);
    }
  });

  it("create: the order fields of 'Gegevens wijzigen' plus an optional weight", () => {
    const input = {
      customerId: CUSTOMER,
      parentOrderId: null,
      measuredWeightLbs: "",
      fields: {
        orderType: "personal",
        serviceType: "sea",
        storeVendor: "Amazon",
        vendorOrderNumber: "",
        description: "Doos",
        quantity: "1",
        estimatedValue: "",
        estimatedValueCurrency: "USD",
        purchaseDate: "",
        expectedDeliveryDate: "",
        trackingNumber: "1Z 999",
        carrier: "",
        declaredWeightLbs: "",
        customerNote: "",
        supplierName: "",
        clientPoNumber: "",
        purchaseMode: "",
      },
    };
    expect(createOrderInputSchema.safeParse(input).success).toBe(true);
    expect(
      createOrderInputSchema.safeParse({ ...input, fields: { ...input.fields, description: "" } })
        .success,
    ).toBe(false);
    expect(createOrderInputSchema.safeParse({ ...input, measuredWeightLbs: "0" }).success).toBe(
      false,
    );
  });

  it("parseActionInput() answers a tampered request with one Dutch 22023 message", () => {
    let error: unknown = null;
    try {
      parseActionInput(receiveInputSchema, { orderId: "x" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CodedError);
    expect(toAppError(error)).toMatchObject({ code: "22023", message: t("admin.actions.invalid") });
  });
});

describe("planStatusEmails() (SPEC §35.12)", () => {
  const rows = [
    { order_id: A, customer_id: CUSTOMER, history_id: 1, notify: true },
    { order_id: B, customer_id: CUSTOMER, history_id: 2, notify: true },
    { order_id: C, customer_id: OTHER, history_id: null, notify: false },
  ];

  it("at most one e-mail per customer, only for orders that changed", () => {
    expect(planStatusEmails(rows, { notify: true, customerVisible: true })).toEqual([
      { customerId: CUSTOMER, orderIds: [A, B], historyIds: [1, 2] },
    ]);
  });

  it("nothing when staff switched it off or the customer cannot see the status", () => {
    expect(planStatusEmails(rows, { notify: false, customerVisible: true })).toEqual([]);
    expect(planStatusEmails(rows, { notify: true, customerVisible: false })).toEqual([]);
  });

  it("summarizeStatusChange() splits changed from already-there", () => {
    expect(summarizeStatusChange(rows)).toMatchObject({ changed: [A, B], unchanged: [C] });
  });
});

describe("changeOrderStatus()", () => {
  it("makes ONE change_order_status call for the whole selection, without empty optional args", async () => {
    const { client, calls } = fakeClient({
      rpcData: [
        { order_id: A, customer_id: CUSTOMER, history_id: 10, notify: true },
        { order_id: B, customer_id: OTHER, history_id: 11, notify: true },
      ],
    });
    const result = await changeOrderStatus(
      client,
      changeStatusInputSchema.parse({
        orderIds: [A, B],
        toStatus: "in_transit",
        customerMessage: "",
        notifyCustomer: true,
      }),
    );
    const rpcCalls = calls.filter((c) => c.op === "rpc");
    expect(rpcCalls).toEqual([
      {
        op: "rpc",
        name: "change_order_status",
        args: { _order_ids: [A, B], _to_status: "in_transit" },
      },
    ]);
    expect(result.changed).toEqual([A, B]);
    expect(result.emails).toHaveLength(2);
  });

  it("passes the message and the collector, and rethrows the database's refusal with its hint", async () => {
    const refusal = {
      code: "55000",
      message:
        "Nog niet betaald: ORD-2026-00001 (INV-2026-0001). Laat eerst betalen of geef af met een reden.",
      hint: "pay_before_pickup",
      details: null,
    };
    const { client, calls } = fakeClient({ rpcData: [], rpcError: refusal });
    const error = await changeOrderStatus(
      client,
      changeStatusInputSchema.parse({
        orderIds: [A],
        toStatus: "picked_up",
        customerMessage: " Fijne dag ",
        pickedUpByName: "Jan",
        notifyCustomer: false,
      }),
    ).catch((e) => e);
    expect(calls[0]?.args).toEqual({
      _order_ids: [A],
      _to_status: "picked_up",
      _customer_message: "Fijne dag",
      _picked_up_by_name: "Jan",
    });
    expect(toAppError(error)).toMatchObject({ kind: "state", hint: "pay_before_pickup" });
  });
});

describe("pickUpOrders()", () => {
  const base = {
    orderIds: [A],
    toStatus: "picked_up",
    pickedUpByName: "Jan",
    notifyCustomer: false,
  };

  it("without a reason it is a normal status change", async () => {
    const { client, calls } = fakeClient({ rpcData: [] });
    await pickUpOrders(client, pickupInputSchema.parse(base));
    expect(calls[0]?.name).toBe("change_order_status");
  });

  it("with a reason it calls pickup_override (audited)", async () => {
    const { client, calls } = fakeClient({
      rpcData: [{ order_id: A, customer_id: CUSTOMER, history_id: 5, notify: false }],
    });
    const result = await pickUpOrders(
      client,
      pickupInputSchema.parse({ ...base, overrideReason: "Betaalt morgen contant" }),
    );
    expect(calls[0]).toEqual({
      op: "rpc",
      name: "pickup_override",
      args: {
        _order_ids: [A],
        _to_status: "picked_up",
        _picked_up_by_name: "Jan",
        _reason: "Betaalt morgen contant",
      },
    });
    expect(result.changed).toEqual([A]);
  });
});

describe("receiveOrder()", () => {
  it("calls receive_order with the number and mails per the status's own notify flag", async () => {
    const { client, calls } = fakeClient({
      rpcData: [{ order_id: A, customer_id: CUSTOMER, history_id: 3, notify: true }],
    });
    const result = await receiveOrder(client, { orderId: A, measuredWeightLbs: 2.5 });
    expect(calls[0]).toEqual({
      op: "rpc",
      name: "receive_order",
      args: { _order_id: A, _measured_weight_lbs: 2.5 },
    });
    expect(result.emails).toEqual([{ customerId: CUSTOMER, orderIds: [A], historyIds: [3] }]);
  });

  it("a weight correction changes no status and mails nobody", async () => {
    const { client } = fakeClient({
      rpcData: [{ order_id: A, customer_id: CUSTOMER, history_id: null, notify: false }],
    });
    const result = await receiveOrder(client, { orderId: A, measuredWeightLbs: 3 });
    expect(result).toMatchObject({ changed: [], unchanged: [A], emails: [] });
  });
});

describe("createOrderForCustomer()", () => {
  const fields = {
    orderType: "personal",
    serviceType: "air",
    storeVendor: "Amazon",
    vendorOrderNumber: "",
    description: "Doos",
    quantity: "2",
    estimatedValue: "",
    estimatedValueCurrency: "USD",
    purchaseDate: "",
    expectedDeliveryDate: "",
    trackingNumber: "TBA123",
    carrier: "Amazon Logistics",
    declaredWeightLbs: "",
    customerNote: "",
    supplierName: "",
    clientPoNumber: "",
    purchaseMode: "",
  };

  it("inserts the customer-editable columns for the chosen customer; the database sets the rest", async () => {
    const { client, calls } = fakeClient();
    const created = await createOrderForCustomer(
      client,
      createOrderInputSchema.parse({
        customerId: CUSTOMER,
        fields,
        parentOrderId: null,
        measuredWeightLbs: "",
      }),
    );
    const insert = calls.find((c) => c.op === "insert");
    expect(insert?.table).toBe("orders");
    const row = insert?.args as Row;
    expect(row).toMatchObject({
      customer_id: CUSTOMER,
      parent_order_id: null,
      quantity: 2,
      tracking_number: "TBA123",
      store_vendor: "Amazon",
    });
    // Never server-owned columns: status, reference, created_by_role, receiving.
    for (const column of [
      "status",
      "reference",
      "created_by_role",
      "received_at",
      "measured_weight_lbs",
    ]) {
      expect(row, column).not.toHaveProperty(column);
    }
    expect(created).toEqual({
      id: "new-id",
      reference: "ORD-2026-00099",
      customerId: CUSTOMER,
      parentOrderId: null,
    });
  });

  it("an extra package follows a child to its root and takes over its purchase details", async () => {
    const root = {
      id: A,
      parent_order_id: null,
      customer_id: CUSTOMER,
      order_type: "b2b",
      store_vendor: "Alibaba",
      vendor_order_number: "PO-1",
    };
    const child = { ...root, id: B, parent_order_id: A };
    const { client, calls } = fakeClient({ orders: [root, child] });
    await createOrderForCustomer(
      client,
      createOrderInputSchema.parse({
        customerId: CUSTOMER,
        fields,
        parentOrderId: B,
        measuredWeightLbs: "",
      }),
    );
    expect(calls.find((c) => c.op === "insert")?.args).toMatchObject({
      parent_order_id: A,
      order_type: "b2b",
      store_vendor: "Alibaba",
      vendor_order_number: "PO-1",
    });
  });

  it("refuses a root order of another customer", async () => {
    const { client, calls } = fakeClient({
      orders: [{ id: A, parent_order_id: null, customer_id: OTHER, order_type: "personal" }],
    });
    const error = await createOrderForCustomer(
      client,
      createOrderInputSchema.parse({
        customerId: CUSTOMER,
        fields,
        parentOrderId: A,
        measuredWeightLbs: "",
      }),
    ).catch((e) => e);
    expect(toAppError(error)).toMatchObject({
      code: "22023",
      message: t("admin.newOrder.parentMismatch"),
    });
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });
});

describe("keepOrderAfterCancellation() ('Order behouden')", () => {
  function keepClient(rpcError: { code: string; message: string } | null) {
    const updates: { table: string; values: Row; filters: [string, unknown][] }[] = [];
    const client = {
      rpc: vi.fn(() => Promise.resolve({ data: null, error: rpcError })),
      from: vi.fn((table: string) => ({
        update: (values: Row) => {
          const entry = { table, values, filters: [] as [string, unknown][] };
          updates.push(entry);
          const chain = {
            eq: (c: string, v: unknown) => (entry.filters.push([c, v]), chain),
            is: (c: string, v: unknown) => (entry.filters.push([c, v]), chain),
            select: () => ({ single: () => Promise.resolve({ data: { id: "t1" }, error: null }) }),
          };
          return chain;
        },
      })),
    };
    return {
      client: client as unknown as Parameters<typeof keepOrderAfterCancellation>[0],
      updates,
      rpc: client.rpc,
    };
  }

  it("calls the guarded RPC with the order only", async () => {
    const { client, rpc, updates } = keepClient(null);
    expect(await keepOrderAfterCancellation(client, { orderId: A, taskId: "t1" })).toEqual({
      cleared: true,
    });
    expect(rpc).toHaveBeenCalledWith("keep_order_after_cancellation_request", { _order_id: A });
    expect(updates).toEqual([]);
  });

  it("passes the message for the customer, trimmed; a blank one leaves the database's default", async () => {
    const { client, rpc } = keepClient(null);
    await keepOrderAfterCancellation(client, {
      orderId: A,
      taskId: "t1",
      customerMessage: "  Het pakket is al onderweg.  ",
    });
    expect(rpc).toHaveBeenLastCalledWith("keep_order_after_cancellation_request", {
      _order_id: A,
      _customer_message: "Het pakket is al onderweg.",
    });
    await keepOrderAfterCancellation(client, { orderId: A, taskId: "t1", customerMessage: "  " });
    expect(rpc).toHaveBeenLastCalledWith("keep_order_after_cancellation_request", {
      _order_id: A,
    });
  });

  it("before the P5 migration is applied (PGRST202) it only resolves the task, as in P4", async () => {
    const { client, updates } = keepClient({
      code: "PGRST202",
      message: "Could not find the function",
    });
    expect(await keepOrderAfterCancellation(client, { orderId: A, taskId: "t1" })).toEqual({
      cleared: false,
    });
    expect(updates).toEqual([
      {
        table: "staff_tasks",
        values: { resolved_at: "2026-10-07T15:00:00.000Z" },
        filters: [
          ["id", "t1"],
          ["resolved_at", null],
        ],
      },
    ]);
  });

  it("passes the database's refusals on (42501, 55000)", async () => {
    for (const code of ["42501", "55000"]) {
      const { client, updates } = keepClient({ code, message: "Nee" });
      const error = await keepOrderAfterCancellation(client, { orderId: A, taskId: "t1" }).catch(
        (e: unknown) => e,
      );
      expect(toAppError(error).code).toBe(code);
      expect(updates).toEqual([]);
    }
  });
});
