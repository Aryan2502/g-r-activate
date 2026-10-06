import { describe, expect, it } from "vitest";

import { formatPhone, phoneDigits, telHref } from "./phone";

describe("phoneDigits", () => {
  it("keeps international numbers", () => {
    expect(phoneDigits("5978897500")).toBe("5978897500");
    expect(phoneDigits("+597 889-7500")).toBe("5978897500");
    expect(phoneDigits("00597 889 7500")).toBe("5978897500");
    expect(phoneDigits("+1 (305) 555-0100")).toBe("13055550100");
  });

  it("adds 597 to local Surinamese numbers", () => {
    expect(phoneDigits("889-7500")).toBe("5978897500");
    expect(phoneDigits("412345")).toBe("597412345");
    expect(phoneDigits(" 597 412 345 ")).toBe("597412345");
  });

  it("never prefixes 597 to input that is already international", () => {
    expect(phoneDigits("+597 123")).toBeNull();
    expect(phoneDigits("+597 1234")).toBeNull();
    expect(phoneDigits("+597 889")).toBeNull();
    expect(phoneDigits("+597 88975")).toBeNull();
    expect(phoneDigits("00597 1234")).toBeNull();
    expect(phoneDigits("+597 412345")).toBe("597412345");
    expect(phoneDigits("+1 2345 6")).toBeNull();
  });

  it("requires 6–7 local digits after 597", () => {
    expect(phoneDigits("59788975001")).toBeNull();
    expect(phoneDigits("59788975")).toBeNull();
  });

  it("returns null for unusable input", () => {
    expect(phoneDigits(null)).toBeNull();
    expect(phoneDigits("")).toBeNull();
    expect(phoneDigits("12345")).toBeNull();
    expect(phoneDigits("1234567890123456")).toBeNull();
  });
});

describe("telHref / formatPhone", () => {
  it("builds tel: links", () => {
    expect(telHref("5978897500")).toBe("tel:+5978897500");
    expect(telHref(undefined)).toBeNull();
  });

  it("formats Surinamese numbers for display", () => {
    expect(formatPhone("5978897500")).toBe("+597 889 7500");
    expect(formatPhone("412345")).toBe("+597 412 345");
    expect(formatPhone(" +1 305 555 0100 ")).toBe("+1 305 555 0100");
  });
});
