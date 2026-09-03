import { describe, expect, it } from "vitest";
import {
  canPlace,
  clearCell,
  countSolutions,
  digitCount,
  emptyGrid,
  enterDigit,
  hasUniqueSolution,
  isSolved,
  peersOf,
  removeClues,
  renderRows,
  scoreGame,
  solvedGrid,
  startGame,
  tick,
  toggleNote,
  wrongCells,
} from "./game-sudoku";
import {
  SUDOKU_BOX,
  SUDOKU_CELL_COUNT,
  SUDOKU_DIFFICULTIES,
  SUDOKU_MIN_SCORE,
  SUDOKU_MISTAKE_PENALTY,
  SUDOKU_SETUP,
  SUDOKU_SIZE,
  SUDOKU_TIME_PENALTY,
  type SudokuDigit,
  type SudokuGrid,
  type SudokuState,
} from "./types";

/**
 * A deterministic RNG.
 *
 * A linear congruential generator rather than a replayed list of values: generating a
 * board consumes thousands of random numbers (a shuffle per cell in the fill, plus one
 * over all 81 indexes), so a fixed list would run out and degenerate into a constant —
 * which makes the shuffles no-ops and the "random" grid the same canonical one forever.
 */
function rng(seed = 1) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** A fixed RNG, for the cases where the exact board does not matter. */
const fixed = () => 0.5;

/** Every row, column and box holds 1-9 exactly once. */
function isValidSolution(grid: SudokuGrid): boolean {
  const nine = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  for (let i = 0; i < SUDOKU_SIZE; i += 1) {
    const row: number[] = [];
    const col: number[] = [];
    for (let j = 0; j < SUDOKU_SIZE; j += 1) {
      row.push(grid[i * SUDOKU_SIZE + j]);
      col.push(grid[j * SUDOKU_SIZE + i]);
    }
    if ([...row].sort((a, b) => a - b).join() !== nine.join()) return false;
    if ([...col].sort((a, b) => a - b).join() !== nine.join()) return false;
  }

  for (let boxRow = 0; boxRow < SUDOKU_SIZE; boxRow += SUDOKU_BOX) {
    for (let boxCol = 0; boxCol < SUDOKU_SIZE; boxCol += SUDOKU_BOX) {
      const box: number[] = [];
      for (let r = 0; r < SUDOKU_BOX; r += 1) {
        for (let c = 0; c < SUDOKU_BOX; c += 1) {
          box.push(grid[(boxRow + r) * SUDOKU_SIZE + (boxCol + c)]);
        }
      }
      if (box.sort((a, b) => a - b).join() !== nine.join()) return false;
    }
  }
  return true;
}

/** A state solved except for one empty cell, for exercising the winning entry. */
function oneCellLeft(random = fixed): { state: SudokuState; index: number } {
  const solution = solvedGrid(random);
  const index = 40;
  const cells = solution.map((value, at) => ({
    value: (at === index ? 0 : value) as SudokuDigit,
    given: at !== index,
    notes: [] as readonly number[],
  }));
  return {
    state: {
      difficulty: "easy",
      cells,
      solution,
      mistakes: 0,
      filled: SUDOKU_CELL_COUNT - 1,
      elapsedSeconds: 0,
      outcome: undefined,
    },
    index,
  };
}

describe("peersOf", () => {
  it("gives the 20 cells sharing a row, column or box", () => {
    // 8 in the row + 8 in the column + 4 remaining in the box, with no duplicates.
    expect(peersOf(0)).toHaveLength(20);
    expect(peersOf(40)).toHaveLength(20);
    expect(new Set(peersOf(40)).size).toBe(20);
  });

  it("never includes the cell itself", () => {
    for (let index = 0; index < SUDOKU_CELL_COUNT; index += 1) {
      expect(peersOf(index)).not.toContain(index);
    }
  });

  it("relates cells in the same box that share neither row nor column", () => {
    // Index 0 is r0c0 and index 10 is r1c1 — different row, different column, same box.
    expect(peersOf(0)).toContain(10);
  });
});

