import { describe, expect, it } from "vitest";
import {
  buildArrowSave,
  decodeArrowBoard,
  encodeArrowBoard,
  replayArrowMoves,
  restoreArrowRun,
} from "./arrow-save";
import { clearArrow, generatePuzzle } from "./game-arrows";
import {
  ARROW_DIFFICULTY_SETUP,
  ARROW_LIVES,
  ARROW_MOVE_FREE_MISS,
  ARROW_MOVE_MISS,
  ARROW_MOVE_UNDO,
  ARROW_SAVE_VERSION,
  type Arrow,
  type ArrowBoard,
} from "./types";

/** The same LCG `game-arrows.test.ts` uses, so a generated board is reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const SIZE = ARROW_DIFFICULTY_SETUP.hard.size;

function arrow(id: number, cells: [number, number][], direction: Arrow["direction"]): Arrow {
  return { id, cells: cells.map(([row, col]) => ({ row, col })), direction };
}

/*
  A small board on the Hard tier's 50x50 grid:
  - 1 sits on the top edge pointing up, so it is always free.
  - 2 points up the same column, so it is blocked until 1 has gone.
  - 3 points right along an empty row, so it is always free.
*/
const DEALT: ArrowBoard = {
  size: SIZE,
  arrows: [
    arrow(1, [[0, 0], [0, 1]], "up"),
    arrow(2, [[5, 0], [6, 0], [6, 1]], "up"),
    arrow(3, [[10, 10]], "right"),
  ],
};

function saveWith(moves: number[], overrides: Record<string, unknown> = {}) {
  return {
    ...buildArrowSave({
      difficulty: "hard",
      dealt: DEALT,
      moves,
      unlimitedLives: false,
      practiceRun: false,
    }),
    ...overrides,
  };
}

describe("encodeArrowBoard / decodeArrowBoard", () => {
  it("round-trips a board", () => {
    expect(decodeArrowBoard(SIZE, encodeArrowBoard(DEALT))).toEqual(DEALT);
  });

  it("stores each arrow as id, direction index, then head-first cell indices", () => {
    expect(encodeArrowBoard(DEALT)[1]).toEqual([2, 0, 5 * SIZE, 6 * SIZE, 6 * SIZE + 1]);
  });

  it("rejects cells that are not next to each other", () => {
    expect(decodeArrowBoard(SIZE, [[1, 0, 0, 2]])).toBeUndefined();
  });

  it("rejects a cell used by two arrows", () => {
    expect(decodeArrowBoard(SIZE, [[1, 0, 0], [2, 0, 0]])).toBeUndefined();
  });

  it("rejects an unknown direction, a repeated id and an off-board cell", () => {
    expect(decodeArrowBoard(SIZE, [[1, 4, 0]])).toBeUndefined();
    expect(decodeArrowBoard(SIZE, [[1, 0, 0], [1, 0, 5]])).toBeUndefined();
    expect(decodeArrowBoard(SIZE, [[1, 0, SIZE * SIZE]])).toBeUndefined();
  });
});

