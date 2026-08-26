import { describe, expect, it } from "vitest";
import {
  MAX_TARGET_SECONDS,
  MIN_TARGET_SECONDS,
  magicCriteriaSchema,
  magicFolderPathSchema,
  magicListIdSchema,
  magicListUpdateSchema,
  magicListWriteSchema,
} from "./schema";

// The boundary that protects every adapter, so the cases are explicit rather than assumed.

describe("magicCriteriaSchema", () => {
  it("accepts a full criteria set", () => {
    const parsed = magicCriteriaSchema.parse({
      genres: ["Rock", "Pop"],
      artists: ["Michael Jackson", "Luther Vandross"],
      albumIds: [3, 7],
      folders: ["Rock/Queen"],
      targetSeconds: 3600,
      matchAny: false,
      streamableOnly: true,
    });

    expect(parsed.genres).toEqual(["Rock", "Pop"]);
    expect(parsed.artists).toEqual(["Michael Jackson", "Luther Vandross"]);
    expect(parsed.albumIds).toEqual([3, 7]);
    expect(parsed.folders).toEqual(["Rock/Queen"]);
    expect(parsed.targetSeconds).toBe(3600);
  });

  it("defaults every field, so an empty object means the whole library for an hour", () => {
    const parsed = magicCriteriaSchema.parse({});

    expect(parsed.genres).toEqual([]);
    expect(parsed.artists).toEqual([]);
    expect(parsed.albumIds).toEqual([]);
    expect(parsed.folders).toEqual([]);
    expect(parsed.targetSeconds).toBe(3600);
    expect(parsed.matchAny).toBe(false);
    // Defaults ON here, unlike the rest of the module -- see migrations/0057.
    expect(parsed.streamableOnly).toBe(true);
  });

  it("accepts the empty string as a genre, which selects the untagged group", () => {
    // Load-bearing: plenty of this library carries no genre tag, and "No genre" is a
    // category a listener can pick.
    const parsed = magicCriteriaSchema.parse({ genres: [""] });
    expect(parsed.genres).toEqual([""]);
  });

  it("accepts the empty string as an artist", () => {
    expect(magicCriteriaSchema.parse({ artists: [""] }).artists).toEqual([""]);
  });

  it("coerces numeric strings, which is what a form posts", () => {
    const parsed = magicCriteriaSchema.parse({ targetSeconds: "1800", albumIds: ["4", "5"] });
    expect(parsed.targetSeconds).toBe(1800);
    expect(parsed.albumIds).toEqual([4, 5]);
  });

  it("rejects a target below one minute", () => {
    expect(() => magicCriteriaSchema.parse({ targetSeconds: MIN_TARGET_SECONDS - 1 })).toThrow();
  });

  it("rejects a target beyond twelve hours", () => {
    expect(() => magicCriteriaSchema.parse({ targetSeconds: MAX_TARGET_SECONDS + 1 })).toThrow();
  });

  it("rejects a fractional target", () => {
    expect(() => magicCriteriaSchema.parse({ targetSeconds: 1800.5 })).toThrow();
  });

  it("rejects a zero or negative album id", () => {
    expect(() => magicCriteriaSchema.parse({ albumIds: [0] })).toThrow();
    expect(() => magicCriteriaSchema.parse({ albumIds: [-3] })).toThrow();
  });

  it("rejects more criteria values than an IN clause should carry", () => {
    const tooMany = Array.from({ length: 501 }, (_, index) => `Genre ${index}`);
    expect(() => magicCriteriaSchema.parse({ genres: tooMany })).toThrow();
  });

  it("rejects a non-array where a list is expected", () => {
    expect(() => magicCriteriaSchema.parse({ genres: "Rock" })).toThrow();
  });

  it("drops the empty path from folders, unlike genres and artists", () => {
    // '' is the library ROOT here, not an untagged group -- so it restricts nothing and
    // must not survive as a criterion that quietly means "everything".
    expect(magicCriteriaSchema.parse({ folders: [""] }).folders).toEqual([]);
  });

  it("prunes a folder already covered by a picked parent", () => {
    const parsed = magicCriteriaSchema.parse({ folders: ["Rock", "Rock/Queen"] });
    expect(parsed.folders).toEqual(["Rock"]);
  });

  it("normalises a trailing slash on a folder", () => {
    expect(magicCriteriaSchema.parse({ folders: ["Rock/Queen/"] }).folders).toEqual([
      "Rock/Queen",
    ]);
  });

  it("normalises backslashes, so a Windows-shaped path matches the stored paths", () => {
    expect(magicCriteriaSchema.parse({ folders: ["Rock\\Queen"] }).folders).toEqual([
      "Rock/Queen",
    ]);
  });

  it("rejects a folder path beyond the sane nesting depth", () => {
    expect(() => magicCriteriaSchema.parse({ folders: ["x".repeat(1001)] })).toThrow();
  });

  it("rejects more folders than an IN clause should carry", () => {
    const tooMany = Array.from({ length: 501 }, (_, index) => `Folder ${index}`);
    expect(() => magicCriteriaSchema.parse({ folders: tooMany })).toThrow();
  });
});

describe("magicFolderPathSchema", () => {
  it("defaults to the root, so a picker with no parent starts at the top", () => {
    expect(magicFolderPathSchema.parse(undefined)).toBe("");
  });

  it("normalises a path the same way a stored criterion is normalised", () => {
    expect(magicFolderPathSchema.parse("Rock\\Queen/")).toBe("Rock/Queen");
  });

  it("rejects a non-string", () => {
    expect(() => magicFolderPathSchema.parse(42)).toThrow();
  });
});

describe("magicListWriteSchema", () => {
  it("accepts a name with criteria and trims the name", () => {
    const parsed = magicListWriteSchema.parse({
      name: "  Friday night  ",
      criteria: { targetSeconds: 1800 },
    });
    expect(parsed.name).toBe("Friday night");
    expect(parsed.description).toBe("");
  });

  it("rejects a blank or whitespace-only name", () => {
    expect(() => magicListWriteSchema.parse({ name: "", criteria: {} })).toThrow();
    expect(() => magicListWriteSchema.parse({ name: "   ", criteria: {} })).toThrow();
  });

  it("rejects a name beyond the column's length", () => {
    expect(() => magicListWriteSchema.parse({ name: "x".repeat(121), criteria: {} })).toThrow();
  });

  it("rejects a missing criteria object", () => {
    expect(() => magicListWriteSchema.parse({ name: "No criteria" })).toThrow();
  });
});

describe("magicListUpdateSchema", () => {
  it("requires the list id alongside the criteria", () => {
    const parsed = magicListUpdateSchema.parse({
      magicListId: "12",
      name: "Edited",
      criteria: {},
    });
    expect(parsed.magicListId).toBe(12);
  });

  it("rejects an update with no id", () => {
    expect(() => magicListUpdateSchema.parse({ name: "Edited", criteria: {} })).toThrow();
  });
});

describe("magicListIdSchema", () => {
  it("coerces a route param string", () => {
    expect(magicListIdSchema.parse("42")).toBe(42);
  });

  it("rejects zero, a negative, and a non-number", () => {
    expect(() => magicListIdSchema.parse(0)).toThrow();
    expect(() => magicListIdSchema.parse(-1)).toThrow();
    expect(() => magicListIdSchema.parse("not a number")).toThrow();
  });
});
