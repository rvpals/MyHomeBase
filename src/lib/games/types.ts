import type { Card } from "./playing-cards";

/**
 * The Games module's domain types.
 *
 * A game is identified by a `GameKey` — a string that names code, not a database
 * row. See `catalogue.ts` for why the catalogue is not a table.
 *
 * One exception to "the types live here": the deck primitives are in
 * `playing-cards.ts`, because they belong to no single game. See the note in the
 * Blackjack section below.
 */

// Re-exported so `@/lib/games` presents one surface and a caller need not know which
// file a card type came from.
export type { Card, Random as CardRandom, Rank, Suit } from "./playing-cards";

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
