import { describe, expect, it } from "vitest";

import { errorMessage, toAppError } from "./errors";
import { t } from "./i18n";

describe("toAppError()", () => {
  it("shows the Dutch messages the migrations raise, classified by SQLSTATE", () => {
    expect(toAppError({ code: "42501", message: "Geen toegang" })).toEqual({
      kind: "forbidden",
      message: "Geen toegang",
      code: "42501",
      hint: null,
    });
    expect(
      toAppError({ code: "23505", message: "GR00017 is al toegewezen aan Jan" }),
    ).toMatchObject({
      kind: "conflict",
      message: "GR00017 is al toegewezen aan Jan",
    });
    expect(toAppError({ code: "22023", message: "Telefoonnummer is verplicht" }).kind).toBe(
      "invalid",
    );
    expect(toAppError({ code: "P0002", message: "Klant niet gevonden" }).kind).toBe("not_found");
    expect(toAppError({ code: "55000", message: "Deze uitnodiging is al gebruikt" }).kind).toBe(
      "state",
    );
  });

  it("keeps the hints the UI can act on", () => {
    const limit = toAppError({
      code: "54000",
      hint: "open_order_limit",
      message: "U heeft al 50 aangemelde orders die G&R nog niet heeft ontvangen.",
    });
    expect(limit).toMatchObject({ kind: "limit", hint: "open_order_limit" });
    expect(limit.message).toContain("50 aangemelde orders");

    expect(
      toAppError({
        code: "55000",
        hint: "invoice_dates",
        message: "De vervaldatum is al verstreken",
      }),
    ).toMatchObject({ kind: "state", hint: "invoice_dates" });
    expect(
      toAppError({ code: "55000", hint: "pay_before_pickup", message: "Nog niet betaald: x" }).hint,
    ).toBe("pay_before_pickup");
    expect(toAppError({ code: "55000", hint: "something_else", message: "Fout" }).hint).toBeNull();
  });

  it("replaces English messages Postgres raises by itself", () => {
    expect(
      errorMessage({
        code: "42501",
        message: 'new row violates row-level security policy for table "orders"',
      }),
    ).toBe(t("apiError.forbidden"));
    expect(errorMessage({ code: "42501", message: "permission denied for table customers" })).toBe(
      t("apiError.forbidden"),
    );
    expect(
      errorMessage({
        code: "23505",
        message: 'duplicate key value violates unique constraint "customers_email_lower_key"',
      }),
    ).toBe(t("apiError.duplicate"));
    expect(
      errorMessage({ code: "23503", message: "insert or update on table violates foreign key" }),
    ).toBe(t("apiError.inUse"));
    expect(errorMessage({ code: "23514", message: 'violates check constraint "x"' })).toBe(
      t("apiError.invalidValue"),
    );
    expect(errorMessage({ code: "23502", message: "null value in column" })).toBe(
      t("apiError.required"),
    );
    expect(errorMessage({ code: "22001", message: "value too long" })).toBe(t("apiError.tooLong"));
    expect(errorMessage({ code: "40001", message: "could not serialize access" })).toBe(
      t("apiError.concurrent"),
    );
  });

  it("maps PostgREST codes", () => {
    expect(toAppError({ code: "PGRST116", message: "JSON object requested" }).kind).toBe(
      "not_found",
    );
    expect(toAppError({ code: "PGRST303", message: "JWT expired" })).toMatchObject({
      kind: "session",
      message: t("apiError.sessionExpired"),
    });
  });

  it("recognises network failures", () => {
    expect(toAppError({ message: "TypeError: Failed to fetch", code: "" }).kind).toBe("network");
    expect(
      toAppError(new TypeError("NetworkError when attempting to fetch resource.")).message,
    ).toBe(t("toast.networkError"));
    expect(toAppError("Load failed").kind).toBe("network");
  });

  it("treats a server function 403 as forbidden", () => {
    expect(toAppError({ status: 403, message: "Geen toegang" })).toMatchObject({
      kind: "forbidden",
      code: "42501",
    });
  });

  it("falls back to a generic Dutch message", () => {
    expect(errorMessage(new Error("boom"))).toBe(t("toast.genericError"));
    expect(errorMessage(undefined)).toBe(t("toast.genericError"));
    expect(errorMessage({ code: "XX000", message: "internal" })).toBe(t("toast.genericError"));
  });
});
