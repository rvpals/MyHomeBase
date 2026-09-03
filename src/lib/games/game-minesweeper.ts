import {
  MINESWEEPER_MIN_SCORE,
  MINESWEEPER_SETUP,
  MINESWEEPER_TIME_PENALTY,
  type MinesweeperCell,
  type MinesweeperDifficulty,
  type MinesweeperState,
} from "./types";

/**
 * The rules of Minesweeper, as pure functions over an immutable `MinesweeperState`.
 *
 * Nothing here touches React, the DOM, a timer or `Math.random` directly — the RNG
 * arrives as an argument, exactly as in `game-2048.ts` and `game-sudoku.ts`, and the
 * clock arrives as `elapsedSeconds` on the state. That is what lets a test lay a
 * reproducible minefield and score a "ten minute" clear without waiting ten minutes.
 *
 * Every exported function returns a NEW state and never mutates its argument, so the
 * view can hold one in `useState` and React sees each entry as a change.
 */

/** A source of randomness in [0, 1). `Math.random` in the app; a stub in tests. */
export type Random = () => number;

/** Row and column of a cell, by flat index. Pure arithmetic, no allocation. */
function rowOf(index: number, cols: number): number {
  return Math.floor(index / cols);
}

function colOf(index: number, cols: number): number {
  return index % cols;
}

/**
 * The up-to-eight cells surrounding `index`.
 *
 * Computed on demand rather than precomputed into a table the way `PEERS` is in
 * `game-sudoku.ts`. The tables differ in how they are used: Sudoku's solver asks for a
 * cell's peers thousands of times while stripping clues, where here the hot path is
 * one flood fill that visits each cell at most once. A 480-entry table built per board
 * would cost more than the arithmetic it saves.
 *
 * Bounds are checked against the row and column, not just the flat index — without the
 * column test, the cell at the end of a row would claim the first cell of the next one
 * as a neighbour and the board would wrap around its own edge.
 */
export function neighboursOf(index: number, cols: number, rows: number): readonly number[] {
  const row = rowOf(index, cols);
  const col = colOf(index, cols);
  const out: number[] = [];

  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      out.push(r * cols + c);
    }
  }
  return out;
}

/** A covered, unflagged, mine-free cell. The state every cell starts in. */
function blankCell(): MinesweeperCell {
  return { mine: false, revealed: false, flagged: false, adjacent: 0 };
}

/**
 * A fresh board at `difficulty` — dimensions, and nothing else.
 *
 * **No mines are laid here.** `mined` is false until the first reveal, which is what
 * makes the opening move safe: `reveal` lays them once it knows where the player
 * clicked, excluding that cell and its neighbours. Laying them up front and then
 * moving one out of the way afterwards is the usual alternative, and it is worse —
 * relocating a mine changes the adjacent counts of two neighbourhoods, so the numbers
 * have to be rebuilt anyway.
 *
 * No RNG argument, deliberately: a fresh board is not random yet. That also means the
 * view can build one during render without a hydration mismatch, unlike Sudoku, whose
 * board is generated up front and so has to be seeded in a mount effect.
 */
export function startGame(difficulty: MinesweeperDifficulty): MinesweeperState {
  const { cols, rows, mines } = MINESWEEPER_SETUP[difficulty];

  return {
    difficulty,
    cols,
    rows,
    mines,
    cells: Array.from({ length: cols * rows }, blankCell),
    mined: false,
    revealed: 0,
    flags: 0,
    elapsedSeconds: 0,
    outcome: undefined,
  };
}

/**
 * Lays the mines, keeping `safe` and its neighbours clear, and fills in the counts.
 *
 * The safe *neighbourhood* rather than just the safe cell: excluding only the clicked
 * cell leaves it as an island showing a number, so the first move reveals one square
 * and tells you nothing. Clearing its ring guarantees the opening click cascades,
 * which is how the game is meant to start.
 *
 * Rejection sampling — pick a cell, retry if it is taken or reserved. With at most 21%
 * density (expert) and nine reserved cells the expected retries are small; shuffling
 * all 480 indexes to draw 99 would cost more than the collisions. It cannot spin
 * forever, because `MINESWEEPER_SETUP` keeps mines well below the free-cell count:
 * expert reserves 9 of 480 and needs 99.
 */
