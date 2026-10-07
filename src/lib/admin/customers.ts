import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { Constants, type Database } from "@/integrations/supabase/types";
import { INVITATION_COLUMNS, type InvitationSummary } from "@/lib/admin/customer-actions";
import { invitationState, type InvitationState } from "@/lib/admin/invitations";
import { adminKeys } from "@/lib/admin/keys";
import {
  ADMIN_ORDER_LIST_COLUMNS,
  STAFF_DOCUMENT_COLUMNS,
  allPages,
  customerDisplayName,
  fold,
  parseCustomerCode,
  searchFlag,
  searchText,
  type StaffOrderDocument,
} from "@/lib/admin/orders";
import { t } from "@/lib/i18n";
import { phoneDigits } from "@/lib/phone";
import {
  OPEN_INVOICE_STATUSES,
  totalsByCurrency,
  type CurrencyAmount,
} from "@/lib/portal/invoices";
import { isUuid } from "@/lib/portal/orders";

/**
 * Customers as staff see them (SPEC §13, §35.5): the list with its search,
 * filters and sort, and everything the customer page shows. Read with the
 * staff member's own client (RLS: is_staff sees every customer); writes are
 * in customer-actions.ts.
 */

type Tables = Database["public"]["Tables"];
type OverviewRow = Database["public"]["Views"]["invoice_overview"]["Row"];
export type CustomerRow = Tables["customers"]["Row"];
export type CustomerStatus = Database["public"]["Enums"]["customer_status"];
export type AccountType = Database["public"]["Enums"]["account_type"];

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export type CustomerListRow = Pick<
  CustomerRow,
  | "id"
  | "customer_number"
  | "customer_code"
  | "full_name"
  | "company_name"
  | "account_type"
  | "status"
  | "user_id"
  | "email"
  | "phone"
  | "created_at"
>;

const LIST_COLUMNS =
  "id, customer_number, customer_code, full_name, company_name, account_type, status, user_id, email, phone, created_at" as const;

/** Every customer, by GR number (pages past PostgREST's row cap). */
export const customerListQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.customerList(userId),
    staleTime: 30_000,
    queryFn: () =>
      allPages<CustomerListRow>((from, to) =>
        supabase.from("customers").select(LIST_COLUMNS).order("customer_number").range(from, to),
      ),
  });

/** Orders per customer id (one light read of customer_id per order). */
export const ordersPerCustomerQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.ordersPerCustomer(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<ReadonlyMap<string, number>> => {
      const rows = await allPages<{ customer_id: string }>((from, to) =>
        supabase.from("orders").select("customer_id").order("id").range(from, to),
      );
      const counts = new Map<string, number>();
      for (const r of rows) counts.set(r.customer_id, (counts.get(r.customer_id) ?? 0) + 1);
      return counts;
    },
  });

export interface CustomerOpenInvoices {
  count: number;
  overdue: number;
  /** Balance per currency, never summed across currencies (SPEC §35.10). */
  outstanding: CurrencyAmount[];
}

/** Issued invoices that still have a balance, per customer (invoice_overview). */
export const customerOpenInvoicesQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.customerListInvoices(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<ReadonlyMap<string, CustomerOpenInvoices>> => {
      const rows = await allPages<
        Pick<OverviewRow, "id" | "customer_id" | "currency" | "balance_due" | "is_overdue">
      >((from, to) =>
        supabase
          .from("invoice_overview")
          .select("id, customer_id, currency, balance_due, is_overdue")
          .in("status", OPEN_INVOICE_STATUSES)
          .gt("balance_due", 0)
          .order("id")
          .range(from, to),
      );
      return openInvoicesByCustomer(rows);
    },
  });

export function openInvoicesByCustomer(
  rows: readonly Pick<OverviewRow, "customer_id" | "currency" | "balance_due" | "is_overdue">[],
): ReadonlyMap<string, CustomerOpenInvoices> {
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.customer_id || !r.balance_due || Number(r.balance_due) <= 0) continue;
    groups.set(r.customer_id, [...(groups.get(r.customer_id) ?? []), r]);
  }
  return new Map(
    [...groups].map(([id, list]) => [
      id,
      {
        count: list.length,
        overdue: list.filter((r) => r.is_overdue === true).length,
        outstanding: totalsByCurrency(
          list.map((r) => ({ currency: r.currency, amount: r.balance_due })),
        ),
      },
    ]),
  );
}

