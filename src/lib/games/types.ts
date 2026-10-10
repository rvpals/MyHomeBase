import type { Card } from "./playing-cards";
import type { Tile } from "./mahjong-tiles";

/**
 * The Games module's domain types.
 *
 * A game is identified by a `GameKey` — a string that names code, not a database
 * row. See `catalogue.ts` for why the catalogue is not a table.
 *
 * Two exceptions to "the types live here": the deck primitives are in
 * `playing-cards.ts` and the mahjong tile primitives in `mahjong-tiles.ts`, because
 * neither belongs to a single game. See the note in the Blackjack section below.
 */

// Re-exported so `@/lib/games` presents one surface and a caller need not know which
// file a card type came from.
export type { Card, Random as CardRandom, Rank, Suit } from "./playing-cards";

// The same for the tile set, which no game owns either. `Random` is the same structural
// type as the deck's, so it is not re-exported a second time under another name.
export type {
  Dragon,
  Flower,
  Season,
  Tile,
  TileKind,
  TileRank,
  TileSuit,
  Wind,
} from "./mahjong-tiles";

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
 * The board tiers, in ascending difficulty.
 *
 * Three tiers behind **one** Arcade card, with the picker inside the game — the shape
 * Sudoku and Minesweeper use. It briefly had three *cards* (5x5 / 7x7 / 9x9), withdrawn
 * in migration 0077 because three cards for one game meant three scoreboards and implied
 * a ladder the generator did not actually have. The ladder is real now, so the tiers are
 * back; the one-card shape is what stays.
 *
 * Each tier still keeps **its own** `gameKey`, so a Nightmare clear is not ranked against
 * a Hard one — they are different amounts of work. Those ids live in
 * `gam_scores.game_key` and are permanent once anyone has played, which is why the entry
 * tier is still keyed `arrow-clearing-hard` even though it is now the *easiest* of three.
 * Renaming it would orphan every score already posted, exactly as renaming an icon slot
 * id orphans an upload.
 */
export const ARROW_DIFFICULTIES = ["hard", "harder", "nightmare"] as const;

export type ArrowDifficulty = (typeof ARROW_DIFFICULTIES)[number];

/**
 * Board size, arrow count and generator tuning per tier.
 *
 * **Every tier is 50x50.** The ladder is in how the arrows are *shaped*, not in how big
 * the grid is — growing the board would also grow the tap-precision problem the zoom
 * controls exist to solve, and a bigger grid mostly adds scrolling rather than
 * difficulty. See `lengthWeights` and `straightBias`.
 *
 * `arrows` is a ceiling the generator is not expected to reach. It stops when no legal
 * placement is left, and that saturation point is a property of the board *size*, not of
 * this number: at 18x18 a target of 120 and a target of 170 both settled at 84 arrows.
 * **To get more arrows, grow the board — not this.** Note the higher tiers settle at
 * *fewer* pieces for the same coverage, because each piece is longer.
 *
 * ## Why a finished board has gaps in it, and what actually shrinks them
 *
 * A board stops filling at ~70% coverage, and the leftover space is **not** space the
 * generator failed to search. Every placement needs a clear straight exit lane at the
 * moment it is made, so as the board fills the surviving free cells get walled in.
 * Measured on a finished 50x50 Nightmare board: of 1166 free cells, **only 7 still had a
 * clear line to any edge.** The other 1159 are enclosed — an arrow placed in one could
 * never leave, so putting one there would break the solvability guarantee outright.
 *
 * Two things that look like the fix and are not:
 *
 * - **Raising `arrows`.** Generation already stops before reaching the target. Measured:
 *   no change whatsoever (Nightmare sat at 220 arrows with a target of 900 and of 2000).
 * - **Widening the search past the depth band** in `findPlacement`. Tried, and it made
 *   boards *worse* — 205 arrows down to 151, with larger voids — because the wider pool
 *   returns short shallow near-misses that burn a placement a better spot could have
 *   used. There is a note at that code saying so.
 *
 * What does work is **arrow length**: a maximal arrow walls off much more ground than it
 * covers, so a tier whose weights ramp straight to the 12-cell cap produces the biggest
 * voids. Peaking in the middle of the long range keeps pieces long while roughly halving
 * the empty regions. That is why Nightmare's weights are shaped the way they are.
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
  {
    size: number;
    arrows: number;
    gameKey: string;
    label: string;
    /**
     * How often each arrow length is aimed for, as relative weights indexed by length.
     *
     * Index 0 is unused so a length reads as its own index. **Index 1 is zero on every
     * tier**: a single-cell arrow draws as a bare arrowhead with no line behind it, which
     * reads as a stray glyph rather than a piece of the maze. See `MIN_ARROW_LENGTH`.
     *
     * The tiers differ only in where the mass sits. Hard is weighted toward short, which
     * is what gives it texture at the cost of a lot of two-cell pieces; the higher tiers
     * move the mass up the scale, so clearing one piece sweeps a long run off the board
     * rather than nibbling a corner. That is the whole point of the ladder — a long arrow
     * leaving is the satisfying part.
     */
    lengthWeights: readonly number[];
    /**
     * How strongly a growing tail prefers to carry straight on, in [0, 1).
     *
     * 0 is the original behaviour: at each step the tail picks a random free neighbour,
     * which produces the tangled, knotted pieces of the entry tier. At 0.8 the tail
     * continues in the direction it was already going whenever that cell is free, so
     * pieces come out as long clean runs with the occasional deliberate bend.
     *
     * This is the "less entangled" half of the ladder, and it is deliberately *inverse*
     * to the usual intuition that harder means messier. A knot of short tangled arrows is
     * fiddly rather than hard; a board of long straight runs is harder to *order*, because
     * each piece crosses more of the grid and so blocks more of its neighbours.
     *
     * Not 1.0 even at the top: a tail that can never turn is a straight stick, and
     * `growPath` would stop dead at the first obstacle instead of routing around it,
     * which caps how long pieces can actually get on a filling board.
     */
    straightBias: number;
  }
> = {
  hard: {
    size: 50,
    arrows: 1500,
    gameKey: "arrow-clearing-hard",
    label: "Hard",
    // The original tuning, untouched: this is the board every existing score was set on.
    lengthWeights: [0, 0, 20, 16, 13, 10, 8, 7, 6, 5, 4, 3, 3],
    straightBias: 0,
  },
  harder: {
    size: 50,
    arrows: 1200,
    gameKey: "arrow-clearing-harder",
    label: "Harder",
    // Mass moved off the two-cell end and onto the middle and upper lengths.
    lengthWeights: [0, 0, 3, 5, 8, 11, 13, 14, 14, 13, 12, 11, 10],
    straightBias: 0.55,
  },
  nightmare: {
    size: 50,
    arrows: 900,
    gameKey: "arrow-clearing-nightmare",
    label: "Nightmare",
    /*
      Long runs, peaking at 8-9 cells rather than running flat-out to the 12 cap.

      The first attempt did ramp straight to the cap (`…18, 20, 22, 24` with bias 0.8)
      and it looked wrong on the board: mean length was higher (7.89) but it left
      **large empty regions** — 42 fully-empty 5x5 neighbourhoods a board, with gaps up
      to 24 cells wide. A maximal arrow walls off far more ground than it covers, so the
      enclosed-cell problem below bites hardest exactly when every piece is maximal.

      Peaking in the middle of the long range instead keeps the pieces long (7.21 mean,
      barely changed) while halving the voids to 20 and the worst gap to 18, and it fits
      *more* arrows on the board (240 against 221). Index 2 is zero here, not just index
      1: on this tier a two-cell stub is the shape the ladder exists to remove, and
      cramped spots have the 3-cell weight to fall back on.
    */
    lengthWeights: [0, 0, 0, 2, 4, 7, 11, 14, 16, 15, 13, 10, 8],
    straightBias: 0.7,
  },
};

/**
 * The difficulty a catalogue key belongs to, or undefined for a non-arrow game.
 *
 * The Arcade no longer uses it — with one card and the picker inside the game, the view
 * owns the tier. What does use it is the scoreboard: `gam_scores` stores one key per
 * tier, so `scoreCardKey` and `scoreGameName` need this to turn a stored
 * `arrow-clearing-nightmare` back into a catalogue entry it can name and draw an icon
 * for. Changing it changes how the Scores table reads.
 */
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

/**
 * Playfield width in cells.
 *
 * Fourteen rather than the standard ten: this board is deliberately roomier, which
 * makes a line harder to complete and a game longer to lose. `LINE_SCORES` is scaled to
 * match — see the note there.
 *
 * Nothing here assumes a particular width. The rotation kicks are *relative* offsets,
 * and `spawnPiece` centres by arithmetic, so both follow this constant. (An earlier
 * comment claimed the rotation tables assumed ten; they do not.)
 */
export const PLAYFIELD_WIDTH = 14;

/**
 * Visible playfield height in cells.
 *
 * Twenty-four rather than the standard twenty, for the same reason the board is wider.
 * Pieces spawn *above* it (see `SPAWN_ROW`), so the grid actually stored is taller than
 * this — `PLAYFIELD_HEIGHT` is what the view draws, not what the state holds.
 */
