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
 * How many wrong taps a run survives.
 *
 * A tap on a blocked arrow costs one, and at zero the run is over. This replaced a
 * silent points penalty, which let a player brute-force a board by tapping everything
 * — the tension in this puzzle comes from a wrong move actually costing something.
 *
 * The game this mechanic is taken from ("Arrows – Puzzle Escape") gives three and then
 * offers an ad to continue. Five here, and the run simply ends: there are no ads in
 * this app, so a hard stop at three with no way back would just be harsher than the
 * original rather than equivalent to it.
 */
export const ARROW_LIVES = 5;

/**
 * The board tiers, each its own catalogue key.
 *
 * **There is one tier.** It started as three (5x5 / 7x7 / 9x9) and the two smaller ones
 * were withdrawn in migration 0077: even the 9x9 was no challenge, so an easier board
 * below it was pointless, and three cards on the Arcade implied a difficulty ladder the
 * game did not have.
 *
 * Kept as a one-element list rather than deleted outright, so `ArrowDifficulty`,
 * `arrowDifficultyOf` and the per-tier catalogue mapping all survive: adding a tier
 * back is then a line here plus a catalogue entry, where rebuilding the concept from
 * scratch would be a refactor.
 *
 * The ids are stored in `gam_scores.game_key`, so they are permanent once anyone has
 * played. That is why the surviving key is still `arrow-clearing-hard` even though the
 * label no longer says "Hard" — renaming it would orphan every score already posted.
 */
export const ARROW_DIFFICULTIES = ["hard"] as const;

export type ArrowDifficulty = (typeof ARROW_DIFFICULTIES)[number];

/**
 * Board size and arrow count per tier.
 *
 * 50x50 with a target of 1500, which saturates at **~359 arrows** over ~71% of the board
 * — roughly 360 taps to clear, and about 33x the ~11-arrow board this briefly shrank to.
 *
 * `arrows` is a ceiling the generator is not expected to reach. It stops when no legal
 * placement is left, and that saturation point is a property of the board *size*, not of
 * this number: at 18x18 a target of 120 and a target of 170 both settled at 84 arrows.
 * **To get more arrows, grow the board — not this.**
 *
 * A board this size is only viable because generation is O(1) per candidate rather than
 * walking each exit path — see `OccupancyGrid` in `game-arrows.ts`. Before that, 50x50
 * took **16 seconds** and would have frozen the tab on "New board"; it now takes ~41ms.
 *
 * History, because this has been wrong in both directions. It shipped as 9x9/40: ~22
 * tangled pieces against five lives, effectively unwinnable, and a player running out of
 * lives with most of the board standing looks exactly like a broken generator.
 * Overcorrecting to 7x7/14 made it winnable but trivial — eleven arrows is eleven taps.
 * Size is now driven by how long a board should take to clear, and difficulty by the
 * generator's placement rules rather than by scarcity.
 */
export const ARROW_DIFFICULTY_SETUP: Record<
  ArrowDifficulty,
  { size: number; arrows: number; gameKey: string; label: string }
