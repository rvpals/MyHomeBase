import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvLine } from "./csv";

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
