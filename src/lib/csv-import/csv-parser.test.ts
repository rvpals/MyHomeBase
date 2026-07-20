import { describe, expect, it } from "vitest";
import { autoMapHeaders, mapRow, parseDateToIso, parseNumeric } from "./csv-parser";

// parseCsvLine/parseCsv tests live in src/lib/shared/csv.test.ts — this module
// re-exports them unchanged, so no need to re-test them here.

describe("parseNumeric", () => {
  it("strips dollar signs and commas", () => {
    expect(parseNumeric("$1,234.56")).toBe(1234.56);
  });

  it("parses a plain number", () => {
    expect(parseNumeric("42")).toBe(42);
  });

  it("returns 0 for empty, undefined, or unparseable input", () => {
    expect(parseNumeric("")).toBe(0);
    expect(parseNumeric(undefined)).toBe(0);
    expect(parseNumeric("not a number")).toBe(0);
  });
});

describe("autoMapHeaders", () => {
  it("maps common header spellings to field names", () => {
    expect(autoMapHeaders(["Symbol", "Description", "Price", "Shares"])).toEqual({
      "0": "ticker",
      "1": "name",
      "2": "currentPrice",
      "3": "quantity",
    });
  });

  it("leaves unrecognized headers unmapped", () => {
    expect(autoMapHeaders(["Symbol", "Some Random Column"])).toEqual({ "0": "ticker" });
  });

  it("trims surrounding whitespace but is case-sensitive to the documented aliases", () => {
    // "SYMBOL" and " Symbol " (trimmed) are both explicit aliases; "symbol" (lowercase) is not.
    expect(autoMapHeaders(["SYMBOL", " Symbol ", "symbol"])).toEqual({ "0": "ticker", "1": "ticker" });
  });
});

describe("mapRow", () => {
  it("applies a column mapping to a row", () => {
    expect(mapRow(["AAPL", "150.00"], { "0": "ticker", "1": "currentPrice" })).toEqual({
      ticker: "AAPL",
      currentPrice: "150.00",
    });
  });

  it("ignores mapping entries whose column index is out of range", () => {
    expect(mapRow(["AAPL"], { "5": "ticker" })).toEqual({});
  });

  it("returns an empty record for an empty mapping", () => {
    expect(mapRow(["AAPL", "150.00"], {})).toEqual({});
  });
});

describe("parseDateToIso", () => {
  it("parses a valid date string to ISO YYYY-MM-DD", () => {
    expect(parseDateToIso("2026-03-15")).toBe("2026-03-15");
    expect(parseDateToIso("03/15/2026")).toBe("2026-03-15");
  });

  it("falls back to today for missing or unparseable input", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(parseDateToIso(undefined)).toBe(today);
    expect(parseDateToIso("not a date")).toBe(today);
  });
});