export type ListInvitation = Pick<
  InvitationSummary,
  "id" | "customer_id" | "expires_at" | "last_sent_at" | "send_count" | "accepted_at" | "revoked_at"
>;

/** The open (not accepted, not revoked) customer invitations, by customer id. */
export const customerOpenInvitationsQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.customerListInvitations(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<ReadonlyMap<string, ListInvitation>> => {
      const rows = await allPages<ListInvitation>((from, to) =>
        supabase
          .from("invitations")
          .select("id, customer_id, expires_at, last_sent_at, send_count, accepted_at, revoked_at")
          .eq("kind", "customer")
          .is("accepted_at", null)
          .is("revoked_at", null)
          .order("id")
          .range(from, to),
      );
      return new Map(rows.flatMap((r) => (r.customer_id ? [[r.customer_id, r] as const] : [])));
    },
  });

/** What the list shows per customer. */
export interface CustomerListItem extends CustomerListRow {
  /** null while the orders could not be loaded. */
  orderCount: number | null;
  /** null: nothing open (or not known yet, see invoicesKnown). */
  openInvoices: CustomerOpenInvoices | null;
  invoicesKnown: boolean;
  /** The open invitation, or null; "unknown" while invitations could not be loaded. */
  invitation: ListInvitation | null;
  invitationState: InvitationState | null;
}

export function buildCustomerList(
  customers: readonly CustomerListRow[],
  extras: {
    orders?: ReadonlyMap<string, number> | undefined;
    invoices?: ReadonlyMap<string, CustomerOpenInvoices> | undefined;
    invitations?: ReadonlyMap<string, ListInvitation> | undefined;
  },
  now: Date = new Date(),
): CustomerListItem[] {
  return customers.map((c) => {
    const invitation = extras.invitations?.get(c.id) ?? null;
    return {
      ...c,
      orderCount: extras.orders ? (extras.orders.get(c.id) ?? 0) : null,
      openInvoices: extras.invoices?.get(c.id) ?? null,
      invoicesKnown: extras.invoices !== undefined,
      invitation,
      invitationState: invitation ? invitationState(invitation, now) : null,
    };
  });
}

export const CUSTOMER_STATUSES = Constants.public.Enums.customer_status;
export const CUSTOMER_SORTS = ["code", "name", "newest", "oldest"] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

/** Search params of /admin/klanten; invalid values are dropped, never an error page. */
export const customerSearchSchema = z.object({
  q: searchText,
  status: z.enum(CUSTOMER_STATUSES).optional().catch(undefined),
  type: z.enum(Constants.public.Enums.account_type).optional().catch(undefined),
  login: z.enum(["yes", "no"]).optional().catch(undefined),
  /** Only customers with an issued invoice that still has a balance. */
  openInvoice: searchFlag,
  sort: z.enum(CUSTOMER_SORTS).optional().catch(undefined),
});
export type CustomerSearch = z.infer<typeof customerSearchSchema>;

export function hasCustomerFilters(search: CustomerSearch): boolean {
  return Boolean(search.q || search.status || search.type || search.login || search.openInvoice);
}

type SearchableCustomer = Pick<
  CustomerListRow,
  "customer_code" | "full_name" | "company_name" | "email" | "phone"
>;

/**
 * The list's search box (SPEC §26: find a customer quickly): a GR code as
 * staff type it ("gr 17", "GR00017", "17"), a name or company without
 * accents, an e-mail, or a phone number with or without +597, spaces or
 * dashes.
 */
export function matchesCustomerSearch(customer: SearchableCustomer, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const code = parseCustomerCode(q);
  if (code && customer.customer_code === code) return true;

  const needle = fold(q);
  const text = [
    customer.customer_code,
    customer.full_name,
    customer.company_name,
    customer.email,
    customer.phone,
  ];
  if (text.some((f) => (f ? fold(f).includes(needle) : false))) return true;

  // Phone numbers: digits only, so "889-7500", "+597 8897500" and "8897500" all match.
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 5 && customer.phone) {
    const phone = (phoneDigits(customer.phone) ?? customer.phone.replace(/\D/g, "")).replace(
      /^597/,
      "",
    );
    const typed = digits.replace(/^597/, "");
    if (typed && phone.includes(typed)) return true;
  }
  return false;
}

