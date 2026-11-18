import { clearArrow, isSolved } from "./game-arrows";
import { arrowRunSaveSchema } from "./schema";
import {
  ARROW_DIFFICULTY_SETUP,
  ARROW_LIVES,
  ARROW_MOVE_FREE_MISS,
  ARROW_MOVE_MISS,
  ARROW_MOVE_UNDO,
  ARROW_SAVE_VERSION,
  DIRECTIONS,
  type Arrow,
  type ArrowBoard,
  type ArrowDifficulty,
  type ArrowRunProgress,
  type ArrowRunSave,
  type ArrowSnapshot,
  type Cell,
} from "./types";

/**
 * Saving and resuming an Arrow Clearing run.
 *
 * A save is the board as dealt plus a log of moves (see `ArrowRunSave`). Restoring
 * replays that log with the game's own rules, so the rebuilt run matches the one that
 * was saved exactly, undo history included. Any clear that is not legal during the
 * replay marks the whole save as damaged.
 *
 * Plain data in and out, with no storage: the use-cases in `saved-runs.ts` handle the
 * database, and the view calls `restoreArrowRun` directly to put a run back on screen.
 */

/** Why a save could not be restored, in words the resume prompt can show. */
export type ArrowRestoreResult =
  | { ok: true; run: ArrowRunProgress }
  | { ok: false; reason: string };

const DAMAGED = "That save is damaged and can't be resumed.";

/** The board in the compact stored form: `[id, directionIndex, ...cellIndices]` per arrow. */
export function encodeArrowBoard(board: ArrowBoard): number[][] {
  return board.arrows.map((arrow) => [
    arrow.id,
    DIRECTIONS.indexOf(arrow.direction),
    ...arrow.cells.map((cell) => cell.row * board.size + cell.col),
  ]);
}

/**
 * The stored form back into a board, or undefined when it does not describe a real one.
 *
 * The checks: a known direction, every cell on the board, each cell next to the one
 * before it, no cell used twice anywhere, and no repeated arrow id. A board that fails
 * any of these could not have come from the generator.
 */
export function decodeArrowBoard(size: number, rows: readonly number[][]): ArrowBoard | undefined {
  const area = size * size;
  const usedCells = new Set<number>();
  const usedIds = new Set<number>();
  const arrows: Arrow[] = [];

  for (const row of rows) {
    const [id, directionIndex, ...indices] = row;
    const direction = DIRECTIONS[directionIndex];
    if (direction === undefined || indices.length === 0 || usedIds.has(id)) return undefined;
    usedIds.add(id);

    const cells: Cell[] = [];
    for (const index of indices) {
      if (index < 0 || index >= area || usedCells.has(index)) return undefined;
      usedCells.add(index);
      const cell = { row: Math.floor(index / size), col: index % size };
      const previous = cells[cells.length - 1];
      if (previous && Math.abs(previous.row - cell.row) + Math.abs(previous.col - cell.col) !== 1) {
        return undefined;
      }
      cells.push(cell);
    }
    arrows.push({ id, direction, cells });
  }

  return { size, arrows };
}

/** Builds the stored form of a run. Pure: the caller supplies the dealt board and the log. */
export function buildArrowSave(input: {
  difficulty: ArrowDifficulty;
  dealt: ArrowBoard;
  moves: readonly number[];
  unlimitedLives: boolean;
  practiceRun: boolean;
}): ArrowRunSave {
  return {
    version: ARROW_SAVE_VERSION,
    difficulty: input.difficulty,
    size: input.dealt.size,
    arrows: encodeArrowBoard(input.dealt),
    moves: [...input.moves],
    unlimitedLives: input.unlimitedLives,
    practiceRun: input.practiceRun,
  };
}

/**
 * Turns a stored save back into a run in progress.
 *
 * Takes `unknown` because a save comes from the database or from the browser, and both
 * are untrusted. It is rejected when:
 * - it fails the schema, or the board doesn't decode;
 * - it is from another save version;
 * - its board size doesn't match its tier;
 * - any move is illegal at the point it is replayed;
 * - the run already ended (board clear or out of lives). A finished run has no reason
 *   to resume, and the view deletes its save when the run ends.
 */
export function restoreArrowRun(input: unknown): ArrowRestoreResult {
  const parsed = arrowRunSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: DAMAGED };
  const save = parsed.data;

  if (save.version !== ARROW_SAVE_VERSION) {
    return { ok: false, reason: "That save is from an older version of the game." };
  }
  if (save.size !== ARROW_DIFFICULTY_SETUP[save.difficulty].size) {
    return { ok: false, reason: DAMAGED };
  }

  const dealt = decodeArrowBoard(save.size, save.arrows);
  if (!dealt) return { ok: false, reason: DAMAGED };

  const replayed = replayArrowMoves(dealt, save.moves);
  if (!replayed) return { ok: false, reason: DAMAGED };
  if (isSolved(replayed.board) || replayed.lives <= 0) {
    return { ok: false, reason: "That run had already finished." };
  }

  return {
    ok: true,
    run: {
      difficulty: save.difficulty,
      dealt,
      ...replayed,
      moves: save.moves,
      unlimitedLives: save.unlimitedLives,
      practiceRun: save.practiceRun,
    },
  };
}

/**
 * Applies a move log to a dealt board, or returns undefined at the first impossible move.
 *
 * This must follow the same rules as the board view:
 * - a miss costs a life, a free miss doesn't, and both count as misses;
 * - a clear records the board and lives before it, for Undo;
 * - Undo restores both, takes one off the cleared count, and leaves misses alone.
 *
 * Moves after the last life is gone are impossible, because the view stops taking taps then.
 */
export function replayArrowMoves(
  dealt: ArrowBoard,
  moves: readonly number[],
): Pick<ArrowRunProgress, "board" | "lives" | "cleared" | "misses" | "history"> | undefined {
  let board = dealt;
  let lives = ARROW_LIVES;
  let cleared = 0;
  let misses = 0;
  const history: ArrowSnapshot[] = [];

  for (const move of moves) {
    if (lives <= 0 || isSolved(board)) return undefined;

    if (move >= 0) {
      const result = clearArrow(board, move);
      if (!result.cleared) return undefined;
      history.push({ board, lives });
      board = result.board;
      cleared += 1;
    } else if (move === ARROW_MOVE_MISS) {
      lives -= 1;
      misses += 1;
    } else if (move === ARROW_MOVE_FREE_MISS) {
      misses += 1;
    } else if (move === ARROW_MOVE_UNDO) {
      const previous = history.pop();
      if (!previous) return undefined;
      board = previous.board;
      lives = previous.lives;
      cleared = Math.max(0, cleared - 1);
    } else {
      return undefined;
    }
  }

  return { board, lives, cleared, misses, history };
}
