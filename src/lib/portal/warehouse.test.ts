import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  fillAddressTemplate,
  fullAddressText,
  personalAddressLines,
  type WarehouseAddress,
} from "./warehouse";

const person = { fullName: "Maria Pinas", customerCode: "GR42" };

// The column defaults before SPEC §36 (still supported); the street is example data, not G&R's address.
const address: WarehouseAddress = {
  id: "w1",
  label: "Miami",
  service_type: "air",
  recipient_name_template: "{FULL_NAME} {GR_CODE}",
  address_line1: "123 Example Street",
  address_line2_template: "{GR_CODE}",
  city: "Miami",
  state: "FL",
  zip: "33101",
  country: "USA",
  phone: null,
};

describe("fillAddressTemplate()", () => {
  it("fills the column defaults", () => {
    expect(fillAddressTemplate("{FULL_NAME} {GR_CODE}", person)).toBe("Maria Pinas GR42");
    expect(fillAddressTemplate("{GR_CODE}", person)).toBe("GR42");
  });

  it("replaces every occurrence and tidies whitespace", () => {
    expect(fillAddressTemplate("  Suite {GR_CODE} / {GR_CODE}  ", person)).toBe(
      "Suite GR42 / GR42",
    );
    expect(
      fillAddressTemplate("{FULL_NAME}\t{GR_CODE}", {
        fullName: "  Jan  ",
        customerCode: "GR1",
      }),
    ).toBe("Jan GR1");
  });

  it("leaves unknown placeholders visible", () => {
    expect(fillAddressTemplate("{GR_CODE} {UNIT}", person)).toBe("GR42 {UNIT}");
  });
});

// The column defaults since SPEC §36: the customer's own name, nothing on line 2.
const plainAddress: WarehouseAddress = {
  ...address,
  recipient_name_template: "{FULL_NAME}",
  address_line2_template: "",
};

describe("personalAddressLines()", () => {
  it("lists the fields a web shop asks for, personalised", () => {
    expect(personalAddressLines(address, person)).toEqual([
      { field: "recipient", value: "Maria Pinas GR42" },
      { field: "line1", value: "123 Example Street" },
      { field: "line2", value: "GR42" },
      { field: "city", value: "Miami" },
      { field: "state", value: "FL" },
      { field: "zip", value: "33101" },
      { field: "country", value: "USA" },
    ]);
  });

  it("with the default templates: just the name, no empty line 2 (SPEC §36)", () => {
    expect(personalAddressLines(plainAddress, person).slice(0, 2)).toEqual([
      { field: "recipient", value: "Maria Pinas" },
      { field: "line1", value: "123 Example Street" },
    ]);
  });

  it("includes the phone when set", () => {
    expect(personalAddressLines({ ...address, phone: "+1 305 555 0100" }, person).at(-1)).toEqual({
      field: "phone",
      value: "+1 305 555 0100",
    });
  });
});

describe("fullAddressText()", () => {
  it("copies the address in US postal order", () => {
    expect(fullAddressText(address, person)).toBe(
      ["Maria Pinas GR42", "123 Example Street", "GR42", "Miami, FL 33101", "USA"].join("\n"),
    );
  });

  it("copies the default address with just the name", () => {
    expect(fullAddressText(plainAddress, person)).toBe(
      ["Maria Pinas", "123 Example Street", "Miami, FL 33101", "USA"].join("\n"),
    );
  });

  it("skips empty lines", () => {
    expect(fullAddressText({ ...address, address_line2_template: " ", phone: "305" }, person)).toBe(
      ["Maria Pinas GR42", "123 Example Street", "Miami, FL 33101", "USA", "305"].join("\n"),
    );
  });
});
