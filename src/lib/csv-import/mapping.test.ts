import { describe, expect, it } from "vitest";
import { applyMapping, parseDateWithFormat, sampleRows, splitDelimited } from "./mapping";

describe("applyMapping", () => {
  it("resolves mapped columns to their fields with options", () => {
    const cells = applyMapping(
      ["2026-07-27", "hello", "Work"],
      { "0": "date", "2": "categories" },
      { "2": { delimiter: "," } },
    );
    expect(cells).toEqual([
      { field: "date", rawValue: "2026-07-27", options: {} },
      { field: "categories", rawValue: "Work", options: { delimiter: "," } },
    ]);
  });

  it("allows two columns to target the same field", () => {
    const cells = applyMapping(["a b", "x,y"], { "0": "tags", "1": "tags" }, {});
    expect(cells.map((cell) => cell.field)).toEqual(["tags", "tags"]);
  });

  it("skips columns whose index is out of range for the record", () => {
    const cells = applyMapping(["only"], { "0": "title", "5": "content" });
    expect(cells).toEqual([{ field: "title", rawValue: "only", options: {} }]);
  });
});

describe("splitDelimited", () => {
  it("splits on whitespace when the delimiter is blank", () => {
    expect(splitDelimited("Trinity Park Intervention", " ")).toEqual(["Trinity", "Park", "Intervention"]);
  });

  it("splits on a literal comma and trims", () => {
    expect(splitDelimited("FAMILY, PERSONAL, MY PARENTS", ",")).toEqual([
      "FAMILY",
      "PERSONAL",
      "MY PARENTS",
    ]);
  });

  it("returns the whole cell as one value when no delimiter is given", () => {
    expect(splitDelimited("New York City")).toEqual(["New York City"]);
  });

  it("returns an empty list for a blank cell", () => {
    expect(splitDelimited("   ", ",")).toEqual([]);
  });
});

describe("parseDateWithFormat", () => {
  it("parses the export's M/D/YY format to ISO", () => {
    expect(parseDateWithFormat("4/27/26", "M/D/YY")).toBe("2026-04-27");
  });

  it("parses MM/DD/YYYY", () => {
    expect(parseDateWithFormat("04/07/2026", "MM/DD/YYYY")).toBe("2026-04-07");
  });

  it("passes through an already-ISO date", () => {
    expect(parseDateWithFormat("2026-12-01", "YYYY-MM-DD")).toBe("2026-12-01");
  });

  it("throws when the value doesn't match the format", () => {
    expect(() => parseDateWithFormat("July 27, 2026", "M/D/YY")).toThrow();
  });

  it("throws on an out-of-range month", () => {
    expect(() => parseDateWithFormat("13/1/26", "M/D/YY")).toThrow();
  });
});

describe("sampleRows", () => {
  const rows = [["a"], ["b"], ["c"], ["d"], ["e"]];

  it("returns all rows (copied) when there are count or fewer", () => {
    const result = sampleRows(rows, 10);
    expect(result).toEqual(rows);
    expect(result).not.toBe(rows);
  });

  it("returns exactly count rows in original order", () => {
    // A deterministic RNG so the assertion is stable.
    const sequence = [0.1, 0.9, 0.5];
    let index = 0;
    const random = () => sequence[index++ % sequence.length];
    const result = sampleRows(rows, 3, random);
    expect(result).toHaveLength(3);
    // Order preserved: each selected row appears in the same relative order as input.
    const positions = result.map((row) => rows.indexOf(row));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
