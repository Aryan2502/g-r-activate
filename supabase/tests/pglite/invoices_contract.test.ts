// @vitest-environment node
/**
 * P7 invoices against the real migrations: the app's own code runs unchanged
 * with each person's own client (supabase-standin.ts: every request its own
 * committed transaction as `authenticated`), so RLS, the column grants, the
 * triggers (totals, payment-derived status, immutability) and the RPC guards
 * behave as in production:
 *
 * - drafts saved by the builder (lib/admin/invoice-builder.ts) and issued as
 *   issueInvoiceFn does;
 * - payments, "Markeer als betaald", voiding, cancelling, "Corrigeren" and the
 *   late fee through lib/admin/invoice-actions.ts (what the server functions run);
 * - the lists and pages: lib/admin/invoices.ts, lib/admin/invoice-queries.ts
 *   and lib/portal/invoices.ts (their queryFns, with the browser client
 *   pointed at the person under test).
 *
 * A customer can do none of the writes and never sees a draft.
 */
import type { QueryFunction, SkipToken } from "@tanstack/react-query";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The app's query modules use the browser client: point it at whoever is "signed in".
const current = vi.hoisted(() => ({
  client: null as null | { from: (t: string) => unknown; rpc: (...a: never[]) => unknown },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => current.client!.from(table),
    rpc: (...args: never[]) => current.client!.rpc(...args),
  },
}));

import {
  addOrder,
  initialBuilderState,
  loadBuilderOrders,
  saveDraft,
  type BuilderState,
} from "@/lib/admin/invoice-builder";
import {
  applyLateFee,
  cancelInvoice,
  canApplyLateFee,
  lateFeePreview,
  markInvoicePaid,
  recordPayment,
  voidPayment,
} from "@/lib/admin/invoice-actions";
import {
  invoicePaymentsQueryOptions,
  invoiceRelationsQueryOptions,
  invoiceViewQueryOptions,
} from "@/lib/admin/invoice-queries";
import {
  adminInvoicesQueryOptions,
  filterInvoices,
  joinInvoices,
  summarizeInvoiceList,
} from "@/lib/admin/invoices";
import type { ServiceRate } from "@/lib/admin/settings";
import { toAppError } from "@/lib/errors";
import { todayInSuriname } from "@/lib/format";
import { fromIssuedInvoice, paymentInstruction } from "@/lib/invoice/model";
import {
  portalInvoiceQueryOptions,
  portalInvoicesQueryOptions,
  summarizeOpenInvoices,
} from "@/lib/portal/invoices";

import { type AuthUser, type Db, createAuthUser, createDb } from "./harness";
import { userClient } from "./supabase-standin";

type Client = ReturnType<typeof userClient>;
type AppClient = Parameters<typeof saveDraft>[0];
type ActionClient = Parameters<typeof recordPayment>[0];

let db: Db;
let staff: AuthUser;
let admin: AuthUser;
let alice: AuthUser;
let bob: AuthUser;
let aliceCustomer: string;
let bobCustomer: string;
let rates: ServiceRate[];
const TODAY = todayInSuriname();

const as = (user: AuthUser): Client => {
  const client = userClient(db, user.id);
  current.client = client as unknown as typeof current.client;
  return client;
};
const app = (c: Client) => c as unknown as AppClient & ActionClient;
/** Runs a queryOptions' queryFn as the person `as()` last chose. */
const read = <T>(options: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryFn?: QueryFunction<T, any, never> | SkipToken;
}): Promise<T> => (options.queryFn as () => Promise<T>)();
const refused = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => toAppError(e),
  );

async function newOrder(customerId: string, measured: number) {
  const r = await db.query<{ id: string }>(
    `insert into public.orders (customer_id, description, store_vendor, vendor_order_number, tracking_number)
     values ($1, 'Pakket', 'Amazon', '112-' || floor(random() * 100000)::text, '1Z' || floor(random() * 1e9)::text) returning id`,
    [customerId],
  );
  const id = r.rows[0]!.id;
  await db.query("update public.orders set measured_weight_lbs = $1 where id = $2", [measured, id]);
  return id;
}

