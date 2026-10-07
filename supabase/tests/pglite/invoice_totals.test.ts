// @vitest-environment node
/**
 * TS == SQL for invoice totals (SPEC §35.9): computeInvoiceTotals() in
 * src/lib/invoice/totals.ts drives the builder's live preview, the database
 * (private.recompute_invoice_totals + invoice_items_guard) stores the real
 * totals. Hundreds of generated invoices, plus hand-picked rounding edges,
 * are written through the real triggers as a signed-in admin (each in its own
 * rolled-back request) and their stored totals must equal the TS result to
 * the cent: freight amounts, total_lbs, subtotal_freight, total_charges,
 * total_discount, total_amount and the BTW-inclusive vat_amount, also after
 * issue_invoice re-reads the live VAT rate, and the same refusal when a
 * discount pushes the total below zero.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  computeInvoiceTotals,
  freightAmount,
  type InvoiceLineType,
  type TotalsLine,
} from "@/lib/invoice/totals";

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

let db: Db;
let admin: AuthUser;
let customerId: string;
const orderIds: string[] = [];
const MAX_FREIGHT = 6;

beforeAll(async () => {
  db = await createDb();
  admin = await createAuthUser(db, { email: "admin@example.com" });
  await db.query("insert into public.user_roles (user_id, role) values ($1, 'admin')", [admin.id]);
  await db.query(
    `update public.customers set user_id = null, status = 'disabled', disabled_reason = 'bootstrap admin'
      where user_id = $1`,
    [admin.id],
  );
  const alice = await createAuthUser(db, {
    email: "alice@example.com",
    meta: { full_name: "Alice Jansen", phone: "+597 8000001" },
  });
  const c = await db.query<{ id: string }>("select id from public.customers where user_id = $1", [
    alice.id,
  ]);
  customerId = c.rows[0]!.id;
  for (let i = 0; i < MAX_FREIGHT; i++) {
    const o = await db.query<{ id: string }>(
      "insert into public.orders (customer_id, description, store_vendor, vendor_order_number) values ($1, 'Pakket', 'Amazon', $2) returning id",
      [customerId, `112-${i}`],
    );
    orderIds.push(o.rows[0]!.id);
  }
});

afterAll(async () => {
  await db?.close();
});

// ---------------------------------------------------------------------------
// Generated invoices (seeded, so a failure reproduces)
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 2-decimal value in [min, max] as text, the way numeric(…, 2) holds it. */
function cents(rand: () => number, min: number, max: number): string {
  const lo = Math.round(min * 100);
  const hi = Math.round(max * 100);
  const n = lo + Math.floor(rand() * (hi - lo + 1));
  return (n / 100).toFixed(2);
}

interface CaseLine extends TotalsLine {
  orderId: string | null;
}

interface Case {
  vatRate: string | null;
  lines: CaseLine[];
}

const OTHER_TYPES: InvoiceLineType[] = ["customs", "handling", "goods", "service_fee", "other"];
const VAT_RATES = [null, null, "0", "5", "8", "10", "12.5", "21", "99.99", "100"];

function generate(rand: () => number): Case {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
  const vatRate = rand() < 0.2 ? cents(rand, 0, 100) : pick(VAT_RATES);
  const lines: CaseLine[] = [];
  const freightCount = Math.floor(rand() * (MAX_FREIGHT + 1));
  for (let i = 0; i < freightCount; i++) {
    const small = rand() < 0.3;
    lines.push({
      lineType: "freight",
      orderId: orderIds[i] ?? null,
      weightLbs: small ? cents(rand, 0.01, 2) : cents(rand, 0.01, 800),
      ratePerLb: rand() < 0.1 ? "0.00" : small ? cents(rand, 0, 1) : cents(rand, 0, 99.99),
      vatExempt: rand() < 0.5,
    });
  }
  const others = Math.floor(rand() * 5);
  for (let i = 0; i < others; i++) {
    const type = pick(OTHER_TYPES);
    lines.push({
      lineType: type,
      orderId: rand() < 0.3 ? pick(orderIds) : null,
      amount: rand() < 0.1 ? "0.00" : cents(rand, 0, 2500),
      vatExempt: type === "customs" ? rand() < 0.8 : rand() < 0.3,
    });
  }
  const discounts = rand() < 0.4 ? 1 + Math.floor(rand() * 2) : 0;
  for (let i = 0; i < discounts; i++) {
    lines.push({
      lineType: "discount",
      orderId: null,
      amount: `-${cents(rand, 0, rand() < 0.15 ? 5000 : 60)}`,
      vatExempt: rand() < 0.5,
    });
  }
  if (lines.length === 0) {
    lines.push({
      lineType: "handling",
      orderId: null,
      amount: cents(rand, 0, 50),
      vatExempt: false,
    });
  }
  return { vatRate, lines };
}

