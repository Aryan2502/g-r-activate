import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";

import {
  addDays,
  addOrder,
  canMoveLine,
  changeCurrency,
  changeInvoiceDate,
  changeLineType,
  draftReferences,
  errorOrder,
  extraLine,
  freightLineForOrder,
  initialBuilderState,
  isValidDate,
  lineField,
  listedOrders,
  moveLine,
  newInvoiceSearch,
  orderIdsParam,
  rateFor,
  refreshDates,
  removeLine,
  removeOrder,
  stateFromDraft,
  toDraftForm,
  validateBuilder,
  weightNoteText,
  weightPlan,
  type BuilderOrder,
  type BuilderState,
  type DraftItem,
} from "./invoice-builder";
import type { ServiceRate } from "./settings";

const rate = (over: Partial<ServiceRate> = {}): ServiceRate => ({
  service_type: "air",
  enabled: true,
  rate_per_lb: 4.5,
  currency: "USD",
  minimum_billable_lbs: null,
  weight_rounding: "none",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  updated_by: null,
  ...over,
});

const ID = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const order = (n: number, over: Partial<BuilderOrder> = {}): BuilderOrder => ({
  id: ID(n),
  reference: `ORD-2026-${String(n).padStart(5, "0")}`,
  customer_id: "c1",
  order_type: "personal",
  service_type: "air",
  store_vendor: "Amazon",
  vendor_order_number: `112-${n}`,
  description: null,
  tracking_number: `1Z${n}`,
  status: "arrived_us_warehouse",
  measured_weight_lbs: 2.34,
  declared_weight_lbs: 3,
  created_at: "2026-10-01T12:00:00Z",
  parent_order_id: null,
  freightOn: null,
  ...over,
});

const base = (): BuilderState =>
  initialBuilderState({
    customerId: "c1",
    currency: "USD",
    paymentTermDays: 7,
    today: "2026-10-07",
  });

describe("dates", () => {
  it("adds calendar days and validates real dates in 2000–2999", () => {
    expect(addDays("2026-10-07", 7)).toBe("2026-10-14");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDays("nope", 1)).toBe("");
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2028-02-29")).toBe(true);
    expect(isValidDate("1999-12-31")).toBe(false);
  });

  it("a new invoice is dated today in Suriname and due after the payment term", () => {
    const s = base();
    expect(s.invoiceDate).toBe("2026-10-07");
    expect(s.dueDate).toBe("2026-10-14");
  });

  it("the due date follows the invoice date until staff change it", () => {
    let s = changeInvoiceDate(base(), "2026-10-01", 7);
    expect(s.dueDate).toBe("2026-10-08");
    s = { ...s, dueDate: "2026-10-30", dueTouched: true };
    s = changeInvoiceDate(s, "2026-10-02", 7);
    expect(s.dueDate).toBe("2026-10-30");
    expect(refreshDates(s, 7, "2026-10-09")).toMatchObject({
      invoiceDate: "2026-10-09",
      dueDate: "2026-10-16",
      dueTouched: false,
    });
  });
});

describe("prefilled freight lines (SPEC §35.9)", () => {
  it("bills the measured weight after rounding and minimum", () => {
    expect(weightPlan(order(1), rate({ weight_rounding: "0.5" }))).toEqual({
      kind: "measured",
      raw: 2.34,
      billed: 2.5,
    });
    expect(weightPlan(order(1), rate({ minimum_billable_lbs: 3 }))).toMatchObject({ billed: 3 });
  });

  it("falls back to the declared weight (flagged) and else to nothing", () => {
    expect(weightPlan(order(1, { measured_weight_lbs: null }), rate())).toEqual({
      kind: "declared",
      raw: 3,
      billed: 3,
    });
    expect(
      weightPlan(order(1, { measured_weight_lbs: null, declared_weight_lbs: null }), rate()),
    ).toEqual({ kind: "missing", raw: null, billed: null });
    expect(weightNoteText({ kind: "declared", raw: 3, billed: 3 })).toContain("Nog niet gewogen");
    expect(weightNoteText({ kind: "measured", raw: 2.34, billed: 2.5 })).toContain("2,50");
  });

  it("uses the rate of the order's service, only in the invoice currency", () => {
    expect(rateFor(order(1), [rate()], "USD")).toBe(4.5);
    expect(rateFor(order(1), [rate()], "SRD")).toBeNull();
    expect(rateFor(order(1), [rate({ rate_per_lb: null })], "USD")).toBeNull();
    expect(rateFor(order(1, { service_type: "sea" }), [rate()], "USD")).toBeNull();
  });

  it("describes the line as '{store} – order {number}'", () => {
    const line = freightLineForOrder(order(7), [rate()], "USD");
    expect(line).toMatchObject({
      lineType: "freight",
      orderId: ID(7),
      description: "Amazon – order 112-7",
      weight: "2,34",
      rate: "4,5",
      vatExempt: false,
    });
  });
});

