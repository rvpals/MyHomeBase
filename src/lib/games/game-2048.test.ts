import { describe, expect, it } from "vitest";
import {
  applyMove,
  canMove,
  collapseLine,
  emptyBoard,
  emptyCells,
  hasWon,
  highestTile,
  isGameOver,
  spawnTile,
  startBoard,
} from "./game-2048";
import type { Board } from "./types";

/** A deterministic RNG: replays the given values, then repeats the last one. */
function rng(...values: number[]) {
  let call = 0;
  return () => values[Math.min(call++, values.length - 1)] ?? 0;
}

describe("collapseLine", () => {
  it("slides tiles to the front without merging unequal ones", () => {
    expect(collapseLine([0, 2, 0, 4])).toEqual({ line: [2, 4, 0, 0], gained: 0 });
  });

  it("merges equal tiles across a gap", () => {
    // The gap must not prevent the merge — this is the rule players rely on.
    expect(collapseLine([2, 0, 2, 0])).toEqual({ line: [4, 0, 0, 0], gained: 4 });
  });

  it("merges a run of four into two pairs, not one tile", () => {
    expect(collapseLine([2, 2, 2, 2])).toEqual({ line: [4, 4, 0, 0], gained: 8 });
  });

  it("does not let a freshly merged tile merge again in the same move", () => {
    // [4,2,2] -> [4,4]; an 8 here would mean the new 4 merged with the leading 4.
    expect(collapseLine([4, 2, 2, 0])).toEqual({ line: [4, 4, 0, 0], gained: 4 });
  });

  it("leaves an already-collapsed line untouched and scores nothing", () => {
    expect(collapseLine([8, 4, 2, 0])).toEqual({ line: [8, 4, 2, 0], gained: 0 });
  });

  it("returns an empty line unchanged", () => {
    expect(collapseLine([0, 0, 0, 0])).toEqual({ line: [0, 0, 0, 0], gained: 0 });
  });
});

describe("applyMove", () => {
  // Rows, top to bottom. Written as nested arrays purely for readability.
  const board: Board = [
    2, 2, 0, 0,
    0, 0, 0, 0,
    4, 0, 0, 0,
    4, 0, 0, 0,
  ];

  it("merges leftward and reports what was gained", () => {
    const result = applyMove(board, "left");
    expect(result.moved).toBe(true);
    expect(result.gained).toBe(4);
    expect(result.board.slice(0, 4)).toEqual([4, 0, 0, 0]);
  });

  it("merges a column upward", () => {
    const result = applyMove(board, "up");
    expect(result.moved).toBe(true);
    // Column 0 is [2,0,4,4] top-down, so the two 4s merge into an 8 that lands
    // *below* the 2 already at the top: row 0 keeps [2,2], row 1 becomes [8].
    expect(result.gained).toBe(8);
    expect(result.board.slice(0, 4)).toEqual([2, 2, 0, 0]);
    expect(result.board[4]).toBe(8);
  });

  it("moves tiles to the far edge on a right move", () => {
    const result = applyMove(board, "right");
    expect(result.moved).toBe(true);
    expect(result.board.slice(0, 4)).toEqual([0, 0, 0, 4]);
  });

  it("reports moved=false for a move into a wall", () => {
    // Already flush left with no merges available, so nothing can shift.
    const flush: Board = [
      2, 4, 8, 16,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ];
    const result = applyMove(flush, "left");
    expect(result.moved).toBe(false);
    expect(result.gained).toBe(0);
    expect(result.board).toEqual(flush);
  });

  it("does not mutate the board it was given", () => {
    const original = [...board];
    applyMove(board, "left");
    expect(board).toEqual(original);
  });
});

describe("spawnTile", () => {
  it("places a 2 in the only empty cell when the roll is low", () => {
    const nearlyFull: Board = [
      2, 4, 8, 16,
      32, 64, 128, 256,
      512, 1024, 2, 4,
      8, 16, 32, 0,
    ];
    // First value picks the cell, second picks the face: < 0.9 means a 2.
    const next = spawnTile(nearlyFull, rng(0, 0.5));
    expect(next[15]).toBe(2);
  });

  it("places a 4 when the roll is high", () => {
    const next = spawnTile(emptyBoard(), rng(0, 0.95));
    expect(next.filter((value) => value !== 0)).toEqual([4]);
  });

  it("returns a full board unchanged rather than throwing", () => {
    const full: Board = new Array(16).fill(2);
    expect(spawnTile(full, rng(0.5))).toEqual(full);
  });
});

describe("startBoard", () => {
  it("opens with exactly two tiles", () => {
    const board = startBoard(rng(0.1, 0.5, 0.9, 0.5));
    expect(emptyCells(board)).toHaveLength(14);
  });
});

describe("isGameOver", () => {
  it("is false while an empty cell remains", () => {
    expect(isGameOver(emptyBoard())).toBe(false);
  });

  it("is false on a full board that still has a legal merge", () => {
    const mergeable: Board = [
      2, 2, 4, 8,
      16, 32, 64, 128,
      256, 512, 1024, 2,
      4, 8, 16, 32,
    ];
    expect(canMove(mergeable)).toBe(true);
    expect(isGameOver(mergeable)).toBe(false);
  });

  it("is true on a full board with no equal neighbours", () => {
    // A checkerboard of alternating values: full, and no two neighbours match.
    const stuck: Board = [
      2, 4, 2, 4,
      4, 2, 4, 2,
      2, 4, 2, 4,
      4, 2, 4, 2,
    ];
    expect(isGameOver(stuck)).toBe(true);
  });
});

describe("hasWon and highestTile", () => {
  it("reports a win once the 2048 tile exists", () => {
    const board = [...emptyBoard()];
    board[3] = 2048;
    expect(hasWon(board)).toBe(true);
    expect(highestTile(board)).toBe(2048);
  });

  it("reports no win below 2048", () => {
    const board = [...emptyBoard()];
    board[0] = 1024;
    expect(hasWon(board)).toBe(false);
    expect(highestTile(board)).toBe(1024);
  });

  it("reports 0 as the highest tile of an empty board", () => {
    expect(highestTile(emptyBoard())).toBe(0);
  });
});
