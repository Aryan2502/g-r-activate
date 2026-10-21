// "Label toevoegen" (SPEC §36.8): every label in use is offered to pick with
// one click, the text box searches them, and typing a label in use (in any
// case) adds that label with its own text and colour instead of a near-copy.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { order_id: string; label: string; color: string };

/** A fake of the supabase-js calls the labels make: one page of labels, upserts recorded. */
const db = vi.hoisted(() => {
  const state = { labels: [] as unknown[], upserts: [] as Row[][] };
  const read = {
    select: () => read,
    order: () => read,
    range: () => Promise.resolve({ data: state.labels, error: null }),
  };
  const supabase = {
    from: () => ({
      ...read,
      upsert: (rows: Row[]) => {
        state.upserts.push(rows);
        const added = rows.map((r, i) => ({ id: `new-${i}`, created_at: "2026-10-21", ...r }));
        return { select: () => Promise.resolve({ data: added, error: null }) };
      },
    }),
  };
  return { state, supabase };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: db.supabase }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { toast } from "sonner";

import { t } from "@/lib/i18n";

import { AddLabelDialog } from "./OrderLabels";

const labelRow = (n: number, label: string, color: string) => ({
  id: `l${n}`,
  order_id: `o${n}`,
  label,
  color,
  created_at: `2026-10-${String(n).padStart(2, "0")}T10:00:00Z`,
});
// Air three times (latest as "Air" in blue), Ocean twice, then Spoed and
// fifteen more: 18 labels, more than the 16 the dialog used to show.
const LABELS = [
  labelRow(1, "air", "teal"),
  labelRow(2, "Air", "blue"),
  labelRow(3, "Air", "blue"),
  labelRow(4, "Ocean", "teal"),
  labelRow(5, "Ocean", "teal"),
  labelRow(6, "Spoed", "red"),
  ...Array.from({ length: 15 }, (_, i) => labelRow(7 + i, `Extra ${i + 1}`, "grey")),
];

async function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AddLabelDialog userId="u1" orderIds={["order-1"]} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  const dialog = screen.getByRole("dialog");
  const list = await within(dialog).findByRole("list", { name: t("admin.labels.form.inUse") });
  const input = within(dialog).getByLabelText(t("admin.labels.form.text"));
  return { dialog, list, input };
}

const chips = (list: HTMLElement) =>
  within(list)
    .getAllByRole("button")
    .map((b) => b.textContent);

describe("AddLabelDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.state.labels = LABELS;
    db.state.upserts = [];
  });

  it("offers every label in use, most used first, and adds one with a click", async () => {
    const { list } = await renderDialog();
    expect(chips(list)).toHaveLength(18);
    expect(chips(list).slice(0, 2)).toEqual(["Air", "Ocean"]);

    fireEvent.click(within(list).getByRole("button", { name: "Ocean" }));
    await waitFor(() =>
      expect(db.state.upserts).toEqual([[{ order_id: "order-1", label: "Ocean", color: "teal" }]]),
    );
    expect(toast.success).toHaveBeenCalledWith(t("admin.labels.form.addedOne", { label: "Ocean" }));
  });

  it("filters the labels while typing (ignoring case and accents); no match makes a new label", async () => {
    const { dialog, list, input } = await renderDialog();
    fireEvent.change(input, { target: { value: "OCÉ" } });
    expect(chips(list)).toEqual(["Ocean"]);
    fireEvent.change(input, { target: { value: "extra 1" } });
    expect(chips(list)).toEqual([1, 10, 11, 12, 13, 14, 15].map((n) => `Extra ${n}`));

    fireEvent.change(input, { target: { value: " Zee " } });
    expect(within(dialog).queryByRole("list", { name: t("admin.labels.form.inUse") })).toBeNull();
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      t("admin.labels.form.newLabel", { label: "Zee" }),
    );
    fireEvent.click(within(dialog).getByRole("radio", { name: t("admin.labels.colors.green") }));
    fireEvent.click(within(dialog).getByRole("button", { name: t("admin.labels.form.submit") }));
    await waitFor(() =>
      expect(db.state.upserts).toEqual([[{ order_id: "order-1", label: "Zee", color: "green" }]]),
    );
  });

  it("typing a label in use in another case adds that label with its own text and colour", async () => {
    const { dialog, input } = await renderDialog();
    fireEvent.click(within(dialog).getByRole("radio", { name: t("admin.labels.colors.red") }));
    fireEvent.change(input, { target: { value: " air " } });

    const blue = within(dialog).getByRole("radio", { name: t("admin.labels.colors.blue") });
    expect(blue).toHaveAttribute("aria-checked", "true");
    expect(blue).toBeDisabled();
    expect(within(dialog).getByText(t("admin.labels.form.existing"))).toBeInTheDocument();
    expect(within(dialog).getByText(t("admin.labels.form.existingColor"))).toBeInTheDocument();

    // Enter in the text box submits the form.
    fireEvent.submit(input.closest("form")!);
    await waitFor(() =>
      expect(db.state.upserts).toEqual([[{ order_id: "order-1", label: "Air", color: "blue" }]]),
    );
    expect(toast.success).toHaveBeenCalledWith(t("admin.labels.form.addedOne", { label: "Air" }));
  });

  it("a new label keeps the colour picked", async () => {
    const { dialog, input } = await renderDialog();
    fireEvent.change(input, { target: { value: "Airport" } });
    const red = within(dialog).getByRole("radio", { name: t("admin.labels.colors.red") });
    expect(red).toBeEnabled();
    fireEvent.click(red);
    expect(red).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).queryByText(t("admin.labels.form.existing"))).toBeNull();
    fireEvent.submit(input.closest("form")!);
    await waitFor(() =>
      expect(db.state.upserts).toEqual([[{ order_id: "order-1", label: "Airport", color: "red" }]]),
    );
  });
});