/** "Opslaan als concept" with the builder, as staff: one freight line per order. */
async function draft(
  customerId: string,
  weights: number[],
  opts: { currency?: "USD" | "SRD"; replaces?: string | null } = {},
): Promise<{ invoiceId: string; orderIds: string[] }> {
  const c = as(staff);
  const orderIds = [];
  for (const w of weights) orderIds.push(await newOrder(customerId, w));
  const orders = await loadBuilderOrders(app(c), customerId);
  let s: BuilderState = initialBuilderState({
    customerId,
    currency: opts.currency ?? "USD",
    paymentTermDays: 7,
    today: TODAY,
    replacesInvoiceId: opts.replaces ?? null,
  });
  for (const id of orderIds)
    s = addOrder(
      s,
      orders.find((o) => o.id === id)!,
      rates,
    );
  if (opts.currency === "SRD") {
    s = { ...s, lines: s.lines.map((l) => ({ ...l, rate: "150" })) };
  }
  const saved = await saveDraft(app(c), null, s);
  return { invoiceId: saved.invoiceId, orderIds };
}

/** "Genereer factuur": issue_invoice with the staff member's own client (issueInvoiceFn). */
async function issue(invoiceId: string): Promise<{ invoice_number: string; total_amount: number }> {
  const { data, error } = await as(staff).rpc("issue_invoice", { _invoice_id: invoiceId });
  if (error) throw new Error(JSON.stringify(error));
  return data as { invoice_number: string; total_amount: number };
}

/** Fixture: ages an issued invoice as time would (issued invoices are immutable). */
async function age(invoiceId: string, invoiceOffset: number, dueOffset: number) {
  await db.transaction(async (tx) => {
    await tx.exec("set local session_replication_role = replica");
    await tx.query(
      `update public.invoices set invoice_date = $2::date + $3::int, due_date = $2::date + $4::int where id = $1`,
      [invoiceId, TODAY, invoiceOffset, dueOffset],
    );
  });
}

async function staffView(invoiceId: string) {
  as(staff);
  const view = await read(invoiceViewQueryOptions(staff.id, invoiceId));
  return view!;
}

beforeAll(async () => {
  db = await createDb();
  staff = await createAuthUser(db, { email: "staff@example.com" });
  admin = await createAuthUser(db, { email: "admin@example.com" });
  await db.query(
    "insert into public.user_roles (user_id, role) values ($1, 'staff'), ($2, 'admin')",
    [staff.id, admin.id],
  );
  await db.query(
    `update public.customers set user_id = null, status = 'disabled', disabled_reason = 'team login'
      where user_id = any($1)`,
    [[staff.id, admin.id]],
  );
  alice = await createAuthUser(db, {
    email: "alice@example.com",
    meta: { full_name: "Alice Jansen", phone: "+597 8000001" },
  });
  bob = await createAuthUser(db, {
    email: "bob@example.com",
    meta: { full_name: "Bob Bakker", phone: "+597 8000002" },
  });
  const ids = await db.query<{ id: string; user_id: string }>(
    "select id, user_id from public.customers where user_id = any($1)",
    [[alice.id, bob.id]],
  );
  aliceCustomer = ids.rows.find((r) => r.user_id === alice.id)!.id;
  bobCustomer = ids.rows.find((r) => r.user_id === bob.id)!.id;
  await db.query(
    "update public.service_rates set rate_per_lb = 4.5, weight_rounding = '0.5', minimum_billable_lbs = 1 where service_type = 'air'",
  );
  await db.query(
    "update public.company_bank_accounts set bank_name = 'DSB', account_holder = 'G&R Solutions N.V.', account_number = '1234567' where currency = 'USD' and is_active",
  );
  rates = (await db.query<ServiceRate>("select * from public.service_rates")).rows.map((r) => ({
    ...r,
    rate_per_lb: r.rate_per_lb === null ? null : Number(r.rate_per_lb),
    minimum_billable_lbs: r.minimum_billable_lbs === null ? null : Number(r.minimum_billable_lbs),
  }));
});

