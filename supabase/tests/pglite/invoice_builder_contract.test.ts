// @vitest-environment node
/**
 * P6 invoice builder against the real migrations: lib/admin/invoice-builder.ts
 * runs unchanged with a staff member's own client (a small supabase-js
 * stand-in turns its calls into SQL, each request its own committed
 * transaction as `authenticated`), so RLS, the column grants, the triggers
 * (totals, freight once per order, immutability) and the audit log behave as
 * in production. Then issue_invoice the way issueInvoiceFn calls it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Some app modules create the browser client on import; nothing here calls it.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  addOrder,
  deleteDraft,
  extraLine,
  initialBuilderState,
  loadBuilderOrders,
  loadDraft,
  saveDraft,
  stateFromDraft,
  toDraftForm,
  validateBuilder,
  withSavedIds,
  type BuilderState,
} from "@/lib/admin/invoice-builder";
import type { ServiceRate } from "@/lib/admin/settings";
import { toAppError } from "@/lib/errors";
import { todayInSuriname } from "@/lib/format";
import { computeInvoiceTotals } from "@/lib/invoice/totals";

import {
  type AuthUser,
  type Db,
  type Transaction,
  asUser,
  createAuthUser,
  createDb,
  withSavepoint,
} from "./harness";

type Row = Record<string, unknown>;
type DbResult = { data: unknown; error: unknown };
type Run = (sql: string, params: unknown[]) => Promise<{ rows: Row[] } | { error: unknown }>;

// ---------------------------------------------------------------------------
// supabase-js stand-in: the calls the builder makes
// ---------------------------------------------------------------------------

const IDENT = /^[a-z_][a-z0-9_]*$/;
const COLUMNS = /^\*$|^[a-z_][a-z0-9_]*(\s*,\s*[a-z_][a-z0-9_]*)*$/;
const ident = (name: string) => {
  if (!IDENT.test(name)) throw new Error(`bad identifier ${name}`);
  return name;
};
const columns = (list: string) => {
  if (!COLUMNS.test(list)) throw new Error(`bad columns ${list}`);
  return list;
};

class Query implements PromiseLike<DbResult> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private cols = "*";
  private returning: string | null = null;
  private values: Row[] = [];
  private where: string[] = [];
  private params: unknown[] = [];
  private orderBy: string[] = [];

  constructor(
    private readonly run: Run,
    private readonly table: string,
  ) {}

  select(list = "*") {
    if (this.op === "select") this.cols = columns(list);
    else this.returning = columns(list);
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.values = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(row: Row) {
    this.op = "update";
    this.values = [row];
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(c: string, v: unknown) {
    this.params.push(v);
    this.where.push(`${ident(c)} = $${this.params.length}`);
    return this;
  }
  in(c: string, v: unknown[]) {
    this.params.push(v);
    this.where.push(`${ident(c)} = any($${this.params.length})`);
    return this;
  }
  order(c: string, opts: { ascending?: boolean } = {}) {
    this.orderBy.push(`${ident(c)} ${opts.ascending === false ? "desc" : "asc"}`);
    return this;
  }

  private sql(): { sql: string; params: unknown[] } {
    const table = `public.${ident(this.table)}`;
    const returning = ` returning ${this.returning ?? "*"}`;
    if (this.op === "select") {
      const where = this.where.length ? ` where ${this.where.join(" and ")}` : "";
      const order = this.orderBy.length ? ` order by ${this.orderBy.join(", ")}` : "";
      return { sql: `select ${this.cols} from ${table}${where}${order}`, params: this.params };
    }
    if (this.op === "delete") {
      const where = this.where.length ? ` where ${this.where.join(" and ")}` : "";
      return { sql: `delete from ${table}${where}${returning}`, params: this.params };
    }
    const keys = [...new Set(this.values.flatMap((r) => Object.keys(r)))].map(ident);
    if (this.op === "insert") {
      const params: unknown[] = [];
      const tuples = this.values.map(
        (r) =>
          `(${keys
            .map((k) => {
              params.push(r[k] ?? null);
              return `$${params.length}`;
            })
            .join(", ")})`,
      );
      return {
        sql: `insert into ${table} (${keys.join(", ")}) values ${tuples.join(", ")}${returning}`,
        params,
      };
    }
    const row = this.values[0] ?? {};
    const shift = (s: string) =>
      s.replace(/\$(\d+)/g, (_, d: string) => `$${Number(d) + keys.length}`);
    const where = this.where.length ? ` where ${this.where.map(shift).join(" and ")}` : "";
    return {
      sql: `update ${table} set ${keys.map((k, i) => `${k} = $${i + 1}`).join(", ")}${where}${returning}`,
      params: [...keys.map((k) => row[k]), ...this.params],
    };
  }

  private rows() {
    const { sql, params } = this.sql();
    return this.run(sql, params);
  }

  async single(): Promise<DbResult> {
    const r = await this.rows();
    if ("error" in r) return { data: null, error: r.error };
    if (r.rows.length !== 1) return { data: null, error: { code: "PGRST116", message: "0 rows" } };
    return { data: r.rows[0], error: null };
  }

  async maybeSingle(): Promise<DbResult> {
    const r = await this.rows();
    if ("error" in r) return { data: null, error: r.error };
    return { data: r.rows[0] ?? null, error: null };
  }

  then<A = DbResult, B = never>(
    onfulfilled?: ((value: DbResult) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.rows()
      .then((r) => ("error" in r ? { data: null, error: r.error } : { data: r.rows, error: null }))
      .then(onfulfilled, onrejected);
  }
}

const NUMERIC_OID = 1700;
const DATE_OID = 1082;

/** Rows as PostgREST sends them: numeric as numbers, dates as 'YYYY-MM-DD', instants as ISO. */
function asJson(result: { rows: Row[]; fields: { name: string; dataTypeID: number }[] }): Row[] {
  const numeric = new Set(
    result.fields.filter((f) => f.dataTypeID === NUMERIC_OID).map((f) => f.name),
  );
  const dates = new Set(result.fields.filter((f) => f.dataTypeID === DATE_OID).map((f) => f.name));
  return result.rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value instanceof Date
          ? dates.has(key)
            ? value.toISOString().slice(0, 10)
            : value.toISOString()
          : numeric.has(key) && typeof value === "string"
            ? Number(value)
            : value,
      ]),
    ),
  );
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

