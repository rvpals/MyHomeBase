import { describe, expect, it } from "vitest";
import {
  MAX_SOURCE_LABEL_COLUMNS,
  SOURCE_FILE_COLUMN,
  buildPooledRows,
  buildSourceColumns,
  groupableSourceColumns,
  planMultiFileImport,
  sourceColumnDefinitions,
  suggestSourceName,
} from "./multi-import";
import type { CsvColumnDefinition } from "./types";

const HEADER = "Timestamp,Temperature_Fahrenheit,Relative_Humidity";
const BATHROOM = `${HEADER}\n2026-09-11 02:08:00,80.42,45.4\n2026-09-11 14:08:00,77.18,58.7`;
const BASEMENT = `${HEADER}\n2026-09-11 02:08:00,64.4,71.2`;

function files() {
  return [
    { fileName: "Master Bathroom_export_202609221408.csv", fileText: BATHROOM },
    { fileName: "Basement_export_202609221408.csv", fileText: BASEMENT },
  ];
}

describe("suggestSourceName", () => {
  it("strips the extension and the export/timestamp suffix", () => {
    expect(suggestSourceName("Master Bathroom_export_202609221408.csv")).toBe("Master Bathroom");
  });

  it("strips a bare trailing timestamp", () => {
    expect(suggestSourceName("Basement_20260922.csv")).toBe("Basement");
  });

  it("keeps a plain name untouched", () => {
    expect(suggestSourceName("Basement.csv")).toBe("Basement");
  });

  it("falls back rather than returning empty", () => {
    expect(suggestSourceName(".csv")).toBe("Unnamed");
    // Nothing but an export marker would strip to "", so the stem is kept instead.
    expect(suggestSourceName("_export_202609221408.csv")).toBe("_export_202609221408");
  });
});

describe("buildSourceColumns", () => {
  const dataColumns: CsvColumnDefinition[] = [
    { name: "timestamp", sourceHeader: "Timestamp", type: "datetime" },
    { name: "relative_humidity", sourceHeader: "Relative_Humidity", type: "real" },
  ];

  it("always leads with the source-file column", () => {
    const columns = buildSourceColumns(dataColumns, []);
    expect(columns).toHaveLength(1);
    expect(columns[0]).toEqual({ name: SOURCE_FILE_COLUMN, kind: "file", label: "Source file" });
  });

  it("slugifies each label and marks it as a label column", () => {
    const columns = buildSourceColumns(dataColumns, ["Room Name"]);
    expect(columns[1]).toEqual({ name: "room_name", kind: "label", label: "Room Name" });
  });

  it("renames a label that would collide with a data column", () => {
    const columns = buildSourceColumns(dataColumns, ["Relative_Humidity"]);
    expect(columns[1].name).toBe("relative_humidity_2");
  });

  it("renames a label that would collide with another label", () => {
    const columns = buildSourceColumns(dataColumns, ["Room", "room"]);
    expect(columns.map((column) => column.name)).toEqual([SOURCE_FILE_COLUMN, "room", "room_2"]);
  });

  it("skips a blank label rather than creating an unnamed column", () => {
    expect(buildSourceColumns(dataColumns, ["  ", "Room"])).toHaveLength(2);
  });

  it("refuses more labels than the cap", () => {
    const tooMany = new Array(MAX_SOURCE_LABEL_COLUMNS + 1).fill("x");
    expect(() => buildSourceColumns(dataColumns, tooMany)).toThrow(/At most/);
  });
});

describe("sourceColumnDefinitions", () => {
  it("maps every source column to a TEXT column carrying its label as the header", () => {
    const defs = sourceColumnDefinitions(buildSourceColumns([], ["Room"]));
    expect(defs).toEqual([
      { name: SOURCE_FILE_COLUMN, sourceHeader: "Source file", type: "text" },
      { name: "room", sourceHeader: "Room", type: "text" },
    ]);
  });
});