afterAll(async () => {
  await db?.close();
});

// ---------------------------------------------------------------------------

describe("drafts and issuing", () => {
  it("staff see drafts in /admin/facturen; the customer never does, not even by id", async () => {
    const { invoiceId, orderIds } = await draft(aliceCustomer, [2.2]);

    as(staff);
    const list = await read(adminInvoicesQueryOptions(staff.id));
    const row = list.invoices.find((i) => i.id === invoiceId);
    expect(row).toMatchObject({ status: "draft", invoice_number: null, total_amount: 11.25 });
    const reference = (
      await db.query<{ reference: string }>("select reference from public.orders where id = $1", [
        orderIds[0],
      ])
    ).rows[0]!.reference;
    expect(list.references.get(invoiceId)).toEqual([reference]);
    const items = joinInvoices(list, [
      {
        id: aliceCustomer,
        customer_code: "GR00000",
        full_name: "Alice Jansen",
        company_name: null,
        account_type: "personal",
        status: "active",
        user_id: alice.id,
      },
    ]);
    expect(filterInvoices(items, { q: reference }, TODAY).map((i) => i.id)).toContain(invoiceId);
    expect(filterInvoices(items, { status: "draft" }, TODAY).map((i) => i.id)).toContain(invoiceId);

    const customer = as(alice);
    const own = await read(portalInvoicesQueryOptions(alice.id, aliceCustomer));
    expect(own.map((i) => i.id)).not.toContain(invoiceId);
    expect(await read(portalInvoiceQueryOptions(alice.id, aliceCustomer, invoiceId))).toBeNull();
    // Without the app's own filters, RLS still hides the draft and its lines.
    const raw = await customer.from("invoice_overview").select("id").eq("id", invoiceId);
    expect(raw).toEqual({ data: [], error: null });
    const lines = await customer.from("invoice_items").select("id").eq("invoice_id", invoiceId);
    expect(lines).toEqual({ data: [], error: null });
  });

  it("after issue_invoice the customer sees it, rendered from the snapshots", async () => {
    const { invoiceId } = await draft(aliceCustomer, [3.4]);
    const issued = await issue(invoiceId);
    expect(issued.invoice_number).toMatch(new RegExp(`^INV-${TODAY.slice(0, 4)}-\\d{4}$`));

    as(alice);
    const list = await read(portalInvoicesQueryOptions(alice.id, aliceCustomer));
    const mine = list.find((i) => i.id === invoiceId)!;
    expect(mine).toMatchObject({ status: "open", balance_due: 15.75, is_overdue: false });
    expect(mine.orders).toHaveLength(1);

    const page = (await read(portalInvoiceQueryOptions(alice.id, aliceCustomer, invoiceId)))!;
    const model = fromIssuedInvoice(page.invoice, page.items);
    expect(model.meta.invoiceNumber).toBe(issued.invoice_number);
    expect(model.issuer.bankAccounts.find((b) => b.currency === "USD")).toEqual({
      currency: "USD",
      bankName: "DSB",
      accountHolder: "G&R Solutions N.V.",
      accountNumber: "1234567",
    });
    expect(paymentInstruction(model)).toMatch(
      new RegExp(
        `^Factuurvaluta: USD · Vermeld bij betaling: ${issued.invoice_number} / GR\\d{5}$`,
      ),
    );
    expect(page.payments).toEqual([]);

    // Another customer gets nothing for it.
    as(bob);
    expect(await read(portalInvoiceQueryOptions(bob.id, bobCustomer, invoiceId))).toBeNull();
    expect(await read(portalInvoiceQueryOptions(bob.id, aliceCustomer, invoiceId))).toBeNull();
  });
});

