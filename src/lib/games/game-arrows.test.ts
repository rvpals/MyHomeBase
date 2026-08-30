import { describe, expect, it } from "vitest";
import {
  clearArrow,
  generatePuzzle,
  isBlocked,
  isSolved,
  isStuck,
  pathAhead,
  scoreBoard,
  solutionClearsBoard,
  unblockedArrows,
} from "./game-arrows";
import { ARROW_DIFFICULTIES, ARROW_DIFFICULTY_SETUP, type Arrow, type ArrowBoard } from "./types";

/**
 * A deterministic stand-in for Math.random: cycles a fixed list, so a generated board
 * is the same on every run and a failure can actually be reproduced.
 */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    // Numerical Recipes LCG. Any decent cycle will do; this one is short and pure.
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function arrow(id: number, cells: [number, number][], direction: Arrow["direction"]): Arrow {
  return { id, cells: cells.map(([row, col]) => ({ row, col })), direction };
}

function board(size: number, arrows: Arrow[]): ArrowBoard {
  return { size, arrows };
}

describe("pathAhead", () => {
  it("runs from just past the head to the edge", () => {
    // Head at (2,2) pointing right on a 5-wide board: exits through (2,3) and (2,4).
    const path = pathAhead(arrow(1, [[2, 2]], "right"), 5);
    expect(path).toEqual([
      { row: 2, col: 3 },
      { row: 2, col: 4 },
    ]);
  });

  it("is empty when the head already sits on the edge", () => {
    expect(pathAhead(arrow(1, [[0, 4]], "right"), 5)).toEqual([]);
  });

  it("measures from the head, not the tail", () => {
    // A 3-cell arrow pointing up with its head at row 1 has only row 0 ahead of it,
    // however far its tail trails behind.
    const long = arrow(1, [
      [1, 0],
      [2, 0],
      [3, 0],
    ], "up");
    expect(pathAhead(long, 5)).toEqual([{ row: 0, col: 0 }]);
  });
});

describe("isBlocked", () => {
  it("is false when the way out is clear", () => {
    const state = board(5, [arrow(1, [[2, 2]], "right")]);
    expect(isBlocked(state, 1)).toBe(false);
  });

  it("is false for an arrow whose head is already on the edge", () => {
    const state = board(5, [arrow(1, [[2, 4]], "right")]);
    expect(isBlocked(state, 1)).toBe(false);
  });

  it("is true when another arrow's head sits in the way", () => {
    const state = board(5, [arrow(1, [[2, 2]], "right"), arrow(2, [[2, 4]], "up")]);
    expect(isBlocked(state, 1)).toBe(true);
  });

  it("is true when another arrow's tail sits in the way", () => {
    // Arrow 2's head is at (0,3), well clear — but its tail runs down through (2,3),
    // which is exactly what arrow 1 needs to pass through.
    const blocker = arrow(2, [
      [0, 3],
      [1, 3],
      [2, 3],
    ], "up");
    const state = board(5, [arrow(1, [[2, 2]], "right"), blocker]);
    expect(isBlocked(state, 1)).toBe(true);
  });

  it("does not treat an arrow's own tail as a blocker", () => {
    // The regression that matters: a long arrow occupies cells behind its head, and a
    // naive check that walked every cell would find them and call it blocked.
    const long = arrow(1, [
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ], "up");
    expect(isBlocked(board(5, [long]), 1)).toBe(false);
  });

  it("ignores an arrow standing behind it rather than in front", () => {
    const state = board(5, [arrow(1, [[2, 2]], "right"), arrow(2, [[2, 0]], "up")]);
    expect(isBlocked(state, 1)).toBe(false);
  });

  it("is false for an id that is not on the board", () => {
    expect(isBlocked(board(5, []), 99)).toBe(false);
  });
});

describe("clearArrow", () => {
  it("removes an unblocked arrow", () => {
    const state = board(5, [arrow(1, [[2, 2]], "right"), arrow(2, [[0, 0]], "up")]);
    const result = clearArrow(state, 1);

    expect(result.cleared).toBe(true);
    expect(result.board.arrows.map((entry) => entry.id)).toEqual([2]);
  });

  it("leaves a blocked arrow in place and reports the bump", () => {
    const state = board(5, [arrow(1, [[2, 2]], "right"), arrow(2, [[2, 3]], "up")]);
    const result = clearArrow(state, 1);

    expect(result.cleared).toBe(false);
    expect(result.board).toBe(state);
  });

  it("reports nothing cleared for an unknown id", () => {
    const state = board(5, [arrow(1, [[2, 2]], "right")]);
    const result = clearArrow(state, 42);

    expect(result.cleared).toBe(false);
    expect(result.board.arrows).toHaveLength(1);
  });

  it("frees the arrow that was blocked behind it", () => {
    const state = board(5, [arrow(1, [[2, 2]], "right"), arrow(2, [[2, 3]], "up")]);
    expect(isBlocked(state, 1)).toBe(true);

    const after = clearArrow(state, 2).board;
    expect(isBlocked(after, 1)).toBe(false);
  });
});

