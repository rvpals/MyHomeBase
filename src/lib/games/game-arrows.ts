import {
  ARROW_DIFFICULTY_SETUP,
  type Arrow,
  type ArrowBoard,
  type ArrowDifficulty,
  type ArrowPuzzle,
  type Cell,
  type Direction,
} from "./types";

/**
 * The rules of Arrow Clearing, as pure functions over a board.
 *
 * The game: every arrow is a winding run of cells with a head that points one way. Tap
 * it and it snakes off the board along its own route — but only if the straight run
 * from its head to the edge is empty. A blocked arrow stays put and costs a life. Clear
 * all of them to win.
 *
 * The mechanic follows "Arrows – Puzzle Escape": a full clear path means the piece
 * escapes, a blocked one costs a heart, and the puzzle is the order rather than the
 * dexterity.
 *
 * Nothing here touches React, the DOM, a timer or `Math.random` directly; the
 * generator takes an explicit `random`, so a generated puzzle can be reproduced in a
 * test. Same contract as `game-2048.ts`.
 */

/** A source of randomness in [0, 1). `Math.random` in the app; a stub in tests. */
export type Random = () => number;

/**
 * The longest arrow the generator will place.
 *
 * A real board wants a mix — a few long snakes crossing it, plenty of small pieces
 * filling in between — so this is the ceiling of a distribution, not the length every
 * arrow gets. See `LENGTH_WEIGHTS`.
 */
export const MAX_ARROW_LENGTH = 12;

/**
 * The shortest arrow the generator will place.
 *
 * Two cells, so every piece has a head *and* a tail. A one-cell arrow renders as an
 * arrowhead floating alone with no line behind it — it reads as a stray mark rather than
 * part of the maze, and it is the one shape that made the board look unfinished.
 */
export const MIN_ARROW_LENGTH = 2;

/**
 * How often each arrow length is aimed for, as relative weights indexed by length.
 *
 * Weighted toward short deliberately. Two reasons, one aesthetic and one arithmetic:
 * a board of uniformly long snakes has no texture, and 120 pieces only fit on an 18x18
 * if most of them are small.
 *
 * This replaced asking for the maximum every time, which produced a **barbell**: a walk
 * either found room and ran to the cap, or was boxed in immediately and stopped at one
 * cell. Measured, that gave 6.3 single-cell and 4.6 max-length arrows per board with
 * almost nothing between them (0.2 at length 4, 0.0 at length 5) — the opposite of a
 * varied board.
 *
 * Index 0 is unused so a length reads as its own index. **Index 1 is zero on purpose**:
 * a single-cell arrow draws as a bare arrowhead with no line behind it, which looks like
 * a stray glyph rather than a piece of the maze. Every arrow gets at least a head and one
 * tail cell.
 *
 * `growPath` can still return a 1-cell run when a spot is too cramped for the length it
 * was asked for — `MIN_ARROW_LENGTH` is what stops those being placed.
 */
const LENGTH_WEIGHTS: readonly number[] = [0, 0, 20, 16, 13, 10, 8, 7, 6, 5, 4, 3, 3];

/** Sum of the weights. Hoisted — it is constant, and `pickLength` runs per placement. */
const LENGTH_WEIGHT_TOTAL = LENGTH_WEIGHTS.reduce((sum, weight) => sum + weight, 0);

/** Picks a target length from `LENGTH_WEIGHTS`. */
function pickLength(random: Random): number {
  let roll = random() * LENGTH_WEIGHT_TOTAL;
  for (let length = 1; length < LENGTH_WEIGHTS.length; length += 1) {
    roll -= LENGTH_WEIGHTS[length];
    if (roll <= 0) return length;
  }
  return 1;
}

/** The unit step for each direction, in grid coordinates. */
const STEPS: Record<Direction, Cell> = {
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 },
};

const ALL_DIRECTIONS: readonly Direction[] = ["up", "down", "left", "right"];