describe("picking orders and editing lines", () => {
  it("adds one freight line per order, freight first, and removes it again", () => {
    let s = addOrder(base(), order(1), [rate()]);
    s = { ...s, lines: [...s.lines, extraLine("customs")] };
    s = addOrder(s, order(2), [rate()]);
    expect(s.orderIds).toEqual([ID(1), ID(2)]);
    expect(s.lines.map((l) => l.lineType)).toEqual(["freight", "freight", "customs"]);
    expect(addOrder(s, order(1), [rate()])).toBe(s); // already picked

    const customsKey = s.lines[2]!.key;
    s = { ...s, lines: s.lines.map((l) => (l.key === customsKey ? { ...l, orderId: ID(1) } : l)) };
    s = removeOrder(s, ID(1));
    expect(s.orderIds).toEqual([ID(2)]);
    expect(s.lines.map((l) => [l.lineType, l.orderId])).toEqual([
      ["freight", ID(2)],
      ["customs", null],
    ]);
    // Removing a freight line unpicks its order.
    s = removeLine(s, s.lines[0]!.key);
    expect(s.orderIds).toEqual([]);
  });

  it("an order whose freight is billed elsewhere gets a customs line, not freight", () => {
    const s = addOrder(
      base(),
      order(3, { freightOn: { invoiceId: "i9", invoiceNumber: "INV-2026-0009" } }),
      [rate()],
    );
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]).toMatchObject({ lineType: "customs", orderId: ID(3), vatExempt: true });
    expect(s.lines[0]?.description).toBe("Inklaringskosten – ORD-2026-00003");
  });

  it("moves only where the paper shows the order: freight among freight, 'Overige kosten' among each other", () => {
    let s = addOrder(addOrder(base(), order(1), [rate()]), order(2), [rate()]);
    const other1 = { ...extraLine("other"), key: "o1", description: "Opslag", amount: "5" };
    const customs = { ...extraLine("customs"), key: "c1", amount: "10" };
    const other2 = { ...extraLine("other"), key: "o2", description: "Verzekering", amount: "3" };
    s = { ...s, lines: [...s.lines, other1, customs, other2] };
    const [f1, f2] = s.lines;
    // Freight never swaps with a charge line; customs never moves at all.
    expect(canMoveLine(s, f2!.key, 1)).toBe(false);
    expect(canMoveLine(s, f2!.key, -1)).toBe(true);
    expect(canMoveLine(s, "c1", -1)).toBe(false);
    expect(moveLine(s, "c1", -1)).toBe(s);
    // 'Overige kosten' skips the customs line in between.
    expect(canMoveLine(s, "o2", -1)).toBe(true);
    s = moveLine(s, "o2", -1);
    expect(s.lines.map((l) => l.key)).toEqual([f1!.key, f2!.key, "o2", "c1", "o1"]);
    expect(canMoveLine(s, "o2", -1)).toBe(false);
  });

  it("a hand-added line starts with its type as description, except 'Overige kosten'", () => {
    expect(extraLine("handling").description).toBe(t("admin.invoiceBuilder.lines.types.handling"));
    expect(extraLine("customs").description).toBe("Inklaringskosten / douane");
    expect(extraLine("discount").description).toBe("Korting");
    expect(extraLine("other").description).toBe("");
    // Changing the type keeps typed text, but a default follows the type.
    const handling = extraLine("handling");
    expect(changeLineType(handling, "service_fee")).toMatchObject({
      lineType: "service_fee",
      description: "Servicekosten",
    });
    expect(changeLineType(handling, "other").description).toBe("");
    expect(
      changeLineType({ ...handling, description: "Opslag zaterdag" }, "goods"),
    ).not.toHaveProperty("description");
    expect(changeLineType(handling, "customs").vatExempt).toBe(true);
    expect(changeLineType(extraLine("customs"), "handling").vatExempt).toBe(false);
  });

  it("moves lines and swaps only the rates it filled in when the currency changes", () => {
    let s = addOrder(addOrder(base(), order(1), [rate()]), order(2), [rate()]);
    const [a, b] = s.lines;
    s = moveLine(s, b!.key, -1);
    expect(s.lines.map((l) => l.key)).toEqual([b!.key, a!.key]);
    expect(moveLine(s, b!.key, -1)).toBe(s);
    s = { ...s, lines: s.lines.map((l) => (l.key === a!.key ? { ...l, rate: "6" } : l)) };
    const srd = changeCurrency(s, "SRD", [order(1), order(2)], [rate()]);
    expect(srd.lines.map((l) => l.rate)).toEqual(["", "6"]);
  });

  it("references are every order with a line, sorted", () => {
    const s = addOrder(addOrder(base(), order(12), [rate()]), order(3), [rate()]);
    expect(draftReferences(s, [order(12), order(3)])).toEqual(["ORD-2026-00003", "ORD-2026-00012"]);
  });
});

