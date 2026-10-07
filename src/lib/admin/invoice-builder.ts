import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { billableWeight, parseDecimalInput, type ServiceRate } from "@/lib/admin/settings";
import { CodedError } from "@/lib/errors";
import { formatNumber, todayInSuriname, type CurrencyCode } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  freightDescription,
  freightDetail,
  type DraftFormLine,
  type DraftFormState,
} from "@/lib/invoice/model";
import { computeInvoiceTotals, type InvoiceLineType } from "@/lib/invoice/totals";

/**
 * The invoice builder (/admin/facturen/nieuw and a draft's page, SPEC §14,
 * §15, §35.9): its form state, the prefilled freight lines, validation by
 * the database's own rules (so a save never fails on something the form
 * could have said), and saving a draft with the staff member's OWN client
 * (RLS: is_staff; the triggers recompute totals, enforce freight-once and
 * keep issued invoices immutable). Issuing goes through issueInvoiceFn
 * (lib/server-fns/invoices.functions.ts → issue_invoice). Apart from the
 * page so the PGlite contract test runs this code unchanged.
 */

type Client = Pick<SupabaseClient<Database>, "from">;
type Tables = Database["public"]["Tables"];

/** Line types staff add by hand (late fees come only from apply_late_fee). */
export type BuilderLineType = Exclude<InvoiceLineType, "late_fee">;
export const EXTRA_LINE_TYPES = [
  "customs",
  "handling",
  "goods",
  "service_fee",
  "other",
  "discount",
] as const satisfies readonly BuilderLineType[];
export type ExtraLineType = (typeof EXTRA_LINE_TYPES)[number];

/** Where a prefilled freight weight came from (the builder flags all but "measured"). */
export interface WeightNote {
  kind: "measured" | "declared" | "missing";
  /** The weight of the order (measured or declared) before rounding and minimum. */
  raw: number | null;
  /** What the line bills after the service's rounding and minimum. */
  billed: number | null;
}

export interface BuilderLine {
  /** Stable React key. */
  key: string;
  /** invoice_items.id once saved. */
  id: string | null;
  lineType: BuilderLineType;
  orderId: string | null;
  description: string;
  /** Freight: lbs and rate per lb as typed ("12,5"). */
  weight: string;
  rate: string;
  /** Other lines: the amount as typed, always positive; a discount is stored negative. */
  amount: string;
  vatExempt: boolean;
  weightNote: WeightNote | null;
}

export interface BuilderState {
  customerId: string | null;
  currency: CurrencyCode;
  invoiceDate: string;
  dueDate: string;
  /** Staff changed the due date themselves: it no longer follows the invoice date. */
  dueTouched: boolean;
  customerNote: string;
  replacesInvoiceId: string | null;
  /** The orders picked for this invoice, in the order they were picked. */
  orderIds: string[];
  lines: BuilderLine[];
}

/** An order as the builder lists it. */
export type BuilderOrder = Pick<
  Tables["orders"]["Row"],
  | "id"
  | "reference"
  | "customer_id"
  | "order_type"
  | "service_type"
  | "store_vendor"
  | "vendor_order_number"
  | "description"
  | "tracking_number"
  | "status"
  | "measured_weight_lbs"
  | "declared_weight_lbs"
  | "created_at"
  | "parent_order_id"
> & {
  /**
   * The freight line of this order on another invoice that is not cancelled
   * (the database allows only one), or null.
   */
  freightOn: { invoiceId: string; invoiceNumber: string | null } | null;
};

export const BUILDER_ORDER_COLUMNS =
  "id, reference, customer_id, order_type, service_type, store_vendor, vendor_order_number, description, tracking_number, status, measured_weight_lbs, declared_weight_lbs, created_at, parent_order_id" as const;

/** The customer columns the preview prints ("Naam klant", code, …). */
export const BILL_TO_COLUMNS =
  "id, customer_code, full_name, account_type, company_name, contact_person, kkf_number, address, district, email, phone, status, user_id" as const;
export type BuilderCustomer = Pick<
  Tables["customers"]["Row"],
  | "id"
  | "customer_code"
  | "full_name"
  | "account_type"
  | "company_name"
  | "contact_person"
  | "kkf_number"
  | "address"
  | "district"
  | "email"
  | "phone"
  | "status"
  | "user_id"
>;

/** ?orders= of /admin/facturen/nieuw (comma-separated ids) as a list; anything else is ignored. */
export function orderIdsParam(value: string | undefined): string[] {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return [...new Set((value ?? "").split(",").filter((id) => uuid.test(id)))];
}

/**
 * The search of a "Genereer factuur" link (SPEC §35.9 entry points):
 * `?customer=&orders=` plus where the back link should go.
 */
