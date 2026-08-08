import { describe, expect, it } from "vitest";
import {
  applyMapping,
  assignFieldToColumn,
  constantValuesByField,
  findDuplicateFieldMappings,
  restrictMappingToColumns,
  parseDateWithFormat,
  parseStoredMapping,
  resolveAccountNameMapping,
  serializeNamedMapping,
  toAccountNameMapping,
  restrictMapping,
  sampleRows,
  selectImportRows,
  splitDelimited,
} from "./mapping";

describe("selectImportRows", () => {
  const rows = [["a"], ["b"], ["c"], ["d"]];

  it("returns every row with both a 0-based index and a 1-based number", () => {
    expect(selectImportRows(rows)).toEqual([
      { row: ["a"], rowIndex: 0, rowNumber: 1 },
      { row: ["b"], rowIndex: 1, rowNumber: 2 },
      { row: ["c"], rowIndex: 2, rowNumber: 3 },
      { row: ["d"], rowIndex: 3, rowNumber: 4 },
    ]);
  });

  it("drops the excluded indexes", () => {
    expect(selectImportRows(rows, [1]).map((entry) => entry.row[0])).toEqual(["a", "c", "d"]);
  });

  /**
   * The whole reason this helper exists. A plain filter would renumber the
   * survivors, so a failure on the file's row 4 would be reported as row 3.
   */
  it("keeps each surviving row's original index and number after an earlier row is dropped", () => {
    expect(selectImportRows(rows, [0, 1])).toEqual([
      { row: ["c"], rowIndex: 2, rowNumber: 3 },
      { row: ["d"], rowIndex: 3, rowNumber: 4 },
    ]);
  });

  it("handles out-of-order and duplicated exclusions", () => {
    expect(selectImportRows(rows, [3, 0, 3]).map((entry) => entry.rowNumber)).toEqual([2, 3]);
  });

  it("ignores an index that isn't in the file", () => {
    expect(selectImportRows(rows, [99])).toHaveLength(4);
  });

  it("returns nothing when every row is excluded", () => {
    expect(selectImportRows(rows, [0, 1, 2, 3])).toEqual([]);
  });

  it("returns nothing for no rows", () => {
    expect(selectImportRows([], [0])).toEqual([]);
  });
});

describe("constantValuesByField", () => {
  const mapping = { "0": "ticker", "1": "type", "2": "quantity" };

  it("collects a column's fixed value under the field it maps to", () => {
    expect(constantValuesByField(mapping, { "1": { constantValue: "ETF" } })).toEqual({ type: "ETF" });
  });

  it("returns nothing when no column has one", () => {
    expect(constantValuesByField(mapping, {})).toEqual({});
    expect(constantValuesByField(mapping, { "1": { dateFormat: "MM/DD/YYYY" } })).toEqual({});
  });

  it("treats a blank or whitespace-only value as no constant, so clearing the box works", () => {
    expect(constantValuesByField(mapping, { "1": { constantValue: "" } })).toEqual({});
    expect(constantValuesByField(mapping, { "1": { constantValue: "   " } })).toEqual({});
  });

  it("trims the value", () => {
    expect(constantValuesByField(mapping, { "1": { constantValue: "  ETF  " } })).toEqual({
      type: "ETF",
    });
  });

  it("ignores options on a column that isn't mapped to anything", () => {
    expect(constantValuesByField(mapping, { "9": { constantValue: "ETF" } })).toEqual({});
  });

  it("collects several fixed values at once", () => {
    expect(
      constantValuesByField(mapping, {
        "1": { constantValue: "ETF" },
        "2": { constantValue: "1" },
      }),
    ).toEqual({ type: "ETF", quantity: "1" });
  });
});

