import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { addDays } from "@/lib/admin/invoice-builder";
import { adminKeys } from "@/lib/admin/keys";
import { searchText } from "@/lib/admin/orders";
import { formatNumber, surinameDateTimeToIso } from "@/lib/format";
import { t } from "@/lib/i18n";
import { isUuid } from "@/lib/portal/orders";

/**
 * /admin/audit (SPEC §28, §35.13): the generic audit_log as a table with a
 * JSON diff per row. audit_log is admin-read only (RLS `is_admin()`), so a
 * staff member gets no rows at all; nobody can write it from the client. The
 * filters run in the database (PostgREST), the page is 50 rows.
 */

type Client = Pick<SupabaseClient<Database>, "from">;
type AuditRow = Database["public"]["Tables"]["audit_log"]["Row"];

export type AuditEntry = Pick<
  AuditRow,
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

export const AUDIT_COLUMNS =
  "id, occurred_at, actor_id, table_name, record_id, action, old_data, new_data, changed_columns, reason" as const;

/**
 * Every table_name the database writes: the audited tables (private.audit_row
 * triggers) and the RPCs that log themselves (numbering, team logins).
 */
export const AUDIT_TABLES = [
  "customers",
  "orders",
  "shipments",
  "invoices",
  "invoice_items",
  "payments",
  "invitations",
  "user_roles",
  "team_login",
  "company_settings",
  "company_bank_accounts",
  "warehouse_addresses",
  "service_rates",
  "shipment_statuses",
  "customer_number_seq",
  "invoice_number_counters",
] as const;
export type AuditTable = (typeof AUDIT_TABLES)[number];

const isAuditTable = (name: string): name is AuditTable =>
  (AUDIT_TABLES as readonly string[]).includes(name);

/** "Orders", "Factuurregels", …; an unknown table keeps its own name. */
export function auditTableLabel(name: string): string {
  return isAuditTable(name) ? t(`admin.audit.tables.${name}`) : name;
}

export function auditActionLabel(action: string): string {
  switch (action) {
    case "INSERT":
      return t("admin.audit.actions.INSERT");
    case "UPDATE":
      return t("admin.audit.actions.UPDATE");
    case "DELETE":
      return t("admin.audit.actions.DELETE");
    default:
      return action;
  }
}

// ---------------------------------------------------------------------------
// Filters (in the URL)
// ---------------------------------------------------------------------------

const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => addDays(v, 0) === v)
  .optional()
  .catch(undefined);

export const auditSearchSchema = z.object({
  table: z.enum(AUDIT_TABLES).optional().catch(undefined),
  /** Who did it (a login id). */
  actor: z
    .string()
    .refine(isUuid)
    .transform((v) => v.toLowerCase())
    .optional()
    .catch(undefined),
  /** Suriname dates, inclusive. */
  from: dateParam,
  to: dateParam,
  /** The changed row's id (uuid, or a number/year for the numbering rows). */
  record: searchText,
  /** 1-based; the first page stays out of the URL. */
  page: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
});
export type AuditSearch = z.infer<typeof auditSearchSchema>;
export type AuditFilters = Omit<AuditSearch, "page">;

export function hasAuditFilters(search: AuditSearch): boolean {
  return Boolean(search.table || search.actor || search.from || search.to || search.record);
}

/** "Van" after "tot": the range is empty, so nothing is asked of the database. */
export function auditRangeInvalid(filters: Pick<AuditFilters, "from" | "to">): boolean {
  return Boolean(filters.from && filters.to && filters.from > filters.to);
}

/**
 * The Suriname days from … to … (inclusive) as instants: from 00:00 on the
 * first day up to (not including) 00:00 the day after the last.
 */
export function auditTimeRange(filters: Pick<AuditFilters, "from" | "to">): {
  gte: string | null;
  lt: string | null;
} {
  const gte = filters.from ? surinameDateTimeToIso(`${filters.from}T00:00`) : null;
  const lt = filters.to ? surinameDateTimeToIso(`${addDays(filters.to, 1)}T00:00`) : null;
  return { gte, lt };
}

/** A record id as stored: uuids in lower case, anything else trimmed. */
export function normalizeRecordId(value: string): string {
  const v = value.trim();
  return isUuid(v) ? v.toLowerCase() : v;
}

/** audit_log filtered in the database, newest first. */
export function auditQuery(db: Client, filters: AuditFilters) {
  let q = db.from("audit_log").select(AUDIT_COLUMNS);
  if (filters.table) q = q.eq("table_name", filters.table);
  if (filters.actor) q = q.eq("actor_id", filters.actor);
  if (filters.record) q = q.eq("record_id", normalizeRecordId(filters.record));
  const range = auditTimeRange(filters);
  if (range.gte) q = q.gte("occurred_at", range.gte);
  if (range.lt) q = q.lt("occurred_at", range.lt);
  return q.order("occurred_at", { ascending: false }).order("id", { ascending: false });
}

export const AUDIT_PAGE_SIZE = 50;

export interface AuditPage {
  entries: AuditEntry[];
  /** There is at least one more row after this page. */
  hasMore: boolean;
}

/** One page (1-based): one row more than the page is read to know whether a next page exists. */
export async function loadAuditPage(
  db: Client,
  filters: AuditFilters,
  page: number,
): Promise<AuditPage> {
  if (auditRangeInvalid(filters)) return { entries: [], hasMore: false };
  const from = (Math.max(page, 1) - 1) * AUDIT_PAGE_SIZE;
  const { data, error } = await auditQuery(db, filters).range(from, from + AUDIT_PAGE_SIZE);
  if (error) throw error;
  const rows = (data ?? []) as AuditEntry[];
  return { entries: rows.slice(0, AUDIT_PAGE_SIZE), hasMore: rows.length > AUDIT_PAGE_SIZE };
}

