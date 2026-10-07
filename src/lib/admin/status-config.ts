import type { SupabaseClient } from "@supabase/supabase-js";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { Constants, type Database } from "@/integrations/supabase/types";
import { adminKeys } from "@/lib/admin/keys";
import { allPages, fold } from "@/lib/admin/orders";
import {
  DELIVERED_STATUS,
  STAGE_DISPLAY_ORDER,
  type AdminStatusMap,
  type StatusRow,
} from "@/lib/admin/statuses";
import { CodedError, toAppError } from "@/lib/errors";
import { t } from "@/lib/i18n";
import type { StatusStage } from "@/lib/portal/orders";

/**
 * Status configuration (SPEC §11, §35.7): the flexible list of order
 * statuses. Staff read it; only admins add or change statuses (RLS
 * is_admin on shipment_statuses insert/update). There is no delete: a status
 * that is no longer wanted is deactivated, and orders and history that use
 * it keep it. The stage of an existing status is not changed here: it would
 * silently re-classify every order and history row in that status. The
 * database keeps at least one active 'registered' status (new orders start
 * there; shipment_statuses_guard, 55000).
 */

type Client = Pick<SupabaseClient<Database>, "from">;
type StatusInsert = Database["public"]["Tables"]["shipment_statuses"]["Insert"];

/** shipment_statuses_code_format. */
export const STATUS_CODE_PATTERN = /^[a-z][a-z0-9_]{1,49}$/;

/** Same limits as the table's checks. */
export const STATUS_LIMITS = {
  label: 100,
  description: 500,
  sortOrderMax: 100_000,
} as const;

// ---------------------------------------------------------------------------
// Usage: how many orders are in each status now
// ---------------------------------------------------------------------------

/** Orders per status code (staff read all orders). */
export const statusUsageQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.statusUsage(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<ReadonlyMap<string, number>> => {
      const rows = await allPages<{ status: string }>((from, to) =>
        supabase.from("orders").select("status").order("id").range(from, to),
      );
      const usage = new Map<string, number>();
      for (const r of rows) usage.set(r.status, (usage.get(r.status) ?? 0) + 1);
      return usage;
    },
  });

// ---------------------------------------------------------------------------
// Grouping for the page
// ---------------------------------------------------------------------------

export interface StageGroup {
  stage: StatusStage;
  statuses: StatusRow[];
  /** The status a stage shortcut uses: the first active one (sort order). */
  defaultCode: string | null;
}

/** Statuses per stage in journey order, each by sort order; empty stages included. */
export function groupStatusesByStage(statuses: AdminStatusMap): StageGroup[] {
  const all = [...statuses.values()].sort(
    (a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code),
  );
  return STAGE_DISPLAY_ORDER.map((stage) => {
    const list = all.filter((s) => s.stage === stage);
    return { stage, statuses: list, defaultCode: list.find((s) => s.active)?.code ?? null };
  });
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export interface StatusFormValues {
  labelNl: string;
  customerDescriptionNl: string;
  /** Text in the form; a whole number 0–100000. */
  sortOrder: string;
  customerVisible: boolean;
  notifyCustomer: boolean;
}

export interface NewStatusFormValues extends StatusFormValues {
  code: string;
  stage: StatusStage | "";
}

export type StatusFormField = keyof NewStatusFormValues;
export type StatusFormErrors = Partial<Record<StatusFormField, string>>;

export type StatusColumns = Required<
  Pick<
    StatusInsert,
    "label_nl" | "customer_description_nl" | "sort_order" | "customer_visible" | "notify_customer"
  >
>;

export type NewStatusColumns = StatusColumns &
  Required<Pick<StatusInsert, "code" | "stage" | "is_terminal" | "active">>;

export function statusFormFromRow(row: StatusRow): StatusFormValues {
  return {
    labelNl: row.label_nl,
    customerDescriptionNl: row.customer_description_nl ?? "",
    sortOrder: String(row.sort_order),
    customerVisible: row.customer_visible,
    notifyCustomer: row.customer_visible && row.notify_customer,
  };
}

/**
 * A free sort position for a new status in a stage: just after the stage's
 * last status, or after everything when the stage is empty.
 */
export function suggestSortOrder(statuses: AdminStatusMap, stage: StatusStage): number {
  const all = [...statuses.values()];
  const inStage = all.filter((s) => s.stage === stage).map((s) => s.sort_order);
  const base =
    inStage.length > 0 ? Math.max(...inStage) : Math.max(0, ...all.map((s) => s.sort_order)) + 4;
  const taken = new Set(all.map((s) => s.sort_order));
  let next = Math.min(base + 1, STATUS_LIMITS.sortOrderMax);
  while (taken.has(next) && next < STATUS_LIMITS.sortOrderMax) next += 1;
  return next;
}

export function emptyNewStatusForm(
  statuses: AdminStatusMap,
  stage: StatusStage | "" = "",
): NewStatusFormValues {
  return {
    code: "",
    stage,
    labelNl: "",
    customerDescriptionNl: "",
    sortOrder: stage ? String(suggestSortOrder(statuses, stage)) : "",
    customerVisible: true,
    notifyCustomer: false,
  };
}

/**
 * A code from a label: "Wacht op betaling" → "wacht_op_betaling" (no
 * accents, lower case, underscores), unique among the existing codes.
 */
export function suggestStatusCode(label: string, taken: ReadonlySet<string>): string {
  const base = fold(label)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "")
    .slice(0, 50)
    .replace(/_+$/, "");
  if (base.length < 2) return "";
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, 50 - suffix.length).replace(/_+$/, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return "";
}