export function layMines(
  state: MinesweeperState,
  safe: number,
  random: Random,
): MinesweeperState {
  const { cols, rows, mines } = state;
  const reserved = new Set<number>([safe, ...neighboursOf(safe, cols, rows)]);
  const placed = new Set<number>();
  const total = cols * rows;

  while (placed.size < mines) {
    const index = Math.floor(random() * total);
    // An RNG that returns exactly 1 would index off the end of the board. Guarded
    // rather than clamped: a stub in a test is the likely source, and silently folding
    // it onto the last cell would quietly bias the minefield there.
    if (index >= total) continue;
    if (reserved.has(index) || placed.has(index)) continue;
    placed.add(index);
  }

  const mined = state.cells.map((cell, index) => ({ ...cell, mine: placed.has(index) }));
  const counted = mined.map((cell, index) => ({
    ...cell,
    adjacent: neighboursOf(index, cols, rows).filter((n) => mined[n]?.mine).length,
  }));

  return { ...state, cells: counted, mined: true };
}

/**
 * Uncovers a cell, cascading through the blank region it belongs to.
 *
 * On the first reveal of a run this also lays the mines (see `layMines`), so a caller
 * never has to sequence the two — the first click is safe by construction rather than
 * by the view remembering to do something first.
 *
 * A flagged cell is refused. The flag is the player's own "do not touch here", and
 * honouring it is the whole reason to place one: a misclick on a flagged mine would
 * end the run on a cell they had already identified.
 *
 * The cascade is an explicit stack, not recursion. An empty region on an expert board
 * can run to several hundred cells, and a recursive flood fill deep enough to blow the
 * call stack would take the tab with it.
 */
export function reveal(state: MinesweeperState, index: number, random: Random): MinesweeperState {
  if (state.outcome) return state;

  const start = state.cells[index];
  if (!start || start.revealed || start.flagged) return state;

  const laid = state.mined ? state : layMines(state, index, random);
  const cells = [...laid.cells];

  // Hitting a mine ends the run, and every other mine is uncovered with it — a lost
  // board that stays covered gives no reading of how close it was. Wrong flags are
  // deliberately left standing rather than corrected: seeing where the mistake was is
  // the only thing there is to take from a loss.
  if (cells[index].mine) {
    return {
      ...laid,
      cells: cells.map((cell) => (cell.mine ? { ...cell, revealed: true } : cell)),
      outcome: "hit-mine",
    };
  }

  const stack = [index];
  let revealed = laid.revealed;

  while (stack.length > 0) {
    const at = stack.pop() as number;
    const cell = cells[at];
    // A cell can be pushed more than once — two blank neighbours both queue it — so
    // the already-revealed test here is what makes the fill terminate, not the push.
    if (!cell || cell.revealed || cell.flagged) continue;

    cells[at] = { ...cell, revealed: true };
    revealed += 1;

    // Only a blank cell spreads. A numbered cell is the boundary of the region: it is
    // revealed, but its neighbours are the player's problem to work out.
    if (cell.adjacent === 0) {
      for (const neighbour of neighboursOf(at, laid.cols, laid.rows)) {
        if (!cells[neighbour].revealed) stack.push(neighbour);
      }
    }
  }

  const next = { ...laid, cells, revealed };
  return isCleared(next) ? { ...next, outcome: "cleared" as const } : next;
}

/**
 * Plants or lifts a flag on a covered cell.
 *
 * Refused on a revealed cell — there is nothing there to mark — and the flag count is
 * deliberately not capped at the mine count. A player who flags more cells than there
 * are mines is wrong, but stopping them mid-thought would be the app second-guessing a
 * deduction it has no business judging; the counter simply goes negative and says so.
 */
export function toggleFlag(state: MinesweeperState, index: number): MinesweeperState {
  const cell = state.cells[index];
  if (!cell || cell.revealed || state.outcome) return state;

  const flagged = !cell.flagged;
  return {
    ...state,
    cells: replace(state.cells, index, { ...cell, flagged }),
    flags: state.flags + (flagged ? 1 : -1),
  };
}

/**
 * Clears the un-flagged neighbours of an already-revealed number, if it is satisfied.
 *
 * "Chording" — the move that makes the game playable at expert size. Without it,
 * clearing 381 safe cells one click at a time is tedium rather than difficulty.
 *
 * It fires only when the flags around the cell equal its number, and it is **not
 * safe**: if a flag is in the wrong place this uncovers a mine and ends the run. That
 * is the deal, and it is what keeps the move honest — a chord is a shortcut for a
 * deduction already made, not a free reveal. Refusing to chord when a flag was
 * misplaced would turn it into an oracle for checking your own flags.
 */
