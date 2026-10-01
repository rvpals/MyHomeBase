import { describe, expect, it } from "vitest";
import {
  BORDER_WIDTH_KEYS,
  DEFAULT_BORDER_WIDTHS,
  MAX_BORDER_WIDTH,
  MIN_BORDER_WIDTH,
  borderWidthsToValue,
  parseBorderWidth,
  resolveBorderWidths,
} from "./border-widths";

describe("BORDER_WIDTH_KEYS", () => {
  it("lists the three axes the admin screen and globals.css agree on", () => {
    expect(BORDER_WIDTH_KEYS.map((axis) => axis.key)).toEqual(["outline", "divider", "line"]);
  });

  it("gives every axis a label, a description and a where", () => {
    BORDER_WIDTH_KEYS.forEach((axis) => {
      expect(axis.label.length).toBeGreaterThan(0);
      expect(axis.description.length).toBeGreaterThan(0);
      expect(axis.where.length).toBeGreaterThan(0);
    });
  });

  it("defaults every axis to the 1px the app used before the setting existed", () => {
    BORDER_WIDTH_KEYS.forEach((axis) => {
      expect(DEFAULT_BORDER_WIDTHS[axis.key]).toBe(1);
    });
  });
});

describe("parseBorderWidth", () => {
  it("passes through every allowed width", () => {
    for (let width = MIN_BORDER_WIDTH; width <= MAX_BORDER_WIDTH; width += 1) {
      expect(parseBorderWidth(width)).toBe(width);
      expect(parseBorderWidth(String(width))).toBe(width);
    }
  });

  it("clamps out-of-range numbers to the bounds", () => {
    expect(parseBorderWidth(0)).toBe(MIN_BORDER_WIDTH);
    expect(parseBorderWidth(-3)).toBe(MIN_BORDER_WIDTH);
    expect(parseBorderWidth(5)).toBe(MAX_BORDER_WIDTH);
    expect(parseBorderWidth(9999)).toBe(MAX_BORDER_WIDTH);
  });

  it("rounds a fractional width, which would otherwise smear at some zoom levels", () => {
    expect(parseBorderWidth(2.4)).toBe(2);
    expect(parseBorderWidth(2.5)).toBe(3);
    expect(parseBorderWidth("1.8")).toBe(2);
  });

  // The failure path that matters: a garbled row must not be able to break the
  // chrome, since that is how a reader reaches the screen that would fix it.
  it("falls back to the minimum for a missing, blank or unparseable value", () => {
    expect(parseBorderWidth(undefined)).toBe(MIN_BORDER_WIDTH);
    expect(parseBorderWidth("")).toBe(MIN_BORDER_WIDTH);
    expect(parseBorderWidth("   ")).toBe(MIN_BORDER_WIDTH);
    expect(parseBorderWidth("thick")).toBe(MIN_BORDER_WIDTH);
    expect(parseBorderWidth(Number.NaN)).toBe(MIN_BORDER_WIDTH);
    expect(parseBorderWidth(Number.POSITIVE_INFINITY)).toBe(MIN_BORDER_WIDTH);
  });
});

describe("resolveBorderWidths", () => {
  it("reads all three axes from a stored value", () => {
    expect(resolveBorderWidths("outline=3,divider=2,line=1")).toEqual({
      outline: 3,
      divider: 2,
      line: 1,
    });
  });

  it("tolerates whitespace and ignores keys it does not know", () => {
    expect(resolveBorderWidths(" outline = 2 , divider=1, line=4 , bogus=9 ")).toEqual({
      outline: 2,
      divider: 1,
      line: 4,
    });
  });

  it("falls back per axis, so a partly garbled value still yields good numbers", () => {
    expect(resolveBorderWidths("outline=3,divider=oops")).toEqual({
      outline: 3,
      divider: 1,
      line: 1,
    });
  });

  it("returns the defaults for a missing or meaningless value", () => {
    expect(resolveBorderWidths(undefined)).toEqual(DEFAULT_BORDER_WIDTHS);
    expect(resolveBorderWidths("")).toEqual(DEFAULT_BORDER_WIDTHS);
    expect(resolveBorderWidths("nonsense")).toEqual(DEFAULT_BORDER_WIDTHS);
  });
});

describe("borderWidthsToValue", () => {
  it("round-trips through resolveBorderWidths", () => {
    const widths = { outline: 4, divider: 2, line: 3 };
    expect(resolveBorderWidths(borderWidthsToValue(widths))).toEqual(widths);
  });

  it("encodes in catalogue order", () => {
    expect(borderWidthsToValue(DEFAULT_BORDER_WIDTHS)).toBe("outline=1,divider=1,line=1");
  });

  it("clamps on the way out, so an out-of-range draft cannot be persisted", () => {
    expect(borderWidthsToValue({ outline: 0, divider: 99, line: 2 })).toBe(
      "outline=1,divider=4,line=2",
    );
  });
});
