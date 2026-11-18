import { describe, expect, it } from "vitest";
import { buildStripTiles, nearestFirst, revealFromRun, type StripTile } from "./strip-window";

const none = new Set<number>();

/** A compact picture of the strip: photo indices as numbers, folds as "+n". */
function shape(tiles: StripTile[]): (number | string)[] {
  return tiles.map((tile) => (tile.kind === "photo" ? tile.index : `+${tile.count}`));
}

describe("buildStripTiles", () => {
  it("shows two on each side and folds the rest into one tile per side", () => {
    expect(shape(buildStripTiles(100, 50, none))).toEqual(["+48", 48, 49, 50, 51, 52, "+47"]);
  });

  it("has no tile on the side with nothing left at the start of the set", () => {
    expect(shape(buildStripTiles(10, 0, none))).toEqual([0, 1, 2, "+7"]);
  });

  it("has no tile on the side with nothing left at the end of the set", () => {
    expect(shape(buildStripTiles(10, 9, none))).toEqual(["+7", 7, 8, 9]);
  });

  it("shows every photo of a set of five or fewer, with no fold", () => {
    expect(shape(buildStripTiles(5, 2, none))).toEqual([0, 1, 2, 3, 4]);
  });

  it("gives an empty set no tiles", () => {
    expect(buildStripTiles(0, 0, none)).toEqual([]);
  });

  it("clamps a current index outside the set rather than showing nothing", () => {
    expect(shape(buildStripTiles(10, 40, none))).toEqual(["+7", 7, 8, 9]);
  });

  it("keeps revealed photos shown, so the fold counts shrink", () => {
    const revealed = new Set([53, 54, 55]);
    expect(shape(buildStripTiles(100, 50, revealed))).toEqual([
      "+48", 48, 49, 50, 51, 52, 53, 54, 55, "+44",
    ]);
  });

  it("folds the gap between a revealed run and a window that has moved away from it", () => {
    const revealed = new Set([10, 11]);
    expect(shape(buildStripTiles(30, 20, revealed))).toEqual([
      "+10", 10, 11, "+6", 18, 19, 20, 21, 22, "+7",
    ]);
  });

  it("ignores revealed indices outside the set", () => {
    expect(shape(buildStripTiles(10, 0, new Set([-3, 99])))).toEqual([0, 1, 2, "+7"]);
  });

  it("records each fold's inclusive range", () => {
    const tiles = buildStripTiles(10, 0, none);
    expect(tiles.at(-1)).toEqual({ kind: "more", start: 3, end: 9, count: 7 });
  });
});

describe("revealFromRun", () => {
  it("opens a run after the current photo from its left end", () => {
    expect(revealFromRun({ start: 53, end: 99 }, 50, 3)).toEqual([53, 54, 55]);
  });

  it("opens a run before the current photo from its right end", () => {
    expect(revealFromRun({ start: 0, end: 47 }, 50, 3)).toEqual([47, 46, 45]);
  });

  it("opens the whole run when it is smaller than a batch", () => {
    expect(revealFromRun({ start: 3, end: 4 }, 0, 10)).toEqual([3, 4]);
  });

  it("opens nothing for a batch of zero", () => {
    expect(revealFromRun({ start: 3, end: 9 }, 0, 0)).toEqual([]);
  });
});

describe("nearestFirst", () => {
  it("orders by distance, the next photo before the previous one", () => {
    expect(nearestFirst([48, 49, 50, 51, 52], 50)).toEqual([50, 51, 49, 52, 48]);
  });

  it("does not modify its input", () => {
    const input = [3, 1, 2];
    nearestFirst(input, 0);
    expect(input).toEqual([3, 1, 2]);
  });
});