describe("planMultiFileImport", () => {
  it("takes the schema from the first file and totals every file's rows", () => {
    const plan = planMultiFileImport(files(), ["Room"]);
    expect(plan.dataColumns.map((column) => column.name)).toEqual([
      "timestamp",
      "temperature_fahrenheit",
      "relative_humidity",
    ]);
    expect(plan.totalRows).toBe(3);
    expect(plan.headerMismatches).toEqual([]);
  });

  it("suggests a source name per file", () => {
    const plan = planMultiFileImport(files(), []);
    expect(plan.files.map((file) => file.suggestedSourceName)).toEqual(["Master Bathroom", "Basement"]);
    expect(plan.files[0].rowCount).toBe(2);
  });

  it("appends the source columns after the data columns", () => {
    const plan = planMultiFileImport(files(), ["Room"]);
    expect(plan.sourceColumns.map((column) => column.name)).toEqual([SOURCE_FILE_COLUMN, "room"]);
  });

  it("infers a fractional column as real even when early rows look whole", () => {
    // The single-file path samples 5 rows and would call this integer, then coerce
    // 47.2 to NULL. This path samples far more, so the fractional value is seen.
    const rows = ["Reading", "36", "39", "45", "50", "61", "47.2"].join("\n");
    const plan = planMultiFileImport([{ fileName: "a.csv", fileText: rows }], []);
    expect(plan.dataColumns[0].type).toBe("real");
  });

  it("reports a file whose column count differs", () => {
    const plan = planMultiFileImport(
      [
        { fileName: "a.csv", fileText: BATHROOM },
        { fileName: "b.csv", fileText: "Timestamp,Relative_Humidity\n2026-09-11 02:08:00,71.2" },
      ],
      [],
    );
    expect(plan.headerMismatches).toHaveLength(1);
    expect(plan.headerMismatches[0]).toMatchObject({ fileName: "b.csv" });
    expect(plan.headerMismatches[0].reason).toContain("2 column(s)");
  });

  it("reports a file whose column names differ", () => {
    const plan = planMultiFileImport(
      [
        { fileName: "a.csv", fileText: BATHROOM },
        {
          fileName: "b.csv",
          fileText: "Timestamp,Temperature_Celsius,Relative_Humidity\n2026-09-11 02:08:00,18,71.2",
        },
      ],
      [],
    );
    expect(plan.headerMismatches[0].reason).toContain("Temperature_Celsius");
  });

  it("refuses an empty file list", () => {
    expect(() => planMultiFileImport([], [])).toThrow(/at least one/i);
  });
});

describe("buildPooledRows", () => {
  const plan = planMultiFileImport(files(), ["Room"]);

  function configured() {
    return [
      { fileName: files()[0].fileName, fileText: BATHROOM, labelValues: { room: "Bathroom" } },
      { fileName: files()[1].fileName, fileText: BASEMENT, labelValues: { room: "Basement" } },
    ];
  }

  it("concatenates every file's rows and tags each with its filename and labels", () => {
    const rows = buildPooledRows(configured(), plan.dataColumns, plan.sourceColumns);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual([
      "2026-09-11 02:08:00",
      "80.42",
      "45.4",
      "Master Bathroom_export_202609221408.csv",
      "Bathroom",
    ]);
    expect(rows[2][4]).toBe("Basement");
  });

  it("pads a short row so the source values never land in a data column", () => {
    const short = `${HEADER}\n2026-09-11 02:08:00,80.42`;
    const rows = buildPooledRows(
      [{ fileName: "a.csv", fileText: short, labelValues: { room: "Bathroom" } }],
      plan.dataColumns,
      plan.sourceColumns,
    );
    expect(rows[0]).toEqual(["2026-09-11 02:08:00", "80.42", "", "a.csv", "Bathroom"]);
  });

  it("writes an empty string for a label the reader left blank", () => {
    const rows = buildPooledRows(
      [{ fileName: "a.csv", fileText: BASEMENT, labelValues: {} }],
      plan.dataColumns,
      plan.sourceColumns,
    );
    expect(rows[0][4]).toBe("");
  });

  it("refuses a file whose headers do not match, even if the plan was not checked", () => {
    const mismatched = [
      { fileName: "b.csv", fileText: "A,B\n1,2", labelValues: {} },
    ];
    expect(() => buildPooledRows(mismatched, plan.dataColumns, plan.sourceColumns)).toThrow(
      /does not have the same columns/,
    );
  });

  it("refuses an empty file list", () => {
    expect(() => buildPooledRows([], plan.dataColumns, plan.sourceColumns)).toThrow(/at least one/i);
  });
});

describe("groupableSourceColumns", () => {
  const sourceColumns = buildSourceColumns([], ["Room"]);

  it("keeps the source columns that still exist on the entry", () => {
    const columns: CsvColumnDefinition[] = [
      { name: SOURCE_FILE_COLUMN, sourceHeader: "Source file", type: "text" },
      { name: "room", sourceHeader: "Room", type: "text" },
    ];
    expect(groupableSourceColumns(sourceColumns, columns)).toHaveLength(2);
  });

  it("drops one whose column was removed rather than throwing", () => {
    const columns: CsvColumnDefinition[] = [
      { name: SOURCE_FILE_COLUMN, sourceHeader: "Source file", type: "text" },
    ];
    expect(groupableSourceColumns(sourceColumns, columns).map((column) => column.name)).toEqual([
      SOURCE_FILE_COLUMN,
    ]);
  });
});
