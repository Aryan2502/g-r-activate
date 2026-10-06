import { describe, expect, it } from "vitest";

import { interpolate, t } from "./index";
import { nl } from "./nl";

function leaves(node: unknown, prefix = ""): [string, unknown][] {
  if (typeof node !== "object" || node === null) return [[prefix, node]];
  return Object.entries(node).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

describe("t()", () => {
  it("resolves nested keys", () => {
    expect(t("toast.orderRegistered")).toBe("Order succesvol aangemeld.");
    expect(t("meta.title")).toBe("G&R Activate | G&R Solutions N.V.");
  });

  it("has the §35.0 toasts verbatim", () => {
    expect(t("toast.invoiceCreated")).toBe("Factuur succesvol aangemaakt.");
    expect(t("toast.invoiceCreateFailed")).toBe(
      "We konden deze factuur niet aanmaken. Controleer de verplichte velden.",
    );
  });

  it("interpolates placeholders", () => {
    expect(t("meta.pageTitle", { page: "Verboden goederen" })).toBe(
      "Verboden goederen | G&R Activate",
    );
    expect(t("footer.copyright", { year: 2026, company: "G&R SOLUTIONS N.V." })).toBe(
      "© 2026 G&R SOLUTIONS N.V.",
    );
  });

  it("type-checks placeholder arguments (verified by tsc)", () => {
    // @ts-expect-error a key with {page} requires vars
    expect(t("meta.pageTitle")).toBe("{page} | G&R Activate");
    // @ts-expect-error a key without placeholders takes no vars
    expect(t("meta.title", { page: "x" })).toBe("G&R Activate | G&R Solutions N.V.");
    // @ts-expect-error unknown keys are rejected
    expect(t("toast.nope")).toBe("toast.nope");
  });

  it("falls back to the key for unknown keys at runtime", () => {
    const loose = t as unknown as (key: string) => string;
    expect(loose("does.not.exist")).toBe("does.not.exist");
    expect(loose("toast")).toBe("toast");
  });

  it("only contains non-empty strings", () => {
    for (const [key, value] of leaves(nl)) {
      expect(typeof value, key).toBe("string");
      expect((value as string).trim().length, key).toBeGreaterThan(0);
    }
  });
});

describe("interpolate()", () => {
  it("replaces every occurrence and keeps unknown placeholders visible", () => {
    expect(interpolate("{a} en {a}, {b}", { a: 1 })).toBe("1 en 1, {b}");
  });

  it("does not read inherited properties", () => {
    expect(interpolate("{toString}", {})).toBe("{toString}");
  });
});