/** Applies the list's search, filters and sort (newest = most recently created). */
export function filterCustomers(
  customers: readonly CustomerListItem[],
  search: CustomerSearch,
): CustomerListItem[] {
  const { q, status, type, login, openInvoice, sort } = search;
  const result = customers.filter(
    (c) =>
      (!q || matchesCustomerSearch(c, q)) &&
      (!status || c.status === status) &&
      (!type || c.account_type === type) &&
      (!login || (login === "yes") === (c.user_id !== null)) &&
      (!openInvoice || (c.openInvoices?.count ?? 0) > 0),
  );
  const created = (c: CustomerListItem) => Date.parse(c.created_at);
  const name = (c: CustomerListItem) => fold(customerDisplayName(c));
  switch (sort) {
    case "name":
      return result.sort(
        (a, b) => name(a).localeCompare(name(b), "nl") || a.customer_number - b.customer_number,
      );
    case "newest":
      return result.sort(
        (a, b) => created(b) - created(a) || b.customer_number - a.customer_number,
      );
    case "oldest":
      return result.sort(
        (a, b) => created(a) - created(b) || a.customer_number - b.customer_number,
      );
    default:
      return result.sort((a, b) => a.customer_number - b.customer_number);
  }
}

/** Badge tone of a customer status (text plus icon, never colour alone). */
export function customerStatusTone(status: CustomerStatus): "success" | "warning" | "neutral" {
  return status === "active" ? "success" : status === "invited" ? "warning" : "neutral";
}

// ---------------------------------------------------------------------------
// "Klant toevoegen": the next number and who holds a typed code
// ---------------------------------------------------------------------------

export const nextCustomerNumberQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.nextCustomerNumber(userId),
    staleTime: 10_000,
    queryFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc("peek_next_customer_number");
      if (error) throw error;
      return `GR${String(data).padStart(5, "0")}`;
    },
  });

export type CodeHolder = Pick<CustomerRow, "id" | "customer_code" | "full_name"> | null;

/**
 * Who already has this GR code (live check while typing). Numbers given up
 * by a code change are not visible to staff; the database still refuses them
 * on save ("… is eerder gebruikt").
 */
