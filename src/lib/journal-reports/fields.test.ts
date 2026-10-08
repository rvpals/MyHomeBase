import { describe, expect, it } from "vitest";
import {
  JOURNAL_REPORT_ENTRY_FIELDS,
  JOURNAL_REPORT_FIELDS,
  JOURNAL_REPORT_STAT_FIELDS,
  JOURNAL_REPORT_TABLE_FIELDS,
  isReportFieldToken,
  reportField,
  reportPlaceholder,
  unknownTokens,
} from "./fields";

describe("the field list", () => {
  it("has no duplicate tokens", () => {
    // A duplicate would make the picker ambiguous and shadow one field in the
    // lookup map.
    const tokens = JOURNAL_REPORT_FIELDS.map((field) => field.token);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("namespaces every report-scope token, so none can collide with an entry field", () => {
    // render.ts merges entry values over report values; the namespacing is what
    // guarantees that merge is never lossy.
    for (const field of [...JOURNAL_REPORT_STAT_FIELDS, ...JOURNAL_REPORT_TABLE_FIELDS]) {
      expect(field.token).toMatch(/^(stat|table)\./);
    }
    for (const field of JOURNAL_REPORT_ENTRY_FIELDS) {
      expect(field.token).not.toMatch(/^(stat|table)\./);
    }
  });

  it("marks each field with the scope it makes sense in", () => {
    for (const field of JOURNAL_REPORT_ENTRY_FIELDS) expect(field.scope).toBe("entry");
    for (const field of JOURNAL_REPORT_STAT_FIELDS) expect(field.scope).toBe("report");
    for (const field of JOURNAL_REPORT_TABLE_FIELDS) expect(field.scope).toBe("report");
  });

  it("gives every field a label and a description for the picker", () => {
    for (const field of JOURNAL_REPORT_FIELDS) {
      expect(field.label.length).toBeGreaterThan(0);
      expect(field.description.length).toBeGreaterThan(0);
    }
  });
});

describe("reportField", () => {
  it("finds a known token and returns undefined otherwise", () => {
    expect(reportField("title")?.label).toBe("Title");
    expect(reportField("stat.entryCount")?.label).toBe("Entry count");
    expect(reportField("titel")).toBeUndefined();
  });
});

describe("isReportFieldToken", () => {
  it("accepts a real token and rejects a typo", () => {
    expect(isReportFieldToken("date")).toBe(true);
    expect(isReportFieldToken("table.topWords")).toBe(true);
    expect(isReportFieldToken("dat")).toBe(false);
  });
});

describe("reportPlaceholder", () => {
  it("wraps a token in braces, which is what the picker inserts", () => {
    expect(reportPlaceholder("title")).toBe("{{title}}");
    expect(reportPlaceholder("stat.wordCount")).toBe("{{stat.wordCount}}");
  });
});

describe("unknownTokens", () => {
  it("finds a typo'd token", () => {
    // A typo renders as empty text, which is indistinguishable from a field
    // that happened to be blank — naming it is the only way to tell.
    expect(unknownTokens("<p>{{titel}}</p>")).toEqual(["titel"]);
  });

  it("returns nothing for a template using only real fields", () => {
    expect(unknownTokens("<p>{{title}} {{stat.entryCount}} {{table.topTags}}</p>")).toEqual([]);
  });

  it("ignores conditional block markers", () => {
    expect(unknownTokens("{{#time}} at {{time}}{{/time}}")).toEqual([]);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(unknownTokens("{{ title }}")).toEqual([]);
    expect(unknownTokens("{{ titel }}")).toEqual(["titel"]);
  });

  it("reports each unknown token once, sorted", () => {
    expect(unknownTokens("{{zeta}} {{alpha}} {{zeta}}")).toEqual(["alpha", "zeta"]);
  });

  it("finds nothing in a template with no placeholders", () => {
    expect(unknownTokens("<h1>Plain heading</h1>")).toEqual([]);
  });
});
