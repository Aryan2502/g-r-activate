import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every portal read filters on the signed-in customer explicitly, not only
 * through RLS (which shows staff every row): a login that is staff and still
 * has an active customer record must never see other customers' data as its
 * own. A recording stand-in for the Supabase client captures each query.
 */

type Call = [method: string, args: unknown[]];
interface Query {
  table: string;
  calls: Call[];
}

const queries: Query[] = [];
const tableData: Record<string, unknown[]> = {};

function builder(table: string) {
  const query: Query = { table, calls: [] };
  queries.push(query);
  const result = () => ({ data: tableData[table] ?? [], error: null });
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "then") {
          return (resolve: (value: unknown) => void) => resolve(result());
        }
        if (prop === "maybeSingle" || prop === "single") {
          return () => Promise.resolve({ data: null, error: null });
        }
        return (...args: unknown[]) => {
          query.calls.push([prop, args]);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => builder(table) },
}));

const { activityQueryOptions } = await import("./activity");
const { orderDocumentsQueryOptions } = await import("./documents");
const { invoiceSummaryQueryOptions, orderInvoicesQueryOptions } = await import("./invoices");
const { orderGroupQueryOptions, orderQueryOptions, ordersQueryOptions } = await import("./orders");

const USER = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "c0c0c0c0-0000-4000-8000-000000000001";
const ORDER = "a0000000-0000-4000-8000-000000000001";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any queryOptions() result
async function run(options: { queryFn?: any }) {
  await options.queryFn({});
}

const has = (q: Query, method: string, ...args: unknown[]) =>
  q.calls.some(([m, a]) => m === method && JSON.stringify(a) === JSON.stringify(args));

beforeEach(() => {
  queries.length = 0;
  for (const key of Object.keys(tableData)) delete tableData[key];
});

describe("portal queries filter on the customer", () => {
  it("orders: list, detail and the packages of a purchase", async () => {
    await run(ordersQueryOptions(USER, CUSTOMER));
    await run(orderQueryOptions(USER, CUSTOMER, ORDER));
    await run(orderGroupQueryOptions(USER, CUSTOMER, ORDER));
    expect(queries.map((q) => q.table)).toEqual(["orders", "orders", "orders"]);
    for (const q of queries) expect(has(q, "eq", "customer_id", CUSTOMER), q.table).toBe(true);
  });

  it("documents of an order", async () => {
    await run(orderDocumentsQueryOptions(USER, CUSTOMER, ORDER));
    expect(has(queries[0]!, "eq", "customer_id", CUSTOMER)).toBe(true);
  });

  it("invoices: the dashboard summary and an order's invoices (never drafts)", async () => {
    tableData["invoice_overview"] = [
      { id: "i1", status: "open", is_overdue: false, currency: "USD", balance_due: 10 },
    ];
    tableData["invoice_items"] = [{ invoice_id: "i1", order_id: ORDER }];
    await run(invoiceSummaryQueryOptions(USER, CUSTOMER));
    await run(orderInvoicesQueryOptions(USER, CUSTOMER, ORDER));
    const overview = queries.filter((q) => q.table === "invoice_overview");
    expect(overview).toHaveLength(2);
    for (const q of overview) expect(has(q, "eq", "customer_id", CUSTOMER)).toBe(true);
    expect(has(overview[1]!, "neq", "status", "draft")).toBe(true);
  });

  it("recent activity: history and payments through an inner join on their order / invoice", async () => {
    await run(activityQueryOptions(USER, CUSTOMER));
    const byTable = (table: string) => queries.filter((q) => q.table === table);
    expect(has(byTable("orders")[0]!, "eq", "customer_id", CUSTOMER)).toBe(true);
    const [history] = byTable("shipment_status_history");
    expect(history!.calls.find(([m]) => m === "select")?.[1][0]).toContain("orders!inner(");
    expect(has(history!, "eq", "order.customer_id", CUSTOMER)).toBe(true);
    const [payments] = byTable("payments");
    expect(payments!.calls.find(([m]) => m === "select")?.[1][0]).toContain("invoices!inner(");
    expect(has(payments!, "eq", "invoice.customer_id", CUSTOMER)).toBe(true);
    const invoices = byTable("invoice_overview");
    expect(invoices).toHaveLength(2);
    for (const q of invoices) expect(has(q, "eq", "customer_id", CUSTOMER)).toBe(true);
    // Cancellations are found by their own date.
    expect(invoices.some((q) => has(q, "order", "cancelled_at", { ascending: false }))).toBe(true);
  });
});