function userClient(userId: string) {
  const run: Run = async (sql, params) => {
    try {
      const result = (await asUser(
        db,
        userId,
        (tx: Transaction) => withSavepoint(tx, () => tx.query<Row>(sql, params)),
        { commit: true },
      )) as { rows: Row[]; fields: { name: string; dataTypeID: number }[] };
      return { rows: asJson(result) };
    } catch (error) {
      return { error: pgError(error) };
    }
  };
  return {
    from: (table: string) => new Query(run, table),
    /** issue_invoice returns one invoices row: PostgREST sends it as an object. */
    async rpc(name: string, args: Record<string, unknown>): Promise<DbResult> {
      const keys = Object.keys(args).map(ident);
      const r = await run(
        `select * from public.${ident(name)}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`,
        keys.map((k) => args[k]),
      );
      if ("error" in r) return { data: null, error: r.error };
      return { data: r.rows[0] ?? null, error: null };
    },
  };
}

type AppClient = Parameters<typeof saveDraft>[0];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let db: Db;
let staff: AuthUser;
let alice: AuthUser;
let aliceCustomer: string;
let bobCustomer: string;
let client: AppClient & { rpc: ReturnType<typeof userClient>["rpc"] };
let rates: ServiceRate[];
const TODAY = todayInSuriname();

async function newOrder(
  customerId: string,
  measured: number | null,
  declared: number | null = null,
) {
  const r = await db.query<{ id: string }>(
    `insert into public.orders (customer_id, description, store_vendor, vendor_order_number, tracking_number, declared_weight_lbs)
     values ($1, 'Pakket', 'Amazon', '112-' || floor(random() * 100000)::text, '1Z' || floor(random() * 1e9)::text, $2) returning id`,
    [customerId, declared],
  );
  const id = r.rows[0]!.id;
  if (measured !== null) {
    await db.query("update public.orders set measured_weight_lbs = $1 where id = $2", [
      measured,
      id,
    ]);
  }
  return id;
}

