import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import type { InvitationSummary } from "./customer-actions";
import {
  buildCustomerList,
  buildCustomerTimeline,
  currentInvitation,
  customerSearchSchema,
  filterCustomers,
  matchesCustomerSearch,
  openInvoicesByCustomer,
  outstandingOf,
  shipmentsOfOrders,
  type AuditEntry,
  type CustomerListRow,
} from "./customers";

const row = (n: number, extra: Partial<CustomerListRow> = {}): CustomerListRow => ({
  id: `c${n}`,
  customer_number: n,
  customer_code: `GR${String(n).padStart(5, "0")}`,
  full_name: `Klant ${n}`,
  company_name: null,
  account_type: "personal",
  status: "active",
  user_id: null,
  email: null,
  phone: null,
  created_at: `2026-0${(n % 9) + 1}-01T12:00:00Z`,
  ...extra,
});

const maria = row(17, {
  full_name: "Maria Pinas",
  email: "maria.pinas@example.com",
  phone: "+597 889 7500",
  user_id: "u17",
  created_at: "2026-01-05T12:00:00Z",
});
const eneas = row(42, {
  full_name: "Énéas Doorson",
  phone: "+5978551234",
  status: "invited",
  created_at: "2026-03-05T12:00:00Z",
});
const biharie = row(107, {
  full_name: "Johan Biharie",
  company_name: "Biharie Bouwmaterialen N.V.",
  account_type: "business",
  status: "disabled",
  created_at: "2026-09-05T12:00:00Z",
});

describe("matchesCustomerSearch(): the list's one search box", () => {
  it("finds a GR code however it is typed", () => {
    for (const q of ["gr 17", "GR00017", "17", " gr00017 "]) {
      expect(matchesCustomerSearch(maria, q), q).toBe(true);
    }
    expect(matchesCustomerSearch(eneas, "gr 17")).toBe(false);
  });

  it("finds names and companies without accents or case", () => {
    expect(matchesCustomerSearch(eneas, "eneas")).toBe(true);
    expect(matchesCustomerSearch(biharie, "bouwmaterialen")).toBe(true);
    expect(matchesCustomerSearch(biharie, "johan")).toBe(true);
  });

  it("finds an e-mail address", () => {
    expect(matchesCustomerSearch(maria, "maria.pinas@")).toBe(true);
  });

  it("finds a phone number with or without +597, spaces or dashes", () => {
    for (const q of ["889-7500", "8897500", "+597 8897500", "5978897500"]) {
      expect(matchesCustomerSearch(maria, q), q).toBe(true);
    }
    expect(matchesCustomerSearch(eneas, "855 1234")).toBe(true);
    expect(matchesCustomerSearch(maria, "855 1234")).toBe(false);
  });
});