export function newInvoiceSearch(input: {
  customerId: string;
  orderIds?: readonly string[];
  from: "order" | "orders" | "customer";
}): { customer: string; orders?: string; from: "order" | "orders" | "customer" } {
  const orders = (input.orderIds ?? []).join(",");
  return orders
    ? { customer: input.customerId, orders, from: input.from }
    : { customer: input.customerId, from: input.from };
}

let keySeq = 0;
/** A fresh React key for a new line. */
export function newLineKey(): string {
  keySeq += 1;
  return `new-${Date.now().toString(36)}-${keySeq}`;
}

/** 'YYYY-MM-DD' + n days (calendar arithmetic, no time zone involved). */
export function addDays(date: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

/** A real calendar date 'YYYY-MM-DD' in 2000–2999 (invoices_dates_check). */
export function isValidDate(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m || Number(m[1]) < 2000 || Number(m[1]) > 2999) return false;
  return addDays(date, 0) === date;
}

/** A new invoice: today in Suriname, due after the payment term (SPEC §35.9). */
export function initialBuilderState(input: {
  customerId: string | null;
  currency: CurrencyCode;
  paymentTermDays: number;
  today?: string;
  replacesInvoiceId?: string | null;
}): BuilderState {
  const today = input.today ?? todayInSuriname();
  return {
    customerId: input.customerId,
    currency: input.currency,
    invoiceDate: today,
    dueDate: addDays(today, input.paymentTermDays),
    dueTouched: false,
    customerNote: "",
    replacesInvoiceId: input.replacesInvoiceId ?? null,
    orderIds: [],
    lines: [],
  };
}

/** The number as typed in an input, Dutch style ("12,5"). */
export function decimalText(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(".", ",");
}

/**
 * The weight a freight line bills (SPEC §35.9): the measured weight after
 * the service's rounding and minimum; without one the declared weight
 * (flagged), else nothing.
 */
export function weightPlan(
  order: Pick<BuilderOrder, "measured_weight_lbs" | "declared_weight_lbs">,
  rate: Pick<ServiceRate, "weight_rounding" | "minimum_billable_lbs"> | undefined,
): WeightNote {
  const rounding = rate?.weight_rounding ?? "none";
  const minimum = rate?.minimum_billable_lbs ?? null;
  const bill = (w: number) => billableWeight(w, rounding, minimum);
  if (order.measured_weight_lbs !== null && order.measured_weight_lbs > 0) {
    return {
      kind: "measured",
      raw: order.measured_weight_lbs,
      billed: bill(order.measured_weight_lbs),
    };
  }
  if (order.declared_weight_lbs !== null && order.declared_weight_lbs > 0) {
    return {
      kind: "declared",
      raw: order.declared_weight_lbs,
      billed: bill(order.declared_weight_lbs),
    };
  }
  return { kind: "missing", raw: null, billed: null };
}

/**
 * The rate per lb for an order's service in the invoice currency, or null
 * when none is set (or it is in another currency: there is no conversion).
 */
export function rateFor(
  order: Pick<BuilderOrder, "service_type">,
  rates: readonly ServiceRate[],
  currency: CurrencyCode,
): number | null {
  const rate = rates.find((r) => r.service_type === order.service_type);
  if (!rate || rate.rate_per_lb === null || rate.currency !== currency) return null;
  return rate.rate_per_lb;
}

/** One prefilled freight line per order (SPEC §35.9 step 2). */
export function freightLineForOrder(
  order: BuilderOrder,
  rates: readonly ServiceRate[],
  currency: CurrencyCode,
): BuilderLine {
  const service = rates.find((r) => r.service_type === order.service_type);
  const plan = weightPlan(order, service);
  return {
    key: newLineKey(),
    id: null,
    lineType: "freight",
    orderId: order.id,
    description: freightDescription({
      storeVendor: order.store_vendor,
      vendorOrderNumber: order.vendor_order_number,
      reference: order.reference,
    }),
    weight: decimalText(plan.billed),
    rate: decimalText(rateFor(order, rates, currency)),
    amount: "",
    vatExempt: false,
    weightNote: plan,
  };
}

/** A hand-added line; customs is VAT-exempt by default (SPEC §35.9). */
/**
 * The description a hand-added line starts with: the type's name (it is for
 * G&R's own records; the paper prints the type), so nobody has to type text
 * the customer never sees. "Overige kosten" starts empty: its description is
 * printed ("Overige kosten: …") and must be filled in.
 */
export function defaultDescription(lineType: ExtraLineType): string {
  if (lineType === "other") return "";
  if (lineType === "discount") return t("admin.invoiceBuilder.defaults.discount");
  return t(`admin.invoiceBuilder.lines.types.${lineType}`);
}