beforeAll(async () => {
  db = await createDb();
  staff = await createAuthUser(db, { email: "staff@example.com" });
  await db.query("insert into public.user_roles (user_id, role) values ($1, 'staff')", [staff.id]);
  await db.query(
    `update public.customers set user_id = null, status = 'disabled', disabled_reason = 'bootstrap admin' where user_id = $1`,
    [staff.id],
  );
  alice = await createAuthUser(db, {
    email: "alice@example.com",
    meta: { full_name: "Alice Jansen", phone: "+597 8000001" },
  });
  const bob = await createAuthUser(db, {
    email: "bob@example.com",
    meta: { full_name: "Bob Bakker", phone: "+597 8000002" },
  });
  const ids = await db.query<{ id: string; user_id: string }>(
    "select id, user_id from public.customers where user_id = any($1)",
    [[alice.id, bob.id]],
  );
  aliceCustomer = ids.rows.find((r) => r.user_id === alice.id)!.id;
  bobCustomer = ids.rows.find((r) => r.user_id === bob.id)!.id;
  await db.query(
    "update public.service_rates set rate_per_lb = 4.5, weight_rounding = '0.5', minimum_billable_lbs = 1 where service_type = 'air'",
  );
  rates = (await db.query<ServiceRate>("select * from public.service_rates")).rows.map((r) => ({
    ...r,
    rate_per_lb: r.rate_per_lb === null ? null : Number(r.rate_per_lb),
    minimum_billable_lbs: r.minimum_billable_lbs === null ? null : Number(r.minimum_billable_lbs),
  }));
  client = userClient(staff.id) as unknown as typeof client;
});

afterAll(async () => {
  await db?.close();
});

function freshState(customerId: string): BuilderState {
  return initialBuilderState({ customerId, currency: "USD", paymentTermDays: 7, today: TODAY });
}

async function stored(invoiceId: string) {
  const r = await db.query<Row>(
    "select status, total_lbs, subtotal_freight, total_charges, total_discount, total_amount, customer_note, currency from public.invoices where id = $1",
    [invoiceId],
  );
  return r.rows[0];
}

// ---------------------------------------------------------------------------