/** Whether a cell is on a board of `size` x `size`. */
export function isOnBoard(cell: Cell, size: number): boolean {
  return cell.row >= 0 && cell.row < size && cell.col >= 0 && cell.col < size;
}

/** `cell` moved one step in `direction`. May land off the board. */
export function step(cell: Cell, direction: Direction): Cell {
  const delta = STEPS[direction];
  return { row: cell.row + delta.row, col: cell.col + delta.col };
}

/**
 * Every cell the given arrows cover, as a lookup keyed by "row,col".
 *
 * Built once per query rather than scanned per cell: a board holds hundreds of arrows of
 * up to twelve cells, and `isBlocked` would otherwise walk all of them for every step of
 * every path.
 *
 * Deliberately covers **all** arrows, with no way to exclude one. It used to take a
 * `skipId` so an arrow could be checked without seeing itself; that is exactly the bug
 * that let a U-shaped piece clear straight through its own tail. See `isBlocked`.
 */
function occupancy(arrows: readonly Arrow[]): Set<string> {
  const taken = new Set<string>();
  for (const arrow of arrows) {
    for (const cell of arrow.cells) taken.add(`${cell.row},${cell.col}`);
  }
  return taken;
}


/**
 * The cells an arrow would travel through on its way out: from just past its head to
 * the board edge, in flight order. Empty when the head already sits on the edge.
 */
export function pathAhead(arrow: Arrow, size: number): Cell[] {
  const path: Cell[] = [];
  let cursor = step(arrow.cells[0], arrow.direction);
  while (isOnBoard(cursor, size)) {
    path.push(cursor);
    cursor = step(cursor, arrow.direction);
  }
  return path;
}

/**
 * Whether anything stands between this arrow and the edge.
 *
 * Two distinct obstructions, and both matter:
 *
 * - **Another arrow** anywhere on the straight run from this head to the edge.
 * - **This arrow's own tail**, when the path turns back across its own exit line.
 *
 * That second case was originally excluded, on the reasoning that "the tail follows
 * exactly where the head has already been, so a path clear for the head is clear for the
 * whole piece". That is true of a *straight* arrow and false as soon as paths can wind. A
 * U-shaped piece can point its head straight back into its own tail:
 *
 * ```
 *   ┌───────┐        The head (◀) travels left, but two of its own
 *   │       │        tail cells sit in that lane. The piece cannot
 *   ◀───────┘        leave, so tapping it must cost a life.
 * ```
 *
 * Only the cells *ahead* of the head are considered, which is what keeps a straight
 * arrow from reporting itself blocked: its tail is entirely behind it, so it never
 * appears in `pathAhead`. That is why this can check the full board rather than
 * excluding the arrow — the geometry does the exclusion for us, and no special case is
 * needed.
 */
export function isBlocked(board: ArrowBoard, arrowId: number): boolean {
  const arrow = board.arrows.find((entry) => entry.id === arrowId);
  if (!arrow) return false;

  // Every arrow, this one included: a winding tail can obstruct its own head.
  const taken = occupancy(board.arrows);
  return pathAhead(arrow, board.size).some((cell) => taken.has(`${cell.row},${cell.col}`));
}


/** Every arrow that could fly off right now. The Hint button picks from these. */
export function unblockedArrows(board: ArrowBoard): Arrow[] {
  return board.arrows.filter((arrow) => !isBlocked(board, arrow.id));
}

/**
 * Removes an arrow from the board, or returns the board unchanged when it is blocked.
 *
 * Returning the same board rather than throwing: clicking a blocked arrow is an
 * ordinary move in this game — it is how you learn the board — not an error. The
 * `cleared` flag tells the view whether to slide the piece away or shake it.
 */
export function clearArrow(
  board: ArrowBoard,
  arrowId: number,
): { board: ArrowBoard; cleared: boolean } {
  const exists = board.arrows.some((arrow) => arrow.id === arrowId);
  if (!exists) return { board, cleared: false };
  if (isBlocked(board, arrowId)) return { board, cleared: false };

  const remaining = board.arrows.filter((arrow) => arrow.id !== arrowId);
  return { board: { ...board, arrows: remaining }, cleared: true };
}