describe("filterCustomers()", () => {
  const list = buildCustomerList([maria, eneas, biharie], {
    orders: new Map([["c17", 3]]),
    invoices: new Map([
      ["c42", { count: 1, overdue: 1, outstanding: [{ currency: "USD", amount: 10 }] }],
    ]),
  });

  it("filters on status, account type, login and open invoices", () => {
    const ids = (search: Parameters<typeof filterCustomers>[1]) =>
      filterCustomers(list, search).map((c) => c.customer_code);
    expect(ids({ status: "invited" })).toEqual(["GR00042"]);
    expect(ids({ type: "business" })).toEqual(["GR00107"]);
    expect(ids({ login: "yes" })).toEqual(["GR00017"]);
    expect(ids({ login: "no" })).toEqual(["GR00042", "GR00107"]);
    expect(ids({ openInvoice: true })).toEqual(["GR00042"]);
  });

  it("sorts by GR code by default, by name, or by creation date", () => {
    const codes = (sort: "code" | "name" | "newest" | "oldest" | undefined) =>
      filterCustomers(list, { sort }).map((c) => c.customer_code);
    expect(codes(undefined)).toEqual(["GR00017", "GR00042", "GR00107"]);
    // Business customers sort by company name: "Biharie …" before "Énéas", "Maria".
    expect(codes("name")).toEqual(["GR00107", "GR00042", "GR00017"]);
    expect(codes("newest")[0]).toBe("GR00107");
    expect(codes("oldest")[0]).toBe("GR00017");
  });

  it("counts orders, and says 'unknown' (null) while extras are not loaded", () => {
    expect(list.find((c) => c.id === "c17")?.orderCount).toBe(3);
    expect(list.find((c) => c.id === "c42")?.orderCount).toBe(0);
    const bare = buildCustomerList([maria], {});
    expect(bare[0]).toMatchObject({
      orderCount: null,
      openInvoices: null,
      invoicesKnown: false,
      invitation: null,
    });
    expect(list.find((c) => c.id === "c17")).toMatchObject({
      openInvoices: null,
      invoicesKnown: true,
    });
  });

  it("knows the state of the open invitation", () => {
    const [withInvite] = buildCustomerList(
      [eneas],
      {
        invitations: new Map([
          [
            "c42",
            {
              id: "i1",
              customer_id: "c42",
              expires_at: "2026-10-01T00:00:00Z",
              last_sent_at: "2026-09-24T00:00:00Z",
              send_count: 1,
              accepted_at: null,
              revoked_at: null,
            },
          ],
        ]),
      },
      new Date("2026-10-07T00:00:00Z"),
    );
    expect(withInvite?.invitationState).toBe("expired");
  });

  it("drops invalid search params instead of failing the page", () => {
    expect(
      customerSearchSchema.parse({ q: 17, status: "weird", login: "maybe", openInvoice: "true" }),
    ).toEqual({ q: "17", openInvoice: true });
  });
});

describe("open invoices per customer (SPEC §35.10: per currency)", () => {
  it("groups balances per customer and currency, never adding currencies", () => {
    const map = openInvoicesByCustomer([
      { customer_id: "c1", currency: "USD", balance_due: 245, is_overdue: true },
      { customer_id: "c1", currency: "SRD", balance_due: 1250, is_overdue: false },
      { customer_id: "c1", currency: "USD", balance_due: 0.1, is_overdue: false },
      { customer_id: "c2", currency: "USD", balance_due: 0, is_overdue: false },
    ]);
    expect(map.get("c1")).toEqual({
      count: 3,
      overdue: 1,
      outstanding: [
        { currency: "USD", amount: 245.1 },
        { currency: "SRD", amount: 1250 },
      ],
    });
    expect(map.has("c2")).toBe(false);
  });

  it("outstandingOf() only counts open and partially paid invoices", () => {
    expect(
      outstandingOf([
        { status: "open", currency: "USD", balance_due: 10 },
        { status: "partially_paid", currency: "USD", balance_due: 5 },
        { status: "draft", currency: "USD", balance_due: 99 },
        { status: "paid", currency: "EUR", balance_due: 0 },
      ] as unknown as Parameters<typeof outstandingOf>[0]),
    ).toEqual([{ currency: "USD", amount: 15 }]);
  });
});

describe("shipmentsOfOrders()", () => {
  it("lists each shipment once with its orders, latest departure first", () => {
    const ship = (id: string, departed: string | null) => ({
      id,
      shipment_number: id.toUpperCase(),
      service_type: "air" as const,
      departed_at: departed,
      arrived_at: null,
    });
    const a = ship("a", "2026-09-01T00:00:00Z");
    const b = ship("b", "2026-10-01T00:00:00Z");
    expect(
      shipmentsOfOrders([
        { reference: "ORD-1", shipment: a },
        { reference: "ORD-2", shipment: b },
        { reference: "ORD-3", shipment: a },
        { reference: "ORD-4", shipment: null },
      ]).map((s) => [s.shipment_number, s.orderReferences]),
    ).toEqual([
      ["B", ["ORD-2"]],
      ["A", ["ORD-1", "ORD-3"]],
    ]);
  });
});

const invitation = (extra: Partial<InvitationSummary> = {}): InvitationSummary => ({
  id: "i1",
  kind: "customer",
  customer_id: "c42",
  staff_role: null,
  email: "eneas@example.com",
  expires_at: "2026-10-14T00:00:00Z",
  last_sent_at: "2026-10-07T00:00:00Z",
  send_count: 1,
  accepted_at: null,
  accepted_by: null,
  revoked_at: null,
  created_at: "2026-10-07T00:00:00Z",
  created_by: "staff1",
  ...extra,
});

