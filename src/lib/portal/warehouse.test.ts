import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  fillAddressTemplate,
  fullAddressText,
  personalAddressLines,
  type WarehouseAddress,
} from "./warehouse";

const person = { fullName: "Maria Pinas", customerCode: "GR00042" };

// Column defaults of warehouse_addresses; the street is example data, not G&R's address.
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
    expect(fillAddressTemplate("{FULL_NAME} {GR_CODE}", person)).toBe("Maria Pinas GR00042");
    expect(fillAddressTemplate("{GR_CODE}", person)).toBe("GR00042");
  });

  it("replaces every occurrence and tidies whitespace", () => {
    expect(fillAddressTemplate("  Suite {GR_CODE} / {GR_CODE}  ", person)).toBe(
      "Suite GR00042 / GR00042",
    );
    expect(
      fillAddressTemplate("{FULL_NAME}\t{GR_CODE}", {
        fullName: "  Jan  ",
        customerCode: "GR00001",
      }),
    ).toBe("Jan GR00001");
  });

  it("leaves unknown placeholders visible", () => {
    expect(fillAddressTemplate("{GR_CODE} {UNIT}", person)).toBe("GR00042 {UNIT}");
  });
});

describe("personalAddressLines()", () => {
  it("lists the fields a web shop asks for, personalised", () => {
    expect(personalAddressLines(address, person)).toEqual([
      { field: "recipient", value: "Maria Pinas GR00042" },
      { field: "line1", value: "123 Example Street" },
      { field: "line2", value: "GR00042" },
      { field: "city", value: "Miami" },
      { field: "state", value: "FL" },
      { field: "zip", value: "33101" },
      { field: "country", value: "USA" },
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
      ["Maria Pinas GR00042", "123 Example Street", "GR00042", "Miami, FL 33101", "USA"].join("\n"),
    );
  });

  it("skips empty lines", () => {
    expect(fullAddressText({ ...address, address_line2_template: " ", phone: "305" }, person)).toBe(
      ["Maria Pinas GR00042", "123 Example Street", "Miami, FL 33101", "USA", "305"].join("\n"),
    );
  });
});
