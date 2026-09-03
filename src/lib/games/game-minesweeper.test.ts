import { describe, expect, it } from "vitest";
import {
  canChord,
  chord,
  isCleared,
  layMines,
  minesRemaining,
  neighboursOf,
  renderRows,
  reveal,
  scoreGame,
  startGame,
  tick,
  toggleFlag,
} from "./game-minesweeper";
import {
  MINESWEEPER_DIFFICULTIES,
  MINESWEEPER_MIN_SCORE,
  MINESWEEPER_SETUP,
  MINESWEEPER_TIME_PENALTY,
  type MinesweeperState,
} from "./types";

/**
 * A deterministic RNG.
 *
 * A linear congruential generator rather than a replayed list, for the reason
 * `game-sudoku.test.ts` gives: laying 99 mines by rejection sampling consumes an
 * unbounded number of draws, so a fixed list would run out and degenerate into a
 * constant — which makes `layMines` spin forever on an already-taken cell.
 */
function rng(seed = 1) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/**
 * A hand-built board from a picture, so a test can say where the mines are.
 *
 * `*` is a mine, `.` is safe. Rows are equal-length strings. The adjacent counts are
 * derived here rather than written out, so a test can move a mine without also having
 * to keep eight numbers consistent by hand.
 */
function board(picture: readonly string[]): MinesweeperState {
  const rows = picture.length;
  const cols = picture[0].length;
  const mine = picture.flatMap((row) => [...row].map((char) => char === "*"));

  const cells = mine.map((isMine, index) => ({
    mine: isMine,
    revealed: false,
    flagged: false,
    adjacent: neighboursOf(index, cols, rows).filter((n) => mine[n]).length,
  }));

  return {
    difficulty: "beginner",
    cols,
    rows,
    mines: mine.filter(Boolean).length,
    cells,
    mined: true,
    revealed: 0,
    flags: 0,
    elapsedSeconds: 0,
    outcome: undefined,
  };
}

/** Reveals every safe cell, so a test can reach a win without scripting the clicks. */
function clearEverySafeCell(state: MinesweeperState): MinesweeperState {
  let next = state;
  next.cells.forEach((cell, index) => {
    if (!cell.mine) next = reveal(next, index, rng());
  });
  return next;
}

describe("neighboursOf", () => {
  it("gives eight neighbours in the middle, five on an edge, three in a corner", () => {
    // 12 is the centre of a 5x5; 10 is row 2 column 0, which is an edge, not a middle.
    expect(neighboursOf(12, 5, 5)).toHaveLength(8);
    expect(neighboursOf(10, 5, 5)).toHaveLength(5);
    expect([...neighboursOf(0, 5, 5)].sort((a, b) => a - b)).toEqual([1, 5, 6]);
    expect([...neighboursOf(24, 5, 5)].sort((a, b) => a - b)).toEqual([18, 19, 23]);
  });

  it("does not wrap around the end of a row", () => {
    // Cell 4 is the last of row 0 on a 5-wide board. Cell 5 is the first of row 1 and
    // is NOT adjacent to it, however close the flat indexes look.
    expect(neighboursOf(4, 5, 5)).not.toContain(5);
    expect([...neighboursOf(4, 5, 5)].sort((a, b) => a - b)).toEqual([3, 8, 9]);
  });
});

describe("startGame", () => {
  it("builds an unmined board of the right shape for every difficulty", () => {
    for (const difficulty of MINESWEEPER_DIFFICULTIES) {
      const setup = MINESWEEPER_SETUP[difficulty];
      const state = startGame(difficulty);

      expect(state.cells).toHaveLength(setup.cols * setup.rows);
      expect(state.mines).toBe(setup.mines);
      expect(state.mined).toBe(false);
      expect(state.cells.every((cell) => !cell.mine && !cell.revealed)).toBe(true);
    }
  });

  it("leaves every board with more free cells than mines", () => {
    // The guarantee `layMines` relies on to terminate: rejection sampling cannot fill
    // a board that does not have room for the mines plus the nine reserved cells.
    for (const difficulty of MINESWEEPER_DIFFICULTIES) {
      const { cols, rows, mines } = MINESWEEPER_SETUP[difficulty];
      expect(cols * rows - 9).toBeGreaterThan(mines);
    }
  });
});