/** An empty board is a solved board. */
export function isSolved(board: ArrowBoard): boolean {
  return board.arrows.length === 0;
}

/**
 * Whether the board has arrows left but no legal move.
 *
 * This should never fire during normal play, and that is worth stating: clearing an
 * arrow only ever frees cells, so it can never block a piece that was previously
 * free. Every board reachable from a generated start is therefore still solvable. It
 * is checked anyway so that a future change — placing arrows, or moving them rather
 * than clearing them — cannot silently strand the player with no way to finish.
 */
export function isStuck(board: ArrowBoard): boolean {
  return board.arrows.length > 0 && unblockedArrows(board).length === 0;
}

/* ---------------------------------------------------------------------------------
   Level generation.
--------------------------------------------------------------------------------- */

/** Fisher-Yates against the supplied `random`, so a shuffle is reproducible. */
function shuffled<T>(items: readonly T[], random: Random): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

/**
 * Grows a winding path of up to `length` cells, head first, starting at `head`.
 *
 * The tail is laid **backwards** from the head, one free cell at a time, and it may
 * turn: at each step it picks among the neighbours that are on the board, unoccupied,
 * and not already part of this path. That is what produces the long tangled runs the
 * board is made of, rather than the short straight sticks this generator first drew.
 *
 * Two invariants the tests pin down, because both are easy to lose here:
 *
 * - **`cells[0]` is the head and stays the head.** The piece leaves the board head
 *   first along its own route, and every collision check walks forward from `cells[0]`,
 *   so the order is load-bearing rather than cosmetic.
 * - **A path never crosses itself.** `own` tracks the cells this walk has already used,
 *   which `taken` cannot do — the path is not committed to the board until it is
 *   returned, so without `own` a walk could double back onto its own tail and produce
 *   an arrow that occupies fewer cells than it claims.
 *
 * Returns a shorter path when it walks into a dead end rather than failing: a 5-cell
 * run in a tight corner is a perfectly good piece, and rejecting it would bias the
 * board towards open ground. Never returns fewer than one cell (the head itself).
 */
function growPath(
  head: Cell,
  direction: Direction,
  length: number,
  board: OccupancyGrid,
  random: Random,
): Cell[] {
  const cells: Cell[] = [head];
  const own = new Set<number>([head.row * board.size + head.col]);

  /*
    The head's exit lane: every cell between the head and the edge.

    The tail may not enter it. A tail cell here would sit directly in front of the head,
    so the piece could never leave the board — it would be blocked by itself from the
    moment it was created, and no amount of clearing other arrows could ever free it.
    Generation once ignored this and produced **265 such arrows across 10 boards, making
    every one of them unsolvable**.

    Cheap to enforce because the lane is a straight line: a cell is in it when it shares
    the head's row or column and lies on the far side in `direction`.
  */
  const inExitLane = (cell: Cell): boolean => {
    switch (direction) {
      case "up":
        return cell.col === head.col && cell.row < head.row;
      case "down":
        return cell.col === head.col && cell.row > head.row;
      case "left":
        return cell.row === head.row && cell.col < head.col;
      case "right":
        return cell.row === head.row && cell.col > head.col;
    }
  };

  const usable = (cell: Cell): boolean =>
    board.isFree(cell.row, cell.col) &&
    !own.has(cell.row * board.size + cell.col) &&
    !inExitLane(cell);

  // The first tail cell must sit directly behind the head, so the piece reads as
  // pointing where it is going. After that the walk is free to turn.
  const forward = STEPS[direction];
  let cursor = { row: head.row - forward.row, col: head.col - forward.col };

  for (let placed = 1; placed < length; placed += 1) {
    if (!usable(cursor)) break;

    cells.push(cursor);
    own.add(cursor.row * board.size + cursor.col);

    // Where the tail could continue from here.
    const options = shuffled(ALL_DIRECTIONS, random)
      .map((next) => step(cursor, next))
      .filter(usable);

    if (options.length === 0) break;
    cursor = options[0];
  }

  return cells;
}