/**
 * A new type for a hand-added line: the description follows the type while
 * it is still the previous type's default (or empty); typed text stays.
 */
export function changeLineType(line: BuilderLine, lineType: ExtraLineType): Partial<BuilderLine> {
  const before = line.lineType === "freight" ? null : defaultDescription(line.lineType);
  const untouched = line.description.trim() === "" || line.description === before;
  return {
    lineType,
    ...(untouched ? { description: defaultDescription(lineType) } : {}),
    // Customs is VAT-exempt by default (SPEC §35.9); switching keeps a choice made.
    vatExempt: lineType === "customs" ? true : line.lineType === "customs" ? false : line.vatExempt,
  };
}

export function extraLine(lineType: ExtraLineType, orderId: string | null = null): BuilderLine {
  return {
    key: newLineKey(),
    id: null,
    lineType,
    orderId,
    description: defaultDescription(lineType),
    weight: "",
    rate: "",
    amount: "",
    vatExempt: lineType === "customs",
    weightNote: null,
  };
}

/** Picks an order: its freight line, unless its freight is already billed elsewhere. */
export function addOrder(
  state: BuilderState,
  order: BuilderOrder,
  rates: readonly ServiceRate[],
): BuilderState {
  if (state.orderIds.includes(order.id)) return state;
  const line = order.freightOn
    ? // Freight is billed once per order: an invoiced order gets other charges only.
      {
        ...extraLine("customs", order.id),
        description: t("admin.invoiceBuilder.defaults.customsFor", { reference: order.reference }),
      }
    : freightLineForOrder(order, rates, state.currency);
  const freightCount = state.lines.filter((l) => l.lineType === "freight").length;
  const lines = [...state.lines];
  // Freight lines stay together at the top, in the order they were picked.
  lines.splice(line.lineType === "freight" ? freightCount : lines.length, 0, line);
  return { ...state, orderIds: [...state.orderIds, order.id], lines };
}

/** Unpicks an order: its freight line goes, other lines lose the link. */
export function removeOrder(state: BuilderState, orderId: string): BuilderState {
  return {
    ...state,
    orderIds: state.orderIds.filter((id) => id !== orderId),
    lines: state.lines
      .filter((l) => !(l.lineType === "freight" && l.orderId === orderId))
      .map((l) => (l.orderId === orderId ? { ...l, orderId: null } : l)),
  };
}

/** Removes a line; a freight line unpicks its order. */
export function removeLine(state: BuilderState, key: string): BuilderState {
  const line = state.lines.find((l) => l.key === key);
  if (!line) return state;
  if (line.lineType === "freight" && line.orderId) return removeOrder(state, line.orderId);
  return { ...state, lines: state.lines.filter((l) => l.key !== key) };
}

/**
 * Only these lines print in the order staff give them: freight lines are the
 * item rows (among each other) and each "Overige kosten" line is its own
 * summary row (among each other). Every other charge prints in a fixed place
 * (SUMMARY_ORDER), so moving it would change nothing on the paper.
 */
const ORDERED_TYPES: readonly BuilderLineType[] = ["freight", "other"];

/** The index of the line this one swaps with when moved up (-1) or down (+1), or -1. */
function moveTarget(lines: readonly BuilderLine[], i: number, by: -1 | 1): number {
  const type = lines[i]?.lineType;
  if (!type || !ORDERED_TYPES.includes(type)) return -1;
  for (let j = i + by; j >= 0 && j < lines.length; j += by) {
    if (lines[j]?.lineType === type) return j;
  }
  return -1;
}

/** Whether the line can move up (-1) or down (+1) among the lines of its own printed order. */
export function canMoveLine(state: BuilderState, key: string, by: -1 | 1): boolean {
  return (
    moveTarget(
      state.lines,
      state.lines.findIndex((l) => l.key === key),
      by,
    ) >= 0
  );
}

/** Whether the line's position matters on the paper (freight or "Overige kosten"). */
export function isOrderedLine(line: Pick<BuilderLine, "lineType">): boolean {
  return ORDERED_TYPES.includes(line.lineType);
}

/** Moves a freight or "Overige kosten" line up (-1) or down (+1) past the next one of its kind. */
export function moveLine(state: BuilderState, key: string, by: -1 | 1): BuilderState {
  const i = state.lines.findIndex((l) => l.key === key);
  const j = moveTarget(state.lines, i, by);
  if (j < 0) return state;
  const lines = [...state.lines];
  const a = lines[i];
  const b = lines[j];
  if (!a || !b) return state;
  lines[i] = b;
  lines[j] = a;
  return { ...state, lines };
}