export function chord(state: MinesweeperState, index: number, random: Random): MinesweeperState {
  const cell = state.cells[index];
  if (!cell || !cell.revealed || cell.adjacent === 0 || state.outcome) return state;

  const neighbours = neighboursOf(index, state.cols, state.rows);
  const flagged = neighbours.filter((n) => state.cells[n].flagged).length;
  if (flagged !== cell.adjacent) return state;

  // Folded through `reveal` one neighbour at a time so each gets the flood fill and
  // the mine check, and the loop stops the moment one of them ends the run.
  let next = state;
  for (const neighbour of neighbours) {
    if (next.outcome) break;
    const target = next.cells[neighbour];
    if (target.revealed || target.flagged) continue;
    next = reveal(next, neighbour, random);
  }
  return next;
}

/** Whether a chord on `index` would do anything — so the view can hint at the move. */
export function canChord(state: MinesweeperState, index: number): boolean {
  const cell = state.cells[index];
  if (!cell || !cell.revealed || cell.adjacent === 0) return false;

  const neighbours = neighboursOf(index, state.cols, state.rows);
  const flagged = neighbours.filter((n) => state.cells[n].flagged).length;
  if (flagged !== cell.adjacent) return false;

  return neighbours.some((n) => !state.cells[n].revealed && !state.cells[n].flagged);
}

/**
 * Whether every safe cell is uncovered.
 *
 * The win condition is the *safe cells*, not the flags: flagging all ten mines on a
 * beginner board is not a win, and a board can be cleared with no flags placed at all.
 * Comparing a running count against `total - mines` is also why `revealed` is carried
 * on the state — re-counting 480 cells after every step of a flood fill is the one
 * place this game could get slow.
 */
export function isCleared(state: MinesweeperState): boolean {
  if (!state.mined) return false;
  return state.revealed === state.cols * state.rows - state.mines;
}

/** Advances the clock by one second. The view's interval calls this; tests set it. */
export function tick(state: MinesweeperState): MinesweeperState {
  // A board that has not been clicked yet is not running: the clock starts on the
  // first reveal, so leaving the dialog open does not eat into a score not yet begun.
  if (state.outcome || !state.mined) return state;
  return { ...state, elapsedSeconds: state.elapsedSeconds + 1 };
}

/**
 * Mines not yet accounted for by a flag. May go negative; see `toggleFlag`.
 *
 * A count of what is left to find, not a validation — it says nothing about whether
 * the flags that have been placed are in the right places.
 */
export function minesRemaining(state: MinesweeperState): number {
  return state.mines - state.flags;
}

/**
 * What a clear is worth: the difficulty's base, decayed by time.
 *
 * Zero for anything but a clear — hitting a mine is not a result, and recording one
 * would put a row on the shared board for a lost game, the same rule Sudoku applies to
 * an abandoned puzzle. Floored at `MINESWEEPER_MIN_SCORE` for a clear, so a long grind
 * still scores something.
 *
 * No mistake penalty, unlike Sudoku, because there is no partial mistake here: a wrong
 * flag costs nothing by itself and a wrong reveal ends the run outright. Time is the
 * only dimension left to rank a clear on.
 */
export function scoreGame(state: MinesweeperState): number {
  if (state.outcome !== "cleared") return 0;

  const { base } = MINESWEEPER_SETUP[state.difficulty];
  return Math.max(MINESWEEPER_MIN_SCORE, base - state.elapsedSeconds * MINESWEEPER_TIME_PENALTY);
}

/** `cells` with one entry replaced. Kept here so no caller mutates the array. */
function replace(
  cells: readonly MinesweeperCell[],
  index: number,
  cell: MinesweeperCell,
): readonly MinesweeperCell[] {
  return cells.map((entry, at) => (at === index ? cell : entry));
}

/** The grid as rows, for a view that draws row by row. */
export function renderRows(state: MinesweeperState): readonly (readonly MinesweeperCell[])[] {
  const out: MinesweeperCell[][] = [];
  for (let row = 0; row < state.rows; row += 1) {
    out.push([...state.cells.slice(row * state.cols, (row + 1) * state.cols)]);
  }
  return out;
}
