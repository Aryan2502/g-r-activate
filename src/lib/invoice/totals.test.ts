import { describe, expect, it } from "vitest";

import {
  computeInvoiceTotals,
  freightAmount,
  lateFeeAmount,
  lineAmount,
  sumAmounts,
  toScaled,
  type TotalsLine,
} from "./totals";

const freight = (weightLbs: number | string, ratePerLb: number | string): TotalsLine => ({
  lineType: "freight",
  weightLbs,
  ratePerLb,
  amount: 999, // ignored: the database recomputes freight amounts
  vatExempt: false,
});

describe("freightAmount", () => {
  it("rounds weight × rate half-up to cents without binary drift", () => {
    expect(freightAmount(12.5, 4.5)).toBe(56.25);
    expect(freightAmount(2.15, 3.5)).toBe(7.53); // 7.525 exactly
    expect(freightAmount("1.01", "0.05")).toBe(0.05); // 0.0505
    expect(freightAmount(0.01, 0.49)).toBe(0); // 0.0049
    expect(freightAmount(0.01, 0.5)).toBe(0.01); // 0.005 → half-up
    expect(freightAmount(99999999.99, 0)).toBe(0);
  });

  it("is exact for large values (BigInt products)", () => {
    expect(freightAmount("9999.99", "99999.99")).toBe(999998900); // 999.998.900,0001
    expect(freightAmount("99999999.99", "0.01")).toBe(1000000); // 999.999,9999
  });
});

describe("computeInvoiceTotals", () => {
  it("adds up a freight-only invoice like the template", () => {
    const t = computeInvoiceTotals([freight(12.5, 4.5), freight(3.4, 4.5)], null);
    expect(t).toEqual({
      totalLbs: 15.9,
      subtotalFreight: 71.55,
      totalCharges: 71.55,
      totalDiscount: 0,
      totalAmount: 71.55,
      vatAmount: null,
      vatRate: null,
      negative: false,
    });
  });

  it("splits charges and discounts; total_lbs counts freight only", () => {
    const t = computeInvoiceTotals(
      [
        freight(2, 4.5),
        { lineType: "customs", amount: 25, vatExempt: true },
        { lineType: "handling", amount: "5.10", vatExempt: false },
        { lineType: "discount", amount: -3.1, vatExempt: false },
        { lineType: "late_fee", amount: 1.35, vatExempt: true },
      ],
      null,
    );
    expect(t.totalLbs).toBe(2);
    expect(t.subtotalFreight).toBe(9);
    expect(t.totalCharges).toBe(40.45);
    expect(t.totalDiscount).toBe(3.1);
    expect(t.totalAmount).toBe(37.35);
    expect(t.negative).toBe(false);
  });

  it("computes BTW inclusive (never on top) over non-exempt lines only", () => {
    // 10% of an inclusive 110,00 is 10,00; customs (exempt) does not count.
    const t = computeInvoiceTotals(
      [
        { lineType: "service_fee", amount: 110, vatExempt: false },
        { lineType: "customs", amount: 50, vatExempt: true },
      ],
      10,
    );
    expect(t.totalAmount).toBe(160);
    expect(t.vatAmount).toBe(10);
    expect(t.vatRate).toBe(10);
  });

  it("rounds BTW half-up and never below zero", () => {
    // 1,05 × 10 / 110 = 0,0954… → 0,10
    expect(
      computeInvoiceTotals([{ lineType: "goods", amount: 1.05, vatExempt: false }], 10).vatAmount,
    ).toBe(0.1);
    // 0,21 × 5 / 105 = 0,01 exactly
    expect(
      computeInvoiceTotals([{ lineType: "goods", amount: 0.21, vatExempt: false }], 5).vatAmount,
    ).toBe(0.01);
    // 0,105 × … half cases: 1,05 × 100/200 = 0,525 → 0,53
    expect(
      computeInvoiceTotals([{ lineType: "goods", amount: 1.05, vatExempt: false }], 100).vatAmount,
    ).toBe(0.53);
    // a non-exempt discount larger than the non-exempt charges: base clamps to 0
    const t = computeInvoiceTotals(
      [
        { lineType: "customs", amount: 100, vatExempt: true },
        { lineType: "discount", amount: -20, vatExempt: false },
      ],
      10,
    );
    expect(t.vatAmount).toBe(0);
    expect(t.totalAmount).toBe(80);
  });

  it("keeps a VAT rate of 0 (amount 0, not null)", () => {
    const t = computeInvoiceTotals([freight(1, 1)], 0);
    expect(t.vatAmount).toBe(0);
    expect(t.vatRate).toBe(0);
  });

  it("flags a discount larger than the charges", () => {
    const t = computeInvoiceTotals(
      [
        { lineType: "handling", amount: 5, vatExempt: false },
        { lineType: "discount", amount: -7.5, vatExempt: false },
      ],
      null,
    );
    expect(t.totalAmount).toBe(-2.5);
    expect(t.negative).toBe(true);
  });

  it("is all zeros for an empty invoice", () => {
    expect(computeInvoiceTotals([], 21)).toEqual({
      totalLbs: 0,
      subtotalFreight: 0,
      totalCharges: 0,
      totalDiscount: 0,
      totalAmount: 0,
      vatAmount: 0,
      vatRate: 21,
      negative: false,
    });
  });
});

describe("helpers", () => {
  it("lineAmount recomputes freight and keeps other amounts", () => {
    expect(lineAmount(freight(3, 2.5))).toBe(7.5);
    expect(lineAmount({ lineType: "other", amount: "12.30", vatExempt: false })).toBe(12.3);
  });

  it("sumAmounts is exact in cents", () => {
    expect(sumAmounts([0.1, 0.2])).toBe(0.3);
    expect(sumAmounts(["10.05", -0.05])).toBe(10);
  });

  it("toScaled parses numeric text and refuses more decimals than the column has", () => {
    expect(toScaled("4.500")).toBe(450n);
    expect(toScaled(1e-7, 7)).toBe(1n);
    expect(toScaled("-3.1")).toBe(-310n);
    expect(toScaled("")).toBeNull();
    expect(() => toScaled("1.234")).toThrow(RangeError);
    expect(() => toScaled("12,5")).toThrow(RangeError);
    expect(() => toScaled(Number.NaN)).toThrow(RangeError);
  });
});

describe("lateFeeAmount() (apply_late_fee: round(balance × % / 100, 2))", () => {
  it("rounds half away from zero in whole cents", () => {
    expect(lateFeeAmount(45.15, 15)).toBe(6.77); // 6,7725
    expect(lateFeeAmount("10.10", "12.5")).toBe(1.26); // 1,2625
    expect(lateFeeAmount(0.1, 15)).toBe(0.02); // 0,015
    expect(lateFeeAmount(100, 0)).toBe(0);
    expect(lateFeeAmount(9_999_999_999.99, 100)).toBe(9_999_999_999.99);
  });
});