// Hand-picked rounding edges: half cents in freight and in the BTW split.
const EDGE_CASES: Case[] = [
  {
    vatRate: null,
    lines: [
      {
        lineType: "freight",
        orderId: null,
        weightLbs: "2.15",
        ratePerLb: "3.50",
        vatExempt: false,
      },
      {
        lineType: "freight",
        orderId: null,
        weightLbs: "0.01",
        ratePerLb: "0.50",
        vatExempt: false,
      },
      {
        lineType: "freight",
        orderId: null,
        weightLbs: "0.01",
        ratePerLb: "0.49",
        vatExempt: false,
      },
      {
        lineType: "freight",
        orderId: null,
        weightLbs: "1.01",
        ratePerLb: "0.05",
        vatExempt: false,
      },
    ],
  },
  {
    vatRate: "100",
    lines: [{ lineType: "goods", orderId: null, amount: "1.05", vatExempt: false }],
  },
  {
    vatRate: "10",
    lines: [
      { lineType: "customs", orderId: null, amount: "100.00", vatExempt: true },
      { lineType: "discount", orderId: null, amount: "-20.00", vatExempt: false },
    ],
  },
  {
    vatRate: "0.01",
    lines: [{ lineType: "service_fee", orderId: null, amount: "99999.99", vatExempt: false }],
  },
  {
    vatRate: "33.33",
    lines: [
      {
        lineType: "freight",
        orderId: null,
        weightLbs: "799.99",
        ratePerLb: "99.99",
        vatExempt: false,
      },
      { lineType: "other", orderId: null, amount: "0.01", vatExempt: false },
      { lineType: "discount", orderId: null, amount: "-0.01", vatExempt: false },
    ],
  },
];

// ---------------------------------------------------------------------------
// Writing a case through the real triggers
// ---------------------------------------------------------------------------

interface SqlTotals {
  total_lbs: string;
  subtotal_freight: string;
  total_charges: string;
  total_discount: string;
  total_amount: string;
  vat_rate: string | null;
  vat_amount: string | null;
}

const TOTAL_COLUMNS =
  "total_lbs, subtotal_freight, total_charges, total_discount, total_amount, vat_rate, vat_amount";

/** Freight first, then other charges, discounts last: a prefix goes negative only if the whole does. */
function insertionOrder(lines: CaseLine[]): CaseLine[] {
  const rank = (l: CaseLine) => (l.lineType === "freight" ? 0 : l.lineType === "discount" ? 2 : 1);
  return [...lines].sort((a, b) => rank(a) - rank(b));
}

/** Assigns real orders to freight lines in turn (one freight line per order). */
function withOrders(lines: CaseLine[]): CaseLine[] {
  let next = 0;
  return lines.map((l) =>
    l.lineType === "freight" ? { ...l, orderId: orderIds[next++] ?? null } : l,
  );
}

async function writeDraft(tx: Transaction, c: Case): Promise<{ id: string; amounts: string[] }> {
  await tx.query("update public.company_settings set vat_rate_percent = $1 where id", [c.vatRate]);
  const inv = await tx.query<{ id: string }>(
    `insert into public.invoices (customer_id, currency, invoice_date, due_date)
     values ($1, 'USD', (now() at time zone 'America/Paramaribo')::date, (now() at time zone 'America/Paramaribo')::date + 7)
     returning id`,
    [customerId],
  );
  const id = inv.rows[0]!.id;
  const amounts: string[] = [];
  let sort = 0;
  for (const l of c.lines) {
    const r = await tx.query<{ amount: string }>(
      `insert into public.invoice_items
         (invoice_id, order_id, line_type, description, weight_lbs, rate_per_lb, amount, vat_exempt, sort_order)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning amount`,
      [
        id,
        l.orderId,
        l.lineType,
        `Regel ${sort + 1}`,
        l.lineType === "freight" ? l.weightLbs : null,
        l.lineType === "freight" ? l.ratePerLb : null,
        // A client may send anything for freight: the trigger recomputes it.
        l.lineType === "freight" ? "123456.78" : l.amount,
        l.vatExempt,
        sort++,
      ],
    );
    amounts.push(r.rows[0]!.amount);
  }
  return { id, amounts };
}