export const PLAYFIELD_HEIGHT = 24;

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
 * The classic Nintendo table (100/300/500/800) scaled by 1.4, because this board is
 * `PLAYFIELD_WIDTH` 14 rather than the standard 10: a line takes 40% more cells to
 * complete, so an unscaled table would quietly pay 40% less per unit of work and make
 * every score incomparable with the classic game's for the wrong reason.
 *
 * The *ratios* are untouched, which is the part that matters — the jump to a fourth
 * line is still the whole reason to stack deep rather than clear singles, and it is the
 * one number here that changes how the game is played.
 */
export const LINE_SCORES: Record<number, number> = { 1: 140, 2: 420, 3: 700, 4: 1120 };

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

/* ---------------------------------------------------------------------------------
   Sudoku.
--------------------------------------------------------------------------------- */

/** Side of the grid, and of one box. Nine and three — the game is not parameterised. */
export const SUDOKU_SIZE = 9;
export const SUDOKU_BOX = 3;

/** Cells in a full grid. Named because it is the length every grid array must have. */
export const SUDOKU_CELL_COUNT = SUDOKU_SIZE * SUDOKU_SIZE;

/**
 * A digit a cell can hold: 1-9, or `0` for an empty cell.
 *
 * `0` rather than `undefined` for empty, unlike Tetris's `Playfield`, because a
 * solver fills and unfills cells constantly and `0` makes "is this cell empty" a
 * numeric test in the innermost loop of `countSolutions`.
 */
export type SudokuDigit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * A grid, row-major, 81 cells — the same flat-array trade as 2048's `Board`: every
 * row, column and box check is an index computation rather than a reshape.
 */
export type SudokuGrid = readonly SudokuDigit[];

/** The three boards on offer. Stored nowhere — one catalogue key covers all three. */
export const SUDOKU_DIFFICULTIES = ["easy", "medium", "hard"] as const;

export type SudokuDifficulty = (typeof SUDOKU_DIFFICULTIES)[number];

/**
 * Clues left on the board, and what solving it is worth, per difficulty.
 *
 * `clues` is a target the remover works down to and may miss by a cell or two: it only
 * removes a digit when the puzzle still has exactly one solution, so a stubborn grid
 * stops early. That bound is the point — a puzzle with two solutions is not a Sudoku,
 * and "guess which one I meant" is the single worst way this game can break.
 *
 * 17 is the proven minimum for a unique 9x9, so `hard` at 26 stays well clear of the
 * pathological end where a board needs techniques this UI gives no help with.
 *
 * `base` is the score for an instant solve; see `SUDOKU_TIME_PENALTY` for the decay.
 * Hard is worth ~2.5x easy, so a slow hard board still beats a fast easy one — the
 * ladder exists to be climbed, not to be farmed at the bottom.
 */
export const SUDOKU_SETUP: Record<
  SudokuDifficulty,
  { clues: number; base: number; label: string }
> = {
  easy: { clues: 44, base: 2000, label: "Easy" },
  medium: { clues: 34, base: 3500, label: "Medium" },
  hard: { clues: 26, base: 5000, label: "Hard" },
};

/**
 * Points lost per second elapsed, and per mistake.
 *
 * **Sudoku scores points, not seconds, and this is the reason.** The shared scoreboard
 * ranks `ORDER BY score DESC` (`repository.ts`) and `getBestScore` takes the top row,
 * so a time in seconds would crown the *slowest* player of the house. Converting time
 * into points here keeps faster = higher and leaves the board every other game shares
 * completely untouched. `scoreUnit` is therefore `"points"` for Sudoku even though the
 * unit `"seconds"` exists in this file — nothing ranks by it.
 *
 * A mistake costs 100, about 25 seconds, so guessing is worse than thinking but a
 * single slip does not end the run. There is no mistake limit: a Sudoku is a puzzle
 * with one right answer, and locking someone out three cells from the end teaches
 * nothing that a dented score does not.
 */
export const SUDOKU_TIME_PENALTY = 4;
export const SUDOKU_MISTAKE_PENALTY = 100;

/**
 * Points lost per hint taken.
 *
 * Hints are **unlimited**, so this penalty is the only thing stopping a player from
 * having the board filled in for them. It is therefore priced above a mistake: 250 is
 * about 62 seconds, or two and a half wrong guesses. A wrong guess still leaves you to
 * work out the right answer; a hint hands it over, so it has to cost more.
 *
 * There is deliberately no hint cap. A cap would make the last hint on a hard board
 * feel like a resource to hoard rather than a decision to weigh, and the price already
 * does the job — see `SUDOKU_MIN_SCORE`, whose floor is lifted for a hinted board so
 * that hinting your way to the end cannot bank a consolation score.
 */
export const SUDOKU_HINT_PENALTY = 250;

/**
 * The least a solved board can score, however long it took.
 *
 * Without a floor, `base - elapsed * penalty` goes negative on a long session and a
 * finished puzzle would record 0 — indistinguishable from not having played, and a
 * dispiriting reward for grinding out a hard board. A finish is always worth something.
 *
 * **The floor is for time and mistakes, not for hints.** It applies only to a board
 * solved with no hints; see `scoreGame`. Hints being unlimited, a floor that survived
 * them would mean tapping Hint 81 times still scored `SUDOKU_MIN_SCORE`, which is a
 * guaranteed payout for not playing. A hinted board can score all the way to 0.
 */
export const SUDOKU_MIN_SCORE = 100;

/**
 * A cell as the player sees it.
 *
 * `given` marks a starting clue: it is never editable and never wrong, which is why it
 * is a flag here rather than derived by comparing against the puzzle later — the view
 * asks the cell, not the history.
 *
 * `notes` are the pencilled candidates, as a set of digits. Kept per cell rather than
 * in one board-wide map so that clearing a cell clears its notes with it.
 *
 * `hinted` marks a digit the game supplied rather than the player. It is NOT `given`:
 * a hint lands mid-game and stays editable-looking to the rules that matter, so the
 * two flags answer different questions — `given` is "was this on the board to begin
 * with", `hinted` is "did I work this one out". Only the view reads it, to tint the
 * cell so you can see what you were handed.
 */
export interface SudokuCell {
  value: SudokuDigit;
  given: boolean;
  notes: readonly number[];
  hinted: boolean;
}

/** Why a run ended, or `undefined` while it is still going. */
export type SudokuOutcome = "solved" | undefined;

/**
 * A whole game, as one immutable value — the same shape of state as `TetrisState`.
 *
 * `solution` rides along so a wrong entry can be judged the instant it is typed,
 * without re-running the solver on every keystroke. It is client state either way:
 * the board is not persisted mid-game (see the note in `games-arcade-view.tsx`), so
 * there is nothing to leak to a player who does not already have it in their tab.
 *
 * `elapsedSeconds` is carried on the state rather than read from a clock, so scoring
 * is testable without waiting: the view ticks it once a second, a test sets it.
 */
export interface SudokuState {
  difficulty: SudokuDifficulty;
  cells: readonly SudokuCell[];
  solution: SudokuGrid;
  /** Wrong digits entered so far, across the whole run. Reported as `moves`. */
  mistakes: number;
  /** Digits entered so far, right or wrong. Drives nothing; shown as progress. */
  filled: number;
  /**
   * Hints taken so far. Unlimited, but each one costs `SUDOKU_HINT_PENALTY` and any
   * hint at all lifts the score floor — so this is a running tally, not a budget.
   */
  hints: number;
  elapsedSeconds: number;
  outcome: SudokuOutcome;
}

/* ---------------------------------------------------------------------------------
   Blackjack.
--------------------------------------------------------------------------------- */

/*
 * The deck itself — `Card`, `Rank`, `Suit`, `SUITS`, `RANKS` — lives in
 * `playing-cards.ts`, not here. Nothing about a deck is specific to Blackjack, and the
 * shared `PlayingCard` / `CardHand` components render from those types: a component
 * importing a Blackjack-owned `Card` would only look reusable.
 *
 * They are re-exported below so `@/lib/games` still exposes one surface.
 */

/**
 * Decks in the shoe.
 *
 * Six is the usual casino shoe. It matters here for one reason only: with a single
 * deck, counting what has gone is easy enough to change how the game is played, and
 * this game deliberately offers no help with that. Six also means a reshuffle is rare
 * enough not to interrupt.
 */
export const DECKS_IN_SHOE = 6;

/**
 * Cards left in the shoe below which it is rebuilt.
 *
 * A round can need a surprising number of cards — two hands after a split, each drawn
 * out — so the shoe is replaced between rounds while it still has plenty, rather than
 * risking running dry mid-hand. Reshuffling between rounds also means no hand is ever
 * dealt across a shuffle, which would be its own small unfairness.
 */
export const SHOE_RESHUFFLE_AT = 15 * DECKS_IN_SHOE;

/** Chips a run starts with. Round and generous enough to survive a bad opening streak. */
export const BLACKJACK_STARTING_CHIPS = 1000;

/**
 * The smallest and largest bet, and the step the bet control moves in.
 *
 * A maximum exists so a run cannot be decided by one all-in hand: without it the
 * highest-scoring strategy is to bet everything on the first hand and either double
 * the record or bust in one move, which is a coin flip rather than a game. The cap is
 * a share of the *starting* bankroll rather than the current one, so it does not creep
 * upwards as a run goes well.
 */