/**
 * Generates a puzzle by reverse construction, which is what guarantees it is solvable.
 *
 * Arrows are "shot in" from outside: each new arrow is placed only where its own path
 * to the edge is clear *at the moment it is placed*. Because clearing an arrow only
 * frees cells, an arrow whose exit was clear when it was placed still has a clear exit
 * once every arrow placed after it has gone — so playing the placements back in
 * reverse order always empties the board. That reversed order is returned as
 * `solution`.
 *
 * The alternative — scatter arrows at random, then check solvability — needs a search
 * per candidate board and can fail, so it would need a retry loop with no bound. This
 * construction cannot produce an unsolvable board at all.
 *
 * Placement is best-effort: on a dense board some attempts find nowhere legal to go,
 * so the arrow count is a target rather than a promise. A board one arrow short is
 * still a good puzzle; a generator that spun until it hit the number exactly would
 * not be.
 */
export function generatePuzzle(difficulty: ArrowDifficulty, random: Random): ArrowPuzzle {
  const { size, arrows: target } = ARROW_DIFFICULTY_SETUP[difficulty];
  const board = new OccupancyGrid(size);
  const placed: Arrow[] = [];

  for (let index = 0; index < target; index += 1) {
    const placement = findPlacement(board, random);
    if (!placement) break;

    placed.push({ id: index + 1, cells: placement.cells, direction: placement.direction });
    board.fill(placement.cells);
  }

  // Placed first must be cleared last: the reverse of the placement order.
  const solution = placed.map((arrow) => arrow.id).reverse();

  return { board: { size: board.size, arrows: placed }, solution };
}

/**
 * The board as it is being built: which cells are taken, and enough bookkeeping to
 * answer "is this head's exit clear?" without walking the path.
 *
 * The naive version — a `Set` of "row,col" plus `pathAhead` per candidate — is what made
 * large boards unusable. `findPlacement` considers every free cell in all four
 * directions, and each check walked up to `size` cells, so a placement cost O(size^3)
 * and a whole board O(size^5). Measured end to end: 136ms at 20x20 but **16 seconds at
 * 50x50**, which would visibly freeze the tab on "New board".
 *
 * The observation that removes the inner walk: a head's straight run to the edge is
 * clear exactly when there is no occupied cell **beyond it** in that direction. So
 * tracking, per row, the smallest and largest occupied column (and per column, the
 * smallest and largest occupied row) answers all four directions with a comparison.
 * Those extremes only ever grow as cells fill, which is why maintaining them is O(1) per
 * cell rather than a rescan.
 *
 * Cells live in one flat `Uint8Array` rather than a Set of strings — no per-cell string
 * allocation, and a 2500-cell board is 2.5KB.
 */
class OccupancyGrid {
  readonly size: number;
  private readonly cells: Uint8Array;
  /** Per row: the lowest and highest occupied column, or -1 / size when the row is empty. */
  private readonly rowMinCol: Int16Array;
  private readonly rowMaxCol: Int16Array;
  /** Per column: the lowest and highest occupied row. */
  private readonly colMinRow: Int16Array;
  private readonly colMaxRow: Int16Array;

  constructor(size: number) {
    this.size = size;
    this.cells = new Uint8Array(size * size);
    // Seeded so that an empty row reports "nothing to the left of anywhere" and
    // "nothing to the right of anywhere" without a special case at every read.
    this.rowMinCol = new Int16Array(size).fill(size);
    this.rowMaxCol = new Int16Array(size).fill(-1);
    this.colMinRow = new Int16Array(size).fill(size);
    this.colMaxRow = new Int16Array(size).fill(-1);
  }

  isTaken(row: number, col: number): boolean {
    return this.cells[row * this.size + col] === 1;
  }