describe("payments (staff)", () => {
  it("a part payment, then 'Markeer als betaald'; the status follows; overpaying and future dates are refused", async () => {
    const { invoiceId } = await draft(aliceCustomer, [10]); // 10 lbs × 4,50 = 45,00
    await issue(invoiceId);
    const c = app(as(staff));

    const over = await refused(
      recordPayment(c, {
        invoiceId,
        amount: 45.01,
        paidOn: TODAY,
        method: "cash",
        reference: null,
        customerNote: null,
        receivedAmount: null,
        receivedCurrency: null,
      }),
    );
    expect(over).toMatchObject({ code: "22023" });
    expect(over?.message).toMatch(/^Het bedrag is hoger dan het openstaande saldo/);

    const future = await refused(
      recordPayment(c, {
        invoiceId,
        amount: 5,
        paidOn: "2999-01-01",
        method: "cash",
        reference: null,
        customerNote: null,
        receivedAmount: null,
        receivedCurrency: null,
      }),
    );
    expect(future).toMatchObject({ code: "22023", message: "De betaaldatum ligt in de toekomst" });

    const part = await recordPayment(c, {
      invoiceId,
      amount: 20,
      paidOn: TODAY,
      method: "cash",
      reference: "Bon 17",
      customerNote: "Dank u, rest volgt",
      receivedAmount: 740,
      receivedCurrency: "SRD",
    });
    expect(part).toMatchObject({ invoiceStatus: "partially_paid", amountPaid: 20, balanceDue: 25 });

    const full = await markInvoicePaid(c, {
      invoiceId,
      paidOn: TODAY,
      method: "bank_transfer",
      reference: null,
      customerNote: null,
      amount: 25,
    });
    expect(full).toMatchObject({ invoiceStatus: "paid", amountPaid: 45, balanceDue: 0 });
    expect((await staffView(invoiceId)).invoice).toMatchObject({ status: "paid", balance_due: 0 });
    expect((await staffView(invoiceId)).invoice.paid_at).not.toBeNull();

    const again = await refused(
      markInvoicePaid(c, {
        invoiceId,
        paidOn: TODAY,
        method: "cash",
        reference: null,
        customerNote: null,
        amount: 25,
      }),
    );
    expect(again).toMatchObject({ code: "55000" });

    // The customer sees both payments, with the note meant for them.
    as(alice);
    const page = (await read(portalInvoiceQueryOptions(alice.id, aliceCustomer, invoiceId)))!;
    expect(page.invoice.status).toBe("paid");
    expect(page.payments.map((p) => [p.amount, p.method, p.customer_note])).toEqual(
      expect.arrayContaining([
        [20, "cash", "Dank u, rest volgt"],
        [25, "bank_transfer", null],
      ]),
    );
  });
});

