import { describe, expect, it } from "vitest";
import {
  parseHiddenToolbars,
  serializeHiddenToolbars,
  setToolbarHidden,
} from "./visibility";

describe("parseHiddenToolbars", () => {
  it("reads a comma-separated list", () => {
    expect(parseHiddenToolbars("3,1,2")).toEqual([1, 2, 3]);
  });

  it("reads no row as nothing hidden, so a new reader sees every published toolbar", () => {
    // The whole reason the HIDDEN set is stored rather than the visible one.
    expect(parseHiddenToolbars(undefined)).toEqual([]);
    expect(parseHiddenToolbars("")).toEqual([]);
  });

  it("drops a stale or malformed entry rather than throwing", () => {
    // A deleted toolbar leaves its id in every reader's row; a screen that crashed
    // on one would be unfixable through the UI.
    expect(parseHiddenToolbars("1,abc,,0,-4,2")).toEqual([1, 2]);
  });

  it("collapses duplicates", () => {
    expect(parseHiddenToolbars("2,2,2")).toEqual([2]);
  });
});

describe("serializeHiddenToolbars", () => {
  it("writes sorted, so a round trip never looks like a change", () => {
    expect(serializeHiddenToolbars([3, 1, 2])).toBe("1,2,3");
    expect(parseHiddenToolbars(serializeHiddenToolbars([3, 1, 2]))).toEqual([1, 2, 3]);
  });

  it("writes an empty string when nothing is hidden", () => {
    expect(serializeHiddenToolbars([])).toBe("");
  });
});

describe("setToolbarHidden", () => {
  it("hides one", () => {
    expect(setToolbarHidden([], 2, true)).toEqual([2]);
  });

  it("shows one again", () => {
    expect(setToolbarHidden([1, 2, 3], 2, false)).toEqual([1, 3]);
  });

  it("is idempotent in both directions", () => {
    expect(setToolbarHidden([2], 2, true)).toEqual([2]);
    expect(setToolbarHidden([1], 2, false)).toEqual([1]);
  });

  it("leaves the other entries alone", () => {
    expect(setToolbarHidden([1, 5], 3, true)).toEqual([1, 3, 5]);
  });
});