describe("canPlace", () => {
  it("refuses a digit already in the row, the column or the box", () => {
    const grid = [...emptyGrid()] as SudokuDigit[];
    grid[0] = 5;

    expect(canPlace(grid, 1, 5)).toBe(false); // same row
    expect(canPlace(grid, SUDOKU_SIZE, 5)).toBe(false); // same column
    expect(canPlace(grid, SUDOKU_SIZE + 1, 5)).toBe(false); // same box
    expect(canPlace(grid, 80, 5)).toBe(true); // unrelated corner
  });

  it("always allows clearing a cell", () => {
    const grid = [...emptyGrid()] as SudokuDigit[];
    grid[0] = 5;
    expect(canPlace(grid, 1, 0)).toBe(true);
  });
});

describe("solvedGrid", () => {
  it("produces a complete, valid grid", () => {
    const grid = solvedGrid(rng(7));
    expect(grid).toHaveLength(SUDOKU_CELL_COUNT);
    expect(grid.every((value) => value >= 1 && value <= 9)).toBe(true);
    expect(isValidSolution(grid)).toBe(true);
  });

  it("produces a different grid for a different seed", () => {
    expect(solvedGrid(rng(1)).join()).not.toBe(solvedGrid(rng(99)).join());
  });

  it("is reproducible for the same seed", () => {
    expect(solvedGrid(rng(42)).join()).toBe(solvedGrid(rng(42)).join());
  });
});

describe("countSolutions", () => {
  it("counts one for a complete grid", () => {
    expect(countSolutions(solvedGrid(rng(3)))).toBe(1);
  });

  it("stops at the limit rather than counting them all", () => {
    // An empty grid has ~6.7e21 solutions; the bound is what makes this terminate.
    expect(countSolutions(emptyGrid(), 2)).toBe(2);
  });

  it("counts zero for a grid that cannot be finished", () => {
    // Eight of the nine digits in one row, and the ninth cell blocked by its column:
    // row 0 needs a 9 at c8, but c8 already holds one further down.
    const grid = [...emptyGrid()] as SudokuDigit[];
    for (let col = 0; col < 8; col += 1) grid[col] = (col + 1) as SudokuDigit;
    grid[8 + SUDOKU_SIZE * 3] = 9;
    expect(countSolutions(grid)).toBe(0);
  });

  it("counts more than one as soon as the grid is ambiguous", () => {
    // Strips clues from a solved grid, one at a time, until it stops being unique.
    //
    // Constructing a two-solution grid by hand is harder than it looks: blanking a
    // rectangle of two crossed digits is NOT enough, because the other copies of those
    // digits still pin each corner. A genuine ambiguity needs an "unavoidable set",
    // which depends on the whole grid. Removing clues until uniqueness breaks finds one
    // without having to characterise it -- and it tests the property `removeClues`
    // actually relies on: that `countSolutions` notices the moment a puzzle goes bad.
    const solution = solvedGrid(rng(11));
    const grid = [...solution] as SudokuDigit[];

    let ambiguous = false;
    for (let index = 0; index < SUDOKU_CELL_COUNT; index += 1) {
      grid[index] = 0;
      if (countSolutions(grid, 2) > 1) {
        ambiguous = true;
        break;
      }
    }

    // A grid stripped towards empty always becomes ambiguous well before it runs out
    // of clues; never tripping would mean `countSolutions` cannot see a second answer.
    expect(ambiguous).toBe(true);
  });
});

describe("removeClues", () => {
  it("keeps the puzzle uniquely solvable", () => {
    const solution = solvedGrid(rng(5));
    const puzzle = removeClues(solution, SUDOKU_SETUP.medium.clues, rng(5));
    expect(hasUniqueSolution(puzzle)).toBe(true);
  });

  it("leaves every surviving clue agreeing with the solution", () => {
    const solution = solvedGrid(rng(8));
    const puzzle = removeClues(solution, SUDOKU_SETUP.hard.clues, rng(8));
    puzzle.forEach((value, index) => {
      if (value !== 0) expect(value).toBe(solution[index]);
    });
  });

  it("never removes more than asked", () => {
    const solution = solvedGrid(rng(9));
    const target = SUDOKU_SETUP.easy.clues;
    const puzzle = removeClues(solution, target, rng(9));
    expect(puzzle.filter((value) => value !== 0).length).toBeGreaterThanOrEqual(target);
  });
});