describe("layMines", () => {
  it("lays exactly the right number of mines", () => {
    const state = layMines(startGame("expert"), 0, rng());
    expect(state.cells.filter((cell) => cell.mine)).toHaveLength(
      MINESWEEPER_SETUP.expert.mines,
    );
    expect(state.mined).toBe(true);
  });

  it("keeps the first cell and its whole neighbourhood clear", () => {
    // Repeated across seeds: one clear board could be luck, and this is the guarantee
    // the whole "first click is safe" promise rests on.
    for (let seed = 1; seed <= 25; seed += 1) {
      const fresh = startGame("intermediate");
      const safe = 5 * fresh.cols + 7;
      const state = layMines(fresh, safe, rng(seed));

      expect(state.cells[safe].mine).toBe(false);
      for (const neighbour of neighboursOf(safe, state.cols, state.rows)) {
        expect(state.cells[neighbour].mine).toBe(false);
      }
    }
  });

  it("counts each cell's adjacent mines", () => {
    const state = layMines(startGame("beginner"), 40, rng(7));

    state.cells.forEach((cell, index) => {
      const actual = neighboursOf(index, state.cols, state.rows).filter(
        (n) => state.cells[n].mine,
      ).length;
      expect(cell.adjacent).toBe(actual);
    });
  });

  it("stays inside the board when the RNG returns 1", () => {
    // `Math.floor(1 * total)` is one past the last cell. A guard skips it rather than
    // clamping, so this must still lay a full board and not index off the end.
    const draws = [1, 1, 0.5, 0.1, 0.9, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6, 0.05, 0.95];
    let at = 0;
    const state = layMines(startGame("beginner"), 0, () => draws[at++ % draws.length]);

    expect(state.cells.filter((cell) => cell.mine)).toHaveLength(10);
    expect(state.cells).toHaveLength(81);
  });
});

describe("reveal", () => {
  it("lays the mines on the first click and never blows up on it", () => {
    // Every cell of a beginner board, as the opening move. If the safe-first-click
    // rule were wrong, some of these would end the run instantly.
    for (let index = 0; index < 81; index += 1) {
      const state = reveal(startGame("beginner"), index, rng(index + 1));
      expect(state.mined).toBe(true);
      expect(state.outcome).toBeUndefined();
      expect(state.cells[index].revealed).toBe(true);
    }
  });

  it("cascades through a blank region and stops at the numbers", () => {
    //  . . . . *
    //  . . . . .
    //  * . . . .
    const state = reveal(board([".....", "....*", ".....", "*...."]), 0, rng());

    // The corner is blank, so the fill runs — and every cell it stopped on shows a
    // number, which is what "the boundary is the numbered cells" means.
    expect(state.revealed).toBeGreaterThan(1);
    expect(state.cells.filter((cell) => cell.revealed).every((cell) => !cell.mine)).toBe(true);
    // The two mines are still covered; a cascade never uncovers one.
    expect(state.cells.filter((cell) => cell.mine).every((cell) => !cell.revealed)).toBe(true);
  });

  it("reveals only the one cell when it has a neighbouring mine", () => {
    const state = reveal(board(["*..", "...", "..."]), 1, rng());
    expect(state.revealed).toBe(1);
    expect(state.cells[1].adjacent).toBe(1);
  });

  it("ends the run and uncovers every mine when one is hit", () => {
    const start = board(["*..", "...", "..*"]);
    const state = reveal(start, 0, rng());

    expect(state.outcome).toBe("hit-mine");
    expect(state.cells.filter((cell) => cell.mine).every((cell) => cell.revealed)).toBe(true);
  });

  it("refuses a flagged cell, so a misclick cannot end the run", () => {
    const flagged = toggleFlag(board(["*..", "...", "..."]), 0);
    const state = reveal(flagged, 0, rng());

    expect(state.outcome).toBeUndefined();
    expect(state.cells[0].revealed).toBe(false);
  });

  it("refuses an already-revealed cell and a finished game", () => {
    const once = reveal(board(["*..", "...", "..."]), 8, rng());
    expect(reveal(once, 8, rng())).toBe(once);

    const lost = reveal(board(["*..", "...", "..."]), 0, rng());
    expect(reveal(lost, 5, rng())).toBe(lost);
  });

  it("wins when the last safe cell is uncovered", () => {
    const state = clearEverySafeCell(board(["*..", "...", "..*"]));

    expect(state.outcome).toBe("cleared");
    expect(isCleared(state)).toBe(true);
    expect(state.revealed).toBe(7);
  });

  it("does not mutate the state it was given", () => {
    const start = board(["...", "...", "..."]);
    reveal(start, 0, rng());

    expect(start.revealed).toBe(0);
    expect(start.cells.every((cell) => !cell.revealed)).toBe(true);
  });
});

describe("toggleFlag", () => {
  it("plants and lifts a flag, tracking the count", () => {
    const start = board(["*..", "...", "..."]);
    const flagged = toggleFlag(start, 0);
    expect(flagged.cells[0].flagged).toBe(true);
    expect(minesRemaining(flagged)).toBe(0);

    const lifted = toggleFlag(flagged, 0);
    expect(lifted.cells[0].flagged).toBe(false);
    expect(lifted.flags).toBe(0);
  });

  it("refuses a revealed cell", () => {
    const revealed = reveal(board(["*..", "...", "..."]), 8, rng());
    expect(toggleFlag(revealed, 8)).toBe(revealed);
  });

  it("lets the remaining count go negative rather than capping the flags", () => {
    let state = board(["*..", "...", "..."]);
    state = toggleFlag(state, 1);
    state = toggleFlag(state, 2);

    expect(state.flags).toBe(2);
    expect(minesRemaining(state)).toBe(-1);
  });
});