export const BLACKJACK_MIN_BET = 25;
export const BLACKJACK_MAX_BET = 250;
export const BLACKJACK_BET_STEP = 25;

/** What a hand is worth. Twenty-one, and the dealer's standing total. */
export const BLACKJACK_TARGET = 21;

/**
 * The total the dealer must reach before standing.
 *
 * The dealer stands on **all** 17s, soft ones included — see `dealerPlay`. Hitting a
 * soft 17 is the other common house rule and is slightly worse for the player; the
 * simpler rule is also the one with fewer special cases to get wrong.
 */
export const DEALER_STANDS_ON = 17;

/**
 * What a natural blackjack pays, as a multiple of the bet.
 *
 * 3:2 — the traditional payout. The 6:5 tables now common in casinos are a house-edge
 * increase dressed as a rule, and there is no house here to favour.
 */
export const BLACKJACK_PAYOUT = 1.5;

/** How a settled hand finished, or `undefined` while it is still being played. */
export type HandResult = "blackjack" | "win" | "push" | "lose" | "bust";

/**
 * One hand of cards and the chips riding on it.
 *
 * A list rather than a single hand on the state, because a split turns one hand into
 * two that are played out in turn and settled separately. `bet` lives per hand for
 * the same reason: a split copies the original stake onto the new hand, and a double
 * doubles only the hand it was played on.
 */
export interface Hand {
  cards: readonly Card[];
  bet: number;
  /** Whether this hand doubled down. It may take exactly one more card, then stands. */
  doubled: boolean;
  /**
   * Whether this hand came from a split.
   *
   * A split hand that reaches 21 is 21, **not** a blackjack: a natural is two cards
   * off the deal, and paying 3:2 on a split ace-ten would make splitting aces the only
   * bet worth making. See `isBlackjack`.
   */
  fromSplit: boolean;
  /** Set when the hand is settled; `undefined` while it is in play. */
  result: HandResult | undefined;
}

/**
 * Where a round is up to.
 *
 * `betting` — no cards out, the player is choosing a stake.
 * `playing` — the player is acting on `activeHand`.
 * `dealer`  — every player hand is finished and the dealer is drawing.
 * `settled` — the round is scored and the chips have moved; next deal is allowed.
 *
 * A phase rather than a set of booleans because these are mutually exclusive and the
 * view switches its whole control row on them. Booleans would permit "betting and
 * dealer at once", which is not a state this game has.
 */
export type BlackjackPhase = "betting" | "playing" | "dealer" | "settled";

/** Why a run ended, or `undefined` while it can still continue. */
export type BlackjackOutcome = "cashed-out" | "broke" | undefined;

/**
 * A whole run, as one immutable value — the same shape as `TetrisState` and
 * `SudokuState`.
 *
 * A run is a **bankroll**, not a hand: it starts at `BLACKJACK_STARTING_CHIPS` and
 * ends when the player cashes out or cannot cover the minimum bet. That is what gives
 * the game a score worth ranking — "hands won" would be a grind counter, where a chip
 * count rewards knowing when to stop.
 */
export interface BlackjackState {
  /** The undealt cards, next card first. Rebuilt when it runs low; see `SHOE_RESHUFFLE_AT`. */
  shoe: readonly Card[];
  /**
   * The player's hands, left to right. One, or two after a split.
   *
   * Empty while `phase` is `betting` — there are no cards on the table before a deal.
   */
  hands: readonly Hand[];
  /** Which hand the player is acting on. Meaningless unless `phase` is `playing`. */
  activeHand: number;
  /**
   * The dealer's cards. The second is face down to the player until the dealer plays;
   * that is a *view* concern — the state holds the real card, and `dealerUpcard`
   * exposes only what the player is entitled to see.
   */
  dealer: readonly Card[];
  chips: number;
  /** The stake for the next deal, carried between rounds so it need not be re-picked. */
  bet: number;
  /** Hands played to a finish. Reported as `moves` on the scoreboard. */
  handsPlayed: number;
  /** The highest the bankroll has ever been this run. Shown so a peak is not forgotten. */
  peakChips: number;
  outcome: BlackjackOutcome;
  phase: BlackjackPhase;
}

/* ---------------------------------------------------------------------------------
   Minesweeper.
--------------------------------------------------------------------------------- */

/** The three boards on offer. One catalogue key covers all three, as with Sudoku. */
export const MINESWEEPER_DIFFICULTIES = ["beginner", "intermediate", "expert"] as const;

export type MinesweeperDifficulty = (typeof MINESWEEPER_DIFFICULTIES)[number];

/**
 * Board dimensions, mine count and what clearing it is worth, per difficulty.
 *
 * The three classic sizes, unchanged: 9x9/10, 16x16/40 and 30x16/99. They are not
 * arbitrary — the mine densities (12%, 16%, 21%) are what make the three boards feel
 * like a ladder rather than the same game at three scales, and a player who knows
 * Minesweeper knows these numbers. Inventing our own would make a record here
 * incomparable to the game everyone has already played.
 *
 * `base` is the score for an instant clear; see `MINESWEEPER_TIME_PENALTY` for the
 * decay. Expert is worth 4x beginner, a steeper ladder than Sudoku's 2.5x because the
 * mine density — not just the cell count — is what climbs: an expert board cannot be
 * ground out by a patient beginner the way a hard Sudoku can.
 */
export const MINESWEEPER_SETUP: Record<
  MinesweeperDifficulty,
  { cols: number; rows: number; mines: number; base: number; label: string }
> = {
  beginner: { cols: 9, rows: 9, mines: 10, base: 1500, label: "Beginner" },
  intermediate: { cols: 16, rows: 16, mines: 40, base: 3500, label: "Intermediate" },
  expert: { cols: 30, rows: 16, mines: 99, base: 6000, label: "Expert" },
};

/**
 * Points lost per second elapsed.
 *
 * **Minesweeper scores points, not seconds, for the reason Sudoku does** — the shared
 * board ranks `ORDER BY score DESC` (`repository.ts`), so a time in seconds would put
 * the slowest player of the house on top. Time is converted into points here and
 * `scoreUnit` stays `"points"`, leaving the board every other game shares untouched.
 *
 * 3 a second, slightly gentler than Sudoku's 4: an expert board is 480 cells and the
 * flagging alone is real work, so the decay has to leave a careful clear worth more
 * than a lucky fast one.
 */
export const MINESWEEPER_TIME_PENALTY = 3;

/**
 * The least a cleared board can score, however long it took.
 *
 * Same reasoning as `SUDOKU_MIN_SCORE`: without a floor a long expert grind goes
 * negative and records 0, which is indistinguishable from having hit a mine. A clear
 * is always worth something.
 */
export const MINESWEEPER_MIN_SCORE = 100;

/**
 * A cell as the player sees it.
 *
 * `adjacent` is precomputed when the mines are laid rather than counted on reveal:
 * the flood fill in `reveal` visits a cell's neighbours anyway, and re-deriving the
 * count per visit turns each step into eight extra lookups on a 480-cell board.
 *
 * `mine` is on the state, not hidden from it. The board is client state and is never
 * persisted mid-game (see the note in `games-arcade-view.tsx`), so there is nothing
 * here a player with their own dev tools does not already have — the same trade
 * `SudokuState.solution` makes.
 */
export interface MinesweeperCell {
  mine: boolean;
  revealed: boolean;
  flagged: boolean;
  /** Mines in the eight surrounding cells, 0-8. Meaningless when `mine` is true. */
  adjacent: number;
}

/** Why a run ended, or `undefined` while it is still going. */
export type MinesweeperOutcome = "cleared" | "hit-mine" | undefined;

/**
 * A whole game, as one immutable value — the same shape as `SudokuState`.
 *
 * `cells` is row-major and flat, 2048's and Sudoku's trade again: every neighbour
 * lookup is index arithmetic rather than a reshape, and the flood fill pushes indexes
 * onto a stack rather than coordinate pairs.
 *
 * **`mined` is false until the first reveal.** A fresh board has dimensions and
 * nothing else; `reveal` lays the mines on the first click, excluding that cell and
 * its neighbours. That is what makes the opening move safe rather than a coin flip —
 * see `startGame` and `layMines`.
 *
 * `elapsedSeconds` is carried here rather than read from a clock, so scoring is
 * testable without waiting: the view ticks it once a second, a test sets it.
 */
export interface MinesweeperState {
  difficulty: MinesweeperDifficulty;
  cols: number;
  rows: number;
  mines: number;
  cells: readonly MinesweeperCell[];
  /** Whether the mines have been laid. False on a fresh board; see `reveal`. */
  mined: boolean;
  /** Cells uncovered so far. Drives the win test; shown as progress. */
  revealed: number;
  /** Flags placed, right or wrong. Reported as `moves`, and drives the mine counter. */
  flags: number;
  elapsedSeconds: number;
  outcome: MinesweeperOutcome;
}

/* -----------------------------------------------------------------------------------
   Mahjong Match — the classic tile-matching solitaire.

   The tile set itself is NOT here. `Tile`, `TileSuit`, the 144 tiles and `tilesMatch`
   live in `mahjong-tiles.ts`, because a tile set belongs to no single game — the same
   split `playing-cards.ts` makes for the deck. What lives here is what *this* game
   adds: where a tile sits in the stack, when it is free to lift, and what a clear is
   worth.
----------------------------------------------------------------------------------- */