/** A new currency: prefilled rates in another currency no longer apply. */
export function changeCurrency(
  state: BuilderState,
  currency: CurrencyCode,
  orders: readonly BuilderOrder[],
  rates: readonly ServiceRate[],
): BuilderState {
  if (currency === state.currency) return state;
  return {
    ...state,
    currency,
    lines: state.lines.map((l) => {
      if (l.lineType !== "freight" || !l.orderId) return l;
      const order = orders.find((o) => o.id === l.orderId);
      const before = order ? rateFor(order, rates, state.currency) : null;
      // Only a rate the builder filled in itself is swapped; a typed one stays.
      if (!order || decimalText(before) !== l.rate) return l;
      return { ...l, rate: decimalText(rateFor(order, rates, currency)) };
    }),
  };
}

/** A new invoice date moves the due date along until staff set it themselves. */
export function changeInvoiceDate(
  state: BuilderState,
  invoiceDate: string,
  paymentTermDays: number,
): BuilderState {
  return {
    ...state,
    invoiceDate,
    dueDate:
      state.dueTouched || !isValidDate(invoiceDate)
        ? state.dueDate
        : addDays(invoiceDate, paymentTermDays),
  };
}

/** "Datums bijwerken" after issue_invoice refused old dates (hint invoice_dates). */
export function refreshDates(
  state: BuilderState,
  paymentTermDays: number,
  today: string = todayInSuriname(),
): BuilderState {
  return {
    ...state,
    invoiceDate: today,
    dueDate: addDays(today, paymentTermDays),
    dueTouched: false,
  };
}

// ---------------------------------------------------------------------------
// Parsing and validation (the database's CHECKs, said in Dutch beforehand)
// ---------------------------------------------------------------------------

const MAX_LBS = 99_999_999.99; // numeric(10,2)
const MAX_MONEY = 9_999_999_999.99; // numeric(12,2)

function parseNumber(text: string): number | null {
  return parseDecimalInput(text.replace(/\s/g, ""));
}

/** The lines as the preview and the database see them (unparseable fields as null). */
export function draftLines(state: BuilderState, orders: readonly BuilderOrder[]): DraftFormLine[] {
  const byId = new Map(orders.map((o) => [o.id, o]));
  return state.lines.map((l) => {
    const freight = l.lineType === "freight";
    const order = l.orderId ? byId.get(l.orderId) : undefined;
    const weight = freight ? parseNumber(l.weight) : null;
    const rate = freight ? parseNumber(l.rate) : null;
    const amount = freight ? null : parseNumber(l.amount);
    return {
      key: l.key,
      lineType: l.lineType,
      description: l.description.trim(),
      detail:
        freight && order
          ? freightDetail({ trackingNumber: order.tracking_number, reference: order.reference })
          : null,
      orderId: l.orderId,
      weightLbs: weight !== null && weight <= MAX_LBS ? weight : null,
      ratePerLb: rate,
      amount: amount === null ? null : l.lineType === "discount" ? -amount : amount,
      vatExempt: l.vatExempt,
    };
  });
}

/** The references printed under "Referentie:": every order with a line, sorted (as issue_invoice snapshots them). */
export function draftReferences(state: BuilderState, orders: readonly BuilderOrder[]): string[] {
  const ids = new Set(state.lines.flatMap((l) => (l.orderId ? [l.orderId] : [])));
  return orders
    .filter((o) => ids.has(o.id))
    .map((o) => o.reference)
    .sort();
}

/** The builder state as fromDraftForm() wants it (the live preview). */
export function toDraftForm(state: BuilderState, orders: readonly BuilderOrder[]): DraftFormState {
  return {
    currency: state.currency,
    invoiceDate: isValidDate(state.invoiceDate) ? state.invoiceDate : "",
    dueDate: isValidDate(state.dueDate) ? state.dueDate : "",
    customerNote: state.customerNote,
    references: draftReferences(state, orders),
    lines: draftLines(state, orders),
  };
}

