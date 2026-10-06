import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatDateTime,
  formatLbs,
  formatMoney,
  formatNumber,
  roundHalfUp,
  todayInSuriname,
} from "./format";

describe("roundHalfUp", () => {
  it("rounds .5 away from zero without binary drift", () => {
    expect(roundHalfUp(1.005)).toBe(1.01);
    expect(roundHalfUp(1.004)).toBe(1);
    expect(roundHalfUp(2.675)).toBe(2.68);
    expect(roundHalfUp(-1.005)).toBe(-1.01);
    expect(roundHalfUp(0.125, 2)).toBe(0.13);
    expect(roundHalfUp(12.345, 1)).toBe(12.3);
    expect(roundHalfUp(12.35, 1)).toBe(12.4);
  });

  it("accepts numeric strings (Postgres numeric) and tiny exponents", () => {
    expect(roundHalfUp("10.555")).toBe(10.56);
    expect(roundHalfUp(1e-7)).toBe(0);
    expect(Object.is(roundHalfUp(-0.001), -0)).toBe(false);
  });

  it("rejects non-numbers", () => {
    expect(() => roundHalfUp("abc")).toThrow(RangeError);
    expect(() => roundHalfUp(Number.NaN)).toThrow(RangeError);
  });
});

describe("formatNumber", () => {
  it("uses Dutch separators", () => {
    expect(formatNumber(1234567.891)).toBe("1.234.567,89");
    expect(formatNumber(0)).toBe("0,00");
    expect(formatNumber(999.999)).toBe("1.000,00");
    expect(formatNumber(-1234.5)).toBe("-1.234,50");
    expect(formatNumber(1234, 0)).toBe("1.234");
  });
});

describe("formatMoney", () => {
  it("prints currency code, thousands dots and decimal comma", () => {
    expect(formatMoney(1234.56, "USD")).toBe("USD 1.234,56");
    expect(formatMoney("245", "SRD")).toBe("SRD 245,00");
    expect(formatMoney(0.005, "EUR")).toBe("EUR 0,01");
    expect(formatMoney(1000000, "USD")).toBe("USD 1.000.000,00");
  });

  it("prints negatives (discounts) with an en dash", () => {
    expect(formatMoney(-10, "USD")).toBe("– USD 10,00");
    expect(formatMoney(-0.001, "USD")).toBe("USD 0,00");
  });
});

describe("formatLbs", () => {
  it("prints two decimals and the unit", () => {
    expect(formatLbs(12.5)).toBe("12,50 lbs");
    expect(formatLbs("3")).toBe("3,00 lbs");
    expect(formatLbs(1234.567)).toBe("1.234,57 lbs");
  });
});

describe("formatDate", () => {
  it("prints a Postgres date as-is in dd-mm-jjjj", () => {
    expect(formatDate("2026-01-07")).toBe("07-01-2026");
    expect(formatDate("2026-12-31")).toBe("31-12-2026");
  });

  it("converts instants to the Suriname calendar day (UTC−3)", () => {
    expect(formatDate("2026-03-01T02:30:00Z")).toBe("28-02-2026");
    expect(formatDate("2026-03-01T03:00:00Z")).toBe("01-03-2026");
    expect(formatDate(new Date("2026-10-06T12:00:00Z"))).toBe("06-10-2026");
  });

  it("throws on invalid input", () => {
    expect(() => formatDate("not a date")).toThrow(RangeError);
  });
});

describe("formatDateTime", () => {
  it("prints Suriname local time in 24h", () => {
    expect(formatDateTime("2026-10-06T12:05:00Z")).toBe("06-10-2026 09:05");
    expect(formatDateTime("2026-10-07T02:59:00Z")).toBe("06-10-2026 23:59");
    expect(formatDateTime("2026-10-07T03:00:00Z")).toBe("07-10-2026 00:00");
  });
});

describe("todayInSuriname", () => {
  it("returns YYYY-MM-DD in America/Paramaribo", () => {
    expect(todayInSuriname(new Date("2026-01-01T02:59:59Z"))).toBe("2025-12-31");
    expect(todayInSuriname(new Date("2026-01-01T03:00:00Z"))).toBe("2026-01-01");
    expect(todayInSuriname(new Date("2026-06-15T23:00:00Z"))).toBe("2026-06-15");
  });

  it("defaults to now", () => {
    expect(todayInSuriname()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