export const customerCodeHolderQueryOptions = (userId: string, code: string) =>
  queryOptions({
    queryKey: adminKeys.customerCodeHolder(userId, code),
    staleTime: 10_000,
    queryFn: async (): Promise<CodeHolder> => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, customer_code, full_name")
        .eq("customer_code", code)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

// ---------------------------------------------------------------------------
// One customer (/admin/klanten/$id)
// ---------------------------------------------------------------------------

export const customerQueryOptions = (userId: string, customerId: string) =>
  queryOptions({
    queryKey: adminKeys.customer(userId, customerId),
    staleTime: 10_000,
    queryFn: async (): Promise<CustomerRow | null> => {
      if (!isUuid(customerId)) return null;
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("id", customerId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

async function fetchCustomerOrders(customerId: string) {
  const { data, error } = await supabase
    .from("orders")
    .select(
      `${ADMIN_ORDER_LIST_COLUMNS}, shipment:shipments(id, shipment_number, service_type, departed_at, arrived_at)`,
    )
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .order("id");
  if (error) throw error;
  return data;
}

export type CustomerOrder = Awaited<ReturnType<typeof fetchCustomerOrders>>[number];

/** The customer's orders, newest first, with the shipment each one travels in. */
export const customerOrdersQueryOptions = (userId: string, customerId: string) =>
  queryOptions({
    queryKey: adminKeys.customerOrders(userId, customerId),
    staleTime: 15_000,
    queryFn: () => (isUuid(customerId) ? fetchCustomerOrders(customerId) : Promise.resolve([])),
  });

export interface CustomerShipment {
  id: string;
  shipment_number: string;
  service_type: Database["public"]["Enums"]["service_type"];
  departed_at: string | null;
  arrived_at: string | null;
  orderReferences: string[];
}

/** The shipments the customer's orders travel(led) in, latest departure first. */
export function shipmentsOfOrders(
  orders: readonly Pick<CustomerOrder, "reference" | "shipment">[],
): CustomerShipment[] {
  const byId = new Map<string, CustomerShipment>();
  for (const o of orders) {
    if (!o.shipment) continue;
    const entry = byId.get(o.shipment.id) ?? { ...o.shipment, orderReferences: [] };
    entry.orderReferences.push(o.reference);
    byId.set(o.shipment.id, entry);
  }
  const when = (s: CustomerShipment) => Date.parse(s.departed_at ?? s.arrived_at ?? "") || 0;
  return [...byId.values()].sort(
    (a, b) => when(b) - when(a) || b.shipment_number.localeCompare(a.shipment_number),
  );
}

export type CustomerInvoice = Pick<
  OverviewRow,
  | "id"
  | "invoice_number"
  | "status"
  | "is_overdue"
  | "days_overdue"
  | "balance_due"
  | "amount_paid"
  | "currency"
  | "total_amount"
  | "invoice_date"
  | "due_date"
  | "paid_at"
  | "cancelled_at"
>;

export type CustomerPayment = Pick<
  Tables["payments"]["Row"],
  "id" | "invoice_id" | "amount" | "paid_on" | "method" | "reference" | "voided_at"
>;

/** Invoices (drafts and cancelled ones too: staff see them) and their payments, read-only until P6/P7. */
export const customerInvoicesQueryOptions = (userId: string, customerId: string) =>
  queryOptions({
    queryKey: adminKeys.customerInvoices(userId, customerId),
    staleTime: 30_000,
    queryFn: async (): Promise<{ invoices: CustomerInvoice[]; payments: CustomerPayment[] }> => {
      if (!isUuid(customerId)) return { invoices: [], payments: [] };
      const { data: invoices, error } = await supabase
        .from("invoice_overview")
        .select(
          "id, invoice_number, status, is_overdue, days_overdue, balance_due, amount_paid, currency, total_amount, invoice_date, due_date, paid_at, cancelled_at",
        )
        .eq("customer_id", customerId)
        .order("invoice_date", { ascending: false })
        .order("invoice_number", { ascending: false });
      if (error) throw error;
      const ids = invoices.flatMap((i) => (i.id ? [i.id] : []));
      if (ids.length === 0) return { invoices, payments: [] };
      const payments = await supabase
        .from("payments")
        .select("id, invoice_id, amount, paid_on, method, reference, voided_at")
        .in("invoice_id", ids)
        .order("paid_on", { ascending: false })
        .order("created_at", { ascending: false });
      if (payments.error) throw payments.error;
      return { invoices, payments: payments.data };
    },
  });

/** "Openstaand: USD 245,00 · SRD 1.250,00" for the customer's issued invoices. */
export function outstandingOf(invoices: readonly CustomerInvoice[]): CurrencyAmount[] {
  return totalsByCurrency(
    invoices
      .filter((i) => i.status === "open" || i.status === "partially_paid")
      .map((i) => ({ currency: i.currency, amount: i.balance_due })),
  );
}

export type CustomerDocument = StaffOrderDocument & { order: { reference: string } | null };

/** Every document of the customer's orders, newest first. */
export const customerDocumentsQueryOptions = (userId: string, customerId: string) =>
  queryOptions({
    queryKey: adminKeys.customerDocuments(userId, customerId),
    staleTime: 30_000,
    queryFn: async (): Promise<CustomerDocument[]> => {
      if (!isUuid(customerId)) return [];
      const { data, error } = await supabase
        .from("order_documents")
        .select(`${STAFF_DOCUMENT_COLUMNS}, order:orders(reference)`)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

export type CustomerNote = Pick<
  Tables["internal_notes"]["Row"],
  "id" | "body" | "created_at" | "created_by" | "order_id"
> & { order: { reference: string } | null };

/** Staff-only notes about the customer and about each of their orders (internal_notes). */
export const customerNotesQueryOptions = (userId: string, customerId: string) =>
  queryOptions({
    queryKey: adminKeys.customerNotes(userId, customerId),
    staleTime: 30_000,
    queryFn: async (): Promise<CustomerNote[]> => {
      if (!isUuid(customerId)) return [];
      const { data, error } = await supabase
        .from("internal_notes")
        .select("id, body, created_at, created_by, order_id, order:orders(reference)")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

/** Every invitation the customer ever had, newest first (staff read invitations; never the hash). */
export const customerInvitationsQueryOptions = (userId: string, customerId: string) =>
  queryOptions({
    queryKey: adminKeys.customerInvitations(userId, customerId),
    staleTime: 10_000,
    queryFn: async (): Promise<InvitationSummary[]> => {
      if (!isUuid(customerId)) return [];
      const { data, error } = await supabase
        .from("invitations")
        .select(INVITATION_COLUMNS)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

/** The invitation that matters now: the open one, else the latest. */
export function currentInvitation(
  invitations: readonly InvitationSummary[],
): InvitationSummary | null {
  return invitations.find((i) => !i.accepted_at && !i.revoked_at) ?? invitations[0] ?? null;
}

export type AuditEntry = Pick<
  Tables["audit_log"]["Row"],
  | "id"
  | "occurred_at"
  | "actor_id"
  | "table_name"
  | "record_id"
  | "action"
  | "old_data"
  | "new_data"
  | "changed_columns"
  | "reason"
>;

/**
 * The customer's audit trail (admins only: audit_log is admin-read, SPEC
 * §35.13): the customer row and its invitations. Staff get a timeline built
 * from the rows they can read (buildCustomerTimeline without audit).
 */
export const customerAuditQueryOptions = (
  userId: string,
  customerId: string,
  invitationIds: readonly string[],
) =>
  queryOptions({
    queryKey: [...adminKeys.customerAudit(userId, customerId), [...invitationIds].sort().join(",")],
    staleTime: 30_000,
    queryFn: async (): Promise<AuditEntry[]> => {
      if (!isUuid(customerId)) return [];
      const columns =
        "id, occurred_at, actor_id, table_name, record_id, action, old_data, new_data, changed_columns, reason";
      const [own, invites] = await Promise.all([
        supabase
          .from("audit_log")
          .select(columns)
          .eq("table_name", "customers")
          .eq("record_id", customerId)
          .order("occurred_at")
          .order("id"),
        invitationIds.length === 0
          ? Promise.resolve({ data: [] as AuditEntry[], error: null })
          : supabase
              .from("audit_log")
              .select(columns)
              .eq("table_name", "invitations")
              .in("record_id", [...invitationIds])
              .order("occurred_at")
              .order("id"),
      ]);
      if (own.error) throw own.error;
      if (invites.error) throw invites.error;
      return [...own.data, ...invites.data].sort(
        (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || a.id - b.id,
      );
    },
  });

// ---------------------------------------------------------------------------
// Timeline (SPEC §35.13 subset: created, edited, disabled, code assigned/changed)
// ---------------------------------------------------------------------------

export type TimelineKind =
  | "created"
  | "edited"
  | "email_changed"
  | "code_changed"
  | "disabled"
  | "enabled"
  | "login_linked"
  | "invited"
  | "invitation_resent"
  | "invitation_accepted"
  | "invitation_revoked";

export interface TimelineEvent {
  key: string;
  at: string;
  kind: TimelineKind;
  actorId: string | null;
  /** Readable Dutch detail ("GR00017 → GR00123", the changed fields, the reason). */
  detail: string | null;
}

type FieldKey =
  | "admin.customers.fields.fullName"
  | "admin.customers.fields.companyName"
  | "admin.customers.fields.accountType"
  | "admin.customers.fields.phone"
  | "admin.customers.fields.email"
  | "admin.customers.fields.address"
  | "admin.customers.fields.district"
  | "admin.customers.fields.kkfNumber"
  | "admin.customers.fields.contactPerson";

/** Fields of the customer row a timeline mentions by name. */
const FIELD_LABELS: Partial<Record<string, FieldKey>> = {
  full_name: "admin.customers.fields.fullName",
  company_name: "admin.customers.fields.companyName",
  account_type: "admin.customers.fields.accountType",
  phone: "admin.customers.fields.phone",
  email: "admin.customers.fields.email",
  address: "admin.customers.fields.address",
  district: "admin.customers.fields.district",
  kkf_number: "admin.customers.fields.kkfNumber",
  contact_person: "admin.customers.fields.contactPerson",
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

function auditEvents(entry: AuditEntry): TimelineEvent[] {
  const at = entry.occurred_at;
  const actorId = entry.actor_id;
  const base = `audit-${entry.id}`;
  const oldData = (entry.old_data ?? {}) as Record<string, unknown>;
  const newData = (entry.new_data ?? {}) as Record<string, unknown>;
  const changed = entry.changed_columns ?? [];

  if (entry.table_name === "invitations") {
    if (entry.action === "INSERT") {
      return [{ key: base, at, kind: "invited", actorId, detail: text(newData["email"]) }];
    }
    if (entry.action !== "UPDATE") return [];
    if (changed.includes("accepted_at") && newData["accepted_at"]) {
      return [{ key: base, at, kind: "invitation_accepted", actorId, detail: null }];
    }
    if (changed.includes("revoked_at") && newData["revoked_at"]) {
      return [{ key: base, at, kind: "invitation_revoked", actorId, detail: null }];
    }
    if (changed.includes("last_sent_at")) {
      return [{ key: base, at, kind: "invitation_resent", actorId, detail: null }];
    }
    return [];
  }

  if (entry.action === "INSERT") {
    return [{ key: base, at, kind: "created", actorId, detail: text(newData["customer_code"]) }];
  }
  if (entry.action !== "UPDATE") return [];

  const events: TimelineEvent[] = [];
  if (changed.includes("customer_number")) {
    events.push({
      key: `${base}-code`,
      at,
      kind: "code_changed",
      actorId,
      detail: [
        `${text(oldData["customer_code"]) ?? "?"} → ${text(newData["customer_code"]) ?? "?"}`,
        entry.reason ? t("admin.customers.timeline.reason", { reason: entry.reason }) : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  if (changed.includes("status")) {
    if (newData["status"] === "disabled") {
      events.push({
        key: `${base}-disabled`,
        at,
        kind: "disabled",
        actorId,
        detail: text(newData["disabled_reason"])
          ? t("admin.customers.timeline.reason", { reason: String(newData["disabled_reason"]) })
          : null,
      });
    } else if (oldData["status"] === "disabled") {
      events.push({ key: `${base}-enabled`, at, kind: "enabled", actorId, detail: null });
    }
  }
  if (changed.includes("user_id") && newData["user_id"]) {
    events.push({ key: `${base}-login`, at, kind: "login_linked", actorId, detail: null });
  }
  if (changed.includes("email")) {
    events.push({
      key: `${base}-email`,
      at,
      kind: "email_changed",
      actorId,
      detail: `${text(oldData["email"]) ?? "—"} → ${text(newData["email"]) ?? "—"}`,
    });
  }
  const edited = changed.flatMap((c) => {
    const label = c === "email" ? undefined : FIELD_LABELS[c];
    return label ? [t(label)] : [];
  });
  if (edited.length > 0) {
    events.push({
      key: `${base}-edit`,
      at,
      kind: "edited",
      actorId,
      detail: edited.join(", "),
    });
  }
  return events;
}

/**
 * The customer's history in readable Dutch, oldest first. With the audit
 * trail (admins) every change appears with who did it; without it (staff)
 * the timeline comes from the rows themselves: created, the invitations
 * (created, resent, accepted, revoked) and the current disabled state.
 */
export function buildCustomerTimeline(input: {
  customer: Pick<
    CustomerRow,
    | "id"
    | "created_at"
    | "created_by"
    | "customer_code"
    | "status"
    | "disabled_at"
    | "disabled_by"
    | "disabled_reason"
  >;
  invitations: readonly InvitationSummary[];
  audit?: readonly AuditEntry[] | undefined;
}): TimelineEvent[] {
  const { customer, invitations, audit } = input;
  let events: TimelineEvent[];
  if (audit && audit.length > 0) {
    events = audit.flatMap(auditEvents);
  } else {
    events = [
      {
        key: "created",
        at: customer.created_at,
        kind: "created",
        actorId: customer.created_by,
        detail: customer.customer_code,
      },
    ];
    for (const inv of invitations) {
      events.push({
        key: `inv-${inv.id}`,
        at: inv.created_at,
        kind: "invited",
        actorId: inv.created_by,
        detail: inv.email,
      });
      if (inv.send_count > 1 && inv.last_sent_at && inv.last_sent_at !== inv.created_at) {
        events.push({
          key: `inv-${inv.id}-resent`,
          at: inv.last_sent_at,
          kind: "invitation_resent",
          actorId: null,
          detail: null,
        });
      }
      if (inv.accepted_at) {
        events.push({
          key: `inv-${inv.id}-accepted`,
          at: inv.accepted_at,
          kind: "invitation_accepted",
          actorId: inv.accepted_by,
          detail: null,
        });
      }
      if (inv.revoked_at) {
        events.push({
          key: `inv-${inv.id}-revoked`,
          at: inv.revoked_at,
          kind: "invitation_revoked",
          actorId: null,
          detail: null,
        });
      }
    }
    if (customer.status === "disabled" && customer.disabled_at) {
      events.push({
        key: "disabled",
        at: customer.disabled_at,
        kind: "disabled",
        actorId: customer.disabled_by,
        detail: customer.disabled_reason
          ? t("admin.customers.timeline.reason", { reason: customer.disabled_reason })
          : null,
      });
    }
  }
  // A stable sort: events of one audit row keep their order.
  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** The customer's code, name and company in one line: "GR00042 Maria Pinas". */
export function customerLabel(
  customer: Pick<CustomerRow, "customer_code" | "full_name" | "company_name" | "account_type">,
): string {
  return `${customer.customer_code} ${customerDisplayName(customer)}`;
}
