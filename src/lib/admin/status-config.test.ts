import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const {
  createStatus,
  deactivationImpact,
  emptyNewStatusForm,
  groupStatusesByStage,
  setStatusActive,
  statusFormFromRow,
  suggestSortOrder,
  suggestStatusCode,
  updateStatus,
  validateNewStatusForm,
  validateStatusForm,
} = await import("./status-config");
type StatusRow = import("./statuses").StatusRow;

const S = (
  code: string,
  stage: StatusRow["stage"],
  sort_order: number,
  extra: Partial<StatusRow> = {},
): StatusRow => ({
  code,
  stage,
  sort_order,
  label_nl: code,
  customer_description_nl: null,
  is_terminal: false,
  customer_visible: true,
  notify_customer: false,
  active: true,
  created_at: "2026-01-01T00:00:00Z",
  created_by: null,
  updated_at: "2026-01-01T00:00:00Z",
  updated_by: null,
  ...extra,
});

const statuses = new Map(
  [
    S("pending", "registered", 20),
    S("order_registered", "registered", 10),
    S("arrived_us_warehouse", "us_warehouse", 40),
    S("old_warehouse", "us_warehouse", 30, { active: false }),
    S("in_transit", "in_transit", 50),
    S("picked_up", "completed", 100),
    S("delivered", "completed", 110),
    S("cancelled", "cancelled", 130),
  ].map((s) => [s.code, s]),
);

describe("groupStatusesByStage", () => {
  it("lists every stage in journey order with its statuses by sort order and the default", () => {
    const groups = groupStatusesByStage(statuses);
    expect(groups.map((g) => g.stage)).toEqual([
      "registered",
      "us_warehouse",
      "in_transit",
      "arrived_sr",
      "at_customs",
      "cleared",
      "ready_for_pickup",
      "completed",
      "action_required",
      "cancelled",
    ]);
    const registered = groups[0];
    expect(registered?.statuses.map((s) => s.code)).toEqual(["order_registered", "pending"]);
    expect(registered?.defaultCode).toBe("order_registered");
    // The inactive status sorts first but is not the default.
    const warehouse = groups[1];
    expect(warehouse?.statuses.map((s) => s.code)).toEqual([
      "old_warehouse",
      "arrived_us_warehouse",
    ]);
    expect(warehouse?.defaultCode).toBe("arrived_us_warehouse");
    expect(groups[3]).toEqual({ stage: "arrived_sr", statuses: [], defaultCode: null });
  });
});

describe("status forms", () => {
  it("edits labels, description, sort order and flags; a hidden status never e-mails", () => {
    const values = statusFormFromRow(
      S("in_transit", "in_transit", 50, {
        label_nl: "Onderweg",
        customer_description_nl: "Uw pakket vliegt.",
        notify_customer: true,
      }),
    );
    expect(values).toEqual({
      labelNl: "Onderweg",
      customerDescriptionNl: "Uw pakket vliegt.",
      sortOrder: "50",
      customerVisible: true,
      notifyCustomer: true,
    });
    expect(
      validateStatusForm({
        ...values,
        labelNl: "  Onderweg naar Suriname ",
        customerDescriptionNl: " ",
        customerVisible: false,
      }),
    ).toEqual({
      ok: true,
      columns: {
        label_nl: "Onderweg naar Suriname",
        customer_description_nl: null,
        sort_order: 50,
        customer_visible: false,
        notify_customer: false,
      },
    });
  });

  it("reports every field problem at once", () => {
    const result = validateStatusForm({
      labelNl: " ",
      customerDescriptionNl: "x".repeat(501),
      sortOrder: "100001",
      customerVisible: true,
      notifyCustomer: false,
    });
    expect(result.ok ? [] : Object.keys(result.errors).sort()).toEqual([
      "customerDescriptionNl",
      "labelNl",
      "sortOrder",
    ]);
    for (const bad of ["", "-1", "1.5", "abc", "1234567"]) {
      const r = validateStatusForm({
        ...statusFormFromRow(S("a_b", "registered", 1)),
        sortOrder: bad,
      });
      expect(r.ok, bad).toBe(false);
    }
  });

  it("a new status needs a free, valid code and a stage; completed and cancelled are terminal", () => {
    const base = { ...emptyNewStatusForm(statuses, "completed"), labelNl: "Bezorgd door koerier" };
    expect(base.sortOrder).toBe("111");
    const ok = validateNewStatusForm({ ...base, code: "courier_delivered" }, statuses);
    expect(ok).toEqual({
      ok: true,
      columns: {
        code: "courier_delivered",
        stage: "completed",
        label_nl: "Bezorgd door koerier",
        customer_description_nl: null,
        sort_order: 111,
        customer_visible: true,
        notify_customer: false,
        is_terminal: true,
        active: true,
      },
    });
    const taken = validateNewStatusForm({ ...base, code: "picked_up" }, statuses);
    expect(taken.ok ? null : taken.errors.code).toBe("De code picked_up bestaat al.");
    for (const bad of ["", "A_code", "1abc", "a", "met spatie", "x".repeat(51)]) {
      const r = validateNewStatusForm({ ...base, code: bad }, statuses);
      expect(r.ok ? null : r.errors.code, bad).toBeTruthy();
    }
    const noStage = validateNewStatusForm(
      { ...emptyNewStatusForm(statuses), code: "x_y", labelNl: "" },
      statuses,
    );
    expect(noStage.ok ? [] : Object.keys(noStage.errors).sort()).toEqual([
      "labelNl",
      "sortOrder",
      "stage",
    ]);
    const transit = validateNewStatusForm(
      { ...emptyNewStatusForm(statuses, "in_transit"), code: "on_board", labelNl: "Aan boord" },
      statuses,
    );
    expect(transit.ok && transit.columns.is_terminal).toBe(false);
  });

  it("suggests a code from the label and a sort position after the stage's last status", () => {
    const taken = new Set(statuses.keys());
    expect(suggestStatusCode("Wacht op betaling", taken)).toBe("wacht_op_betaling");
    expect(suggestStatusCode("  Ingeklaard é & klaar! ", taken)).toBe("ingeklaard_e_klaar");
    expect(suggestStatusCode("Picked up", taken)).toBe("picked_up_2");
    expect(suggestStatusCode("123", taken)).toBe("");
    expect(suggestStatusCode("x".repeat(80), taken)).toHaveLength(50);
    expect(suggestSortOrder(statuses, "registered")).toBe(21);
    expect(suggestSortOrder(statuses, "us_warehouse")).toBe(41);
    // An empty stage goes after everything.
    expect(suggestSortOrder(statuses, "arrived_sr")).toBe(135);
  });
});

