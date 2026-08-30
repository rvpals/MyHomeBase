import { BOARD_SIZE, WINNING_TILE, type Board, type Direction, type MoveResult } from "./types";

/**
 * The rules of 2048, as pure functions over a flat 16-cell board.
 *
 * Nothing here touches React, the DOM, a timer or `Math.random` directly — every
 * random choice takes an explicit `random` argument. That is what makes the merge
 * rules testable at all: with a real RNG, asserting on a board after a move would
 * also be asserting on wherever the new tile happened to land.
 */

/** A source of randomness in [0, 1). `Math.random` in the app; a stub in tests. */
export type Random = () => number;

const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

/** An all-empty board. Not playable on its own — `startBoard` seeds it. */
export function emptyBoard(): Board {
  return new Array<number>(CELL_COUNT).fill(0);
}

/** Indexes of every empty cell, in order. */
export function emptyCells(board: Board): number[] {
  const cells: number[] = [];
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] === 0) cells.push(index);
  }
  return cells;
}

/**
 * Adds one tile to a random empty cell: a 2 nine times out of ten, a 4 otherwise.
 *
 * Returns the board unchanged when it is full, rather than throwing — a full board is
 * an ordinary state reached at the end of every game, not an error, and `applyMove`
 * has already decided whether a spawn was earned.
 */
export function spawnTile(board: Board, random: Random): Board {
  const cells = emptyCells(board);
  if (cells.length === 0) return board;

  const cell = cells[Math.floor(random() * cells.length)] ?? cells[0];
  const value = random() < 0.9 ? 2 : 4;

  const next = [...board];
  next[cell] = value;
  return next;
}

/** A fresh game: an empty board with the customary two tiles on it. */
export function startBoard(random: Random): Board {
  return spawnTile(spawnTile(emptyBoard(), random), random);
}

/**
 * Collapses one line toward index 0.
 *
 * The whole game is this function plus a choice of which cells form a "line". Two
 * rules that are easy to get subtly wrong, and are what the tests pin down:
 *
 * - **Zeros are dropped before merging**, so `[2,0,2,0]` merges to `[4]` — a gap
 *   between equal tiles does not prevent a merge.
 * - **A tile merges at most once per move.** `[2,2,2,2]` is `[4,4]`, never `[8]`,
 *   and `[4,2,2]` is `[4,4]` rather than `[8]`. Merging left to right and skipping
 *   the consumed tile is what enforces it.
 */
export function collapseLine(line: readonly number[]): { line: number[]; gained: number } {
  const filled = line.filter((value) => value !== 0);
  const result: number[] = [];
  let gained = 0;

  for (let index = 0; index < filled.length; index += 1) {
    const value = filled[index];
    if (value === filled[index + 1]) {
      const merged = value * 2;
      result.push(merged);
      gained += merged;
      // Skip the tile just consumed, so it cannot merge again this move.
      index += 1;
    } else {
      result.push(value);
    }
  }

  while (result.length < line.length) result.push(0);
  return { line: result, gained };
}

/**
 * The indexes forming one line, ordered so that index 0 is the direction of travel.
 *
 * This is the only place a direction turns into geometry: `collapseLine` always
 * collapses toward the front, so "up" is a column read top-down and "down" is the
 * same column read bottom-up.
 */
function lineIndexes(direction: Direction, line: number): number[] {
  const indexes: number[] = [];
  for (let step = 0; step < BOARD_SIZE; step += 1) {
    switch (direction) {
      case "left":
        indexes.push(line * BOARD_SIZE + step);
        break;
      case "right":
        indexes.push(line * BOARD_SIZE + (BOARD_SIZE - 1 - step));
        break;
      case "up":
        indexes.push(step * BOARD_SIZE + line);
        break;
      case "down":
        indexes.push((BOARD_SIZE - 1 - step) * BOARD_SIZE + line);
        break;
    }
  }
  return indexes;
}

/**
 * Applies one move. Does **not** spawn a tile — the caller does that, and only when
 * `moved` is true, so a move into a wall costs nothing.
 */
export function applyMove(board: Board, direction: Direction): MoveResult {
  const next = [...board];
  let gained = 0;
  let moved = false;

  for (let line = 0; line < BOARD_SIZE; line += 1) {
    const indexes = lineIndexes(direction, line);
    const before = indexes.map((index) => board[index]);
    const collapsed = collapseLine(before);

    gained += collapsed.gained;
    for (let step = 0; step < indexes.length; step += 1) {
      if (before[step] !== collapsed.line[step]) moved = true;
      next[indexes[step]] = collapsed.line[step];
    }
  }

  return { board: next, gained, moved };
}

/**
 * Whether the game can continue: an empty cell exists, or some move would merge.
 *
 * The empty-cell check is not just a shortcut — it is load-bearing. "Can move" defined
 * purely as "some direction shifts something" reports *false* for a wholly empty
 * board, because sliding nothing changes nothing. That would make `isGameOver` true
 * for a fresh board before its opening tiles are spawned, which is the opposite of the
 * truth. A board with a gap is always playable, so it is answered first.
 */
export function canMove(board: Board): boolean {
  if (emptyCells(board).length > 0) return true;
  return (["up", "down", "left", "right"] as const).some(
    (direction) => applyMove(board, direction).moved,
  );
}

/** No empty cell and no legal merge — the game is over. */
export function isGameOver(board: Board): boolean {
  return !canMove(board);
}

/** Whether the board contains the 2048 tile. */
export function hasWon(board: Board): boolean {
  return board.some((value) => value >= WINNING_TILE);
}

/** The largest tile on the board. `0` for an empty one. */
export function highestTile(board: Board): number {
  return board.reduce((highest, value) => (value > highest ? value : highest), 0);
}
