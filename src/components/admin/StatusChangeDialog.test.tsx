// StatusChangeDialog ("Status wijzigen" / "Afgeven aan klant"): after a
// successful change with nothing to follow up (the e-mail went out, or
// "Klant e-mailen" was off) the dialog closes; with customers to follow up
// on WhatsApp it shows that list instead; a failed change keeps it open.
// P10 review: it used to stay open after success, because onSuccess asked to
// close while the mutation still counted as busy.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Radix Switch measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const server = vi.hoisted(() => ({
  submitStatusChange: vi.fn(),
  submitPickup: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/server-fns/admin-orders.functions", () => server);
vi.mock("@/lib/server-fns/system.functions", () => ({
  fetchEmailStatus: vi.fn(async () => ({ configured: true })),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { toast } from "sonner";

import type { AdminStatusMap, StatusRow } from "@/lib/admin/statuses";
import { t } from "@/lib/i18n";

import { StatusChangeDialog } from "./StatusChangeDialog";

const row = (code: string, stage: StatusRow["stage"], sort: number, label: string): StatusRow => ({
  active: true,
  code,
  created_at: "2026-10-07T00:00:00Z",
  created_by: null,
  customer_description_nl: null,
  customer_visible: true,
  is_terminal: false,
  label_nl: label,
  notify_customer: true,
  sort_order: sort,
  stage,
  updated_at: "2026-10-07T00:00:00Z",
  updated_by: null,
});
const statuses: AdminStatusMap = new Map([
  ["order_registered", row("order_registered", "registered", 10, "Order aangemeld")],
  [
    "arrived_us_warehouse",
    row("arrived_us_warehouse", "us_warehouse", 20, "Aangekomen in US-magazijn"),
  ],
  ["in_transit", row("in_transit", "in_transit", 30, "Onderweg naar Suriname")],
]);
const ORDER = "9274f83a-21c1-4879-8236-d23611ada787";

function renderDialog(onOpenChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <StatusChangeDialog
        userId="u1"
        orders={[
          {
            id: ORDER,
            reference: "ORD-2026-00001",
            status: "arrived_us_warehouse",
            order_type: "personal",
            customer_id: "c1",
            received_at: "2026-10-07T18:26:22Z",
          },
        ]}
        statuses={statuses}
        settings={{
          pay_before_pickup: true,
          delivery_available: false,
          pickup_address: null,
          pickup_hours: null,
          pickup_instructions: null,
        }}
        initialStatus="in_transit"
        open
        onOpenChange={onOpenChange}
      />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

async function submit() {
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: t("admin.status.submit") }));
  await waitFor(() => expect(server.submitStatusChange).toHaveBeenCalledTimes(1));
}

/** Lets onSuccess (invalidate + close) and onSettled run. */
const settle = () => new Promise((r) => setTimeout(r, 100));

describe("StatusChangeDialog after saving", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("closes when there is nothing to follow up", async () => {
    server.submitStatusChange.mockResolvedValue({
      ok: true,
      changed: [ORDER],
      unchanged: [],
      emailOutcomes: ["sent"],
      followUps: [],
    });
    const onOpenChange = renderDialog();
    await submit();
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await settle();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the WhatsApp follow-up instead of closing", async () => {
    server.submitStatusChange.mockResolvedValue({
      ok: true,
      changed: [ORDER],
      unchanged: [],
      emailOutcomes: ["skipped"],
      followUps: [
        {
          customerId: "c1",
          reason: "skipped",
          customerName: "Maria Pinas",
          customerCode: "GR00042",
          phone: "+597 8123456",
          references: ["ORD-2026-00001"],
          text: "Goedendag Maria,",
        },
      ],
    });
    const onOpenChange = renderDialog();
    await submit();
    await screen.findByText(t("admin.status.followUp.title"));
    await settle();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("stays open with the error when the change fails", async () => {
    server.submitStatusChange.mockRejectedValue(new Error("boom"));
    const onOpenChange = renderDialog();
    await submit();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await settle();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