describe("restrictMapping", () => {
  it("keeps only columns targeting an allowed field", () => {
    expect(restrictMapping({ "0": "ticker", "1": "totalValue", "2": "quantity" }, ["ticker", "quantity"])).toEqual({
      "0": "ticker",
      "2": "quantity",
    });
  });

  it("returns an empty mapping when nothing is allowed", () => {
    expect(restrictMapping({ "0": "ticker" }, [])).toEqual({});
  });

  it("leaves an already-valid mapping untouched", () => {
    const mapping = { "0": "ticker", "1": "quantity" };
    expect(restrictMapping(mapping, ["ticker", "quantity", "name"])).toEqual(mapping);
  });
});

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

describe("toAccountNameMapping", () => {
  const accounts = [
    { id: 3, name: "Fidelity Health Savings Account" },
    { id: 7, name: "Chase Joint Stock Account" },
  ];

  it("pairs each chosen id with that account's current name", () => {
    expect(toAccountNameMapping({ "Fidelity HSA": 3, "Chase Joint": 7 }, accounts)).toEqual({
      "Fidelity HSA": { accountId: 3, accountName: "Fidelity Health Savings Account" },
      "Chase Joint": { accountId: 7, accountName: "Chase Joint Stock Account" },
    });
  });

  it("trims the CSV label and drops a choice with no such account", () => {
    expect(toAccountNameMapping({ "  Fidelity HSA  ": 3, Ghost: 99 }, accounts)).toEqual({
      "Fidelity HSA": { accountId: 3, accountName: "Fidelity Health Savings Account" },
    });
  });
});

describe("resolveAccountNameMapping", () => {
  const saved = {
    "Fidelity HSA": { accountId: 3, accountName: "Fidelity Health Savings Account" },
  };

  it("resolves by id when the account still exists", () => {
    const accounts = [{ id: 3, name: "Fidelity Health Savings Account" }];
    expect(resolveAccountNameMapping(saved, accounts)).toEqual({ "Fidelity HSA": 3 });
  });

  it("still resolves by id after the account was renamed", () => {
    const accounts = [{ id: 3, name: "Fidelity HSA (renamed)" }];
    expect(resolveAccountNameMapping(saved, accounts)).toEqual({ "Fidelity HSA": 3 });
  });

  it("falls back to the name after the account was deleted and recreated", () => {
    // Same account, new id — the id is stale but the name still identifies it.
    const accounts = [{ id: 42, name: "fidelity health savings account" }];
    expect(resolveAccountNameMapping(saved, accounts)).toEqual({ "Fidelity HSA": 42 });
  });

  it("drops an entry that resolves neither way rather than guessing", () => {
    expect(resolveAccountNameMapping(saved, [{ id: 9, name: "Something Else" }])).toEqual({});
  });

  it("round-trips through toAccountNameMapping unchanged", () => {
    const accounts = [{ id: 3, name: "Fidelity Health Savings Account" }];
    const chosen = { "Fidelity HSA": 3 };
    expect(resolveAccountNameMapping(toAccountNameMapping(chosen, accounts), accounts)).toEqual(chosen);
  });
});

describe("parseStoredMapping", () => {
  // The stored envelope has widened twice without a migration. Every shape ever
  // written must still load, or someone's saved broker mappings vanish silently.
  it("reads the original columns-only shape", () => {
    const parsed = parseStoredMapping(JSON.stringify({ "0": "ticker", "1": "name" }));
    expect(parsed.columnMapping).toEqual({ "0": "ticker", "1": "name" });
    expect(parsed.fieldOptions).toEqual({});
    expect(parsed.accountNameMapping).toEqual({});
  });

  it("reads the columns+options shape, before account matches existed", () => {
    const parsed = parseStoredMapping(
      JSON.stringify({ columns: { "0": "date" }, options: { "0": { dateFormat: "M/D/YY" } } }),
    );
    expect(parsed.columnMapping).toEqual({ "0": "date" });
    expect(parsed.fieldOptions).toEqual({ "0": { dateFormat: "M/D/YY" } });
    expect(parsed.accountNameMapping).toEqual({});
  });

  it("reads the current shape", () => {
    const accounts = { "Fidelity HSA": { accountId: 3, accountName: "Fidelity HSA Account" } };
    const parsed = parseStoredMapping(
      JSON.stringify({ columns: { "0": "date" }, options: {}, accounts }),
    );
    expect(parsed.accountNameMapping).toEqual(accounts);
  });

  it("round-trips what serializeNamedMapping writes", () => {
    const columns = { "0": "accountName", "1": "totalValue" };
    const options = { "1": { constantValue: "0" } };
    const accounts = { "Fidelity HSA": { accountId: 3, accountName: "Fidelity HSA Account" } };
    expect(parseStoredMapping(serializeNamedMapping(columns, options, accounts))).toEqual({
      columnMapping: columns,
      fieldOptions: options,
      accountNameMapping: accounts,
    });
  });
});

