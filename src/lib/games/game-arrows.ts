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
 * The game: every arrow occupies a straight run of cells and points one way. Click it
 * and it flies forward off the board — but only if every cell between its head and
 * the edge is empty. A blocked arrow bounces back. Clear all of them to win.
 *
 * Nothing here touches React, the DOM, a timer or `Math.random` directly; the
 * generator takes an explicit `random`, so a generated puzzle can be reproduced in a
 * test. Same contract as `game-2048.ts`.
 */

/** A source of randomness in [0, 1). `Math.random` in the app; a stub in tests. */
export type Random = () => number;

/** The longest arrow the generator will place. */
export const MAX_ARROW_LENGTH = 4;

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
 * Built once per query rather than scanned per cell: a hard board holds two dozen
 * arrows of up to four cells, and `isBlocked` would otherwise walk all of them for
 * every step of every path.
 */
function occupancy(arrows: readonly Arrow[], skipId?: number): Set<string> {
  const taken = new Set<string>();
  for (const arrow of arrows) {
    if (arrow.id === skipId) continue;
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
 * Only the head's path is checked, never the tail's. The tail follows exactly where
 * the head has already been, so a path clear for the head is clear for the whole
 * piece — and checking every cell of the arrow would re-test cells the arrow itself
 * occupies, reporting every arrow as blocked by its own tail.
 */
export function isBlocked(board: ArrowBoard, arrowId: number): boolean {
  const arrow = board.arrows.find((entry) => entry.id === arrowId);
  if (!arrow) return false;

  const taken = occupancy(board.arrows, arrowId);
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
 * The cells an arrow of `length` would occupy if its head sat on `head` pointing
 * `direction`, head first. Undefined when the tail would hang off the board.
 */
function arrowCells(
  head: Cell,
  direction: Direction,
  length: number,
  size: number,
): Cell[] | undefined {
  const cells: Cell[] = [head];
  // The tail extends backwards from the head, against the direction of travel.
  const forward = STEPS[direction];
  for (let offset = 1; offset < length; offset += 1) {
    const cell = { row: head.row - forward.row * offset, col: head.col - forward.col * offset };
    if (!isOnBoard(cell, size)) return undefined;
    cells.push(cell);
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

  const placed: Arrow[] = [];
  const taken = new Set<string>();

  // Every cell of the grid, tried in a fresh random order for each arrow. Scanning a
  // shuffled list rather than sampling blindly means a nearly-full board still finds
  // its last legal spot instead of missing it by bad luck.
  const allCells: Cell[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) allCells.push({ row, col });
  }

  for (let index = 0; index < target; index += 1) {
    const placement = findPlacement(allCells, size, taken, random);
    if (!placement) continue;

    placed.push({ id: index + 1, cells: placement.cells, direction: placement.direction });
    for (const cell of placement.cells) taken.add(`${cell.row},${cell.col}`);
  }

  // Placed first must be cleared last: the reverse of the placement order.
  const solution = placed.map((arrow) => arrow.id).reverse();

  return { board: { size, arrows: placed }, solution };
}

/**
 * Finds one legal spot for a new arrow: its cells free, and a clear run from its head
 * to the edge given what is already down. Undefined when the board has no room left.
 */
function findPlacement(
  allCells: readonly Cell[],
  size: number,
  taken: Set<string>,
  random: Random,
): { cells: Cell[]; direction: Direction } | undefined {
  for (const head of shuffled(allCells, random)) {
    if (taken.has(`${head.row},${head.col}`)) continue;

    for (const direction of shuffled(ALL_DIRECTIONS, random)) {
      // Longest first: a shorter arrow fits where a long one will not, so trying long
      // lengths first and falling back keeps boards visually varied instead of
      // degenerating into all single cells once space gets tight.
      const lengths = [4, 3, 2, 1].filter((length) => length <= MAX_ARROW_LENGTH);

      for (const length of lengths) {
        const cells = arrowCells(head, direction, length, size);
        if (!cells) continue;
        if (cells.some((cell) => taken.has(`${cell.row},${cell.col}`))) continue;

        // The exit must be clear *now* — this is the whole solvability argument.
        const exitClear = pathAhead({ id: -1, cells, direction }, size).every(
          (cell) => !taken.has(`${cell.row},${cell.col}`),
        );
        if (!exitClear) continue;

        return { cells, direction };
      }
    }
  }

  return undefined;
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

/** Points lost per wasted click on a blocked arrow. */
const PENALTY_PER_MISS = 15;

/**
 * The score for a finished board: full marks for a perfect solve, less whatever the
 * misses cost.
 *
 * Floored at a tenth of full marks rather than at zero, so a long fumbling solve of a
 * big board still beats a long fumbling solve of a small one — clearing a 9x9 badly is
 * more work than clearing a 5x5 badly, and a floor of zero would rank them equal.
 * Only ever called on a cleared board, so `arrowsCleared` is the board's whole arrow
 * count.
 */
export function scoreBoard(arrowsCleared: number, misses: number): number {
  const gross = arrowsCleared * POINTS_PER_ARROW;
  const floor = arrowsCleared * 10;
  return Math.max(floor, gross - misses * PENALTY_PER_MISS);
}