/** The three boards, as the difficulty picker offers them. */
export const MAHJONG_MATCH_DIFFICULTIES = ["easy", "classic", "hard"] as const;

export type MahjongMatchDifficulty = (typeof MAHJONG_MATCH_DIFFICULTIES)[number];

/**
 * A tile's position in the stack.
 *
 * `layer` counts up from the table, so 0 is the bottom and a higher layer sits on top.
 * `col` and `row` are in **half-steps**, which is the detail that makes a real turtle
 * possible: the classic layout offsets some rows by half a tile, and the four-tile cap
 * on top of the turtle sits between the columns below it. Integer coordinates cannot
 * express that, and a layout that cannot offset is a rectangle rather than a turtle.
 *
 * So a tile occupies `[col, col + 2)` and `[row, row + 2)` in these units, and two
 * tiles overlap when their spans overlap in both axes — which is exactly what
 * `isFree`'s blocking test needs, and why the unit is half a tile rather than a whole
 * one.
 */
export interface TilePosition {
  layer: number;
  col: number;
  row: number;
}

/**
 * A tile on the board: what it is, where it sits, and whether it has gone.
 *
 * `tile` carries the face; `position` carries the geometry. Kept as two fields rather
 * than a flattened row because `tile` is the shared `Tile` from `mahjong-tiles.ts` and
 * must stay exactly that — the moment this game spreads a tile's fields into its own
 * shape, `MahjongTile` can no longer render it and the shared component was pointless.
 *
 * `cleared` marks a lifted tile rather than removing it from the array. Two reasons:
 * `undo` needs the tile back in its position, and a slot's index stays stable for a
 * React key across the whole run.
 */
export interface BoardTile {
  tile: Tile;
  position: TilePosition;
  cleared: boolean;
}

/**
 * Board shape and what clearing it is worth, per difficulty.
 *
 * `layout` names the coordinate table in `game-mahjong-match.ts` rather than holding
 * it: the tables are 40-plus positions each and belong beside the code that walks
 * them, while this record is the tuning a reader comes here to compare.
 *
 * **Shuffles are unlimited**, so there is no allowance here. A stuck board is always
 * recoverable, which is what lets the deal be a plain random one — see `startGame`.
 * What stops a player shuffling their way through the game is the price
 * (`MAHJONG_MATCH_SHUFFLE_PENALTY`), the same way Sudoku prices its unlimited hints
 * rather than capping them.
 *
 * `base` is the score for an instant clear; see `MAHJONG_MATCH_TIME_PENALTY`. Hard is
 * worth 3x easy: the tile count doubles and the board is five layers deep rather than
 * two, so far more of it is buried at any moment.
 */
export const MAHJONG_MATCH_SETUP: Record<
  MahjongMatchDifficulty,
  { layout: MahjongLayoutName; base: number; label: string }
> = {
  easy: { layout: "garden", base: 2000, label: "Easy" },
  classic: { layout: "turtle", base: 4500, label: "Classic" },
  hard: { layout: "turtle", base: 6000, label: "Hard" },
};

/**
 * The board figure a player can pick, independently of difficulty.
 *
 * Separate from `MAHJONG_MATCH_SETUP` on purpose. Difficulty is what a clear is *worth*;
 * the figure is what it *looks like* — and they are genuinely independent, because every
 * full figure is the same 144 tiles. Folding them together would mean either six
 * difficulties or a shape nobody can choose.
 *
 * `garden` is absent: it is the 72-tile beginner board, so offering it as a "shape" for
 * a Classic run would silently halve the game.
 */
export const MAHJONG_FIGURES: readonly { layout: MahjongLayoutName; label: string }[] = [
  { layout: "turtle", label: "Turtle" },
  { layout: "pyramid", label: "Pyramid" },
  { layout: "cat", label: "Cat" },
  { layout: "cross", label: "Cross" },
  { layout: "butterfly", label: "Butterfly" },
];

/** The coordinate tables a board can be built from. Defined in `game-mahjong-match.ts`. */
export type MahjongLayoutName =
  | "garden"
  | "turtle"
  | "pyramid"
  | "cat"
  | "cross"
  | "butterfly";

/**
 * Points lost per second elapsed.
 *
 * **Points, not seconds, for the reason Sudoku and Minesweeper are** — the shared board
 * ranks `ORDER BY score DESC` (`repository.ts`), so a time in seconds would put the
 * slowest player in the house on top. Time becomes points here and `scoreUnit` stays
 * `"points"`, leaving the board every game shares untouched.
 *
 * 2 a second, gentler than Minesweeper's 3 and Sudoku's 4. A 144-tile board takes
 * several minutes to clear even played well — most of that time is *looking*, which is
 * the game — so a decay tuned for a 480-cell minefield would leave a good clear worth
 * less than its floor.
 */
export const MAHJONG_MATCH_TIME_PENALTY = 2;

/**
 * Points lost per hint taken.
 *
 * Hints are unlimited, so this price is the only thing stopping a player having the
 * board played for them. Cheaper than Sudoku's 250 because it hands over far less: a
 * Sudoku hint gives a digit that was the whole puzzle, where this only points at one of
 * several pairs already on the table. It is the *looking* it shortcuts, not the solving.
 */
export const MAHJONG_MATCH_HINT_PENALTY = 100;

/**
 * Points lost per shuffle.
 *
 * Priced well above a hint: a shuffle rescues a board that was otherwise dead, which is
 * worth more than being shown a pair you could have found.
 *
 * **Unlimited**, like a Sudoku hint, so this price is the only thing rationing it. A cap
 * would make the last shuffle on a hard board a resource to hoard rather than a decision
 * to weigh — and worse, a capped shuffle plus a random deal could leave a board that
 * genuinely cannot be finished, which is the one failure a puzzle must never have.
 */
export const MAHJONG_MATCH_SHUFFLE_PENALTY = 400;

/**
 * The least a cleared board can score, however long it took.
 *
 * Same reasoning as `SUDOKU_MIN_SCORE` and `MINESWEEPER_MIN_SCORE`: without a floor a
 * long grind goes negative and records 0, which is indistinguishable from never having
 * finished. A clear is always worth something.
 */
export const MAHJONG_MATCH_MIN_SCORE = 150;

/**
 * Why a run ended, or `undefined` while it is still going.
 *
 * **There is no `stuck`.** Shuffles are unlimited, so a board with no legal move is
 * never over — the player shuffles and carries on. A run therefore ends only by being
 * cleared, or by being abandoned, which is not a state the board can be in.
 *
 * Kept as a union rather than a bare optional so a future ending (a timed mode, say) is
 * an added member instead of a type change at every call site.
 */
export type MahjongMatchOutcome = "cleared" | undefined;

/**
 * A whole game, as one immutable value — the same shape as `SudokuState`.
 *
 * `tiles` is flat and its order is the layout's order, not a reshape by layer: `isFree`
 * tests one tile against every other uncleared tile, so any grouping would have to be
 * flattened again on the first call. The view sorts by layer for painting, which is a
 * render concern and stays there.
 *
 * **`selected` is an index into `tiles`, not a `Tile`.** Two copies of one face are
 * different board positions, and a face-based selection could not tell them apart —
 * clicking one would highlight both.
 *
 * `elapsedSeconds` is carried on the state rather than read from a clock, so scoring is
 * testable without waiting: the view ticks it once a second, a test sets it.
 */
export interface MahjongMatchState {
  difficulty: MahjongMatchDifficulty;
  tiles: readonly BoardTile[];
  /** Index into `tiles` of the tile awaiting a partner, or `undefined` for none. */
  selected: number | undefined;
  /** Pairs cleared so far. Doubled, this is the tile count; reported as `moves`. */
  pairsCleared: number;
  /**
   * Hints taken. Unlimited, but each costs `MAHJONG_MATCH_HINT_PENALTY` — a running
   * tally, not a budget, the same call `SudokuState.hints` makes.
   */
  hints: number;
  /**
   * Shuffles used. Unlimited, but each costs `MAHJONG_MATCH_SHUFFLE_PENALTY` — a
   * running tally, not a budget, the same call `hints` above makes.
   */
  shuffles: number;
  /**
   * The pairs lifted, most recent last, so `undo` can put one back.
   *
   * Indexes into `tiles` rather than the tiles themselves: undo has to restore a tile
   * to *its own position*, and a `Tile` alone does not say which of the two matching
   * slots it came from.
   */
  history: readonly (readonly [number, number])[];
  elapsedSeconds: number;
  outcome: MahjongMatchOutcome;
}

/* -----------------------------------------------------------------------------------
   Mahjong — the four-player tile game, Hong Kong rules, against three bots.

   The tile set is NOT here, for the reason the Mahjong Match block above says: `Tile`,
   the 144 tiles, `tileFace` and `sortTiles` live in `mahjong-tiles.ts` and belong to no
   single game. What lives here is what *this* game adds — who sits where, what a meld
   is, whose turn it is, and what a hand is worth.

   One hand per game, not a full four-wind round. Every other game in the Arcade ends
   and posts one score, and a rotating dealer would mean carrying four hands of state
   for a scoreboard that records a single number.
----------------------------------------------------------------------------------- */

