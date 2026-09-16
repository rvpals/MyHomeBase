import { describe, expect, it } from "vitest";
import { formatForPuck, formatResult, puckTextSize } from "./format";

describe("formatResult", () => {
  it("shows whole numbers plainly", () => {
    expect(formatResult(42)).toBe("42");
    expect(formatResult(-7)).toBe("-7");
    expect(formatResult(0)).toBe("0");
  });

  it("normalises negative zero", () => {
    // `-0` is equal to 0, and a signed zero on a display looks like a bug.
    expect(formatResult(-0)).toBe("0");
  });

  it("rounds away float representation noise", () => {
    // The case that makes this function necessary: 0.1 + 0.2 is exactly
    // 0.30000000000000004, and showing that is honest and useless.
    expect(formatResult(0.1 + 0.2)).toBe("0.3");
    expect(formatResult(1 / 3)).toBe("0.333333333333");
  });

  it("trims the trailing zeros toPrecision leaves", () => {
    expect(formatResult(0.5)).toBe("0.5");
    expect(formatResult(2.5)).toBe("2.5");
  });

  it("switches to exponent form for very large values", () => {
    expect(formatResult(1e13)).toBe("1e+13");
    expect(formatResult(1.5e20)).toBe("1.5e+20");
  });

  it("switches to exponent form for very small values", () => {
    expect(formatResult(1e-9)).toBe("1e-9");
  });

  it("keeps mid-range values in fixed notation", () => {
    expect(formatResult(123456789)).toBe("123456789");
    expect(formatResult(0.001)).toBe("0.001");
  });

  it("renders a non-finite value as a dash rather than as Infinity", () => {
    // The evaluator turns these into errors, so they only arrive from a corrupted
    // history row — which must not render "Infinity" as though it were an answer.
    expect(formatResult(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatResult(Number.NaN)).toBe("—");
  });
});

describe("formatForPuck", () => {
  it("returns undefined before the first result, so the view can draw its glyph", () => {
    expect(formatForPuck(undefined)).toBeUndefined();
  });

  it("shows a short value in full", () => {
    expect(formatForPuck(42)).toBe("42");
    expect(formatForPuck(0)).toBe("0");
    expect(formatForPuck(-7)).toBe("-7");
    expect(formatForPuck(3.5)).toBe("3.5");
  });

  it("abbreviates a long fraction by rounding it, not by truncating the number", () => {
    // 3.1416 is recognisably pi; a truncated "3…" says almost nothing. The decimals
    // are chosen from the room the integer part leaves, which is why this isn't a
    // fixed significant-digit count -- toPrecision(6) gives "3.14159", 7 characters,
    // overflowing the very budget it was meant to respect.
    expect(formatForPuck(3.14159265358979)).toBe("3.1416");
  });

  it("gives a larger integer part fewer decimals", () => {
    expect(formatForPuck(1234.5678)).toBe("1234.6");
    expect(formatForPuck(12345.678)).toBe("12346");
  });

  it("uses exponent form for a large value", () => {
    // 123456789 in a 56px circle is a smear; 1.2e8 says "about a hundred million".
    expect(formatForPuck(123456789)).toBe("1.2e8");
  });

  it("uses exponent form for a tiny value, keeping the sign of the exponent", () => {
    expect(formatForPuck(0.000012345)).toBe("1.2e-5");
  });

  it("keeps every result within the puck's budget", () => {
    // The property that matters: whatever the value, it fits. A puck that overflows its
    // circle is the failure this function exists to prevent, and it is invisible to a
    // unit test of any single case.
    const values = [
      0, 1, -1, 42, -42, 3.14159265358979, 123456789, -123456789, 1e21, -1e21, 1e-21,
      0.000012345, 999999, 1000000, 1 / 3, 2 / 3, Math.PI * 1e15, 170,
    ];
    for (const value of values) {
      const text = formatForPuck(value) ?? "";
      expect(text.length, `"${text}" for ${value}`).toBeLessThanOrEqual(7);
    }
  });

  it("renders a non-finite value as a dash", () => {
    expect(formatForPuck(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("puckTextSize", () => {
  it("shrinks the font as the text grows", () => {
    expect(puckTextSize("42")).toBe("text-lg");
    expect(puckTextSize("3.14")).toBe("text-sm");
    expect(puckTextSize("1.2e-5")).toBe("text-xs");
    expect(puckTextSize("12345678")).toBe("text-[0.625rem]");
  });
});
