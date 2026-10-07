import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  AUDIT_PAGE_SIZE,
  auditActionLabel,
  auditDiff,
  auditQuery,
  auditRangeInvalid,
  auditRecordLabel,
  auditRecordLink,
  auditSearchSchema,
  auditTableLabel,
  auditTimeRange,
  formatAuditValue,
  hasAuditFilters,
  loadAuditPage,
  normalizeRecordId,
  type AuditEntry,
} from "./audit";

const UUID = "6F1C0D2E-8A4B-4C3D-9E5F-0A1B2C3D4E5F";

describe("auditSearchSchema", () => {
  it("keeps valid filters and drops invalid ones instead of failing", () => {
    expect(
      auditSearchSchema.parse({
        table: "orders",
        actor: UUID,
        from: "2026-10-01",
        to: "2026-10-07",
        record: " 42 ",
        page: "3",
      }),
    ).toEqual({
      table: "orders",
      actor: UUID.toLowerCase(),
      from: "2026-10-01",
      to: "2026-10-07",
      record: "42",
      page: 3,
    });
    expect(
      auditSearchSchema.parse({
        table: "pg_authid",
        actor: "not-a-uuid",
        from: "2026-02-30",
        to: "gisteren",
        record: "",
        page: "0",
      }),
    ).toEqual({
      table: undefined,
      actor: undefined,
      from: undefined,
      to: undefined,
      record: undefined,
      page: undefined,
    });
  });

  it("knows when filters are set", () => {
    expect(hasAuditFilters({})).toBe(false);
    expect(hasAuditFilters({ page: 2 })).toBe(false);
    expect(hasAuditFilters({ table: "payments" })).toBe(true);
  });
});

describe("auditTimeRange()", () => {
  it("covers whole Suriname days (UTC−3), the last day inclusive", () => {
    expect(auditTimeRange({ from: "2026-10-07", to: "2026-10-07" })).toEqual({
      gte: "2026-10-07T03:00:00.000Z",
      lt: "2026-10-08T03:00:00.000Z",
    });
    expect(auditTimeRange({ to: "2026-12-31" })).toEqual({
      gte: null,
      lt: "2027-01-01T03:00:00.000Z",
    });
    expect(auditTimeRange({})).toEqual({ gte: null, lt: null });
  });

  it("flags a range that ends before it starts", () => {
    expect(auditRangeInvalid({ from: "2026-10-08", to: "2026-10-07" })).toBe(true);
    expect(auditRangeInvalid({ from: "2026-10-07", to: "2026-10-07" })).toBe(false);
    expect(auditRangeInvalid({ from: "2026-10-07" })).toBe(false);
  });
});

