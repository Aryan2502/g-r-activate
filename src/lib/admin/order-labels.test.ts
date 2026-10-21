import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const {
  LABEL_COLORS,
  addOrderLabels,
  fetchOrderLabels,
  findLabelInUse,
  hasLabel,
  labelInputSchema,
  labelsByOrder,
  labelsInUse,
  matchLabelsInUse,
  removeOrderLabel,
} = await import("./order-labels");
type OrderLabel = import("./order-labels").OrderLabel;

const L = (id: string, order_id: string, label: string, color: OrderLabel["color"], at: string) =>
  ({ id, order_id, label, color, created_at: `2026-10-${at}T10:00:00Z` }) satisfies OrderLabel;

const labels: OrderLabel[] = [
  L("1", "a", "Air", "blue", "10"),
  L("2", "b", "air", "teal", "12"),
  L("3", "b", "Spoed", "red", "11"),
  L("4", "c", "Ocean", "green", "09"),
  L("5", "a", "Spoed", "red", "08"),
  L("6", "d", "AIR", "blue", "05"),
];

describe("labelsByOrder()", () => {
  it("groups the labels per order, oldest first", () => {
    const map = labelsByOrder(labels);
    expect(map.get("a")?.map((l) => l.id)).toEqual(["5", "1"]);
    expect(map.get("b")?.map((l) => l.id)).toEqual(["3", "2"]);
    expect(map.get("z")).toBeUndefined();
  });
});

describe("labelsInUse()", () => {
  it("lists each label once ignoring case, most used first, with its latest text and colour", () => {
    expect(labelsInUse(labels)).toEqual([
      { key: "air", label: "air", color: "teal", count: 3 },
      { key: "spoed", label: "Spoed", color: "red", count: 2 },
      { key: "ocean", label: "Ocean", color: "green", count: 1 },
    ]);
    expect(labelsInUse([])).toEqual([]);
  });

  it("matchLabelsInUse() keeps the labels containing the typed text, ignoring case and accents", () => {
    const inUse = labelsInUse([...labels, L("7", "e", "Spöed groot", "orange", "13")]);
    expect(matchLabelsInUse(inUse, "")).toBe(inUse);
    expect(matchLabelsInUse(inUse, "   ")).toBe(inUse);
    expect(matchLabelsInUse(inUse, " SPOED ").map((l) => l.label)).toEqual([
      "Spoed",
      "Spöed groot",
    ]);
    expect(matchLabelsInUse(inUse, "cea").map((l) => l.label)).toEqual(["Ocean"]);
    expect(matchLabelsInUse(inUse, "Zee")).toEqual([]);
    expect(matchLabelsInUse([], "air")).toEqual([]);
  });

  it("findLabelInUse() finds the label the text names, ignoring case and surrounding spaces", () => {
    const inUse = labelsInUse(labels);
    expect(findLabelInUse(inUse, "  OCEAN ")).toEqual({
      key: "ocean",
      label: "Ocean",
      color: "green",
      count: 1,
    });
    expect(findLabelInUse(inUse, "oce")).toBeUndefined();
    expect(findLabelInUse(inUse, "   ")).toBeUndefined();
    expect(findLabelInUse([], "Air")).toBeUndefined();
  });

  it("hasLabel() ignores case and surrounding spaces", () => {
    expect(hasLabel(labels.slice(0, 1), " AIR ")).toBe(true);
    expect(hasLabel(labels.slice(0, 1), "Ocean")).toBe(false);
    expect(hasLabel(undefined, "Air")).toBe(false);
  });
});

describe("labelInputSchema", () => {
  it("trims the text and takes one of the colours", () => {
    expect(labelInputSchema.parse({ label: "  Ocean ", color: "teal" })).toEqual({
      label: "Ocean",
      color: "teal",
    });
    expect(LABEL_COLORS).toContain("brown");
  });

  it("refuses an empty or too long text and an unknown colour", () => {
    expect(labelInputSchema.safeParse({ label: "  ", color: "blue" }).success).toBe(false);
    expect(labelInputSchema.safeParse({ label: "x".repeat(31), color: "blue" }).success).toBe(
      false,
    );
    expect(labelInputSchema.safeParse({ label: "x".repeat(30), color: "blue" }).success).toBe(true);
    expect(labelInputSchema.safeParse({ label: "Air", color: "purple" }).success).toBe(false);
  });
});

/** A fake of the supabase-js calls the module makes, recording them. */
function fakeDb(result: { data: unknown; error: unknown }) {
  const calls: unknown[][] = [];
  const chain = {
    select: (...a: unknown[]) => (calls.push(["select", ...a]), chain),
    order: (...a: unknown[]) => (calls.push(["order", ...a]), chain),
    range: (...a: unknown[]) => (calls.push(["range", ...a]), Promise.resolve(result)),
    upsert: (...a: unknown[]) => (calls.push(["upsert", ...a]), chain),
    delete: () => (calls.push(["delete"]), chain),
    eq: (...a: unknown[]) => (calls.push(["eq", ...a]), Promise.resolve(result)),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return {
    calls,
    db: { from: (table: string) => (calls.push(["from", table]), chain) },
  };
}

describe("reading and writing", () => {
  it("reads every label; before the migration the table is missing and labels are 'not available'", async () => {
    const ok = fakeDb({ data: labels, error: null });
    expect(await fetchOrderLabels(ok.db)).toEqual({ available: true, labels });
    expect(ok.calls[0]).toEqual(["from", "order_labels"]);

    for (const code of ["PGRST205", "42P01"]) {
      const missing = fakeDb({ data: null, error: { code, message: "missing" } });
      expect(await fetchOrderLabels(missing.db)).toEqual({ available: false, labels: [] });
    }
    const denied = fakeDb({ data: null, error: { code: "42501", message: "Geen toegang" } });
    await expect(fetchOrderLabels(denied.db)).rejects.toMatchObject({ code: "42501" });
  });

  it("labels several orders in one call and ignores orders that already carry the label", async () => {
    const added = [L("9", "a", "Ocean", "teal", "17")];
    const fake = fakeDb({ data: added, error: null });
    expect(await addOrderLabels(fake.db, ["a", "b"], { label: "Ocean", color: "teal" })).toEqual(
      added,
    );
    expect(fake.calls).toContainEqual([
      "upsert",
      [
        { order_id: "a", label: "Ocean", color: "teal" },
        { order_id: "b", label: "Ocean", color: "teal" },
      ],
      { onConflict: "order_id,label_key", ignoreDuplicates: true },
    ]);
    const none = fakeDb({ data: [], error: null });
    expect(await addOrderLabels(none.db, [], { label: "X", color: "grey" })).toEqual([]);
    expect(none.calls).toEqual([]);
  });

  it("removes one label by id", async () => {
    const fake = fakeDb({ data: null, error: null });
    await removeOrderLabel(fake.db, "9");
    expect(fake.calls).toEqual([["from", "order_labels"], ["delete"], ["eq", "id", "9"]]);
    const failing = fakeDb({ data: null, error: { code: "42501", message: "Geen toegang" } });
    await expect(removeOrderLabel(failing.db, "9")).rejects.toMatchObject({ code: "42501" });
  });
});