/**
 * The four seats, in the order play passes.
 *
 * Indices into the seat arrays below, and the *turn order* itself: the player to a
 * seat's left is `(seat + 1) % 4`, which is the only direction chow may be called from.
 * Deliberately positional rather than named by wind, because the seat a player occupies
 * and the wind they hold are two different things once a dealer rotates — this game does
 * not rotate, so `SEAT_WINDS` maps one to the other and nothing has to track both.
 */
export const SEATS = [0, 1, 2, 3] as const;

export type Seat = (typeof SEATS)[number];

/** The human always sits South; the other three seats are bots. Fixed, so a view can rely on it. */
export const HUMAN_SEAT: Seat = 1;

/**
 * The wind each seat holds. East deals, so seat 0 is the dealer.
 *
 * `WINDS` from `mahjong-tiles.ts` is already in seat-rotation order, so `SEAT_WINDS` is
 * that array indexed by seat. It is re-exported from `game-mahjong.ts` rather than
 * aliased here, because this file imports types only — a value import would make a
 * types module carry runtime code.
 */

/** How many tiles a non-dealer holds after the deal. The dealer holds one more. */
export const HAND_SIZE = 13;

/**
 * Tiles held back as the dead wall — never drawn into play.
 *
 * HK rules have no dora indicator to reveal, so the dead wall's only job here is to end
 * the hand in a draw with tiles still on the table, which is what stops the last few
 * discards from being forced. Fourteen is the conventional count.
 */
export const DEAD_WALL_SIZE = 14;

/** What a meld is. `pair` is the eye; the other three are the sets a hand needs four of. */
export const MELD_KINDS = ["chow", "pung", "kong", "pair"] as const;

export type MeldKind = (typeof MELD_KINDS)[number];

/**
 * One completed set in front of a player.
 *
 * `tiles` carries the actual tiles rather than a face and a count, so a meld can be
 * drawn by `MahjongWall` without the view reconstructing which copies were used — and
 * so the 144 tiles remain conserved across wall, hands, melds and discards, which is
 * the invariant the tests assert.
 *
 * `concealed` is what a self-drawn kong is and a claimed one is not. It changes nothing
 * about play here but is scored, so it is recorded when the meld is formed rather than
 * inferred later, when the information is gone.
 */
export interface Meld {
  kind: MeldKind;
  tiles: readonly Tile[];
  concealed: boolean;
  /** Which seat's discard completed this meld, or `undefined` when self-drawn. */
  claimedFrom: Seat | undefined;
}

/** One player's tiles. */
export interface MahjongHand {
  seat: Seat;
  /** The concealed tiles, sorted. Face up for the human, face down for a bot. */
  tiles: readonly Tile[];
  /** Melds laid down, oldest first. Always face up. */
  melds: readonly Meld[];
  /** Bonus tiles set aside. Each scores a fan and is replaced by a fresh draw. */
  flowers: readonly Tile[];
  /** What this seat has thrown, oldest first — its own row of the pond. */
  discards: readonly Tile[];
}

/**
 * The phase of one turn.
 *
 * The state machine your spec asks for, minus the transport-driven states: with no
 * network there is no window in which responses arrive out of order, so
 * `RESOLVING_CALLS` collapses into the action that resolves them.
 *
 * `awaiting-calls` is the only phase where the seat to play is not `state.turn` — the
 * discard is on the table and up to three other seats may claim it.
 */
export const MAHJONG_PHASES = ["awaiting-discard", "awaiting-calls", "ended"] as const;

export type MahjongPhase = (typeof MAHJONG_PHASES)[number];

/** The calls a player may make on a discard, plus the two ways to win and to decline. */
export const MAHJONG_ACTIONS = ["discard", "chow", "pung", "kong", "win", "pass"] as const;

export type MahjongAction = (typeof MAHJONG_ACTIONS)[number];

/**
 * One call a seat may make on the tile currently on the table.
 *
 * Offered by `getAvailableCalls`, which returns every legal call rather than the best
 * one — choosing is the player's job, or the bot policy's. `tiles` names the concealed
 * tiles that would be spent, because a chow on a 3 can be made with 1-2, 2-4 or 4-5 and
 * the player has to be able to pick which.
 */
export interface MahjongCall {
  seat: Seat;
  action: Extract<MahjongAction, "chow" | "pung" | "kong" | "win">;
  /** The concealed tiles this call would consume, alongside the claimed discard. */
  tiles: readonly Tile[];
}

/** How a hand ended, or `playing` while it has not. */
export const MAHJONG_OUTCOMES = ["playing", "won", "lost", "draw"] as const;

export type MahjongOutcome = (typeof MAHJONG_OUTCOMES)[number];

/**
 * A whole hand of mahjong.
 *
 * One immutable object, as with every other game here: each action returns a new state
 * and a caller holding the old one still sees it unchanged.
 *
 * **`wall` is the live wall only.** The dead wall is sliced off at the deal and never
 * modelled, because nothing in HK rules ever reads it — a hand where `wall` empties is a
 * draw, which is exactly the rule the dead wall exists to produce.
 */
export interface MahjongState {
  hands: readonly MahjongHand[];
  /** Tiles left to draw. The pond is each hand's own `discards`. */
  wall: readonly Tile[];
  /** Whose turn it is. In `awaiting-calls`, the seat that just discarded. */
  turn: Seat;
  phase: MahjongPhase;
  /** The tile on the table awaiting calls, or `undefined` outside `awaiting-calls`. */
  liveDiscard: Tile | undefined;
  /** Calls still open on `liveDiscard`, highest priority first. Empty otherwise. */
  openCalls: readonly MahjongCall[];
  /**
   * The tile just drawn, so a view can mark it apart from the sorted rack.
   *
   * By id rather than by position: the rack is re-sorted on every draw, so an index
   * would point at a different tile by the time it was read.
   */
  drawnId: number | undefined;
  /** Which seat won, or `undefined` for a draw or a hand still in play. */
  winner: Seat | undefined;
  /**
   * Whether the winner drew their own winning tile rather than claiming a discard.
   *
   * Carried on the state because it is invisible in the tiles: a hand that went out on
   * a claimed discard holds exactly the same fourteen tiles as one that drew the same
   * tile, and Self Drawn is a fan. `false` on a hand still in play or a drawn one.
   */
  selfDrawn: boolean;
  outcome: MahjongOutcome;
}

/* -----------------------------------------------------------------------------------
   Mahjong scoring — Hong Kong fan.

   A deliberately small pattern set. HK scoring in the wild runs to dozens of patterns
   and house rules disagree on most of them; what is here is the set a casual player
   recognises and expects, and each one is cheap to explain in the instructions card.
   The alternative, Chinese Official's 81 patterns, is a scoring module larger than the
   rest of the game — see the plan for why it was not taken.

   `fan` is the doubling exponent a pattern is worth, exactly as at a real table. The
   score a game records is derived from the fan total by `scoreGame`, so these numbers
   stay in the vocabulary a player would use and the points conversion lives in one place.
----------------------------------------------------------------------------------- */

/** One scoring pattern a finished hand matched. */
export interface MahjongFan {
  /** Stable identifier. Not stored anywhere, so it may be renamed freely. */
  id: string;
  /** What the instructions card and the win banner call it. */
  label: string;
  /** Doubles this pattern is worth. */
  fan: number;
}

/**
 * The base fan every win earns just for going out.
 *
 * Without it a plain hand with no pattern would score zero and read as a loss on the
 * scoreboard, which is wrong — going out at all is the achievement the game is about.
 */
export const MAHJONG_BASE_FAN = 1;

/** Fan per bonus tile held. Flowers and seasons each score one, the usual house rule. */
export const MAHJONG_FLOWER_FAN = 1;

/**
 * What one fan is worth in scoreboard points.
 *
 * A win is `MAHJONG_POINTS_PER_FAN << fan`, so each fan genuinely doubles rather than
 * adding — the whole point of counting in fan. 100 keeps a modest win in three figures
 * and a big hand in five, which reads sensibly beside the other games in the Arcade
 * without needing its own column format.
 */
export const MAHJONG_POINTS_PER_FAN = 100;

/**
 * The most fan a hand can bank, however many patterns it matched.
 *
 * A cap because the score is an exponent: an uncapped stack of patterns produces
 * numbers that dwarf every other game on the shared scoreboard, and one freak hand
 * would own the record forever. Thirteen is the traditional limit hand value, so the
 * ceiling is the one a real table already uses.
 */
export const MAHJONG_MAX_FAN = 13;

/** How a finished hand scored, for the win banner and the score record. */
export interface MahjongScore {
  /** Every pattern the hand matched, best first. */
  fans: readonly MahjongFan[];
  /** Fan total, already capped at `MAHJONG_MAX_FAN`. */
  fan: number;
  /** Scoreboard points the fan total converts to. */
  points: number;
}

