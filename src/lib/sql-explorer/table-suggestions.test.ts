import { describe, expect, it } from "vitest";
import { expectsTableName, fragmentBeforeCaret, suggestTableNames } from "./table-suggestions";

const NAMES = ["jrn_locations", "sys_users", "jrn_entries", "my_jrn_log", "inv_stock_positions"];

describe("suggestTableNames", () => {
  it("lists names starting with the fragment, alphabetically", () => {
    expect(suggestTableNames(NAMES, "jrn")).toEqual(["jrn_entries", "jrn_locations"]);
  });

  it("does not match in the middle of a name", () => {
    expect(suggestTableNames(NAMES, "log")).toEqual([]);
  });

  it("ignores case", () => {
    expect(suggestTableNames(NAMES, "JRN_E")).toEqual(["jrn_entries"]);
  });

  it("suggests nothing below the minimum length", () => {
    expect(suggestTableNames(NAMES, "j")).toEqual([]);
    expect(suggestTableNames(NAMES, "")).toEqual([]);
  });

  it("returns nothing when no name matches or the name is already complete", () => {
    expect(suggestTableNames(NAMES, "zzz")).toEqual([]);
    expect(suggestTableNames(NAMES, "sys_users")).toEqual([]);
  });

  it("caps the list at the limit", () => {
    expect(suggestTableNames(NAMES, "jrn", { limit: 1 })).toHaveLength(1);
  });
});

describe("expectsTableName", () => {
  it("is true right after FROM or JOIN, in any case", () => {
    expect(expectsTableName("SELECT * FROM jrn", 14)).toBe(true);
    expect(expectsTableName("select * from a left join jrn", 26)).toBe(true);
    expect(expectsTableName("SELECT *\nFROM\n  jrn", 16)).toBe(true);
  });

  it("is false elsewhere", () => {
    expect(expectsTableName("SELECT jrn", 7)).toBe(false);
    expect(expectsTableName("SELECT * FROM a WHERE jrn", 22)).toBe(false);
    expect(expectsTableName("jrn", 0)).toBe(false);
  });

  it("does not treat a word merely ending in from/join as the keyword", () => {
    expect(expectsTableName("SELECT * FROM a, afrom jrn", 23)).toBe(false);
  });
});

describe("fragmentBeforeCaret", () => {
  it("returns the word ending at the caret", () => {
    expect(fragmentBeforeCaret("SELECT * FROM jrn", 17)).toEqual({ text: "jrn", start: 14 });
  });

  it("stops at the caret, not the end of the word", () => {
    expect(fragmentBeforeCaret("SELECT * FROM jrn_entries", 17)).toEqual({ text: "jrn", start: 14 });
  });

  it("is empty after whitespace or punctuation", () => {
    expect(fragmentBeforeCaret("SELECT ", 7).text).toBe("");
    expect(fragmentBeforeCaret("a.", 2).text).toBe("");
  });

  it("clamps an out-of-range caret", () => {
    expect(fragmentBeforeCaret("abc", 99)).toEqual({ text: "abc", start: 0 });
  });
});