export const auditPageQueryOptions = (userId: string, filters: AuditFilters, page: number) =>
  queryOptions({
    queryKey: adminKeys.auditPage(userId, filters, page),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    queryFn: () => loadAuditPage(supabase, filters, page),
  });

// ---------------------------------------------------------------------------
// One row: what changed, which record, where it lives
// ---------------------------------------------------------------------------

export interface AuditDiffRow {
  key: string;
  /** undefined: the field did not exist on that side (INSERT / DELETE). */
  before: Json | undefined;
  after: Json | undefined;
  changed: boolean;
}

const asObject = (value: Json | null): Record<string, Json | undefined> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};

const same = (a: Json | undefined, b: Json | undefined) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The fields of a row, old next to new. UPDATE: every field, the changed
 * ones (changed_columns, else compared) first; INSERT: what was created;
 * DELETE: what was removed. Within each group alphabetical.
 */
export function auditDiff(
  entry: Pick<AuditEntry, "action" | "old_data" | "new_data" | "changed_columns">,
): AuditDiffRow[] {
  const before = asObject(entry.old_data);
  const after = asObject(entry.new_data);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changedSet = entry.changed_columns ? new Set(entry.changed_columns) : null;
  const rows = keys.map((key): AuditDiffRow => {
    const b = entry.action === "INSERT" ? undefined : before[key];
    const a = entry.action === "DELETE" ? undefined : after[key];
    const changed =
      entry.action !== "UPDATE" ? true : changedSet ? changedSet.has(key) : !same(b, a);
    return { key, before: b, after: a, changed };
  });
  return rows.sort((x, y) => Number(y.changed) - Number(x.changed) || x.key.localeCompare(y.key));
}

/** A field value as text: "leeg" for null, JSON for objects and lists. */
export function formatAuditValue(value: Json | undefined): string {
  if (value === undefined) return "";
  if (value === null) return t("admin.audit.empty");
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

const str = (value: Json | undefined): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** Something a person recognises the record by: a GR code, an order or invoice number, … */
export function auditRecordLabel(
  entry: Pick<AuditEntry, "table_name" | "record_id" | "old_data" | "new_data">,
): string {
  const data = { ...asObject(entry.old_data), ...asObject(entry.new_data) };
  const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(" · ") || null;
  let label: string | null = null;
  switch (entry.table_name) {
    case "customers":
      label = join(str(data["customer_code"]), str(data["full_name"]));
      break;
    case "orders":
      label = str(data["reference"]);
      break;
    case "shipments":
      label = str(data["shipment_number"]);
      break;
    case "invoices":
      label = str(data["invoice_number"]) ?? t("admin.audit.draftInvoice");
      break;
    case "invoice_items":
      label = str(data["description"]);
      break;
    case "payments": {
      const amount = data["amount"];
      label =
        typeof amount === "number" || typeof amount === "string"
          ? t("admin.audit.paymentLabel", { amount: formatNumber(amount, 2) })
          : null;
      break;
    }
    case "invitations":
      label = str(data["email"]);
      break;
    case "shipment_statuses":
      label = str(data["label_nl"]) ?? str(data["code"]);
      break;
    case "service_rates":
      label = str(data["service_type"]);
      break;
    case "company_bank_accounts":
      label = str(data["currency"]);
      break;
    case "user_roles":
      label = str(data["role"]);
      break;
    case "company_settings":
      // A single row whose id is the boolean true: name the table instead.
      label = auditTableLabel("company_settings");
      break;
    case "warehouse_addresses":
      label = join(str(data["label"]), str(data["city"]));
      break;
  }
  return label ?? entry.record_id ?? "–";
}

export type AuditLink =
  | { to: "/admin/klanten/$id"; id: string }
  | { to: "/admin/orders/$id"; id: string }
  | { to: "/admin/zendingen/$id"; id: string }
  | { to: "/admin/facturen/$id"; id: string };

/** The page the record (or the invoice/customer it belongs to) lives on; null when there is none. */
export function auditRecordLink(
  entry: Pick<AuditEntry, "table_name" | "record_id" | "action" | "old_data" | "new_data">,
): AuditLink | null {
  const data = { ...asObject(entry.old_data), ...asObject(entry.new_data) };
  const id = entry.record_id && isUuid(entry.record_id) ? entry.record_id : null;
  const deleted = entry.action === "DELETE";
  const ref = (key: string) => {
    const v = data[key];
    return typeof v === "string" && isUuid(v) ? v : null;
  };
  switch (entry.table_name) {
    case "customers":
      return id && !deleted ? { to: "/admin/klanten/$id", id } : null;
    case "orders":
      return id && !deleted ? { to: "/admin/orders/$id", id } : null;
    case "shipments":
      return id && !deleted ? { to: "/admin/zendingen/$id", id } : null;
    case "invoices":
      return id && !deleted ? { to: "/admin/facturen/$id", id } : null;
    case "invoice_items":
    case "payments": {
      const invoiceId = ref("invoice_id");
      return invoiceId ? { to: "/admin/facturen/$id", id: invoiceId } : null;
    }
    case "invitations": {
      const customerId = ref("customer_id");
      return customerId ? { to: "/admin/klanten/$id", id: customerId } : null;
    }
    default:
      return null;
  }
}

/** Labels for the table filter, in the order of AUDIT_TABLES. */
export function auditTableOptions(): { value: AuditTable; label: string }[] {
  return AUDIT_TABLES.map((value) => ({ value, label: auditTableLabel(value) }));
}