describe("isSolved and isStuck", () => {
  it("treats an empty board as solved and not stuck", () => {
    const empty = board(5, []);
    expect(isSolved(empty)).toBe(true);
    expect(isStuck(empty)).toBe(false);
  });

  it("treats a board with arrows left as unsolved", () => {
    expect(isSolved(board(5, [arrow(1, [[0, 0]], "up")]))).toBe(false);
  });

  it("reports a mutually blocking pair as stuck", () => {
    // Two arrows pointing into each other across a gap: neither can leave. Not
    // reachable from a generated board, which is the point of checking it here.
    const facing = board(3, [arrow(1, [[1, 0]], "right"), arrow(2, [[1, 2]], "left")]);
    expect(unblockedArrows(facing)).toHaveLength(0);
    expect(isStuck(facing)).toBe(true);
  });
});

describe("generatePuzzle", () => {
  it("builds a board of the difficulty's size", () => {
    for (const difficulty of ARROW_DIFFICULTIES) {
      const puzzle = generatePuzzle(difficulty, seededRandom(7));
      expect(puzzle.board.size).toBe(ARROW_DIFFICULTY_SETUP[difficulty].size);
    }
  });

  it("keeps every arrow on the board and never overlaps two", () => {
    const puzzle = generatePuzzle("hard", seededRandom(99));
    const seen = new Set<string>();

    for (const entry of puzzle.board.arrows) {
      for (const cell of entry.cells) {
        expect(cell.row).toBeGreaterThanOrEqual(0);
        expect(cell.row).toBeLessThan(puzzle.board.size);
        expect(cell.col).toBeGreaterThanOrEqual(0);
        expect(cell.col).toBeLessThan(puzzle.board.size);

        const key = `${cell.row},${cell.col}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it("places arrows of no more than four cells", () => {
    const puzzle = generatePuzzle("hard", seededRandom(3));
    for (const entry of puzzle.board.arrows) {
      expect(entry.cells.length).toBeGreaterThanOrEqual(1);
      expect(entry.cells.length).toBeLessThanOrEqual(4);
    }
  });

  it("gets close to the requested arrow count", () => {
    // Best-effort by design, so this asserts a useful board rather than an exact
    // number — a generator that quietly placed two arrows would still be a bug.
    const target = ARROW_DIFFICULTY_SETUP.medium.arrows;
    const puzzle = generatePuzzle("medium", seededRandom(11));
    expect(puzzle.board.arrows.length).toBeGreaterThan(target / 2);
    expect(puzzle.board.arrows.length).toBeLessThanOrEqual(target);
  });

  it("returns a solution covering every arrow exactly once", () => {
    const puzzle = generatePuzzle("medium", seededRandom(5));
    const ids = [...puzzle.board.arrows.map((entry) => entry.id)].sort((a, b) => a - b);
    const solved = [...puzzle.solution].sort((a, b) => a - b);
    expect(solved).toEqual(ids);
  });

  /**
   * The load-bearing test. Reverse construction is only worth anything if the boards
   * it produces really are solvable, so this generates a spread of them at every
   * difficulty and plays each solution through to an empty board.
   */
  it("generates solvable boards across many seeds", () => {
    for (const difficulty of ARROW_DIFFICULTIES) {
      for (let seed = 1; seed <= 60; seed += 1) {
        const puzzle = generatePuzzle(difficulty, seededRandom(seed));
        expect(solutionClearsBoard(puzzle)).toBe(true);
      }
    }
  });

  it("never generates a board that starts stuck", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      expect(isStuck(generatePuzzle("hard", seededRandom(seed)).board)).toBe(false);
    }
  });
});

describe("scoreBoard", () => {
  it("awards full marks for a flawless solve", () => {
    expect(scoreBoard(7, 0)).toBe(700);
  });

  it("docks each wasted click", () => {
    expect(scoreBoard(7, 2)).toBe(700 - 30);
  });

  it("floors a badly fumbled solve above zero", () => {
    // 200 misses would take this far negative; the floor keeps a big board worth more
    // than a small one even when both were played badly.
    expect(scoreBoard(24, 200)).toBe(240);
    expect(scoreBoard(24, 200)).toBeGreaterThan(scoreBoard(7, 200));
  });
});