describe("validateBuilder (the database's rules, in Dutch, before saving)", () => {
  const orders = [order(1), order(2)];
  const withLines = () => addOrder(base(), order(1), [rate()]);

  it("accepts a complete draft", () => {
    expect(validateBuilder(withLines(), { orders, vatRate: null, mode: "draft" }).valid).toBe(true);
    expect(
      validateBuilder(withLines(), { orders, vatRate: null, mode: "issue", today: "2026-10-07" })
        .valid,
    ).toBe(true);
  });

  it("needs a customer and real dates, due not before the invoice date", () => {
    const v = validateBuilder(
      { ...base(), customerId: null, invoiceDate: "2026-13-01", dueDate: "2026-10-01" },
      { orders, vatRate: null, mode: "draft" },
    );
    expect(Object.keys(v.errors).sort()).toEqual(["customer", "invoiceDate"]);
    const w = validateBuilder(
      { ...base(), dueDate: "2026-10-06" },
      { orders, vatRate: null, mode: "draft" },
    );
    expect(w.errors["dueDate"]).toBe("De vervaldatum ligt vóór de factuurdatum.");
  });

  it("checks every line like invoice_items' CHECKs", () => {
    let s = withLines();
    const key = s.lines[0]!.key;
    s = {
      ...s,
      lines: [
        { ...s.lines[0]!, weight: "0", rate: "4,555", description: " " },
        { ...extraLine("handling"), key: "h", amount: "-5" },
        { ...extraLine("discount"), key: "d", amount: "" },
      ],
    };
    const v = validateBuilder(s, { orders, vatRate: null, mode: "draft" });
    expect(v.errors[lineField(key, "weight")]).toMatch(/groter dan 0/);
    expect(v.errors[lineField(key, "rate")]).toMatch(/2 decimalen/);
    expect(v.errors[lineField(key, "description")]).toBe("Vul een omschrijving in.");
    expect(v.errors[lineField("h", "amount")]).toMatch(/0 of meer/);
    expect(v.errors[lineField("d", "amount")]).toBe("Vul een bedrag in.");
    // The first error to focus is the first field in the form.
    expect(errorOrder(s).find((f) => v.errors[f])).toBe(lineField(key, "description"));
  });

  it("refuses freight twice for one order and freight billed elsewhere", () => {
    const s = withLines();
    const twice = { ...s, lines: [...s.lines, { ...s.lines[0]!, key: "dup", id: null }] };
    expect(
      validateBuilder(twice, { orders, vatRate: null, mode: "draft" }).errors[
        lineField("dup", "order")
      ],
    ).toBe("Deze order heeft al een vrachtregel op deze factuur.");
    const billed = [
      order(1, { freightOn: { invoiceId: "x", invoiceNumber: "INV-2026-0003" } }),
      order(2),
    ];
    expect(
      validateBuilder(s, { orders: billed, vatRate: null, mode: "draft" }).errors[
        lineField(s.lines[0]!.key, "order")
      ],
    ).toBe("De vracht van order ORD-2026-00001 staat al op INV-2026-0003.");
  });

  it("refuses a discount larger than the charges (the database would)", () => {
    const s = withLines(); // 2,34 × 4,50 = 10,53
    const v = validateBuilder(
      { ...s, lines: [...s.lines, { ...extraLine("discount"), amount: "11" }] },
      { orders, vatRate: null, mode: "draft" },
    );
    expect(v.errors["lines"]).toMatch(/korting is hoger/);
  });

  it("issuing adds issue_invoice's rules: a line, a total > 0 and today's dates", () => {
    const empty = validateBuilder(base(), {
      orders,
      vatRate: null,
      mode: "issue",
      today: "2026-10-07",
    });
    expect(empty.errors["lines"]).toBe("Een factuur heeft minstens één regel nodig.");
    expect(validateBuilder(base(), { orders, vatRate: null, mode: "draft" }).valid).toBe(true);

    const zero = {
      ...base(),
      lines: [{ ...extraLine("handling"), amount: "0", description: "x" }],
    };
    expect(
      validateBuilder(zero, { orders, vatRate: null, mode: "issue", today: "2026-10-07" }).errors[
        "lines"
      ],
    ).toMatch(/groter dan 0/);

    const old = { ...withLines(), invoiceDate: "2025-12-30", dueDate: "2026-01-06" };
    const v = validateBuilder(old, { orders, vatRate: null, mode: "issue", today: "2026-10-07" });
    expect(v.dateProblem).toBe(true);
    expect(v.errors["invoiceDate"]).toMatch(/ander jaar.*2026/);
    expect(v.errors["dueDate"]).toMatch(/verstreken/);
    const future = { ...withLines(), invoiceDate: "2026-10-08", dueDate: "2026-10-15" };
    expect(
      validateBuilder(future, { orders, vatRate: null, mode: "issue", today: "2026-10-07" }).errors[
        "invoiceDate"
      ],
    ).toMatch(/toekomst/);
  });
});

