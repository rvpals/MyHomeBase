import {
  SUDOKU_BOX,
  SUDOKU_CELL_COUNT,
  SUDOKU_MIN_SCORE,
  SUDOKU_MISTAKE_PENALTY,
  SUDOKU_SETUP,
  SUDOKU_SIZE,
  SUDOKU_TIME_PENALTY,
  type SudokuCell,
  type SudokuDifficulty,
  type SudokuDigit,
  type SudokuGrid,
  type SudokuState,
} from "./types";

/**
 * The rules of Sudoku, as pure functions over an immutable `SudokuState`.
 *
 * Nothing here touches React, the DOM, a timer or `Math.random` directly — the RNG
 * arrives as an argument, exactly as in `game-2048.ts` and `game-tetris.ts`, and the
 * clock arrives as `elapsedSeconds` on the state. That is what lets a test generate a
 * reproducible board and score a "twelve minute" solve without waiting twelve minutes.
 *
 * Every exported function returns a NEW state and never mutates its argument, so the
 * view can hold one in `useState` and React sees each entry as a change.
 */

/** A source of randomness in [0, 1). `Math.random` in the app; a stub in tests. */
export type Random = () => number;

/** The nine digits, as the literal type the grid stores. */
const DIGITS: readonly SudokuDigit[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Row and column of a cell, by flat index. Pure arithmetic, no allocation. */
function rowOf(index: number): number {
  return Math.floor(index / SUDOKU_SIZE);
}

function colOf(index: number): number {
  return index % SUDOKU_SIZE;
}

/**
 * The peers of a cell: every other cell sharing its row, column or box.
 *
 * Precomputed once for all 81 cells rather than derived per check. The solver asks
 * "may this digit go here" a great many times while removing clues, and that question
 * is 20 array reads against this table instead of three nested loops.
 */
const PEERS: readonly (readonly number[])[] = buildPeers();

function buildPeers(): readonly (readonly number[])[] {
  const peers: number[][] = [];
  for (let index = 0; index < SUDOKU_CELL_COUNT; index += 1) {
    const row = rowOf(index);
    const col = colOf(index);
    const boxRow = Math.floor(row / SUDOKU_BOX) * SUDOKU_BOX;
    const boxCol = Math.floor(col / SUDOKU_BOX) * SUDOKU_BOX;
    const set = new Set<number>();

    for (let i = 0; i < SUDOKU_SIZE; i += 1) {
      set.add(row * SUDOKU_SIZE + i);
      set.add(i * SUDOKU_SIZE + col);
    }
    for (let r = 0; r < SUDOKU_BOX; r += 1) {
      for (let c = 0; c < SUDOKU_BOX; c += 1) {
        set.add((boxRow + r) * SUDOKU_SIZE + (boxCol + c));
      }
    }
    set.delete(index);
    peers.push([...set]);
  }
  return peers;
}

/** The peers of `index` — exported so the view can highlight a cell's row, column and box. */
export function peersOf(index: number): readonly number[] {
  return PEERS[index] ?? [];
}

/** Whether `digit` may be written at `index` without clashing with a peer. */
export function canPlace(grid: SudokuGrid, index: number, digit: SudokuDigit): boolean {
  if (digit === 0) return true;
  for (const peer of PEERS[index]) {
    if (grid[peer] === digit) return false;
  }
  return true;
}

/** An all-zero grid — 81 empty cells. */
export function emptyGrid(): SudokuGrid {
  return new Array<SudokuDigit>(SUDOKU_CELL_COUNT).fill(0);
}

/** A copy of `values` in a shuffled order. Fisher-Yates, driven by the supplied RNG. */
function shuffled<T>(values: readonly T[], random: Random): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Fills an empty grid with a complete, valid solution.
 *
 * Straight backtracking over cells in order, trying digits in a shuffled order so the
 * result is a different grid each time rather than the same canonical one. It always
 * succeeds — a 9x9 has an astronomical number of solutions — so the boolean is the
 * recursion's own bookkeeping, not a failure this module expects to surface.
 */
function fillSolution(grid: SudokuDigit[], index: number, random: Random): boolean {
  if (index >= SUDOKU_CELL_COUNT) return true;

  for (const digit of shuffled(DIGITS, random)) {
    if (!canPlace(grid, index, digit)) continue;
    grid[index] = digit;
    if (fillSolution(grid, index + 1, random)) return true;
    grid[index] = 0;
  }
  return false;
}

/** A complete, randomly generated solved grid. */
export function solvedGrid(random: Random): SudokuGrid {
  const grid = new Array<SudokuDigit>(SUDOKU_CELL_COUNT).fill(0) as SudokuDigit[];
  fillSolution(grid, 0, random);
  return grid;
}

/**
 * How many solutions `grid` has, counting no further than `limit`.
 *
 * Bounded on purpose: the only question ever asked is "is this still exactly one",
 * and a puzzle with a hole in it can have very many. Passing `limit = 2` makes the
 * answer "1" or "2 or more" and returns the moment a second is found.
 *
 * Picks the most-constrained empty cell rather than the next one in order. On a board
 * stripped to ~26 clues, cell-order backtracking explores an enormous tree; choosing
 * the cell with fewest candidates prunes it hard and is what keeps generation fast —
 * the same lesson as `OccupancyGrid` in `game-arrows.ts`, where a 50x50 board went
 * from 16s to 41ms.
 */
export function countSolutions(grid: SudokuGrid, limit = 2): number {
  const working = [...grid] as SudokuDigit[];
  return count(working, limit);
}

function count(grid: SudokuDigit[], limit: number): number {
  let target = -1;
  let best: SudokuDigit[] = [];

  for (let index = 0; index < SUDOKU_CELL_COUNT; index += 1) {
    if (grid[index] !== 0) continue;
    const candidates = DIGITS.filter((digit) => canPlace(grid, index, digit));
    // A cell with no candidate makes the whole branch dead — stop, do not recurse.
    if (candidates.length === 0) return 0;
    if (target === -1 || candidates.length < best.length) {
      target = index;
      best = candidates;
      // One candidate is the best possible; no cell can beat it, so stop looking.
      if (candidates.length === 1) break;
    }
  }

  // No empty cell left: the grid is filled, and this branch is one solution.
  if (target === -1) return 1;

  let found = 0;
  for (const digit of best) {
    grid[target] = digit;
    found += count(grid, limit - found);
    grid[target] = 0;
    if (found >= limit) return found;
  }
  return found;
}

/** Whether `grid` is a proper puzzle: exactly one way to finish it. */
export function hasUniqueSolution(grid: SudokuGrid): boolean {
  return countSolutions(grid, 2) === 1;
}

/**
 * Removes clues from a solved grid down towards `clues`, keeping it uniquely solvable.
 *
 * Walks the cells in a random order and takes each digit out only if the puzzle still
 * has exactly one solution, putting it straight back when it does not. It therefore
 * may stop above the target on a stubborn grid — see `SUDOKU_SETUP.clues`, which
 * documents that as a target rather than a guarantee. Undershooting costs a slightly
 * easier board; producing an ambiguous puzzle would be the one genuinely broken
 * outcome, so the check is never skipped for speed.
 *
 * Not symmetric. Newspaper Sudoku removes clues in rotationally symmetric pairs for
 * looks, which constrains the remover into abandoning removals it could otherwise
 * make and lands consistently short of a hard clue count. Difficulty over prettiness.
 */
export function removeClues(solution: SudokuGrid, clues: number, random: Random): SudokuGrid {
  const puzzle = [...solution] as SudokuDigit[];
  let remaining = SUDOKU_CELL_COUNT;

  for (const index of shuffled(indexes(), random)) {
    if (remaining <= clues) break;
    const removed = puzzle[index];
    puzzle[index] = 0;
    if (hasUniqueSolution(puzzle)) {
      remaining -= 1;
    } else {
      puzzle[index] = removed;
    }
  }
  return puzzle;
}

/** `[0 .. 80]`. A helper so the shuffle has something to shuffle. */
function indexes(): readonly number[] {
  return Array.from({ length: SUDOKU_CELL_COUNT }, (_, index) => index);
}

/**
 * A fresh game at `difficulty`.
 *
 * Generation is solve-then-remove: build a complete grid, then strip clues while the
 * puzzle stays uniquely solvable. The alternative — scatter digits and hope — produces
 * unsolvable boards often enough to need the same uniqueness check anyway, on top of a
 * validity check this way gets for free.
 */
export function startGame(difficulty: SudokuDifficulty, random: Random): SudokuState {
  const solution = solvedGrid(random);
  const puzzle = removeClues(solution, SUDOKU_SETUP[difficulty].clues, random);

  return {
    difficulty,
    cells: puzzle.map((value) => ({ value, given: value !== 0, notes: [] })),
    solution,
    mistakes: 0,
    filled: 0,
    elapsedSeconds: 0,
    outcome: undefined,
  };
}

/**
 * Writes `digit` into a cell.
 *
 * A wrong digit is **entered and counted**, not refused. Refusing it would turn the
 * board into an oracle — you could find every answer by trying nine digits per cell
 * and watching which one stuck — so the mistake lands, the score takes the hit, and
 * the player sees their own error on the board where they can reason about it.
 *
 * A given is never overwritten, and a no-op re-entry of the same digit does not count
 * a second mistake: holding a key or double-tapping is not a second wrong guess.
 */
export function enterDigit(state: SudokuState, index: number, digit: SudokuDigit): SudokuState {
  const cell = state.cells[index];
  if (!cell || cell.given || state.outcome) return state;
  if (cell.value === digit) return state;

  const wrong = digit !== 0 && digit !== state.solution[index];
  // Entering a digit clears that cell's notes: the pencilled candidates were working
  // towards this answer, and leaving them under it just clutters the cell.
  const cells = replace(state.cells, index, { value: digit, given: false, notes: [] });
  const filled = cells.filter((entry) => entry.value !== 0).length;

  return {
    ...state,
    cells,
    filled,
    mistakes: wrong ? state.mistakes + 1 : state.mistakes,
    outcome: solvedBy(cells, state.solution) ? "solved" : undefined,
  };
}

/** Empties a cell. A given cannot be cleared. */
export function clearCell(state: SudokuState, index: number): SudokuState {
  return enterDigit(state, index, 0);
}

/**
 * Toggles a pencilled note on an empty cell.
 *
 * Notes are refused on a cell that already holds a digit, and on a given — a note
 * beside a settled answer means nothing, and letting one be written there would draw
 * candidates the player can no longer act on.
 */
export function toggleNote(state: SudokuState, index: number, digit: SudokuDigit): SudokuState {
  const cell = state.cells[index];
  if (!cell || cell.given || cell.value !== 0 || digit === 0 || state.outcome) return state;

  const notes = cell.notes.includes(digit)
    ? cell.notes.filter((note) => note !== digit)
    : [...cell.notes, digit].sort((a, b) => a - b);

  return { ...state, cells: replace(state.cells, index, { ...cell, notes }) };
}

/** Advances the clock by one second. The view's interval calls this; tests set it. */
export function tick(state: SudokuState): SudokuState {
  if (state.outcome) return state;
  return { ...state, elapsedSeconds: state.elapsedSeconds + 1 };
}

/** Whether every cell matches the solution. */
export function isSolved(state: SudokuState): boolean {
  return solvedBy(state.cells, state.solution);
}

/** The shared test behind `isSolved` and the outcome set by `enterDigit`. */
function solvedBy(cells: readonly SudokuCell[], solution: SudokuGrid): boolean {
  return cells.every((cell, index) => cell.value === solution[index]);
}

/** The cells holding a digit that is not the solution's, for the view to mark. */
export function wrongCells(state: SudokuState): readonly number[] {
  const wrong: number[] = [];
  state.cells.forEach((cell, index) => {
    if (cell.value !== 0 && cell.value !== state.solution[index]) wrong.push(index);
  });
  return wrong;
}

/**
 * How many of `digit` are already on the board.
 *
 * Lets the number pad grey out a digit that is fully placed — nine 7s means no cell
 * still wants a 7, and offering it invites a mistake the player cannot want to make.
 * Counts wrong entries too: it reports the board as it is, not as it should be.
 */
export function digitCount(state: SudokuState, digit: SudokuDigit): number {
  return state.cells.filter((cell) => cell.value === digit).length;
}

/**
 * What a solve is worth: the difficulty's base, decayed by time and dented by mistakes.
 *
 * Zero for an unsolved board — an abandoned puzzle is not a result, and recording one
 * would put a row on the shared board for something nobody finished. Floored at
 * `SUDOKU_MIN_SCORE` for a solve, so a long grind still scores (see that constant).
 */
export function scoreGame(state: SudokuState): number {
  if (state.outcome !== "solved") return 0;

  const { base } = SUDOKU_SETUP[state.difficulty];
  const earned =
    base - state.elapsedSeconds * SUDOKU_TIME_PENALTY - state.mistakes * SUDOKU_MISTAKE_PENALTY;

  return Math.max(SUDOKU_MIN_SCORE, earned);
}

/** `cells` with one entry replaced. Kept here so no caller mutates the array. */
function replace(
  cells: readonly SudokuCell[],
  index: number,
  cell: SudokuCell,
): readonly SudokuCell[] {
  return cells.map((entry, at) => (at === index ? cell : entry));
}

/** The grid as nine rows, for a view that draws row by row. */
export function renderRows(state: SudokuState): readonly (readonly SudokuCell[])[] {
  const rows: SudokuCell[][] = [];
  for (let row = 0; row < SUDOKU_SIZE; row += 1) {
    rows.push([...state.cells.slice(row * SUDOKU_SIZE, (row + 1) * SUDOKU_SIZE)]);
  }
  return rows;
}