/** Records the PostgREST calls auditQuery makes. */
function recorder(result: { data: unknown[]; error: unknown } = { data: [], error: null }) {
  const calls: string[] = [];
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "eq", "gte", "lt", "order", "range"]) {
    builder[name] = (...args: unknown[]) => {
      calls.push(`${name}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
      return builder;
    };
  }
  builder["then"] = (resolve: (v: unknown) => unknown) => resolve(result);
  const db = {
    from: (table: string) => {
      calls.push(`from(${table})`);
      return builder;
    },
  };
  return { db: db as unknown as Parameters<typeof auditQuery>[0], calls };
}

describe("auditQuery() / loadAuditPage()", () => {
  it("filters in the database: table, actor, record and the day range", () => {
    const { db, calls } = recorder();
    auditQuery(db, {
      table: "invoices",
      actor: UUID.toLowerCase(),
      record: UUID,
      from: "2026-10-01",
      to: "2026-10-07",
    });
    expect(calls.slice(0, 2)).toEqual([
      "from(audit_log)",
      expect.stringMatching(/^select\(".*occurred_at.*changed_columns.*reason"\)$/),
    ]);
    expect(calls.slice(2)).toEqual([
      'eq("table_name", "invoices")',
      `eq("actor_id", "${UUID.toLowerCase()}")`,
      `eq("record_id", "${UUID.toLowerCase()}")`,
      'gte("occurred_at", "2026-10-01T03:00:00.000Z")',
      'lt("occurred_at", "2026-10-08T03:00:00.000Z")',
      'order("occurred_at", {"ascending":false})',
      'order("id", {"ascending":false})',
    ]);
  });

  it("reads one row more than a page to know whether there is a next page", async () => {
    const rows = Array.from({ length: AUDIT_PAGE_SIZE + 1 }, (_, i) => ({ id: i }));
    const { db, calls } = recorder({ data: rows, error: null });
    const page = await loadAuditPage(db, {}, 3);
    expect(calls.at(-1)).toBe(`range(${2 * AUDIT_PAGE_SIZE}, ${3 * AUDIT_PAGE_SIZE})`);
    expect(page.entries).toHaveLength(AUDIT_PAGE_SIZE);
    expect(page.hasMore).toBe(true);
  });

  it("asks nothing for an impossible range, and passes errors on", async () => {
    const { db, calls } = recorder();
    expect(await loadAuditPage(db, { from: "2026-10-09", to: "2026-10-01" }, 1)).toEqual({
      entries: [],
      hasMore: false,
    });
    expect(calls).toEqual([]);
    const failing = recorder({ data: [], error: { code: "42501" } });
    await expect(loadAuditPage(failing.db, {}, 1)).rejects.toEqual({ code: "42501" });
  });
});

describe("normalizeRecordId()", () => {
  it("lower-cases uuids and trims other ids", () => {
    expect(normalizeRecordId(` ${UUID} `)).toBe(UUID.toLowerCase());
    expect(normalizeRecordId(" 2026 ")).toBe("2026");
  });
});

const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: 1,
  occurred_at: "2026-10-07T12:00:00Z",
  actor_id: null,
  table_name: "orders",
  record_id: "0b5a7c1e-0000-4000-8000-000000000001",
  action: "UPDATE",
  old_data: null,
  new_data: null,
  changed_columns: null,
  reason: null,
  ...over,
});

describe("auditDiff()", () => {
  it("puts the changed fields of an update first, then the rest", () => {
    const rows = auditDiff(
      entry({
        old_data: { status: "registered", reference: "ORD-1", carrier: null },
        new_data: { status: "in_transit_air", reference: "ORD-1", carrier: "UPS" },
        changed_columns: ["carrier", "status"],
      }),
    );
    expect(rows).toEqual([
      { key: "carrier", before: null, after: "UPS", changed: true },
      { key: "status", before: "registered", after: "in_transit_air", changed: true },
      { key: "reference", before: "ORD-1", after: "ORD-1", changed: false },
    ]);
  });

  it("compares the values when changed_columns is missing", () => {
    const rows = auditDiff(
      entry({
        old_data: { a: 1, b: { x: 1 } },
        new_data: { a: 1, b: { x: 2 } },
      }),
    );
    expect(rows.filter((r) => r.changed).map((r) => r.key)).toEqual(["b"]);
  });

  it("shows what an insert created and what a delete removed", () => {
    expect(
      auditDiff(entry({ action: "INSERT", new_data: { b: 2, a: 1 } })).map((r) => [
        r.key,
        r.before,
        r.after,
      ]),
    ).toEqual([
      ["a", undefined, 1],
      ["b", undefined, 2],
    ]);
    expect(auditDiff(entry({ action: "DELETE", old_data: { a: 1 } }))).toEqual([
      { key: "a", before: 1, after: undefined, changed: true },
    ]);
  });
});

describe("labels", () => {
  it("names tables and actions in Dutch, unknown ones as they are", () => {
    expect(auditTableLabel("invoice_items")).toBe("Factuurregels");
    expect(auditTableLabel("team_login")).toBe("Teamlogins");
    expect(auditTableLabel("something_new")).toBe("something_new");
    expect(auditActionLabel("INSERT")).toBe("Aangemaakt");
    expect(auditActionLabel("DELETE")).toBe("Verwijderd");
    expect(auditActionLabel("TRUNCATE")).toBe("TRUNCATE");
  });

  it("formats values: leeg for null, JSON for objects", () => {
    expect(formatAuditValue(null)).toBe("leeg");
    expect(formatAuditValue(undefined)).toBe("");
    expect(formatAuditValue("tekst")).toBe("tekst");
    expect(formatAuditValue(12.5)).toBe("12.5");
    expect(formatAuditValue(false)).toBe("false");
    expect(formatAuditValue({ a: [1, 2] })).toBe('{"a":[1,2]}');
  });

  it("labels a record the way people know it", () => {
    expect(
      auditRecordLabel(
        entry({
          table_name: "customers",
          new_data: { customer_code: "GR00042", full_name: "Maria Pinas" },
        }),
      ),
    ).toBe("GR00042 · Maria Pinas");
    expect(
      auditRecordLabel(entry({ table_name: "invoices", new_data: { invoice_number: null } })),
    ).toBe("Concept");
    expect(auditRecordLabel(entry({ table_name: "payments", old_data: { amount: 1234.5 } }))).toBe(
      "Betaling 1.234,50",
    );
    expect(
      auditRecordLabel(
        entry({ table_name: "invoice_number_counters", record_id: "2026", new_data: {} }),
      ),
    ).toBe("2026");
    // The settings singleton's id is the boolean true: never show "true" (review P9).
    expect(
      auditRecordLabel(
        entry({ table_name: "company_settings", record_id: "true", new_data: { id: true } }),
      ),
    ).toBe("Bedrijfsinstellingen");
    expect(
      auditRecordLabel(
        entry({
          table_name: "warehouse_addresses",
          record_id: "0b5a7c1e-0000-4000-8000-0000000000aa",
          new_data: { label: "Luchtvracht – Miami", city: "Miami" },
        }),
      ),
    ).toBe("Luchtvracht – Miami · Miami");
  });
});

describe("auditRecordLink()", () => {
  const id = "0b5a7c1e-0000-4000-8000-000000000001";
  const invoiceId = "0b5a7c1e-0000-4000-8000-000000000002";

  it("links a record to its page, and lines and payments to their invoice", () => {
    expect(auditRecordLink(entry({ table_name: "customers", record_id: id }))).toEqual({
      to: "/admin/klanten/$id",
      id,
    });
    expect(auditRecordLink(entry({ table_name: "shipments", record_id: id }))).toEqual({
      to: "/admin/zendingen/$id",
      id,
    });
    expect(
      auditRecordLink(
        entry({ table_name: "payments", record_id: id, new_data: { invoice_id: invoiceId } }),
      ),
    ).toEqual({ to: "/admin/facturen/$id", id: invoiceId });
    expect(
      auditRecordLink(
        entry({
          table_name: "invoice_items",
          action: "DELETE",
          old_data: { invoice_id: invoiceId },
        }),
      ),
    ).toEqual({ to: "/admin/facturen/$id", id: invoiceId });
  });

  it("does not link to a deleted record or to tables without a page", () => {
    expect(
      auditRecordLink(entry({ table_name: "invoices", action: "DELETE", record_id: id })),
    ).toBe(null);
    expect(auditRecordLink(entry({ table_name: "company_settings", record_id: "1" }))).toBe(null);
    expect(auditRecordLink(entry({ table_name: "orders", record_id: "not-a-uuid" }))).toBe(null);
  });
});