describe("currentInvitation()", () => {
  it("prefers the open invitation, else the latest", () => {
    const old = invitation({ id: "old", revoked_at: "2026-10-02T00:00:00Z" });
    const open = invitation({ id: "open" });
    expect(currentInvitation([old, open])?.id).toBe("open");
    expect(currentInvitation([old])?.id).toBe("old");
    expect(currentInvitation([])).toBeNull();
  });
});

describe("buildCustomerTimeline() (SPEC §35.13 subset)", () => {
  const customer = {
    id: "c42",
    created_at: "2026-10-01T00:00:00Z",
    created_by: "staff1",
    customer_code: "GR00042",
    status: "disabled" as const,
    disabled_at: "2026-10-06T00:00:00Z",
    disabled_by: "admin1",
    disabled_reason: "Verhuisd",
  };

  it("without the audit log (staff): created, invitations and the disabled state", () => {
    const events = buildCustomerTimeline({
      customer,
      invitations: [
        invitation({
          send_count: 2,
          last_sent_at: "2026-10-03T00:00:00Z",
          created_at: "2026-10-02T00:00:00Z",
          revoked_at: "2026-10-05T00:00:00Z",
        }),
      ],
    });
    expect(events.map((e) => [e.kind, e.actorId])).toEqual([
      ["created", "staff1"],
      ["invited", "staff1"],
      ["invitation_resent", null],
      ["invitation_revoked", null],
      ["disabled", "admin1"],
    ]);
    expect(events.at(-1)?.detail).toContain("Verhuisd");
  });

  it("from the audit log (admins): code changes with the reason, edits by field, e-mail changes", () => {
    const entry = (id: number, extra: Partial<AuditEntry>): AuditEntry => ({
      id,
      occurred_at: `2026-10-0${id}T00:00:00Z`,
      actor_id: "admin1",
      table_name: "customers",
      record_id: "c42",
      action: "UPDATE",
      old_data: null,
      new_data: null,
      changed_columns: null,
      reason: null,
      ...extra,
    });
    const events = buildCustomerTimeline({
      customer,
      invitations: [],
      audit: [
        entry(1, {
          action: "INSERT",
          actor_id: "staff1",
          new_data: { customer_code: "GR00142" },
        }),
        entry(2, {
          changed_columns: ["customer_code", "customer_number"],
          old_data: { customer_code: "GR00142" },
          new_data: { customer_code: "GR00042" },
          reason: "Bestaande klant",
        }),
        entry(3, {
          changed_columns: ["email", "phone", "address"],
          old_data: { email: "a@example.com" },
          new_data: { email: "b@example.com" },
        }),
        entry(4, {
          changed_columns: ["disabled_at", "disabled_by", "disabled_reason", "status"],
          old_data: { status: "active" },
          new_data: { status: "disabled", disabled_reason: "Verhuisd" },
        }),
        entry(5, {
          table_name: "invitations",
          record_id: "i1",
          action: "INSERT",
          new_data: { email: "b@example.com" },
        }),
        entry(6, {
          table_name: "invitations",
          record_id: "i1",
          changed_columns: ["last_sent_at", "send_count", "expires_at"],
          new_data: {},
        }),
        entry(7, {
          changed_columns: ["status", "updated_by", "user_id"],
          old_data: { status: "invited", user_id: null },
          new_data: { status: "active", user_id: "u42" },
        }),
      ],
    });
    expect(events.map((e) => e.kind)).toEqual([
      "created",
      "code_changed",
      "email_changed",
      "edited",
      "disabled",
      "invited",
      "invitation_resent",
      "login_linked",
    ]);
    expect(events[1]?.detail).toBe("GR00142 → GR00042 · reden: Bestaande klant");
    expect(events[2]?.detail).toBe("a@example.com → b@example.com");
    expect(events[3]?.detail).toBe("Telefoon / WhatsApp, Adres");
    expect(events[4]?.detail).toBe("reden: Verhuisd");
  });
});