describe("saving a draft with the staff member's own client", () => {
  it("prefills freight from the measured weight (rounded, minimum) and stores what the preview shows", async () => {
    const o1 = await newOrder(aliceCustomer, 2.34);
    const o2 = await newOrder(aliceCustomer, null, 0.4); // declared only, below the minimum
    const orders = await loadBuilderOrders(client, aliceCustomer);
    let s = freshState(aliceCustomer);
    s = addOrder(
      s,
      orders.find((o) => o.id === o1)!,
      rates,
    );
    s = addOrder(
      s,
      orders.find((o) => o.id === o2)!,
      rates,
    );
    expect(s.lines.map((l) => [l.weight, l.rate, l.weightNote?.kind])).toEqual([
      ["2,5", "4,5", "measured"],
      ["1", "4,5", "declared"],
    ]);
    s = {
      ...s,
      customerNote: "Pakket 2 volgt",
      lines: [
        ...s.lines,
        { ...extraLine("customs", o1), description: "Douane", amount: "25" },
        { ...extraLine("discount"), amount: "3,10" },
      ],
    };
    expect(validateBuilder(s, { orders, vatRate: null, mode: "issue" }).valid).toBe(true);

    const saved = await saveDraft(client, null, s);
    const preview = computeInvoiceTotals(toDraftForm(s, orders).lines, null);
    const row = await stored(saved.invoiceId);
    expect(row).toMatchObject({
      status: "draft",
      customer_note: "Pakket 2 volgt",
      currency: "USD",
    });
    expect({
      lbs: Number(row!["total_lbs"]),
      freight: Number(row!["subtotal_freight"]),
      charges: Number(row!["total_charges"]),
      discount: Number(row!["total_discount"]),
      total: Number(row!["total_amount"]),
    }).toEqual({
      lbs: preview.totalLbs,
      freight: preview.subtotalFreight,
      charges: preview.totalCharges,
      discount: preview.totalDiscount,
      total: preview.totalAmount,
    });
    expect(preview.totalAmount).toBe(11.25 + 4.5 + 25 - 3.1);
    expect(Object.keys(saved.lineIds)).toHaveLength(4);

    // Read back: the same form (lines in order, ids kept, discount positive in the form).
    const draft = await loadDraft(client, saved.invoiceId);
    const again = stateFromDraft(draft!.invoice, draft!.items, orders, rates, 7);
    expect(again.lines.map((l) => [l.lineType, l.weight, l.rate, l.amount, l.orderId])).toEqual([
      ["freight", "2,5", "4,5", "", o1],
      ["freight", "1", "4,5", "", o2],
      ["customs", "", "", "25", o1],
      ["discount", "", "", "3,1", null],
    ]);
    expect(again.lines[2]?.vatExempt).toBe(true);

    // The order list now knows these orders' freight sits on this draft (for other invoices).
    const elsewhere = await loadBuilderOrders(client, aliceCustomer);
    expect(elsewhere.find((o) => o.id === o1)?.freightOn).toEqual({
      invoiceId: saved.invoiceId,
      invoiceNumber: null,
    });
    const here = await loadBuilderOrders(client, aliceCustomer, saved.invoiceId);
    expect(here.find((o) => o.id === o1)?.freightOn).toBeNull();
  });

  it("editing removes, updates and adds lines in place; reordering is kept", async () => {
    const o1 = await newOrder(aliceCustomer, 5);
    const o2 = await newOrder(aliceCustomer, 6);
    const o3 = await newOrder(aliceCustomer, 7);
    let orders = await loadBuilderOrders(client, aliceCustomer);
    let s = freshState(aliceCustomer);
    for (const id of [o1, o2])
      s = addOrder(
        s,
        orders.find((o) => o.id === id)!,
        rates,
      );
    const first = await saveDraft(client, null, s);
    s = withSavedIds(s, first.lineIds);
    const keptIds = s.lines.map((l) => l.id);

    orders = await loadBuilderOrders(client, aliceCustomer, first.invoiceId);
    // Drop o1, change o2's weight, add o3 and a handling line, then move handling first.
    s = {
      ...s,
      orderIds: s.orderIds.filter((id) => id !== o1),
      lines: s.lines.filter((l) => l.orderId !== o1),
    };
    s = { ...s, lines: s.lines.map((l) => ({ ...l, weight: "6,5" })) };
    s = addOrder(
      s,
      orders.find((o) => o.id === o3)!,
      rates,
    );
    const handling = { ...extraLine("handling"), description: "Handling", amount: "10" };
    s = { ...s, lines: [handling, ...s.lines], dueDate: "2099-12-31", dueTouched: true };
    const second = await saveDraft(client, first.invoiceId, s);
    expect(second.invoiceId).toBe(first.invoiceId);

    const draft = await loadDraft(client, first.invoiceId);
    expect(draft!.invoice.due_date).toBe("2099-12-31");
    expect(
      draft!.items.map((i) => [i.line_type, i.order_id, Number(i.weight_lbs ?? 0), i.sort_order]),
    ).toEqual([
      ["handling", null, 0, 0],
      ["freight", o2, 6.5, 1],
      ["freight", o3, 7, 2],
    ]);
    // o2's line was updated, not replaced; o1's line is gone.
    expect(draft!.items.find((i) => i.order_id === o2)?.id).toBe(keptIds[1]);
    expect(draft!.items.some((i) => i.id === keptIds[0])).toBe(false);
    expect(Number((await stored(first.invoiceId))!["total_amount"])).toBe(10 + 29.25 + 31.5);
  });

  it("an edit whose final total is valid is saved, even when a naive write order would dip below 0", async () => {
    // Each request commits on its own and the totals trigger refuses any
    // negative moment, so saveDraft orders its writes (discounts out of the
    // way first, back in last).
    const o = await newOrder(aliceCustomer, 10); // 10 lbs × 4,5 = 45
    let orders = await loadBuilderOrders(client, aliceCustomer);
    let s = addOrder(
      freshState(aliceCustomer),
      orders.find((x) => x.id === o)!,
      rates,
    );
    s = {
      ...s,
      lines: [
        ...s.lines,
        { ...extraLine("customs"), description: "Douane", amount: "50" },
        { ...extraLine("discount"), amount: "60" },
      ],
    };
    const first = await saveDraft(client, null, s);
    s = withSavedIds(s, first.lineIds);
    expect(Number((await stored(first.invoiceId))!["total_amount"])).toBe(35);
    orders = await loadBuilderOrders(client, aliceCustomer, first.invoiceId);

    // 1. Drop customs and lower the discount to 40 (final 5): deleting customs
    //    first would make it 45 − 60 < 0.
    s = {
      ...s,
      lines: s.lines
        .filter((l) => l.lineType !== "customs")
        .map((l) => (l.lineType === "discount" ? { ...l, amount: "40" } : l)),
    };
    expect(validateBuilder(s, { orders, vatRate: null, mode: "issue" }).valid).toBe(true);
    const second = await saveDraft(client, first.invoiceId, s);
    s = withSavedIds(s, second.lineIds);
    expect(Number((await stored(first.invoiceId))!["total_amount"])).toBe(5);

    // 2. Raise the freight (20 lbs = 90) and the discount (80): final 10.
    s = {
      ...s,
      lines: s.lines.map((l) =>
        l.lineType === "freight"
          ? { ...l, weight: "20" }
          : l.lineType === "discount"
            ? { ...l, amount: "80" }
            : l,
      ),
    };
    await saveDraft(client, first.invoiceId, s);
    expect(Number((await stored(first.invoiceId))!["total_amount"])).toBe(10);

    // 3. Lower the freight below the stored discount (10 lbs = 45) and the
    //    discount to 40 (final 5): updating the freight first would give 45 − 80 < 0.
    //    Plus a second, new discount line of 2 (final 3).
    s = {
      ...s,
      lines: [
        ...s.lines.map((l) =>
          l.lineType === "freight"
            ? { ...l, weight: "10" }
            : l.lineType === "discount"
              ? { ...l, amount: "40" }
              : l,
        ),
        { ...extraLine("discount"), amount: "2" },
      ],
    };
    const third = await saveDraft(client, first.invoiceId, s);
    const row = await stored(first.invoiceId);
    expect([Number(row!["total_amount"]), Number(row!["total_discount"])]).toEqual([3, 42]);
    const draft = await loadDraft(client, first.invoiceId);
    expect(draft!.items.map((i) => [i.line_type, Number(i.amount)])).toEqual([
      ["freight", 45],
      ["discount", -40],
      ["discount", -2],
    ]);
    expect(Object.keys(third.lineIds)).toHaveLength(3);
  });

  it("freight is billed once: a second draft for the same order is refused in Dutch, and leaves nothing behind", async () => {
    const o = await newOrder(aliceCustomer, 3);
    const orders = await loadBuilderOrders(client, aliceCustomer);
    const s = addOrder(
      freshState(aliceCustomer),
      orders.find((x) => x.id === o)!,
      rates,
    );
    await saveDraft(client, null, s);
    const count = async () =>
      Number(
        (
          await db.query<{ n: string }>(
            "select count(*) n from public.invoices where customer_id = $1",
            [aliceCustomer],
          )
        ).rows[0]!.n,
      );
    const before = await count();
    for (let i = 0; i < 2; i += 1) {
      const err = await saveDraft(client, null, s).then(
        () => null,
        (e: unknown) => toAppError(e),
      );
      expect(err?.code).toBe("23505");
      expect(err?.message).toMatch(/^De vracht van order ORD-\d{4}-\d{5} staat al op een concept$/);
    }
    // The refused first save removed its empty invoice row again (no orphan drafts).
    expect(await count()).toBe(before);
  });

  it("another customer's order is refused by the database too", async () => {
    const bobs = await newOrder(bobCustomer, 2);
    const orders = await loadBuilderOrders(client, bobCustomer);
    const s = addOrder(
      freshState(aliceCustomer),
      orders.find((o) => o.id === bobs)!,
      rates,
    );
    // The form says so first …
    expect(
      validateBuilder(s, {
        orders: await loadBuilderOrders(client, aliceCustomer),
        vatRate: null,
        mode: "draft",
      }).valid,
    ).toBe(false);
    // … and the database refuses it anyway.
    const err = await saveDraft(client, null, s).then(
      () => null,
      (e: unknown) => toAppError(e),
    );
    expect(err?.code).toBe("22023");
    expect(err?.message).toBe("Deze order hoort niet bij de klant van de factuur");
  });
});