/* -----------------------------------------------------------------------------------
   Bridge — the four-player trick-taking game, contract rules, one hand at a time.

   Reuses the game-agnostic deck in `playing-cards.ts`, exactly as Blackjack does. The
   deck has no opinion on what a card is worth, which is what makes it reusable: in
   Blackjack an ace is 1 or 11, here it is simply the highest card in its suit. See
   `rankOrder` in `game-bridge.ts` for this game's answer.

   Seats reuse `SEATS`/`Seat`/`HUMAN_SEAT` from the Mahjong section above rather than
   declaring a second four-seat model. They mean the same thing — four positions in the
   order play passes — and a `BridgeSeat` that was structurally identical would be two
   names for one concept. Bridge adds what Mahjong has no need for: partnerships, since
   seats 0/2 and 1/3 are the two sides. See `PARTNER_OF` below.

   One hand, not a rubber. A rubber is several hands with carried-over part-scores and
   changing vulnerability, which would need persistence between Arcade sessions — and an
   Arcade game is not persisted mid-play (see `games-arcade-view.tsx`). One deal scored on
   its own merits is a complete unit of bridge and a complete Arcade run, the same call
   Mahjong makes in scoring one hand rather than a full four-wind match.
----------------------------------------------------------------------------------- */

/** Cards each player holds at the deal. The whole deck, dealt out four ways. */
export const BRIDGE_HAND_SIZE = 13;

/** Tricks in a hand. One per card held, so the deal divides exactly. */
export const BRIDGE_TRICKS = 13;

/**
 * The partner of each seat, indexed by seat.
 *
 * Partners sit opposite, so a partner is always `(seat + 2) % 4`. A lookup table rather
 * than that arithmetic at each call site, because "who is my partner" is asked
 * constantly during the auction and the play, and the table says what the expression
 * only implies.
 */
export const PARTNER_OF: readonly Seat[] = [2, 3, 0, 1];

/**
 * The two partnerships.
 *
 * Named by seat pair rather than by compass direction, so nothing here has to agree with
 * Mahjong's `SEAT_WINDS` — the wind a seat holds is a mahjong concept, and importing it
 * here would tie two games' vocabularies together. `ns` is seats 0 and 2; `ew` is seats 1
 * and 3. `HUMAN_SEAT` is 1, so the human always plays the `ew` side with seat 3 opposite.
 */
export const BRIDGE_SIDES = ["ns", "ew"] as const;

export type BridgeSide = (typeof BRIDGE_SIDES)[number];

/**
 * The five denominations a contract can be played in, weakest first.
 *
 * Suits in ascending bidding order — clubs, diamonds, hearts, spades — then no-trumps
 * above all of them. This order *is* the bidding rule: a bid outranks another at the same
 * level if its denomination appears later here, so an index comparison is the whole
 * ranking test and there is no second rank table to keep in step.
 *
 * Deliberately not `Suit` from `playing-cards.ts` plus a flag: that array is in deck
 * order (spades first), which is the wrong order for bidding, and no-trumps is not a suit
 * at all. Two different orderings of four suits is exactly the kind of thing that
 * silently breaks, so the bidding order is stated once, here.
 */
export const BRIDGE_DENOMINATIONS = ["clubs", "diamonds", "hearts", "spades", "nt"] as const;

export type Denomination = (typeof BRIDGE_DENOMINATIONS)[number];

/** The denominations that are actual suits — everything except no-trumps. */
export type TrumpSuit = Exclude<Denomination, "nt">;

/** The highest contract level. Seven means taking all thirteen tricks. */
export const BRIDGE_MAX_LEVEL = 7;

/**
 * Tricks a side must take beyond the first six to make a contract.
 *
 * Bridge counts contracts from a "book" of six tricks: 1NT is seven tricks, 7NT is all
 * thirteen. The offset is why a level is 1-7 rather than 7-13, and why every trick sum in
 * scoring adds it back.
 */
export const BRIDGE_BOOK = 6;

/** What a player may do when it is their turn to call. */
export const BRIDGE_CALLS = ["bid", "pass", "double", "redouble"] as const;

export type CallKind = (typeof BRIDGE_CALLS)[number];

/**
 * One call in the auction.
 *
 * `level` and `denomination` are set only for a `bid` and undefined for the other three,
 * rather than a discriminated union per call kind. The auction is a flat list the view
 * renders as a four-column grid, and a union would mean narrowing at every point a call
 * is displayed, for no gain — the invalid combination (a pass carrying a level) is
 * unreachable because only `makeBid` constructs a bid.
 */
export interface BridgeCall {
  seat: Seat;
  kind: CallKind;
  /** 1-7, for a `bid` only. */
  level?: number;
  /** For a `bid` only. */
  denomination?: Denomination;
}

/** Whether a contract was doubled, redoubled, or neither. Multiplies everything at stake. */
export const BRIDGE_DOUBLINGS = ["none", "doubled", "redoubled"] as const;

export type Doubling = (typeof BRIDGE_DOUBLINGS)[number];

/**
 * The contract the auction settled on.
 *
 * `declarer` is the member of the winning side who *first* named the final denomination —
 * not whoever made the last bid. That distinction decides who plays the hand and who
 * becomes dummy, and it is the rule most often got wrong: if the human's partner opened
 * 1♠ and the human later bid 4♠, the partner declares. See `declarerFor` in
 * `game-bridge.ts`.
 */
export interface Contract {
  level: number;
  denomination: Denomination;
  declarer: Seat;
  doubling: Doubling;
}

/** One card played into the current trick, and by whom. */
export interface TrickCard {
  seat: Seat;
  card: Card;
}

/** A completed trick: the four cards in the order played, and the seat that won it. */
export interface Trick {
  cards: readonly TrickCard[];
  winner: Seat;
}

/**
 * The phases of a hand.
 *
 * `auction` runs until three passes close it, or four opening passes end the hand as a
 * pass-out. `play` runs thirteen tricks. `ended` covers a made contract, a defeated one
 * and a pass-out alike — the outcome says which.
 *
 * Three phases rather than a separate `awaiting-dummy` or `scoring`: nothing waits for
 * input between the last trick and the score, and dummy going face-up is a fact about the
 * state (`play` has begun) rather than a state of its own. The same reasoning that
 * collapsed Mahjong's `RESOLVING_CALLS`.
 */
export const BRIDGE_PHASES = ["auction", "play", "ended"] as const;

export type BridgePhase = (typeof BRIDGE_PHASES)[number];

/**
 * How the hand finished, **from the human's point of view** — not the declaring side's.
 *
 * The same convention as `MahjongOutcome`, and for the same reason: the scoreboard
 * records what the player achieved, and the human is as often defending as declaring.
 * Defeating a contract you defended is a `won`.
 *
 * `passed-out` is its own outcome rather than a `draw`: nobody bid and no cards were
 * played, and calling that a draw would imply a contest that never happened.
 */
export const BRIDGE_OUTCOMES = ["playing", "won", "lost", "passed-out"] as const;

export type BridgeOutcome = (typeof BRIDGE_OUTCOMES)[number];

/**
 * A hand of bridge, as one immutable value.
 *
 * `hands` is indexed by seat and holds what each seat still has *unplayed*, so a card
 * moves out of it and into the trick. Cards already won live in `tricks`, which is what
 * lets `allCards` account for all fifty-two at any moment — the conservation invariant
 * the tests assert, mirroring Mahjong's `allTiles`.
 */
export interface BridgeState {
  /** Unplayed cards per seat, sorted for display by `sortHand`. */
  hands: readonly (readonly Card[])[];
  phase: BridgePhase;
  /** Whose turn it is to call or to play. */
  turn: Seat;
  /** The seat that dealt, and so the seat that called first. */
  dealer: Seat;
  /** Every call so far, in order. The view renders it as the auction grid. */
  auction: readonly BridgeCall[];
  /** The settled contract, or `undefined` during the auction and on a pass-out. */
  contract: Contract | undefined;
  /**
   * Cards on the table in the trick being played, in the order they were played.
   *
   * The first entry's seat is the leader, and its card sets the suit everyone must
   * follow — so the lead is read off this array rather than stored a second time.
   */
  currentTrick: readonly TrickCard[];
  /** Completed tricks in order, each with its winner. */
  tricks: readonly Trick[];
  /**
   * Whether dummy's hand is face-up yet.
   *
   * True from the first card of the first trick. Dummy is face-up in bridge, so this is
   * not hidden information — it is the one hand the view *must* reveal, and the flag
   * exists because it becomes visible one card into the play rather than at the deal.
   */
  dummyExposed: boolean;
  outcome: BridgeOutcome;
}

/**
 * What a finished hand scored, itemised.
 *
 * Parts rather than one number, so the result panel can show the arithmetic the way a
 * bridge scorer writes it — a player wants to see why 4♠ doubled and made scored what it
 * did. `points` is what reaches the scoreboard.
 */
export interface BridgeScore {
  /** Tricks the declaring side actually took. */
  tricksTaken: number;
  /** Tricks needed: the contract's level plus `BRIDGE_BOOK`. */
  tricksNeeded: number;
  /** Whether the declaring side made the contract. */
  made: boolean;
  /** Tricks over the contract; 0 unless made with extras. */
  overtricks: number;
  /** Tricks short; 0 unless defeated. */
  undertricks: number;
  /** What the declaring side earned. Negative when defeated. */
  declarerScore: number;
  /** Scoreboard points for the human, floored at 0. See `scoreGame` in `game-bridge.ts`. */
  points: number;
  /** One line per scoring component, for the result panel. */
  lines: readonly { label: string; value: number }[];
}