> = {
  hard: { size: 50, arrows: 1500, gameKey: "arrow-clearing-hard", label: "50x50" },
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
 * One arrow: a contiguous, non-self-crossing run of cells that travels as one piece.
 *
 * The run **may turn** — most are winding paths of up to `MAX_ARROW_LENGTH` cells
 * rather than straight sticks, which is what makes a board read as a maze.
 *
 * `cells` is ordered **head first**, so `cells[0]` is the tip that leads the way out
 * and the rest is the tail trailing behind it, each cell orthogonally adjacent to the
 * one before. Every collision check walks forward from `cells[0]`, so keeping the order
 * part of the type means no code has to re-derive which end is the head.
 *
 * `direction` is the **head's** exit direction — the way the piece leaves the board —
 * not the orientation of the whole run, which for a winding path has no single answer.
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

/* ---------------------------------------------------------------------------------
   Tetris.
--------------------------------------------------------------------------------- */

/**
 * The seven tetrominoes, by their conventional letters.
 *
 * These letters are the standard names for the shapes and are used as keys into the
 * rotation table and the colour ramp, so they are not free-form labels.
 */
export const PIECE_KINDS = ["I", "O", "T", "S", "Z", "J", "L"] as const;

export type PieceKind = (typeof PIECE_KINDS)[number];

/** Playfield width in cells. Ten is the standard board and the rotation tables assume it. */
export const PLAYFIELD_WIDTH = 10;

/**
 * Visible playfield height in cells.
 *
 * Twenty is the standard visible board. Pieces spawn *above* it (see `SPAWN_ROW`), so
 * the grid actually stored is taller than this — `PLAYFIELD_HEIGHT` is what the view
 * draws, not what the state holds.
 */
export const PLAYFIELD_HEIGHT = 20;

/**
 * Hidden rows above the visible playfield, where a piece spawns.
 *
 * A spawning I or O occupies two rows, and a board with no buffer would either draw a
 * piece half-clipped at the top or declare game-over the moment the stack reached row
 * 0. Two buffer rows is the usual allowance and is enough for every spawn orientation.
 */
export const BUFFER_ROWS = 2;

/** Total stored grid height: the visible board plus the hidden spawn buffer. */
export const TOTAL_HEIGHT = PLAYFIELD_HEIGHT + BUFFER_ROWS;

/**
 * The four rotation states, clockwise from spawn.
 *
 * Numeric rather than named because rotation is modular arithmetic — turning right is
 * `(rotation + 1) % 4`, and the wall-kick table is indexed by the pair of states being
 * moved between.
 */
export type Rotation = 0 | 1 | 2 | 3;

/** A cell in the playfield grid. `row` 0 is the top of the *stored* grid (in the buffer). */
export interface PieceCell {
  row: number;
  col: number;
}

/**
 * The piece in play: what it is, where it is, and which way up.
 *
 * Position is the piece's **origin** — the top-left of its rotation box, not of its
 * filled cells — because a rotation box is what the offset tables are written against.
 * `cellsOf` turns the three together into occupied cells; nothing else should.
 */
export interface ActivePiece {
  kind: PieceKind;
  rotation: Rotation;
  row: number;
  col: number;
}

/**
 * The playfield: `TOTAL_HEIGHT` rows of `PLAYFIELD_WIDTH` cells, row-major.
 *
 * `undefined` is an empty cell; anything else is the kind of the piece that locked
 * there, kept so a settled stack still draws in its own colours. A flat array for the
 * same reason 2048's `Board` is one — every collision test is an index computation.
 */
export type Playfield = readonly (PieceKind | undefined)[];

/** Why a run ended, or `undefined` while it is still going. */
export type TetrisOutcome = "topped-out" | undefined;

/**
 * The line clear a lock just produced, for the view to animate.
 *
 * Carried on the state rather than derived, because it cannot be derived: by the time
 * a state with cleared lines exists, the rows are gone from `field` and nothing is
 * left to say where they were. The library still decides no timing and no styling —
 * it only reports what happened, and the view chooses how to draw it.
 */
export interface LineClear {
  /** Row indexes that were full, in the coordinates of `field` below. */
  rows: readonly number[];
  /**
   * The board WITH the completed rows still on it.
   *
   * The animation shows what is being destroyed, so it needs the pre-clear board; the
   * state's own `field` has already dropped those rows and shifted everything down.
   */
  field: Playfield;
  /**
   * Distinguishes one clear from the next.
   *
   * Two clears of the same rows produce identical values, and React would see no
   * change — so the animation would not restart. This is the piece count at the lock,
   * which is unique per clear and already tracked.
   */
  id: number;
}

/**
 * A whole game, as one immutable value.
 *
 * Every rule in `game-tetris.ts` takes one of these and returns the next — including
 * gravity, which is `tick`. That is what keeps the clock out of the rules: a test
 * calls `tick` directly and never waits for a real timer.
 */
export interface TetrisState {
  field: Playfield;
  active: ActivePiece;
  /**
   * The upcoming pieces, soonest first. Refilled a bag at a time — see `SevenBag` in
   * `game-tetris.ts` for why this is not just `random()` per piece.
   */
  queue: readonly PieceKind[];
  /** The held piece, or `undefined` if the hold slot is still empty. */
  hold: PieceKind | undefined;
  /**
   * Whether hold has already been used for the current piece.
   *
   * Without this, hold swaps back and forth forever and gravity never advances — the
   * standard rule is one hold per piece, re-armed when the next piece spawns.
   */
  holdUsed: boolean;
  score: number;
  lines: number;
  level: number;
  /** How many pieces have locked. Reported as `moves` on the scoreboard. */
  pieces: number;
  /**
   * The clear the most recent lock produced, or `undefined` if it cleared nothing.
   *
   * Purely a report for the view; no rule reads it. Reset to `undefined` by the next
   * lock that clears nothing, so a stale value cannot replay an old animation.
   */
  lastClear: LineClear | undefined;
  /**
   * Frames the active piece has been resting on the stack without locking.
   *
   * A counter rather than a timestamp so lock delay is testable without a clock: a
   * test ticks `LOCK_DELAY_TICKS + 1` times and asserts the piece locked.
   */
  restingTicks: number;
  outcome: TetrisOutcome;
}

/**
 * Points for clearing 1-4 lines at once, before the level multiplier.
 *
 * The classic Nintendo table. The jump from 500 to 800 for a fourth line is the whole
 * reason to stack deep rather than clear singles, so it is the one number here that
 * changes how the game is played.
 */
export const LINE_SCORES: Record<number, number> = { 1: 100, 2: 300, 3: 500, 4: 800 };

/** Points per cell dropped, for a soft drop and a hard drop respectively. */
export const SOFT_DROP_POINTS = 1;
export const HARD_DROP_POINTS = 2;

/** Lines cleared per level. Ten is the standard rate. */
export const LINES_PER_LEVEL = 10;

/**
 * Ticks a piece may rest on the stack before it locks.
 *
 * Not zero: a piece that locked the instant it landed would make it impossible to
 * slide one under an overhang, which is a move the game is expected to allow.
 */
export const LOCK_DELAY_TICKS = 2;