describe("admin actions", () => {
  it("voiding a payment: admins only, with a reason; the customer no longer sees it, staff do", async () => {
    const { invoiceId } = await draft(aliceCustomer, [4]); // 18,00
    await issue(invoiceId);
    const paid = await markInvoicePaid(app(as(staff)), {
      invoiceId,
      paidOn: TODAY,
      method: "pin",
      reference: null,
      customerNote: null,
      amount: 18,
    });

    const byStaff = await refused(
      voidPayment(app(as(staff)), { paymentId: paid.paymentId, reason: "Dubbel geboekt" }),
    );
    expect(byStaff).toMatchObject({ code: "42501" });

    const voided = await voidPayment(app(as(admin)), {
      paymentId: paid.paymentId,
      reason: "Dubbel geboekt",
    });
    expect(voided).toMatchObject({ invoiceStatus: "open", amountPaid: 0, balanceDue: 18 });
    const twice = await refused(
      voidPayment(app(as(admin)), { paymentId: paid.paymentId, reason: "nog eens" }),
    );
    expect(twice).toMatchObject({ code: "55000", message: "Deze betaling is al ongedaan gemaakt" });

    as(staff);
    const payments = await read(invoicePaymentsQueryOptions(staff.id, invoiceId));
    expect(payments).toEqual([
      expect.objectContaining({ id: paid.paymentId, void_reason: "Dubbel geboekt" }),
    ]);
    expect(payments[0]?.voided_at).not.toBeNull();

    as(alice);
    const page = (await read(portalInvoiceQueryOptions(alice.id, aliceCustomer, invoiceId)))!;
    expect(page.payments).toEqual([]);
    expect(page.invoice).toMatchObject({ status: "open", balance_due: 18 });
  });

  it("'Markeer als betaald' pays the balance staff saw: refused if it dropped, partly paid if it rose", async () => {
    const { invoiceId } = await draft(aliceCustomer, [6]); // 27,00
    await issue(invoiceId);
    const first = await recordPayment(app(as(staff)), {
      invoiceId,
      amount: 7,
      paidOn: TODAY,
      method: "cash",
      reference: null,
      customerNote: null,
      receivedAmount: null,
      receivedCurrency: null,
    });
    // Staff A opens "Markeer als betaald" at a balance of 20,00 …
    const seen = (await staffView(invoiceId)).invoice.balance_due;
    expect(seen).toBe(20);

    // … meanwhile staff B records 5,00: the balance drops to 15,00 and A's 20,00 is refused.
    await recordPayment(app(as(staff)), {
      invoiceId,
      amount: 5,
      paidOn: TODAY,
      method: "cash",
      reference: null,
      customerNote: null,
      receivedAmount: null,
      receivedCurrency: null,
    });
    const dropped = await refused(
      markInvoicePaid(app(as(staff)), {
        invoiceId,
        paidOn: TODAY,
        method: "bank_transfer",
        reference: null,
        customerNote: null,
        amount: seen!,
      }),
    );
    expect(dropped).toMatchObject({ code: "22023" });
    expect(dropped?.message).toMatch(/^Het bedrag is hoger dan het openstaande saldo/);

    // An admin voids the 7,00 (balance 22,00); A's confirmed 15,00 is recorded as seen,
    // not the new balance, so the invoice stays partly paid with 7,00 open.
    const now = (await staffView(invoiceId)).invoice.balance_due!;
    await voidPayment(app(as(admin)), { paymentId: first.paymentId, reason: "Dubbel" });
    const partly = await markInvoicePaid(app(as(staff)), {
      invoiceId,
      paidOn: TODAY,
      method: "bank_transfer",
      reference: null,
      customerNote: null,
      amount: now,
    });
    expect(partly).toMatchObject({
      invoiceStatus: "partially_paid",
      amountPaid: 20,
      balanceDue: 7,
    });
  });

  it("cancel and 'Corrigeren': admins only, never with payments on it; the replacement is issued", async () => {
    const { invoiceId, orderIds } = await draft(aliceCustomer, [6]); // 27,00
    const issued = await issue(invoiceId);
    const pay = await recordPayment(app(as(staff)), {
      invoiceId,
      amount: 7,
      paidOn: TODAY,
      method: "cash",
      reference: null,
      customerNote: null,
      receivedAmount: null,
      receivedCurrency: null,
    });

    expect(
      await refused(cancelInvoice(app(as(staff)), { invoiceId, reason: "Verkeerd gewicht" })),
    ).toMatchObject({ code: "42501" });
    const withPayments = await refused(
      cancelInvoice(app(as(admin)), { invoiceId, reason: "Verkeerd gewicht" }),
    );
    expect(withPayments).toMatchObject({ code: "55000" });
    expect(withPayments?.message).toBe(
      `Op factuur ${issued.invoice_number} staan betalingen; maak die eerst ongedaan`,
    );

    await voidPayment(app(as(admin)), { paymentId: pay.paymentId, reason: "Terugbetaald" });
    const cancelled = await cancelInvoice(app(as(admin)), {
      invoiceId,
      reason: "Verkeerd gewicht",
    });
    expect(cancelled).toEqual({
      invoiceId,
      invoiceNumber: issued.invoice_number,
      customerId: aliceCustomer,
    });
    const payAfter = await refused(
      markInvoicePaid(app(as(staff)), {
        invoiceId,
        paidOn: TODAY,
        method: "cash",
        reference: null,
        customerNote: null,
        amount: 27,
      }),
    );
    expect(payAfter).toMatchObject({ code: "55000" });

    // The customer sees it cancelled, with the reason.
    as(alice);
    const list = await read(portalInvoicesQueryOptions(alice.id, aliceCustomer));
    expect(list.find((i) => i.id === invoiceId)).toMatchObject({
      status: "cancelled",
      cancel_reason: "Verkeerd gewicht",
    });

    // "Corrigeren": the builder's new draft replaces it; the freight of the order is free again.
    const c = app(as(staff));
    const orders = await loadBuilderOrders(c, aliceCustomer);
    expect(orders.find((o) => o.id === orderIds[0])?.freightOn).toBeNull();
    let s = initialBuilderState({
      customerId: aliceCustomer,
      currency: "USD",
      paymentTermDays: 7,
      today: TODAY,
      replacesInvoiceId: invoiceId,
    });
    s = addOrder(
      s,
      orders.find((o) => o.id === orderIds[0])!,
      rates,
    );
    s = { ...s, lines: s.lines.map((l) => ({ ...l, weight: "5,5" })) };
    const replacement = await saveDraft(c, null, s);
    const reissued = await issue(replacement.invoiceId);
    expect(Number(reissued.total_amount)).toBe(24.75);

    as(staff);
    const relations = await read(invoiceRelationsQueryOptions(staff.id, invoiceId, null));
    expect(relations.replacedBy).toEqual([
      expect.objectContaining({
        id: replacement.invoiceId,
        invoice_number: reissued.invoice_number,
      }),
    ]);
    const back = await read(
      invoiceRelationsQueryOptions(staff.id, replacement.invoiceId, invoiceId),
    );
    expect(back.replaces).toMatchObject({ id: invoiceId, invoice_number: issued.invoice_number });
  });

  it("the late fee: admins only, only when overdue, once; the dialog's amount is what the database adds", async () => {
    const { invoiceId } = await draft(aliceCustomer, [10.1]); // 10,5 lbs × 4,50 = 47,25
    await issue(invoiceId);
    // Balance 45,10: 15% = 6,765 → 6,77 only when rounding half-up (the edge the dialog must match).
    await recordPayment(app(as(staff)), {
      invoiceId,
      amount: 2.15,
      paidOn: TODAY,
      method: "cash",
      reference: null,
      customerNote: null,
      receivedAmount: null,
      receivedCurrency: null,
    });

    const early = await refused(applyLateFee(app(as(admin)), { invoiceId }));
    expect(early).toMatchObject({ code: "55000" });
    expect(early?.message).toMatch(/is niet achterstallig/);

    await age(invoiceId, -12, -5);
    const view = await staffView(invoiceId);
    expect(view.invoice).toMatchObject({ is_overdue: true, days_overdue: 5, balance_due: 45.1 });
    const percent = fromIssuedInvoice(view.invoice, view.items).issuer.lateFeePercent!;
    expect(percent).toBe(15);
    expect(canApplyLateFee(view.invoice, percent, false)).toBe(true);
    const preview = lateFeePreview(view.invoice, percent);
    expect(preview).toEqual({ fee: 6.77, newTotal: 54.02, newBalance: 51.87 });

    expect(await refused(applyLateFee(app(as(staff)), { invoiceId }))).toMatchObject({
      code: "42501",
    });
    const applied = await applyLateFee(app(as(admin)), { invoiceId });
    expect(applied.totalAmount).toBe(preview.newTotal);
    const after = await staffView(invoiceId);
    expect(after.invoice).toMatchObject({ total_amount: 54.02, balance_due: 51.87 });
    expect(after.invoice.late_fee_applied_at).not.toBeNull();
    expect(after.items.find((i) => i.line_type === "late_fee")).toMatchObject({
      description: "Opslag te late betaling (15%)",
      amount: 6.77,
    });
    expect(canApplyLateFee(after.invoice, percent, true)).toBe(false);
    expect(await refused(applyLateFee(app(as(admin)), { invoiceId }))).toMatchObject({
      code: "55000",
    });

    // The customer sees the new total, and "Achterstallig" from the view.
    as(alice);
    const list = await read(portalInvoicesQueryOptions(alice.id, aliceCustomer));
    const summary = summarizeOpenInvoices(list);
    expect(summary.overdueCount).toBeGreaterThanOrEqual(1);
    expect(list.find((i) => i.id === invoiceId)).toMatchObject({
      is_overdue: true,
      balance_due: 51.87,
    });
  });
});