describe("the preview's form state", () => {
  it("parses Dutch input; discounts become negative; the tracking line comes from the live order", () => {
    let s = addOrder(base(), order(1), [rate()]);
    s = { ...s, lines: [...s.lines, { ...extraLine("discount"), amount: "1,50" }] };
    const form = toDraftForm(s, [order(1)]);
    expect(form.lines.map((l) => [l.lineType, l.weightLbs, l.ratePerLb, l.amount])).toEqual([
      ["freight", 2.34, 4.5, null],
      ["discount", null, null, -1.5],
    ]);
    expect(form.lines[0]?.detail).toBe("Tracking: 1Z1 · Ref: ORD-2026-00001");
    expect(form.references).toEqual(["ORD-2026-00001"]);
    expect(toDraftForm({ ...s, invoiceDate: "x" }, []).invoiceDate).toBe("");
  });

  it("a saved draft comes back as the same form", () => {
    const s = stateFromDraft(
      {
        id: "i1",
        invoice_number: null,
        status: "draft",
        customer_id: "c1",
        currency: "USD",
        invoice_date: "2026-10-07",
        due_date: "2026-10-20",
        customer_note: "Let op",
        replaces_invoice_id: null,
        total_amount: 0,
      },
      [
        {
          id: "l2",
          invoice_id: "i1",
          order_id: null,
          line_type: "discount",
          description: "Korting",
          weight_lbs: null,
          rate_per_lb: null,
          amount: -2.5,
          vat_exempt: false,
          sort_order: 1,
        },
        {
          id: "l1",
          invoice_id: "i1",
          order_id: ID(1),
          line_type: "freight",
          description: "Amazon – order 112-1",
          weight_lbs: 2.5,
          rate_per_lb: 4.5,
          amount: 11.25,
          vat_exempt: false,
          sort_order: 0,
        },
      ].sort((a, b) => a.sort_order - b.sort_order) as DraftItem[],
      [order(1)],
      [rate()],
      7,
    );
    expect(s.dueTouched).toBe(true); // 20-10 is not 07-10 + 7
    expect(s.orderIds).toEqual([ID(1)]);
    expect(s.lines.map((l) => [l.id, l.weight, l.rate, l.amount])).toEqual([
      ["l1", "2,5", "4,5", ""],
      ["l2", "", "", "2,5"],
    ]);
    expect(s.lines[0]?.weightNote?.kind).toBe("measured");
  });

  it("lists orders without billed freight by default; picked ones always", () => {
    const orders = [
      order(1),
      order(2, { freightOn: { invoiceId: "x", invoiceNumber: "INV-1" } }),
      order(3, { status: "cancelled" }),
    ];
    const cancelled = new Set(["cancelled"]);
    expect(
      listedOrders(orders, { showInvoiced: false, selected: [], cancelledStatuses: cancelled }).map(
        (o) => o.id,
      ),
    ).toEqual([ID(1)]);
    expect(
      listedOrders(orders, { showInvoiced: true, selected: [], cancelledStatuses: cancelled }).map(
        (o) => o.id,
      ),
    ).toEqual([ID(1), ID(2)]);
    expect(
      listedOrders(orders, {
        showInvoiced: false,
        selected: [ID(3)],
        cancelledStatuses: cancelled,
      }).map((o) => o.id),
    ).toEqual([ID(1), ID(3)]);
  });
});

describe("entry-point links", () => {
  it("builds ?customer=&orders=&from= and reads ?orders= back", () => {
    expect(
      newInvoiceSearch({ customerId: "c1", orderIds: [ID(1), ID(2)], from: "orders" }),
    ).toEqual({
      customer: "c1",
      orders: `${ID(1)},${ID(2)}`,
      from: "orders",
    });
    expect(newInvoiceSearch({ customerId: "c1", from: "customer" })).toEqual({
      customer: "c1",
      from: "customer",
    });
    expect(orderIdsParam(`${ID(1)},nope,${ID(1)},${ID(2)}`)).toEqual([ID(1), ID(2)]);
    expect(orderIdsParam(undefined)).toEqual([]);
  });
});
