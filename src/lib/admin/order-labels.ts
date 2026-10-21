import type { SupabaseClient } from "@supabase/supabase-js";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { adminKeys } from "@/lib/admin/keys";
import { allPages, fold } from "@/lib/admin/orders";
import { t } from "@/lib/i18n";

/**
 * Order labels (SPEC §36): the team puts free-text labels with a colour on
 * orders, e.g. "Air" or "Ocean". No preset labels: a label exists because an
 * order carries it, and the labels in use are offered again for reuse. Only
 * the team sees them (RLS), they are added and removed, never edited, and one
 * order carries a label once (ignoring case).
 *
 * The table arrives with migration 20261017140000_order_labels.sql. Until the
 * generated types know it, it is read through an untyped client; and until the
 * migration has run, the list says "not available" instead of failing, so the
 * order pages keep working.
 */

export const LABEL_COLORS = [
  "grey",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

export const LABEL_MAX_LENGTH = 30;

/** Light background, dark text (contrast ≥ 4.5:1), a slightly darker border. */
export const LABEL_COLOR_STYLES: Record<
  LabelColor,
  { background: string; color: string; borderColor: string }
> = {
  grey: { background: "#EEEEEC", color: "#3F3F3B", borderColor: "#D2D2CC" },
  brown: { background: "#F3E6DC", color: "#6B3A1F", borderColor: "#E0C6B2" },
  red: { background: "#FBE4E2", color: "#9B2C24", borderColor: "#F0BEB8" },
  orange: { background: "#FDEBD8", color: "#8F4409", borderColor: "#F4CDA2" },
  yellow: { background: "#FBF3C9", color: "#6E5500", borderColor: "#ECD985" },
  green: { background: "#E3F2E1", color: "#25602A", borderColor: "#BCDAB8" },
  teal: { background: "#DDF1EF", color: "#175E58", borderColor: "#B0DAD5" },
  blue: { background: "#E1ECFA", color: "#1F4E8C", borderColor: "#B9CFEF" },
};

export interface OrderLabel {
  id: string;
  order_id: string;
  label: string;
  color: LabelColor;
  created_at: string;
}

/** What "Label toevoegen" sends: the text (trimmed) and one of the colours. */
export const labelInputSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, t("admin.labels.form.textRequired"))
    .max(LABEL_MAX_LENGTH, t("admin.labels.form.textTooLong", { max: LABEL_MAX_LENGTH })),
  color: z.enum(LABEL_COLORS),
});
export type LabelInput = z.input<typeof labelInputSchema>;
export type LabelData = z.output<typeof labelInputSchema>;

/** One label ignoring case, as the database's unique (order_id, label_key). */
export const labelKey = (label: string) => label.trim().toLowerCase();

/** Labels per order, oldest first (the order they were added in). */
export function labelsByOrder(labels: readonly OrderLabel[]): Map<string, OrderLabel[]> {
  const map = new Map<string, OrderLabel[]>();
  for (const label of [...labels].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  )) {
    const list = map.get(label.order_id);
    if (list) list.push(label);
    else map.set(label.order_id, [label]);
  }
  return map;
}

export interface LabelInUse {
  key: string;
  label: string;
  color: LabelColor;
  count: number;
}

/**
 * The labels in use, once each (ignoring case), most used first: the
 * suggestions of "Label toevoegen" and the options of the label filter. The
 * text and colour shown are those of the most recent use.
 */
export function labelsInUse(labels: readonly OrderLabel[]): LabelInUse[] {
  const byKey = new Map<string, LabelInUse & { last: string }>();
  for (const l of labels) {
    const key = labelKey(l.label);
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, { key, label: l.label, color: l.color, count: 1, last: l.created_at });
    } else {
      seen.count += 1;
      if (l.created_at > seen.last) {
        seen.label = l.label;
        seen.color = l.color;
        seen.last = l.created_at;
      }
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.count - a.count || fold(a.label).localeCompare(fold(b.label), "nl"))
    .map(({ key, label, color, count }) => ({ key, label, color, count }));
}

/**
 * The labels in use whose text contains the typed text, ignoring case and
 * accents, still most used first; all of them while nothing is typed. The
 * search of "Label toevoegen".
 */
export function matchLabelsInUse(
  inUse: readonly LabelInUse[],
  query: string,
): readonly LabelInUse[] {
  const q = fold(query.trim());
  return q ? inUse.filter((l) => fold(l.label).includes(q)) : inUse;
}

/**
 * The label in use that the typed text names, ignoring case and surrounding
 * spaces (as `label_key`): "Label toevoegen" then adds that label with its
 * own text and colour instead of a near-copy.
 */
export function findLabelInUse(inUse: readonly LabelInUse[], text: string): LabelInUse | undefined {
  const key = labelKey(text);
  return key ? inUse.find((l) => l.key === key) : undefined;
}

/** Whether an order carries the label (the `?label=` filter, ignoring case). */
export function hasLabel(labels: readonly OrderLabel[] | undefined, key: string): boolean {
  return Boolean(labels?.some((l) => labelKey(l.label) === labelKey(key)));
}

// ---------------------------------------------------------------------------
// Reading and writing
// ---------------------------------------------------------------------------

type Untyped = Pick<SupabaseClient, "from">;
const untyped = (db: unknown) => db as Untyped;

/** PostgREST / Postgres answers for a table that does not exist (yet). */
const MISSING_TABLE = ["PGRST205", "42P01"];

export interface OrderLabelData {
  /** False until migration 20261017140000 has run on the project. */
  available: boolean;
  labels: OrderLabel[];
}

function isMissingTable(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && MISSING_TABLE.includes(code);
}

export async function fetchOrderLabels(db: unknown = supabase): Promise<OrderLabelData> {
  try {
    const labels = await allPages<OrderLabel>((from, to) =>
      untyped(db)
        .from("order_labels")
        .select("id, order_id, label, color, created_at")
        .order("created_at")
        .order("id")
        .range(from, to),
    );
    return { available: true, labels };
  } catch (error) {
    if (isMissingTable(error)) return { available: false, labels: [] };
    throw error;
  }
}

/** Every label (staff see all, customers none); one query for the list and the order pages. */
export const orderLabelsQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.orderLabels(userId),
    staleTime: 15_000,
    queryFn: () => fetchOrderLabels(),
  });

/**
 * Puts one label on one or more orders. An order that already carries it
 * (ignoring case) is left as it is. Returns the labels that were added.
 */
export async function addOrderLabels(
  db: unknown,
  orderIds: readonly string[],
  input: LabelData,
): Promise<OrderLabel[]> {
  if (orderIds.length === 0) return [];
  const { data, error } = await untyped(db)
    .from("order_labels")
    .upsert(
      orderIds.map((id) => ({ order_id: id, label: input.label, color: input.color })),
      { onConflict: "order_id,label_key", ignoreDuplicates: true },
    )
    .select("id, order_id, label, color, created_at");
  if (error) throw error;
  return (data ?? []) as OrderLabel[];
}

export async function removeOrderLabel(db: unknown, labelId: string): Promise<void> {
  const { error } = await untyped(db).from("order_labels").delete().eq("id", labelId);
  if (error) throw error;
}