// Regression cover for the Fidelity import that read "Last price change" as the
// share count. A 70-column Chase mapping was applied to a 16-column Fidelity
// export; its out-of-range entries were invisible in the UI but still applied,
// and two columns ended up claiming one field.
describe("restrictMappingToColumns", () => {
  const chaseShaped = { "4": "quantity", "6": "quantity", "20": "unitCost", "70": "isin" };

  it("drops entries pointing past the end of this file", () => {
    expect(restrictMappingToColumns(chaseShaped, 16)).toEqual({ "4": "quantity", "6": "quantity" });
  });

  it("keeps everything when the file is wide enough", () => {
    expect(restrictMappingToColumns(chaseShaped, 71)).toEqual(chaseShaped);
  });

  it("rejects negative and non-integer keys rather than trusting them", () => {
    expect(restrictMappingToColumns({ "-1": "a", "1.5": "b", x: "c", "2": "d" }, 16)).toEqual({
      "2": "d",
    });
  });
});

describe("findDuplicateFieldMappings", () => {
  it("names each field claimed by more than one column, columns in order", () => {
    expect(
      findDuplicateFieldMappings({ "4": "quantity", "6": "quantity", "5": "currentPrice" }),
    ).toEqual([{ field: "quantity", columnIndexes: [4, 6] }]);
  });

  it("finds nothing in a clean mapping", () => {
    expect(findDuplicateFieldMappings({ "4": "quantity", "5": "currentPrice" })).toEqual([]);
  });

  it("catches the exact production mapping that corrupted the import", () => {
    const corrupt = {
      "0": "assetClass", "2": "ticker", "3": "name", "4": "quantity", "5": "currentPrice",
      "6": "quantity", "7": "currentPrice", "8": "dayGainLoss", "13": "cost", "16": "dayGainLoss",
      "19": "cost",
    };
    expect(findDuplicateFieldMappings(corrupt).map((d) => d.field).sort()).toEqual([
      "cost",
      "currentPrice",
      "dayGainLoss",
      "quantity",
    ]);
  });
});

describe("assignFieldToColumn", () => {
  it("releases the field from the column that held it", () => {
    // Choosing Quantity on column 4 must take it away from column 6.
    expect(assignFieldToColumn({ "6": "quantity", "5": "currentPrice" }, 4, "quantity")).toEqual({
      "5": "currentPrice",
      "4": "quantity",
    });
  });

  it("replaces whatever that column pointed at before", () => {
    expect(assignFieldToColumn({ "4": "name" }, 4, "quantity")).toEqual({ "4": "quantity" });
  });

  it("clears the column when given an empty field, touching nothing else", () => {
    expect(assignFieldToColumn({ "4": "quantity", "5": "currentPrice" }, 4, "")).toEqual({
      "5": "currentPrice",
    });
  });

  it("can never produce a duplicate, however it is driven", () => {
    let mapping = {};
    for (const [column, field] of [[4, "quantity"], [6, "quantity"], [5, "quantity"]] as const) {
      mapping = assignFieldToColumn(mapping, column, field);
    }
    expect(mapping).toEqual({ "5": "quantity" });
    expect(findDuplicateFieldMappings(mapping)).toEqual([]);
  });
});