async function totalsOf(tx: Transaction, id: string): Promise<SqlTotals> {
  const r = await tx.query<SqlTotals>(
    `select ${TOTAL_COLUMNS} from public.invoices where id = $1`,
    [id],
  );
  return r.rows[0]!;
}

function expectSame(sql: SqlTotals, c: Case, label: string) {
  const ts = computeInvoiceTotals(c.lines, sql.vat_rate);
  const num = (v: string | null) => (v === null ? null : Number(v));
  expect(
    {
      totalLbs: num(sql.total_lbs),
      subtotalFreight: num(sql.subtotal_freight),
      totalCharges: num(sql.total_charges),
      totalDiscount: num(sql.total_discount),
      totalAmount: num(sql.total_amount),
      vatAmount: num(sql.vat_amount),
      vatRate: num(sql.vat_rate),
    },
    label,
  ).toEqual({
    totalLbs: ts.totalLbs,
    subtotalFreight: ts.subtotalFreight,
    totalCharges: ts.totalCharges,
    totalDiscount: ts.totalDiscount,
    totalAmount: ts.totalAmount,
    vatAmount: ts.vatAmount,
    vatRate: ts.vatRate,
  });
  expect(ts.negative).toBe(false);
}

async function checkCase(raw: Case, label: string): Promise<"stored" | "refused"> {
  const c: Case = { ...raw, lines: insertionOrder(withOrders(raw.lines)) };
  const ts = computeInvoiceTotals(c.lines, c.vatRate);
  return asUser(db, admin.id, async (tx) => {
    if (ts.negative) {
      // The database refuses the discount that makes the total negative.
      const err = await expectSqlError(
        withSavepoint(tx, () => writeDraft(tx, c)),
        "22023",
      );
      expect(err.message).toContain("korting is hoger");
      return "refused" as const;
    }
    const { id, amounts } = await writeDraft(tx, c);
    c.lines.forEach((l, i) => {
      const expected =
        l.lineType === "freight"
          ? freightAmount(l.weightLbs ?? 0, l.ratePerLb ?? 0)
          : Number(l.amount);
      expect(Number(amounts[i]), `${label} line ${i}`).toBe(expected);
    });
    expectSame(await totalsOf(tx, id), c, label);
    return "stored" as const;
  });
}

describe("computeInvoiceTotals matches the database", () => {
  it("for hand-picked rounding edges", async () => {
    for (const [i, c] of EDGE_CASES.entries()) {
      expect(await checkCase(c, `edge ${i}`)).toBe("stored");
    }
  });

  it("for 300 generated invoices (seeded), including refused negative totals", async () => {
    const rand = mulberry32(20261007);
    const outcomes = { stored: 0, refused: 0 };
    for (let i = 0; i < 300; i++) {
      const c = generate(rand);
      outcomes[await checkCase(c, `case ${i} ${JSON.stringify(c)}`)]++;
    }
    // Both paths were exercised.
    expect(outcomes.stored).toBeGreaterThan(200);
    expect(outcomes.refused).toBeGreaterThan(0);
  }, 120_000);

  it("after issue_invoice, which takes the VAT rate of that moment", async () => {
    const rand = mulberry32(42);
    let issued = 0;
    for (let i = 0; i < 40; i++) {
      const raw = generate(rand);
      const c: Case = { ...raw, lines: insertionOrder(withOrders(raw.lines)) };
      const draftTotals = computeInvoiceTotals(c.lines, c.vatRate);
      if (draftTotals.negative || draftTotals.totalAmount <= 0) continue;
      const rateAtIssue = generate(rand).vatRate;
      await asUser(db, admin.id, async (tx) => {
        const { id } = await writeDraft(tx, c);
        await tx.query("update public.company_settings set vat_rate_percent = $1 where id", [
          rateAtIssue,
        ]);
        const r = await tx.query<SqlTotals & { status: string }>(
          `select status, ${TOTAL_COLUMNS} from public.issue_invoice($1)`,
          [id],
        );
        expect(r.rows[0]!.status).toBe("open");
        expectSame(r.rows[0]!, { ...c, vatRate: rateAtIssue }, `issued ${i}`);
        expect(r.rows[0]!.vat_rate === null ? null : Number(r.rows[0]!.vat_rate)).toBe(
          rateAtIssue === null ? null : Number(rateAtIssue),
        );
      });
      issued++;
    }
    expect(issued).toBeGreaterThan(10);
  }, 60_000);
});