describe("replayArrowMoves", () => {
  it("follows the view's rules for misses, clears and undo", () => {
    // Miss on 2 (blocked), clear 1, free miss, clear 2, then undo the clear of 2.
    const replayed = replayArrowMoves(DEALT, [ARROW_MOVE_MISS, 1, ARROW_MOVE_FREE_MISS, 2, ARROW_MOVE_UNDO]);
    expect(replayed).toBeDefined();
    expect(replayed?.board.arrows.map((entry) => entry.id)).toEqual([2, 3]);
    expect(replayed?.lives).toBe(ARROW_LIVES - 1);
    expect(replayed?.misses).toBe(2);
    expect(replayed?.cleared).toBe(1);
    expect(replayed?.history).toHaveLength(1);
  });

  it("gives back a life lost after the clear being undone, but keeps the miss count", () => {
    const replayed = replayArrowMoves(DEALT, [1, ARROW_MOVE_MISS, ARROW_MOVE_UNDO]);
    expect(replayed?.lives).toBe(ARROW_LIVES);
    expect(replayed?.misses).toBe(1);
    expect(replayed?.cleared).toBe(0);
    expect(replayed?.board).toEqual(DEALT);
  });

  it("rejects clearing a blocked arrow", () => {
    expect(replayArrowMoves(DEALT, [2])).toBeUndefined();
  });

  it("rejects clearing an arrow that is not on the board", () => {
    expect(replayArrowMoves(DEALT, [1, 1])).toBeUndefined();
  });

  it("rejects an undo with nothing to undo", () => {
    expect(replayArrowMoves(DEALT, [ARROW_MOVE_UNDO])).toBeUndefined();
  });

  it("rejects any move after the last life is gone", () => {
    const outOfLives = Array.from({ length: ARROW_LIVES }, () => ARROW_MOVE_MISS);
    expect(replayArrowMoves(DEALT, outOfLives)?.lives).toBe(0);
    expect(replayArrowMoves(DEALT, [...outOfLives, 1])).toBeUndefined();
  });
});

describe("restoreArrowRun", () => {
  it("restores a run in progress with its flags and the dealt board", () => {
    const result = restoreArrowRun(
      saveWith([1, ARROW_MOVE_FREE_MISS], { unlimitedLives: true, practiceRun: true }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run.difficulty).toBe("hard");
    expect(result.run.dealt).toEqual(DEALT);
    expect(result.run.board.arrows.map((entry) => entry.id)).toEqual([2, 3]);
    expect(result.run.moves).toEqual([1, ARROW_MOVE_FREE_MISS]);
    expect(result.run.unlimitedLives).toBe(true);
    expect(result.run.practiceRun).toBe(true);
  });

  it("survives a trip through JSON, as it does through the database", () => {
    const result = restoreArrowRun(JSON.parse(JSON.stringify(saveWith([1, 2]))));
    expect(result.ok).toBe(true);
  });

  it("rejects a run that was already won", () => {
    expect(restoreArrowRun(saveWith([1, 2, 3]))).toEqual({
      ok: false,
      reason: "That run had already finished.",
    });
  });

  it("rejects a run that had run out of lives", () => {
    const outOfLives = Array.from({ length: ARROW_LIVES }, () => ARROW_MOVE_MISS);
    expect(restoreArrowRun(saveWith(outOfLives))).toMatchObject({ ok: false });
  });

  it("rejects a save from another version", () => {
    expect(restoreArrowRun(saveWith([], { version: ARROW_SAVE_VERSION + 1 }))).toEqual({
      ok: false,
      reason: "That save is from an older version of the game.",
    });
  });

  it("rejects a board whose size does not match its tier", () => {
    expect(restoreArrowRun(saveWith([], { size: SIZE - 1 }))).toMatchObject({ ok: false });
  });

  it("rejects an illegal move, an unknown move code and input that is not a save", () => {
    expect(restoreArrowRun(saveWith([2]))).toMatchObject({ ok: false });
    expect(restoreArrowRun(saveWith([-4]))).toMatchObject({ ok: false });
    expect(restoreArrowRun("not a save")).toMatchObject({ ok: false });
    expect(restoreArrowRun(undefined)).toMatchObject({ ok: false });
  });
});

describe("a generated board", () => {
  it("restores to the same position after part of its solution, in a small save", () => {
    const puzzle = generatePuzzle("hard", seededRandom(11));
    const played = puzzle.solution.slice(0, 40);

    let expected = puzzle.board;
    for (const id of played) expected = clearArrow(expected, id).board;

    const save = buildArrowSave({
      difficulty: "hard",
      dealt: puzzle.board,
      moves: played,
      unlimitedLives: false,
      practiceRun: false,
    });
    const result = restoreArrowRun(JSON.parse(JSON.stringify(save)));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run.board).toEqual(expected);
    expect(result.run.history).toHaveLength(played.length);
    // The whole point of the compact encoding: a full board stays well under 60 KB.
    expect(JSON.stringify(save).length).toBeLessThan(60_000);
  });
});
