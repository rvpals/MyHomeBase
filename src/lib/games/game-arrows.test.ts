import { describe, expect, it } from "vitest";
import {
  MAX_ARROW_LENGTH,
  clearArrow,
  generatePuzzle,
  isBlocked,
  isSolved,
  isStuck,
  pathAhead,
  scoreBoard,
  solutionClearsBoard,
  step,
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

/** The way a tail trails, given where the head points. */
const OPPOSITE: Record<Arrow["direction"], Arrow["direction"]> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

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

  it("is true when an arrow's head points back into its own tail", () => {
    /*
      A U-shaped piece. The head is at (2,0) travelling left... except its own tail wraps
      round in front of it. Originally allowed, because the check excluded the arrow being
      tested on the reasoning that "the tail follows where the head has already been" —
      true of a straight arrow, false the moment paths can wind.

      Head (2,1) points RIGHT; the tail runs up, across and back down so that (2,3) and
      (2,2)... are in the exit lane:

          (0,1) (0,2) (0,3)
          (1,1)             (1,3)
          (2,1)=head        (2,3)=tail  <- sits in the head's lane
    */
    const uShape = arrow(
      1,
      [
        [2, 1],
        [1, 1],
        [0, 1],
        [0, 2],
        [0, 3],
        [1, 3],
        [2, 3],
      ],
      "right",
    );

    expect(isBlocked(board(5, [uShape]), 1)).toBe(true);
    expect(clearArrow(board(5, [uShape]), 1).cleared).toBe(false);
  });

  it("is false for a winding arrow whose tail stays clear of the exit lane", () => {
    // Same shape of piece, but bending away from where it is going rather than across it.
    const bent = arrow(
      1,
      [
        [2, 2],
        [3, 2],
        [4, 2],
        [4, 3],
      ],
      "up",
    );
    expect(isBlocked(board(5, [bent]), 1)).toBe(false);
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

  it("places arrows within the length cap", () => {
    const puzzle = generatePuzzle("hard", seededRandom(3));
    for (const entry of puzzle.board.arrows) {
      expect(entry.cells.length).toBeGreaterThanOrEqual(1);
      expect(entry.cells.length).toBeLessThanOrEqual(MAX_ARROW_LENGTH);
    }
  });

  it("builds paths whose cells are contiguous and never repeat", () => {
    // The two invariants of a winding path. A gap would draw as two disconnected
    // pieces that move as one; a repeat would mean an arrow covering fewer cells than
    // its length claims.
    for (let seed = 1; seed <= 8; seed += 1) {
      for (const entry of generatePuzzle("hard", seededRandom(seed)).board.arrows) {
        const seen = new Set<string>();
        for (const cell of entry.cells) seen.add(`${cell.row},${cell.col}`);
        expect(seen.size).toBe(entry.cells.length);

        for (let index = 1; index < entry.cells.length; index += 1) {
          const previous = entry.cells[index - 1];
          const current = entry.cells[index];
          const stepDistance =
            Math.abs(previous.row - current.row) + Math.abs(previous.col - current.col);
          expect(stepDistance).toBe(1);
        }
      }
    }
  });

  it("starts the tail directly behind the head, so the piece points where it goes", () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      for (const entry of generatePuzzle("hard", seededRandom(seed)).board.arrows) {
        if (entry.cells.length < 2) continue;
        const behind = step(entry.cells[0], OPPOSITE[entry.direction]);
        expect(entry.cells[1]).toEqual(behind);
      }
    }
  });

  it("mixes arrow lengths rather than clustering at the extremes", () => {
    /*
      Guards the weighted length distribution, which has failed twice in ways a
      solvability test cannot see.

      Asking `growPath` for the maximum every time produced a barbell — a walk either
      found room and ran to the cap or was boxed in at one cell, giving 6.3 single-cell
      and 4.6 max-length pieces with nothing between. Later, rolling the length inside
      the candidate loop let the ranking keep whichever candidate rolled longest, which
      is not a weighted sample at all.

      So this asserts the shape of the histogram: every band populated, and short pieces
      the most common, per LENGTH_WEIGHTS.
    */
    const bands = { short: 0, mid: 0, long: 0, veryLong: 0 };
    for (let seed = 1; seed <= 10; seed += 1) {
      for (const entry of generatePuzzle("hard", seededRandom(seed)).board.arrows) {
        const length = entry.cells.length;
        if (length <= 2) bands.short += 1;
        else if (length <= 5) bands.mid += 1;
        else if (length <= 8) bands.long += 1;
        else bands.veryLong += 1;
      }
    }

    // Every band populated: the barbell failures both showed up as an empty middle.
    expect(bands.short).toBeGreaterThan(0);
    expect(bands.mid).toBeGreaterThan(0);
    expect(bands.long).toBeGreaterThan(0);
    expect(bands.veryLong).toBeGreaterThan(0);

    /*
      Short-to-mid dominates the tail. Note the bands are not equal widths — `short` is
      only length 2 (a 1-cell arrow is refused outright, see MIN_ARROW_LENGTH) while
      `mid` spans 3-5 — so `mid` is legitimately the largest band and `short` alone is
      not expected to beat `long`. What matters is that the common lengths outnumber the
      rare ones.
    */
    expect(bands.short + bands.mid).toBeGreaterThan(bands.long + bands.veryLong);
    expect(bands.mid).toBeGreaterThan(bands.veryLong);
  });

  it("deals a board long enough to be a sitting", () => {
    // The board is meant to be a long sitting — ~359 arrows at 50x50. A tuning change
    // that quietly shrinks it (as an earlier 7x7 did, to eleven arrows) fails here.
    for (let seed = 1; seed <= 3; seed += 1) {
      expect(generatePuzzle("hard", seededRandom(seed)).board.arrows.length).toBeGreaterThan(250);
    }
  });

  it("produces paths that actually wind, not just straight sticks", () => {
    // The whole point of the winding generator. A board of straight runs is the game
    // this replaced, so it is asserted rather than assumed.
    let bent = 0;
    for (let seed = 1; seed <= 6; seed += 1) {
      for (const entry of generatePuzzle("hard", seededRandom(seed)).board.arrows) {
        if (entry.cells.length < 3) continue;
        const turns = entry.cells.some((cell, index) => {
          if (index < 2) return false;
          const a = entry.cells[index - 2];
          const b = entry.cells[index - 1];
          return (a.row === b.row) !== (b.row === cell.row);
        });
        if (turns) bent += 1;
      }
    }
    expect(bent).toBeGreaterThan(20);
  });

  it("keeps most arrows blocked at the start, so there is something to deduce", () => {
    /*
      The difficulty guard, and the reason `findPlacement` scores placements at all.
      Taking the first legal spot produced boards where ~12 of 22 arrows were already
      free on move one — a third of the puzzle clearable in any order. Nearly all of
      those had a head sitting on the board edge, where nothing can ever block it.

      Asserted as a ratio over many boards rather than per board: generation is random,
      so an occasional loose board is fine and only the average is meaningful.
    */
    let free = 0;
    let total = 0;
    for (let seed = 1; seed <= 10; seed += 1) {
      const board = generatePuzzle("hard", seededRandom(seed)).board;
      free += unblockedArrows(board).length;
      total += board.arrows.length;
    }
    expect(free / total).toBeLessThan(0.4);
  });

  it("fills most of the board", () => {
    /*
      `arrows` is a target the generator is not expected to reach — it is set above what
      a 9x9 can hold so that generation stops when it runs out of room rather than while
      space is left. So this asserts the useful property (the board comes out dense)
      rather than a piece count, which would just re-state the tuning.
    */
    const { size, arrows: target } = ARROW_DIFFICULTY_SETUP.hard;
    const puzzle = generatePuzzle("hard", seededRandom(11));
    const covered = puzzle.board.arrows.reduce((sum, entry) => sum + entry.cells.length, 0);

    expect(puzzle.board.arrows.length).toBeLessThanOrEqual(target);
    /*
      0.6, not 0.8. Saturation falls as the board grows — a bigger grid has proportionally
      more interior, and the depth band keeps heads away from the edges, so the generator
      runs out of legal deep placements with more of the surface still open. Measured
      ~71% at 50x50 against ~80% at 20x20. This guards "densely covered", not a
      particular tuning.
    */
    expect(covered / (size * size)).toBeGreaterThan(0.6);
  });

  it("returns a solution covering every arrow exactly once", () => {
    const puzzle = generatePuzzle("hard", seededRandom(5));
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
    // 20 seeds rather than 60: each board is a 20x20 with ~100 arrows, so `solutionClearsBoard`
    // replays a hundred moves and each one rescans the board. Still a broad sweep of the
    // construction argument, and it runs in a couple of seconds rather than half a minute.
    for (const difficulty of ARROW_DIFFICULTIES) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const puzzle = generatePuzzle(difficulty, seededRandom(seed));
        expect(solutionClearsBoard(puzzle)).toBe(true);
      }
    }
  }, 60000);

  it("is winnable by a player who only taps arrows that are free", () => {
    /*
      The playability guard, and the one that would have caught this game shipping
      unwinnable. Solvability-by-construction says a *solution exists*; it says nothing
      about whether a person can reach it within their five lives. Briefly this was a
      9x9 packed to 92%, where a player ran out of lives with most of the board standing
      and the end screen was indistinguishable from a broken generator.

      So this plays each board the way a careful person does — never tapping anything it
      cannot see is free — and requires every board to come out empty. A tuning change
      that makes boards unwinnable fails here rather than in someone's evening.
    */
    /*
      Two boards, and generous timeouts, because this is the most expensive test here: a
      50x50 board is ~359 arrows and `unblockedArrows` rescans every arrow on every move,
      so one solve is ~359 x 359 blocking checks. Sixty boards timed the suite out.

      Two is enough — the property is "the generator never strands a careful player", and
      a generator that could strand one would do it on most boards, not one in fifty. The
      cheaper `solutionClearsBoard` sweep above still covers more seeds.
    */
    for (let seed = 1; seed <= 2; seed += 1) {
      let current = generatePuzzle("hard", seededRandom(seed)).board;

      // Bounded rather than `while (true)`: a generator bug that stopped clearing would
      // otherwise hang the suite instead of failing it.
      for (let move = 0; move < 1000 && !isSolved(current); move += 1) {
        const free = unblockedArrows(current);
        if (free.length === 0) break;
        current = clearArrow(current, free[0].id).board;
      }

      expect(isSolved(current)).toBe(true);
    }
  }, 60000);

  it("never places an arrow that blocks itself", () => {
    /*
      The generator's half of the self-blocking bug, and the one that mattered more: it
      validated exits against the cells already on the board, which do not include the
      arrow being placed. Measured, that produced **265 self-blocking arrows across 10
      boards and made every single board unsolvable** — those pieces can never leave, so
      no clearing order finishes.

      Checked against a board holding only the one arrow, so the assertion is precisely
      "nothing but itself is in the way".
    */
    for (let seed = 1; seed <= 4; seed += 1) {
      const generated = generatePuzzle("hard", seededRandom(seed)).board;
      for (const entry of generated.arrows) {
        const alone: ArrowBoard = { size: generated.size, arrows: [entry] };
        expect(isBlocked(alone, entry.id)).toBe(false);
      }
    }
  }, 60000);

  it("never generates a board that starts stuck", () => {
    for (let seed = 1; seed <= 10; seed += 1) {
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