describe("startGame", () => {
  it.each(SUDOKU_DIFFICULTIES)("deals a solvable %s board", (difficulty) => {
    const state = startGame(difficulty, rng(4));
    const grid = state.cells.map((cell) => cell.value);

    expect(hasUniqueSolution(grid)).toBe(true);
    expect(isValidSolution(state.solution)).toBe(true);
    expect(state.outcome).toBeUndefined();
    expect(state.mistakes).toBe(0);
    expect(state.elapsedSeconds).toBe(0);
  });

  it("marks exactly the starting digits as givens", () => {
    const state = startGame("medium", rng(6));
    state.cells.forEach((cell) => {
      expect(cell.given).toBe(cell.value !== 0);
      expect(cell.notes).toEqual([]);
    });
  });

  it("leaves a harder board with fewer clues than an easier one", () => {
    const easy = startGame("easy", rng(2)).cells.filter((cell) => cell.given).length;
    const hard = startGame("hard", rng(2)).cells.filter((cell) => cell.given).length;
    expect(hard).toBeLessThan(easy);
  });
});

describe("enterDigit", () => {
  it("writes a correct digit and counts no mistake", () => {
    const { state, index } = oneCellLeft();
    const next = enterDigit(state, index, state.solution[index]);

    expect(next.cells[index].value).toBe(state.solution[index]);
    expect(next.mistakes).toBe(0);
    expect(next.filled).toBe(SUDOKU_CELL_COUNT);
  });

  it("writes a wrong digit and counts the mistake", () => {
    const { state, index } = oneCellLeft();
    const wrong = ((state.solution[index] % 9) + 1) as SudokuDigit;
    const next = enterDigit(state, index, wrong);

    // The wrong digit lands on the board rather than being refused — see the note on
    // `enterDigit` about not turning the grid into an oracle.
    expect(next.cells[index].value).toBe(wrong);
    expect(next.mistakes).toBe(1);
    expect(next.outcome).toBeUndefined();
  });

  it("does not count a second mistake for re-entering the same wrong digit", () => {
    const { state, index } = oneCellLeft();
    const wrong = ((state.solution[index] % 9) + 1) as SudokuDigit;
    const once = enterDigit(state, index, wrong);
    expect(enterDigit(once, index, wrong).mistakes).toBe(1);
  });

  it("refuses to overwrite a given", () => {
    const { state, index } = oneCellLeft();
    const given = index === 0 ? 1 : 0;
    expect(enterDigit(state, given, 5)).toBe(state);
  });

  it("solves the board when the last cell is filled correctly", () => {
    const { state, index } = oneCellLeft();
    const next = enterDigit(state, index, state.solution[index]);
    expect(next.outcome).toBe("solved");
    expect(isSolved(next)).toBe(true);
  });

  it("ignores an entry once the board is solved", () => {
    const { state, index } = oneCellLeft();
    const solved = enterDigit(state, index, state.solution[index]);
    expect(enterDigit(solved, index, 1)).toBe(solved);
  });

  it("clears the notes on the cell it writes to", () => {
    const { state, index } = oneCellLeft();
    const noted = toggleNote(state, index, 3);
    expect(noted.cells[index].notes).toEqual([3]);
    expect(enterDigit(noted, index, state.solution[index]).cells[index].notes).toEqual([]);
  });

  it("does not mutate the state it was given", () => {
    const { state, index } = oneCellLeft();
    enterDigit(state, index, 5);
    expect(state.cells[index].value).toBe(0);
    expect(state.mistakes).toBe(0);
  });
});

describe("clearCell", () => {
  it("empties a filled cell", () => {
    const { state, index } = oneCellLeft();
    const wrong = ((state.solution[index] % 9) + 1) as SudokuDigit;
    const filled = enterDigit(state, index, wrong);
    expect(clearCell(filled, index).cells[index].value).toBe(0);
  });

  it("refuses to empty a given", () => {
    const { state, index } = oneCellLeft();
    const given = index === 0 ? 1 : 0;
    expect(clearCell(state, given)).toBe(state);
  });
});

