import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InvoicePrintView } from "@/components/invoice/InvoicePrintView";
import { fromIssuedInvoice } from "@/lib/invoice/model";

const model = fromIssuedInvoice(
  {
    id: "i1",
    invoice_number: "INV-2026-0013",
    status: "open",
    currency: "USD",
    invoice_date: "2026-10-07",
    due_date: "2026-10-14",
    customer_note: null,
    paid_at: null,
    total_lbs: 3.5,
    subtotal_freight: 15.75,
    total_charges: 15.75,
    total_discount: 0,
    total_amount: 15.75,
    vat_rate: null,
    vat_amount: null,
    issuer_snapshot: {
      company_name: "G&R SOLUTIONS N.V.",
      invoice_title: "INVOICE (inclusief BTW)",
      paper_size: "A4",
    },
    bill_to_snapshot: { customer_code: "GR00042", full_name: "Maria Pinas" },
  },
  [],
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("InvoicePrintView (SPEC §35.11 'PDF')", () => {
  it("names the PDF '{number} - G&R Solutions' and opens the print dialog once, after the assets", async () => {
    const order: string[] = [];
    const dismiss = vi.spyOn(toast, "dismiss").mockImplementation(() => {
      order.push("dismiss");
      return "";
    });
    const print = vi.spyOn(window, "print").mockImplementation(() => {
      order.push("print");
    });
    render(
      <StrictMode>
        <InvoicePrintView model={model} back={<a href="/back">Terug</a>} />
      </StrictMode>,
    );
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(document.title).toBe("INV-2026-0013 - G&R Solutions");
    // A toast still on screen (e.g. "Gekopieerd") is gone before the dialog opens.
    expect(dismiss).toHaveBeenCalled();
    expect(order).toEqual(["dismiss", "print"]);
    // Only the document (and a screen-only toolbar): the paper at the snapshot's size.
    expect(document.querySelector('.gr-inv-sheet[data-paper="A4"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "Terug" }).closest(".print\\:hidden")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(print).toHaveBeenCalledTimes(1);
  });
});