  isFree(row: number, col: number): boolean {
    return (
      row >= 0 && row < this.size && col >= 0 && col < this.size && !this.isTaken(row, col)
    );
  }

  fill(cells: readonly Cell[]): void {
    for (const { row, col } of cells) {
      this.cells[row * this.size + col] = 1;
      if (col < this.rowMinCol[row]) this.rowMinCol[row] = col;
      if (col > this.rowMaxCol[row]) this.rowMaxCol[row] = col;
      if (row < this.colMinRow[col]) this.colMinRow[col] = row;
      if (row > this.colMaxRow[col]) this.colMaxRow[col] = row;
    }
  }

  /**
   * Whether the straight run from this cell to the edge is unoccupied — the check the
   * whole solvability argument rests on, in constant time.
   */
  isExitClear(row: number, col: number, direction: Direction): boolean {
    switch (direction) {
      case "left":
        return this.rowMinCol[row] >= col;
      case "right":
        return this.rowMaxCol[row] <= col;
      case "up":
        return this.colMinRow[col] >= row;
      case "down":
        return this.colMaxRow[col] <= row;
    }
  }

  /** How many cells stand between this one and the edge in `direction`. */
  depth(row: number, col: number, direction: Direction): number {
    switch (direction) {
      case "left":
        return col;
      case "right":
        return this.size - 1 - col;
      case "up":
        return row;
      case "down":
        return this.size - 1 - row;
    }
  }
}


/**
 * Finds one legal spot for a new arrow: a head whose straight run to the edge is clear
 * given what is already down, plus a winding tail grown behind it. Undefined when the
 * board has no room left.
 *
 * The exit check comes **first** and is done against the head alone, before any tail is
 * grown. That ordering is deliberate on two counts: it is the cheap test, so most of
 * the grid is rejected without walking a path at all; and it is the entire solvability
 * argument, so keeping it adjacent to the head rather than buried after the walk makes
 * it hard to accidentally weaken. The tail cannot affect it — a tail is laid backwards,
 * away from the exit.
 */
