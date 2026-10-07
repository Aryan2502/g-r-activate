import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  submitRecordPayment: vi.fn(),
  submitMarkPaid: vi.fn(),
  submitVoidPayment: vi.fn(),
  submitCancelInvoice: vi.fn(),
  submitApplyLateFee: vi.fn(),
  fetchInvoiceShare: vi.fn(),
}));
const navigate = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/server-fns/invoices.functions", () => server);
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";

import { t } from "@/lib/i18n";
import { fromIssuedInvoice } from "@/lib/invoice/model";

import {
  CancelInvoiceDialog,
  LateFeeDialog,
  PaymentDialog,
  ShareInvoiceDialog,
  type InvoiceActionTarget,
} from "./InvoiceDialogs";

const INVOICE = "b0000000-0000-4000-8000-000000000001";
const target: InvoiceActionTarget = {
  id: INVOICE,
  invoiceNumber: "INV-2026-0013",
  customerId: "c0c0c0c0-0000-4000-8000-000000000001",
  currency: "USD",
  total: 45.15,
  amountPaid: 0,
  balance: 45.15,
};

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PaymentDialog", () => {
  it("shows every error at once, focuses the first and sends nothing", () => {
    wrap(<PaymentDialog userId="u1" invoice={target} mode="amount" open onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const amount = within(dialog).getByLabelText(
      t("admin.invoices.payment.amount", { currency: "USD" }),
    );
    fireEvent.change(amount, { target: { value: "50" } });
    fireEvent.change(within(dialog).getByLabelText(t("admin.invoices.payment.receivedAmount")), {
      target: { value: "10" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: t("admin.invoices.payment.submit") }),
    );
    expect(
      within(dialog).getByText(
        t("admin.invoices.payment.validation.overBalance", { balance: "USD 45,15" }),
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(t("admin.invoices.payment.validation.receivedCurrency")),
    ).toBeInTheDocument();
    expect(amount).toHaveFocus();
    expect(server.submitRecordPayment).not.toHaveBeenCalled();
  });

  it("records a part payment and says no e-mail goes out for it", async () => {
    server.submitRecordPayment.mockResolvedValue({
      ok: true,
      emailOutcome: null,
      paymentId: "p1",
      invoiceStatus: "partially_paid",
      amountPaid: 20,
      balanceDue: 25.15,
    });
    const onOpenChange = vi.fn();
    wrap(
      <PaymentDialog userId="u1" invoice={target} mode="amount" open onOpenChange={onOpenChange} />,
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.change(
      within(dialog).getByLabelText(t("admin.invoices.payment.amount", { currency: "USD" })),
      { target: { value: "20,00" } },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: t("admin.invoices.payment.submit") }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(server.submitRecordPayment).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: INVOICE, amount: 20, method: "bank_transfer" }),
    );
    expect(toast.success).toHaveBeenCalledWith(
      t("admin.invoices.payment.success", { amount: "USD 20,00" }),
      { description: t("admin.invoices.payment.noEmailPartial") },
    );
  });

  it("'Markeer als betaald' pays the balance shown in the dialog (sent as the amount)", async () => {
    server.submitMarkPaid.mockResolvedValue({
      ok: true,
      emailOutcome: "skipped",
      paymentId: "p1",
      invoiceStatus: "paid",
      amountPaid: 45.15,
      balanceDue: 0,
    });
    wrap(<PaymentDialog userId="u1" invoice={target} mode="full" open onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText(/Bedrag/)).toBeNull();
    fireEvent.click(
      within(dialog).getByRole("button", { name: t("admin.invoices.payment.submitFull") }),
    );
    await waitFor(() => expect(server.submitMarkPaid).toHaveBeenCalled());
    // The balance the staff member confirmed: if it dropped meanwhile the database refuses it.
    expect(server.submitMarkPaid.mock.calls[0]?.[0]).toMatchObject({ amount: 45.15 });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        t("admin.invoices.payment.successPaid", { number: "INV-2026-0013" }),
        expect.anything(),
      ),
    );
  });

  it("refuses '1.250' (Dutch thousands or 1,25?) instead of recording USD 1,25, and echoes what will be recorded", () => {
    const big = { ...target, total: 1500, balance: 1500 };
    wrap(<PaymentDialog userId="u1" invoice={big} mode="amount" open onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const amount = within(dialog).getByLabelText(
      t("admin.invoices.payment.amount", { currency: "USD" }),
    );
    fireEvent.change(amount, { target: { value: "1.250" } });
    fireEvent.click(
      within(dialog).getByRole("button", { name: t("admin.invoices.payment.submit") }),
    );
    expect(
      within(dialog).getByText(
        t("admin.invoices.payment.validation.ambiguous", {
          thousands: "USD 1.250,00",
          plain: "1250",
        }),
      ),
    ).toBeInTheDocument();
    expect(server.submitRecordPayment).not.toHaveBeenCalled();
    fireEvent.change(amount, { target: { value: "1.250,00" } });
    expect(
      within(dialog).getByText(t("admin.invoices.payment.amountEcho", { amount: "USD 1.250,00" })),
    ).toBeInTheDocument();
  });

  it("a balance change while open shows a notice and keeps the typed amount", () => {
    const { rerender } = wrap(
      <PaymentDialog userId="u1" invoice={target} mode="amount" open onOpenChange={() => {}} />,
    );
    const dialog = screen.getByRole("dialog");
    const amount = within(dialog).getByLabelText(
      t("admin.invoices.payment.amount", { currency: "USD" }),
    );
    fireEvent.change(amount, { target: { value: "20" } });
    const client = new QueryClient();
    rerender(
      <QueryClientProvider client={client}>
        <PaymentDialog
          userId="u1"
          invoice={{ ...target, total: 51.92, balance: 51.92 }}
          mode="amount"
          open
          onOpenChange={() => {}}
        />
      </QueryClientProvider>,
    );
    expect(amount).toHaveValue("20");
    expect(
      screen.getByText(
        t("admin.invoices.payment.balanceChanged", { balance: "USD 51,92", before: "USD 45,15" }),
      ),
    ).toBeInTheDocument();
  });

  it("keeps the dialog open with the database's message when it refuses", async () => {
    server.submitRecordPayment.mockRejectedValue(
      Object.assign(new Error("Factuur INV-2026-0013 is geannuleerd en kan niet worden betaald"), {
        code: "55000",
      }),
    );
    const onOpenChange = vi.fn();
    wrap(
      <PaymentDialog userId="u1" invoice={target} mode="amount" open onOpenChange={onOpenChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("admin.invoices.payment.submit") }));
    expect(
      await screen.findByText(/is geannuleerd en kan niet worden betaald/),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("CancelInvoiceDialog", () => {
  it("cannot cancel while payments are on the invoice", () => {
    wrap(
      <CancelInvoiceDialog
        userId="u1"
        invoice={{ ...target, amountPaid: 10 }}
        mode="cancel"
        orderIds={[]}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByText(t("admin.invoices.cancelInvoice.hasPayments"))).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("admin.invoices.cancelInvoice.confirm") }),
    ).toBeNull();
  });

  it("'Corrigeren' cancels, then opens a new draft that replaces it, with the same orders", async () => {
    server.submitCancelInvoice.mockResolvedValue({
      ok: true,
      invoiceId: INVOICE,
      invoiceNumber: "INV-2026-0013",
      customerId: target.customerId,
    });
    wrap(
      <CancelInvoiceDialog
        userId="u1"
        invoice={target}
        mode="correct"
        orderIds={["o1", "o2"]}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByLabelText(t("admin.invoices.correct.reason"))).toHaveValue(
      t("admin.invoices.correct.defaultReason"),
    );
    fireEvent.click(screen.getByRole("button", { name: t("admin.invoices.correct.confirm") }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/admin/facturen/nieuw",
        search: {
          customer: target.customerId,
          orders: "o1,o2",
          from: "customer",
          replaces: INVOICE,
        },
      }),
    );
    expect(server.submitCancelInvoice).toHaveBeenCalledWith({
      invoiceId: INVOICE,
      reason: t("admin.invoices.correct.defaultReason"),
    });
  });

  it("a reason is required", () => {
    wrap(
      <CancelInvoiceDialog
        userId="u1"
        invoice={target}
        mode="cancel"
        orderIds={[]}
        open
        onOpenChange={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("admin.invoices.cancelInvoice.confirm") }),
    );
    expect(screen.getByText(t("admin.invoices.validation.reasonRequired"))).toBeInTheDocument();
    expect(server.submitCancelInvoice).not.toHaveBeenCalled();
  });
});

