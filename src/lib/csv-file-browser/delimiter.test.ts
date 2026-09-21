import { describe, expect, it } from "vitest";
import {
  isCsvDelimiter,
  parseDelimited,
  sniffDelimiter,
  toDelimitedLine,
  toDelimitedText,
} from "./delimiter";

describe("sniffDelimiter", () => {
  it("finds a comma in an ordinary CSV", () => {
    expect(sniffDelimiter("name,age\nAda,36\nGrace,45")).toBe(",");
  });

  it("finds a tab in a tab-separated file", () => {
    expect(sniffDelimiter("name\tage\nAda\t36\nGrace\t45")).toBe("\t");
  });

  it("finds a semicolon and a pipe", () => {
    expect(sniffDelimiter("name;age\nAda;36")).toBe(";");
    expect(sniffDelimiter("name|age\nAda|36")).toBe("|");
  });

  // The case the sniffer exists for: a tab-separated file whose *values* hold
  // commas. Counting alone would pick the comma; consistency picks the tab.
  it("prefers the separator that splits every line the same way", () => {
    const text = ["city\tnote", "Paris\tbig, busy, bright", "Rome\told, warm, loud"].join("\n");
    expect(sniffDelimiter(text)).toBe("\t");
  });

  it("ignores delimiters inside quoted fields", () => {
    const text = ['name;note', '"Smith, John";first', '"Doe, Jane";second'].join("\n");
    expect(sniffDelimiter(text)).toBe(";");
  });

  it("falls back to a comma when there is no separator at all", () => {
    expect(sniffDelimiter("justonecolumn\nvalue\nanother")).toBe(",");
  });

  it("falls back to a comma on empty text", () => {
    expect(sniffDelimiter("")).toBe(",");
    expect(sniffDelimiter("   \n  \n")).toBe(",");
  });
});

describe("isCsvDelimiter", () => {
  it("accepts the four it reads and rejects anything else", () => {
    expect(isCsvDelimiter(",")).toBe(true);
    expect(isCsvDelimiter("\t")).toBe(true);
    expect(isCsvDelimiter(":")).toBe(false);
    expect(isCsvDelimiter("")).toBe(false);
  });
});

describe("parseDelimited", () => {
  it("reads a header row and the rows under it", () => {
    const result = parseDelimited("name,age\nAda,36\nGrace,45", ",", true);
    expect(result.columnNames).toEqual(["name", "age"]);
    expect(result.rows).toEqual([
      ["Ada", "36"],
      ["Grace", "45"],
    ]);
  });

  it("invents column names when the file has no header row", () => {
    const result = parseDelimited("Ada,36\nGrace,45", ",", false);
    expect(result.columnNames).toEqual(["Column 1", "Column 2"]);
    expect(result.rows).toHaveLength(2);
  });

  it("keeps a quoted field that spans lines intact", () => {
    const result = parseDelimited('name,note\nAda,"first\nsecond"', ",", true);
    expect(result.rows).toEqual([["Ada", "first\nsecond"]]);
  });

  it("unescapes a doubled quote inside a quoted field", () => {
    // The doubling only means an escaped quote *inside* a quoted field, which
    // is what RFC 4180 says and what `parseCsvRecords` already does. Bare
    // quotes in unquoted text are field-quoting markers, not escapes.
    const result = parseDelimited('name\n"said ""hello"""', ",", true);
    expect(result.rows).toEqual([['said "hello"']]);
  });

  // The shared parser drops a row with fewer than half the header's fields.
  // Here the file is the thing being inspected, so a short row is padded and
  // kept — hiding it would hide what someone opened the tool to find.
  it("keeps a short row, padded to the column count", () => {
    const result = parseDelimited("a,b,c\n1,2,3\n4,5", ",", true);
    expect(result.rows).toEqual([
      ["1", "2", "3"],
      ["4", "5", ""],
    ]);
  });

  it("widens the columns when a row is longer than the header", () => {
    const result = parseDelimited("a,b\n1,2,3", ",", true);
    expect(result.columnNames).toEqual(["a", "b", "Column 3"]);
    expect(result.rows).toEqual([["1", "2", "3"]]);
  });

  it("names a blank header column rather than leaving it empty", () => {
    const result = parseDelimited("a,,c\n1,2,3", ",", true);
    expect(result.columnNames).toEqual(["a", "Column 2", "c"]);
  });

  it("makes duplicate header names distinct", () => {
    const result = parseDelimited("total,total,total\n1,2,3", ",", true);
    expect(result.columnNames).toEqual(["total", "total (2)", "total (3)"]);
  });

  it("does not collide with a name the file already uses for the suffix", () => {
    const result = parseDelimited("total,total (2),total\n1,2,3", ",", true);
    expect(new Set(result.columnNames).size).toBe(3);
  });

  it("parses CRLF and LF identically", () => {
    const lf = parseDelimited("a,b\n1,2", ",", true);
    const crlf = parseDelimited("a,b\r\n1,2", ",", true);
    expect(crlf).toEqual(lf);
  });

  it("drops blank lines", () => {
    const result = parseDelimited("a,b\n\n1,2\n\n", ",", true);
    expect(result.rows).toEqual([["1", "2"]]);
  });

  it("returns nothing for empty text", () => {
    expect(parseDelimited("", ",", true)).toEqual({ columnNames: [], rows: [] });
  });

  it("reads a header row with no data under it", () => {
    const result = parseDelimited("a,b", ",", true);
    expect(result.columnNames).toEqual(["a", "b"]);
    expect(result.rows).toEqual([]);
  });
});

describe("toDelimitedText", () => {
  it("writes a header and rows", () => {
    expect(toDelimitedText(["a", "b"], [["1", "2"]], ",")).toBe("a,b\r\n1,2");
  });

  it("quotes only the cells that need it", () => {
    const text = toDelimitedText(["a", "b"], [["plain", "has,comma"]], ",");
    expect(text).toBe('a,b\r\nplain,"has,comma"');
  });

  it("doubles an embedded quote", () => {
    expect(toDelimitedLine(['say "hi"'], ",")).toBe('"say ""hi"""');
  });

  it("quotes a cell holding a newline", () => {
    expect(toDelimitedLine(["one\ntwo"], ",")).toBe('"one\ntwo"');
  });

  it("writes a null as an empty cell", () => {
    expect(toDelimitedLine(["a", null, "c"], ",")).toBe("a,,c");
  });

  it("does not quote a comma when the delimiter is a tab", () => {
    expect(toDelimitedLine(["a,b", "c"], "\t")).toBe("a,b\tc");
  });

  // The property that matters for the export route: what comes out can be read
  // back in and give the same table.
  it("round-trips through parseDelimited", () => {
    const columnNames = ["name", "note"];
    const rows = [
      ["Ada", 'said "hi", loudly'],
      ["Grace", "one\ntwo"],
      ["Alan", ""],
    ];

    const text = toDelimitedText(columnNames, rows, ",");
    const parsed = parseDelimited(text, ",", true);

    expect(parsed.columnNames).toEqual(columnNames);
    expect(parsed.rows).toEqual(rows);
  });
});