describe("toggleNote", () => {
  it("adds and removes a note, keeping them sorted", () => {
    const { state, index } = oneCellLeft();
    const added = toggleNote(toggleNote(state, index, 7), index, 2);
    expect(added.cells[index].notes).toEqual([2, 7]);
    expect(toggleNote(added, index, 7).cells[index].notes).toEqual([2]);
  });

  it("refuses a note on a given or on a cell holding a digit", () => {
    const { state, index } = oneCellLeft();
    const given = index === 0 ? 1 : 0;
    expect(toggleNote(state, given, 4)).toBe(state);

    const filled = enterDigit(state, index, state.solution[index]);
    expect(toggleNote(filled, index, 4)).toBe(filled);
  });
});

describe("tick", () => {
  it("advances the clock by a second", () => {
    const { state } = oneCellLeft();
    expect(tick(tick(state)).elapsedSeconds).toBe(2);
  });

  it("stops once the board is solved", () => {
    const { state, index } = oneCellLeft();
    const solved = enterDigit(state, index, state.solution[index]);
    expect(tick(solved)).toBe(solved);
  });
});

describe("wrongCells and digitCount", () => {
  it("reports the cells that disagree with the solution", () => {
    const { state, index } = oneCellLeft();
    expect(wrongCells(state)).toEqual([]);

    const wrong = ((state.solution[index] % 9) + 1) as SudokuDigit;
    expect(wrongCells(enterDigit(state, index, wrong))).toEqual([index]);
  });

  it("counts a digit across the board, wrong entries included", () => {
    const { state, index } = oneCellLeft();
    const digit = state.solution[index];
    // Eight of this digit are on the board as givens; the ninth is the empty cell.
    expect(digitCount(state, digit)).toBe(8);
    expect(digitCount(enterDigit(state, index, digit), digit)).toBe(9);
  });
});

describe("scoreGame", () => {
  it("scores nothing for a board that was never solved", () => {
    const { state } = oneCellLeft();
    expect(scoreGame(state)).toBe(0);
    expect(scoreGame({ ...state, elapsedSeconds: 30 })).toBe(0);
  });

  it("pays the difficulty base for an instant solve", () => {
    const { state, index } = oneCellLeft();
    const solved = enterDigit(state, index, state.solution[index]);
    expect(scoreGame(solved)).toBe(SUDOKU_SETUP.easy.base);
  });

  it("decays with time and with mistakes", () => {
    const { state, index } = oneCellLeft();
    const solved = enterDigit(state, index, state.solution[index]);
    const slow = { ...solved, elapsedSeconds: 60, mistakes: 2 };

    expect(scoreGame(slow)).toBe(
      SUDOKU_SETUP.easy.base - 60 * SUDOKU_TIME_PENALTY - 2 * SUDOKU_MISTAKE_PENALTY,
    );
    // Faster is always worth more — the whole reason this game scores points and not
    // seconds, since the shared board ranks `score DESC`.
    expect(scoreGame(slow)).toBeLessThan(scoreGame(solved));
  });

  it("never drops below the floor, however long the grind", () => {
    const { state, index } = oneCellLeft();
    const solved = enterDigit(state, index, state.solution[index]);
    expect(scoreGame({ ...solved, elapsedSeconds: 100_000, mistakes: 500 })).toBe(
      SUDOKU_MIN_SCORE,
    );
  });

  it("pays a hard board more than an easy one for the same run", () => {
    const { state, index } = oneCellLeft();
    const solved = enterDigit(state, index, state.solution[index]);
    const hard = { ...solved, difficulty: "hard" as const, elapsedSeconds: 300 };
    const easy = { ...solved, elapsedSeconds: 300 };
    expect(scoreGame(hard)).toBeGreaterThan(scoreGame(easy));
  });
});

describe("renderRows", () => {
  it("splits the grid into nine rows of nine", () => {
    const state = startGame("easy", rng(12));
    const rows = renderRows(state);

    expect(rows).toHaveLength(SUDOKU_SIZE);
    expect(rows.every((row) => row.length === SUDOKU_SIZE)).toBe(true);
    expect(rows[0][0]).toBe(state.cells[0]);
    expect(rows[8][8]).toBe(state.cells[SUDOKU_CELL_COUNT - 1]);
  });
});