describe("LateFeeDialog", () => {
  it("shows the computed fee and new totals before applying", async () => {
    server.submitApplyLateFee.mockResolvedValue({
      ok: true,
      invoiceId: INVOICE,
      totalAmount: 51.92,
    });
    wrap(<LateFeeDialog userId="u1" invoice={target} percent={15} open onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText("USD 6,77").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("USD 51,92")).toHaveLength(2);
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: t("admin.invoices.lateFee.confirm", { fee: "USD 6,77" }),
      }),
    );
    await waitFor(() =>
      expect(server.submitApplyLateFee).toHaveBeenCalledWith({ invoiceId: INVOICE }),
    );
  });
});

describe("ShareInvoiceDialog", () => {
  const model = fromIssuedInvoice(
    {
      id: INVOICE,
      invoice_number: "INV-2026-0013",
      status: "open",
      currency: "USD",
      invoice_date: "2026-10-07",
      due_date: "2026-10-14",
      customer_note: null,
      paid_at: null,
      total_lbs: 0,
      subtotal_freight: 0,
      total_charges: 45.15,
      total_discount: 0,
      total_amount: 45.15,
      vat_rate: null,
      vat_amount: null,
      issuer_snapshot: { company_name: "G&R SOLUTIONS N.V.", bank_accounts: [] },
      bill_to_snapshot: { customer_code: "GR00042", full_name: "Maria Pinas" },
    },
    [],
  );
  const info = {
    id: INVOICE,
    invoiceNumber: "INV-2026-0013",
    status: "open" as const,
    isOverdue: false,
    total: 45.15,
    amountPaid: 0,
    balance: 45.15,
    dueDate: "2026-10-14",
    paidAt: null,
  };

  it("without a login: no portal link, and it says so", async () => {
    server.fetchInvoiceShare.mockResolvedValue({
      ok: true,
      portalUrl: null,
      linkSource: "app_url",
      phone: "8897500",
    });
    wrap(
      <ShareInvoiceDialog userId="u1" invoice={info} model={model} open onOpenChange={() => {}} />,
    );
    const text = await screen.findByLabelText(t("admin.invoices.share.message"));
    expect((text as HTMLTextAreaElement).value).not.toContain("/portal");
    expect(screen.getByText(t("admin.invoices.share.noLogin"))).toBeInTheDocument();
    const link = screen.getByRole("link", { name: t("admin.invoices.share.open") });
    expect(link.getAttribute("href")).toMatch(
      /^https:\/\/wa\.me\/5978897500\?text=Beste%20Maria%2C/,
    );
  });

  it("with a login: the portal link from the server is in the message", async () => {
    server.fetchInvoiceShare.mockResolvedValue({
      ok: true,
      portalUrl: "https://app.example.com/portal/facturen/" + INVOICE,
      linkSource: "app_url",
      phone: null,
    });
    wrap(
      <ShareInvoiceDialog userId="u1" invoice={info} model={model} open onOpenChange={() => {}} />,
    );
    const text = await screen.findByLabelText(t("admin.invoices.share.message"));
    expect((text as HTMLTextAreaElement).value).toContain(
      "https://app.example.com/portal/facturen/" + INVOICE,
    );
    expect(screen.getByText(t("admin.invoices.share.noPhone"))).toBeInTheDocument();
  });
});