/**
 * Points per trick bid and made, by denomination. The standard contract-bridge table.
 *
 * No-trumps scores 40 for the first trick and 30 for each after, which no single
 * per-trick number expresses; this holds 30 so the multiplication is right for every
 * trick after the first, and `contractPoints` adds `BRIDGE_NT_FIRST_TRICK_BONUS` once.
 */
export const BRIDGE_TRICK_VALUES: Readonly<Record<Denomination, number>> = {
  clubs: 20,
  diamonds: 20,
  hearts: 30,
  spades: 30,
  nt: 30,
};

/** The extra for the first trick of a no-trump contract, on top of `BRIDGE_TRICK_VALUES.nt`. */
export const BRIDGE_NT_FIRST_TRICK_BONUS = 10;

/** Contract points at or above which a made contract earns the game bonus, not the part-score. */
export const BRIDGE_GAME_THRESHOLD = 100;

/** The bonus for making a part-score — a contract worth less than a game. */
export const BRIDGE_PARTSCORE_BONUS = 50;

/**
 * The bonus for bidding and making a game, not vulnerable.
 *
 * This hand is always played not vulnerable: vulnerability is a property of a rubber's
 * running score, and this game deals one hand with nothing carried in. Fixing it means
 * one bonus table instead of two, and no invisible state affecting the score.
 */
export const BRIDGE_GAME_BONUS = 300;

/** The bonus for bidding and making a small slam — twelve tricks, level six. */
export const BRIDGE_SMALL_SLAM_BONUS = 500;

/** The bonus for bidding and making a grand slam — all thirteen tricks, level seven. */
export const BRIDGE_GRAND_SLAM_BONUS = 1000;

/** The bonus for making a doubled or redoubled contract — the "insult" bonus. */
export const BRIDGE_INSULT_BONUS = 50;

/** Per undertrick, not vulnerable and undoubled. */
export const BRIDGE_UNDERTRICK_VALUE = 50;

/**
 * High-card points per honour, the Milton Work count every bridge player uses.
 *
 * The bots bid off this and nothing else (see `evaluateHand`), and the view shows the
 * human their own count — it is the number a player at a real table adds up first, so
 * hiding it would be withholding something they would always have.
 */
export const BRIDGE_HCP: Readonly<Record<string, number>> = {
  A: 4,
  K: 3,
  Q: 2,
  J: 1,
};

/* ---------------------------------------------------------------------------------
   Pac-Man.
--------------------------------------------------------------------------------- */

/**
 * The maze, as ASCII art.
 *
 * Written as a picture rather than as coordinate pairs — the opposite of the choice
 * `SHAPES` makes in `game-tetris.ts`, and for the opposite reason. A tetromino is
 * *rotated*, so its cells have to be arithmetic; a maze is never transformed at all,
 * it is only read. A picture is therefore the representation that can be checked by
 * eye, and a 28x31 maze written as 868 coordinate pairs could not be.
 *
 * The legend:
 *   - `#` wall
 *   - `.` pellet
 *   - `o` power pellet
 *   - ` ` empty floor
 *   - `-` the ghost house door (walkable by a ghost, never by Pac-Man)
 *
 * This is the original arcade layout: 28 columns by 31 rows, the two side tunnels on
 * row 14, and the ghost house in the middle. The dimensions are not declared beside
 * this string but *derived* from it — see `PACMAN_COLS` — so the three can never
 * disagree. `game-pacman.test.ts` asserts the picture is rectangular and that both
 * tunnel mouths line up, which is the failure a hand-edited maze actually produces.
 */
export const PACMAN_MAZE = [
  "############################",
  "#............##............#",
  "#.####.#####.##.#####.####.#",
  "#o####.#####.##.#####.####o#",
  "#.####.#####.##.#####.####.#",
  "#..........................#",
  "#.####.##.########.##.####.#",
  "#.####.##.########.##.####.#",
  "#......##....##....##......#",
  "######.##### ## #####.######",
  "     #.##### ## #####.#     ",
  "     #.##          ##.#     ",
  "     #.## ###--### ##.#     ",
  "######.## #      # ##.######",
  "      .   #      #   .      ",
  "######.## #      # ##.######",
  "     #.## ######## ##.#     ",
  "     #.##          ##.#     ",
  "     #.## ######## ##.#     ",
  "######.## ######## ##.######",
  "#............##............#",
  "#.####.#####.##.#####.####.#",
  "#.####.#####.##.#####.####.#",
  "#o..##.......  .......##..o#",
  "###.##.##.########.##.##.###",
  "###.##.##.########.##.##.###",
  "#......##....##....##......#",
  "#.##########.##.##########.#",
  "#.##########.##.##########.#",
  "#..........................#",
  "############################",
] as const;

/** Maze width in tiles, derived from `PACMAN_MAZE` so the two cannot drift apart. */
export const PACMAN_COLS = PACMAN_MAZE[0].length;

/** Maze height in tiles, derived from `PACMAN_MAZE` for the same reason. */
export const PACMAN_ROWS = PACMAN_MAZE.length;

/** What one maze tile holds. The walls never change; the pellets are eaten. */
export type PacmanTile = "wall" | "pellet" | "power" | "empty" | "door";

/**
 * The four compass directions, plus the stopped state.
 *
 * `"none"` is a real value rather than `undefined` because it is a thing Pac-Man
 * genuinely does: pressed into a wall he stops, and the game still has to know which
 * way he last faced so the sprite points somewhere sensible. A union with `undefined`
 * would push that question onto every caller.
 */
export const PACMAN_DIRECTIONS = ["up", "down", "left", "right", "none"] as const;

export type PacmanDirection = (typeof PACMAN_DIRECTIONS)[number];

/** A tile coordinate in the maze. Row 0 is the top. */
export interface PacmanPoint {
  row: number;
  col: number;
}

/**
 * The four ghosts, by their arcade names.
 *
 * These are keys, not labels: each indexes a different targeting rule in
 * `game-pacman.ts` and a different colour in the view. Renaming one renames a
 * behaviour, so they are as fixed as the tetromino letters.
 */
export const GHOST_NAMES = ["blinky", "pinky", "inky", "clyde"] as const;

export type GhostName = (typeof GHOST_NAMES)[number];

/**
 * What a ghost is currently doing. The four modes have genuinely different rules,
 * not merely different colours:
 *
 *   - `scatter` — heads for its own corner, ignoring Pac-Man entirely.
 *   - `chase` — hunts, each ghost by its own rule. See `ghostTarget`.
 *   - `frightened` — flees, choosing at random, and can be eaten.
 *   - `eaten` — a pair of eyes returning to the house to be reborn.
 */
export type GhostMode = "scatter" | "chase" | "frightened" | "eaten";

/** One ghost: where it is, which way it is going, and what it is doing. */
export interface Ghost {
  name: GhostName;
  row: number;
  col: number;
  direction: PacmanDirection;
  mode: GhostMode;
  /**
   * Ticks remaining before this ghost leaves the house at the start of a life.
   *
   * The arcade releases the four on a stagger rather than all at once — all four
   * arriving together is both unfair and visually unreadable. Zero means "out".
   */
  penTicks: number;
}

/** Why a run ended, or `undefined` while it is still going. */
export type PacmanOutcome = "caught" | undefined;

/**
 * A whole game, as one immutable value.
 *
 * Every rule in `game-pacman.ts` takes one of these and returns the next — including
 * the clock, which is `tick`. The same trade `game-tetris.ts` makes, and for the same
 * reason: a test advances a hundred ticks in a loop and never waits on a real timer.
 */
