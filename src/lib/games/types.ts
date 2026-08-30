/**
 * The Games module's domain types.
 *
 * A game is identified by a `GameKey` — a string that names code, not a database
 * row. See `catalogue.ts` for why the catalogue is not a table.
 */

/** Whether a catalogue entry can actually be played yet. */
export type GameStatus = "available" | "coming-soon";

/** One playable (or promised) game. */
export interface CatalogueGame {
  /** Stable id, stored in `gam_scores.game_key`. Permanent once a score exists. */
  key: string;
  name: string;
  /** One line, shown on the Arcade card. */
  description: string;
  status: GameStatus;
  /**
   * How a score reads for this game, so the scoreboard can label a column without
   * knowing what the game is: 2048 scores points, a future Sudoku might score seconds.
   */
  scoreUnit: "points" | "seconds";
}

/** A finished game, as stored. Immutable — there is no update path. */
export interface Score {
  id: number;
  gameKey: string;
  userId: number;
  /** Who set it. Resolved for display; the scoreboard is shared, not per-user. */
  userName: string;
  score: number;
  moves: number;
  /** ISO-8601 timestamp. */
  playedAt: string;
  createdAt: string;
}

/* ---------------------------------------------------------------------------------
   2048.
--------------------------------------------------------------------------------- */

/** The four moves. */
export const DIRECTIONS = ["up", "down", "left", "right"] as const;

export type Direction = (typeof DIRECTIONS)[number];

/**
 * A 4x4 board, row-major, 16 cells. `0` is an empty cell; every other value is a
 * power of two. A flat array rather than nested rows: every move is expressed as
 * "collapse four lines", and indexing one flat array by a computed offset avoids
 * transposing the board four different ways.
 */
export type Board = readonly number[];

export const BOARD_SIZE = 4;

/** The tile that wins the game — the one the game is named after. */
export const WINNING_TILE = 2048;

/** The result of applying one move to a board. */
export interface MoveResult {
  board: Board;
  /** Sum of every merge this move produced. Added to the running score. */
  gained: number;
  /**
   * Whether anything actually shifted. A move into a wall changes nothing, and a
   * no-op must NOT spawn a tile — otherwise holding a key against an edge fills
   * the board for free.
   */
  moved: boolean;
}

/* ---------------------------------------------------------------------------------
   Arrow Clearing.
--------------------------------------------------------------------------------- */

/**
 * The three board sizes, each its own catalogue key.
 *
 * Separate keys rather than one game with a difficulty column: the scoreboard is
 * shared and sorts on score alone, so a 5x5 clear and a 9x9 clear posting to the same
 * board would rank a much easier puzzle against a much harder one. Three keys give
 * three honest boards. The ids are stored in `gam_scores.game_key`, so they are
 * permanent once anyone has played.
 */
export const ARROW_DIFFICULTIES = ["easy", "medium", "hard"] as const;

export type ArrowDifficulty = (typeof ARROW_DIFFICULTIES)[number];

/** Board size and arrow count per difficulty. */
export const ARROW_DIFFICULTY_SETUP: Record<
  ArrowDifficulty,
  { size: number; arrows: number; gameKey: string; label: string }
> = {
  easy: { size: 5, arrows: 7, gameKey: "arrow-clearing-easy", label: "Easy (5x5)" },
  medium: { size: 7, arrows: 14, gameKey: "arrow-clearing-medium", label: "Medium (7x7)" },
  hard: { size: 9, arrows: 24, gameKey: "arrow-clearing-hard", label: "Hard (9x9)" },
};

/** The difficulty a catalogue key belongs to, or undefined for a non-arrow game. */
export function arrowDifficultyOf(gameKey: string): ArrowDifficulty | undefined {
  return ARROW_DIFFICULTIES.find(
    (difficulty) => ARROW_DIFFICULTY_SETUP[difficulty].gameKey === gameKey,
  );
}

/** A cell on an arrow board. `row`/`col` are zero-based from the top-left. */
export interface Cell {
  row: number;
  col: number;
}

/**
 * One arrow: a straight run of 1-4 cells that travels as a single piece.
 *
 * `cells` is ordered **head first**, so `cells[0]` is the tip that leads the way out
 * and the rest is the tail behind it. Every collision check walks forward from
 * `cells[0]`, so keeping the order part of the type means no code has to re-derive
 * which end is the head from the direction.
 */
export interface Arrow {
  id: number;
  cells: readonly Cell[];
  direction: Direction;
}

/** How an arrow is currently drawn. Presentation state, kept out of `Arrow`. */
export type ArrowState = "idle" | "flying" | "blocked" | "cleared";

/** A puzzle: the grid size and the arrows still on it. */
export interface ArrowBoard {
  size: number;
  arrows: readonly Arrow[];
}

/** A generated puzzle plus the clearing order that is known to solve it. */
export interface ArrowPuzzle {
  board: ArrowBoard;
  /**
   * Arrow ids in an order that clears the board — the reverse of the order they were
   * shot in. Used by the Hint button and by the tests that prove solvability; never
   * shown to the player wholesale.
   */
  solution: readonly number[];
}