describe("issuing (what issueInvoiceFn does) and afterwards", () => {
  it("issue_invoice numbers it; the draft can no longer be saved or deleted, and its freight stays billed", async () => {
    const o = await newOrder(aliceCustomer, 4);
    const orders = await loadBuilderOrders(client, aliceCustomer);
    let s = addOrder(
      freshState(aliceCustomer),
      orders.find((x) => x.id === o)!,
      rates,
    );
    const saved = await saveDraft(client, null, s);
    s = withSavedIds(s, saved.lineIds);

    const { data, error } = await client.rpc("issue_invoice", { _invoice_id: saved.invoiceId });
    expect(error).toBeNull();
    const row = data as { invoice_number: string; status: string; total_amount: number };
    expect(row.status).toBe("open");
    expect(row.invoice_number).toMatch(new RegExp(`^INV-${TODAY.slice(0, 4)}-\\d{4}$`));
    expect(Number(row.total_amount)).toBe(18);

    const edit = await saveDraft(client, saved.invoiceId, { ...s, customerNote: "te laat" }).then(
      () => null,
      (e: unknown) => toAppError(e),
    );
    expect(edit?.code).toBe("55000");
    const del = await deleteDraft(client, saved.invoiceId).then(
      () => null,
      (e: unknown) => toAppError(e),
    );
    expect(del?.code).toBe("55000");

    const after = await loadBuilderOrders(client, aliceCustomer);
    expect(after.find((x) => x.id === o)?.freightOn).toEqual({
      invoiceId: saved.invoiceId,
      invoiceNumber: row.invoice_number,
    });
  });

  it("issue_invoice refuses old dates with the invoice_dates hint ('Datums bijwerken')", async () => {
    const o = await newOrder(aliceCustomer, 1);
    const orders = await loadBuilderOrders(client, aliceCustomer);
    const s = {
      ...addOrder(
        freshState(aliceCustomer),
        orders.find((x) => x.id === o)!,
        rates,
      ),
      invoiceDate: "2020-01-02",
      dueDate: "2020-01-09",
    };
    const saved = await saveDraft(client, null, s);
    const { error } = await client.rpc("issue_invoice", { _invoice_id: saved.invoiceId });
    const app = toAppError(error);
    expect(app.code).toBe("55000");
    expect(app.hint).toBe("invoice_dates");
  });

  it("a draft can be deleted, which frees its orders' freight", async () => {
    const o = await newOrder(aliceCustomer, 2);
    const orders = await loadBuilderOrders(client, aliceCustomer);
    const s = addOrder(
      freshState(aliceCustomer),
      orders.find((x) => x.id === o)!,
      rates,
    );
    const saved = await saveDraft(client, null, s);
    await deleteDraft(client, saved.invoiceId);
    expect(await loadDraft(client, saved.invoiceId)).toBeNull();
    const after = await loadBuilderOrders(client, aliceCustomer);
    expect(after.find((x) => x.id === o)?.freightOn).toBeNull();
    // Deleting again: nothing there (not a silent success).
    const again = await deleteDraft(client, saved.invoiceId).then(
      () => null,
      (e: unknown) => toAppError(e),
    );
    expect(again?.code).toBe("P0002");
  });

  it("a customer cannot use the builder's writes (RLS: staff only)", async () => {
    const customer = userClient(alice.id) as unknown as AppClient;
    const err = await saveDraft(customer, null, freshState(aliceCustomer)).then(
      () => null,
      (e: unknown) => toAppError(e),
    );
    expect(err?.code).toBe("42501");
  });
});