/** Field ids: "customer", "invoiceDate", "dueDate", "customerNote", "lines", `line:<key>:<field>`. */
export type BuilderErrors = Record<string, string>;
/** DOM id of a builder field (to focus the first error). */
export const fieldDomId = (field: string) => `ib-${field.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

export const lineField = (
  key: string,
  field: "description" | "weight" | "rate" | "amount" | "order",
) => `line:${key}:${field}`;

export interface ValidationContext {
  orders: readonly BuilderOrder[];
  vatRate: number | null;
  /** "issue" adds issue_invoice's own rules: a line, a positive total, today's dates. */
  mode: "draft" | "issue";
  today?: string;
}

export interface Validation {
  errors: BuilderErrors;
  /** Errors issue_invoice would raise with hint invoice_dates ("Datums bijwerken"). */
  dateProblem: boolean;
  valid: boolean;
}

export function validateBuilder(state: BuilderState, ctx: ValidationContext): Validation {
  const errors: BuilderErrors = {};
  let dateProblem = false;

  if (!state.customerId) errors["customer"] = t("admin.invoiceBuilder.validation.customer");
  if (!isValidDate(state.invoiceDate)) {
    errors["invoiceDate"] = t("admin.invoiceBuilder.validation.date");
  }
  if (!isValidDate(state.dueDate)) {
    errors["dueDate"] = t("admin.invoiceBuilder.validation.date");
  } else if (isValidDate(state.invoiceDate) && state.dueDate < state.invoiceDate) {
    errors["dueDate"] = t("admin.invoiceBuilder.validation.dueBeforeDate");
  }
  if (state.customerNote.trim().length > 2000) {
    errors["customerNote"] = t("admin.invoiceBuilder.validation.tooLong", { max: 2000 });
  }

  const freightOrders = new Set<string>();
  const orderIds = new Set(ctx.orders.map((o) => o.id));
  for (const l of state.lines) {
    const description = l.description.trim();
    if (description === "") {
      errors[lineField(l.key, "description")] = t("admin.invoiceBuilder.validation.description");
    } else if (description.length > 500) {
      errors[lineField(l.key, "description")] = t("admin.invoiceBuilder.validation.tooLong", {
        max: 500,
      });
    }
    if (l.orderId && !orderIds.has(l.orderId)) {
      errors[lineField(l.key, "order")] = t("admin.invoiceBuilder.validation.orderOtherCustomer");
    }
    if (l.lineType === "freight") {
      if (!l.orderId) {
        errors[lineField(l.key, "order")] = t("admin.invoiceBuilder.validation.freightOrder");
      } else if (freightOrders.has(l.orderId)) {
        errors[lineField(l.key, "order")] = t("admin.invoiceBuilder.validation.freightTwice");
      } else {
        freightOrders.add(l.orderId);
        const order = ctx.orders.find((o) => o.id === l.orderId);
        if (order?.freightOn) {
          errors[lineField(l.key, "order")] = t("admin.invoiceBuilder.validation.freightBilled", {
            reference: order.reference,
            invoice: order.freightOn.invoiceNumber ?? t("admin.invoiceBuilder.aDraft"),
          });
        }
      }
      const weight = parseNumber(l.weight);
      if (l.weight.trim() === "") {
        errors[lineField(l.key, "weight")] = t("admin.invoiceBuilder.validation.weightRequired");
      } else if (weight === null || weight <= 0 || weight > MAX_LBS) {
        errors[lineField(l.key, "weight")] = t("admin.invoiceBuilder.validation.weight");
      }
      const rate = parseNumber(l.rate);
      if (l.rate.trim() === "") {
        errors[lineField(l.key, "rate")] = t("admin.invoiceBuilder.validation.rateRequired");
      } else if (rate === null || rate > MAX_MONEY) {
        errors[lineField(l.key, "rate")] = t("admin.invoiceBuilder.validation.money");
      } else if (weight !== null && weight * rate > MAX_MONEY) {
        errors[lineField(l.key, "rate")] = t("admin.invoiceBuilder.validation.tooLarge");
      }
    } else {
      const amount = parseNumber(l.amount);
      if (l.amount.trim() === "") {
        errors[lineField(l.key, "amount")] = t("admin.invoiceBuilder.validation.amountRequired");
      } else if (amount === null || amount > MAX_MONEY) {
        errors[lineField(l.key, "amount")] = t("admin.invoiceBuilder.validation.money");
      }
    }
  }

  // Totals only once every line parses (the database refuses a negative total).
  if (!Object.keys(errors).some((k) => k.startsWith("line:"))) {
    const totals = computeInvoiceTotals(draftLines(state, ctx.orders), ctx.vatRate);
    if (totals.negative) {
      errors["lines"] = t("admin.invoiceBuilder.validation.negative");
    } else if (ctx.mode === "issue" && state.lines.length > 0 && totals.totalAmount <= 0) {
      errors["lines"] = t("admin.invoiceBuilder.validation.zeroTotal");
    }
    if (totals.totalCharges > MAX_MONEY)
      errors["lines"] = t("admin.invoiceBuilder.validation.tooLarge");
  }

  if (ctx.mode === "issue") {
    if (state.lines.length === 0) errors["lines"] = t("admin.invoiceBuilder.validation.noLines");
    const today = ctx.today ?? todayInSuriname();
    if (isValidDate(state.invoiceDate) && !errors["invoiceDate"]) {
      if (state.invoiceDate > today) {
        errors["invoiceDate"] = t("admin.invoiceBuilder.validation.dateFuture");
        dateProblem = true;
      } else if (state.invoiceDate.slice(0, 4) !== today.slice(0, 4)) {
        errors["invoiceDate"] = t("admin.invoiceBuilder.validation.dateOtherYear", {
          year: today.slice(0, 4),
        });
        dateProblem = true;
      }
    }
    if (isValidDate(state.dueDate) && !errors["dueDate"] && state.dueDate < today) {
      errors["dueDate"] = t("admin.invoiceBuilder.validation.duePassed");
      dateProblem = true;
    }
  }

  return { errors, dateProblem, valid: Object.keys(errors).length === 0 };
}

/** The order of the form's fields, for focusing the first error. */
export function errorOrder(state: BuilderState): string[] {
  return [
    "customer",
    "invoiceDate",
    "dueDate",
    ...state.lines.flatMap((l) =>
      (["order", "description", "weight", "rate", "amount"] as const).map((f) =>
        lineField(l.key, f),
      ),
    ),
    "lines",
    "customerNote",
  ];
}

// ---------------------------------------------------------------------------
// Reading and saving (the staff member's own client)
// ---------------------------------------------------------------------------

type InvoiceRow = Tables["invoices"]["Row"];
type ItemRow = Tables["invoice_items"]["Row"];
type ItemInsert = Tables["invoice_items"]["Insert"];

const ITEM_COLUMNS =
  "id, invoice_id, order_id, line_type, description, weight_lbs, rate_per_lb, amount, vat_exempt, sort_order" as const;
export const DRAFT_COLUMNS =
  "id, invoice_number, status, customer_id, currency, invoice_date, due_date, customer_note, replaces_invoice_id, total_amount" as const;

export type DraftInvoice = Pick<
  InvoiceRow,
  | "id"
  | "invoice_number"
  | "status"
  | "customer_id"
  | "currency"
  | "invoice_date"
  | "due_date"
  | "customer_note"
  | "replaces_invoice_id"
  | "total_amount"
>;
export type DraftItem = Pick<
  ItemRow,
  | "id"
  | "invoice_id"
  | "order_id"
  | "line_type"
  | "description"
  | "weight_lbs"
  | "rate_per_lb"
  | "amount"
  | "vat_exempt"
  | "sort_order"
>;

/** A customer's orders, with whether their freight is billed on another invoice (not cancelled). */
export async function loadBuilderOrders(
  db: Client,
  customerId: string,
  currentInvoiceId: string | null = null,
): Promise<BuilderOrder[]> {
  const { data: orders, error } = await db
    .from("orders")
    .select(BUILDER_ORDER_COLUMNS)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (orders.length === 0) return [];
  const ids = orders.map((o) => o.id);
  const { data: lines, error: linesError } = await db
    .from("invoice_items")
    .select("invoice_id, order_id")
    .eq("line_type", "freight")
    .in("order_id", ids);
  if (linesError) throw linesError;
  const invoiceIds = [...new Set(lines.map((l) => l.invoice_id))].filter(
    (id) => id !== currentInvoiceId,
  );
  const invoices = new Map<string, { status: string; invoice_number: string | null }>();
  if (invoiceIds.length > 0) {
    const { data, error: invError } = await db
      .from("invoices")
      .select("id, status, invoice_number")
      .in("id", invoiceIds);
    if (invError) throw invError;
    for (const i of data) invoices.set(i.id, i);
  }
  const billed = new Map<string, { invoiceId: string; invoiceNumber: string | null }>();
  for (const l of lines) {
    const inv = invoices.get(l.invoice_id);
    if (!l.order_id || !inv || inv.status === "cancelled") continue;
    billed.set(l.order_id, { invoiceId: l.invoice_id, invoiceNumber: inv.invoice_number });
  }
  return orders.map((o) => ({ ...o, freightOn: billed.get(o.id) ?? null }));
}

/** The orders listed by default: not cancelled, freight not yet billed (or already on this draft). */
export function listedOrders(
  orders: readonly BuilderOrder[],
  opts: {
    showInvoiced: boolean;
    selected: readonly string[];
    cancelledStatuses?: ReadonlySet<string>;
  },
): BuilderOrder[] {
  return orders.filter(
    (o) =>
      opts.selected.includes(o.id) ||
      ((opts.showInvoiced || o.freightOn === null) &&
        !(opts.cancelledStatuses?.has(o.status) ?? false)),
  );
}

/** A draft with its lines, or null when it does not exist (RLS: staff see all). */
export async function loadDraft(
  db: Client,
  invoiceId: string,
): Promise<{ invoice: DraftInvoice; items: DraftItem[] } | null> {
  const { data: invoice, error } = await db
    .from("invoices")
    .select(DRAFT_COLUMNS)
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) throw error;
  if (!invoice) return null;
  const { data: items, error: itemsError } = await db
    .from("invoice_items")
    .select(ITEM_COLUMNS)
    .eq("invoice_id", invoiceId)
    .order("sort_order")
    .order("created_at");
  if (itemsError) throw itemsError;
  return { invoice, items };
}

/** The builder state of a saved draft. */
export function stateFromDraft(
  invoice: DraftInvoice,
  items: readonly DraftItem[],
  orders: readonly BuilderOrder[],
  rates: readonly ServiceRate[],
  paymentTermDays: number,
): BuilderState {
  const byId = new Map(orders.map((o) => [o.id, o]));
  const lines: BuilderLine[] = items
    .filter((i): i is DraftItem & { line_type: BuilderLineType } => i.line_type !== "late_fee")
    .map((i) => {
      const order = i.order_id ? byId.get(i.order_id) : undefined;
      const service = order ? rates.find((r) => r.service_type === order.service_type) : undefined;
      return {
        key: i.id,
        id: i.id,
        lineType: i.line_type,
        orderId: i.order_id,
        description: i.description,
        weight: decimalText(i.weight_lbs),
        rate: decimalText(i.rate_per_lb),
        amount: i.line_type === "freight" ? "" : decimalText(Math.abs(i.amount)),
        vatExempt: i.vat_exempt,
        weightNote: i.line_type === "freight" && order ? weightPlan(order, service) : null,
      };
    });
  const orderIds: string[] = [];
  for (const l of lines) if (l.orderId && !orderIds.includes(l.orderId)) orderIds.push(l.orderId);
  return {
    customerId: invoice.customer_id,
    currency: invoice.currency,
    invoiceDate: invoice.invoice_date,
    dueDate: invoice.due_date,
    dueTouched: invoice.due_date !== addDays(invoice.invoice_date, paymentTermDays),
    customerNote: invoice.customer_note ?? "",
    replacesInvoiceId: invoice.replaces_invoice_id,
    orderIds,
    lines,
  };
}

function lineRow(l: BuilderLine, sortOrder: number): Omit<ItemInsert, "invoice_id"> {
  const freight = l.lineType === "freight";
  const weight = freight ? parseNumber(l.weight) : null;
  const rate = freight ? parseNumber(l.rate) : null;
  const amount = freight ? null : parseNumber(l.amount);
  if ((freight && (weight === null || rate === null)) || (!freight && amount === null)) {
    // validateBuilder runs first; this only guards against a skipped check.
    throw new CodedError(t("toast.invoiceCreateFailed"), "22023");
  }
  return {
    order_id: l.orderId,
    line_type: l.lineType,
    description: l.description.trim(),
    weight_lbs: weight,
    rate_per_lb: rate,
    // Freight amounts are recomputed by the database; it needs a value anyway.
    amount: freight ? 0 : l.lineType === "discount" ? -(amount ?? 0) : (amount ?? 0),
    vat_exempt: l.vatExempt,
    sort_order: sortOrder,
  };
}

/**
 * Saves the draft. Each request commits on its own and the database
 * recomputes the totals after every line write, refusing any moment at which
 * the total would be negative (22023). So the writes are ordered such that
 * the running total never drops below the final total (which validateBuilder
 * checked is ≥ 0):
 *   1. discounts out of the way: removed discount lines deleted, kept ones
 *      set to 0 (the total only rises);
 *   2. removed charge lines deleted (no discount left, so the total stays
 *      ≥ 0; also frees an order's freight to move to another line), the
 *      header updated, kept charge lines updated, new charge lines inserted;
 *   3. kept discounts set to their final amount and new discount lines
 *      inserted (the total only falls, down to the final total).
 * A NEW draft is one invoice insert plus one insert of all its lines; if the
 * lines are refused, the empty invoice row is deleted again, so a failed
 * first save leaves nothing behind. Returns the invoice id and the saved
 * line ids by key. Issued invoices are refused by the database (55000),
 * never silently changed. Call validateBuilder first.
 */
export async function saveDraft(
  db: Client,
  invoiceId: string | null,
  state: BuilderState,
): Promise<{ invoiceId: string; lineIds: Record<string, string> }> {
  if (!state.customerId)
    throw new CodedError(t("admin.invoiceBuilder.validation.customer"), "22023");
  const header = {
    customer_id: state.customerId,
    currency: state.currency,
    invoice_date: state.invoiceDate,
    due_date: state.dueDate,
    customer_note: state.customerNote.trim() === "" ? null : state.customerNote.trim(),
    replaces_invoice_id: state.replacesInvoiceId,
  };
  const rows = state.lines.map((l, i) => ({ line: l, row: lineRow(l, i) }));
  const lineIds: Record<string, string> = {};

  const insertLines = async (id: string, list: typeof rows) => {
    if (list.length === 0) return;
    const { data, error } = await db
      .from("invoice_items")
      .insert(list.map(({ row }) => ({ ...row, invoice_id: id })))
      .select("id, sort_order");
    if (error) throw error;
    for (const { line, row } of list) {
      const saved = data.find((d) => d.sort_order === row.sort_order);
      if (saved) lineIds[line.key] = saved.id;
    }
  };
  const updateLine = async (lineId: string, patch: Partial<ItemInsert>) => {
    const r = await db.from("invoice_items").update(patch).eq("id", lineId).select("id").single();
    if (r.error) throw r.error;
    return r.data.id;
  };
  const deleteLines = async (ids: string[]) => {
    if (ids.length === 0) return;
    const del = await db.from("invoice_items").delete().in("id", ids);
    if (del.error) throw del.error;
  };

  if (invoiceId === null) {
    const { data, error } = await db.from("invoices").insert(header).select("id").single();
    if (error) throw error;
    try {
      // One statement: the totals are recomputed only once all lines are in.
      await insertLines(data.id, rows);
    } catch (lineError) {
      // Best effort: an empty draft must not stay behind (it is still a draft).
      await db.from("invoices").delete().eq("id", data.id);
      throw lineError;
    }
    return { invoiceId: data.id, lineIds };
  }

  const id = invoiceId;
  const { data: existing, error } = await db
    .from("invoice_items")
    .select("id, line_type, amount")
    .eq("invoice_id", id);
  if (error) throw error;
  const kept = new Set(state.lines.flatMap((l) => (l.id ? [l.id] : [])));
  const isDiscount = (row: { line_type: string }) => row.line_type === "discount";

  // 1. Discounts out of the way.
  await deleteLines(existing.filter((e) => isDiscount(e) && !kept.has(e.id)).map((e) => e.id));
  for (const e of existing) {
    if (isDiscount(e) && kept.has(e.id) && Number(e.amount) !== 0) {
      await updateLine(e.id, { amount: 0 });
    }
  }

  // 2. Charges (every type but discount), with the header in between.
  await deleteLines(existing.filter((e) => !isDiscount(e) && !kept.has(e.id)).map((e) => e.id));
  const upd = await db.from("invoices").update(header).eq("id", id).select("id").single();
  if (upd.error) throw upd.error;
  const charges = rows.filter(({ row }) => row.line_type !== "discount");
  for (const { line, row } of charges) {
    if (line.id) lineIds[line.key] = await updateLine(line.id, row);
  }
  await insertLines(
    id,
    charges.filter(({ line }) => !line.id),
  );

  // 3. Discounts to their final amounts.
  const discounts = rows.filter(({ row }) => row.line_type === "discount");
  for (const { line, row } of discounts) {
    if (line.id) lineIds[line.key] = await updateLine(line.id, row);
  }
  await insertLines(
    id,
    discounts.filter(({ line }) => !line.id),
  );
  return { invoiceId: id, lineIds };
}

/** Puts the saved ids on the lines, so the next save updates instead of inserting. */
export function withSavedIds(state: BuilderState, lineIds: Record<string, string>): BuilderState {
  return {
    ...state,
    lines: state.lines.map((l) => (lineIds[l.key] ? { ...l, id: lineIds[l.key] ?? null } : l)),
  };
}

/** "Concept verwijderen": drafts can be deleted, issued invoices never (database). */
export async function deleteDraft(db: Client, invoiceId: string): Promise<void> {
  const { data, error } = await db.from("invoices").delete().eq("id", invoiceId).select("id");
  if (error) throw error;
  if (data.length === 0) throw new CodedError(t("apiError.notFound"), "P0002");
}

/** "2,34 lbs gemeten → 2,50 lbs" for the weight hint under a freight line. */
export function weightNoteText(note: WeightNote): string {
  const lbs = (n: number) => formatNumber(n, 2);
  switch (note.kind) {
    case "measured":
      return note.raw !== null && note.billed !== null && note.raw !== note.billed
        ? t("admin.invoiceBuilder.weight.measuredRounded", {
            raw: lbs(note.raw),
            billed: lbs(note.billed),
          })
        : t("admin.invoiceBuilder.weight.measured");
    case "declared":
      return t("admin.invoiceBuilder.weight.declared", { raw: lbs(note.raw ?? 0) });
    case "missing":
      return t("admin.invoiceBuilder.weight.missing");
  }
}