export interface PacmanState {
  /**
   * The maze's mutable layer: one entry per tile, row-major.
   *
   * Only the pellets really live here — the walls are copied in so one lookup answers
   * "what is at this tile", but nothing ever writes a wall. A flat array for the
   * reason 2048's `Board` and Tetris's `Playfield` are flat: every lookup is an index
   * computation, and `row * PACMAN_COLS + col` is the whole of it.
   */
  pellets: readonly PacmanTile[];
  pacman: PacmanPoint;
  /** The direction Pac-Man is travelling right now. */
  direction: PacmanDirection;
  /**
   * The direction the player has asked for but which is not yet legal.
   *
   * **This is what makes the controls feel right**, and it is not a cosmetic detail.
   * A player presses Up slightly before reaching the corridor they mean to turn into;
   * without a buffer that input is simply dropped and the turn is missed. Holding the
   * request and applying it on the first tick it becomes legal is what the arcade
   * does, and it is the difference between tight controls and sticky ones.
   */
  queued: PacmanDirection;
  ghosts: readonly Ghost[];
  score: number;
  lives: number;
  level: number;
  /**
   * Pellets remaining on the board.
   *
   * Tracked rather than counted, because it is read on every single tick to decide
   * whether the board is clear; recounting 868 tiles that often is the one piece of
   * arithmetic in this game worth avoiding.
   */
  pelletsLeft: number;
  /** Ticks remaining of the current power pellet, or 0 when not frightened. */
  frightenedTicks: number;
  /**
   * Ghosts eaten during the *current* power pellet.
   *
   * Resets on each pellet, because the 200/400/800/1600 ladder is per-pellet: all
   * four on one pellet pays 3000, but two on each of two pellets pays 1200. Carrying
   * the count across would quietly pay the wrong number.
   */
  ghostsEatenThisPower: number;
  /** Ticks elapsed this life, which drives the scatter/chase phase schedule. */
  phaseTicks: number;
  /** Total moves, recorded alongside the score as the game's `moves` count. */
  moves: number;
  /**
   * Whether the extra life has already been awarded.
   *
   * A flag rather than a score comparison: the award fires on *crossing*
   * `PACMAN_EXTRA_LIFE_AT`, and a test like `score >= 10000` is true on every tick
   * after it and would hand out a life per pellet for the rest of the run.
   */
  extraLifeAwarded: boolean;
  outcome: PacmanOutcome;
  /**
   * Set for one tick when Pac-Man is caught, so the view can play the death cue.
   *
   * Carried on the state rather than derived, for the reason `LineClear` is in
   * Tetris: by the time the next state exists the event is over and nothing is left
   * to say it happened. The library still decides no timing and no styling.
   */
  dying: boolean;
  /**
   * The bazooka currently lying in the maze, or `undefined` when there is none.
   *
   * One at a time, deliberately. Several pickups on the board at once would turn a
   * decision about which risk to take into a supply run.
   */
  bazooka: Bazooka | undefined;
  /** Ticks until the next bazooka appears. Counts down only while none is on the board. */
  bazookaCooldown: number;
  /**
   * Shots held. Caps at one — collecting while already loaded does not stack.
   *
   * A number rather than a boolean so the cap is a *rule in one place*
   * (`collectBazooka`) rather than a type that forbids ever changing it. Raising the
   * cap later is then a constant, not a refactor of every call site.
   */
  ammo: number;
  /** The shell in flight, or `undefined`. Only ever one — see `Projectile`. */
  projectile: Projectile | undefined;
  /**
   * The ghost a shell destroyed this tick, for the view to cue and flash.
   *
   * Carried for exactly the reason `dying` is: once the next state exists the event
   * is over, and the ghost is already drifting home as eyes with nothing left to say
   * it was shot rather than chomped.
   */
  shotGhost: GhostName | undefined;
  /** Set for one tick when a bazooka is collected, so the view can cue the pickup. */
  collectedBazooka: boolean;
}

/** Points for one pellet. */
export const PACMAN_PELLET_POINTS = 10;

/** Points for one power pellet. */
export const PACMAN_POWER_POINTS = 50;

/**
 * Points for eating a ghost, doubling per ghost within one power pellet.
 *
 * The arcade's ladder: 200, 400, 800, 1600 — so clearing all four on a single pellet
 * is worth 3000, which is the whole reason to chase rather than merely survive.
 */
export const PACMAN_GHOST_POINTS = [200, 400, 800, 1600] as const;

/** Lives a run starts with. Three, as the arcade does. */
export const PACMAN_LIVES = 3;

/** Score at which the player earns an extra life. Once per run, as the arcade does. */
export const PACMAN_EXTRA_LIFE_AT = 10_000;

/**
 * How long a power pellet lasts, in ticks, at level 1.
 *
 * Shortens with the level (see `frightenedTicksFor`), which is the arcade's main
 * difficulty lever — by the late boards a power pellet barely buys you one ghost.
 */
export const PACMAN_FRIGHTENED_TICKS = 60;

/**
 * The scatter/chase schedule, in ticks from the start of a life.
 *
 * The ghosts alternate between hunting and retreating to their corners, and that
 * alternation is what makes the game playable at all: four ghosts in permanent chase
 * corner Pac-Man almost immediately. Each entry is a phase and how long it lasts; the
 * last runs forever, which is why a board gets relentless if you take too long over it.
 */
export const PACMAN_PHASES = [
  { mode: "scatter", ticks: 25 },
  { mode: "chase", ticks: 100 },
  { mode: "scatter", ticks: 25 },
  { mode: "chase", ticks: 100 },
  { mode: "scatter", ticks: 25 },
  { mode: "chase", ticks: Number.POSITIVE_INFINITY },
] as const satisfies readonly { mode: "scatter" | "chase"; ticks: number }[];

/**
 * Each ghost's scatter corner, as a tile deliberately *outside* the maze.
 *
 * A target beyond the wall is the arcade's own trick: a ghost can never arrive, so it
 * orbits the nearest corner instead of stopping dead on a tile. Aiming at a reachable
 * tile would park all four and the scatter phase would stop being a reprieve.
 */
export const GHOST_SCATTER_CORNERS: Readonly<Record<GhostName, PacmanPoint>> = {
  blinky: { row: -2, col: PACMAN_COLS - 2 },
  pinky: { row: -2, col: 1 },
  inky: { row: PACMAN_ROWS + 1, col: PACMAN_COLS - 1 },
  clyde: { row: PACMAN_ROWS + 1, col: 0 },
};

/** Where Pac-Man starts each life: the open row below the ghost house. */
export const PACMAN_START: PacmanPoint = { row: 23, col: 13 };

/**
 * Where each ghost starts a life.
 *
 * Blinky starts *outside* the house and the other three inside it — the arcade's
 * arrangement, and the reason Blinky is the one on your tail from the first second.
 */
export const GHOST_STARTS: Readonly<Record<GhostName, PacmanPoint>> = {
  blinky: { row: 11, col: 13 },
  pinky: { row: 14, col: 13 },
  inky: { row: 14, col: 11 },
  clyde: { row: 14, col: 15 },
};

/**
 * The tile a ghost aims for while `eaten`, and where it re-enters the house.
 *
 * Also the tile the three penned ghosts climb to on release, so one constant covers
 * both directions through the door.
 */
export const GHOST_HOUSE_DOOR: PacmanPoint = { row: 11, col: 13 };

/**
 * Ticks each ghost waits in the house at the start of a life.
 *
 * The stagger described on `Ghost.penTicks`. Blinky is already out, so his is zero.
 */
export const GHOST_PEN_TICKS: Readonly<Record<GhostName, number>> = {
  blinky: 0,
  pinky: 8,
  inky: 20,
  clyde: 34,
};

/* ---------------------------------------------------------------------------------
   The bazooka.

   A pickup that spawns in the maze, is collected by walking over it, and buys one
   shot at one ghost. Not part of the arcade game — a deliberate addition to this
   one, and the reason every constant below is named for what it *does* rather than
   for an original it does not have.

   The design decision that shapes all of this: a shot ghost goes to the existing
   `eaten` mode rather than to a new "destroyed" one. Its eyes float home and it
   revives on the normal schedule, which means the bazooka reuses machinery that is
   already correct instead of inventing a second respawn path to keep in step.
--------------------------------------------------------------------------------- */

/** The pickup, sitting in the maze waiting to be walked over. */
export interface Bazooka {
  row: number;
  col: number;
  /**
   * Ticks before this one despawns uncollected.
   *
   * It expires rather than waiting forever, and that is what keeps the feature a
   * decision: an uncollected bazooka left on the board all level would eventually be
   * picked up for free, so the pickup would cost nothing but a detour whenever you
   * happened to pass. A timer makes it something you choose to go for.
   */
  ttl: number;
}

/**
 * A shell in flight.
 *
 * Only one can exist at a time, since ammunition caps at a single shot — so this is
 * `Projectile | undefined` on the state rather than an array. A list would imply a
 * salvo the rules do not allow.
 */
export interface Projectile {
  row: number;
  col: number;
  /** Fixed at the moment of firing; a shell does not steer. */
  direction: PacmanDirection;
}

/**
 * Ticks between a bazooka despawning (or being collected) and the next one spawning.
 *
 * **Measured against how long a life actually lasts, not guessed.** This shipped at 70
 * and the bazooka was effectively unreachable: the cooldown restarts on every death
 * (see `loseLife`), and a typical life runs about 60 ticks — so 77% of lives ended
 * before a pickup had ever appeared, and most players would never see one at all. At
 * 25 every life is long enough to reach the first spawn.
 *
 * The lesson worth keeping: this number is only meaningful relative to the *player's*
 * survival time, and a bot that plays better than a person will hide the problem
 * completely.
 */
export const BAZOOKA_SPAWN_TICKS = 25;

/** How long an uncollected bazooka waits before it despawns. See `Bazooka.ttl`. */
export const BAZOOKA_TTL_TICKS = 80;

/**
 * The fewest tiles between Pac-Man and a newly spawned bazooka.
 *
 * Measured as straight-line distance, so it is cheap and approximate — the point is
 * only that a pickup never materialises on top of the player, which would make it a
 * reward for standing still rather than for going to get it.
 */
export const BAZOOKA_MIN_SPAWN_DISTANCE = 8;

/**
 * Tiles a shell travels per tick.
 *
 * Faster than anything else on the board, which is most of what makes it read as a
 * projectile rather than as a slow second Pac-Man. It is resolved tile by tile along
 * the way (see `stepProjectile`), so speed never lets it skip over a ghost.
 */
export const PROJECTILE_SPEED = 4;

/**
 * Points for destroying a ghost with the bazooka.
 *
 * Flat, and deliberately **off** the 200/400/800/1600 power-pellet ladder: a shot
 * must not advance `ghostsEatenThisPower`, or it would inflate the payout of the next
 * ghost chomped during a power pellet. The big rewards stay with the riskier play of
 * running one down on foot, which is the behaviour worth encouraging — and it is why
 * shooting a *frightened* ghost is the poorer choice, since the ladder would usually
 * have paid more.
 */
export const BAZOOKA_GHOST_POINTS = 300;