describe("a customer can do none of it", () => {
  it("issue, payments, mark paid, void, cancel and the late fee are refused (42501)", async () => {
    const { invoiceId } = await draft(aliceCustomer, [2]);
    expect(
      toAppError((await as(alice).rpc("issue_invoice", { _invoice_id: invoiceId })).error),
    ).toMatchObject({ code: "42501" });
    const { total_amount } = await issue(invoiceId);
    const pay = await markInvoicePaid(app(as(staff)), {
      invoiceId,
      paidOn: TODAY,
      method: "cash",
      reference: null,
      customerNote: null,
      amount: Number(total_amount),
    });

    const customer = app(as(alice));
    for (const attempt of [
      recordPayment(customer, {
        invoiceId,
        amount: 1,
        paidOn: TODAY,
        method: "cash",
        reference: null,
        customerNote: null,
        receivedAmount: null,
        receivedCurrency: null,
      }),
      markInvoicePaid(customer, {
        invoiceId,
        paidOn: TODAY,
        method: "cash",
        reference: null,
        customerNote: null,
        amount: 1,
      }),
      voidPayment(customer, { paymentId: pay.paymentId, reason: "x" }),
      cancelInvoice(customer, { invoiceId, reason: "x" }),
      applyLateFee(customer, { invoiceId }),
    ]) {
      expect(await refused(attempt)).toMatchObject({ code: "42501" });
    }

    // Nor straight at the tables.
    const direct = as(alice);
    const insert = await direct
      .from("payments")
      .insert({ invoice_id: invoiceId, amount: 1, method: "cash" })
      .select("id");
    expect(toAppError(insert.error).code).toBe("42501");
    // RLS gives the customer no row to update: nothing changes.
    const update = await direct
      .from("invoices")
      .update({ customer_note: "x" })
      .eq("id", invoiceId)
      .select("id");
    expect(update).toEqual({ data: [], error: null });
    const note = await db.query<{ customer_note: string | null; status: string }>(
      "select customer_note, status from public.invoices where id = $1",
      [invoiceId],
    );
    expect(note.rows[0]).toEqual({ customer_note: null, status: "paid" });
  });
});

describe("the list's totals come from the view, per currency", () => {
  it("never adds USD and SRD together", async () => {
    const usd = await draft(bobCustomer, [2]); // 9,00
    await issue(usd.invoiceId);
    const srd = await draft(bobCustomer, [2], { currency: "SRD" }); // 2 × 150 = 300,00
    await issue(srd.invoiceId);

    as(staff);
    const data = await read(adminInvoicesQueryOptions(staff.id));
    const bobs = data.invoices.filter((i) => i.customer_id === bobCustomer);
    expect(summarizeInvoiceList(bobs)).toMatchObject({
      issuedCount: 2,
      invoiced: [
        { currency: "USD", amount: 9 },
        { currency: "SRD", amount: 300 },
      ],
      outstanding: [
        { currency: "USD", amount: 9 },
        { currency: "SRD", amount: 300 },
      ],
    });
  });
});
