import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  addressServices,
  fillAddressTemplate,
  fullAddressText,
  personalAddressLines,
  type WarehouseAddress,
} from "./warehouse";

const person = { fullName: "Maria Pinas", customerCode: "GR42" };

// The column defaults before SPEC §36; the street is example data, not G&R's address.
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

  it("writes Air or Ocean for {SERVICE} (SPEC §36)", () => {
    const template = "{GR_CODE} {SERVICE} {FULL_NAME}";
    expect(fillAddressTemplate(template, person, "air")).toBe("GR42 Air Maria Pinas");
    expect(fillAddressTemplate(template, person, "sea")).toBe("GR42 Ocean Maria Pinas");
    expect(fillAddressTemplate(template, person)).toBe("GR42 Maria Pinas");
  });
});

// The column defaults since SPEC §36: "GR67 Air Naam", nothing on line 2.
const serviceAddress: WarehouseAddress = {
  ...address,
  recipient_name_template: "{GR_CODE} {SERVICE} {FULL_NAME}",
  address_line2_template: "",
};

describe("addressServices()", () => {
  it("gives one address a name line for every enabled service, its own first", () => {
    expect(addressServices(serviceAddress, ["air", "sea"], [serviceAddress])).toEqual([
      "air",
      "sea",
    ]);
    expect(addressServices({ ...serviceAddress, service_type: "sea" }, ["air", "sea"], [])).toEqual(
      ["sea", "air"],
    );
    expect(addressServices(serviceAddress, ["air"], [serviceAddress])).toEqual(["air"]);
  });

  it("leaves a service with its own active address to that address", () => {
    const sea = { ...serviceAddress, id: "w2", service_type: "sea" as const };
    expect(addressServices(serviceAddress, ["air", "sea"], [serviceAddress, sea])).toEqual(["air"]);
    expect(addressServices(sea, ["air", "sea"], [serviceAddress, sea])).toEqual(["sea"]);
  });

  it("gives a template without {SERVICE} one name line", () => {
    expect(addressServices(address, ["air", "sea"], [address])).toEqual(["air"]);
  });
});

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

  it("shows a name line per service and no empty line 2 (SPEC §36)", () => {
    expect(personalAddressLines(serviceAddress, person, ["air", "sea"]).slice(0, 3)).toEqual([
      { field: "recipient", service: "air", value: "GR42 Air Maria Pinas" },
      { field: "recipient", service: "sea", value: "GR42 Ocean Maria Pinas" },
      { field: "line1", value: "123 Example Street" },
    ]);
    expect(
      personalAddressLines(serviceAddress, person).filter((l) => l.field === "recipient"),
    ).toEqual([{ field: "recipient", service: "air", value: "GR42 Air Maria Pinas" }]);
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

  it("copies the name for the chosen service", () => {
    expect(fullAddressText(serviceAddress, person, "sea")).toBe(
      ["GR42 Ocean Maria Pinas", "123 Example Street", "Miami, FL 33101", "USA"].join("\n"),
    );
    expect(fullAddressText(serviceAddress, person).split("\n")[0]).toBe("GR42 Air Maria Pinas");
  });

  it("skips empty lines", () => {
    expect(fullAddressText({ ...address, address_line2_template: " ", phone: "305" }, person)).toBe(
      ["Maria Pinas GR42", "123 Example Street", "Miami, FL 33101", "USA", "305"].join("\n"),
    );
  });
});