describe("deactivationImpact", () => {
  it("counts orders in the status and warns about the last active status of a stage", () => {
    const usage = new Map([["in_transit", 7]]);
    expect(deactivationImpact(statuses, "in_transit", usage)).toEqual({
      inUse: 7,
      lastActiveInStage: true,
      blocked: false,
    });
    expect(deactivationImpact(statuses, "pending", usage)).toEqual({
      inUse: 0,
      lastActiveInStage: false,
      blocked: false,
    });
    // The other warehouse status is inactive.
    expect(deactivationImpact(statuses, "arrived_us_warehouse", undefined).lastActiveInStage).toBe(
      true,
    );
  });

  it("refuses to leave no active 'registered' status (the database does too)", () => {
    const one = new Map(statuses);
    one.set("pending", S("pending", "registered", 20, { active: false }));
    expect(deactivationImpact(one, "order_registered", undefined)).toMatchObject({
      lastActiveInStage: true,
      blocked: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

type Call = [string, ...unknown[]];

function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};
  for (const name of ["from", "insert", "update", "eq", "select", "single"]) {
    chain[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
      return chain;
    };
  }
  chain["then"] = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return { client: chain as never, calls };
}

describe("status writes", () => {
  it("updates by code and treats a row RLS filtered away as 'admins only'", async () => {
    const ok = fakeClient({ data: [{ code: "in_transit" }], error: null });
    const columns = {
      label_nl: "Onderweg",
      customer_description_nl: null,
      sort_order: 50,
      customer_visible: true,
      notify_customer: true,
    };
    await updateStatus(ok.client, "in_transit", columns);
    expect(ok.calls).toEqual([
      ["from", "shipment_statuses"],
      ["update", columns],
      ["eq", "code", "in_transit"],
      ["select", "code"],
    ]);
    const none = fakeClient({ data: [], error: null });
    await expect(setStatusActive(none.client, "in_transit", false)).rejects.toMatchObject({
      code: "42501",
      message: "Alleen een beheerder kan statussen wijzigen.",
    });
  });

  it("a taken code gets its own message", async () => {
    const taken = fakeClient({ data: null, error: { code: "23505", message: "duplicate key" } });
    const result = validateNewStatusForm(
      { ...emptyNewStatusForm(statuses, "in_transit"), code: "on_board", labelNl: "Aan boord" },
      statuses,
    );
    if (!result.ok) throw new Error("form");
    await expect(createStatus(taken.client, result.columns)).rejects.toMatchObject({
      code: "23505",
      message: "De code on_board bestaat al.",
    });
  });
});