describe("chord", () => {
  it("clears the un-flagged neighbours of a satisfied number", () => {
    //  * . .
    //  . . .
    //  . . .
    // Reveal cell 1 (shows 1), flag the mine, then chord.
    let state = reveal(board(["*..", "...", "..."]), 1, rng());
    state = toggleFlag(state, 0);

    expect(canChord(state, 1)).toBe(true);
    const chorded = chord(state, 1, rng());

    expect(chorded.cells[2].revealed).toBe(true);
    expect(chorded.cells[4].revealed).toBe(true);
    // The flag is honoured — the chord did not uncover the cell under it.
    expect(chorded.cells[0].revealed).toBe(false);
  });

  it("does nothing when the flags do not match the number", () => {
    const state = reveal(board(["*..", "...", "..."]), 1, rng());

    expect(canChord(state, 1)).toBe(false);
    expect(chord(state, 1, rng())).toBe(state);
  });

  it("hits the mine when a flag is in the wrong place", () => {
    // The number is satisfied by count, but the flag is on a safe cell — so chording
    // uncovers the real mine. Deliberately not protected against.
    let state = reveal(board(["*..", "...", "..."]), 1, rng());
    state = toggleFlag(state, 2);

    expect(canChord(state, 1)).toBe(true);
    expect(chord(state, 1, rng()).outcome).toBe("hit-mine");
  });

  it("refuses a covered cell, a blank one, and a finished game", () => {
    const covered = board(["*..", "...", "..."]);
    expect(chord(covered, 1, rng())).toBe(covered);

    // A revealed blank has nothing to chord against: its region is already cleared.
    const blank = reveal(board([".....", ".....", "....*"]), 0, rng());
    expect(canChord(blank, 0)).toBe(false);
    expect(chord(blank, 0, rng())).toBe(blank);

    const lost = reveal(board(["*..", "...", "..."]), 0, rng());
    expect(chord(lost, 4, rng())).toBe(lost);
  });

  it("reports no chord available when every neighbour is already dealt with", () => {
    let state = reveal(board(["*..", "...", "..."]), 1, rng());
    state = toggleFlag(state, 0);
    const chorded = chord(state, 1, rng());

    // The move has been made; offering it again would be a no-op the view should not
    // advertise.
    expect(canChord(chorded, 1)).toBe(false);
  });
});

describe("isCleared", () => {
  it("is false on a board that has not been played", () => {
    expect(isCleared(startGame("beginner"))).toBe(false);
  });

  it("is false when only the mines are flagged", () => {
    // Flagging is not winning: the safe cells are what has to be uncovered.
    const state = toggleFlag(board(["*..", "...", "..."]), 0);
    expect(isCleared(state)).toBe(false);
  });
});

describe("tick", () => {
  it("does not run before the first click", () => {
    const fresh = startGame("beginner");
    expect(tick(fresh)).toBe(fresh);
  });

  it("advances a live board and stops on a finished one", () => {
    // A wall of mines across the middle, so revealing the top-left cascades only
    // through the top band and leaves the bottom one covered — the run is still going.
    // A sparse board is no good here: on anything with a few scattered mines the first
    // reveal cascades over the whole grid and wins, which is a finished game.
    const live = reveal(board([".....", "*****", "....."]), 0, rng());
    expect(live.outcome).toBeUndefined();
    expect(tick(live).elapsedSeconds).toBe(1);

    const lost = reveal(board(["*..", "...", "..."]), 0, rng());
    expect(tick(lost)).toBe(lost);
  });
});

describe("scoreGame", () => {
  it("scores nothing for an unfinished or lost board", () => {
    expect(scoreGame(startGame("beginner"))).toBe(0);
    expect(scoreGame(reveal(board(["*..", "...", "..."]), 0, rng()))).toBe(0);
  });

  it("decays the difficulty base by the time taken", () => {
    const cleared = clearEverySafeCell(board(["*..", "...", "..*"]));
    const after = { ...cleared, elapsedSeconds: 30 };

    expect(scoreGame({ ...cleared, elapsedSeconds: 0 })).toBe(MINESWEEPER_SETUP.beginner.base);
    expect(scoreGame(after)).toBe(
      MINESWEEPER_SETUP.beginner.base - 30 * MINESWEEPER_TIME_PENALTY,
    );
  });

  it("never drops a clear below the floor, however long it took", () => {
    const cleared = clearEverySafeCell(board(["*..", "...", "..*"]));
    expect(scoreGame({ ...cleared, elapsedSeconds: 100_000 })).toBe(MINESWEEPER_MIN_SCORE);
  });

  it("ranks a slow hard board above a fast easy one", () => {
    // The ladder has to be worth climbing — the same property Sudoku's bases have.
    const expertSlow = MINESWEEPER_SETUP.expert.base - 300 * MINESWEEPER_TIME_PENALTY;
    const beginnerFast = MINESWEEPER_SETUP.beginner.base;
    expect(expertSlow).toBeGreaterThan(beginnerFast);
  });
});

describe("renderRows", () => {
  it("splits the board into rows of the right width", () => {
    const rows = renderRows(startGame("expert"));
    expect(rows).toHaveLength(MINESWEEPER_SETUP.expert.rows);
    expect(rows[0]).toHaveLength(MINESWEEPER_SETUP.expert.cols);
  });
});
