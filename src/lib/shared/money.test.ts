import { describe, expect, it } from "vitest";
import { centsToDollars, dollarsToCents, formatCents } from "./money";

describe("dollarsToCents", () => {
  it("converts a decimal dollar string to integer cents", () => {
    expect(dollarsToCents("1234.56")).toBe(123456);
  });

  it("converts a numeric dollar amount to integer cents", () => {
    expect(dollarsToCents(10)).toBe(1000);
  });

  it("rounds to the nearest cent", () => {
    expect(dollarsToCents("10.005")).toBe(1001);
  });

  it("throws on a non-numeric string", () => {
    expect(() => dollarsToCents("not-a-number")).toThrow();
  });

  it("throws on non-finite input", () => {
    expect(() => dollarsToCents(Infinity)).toThrow();
  });
});

describe("centsToDollars", () => {
  it("converts integer cents back to decimal dollars", () => {
    expect(centsToDollars(123456)).toBe(1234.56);
  });
});

describe("formatCents", () => {
  it("formats integer cents as a USD currency string", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
  });

  it("formats zero", () => {
    expect(formatCents(0)).toBe("$0.00");
  });
});
