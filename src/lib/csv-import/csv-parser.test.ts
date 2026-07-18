import { describe, expect, it } from "vitest";
import { autoMapHeaders, mapRow, parseCsv, parseCsvLine, parseDateToIso, parseNumeric } from "./csv-parser";

describe("parseCsvLine", () => {
  it("splits a simple comma-separated line", () => {
    expect(parseCsvLine("AAPL,Apple Inc.,150.00")).toEqual(["AAPL", "Apple Inc.", "150.00"]);
  });

  it("handles a quoted field containing a comma", () => {
    expect(parseCsvLine('AAPL,"Apple, Inc.",150.00')).toEqual(["AAPL", "Apple, Inc.", "150.00"]);
  });

  it("handles an escaped double-quote inside a quoted field", () => {
    expect(parseCsvLine('AAPL,"Say ""Hi""",150.00')).toEqual(["AAPL", 'Say "Hi"', "150.00"]);
  });

  it("trims whitespace around unquoted fields", () => {
    expect(parseCsvLine(" AAPL , 150.00 ")).toEqual(["AAPL", "150.00"]);
  });
});

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

describe("parseCsv", () => {
  it("splits headers from data rows", () => {
    const result = parseCsv("Symbol,Price\nAAPL,150.00\nMSFT,300.00");
    expect(result.headers).toEqual(["Symbol", "Price"]);
    expect(result.rows).toEqual([
      ["AAPL", "150.00"],
      ["MSFT", "300.00"],
    ]);
  });

  it("drops blank lines", () => {
    const result = parseCsv("Symbol,Price\n\nAAPL,150.00\n\n");
    expect(result.rows).toEqual([["AAPL", "150.00"]]);
  });

  it("drops rows too short to be real data (fewer than half the header count)", () => {
    const result = parseCsv("A,B,C,D\nok1,ok2,ok3,ok4\ntooshort");
    expect(result.rows).toEqual([["ok1", "ok2", "ok3", "ok4"]]);
  });

  it("returns empty headers/rows for empty input", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
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