const statusFieldsSchema = z.object({
  labelNl: z
    .string()
    .trim()
    .min(1, t("admin.statuses.form.labelRequired"))
    .max(STATUS_LIMITS.label, t("admin.statuses.form.tooLong", { max: STATUS_LIMITS.label })),
  customerDescriptionNl: z
    .string()
    .trim()
    .max(
      STATUS_LIMITS.description,
      t("admin.statuses.form.tooLong", { max: STATUS_LIMITS.description }),
    ),
  sortOrder: z
    .string()
    .trim()
    .regex(/^\d{1,6}$/, t("admin.statuses.form.sortOrderInvalid"))
    .refine((v) => Number(v) <= STATUS_LIMITS.sortOrderMax, {
      message: t("admin.statuses.form.sortOrderInvalid"),
    }),
  customerVisible: z.boolean(),
  notifyCustomer: z.boolean(),
});

function collect(issues: readonly z.ZodIssue[], errors: StatusFormErrors): void {
  for (const issue of issues) {
    const field = issue.path[0] as StatusFormField | undefined;
    if (field && !errors[field]) errors[field] = issue.message;
  }
}

function toColumns(v: z.output<typeof statusFieldsSchema>): StatusColumns {
  return {
    label_nl: v.labelNl,
    customer_description_nl: v.customerDescriptionNl || null,
    sort_order: Number(v.sortOrder),
    customer_visible: v.customerVisible,
    // A status the customer cannot see is never e-mailed.
    notify_customer: v.customerVisible && v.notifyCustomer,
  };
}

/** "Status wijzigen" (labels, description, sort order, flags). */
export function validateStatusForm(
  values: StatusFormValues,
): { ok: true; columns: StatusColumns } | { ok: false; errors: StatusFormErrors } {
  const parsed = statusFieldsSchema.safeParse(values);
  if (!parsed.success) {
    const errors: StatusFormErrors = {};
    collect(parsed.error.issues, errors);
    return { ok: false, errors };
  }
  return { ok: true, columns: toColumns(parsed.data) };
}

/** Stages whose statuses end an order (shown as "Eindstatus"). */
const TERMINAL_STAGES: readonly StatusStage[] = ["completed", "cancelled"];

/** "Status toevoegen": code and stage too; every error at once. */
export function validateNewStatusForm(
  values: NewStatusFormValues,
  statuses: AdminStatusMap,
): { ok: true; columns: NewStatusColumns } | { ok: false; errors: StatusFormErrors } {
  const errors: StatusFormErrors = {};
  const parsed = statusFieldsSchema.safeParse(values);
  if (!parsed.success) collect(parsed.error.issues, errors);
  const code = values.code.trim();
  if (!code) errors.code = t("admin.statuses.form.codeRequired");
  else if (!STATUS_CODE_PATTERN.test(code)) errors.code = t("admin.statuses.form.codeInvalid");
  else if (statuses.has(code)) errors.code = t("admin.statuses.form.codeTaken", { code });
  const stage = Constants.public.Enums.status_stage.find((s) => s === values.stage);
  if (!stage) errors.stage = t("admin.statuses.form.stageRequired");
  if (!parsed.success || !stage || Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    columns: {
      ...toColumns(parsed.data),
      code,
      stage,
      is_terminal: TERMINAL_STAGES.includes(stage),
      active: true,
    },
  };
}

// ---------------------------------------------------------------------------
// Deactivating
// ---------------------------------------------------------------------------

export interface DeactivationImpact {
  /** Orders that are in this status now (they keep it). */
  inUse: number;
  /** No other active status would be left in this stage. */
  lastActiveInStage: boolean;
  /** The database refuses it: new orders need an active 'registered' status. */
  blocked: boolean;
}

export function deactivationImpact(
  statuses: AdminStatusMap,
  code: string,
  usage: ReadonlyMap<string, number> | undefined,
): DeactivationImpact {
  const status = statuses.get(code);
  const otherActive = [...statuses.values()].some(
    (s) => s.code !== code && s.active && s.stage === status?.stage,
  );
  const lastActiveInStage = Boolean(status?.active) && !otherActive;
  return {
    inUse: usage?.get(code) ?? 0,
    lastActiveInStage,
    blocked: lastActiveInStage && status?.stage === "registered",
  };
}

/** The seeded "Bezorgd" status is only offered while delivery is switched on in the settings. */
export const isDeliveryStatus = (code: string) => code === DELIVERED_STATUS;

// ---------------------------------------------------------------------------
// Writes (the admin's own client; RLS decides)
// ---------------------------------------------------------------------------

/** An update RLS filtered away (not an admin) changes no row: say so instead of "saved". */
function noRow(): CodedError {
  return new CodedError(t("admin.statuses.adminOnly"), "42501");
}

export async function createStatus(client: Client, columns: NewStatusColumns): Promise<void> {
  const { error } = await client.from("shipment_statuses").insert(columns).select("code").single();
  if (error) {
    if (toAppError(error).code === "23505") {
      throw new CodedError(t("admin.statuses.form.codeTaken", { code: columns.code }), "23505");
    }
    throw error;
  }
}

export async function updateStatus(
  client: Client,
  code: string,
  columns: StatusColumns,
): Promise<void> {
  const { data, error } = await client
    .from("shipment_statuses")
    .update(columns)
    .eq("code", code)
    .select("code");
  if (error) throw error;
  if (data.length === 0) throw noRow();
}

/** Deactivate or reactivate; the database refuses to leave no active 'registered' status (55000). */
export async function setStatusActive(
  client: Client,
  code: string,
  active: boolean,
): Promise<void> {
  const { data, error } = await client
    .from("shipment_statuses")
    .update({ active })
    .eq("code", code)
    .select("code");
  if (error) throw error;
  if (data.length === 0) throw noRow();
}