function findPlacement(
  board: OccupancyGrid,
  random: Random,
): { cells: Cell[]; direction: Direction } | undefined {
  /*
    The target length is rolled ONCE, here, for the whole placement.

    Rolling it per candidate — which is what this did first — silently destroys the
    distribution: `findPlacement` evaluates every free cell in every direction, so a
    large board rolled it thousands of times and kept whichever candidate happened to
    roll longest. A weighted sample is only a sample if it is drawn once per thing
    being decided.
  */
  const targetLength = pickLength(random);

  /*
    Collect every legal head, then choose among them — rather than tracking a single
    running best.

    Ranking candidates against each other pits depth and length against one another, and
    every version of that trade came out badly. Scoring `depth * 3 + length` let the
    ranking re-pick the length (16 long snakes, 2 mid-length pieces). Scoring depth alone
    picked the deepest head regardless of what fitted behind it — the deepest spots on a
    filling board are the cramped ones, so every arrow came out 1-2 cells and the board
    sat at 37% full.

    Both properties are wanted, so they are satisfied in order of priority instead of
    summed: keep the candidates whose head is deep (hard to unblock), and among those
    prefer one that can actually hold the length that was rolled.
  */
  const candidates: { row: number; col: number; direction: Direction; depth: number }[] = [];
  let deepest = -1;

  for (let row = 0; row < board.size; row += 1) {
    for (let col = 0; col < board.size; col += 1) {
      if (board.isTaken(row, col)) continue;

      for (const direction of ALL_DIRECTIONS) {
        // The exit must be clear *now* — this is the whole solvability argument, and it
        // is an O(1) lookup rather than a walk. See OccupancyGrid.
        if (!board.isExitClear(row, col, direction)) continue;

        const depth = board.depth(row, col, direction);
        candidates.push({ row, col, direction, depth });
        if (depth > deepest) deepest = depth;
      }
    }
  }

  if (candidates.length === 0) return undefined;

  /*
    Why a depth *band* rather than the single deepest cell.

    A head on the board edge has depth 0 and can never be blocked by anything, which is
    what made early boards trivially easy — a third of every board was clearable in any
    order because 421 of 448 free arrows sat on an edge. Depth is therefore the property
    that has to be defended.

    But insisting on the maximum leaves one or two cells to choose from, and no room to
    honour the length. Taking everything within `DEPTH_BAND` of the deepest keeps heads
    well away from the edge while leaving a pool wide enough to find a spot that fits.
  */
  const DEPTH_BAND = 2;
  const deepEnough = candidates.filter((entry) => entry.depth >= deepest - DEPTH_BAND);

  /*
    Try the deep candidates in random order and take the first that fits the rolled
    length. Growing a path is the expensive step, so this stops at the first success
    rather than growing every candidate to compare them.

    `ATTEMPT_LIMIT` bounds it: on a large board the deep band can hold thousands of
    candidates, and growing a path for every one of them when none fits is what made
    generation quadratic in the band size. Sixty attempts is ample to find a spot when
    one exists, and when none does the fallback below is what gets used anyway.
  */
  const ATTEMPT_LIMIT = 60;
  let fallback: { cells: Cell[]; direction: Direction } | undefined;
  let attempts = 0;

  for (const entry of shuffled(deepEnough, random)) {
    if (attempts >= ATTEMPT_LIMIT) break;
    attempts += 1;

    const head = { row: entry.row, col: entry.col };
    const cells = growPath(head, entry.direction, targetLength, board, random);
    if (cells.length >= targetLength) return { cells, direction: entry.direction };

    // Remember the roomiest near-miss, so a board with no room for a long arrow still
    // places the longest one available rather than giving up on the placement.
    //
    // A run below MIN_ARROW_LENGTH is never kept, even as a fallback: a lone arrowhead
    // with no tail is the one shape worth refusing to draw. Late in generation this is
    // what ends the run of placements, which is the intended behaviour — the board is
    // full enough at that point.
    if (cells.length >= MIN_ARROW_LENGTH && (!fallback || cells.length > fallback.cells.length)) {
      fallback = { cells, direction: entry.direction };
    }
  }

  return fallback;
}




/**
 * Replays `solution` against the puzzle and reports whether it empties the board.
 *
 * Exported because it is the assertion the generator's test makes over many random
 * boards — proving the construction argument above holds, rather than trusting the
 * comment that states it.
 */
export function solutionClearsBoard(puzzle: ArrowPuzzle): boolean {
  let board = puzzle.board;
  for (const arrowId of puzzle.solution) {
    const result = clearArrow(board, arrowId);
    if (!result.cleared) return false;
    board = result.board;
  }
  return isSolved(board);
}

/* ---------------------------------------------------------------------------------
   Scoring.
--------------------------------------------------------------------------------- */

/** Points for clearing one arrow cleanly. */
const POINTS_PER_ARROW = 100;

/** Points lost per wasted tap on a blocked arrow. */
const PENALTY_PER_MISS = 15;

/**
 * The score for a finished run: full marks per arrow cleared, less what the misses cost.
 *
 * Called on a **lost** run as well as a solved board, which is why it takes the cleared
 * count rather than reading the board: a run that ran out of lives half way still scores
 * for the arrows it got out, so the number means "how far you got".
 *
 * The points penalty is kept even though a miss now also costs a life. The life is the
 * real deterrent; this is the tie-break, so that two runs which cleared the same number
 * of arrows are separated by how cleanly they did it.
 *
 * Floored at a tenth of full marks rather than at zero, so a long fumbling run still
 * outranks a short one — clearing twenty arrows badly is more work than clearing five
 * badly, and a floor of zero would call them equal.
 */
export function scoreBoard(arrowsCleared: number, misses: number): number {
  const gross = arrowsCleared * POINTS_PER_ARROW;
  const floor = arrowsCleared * 10;
  return Math.max(floor, gross - misses * PENALTY_PER_MISS);
}
