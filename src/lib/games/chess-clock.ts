import {
  CHESS_CLOCK_URGENT_MS,
  CHESS_MIN_SEARCH_MS,
  CHESS_MOVES_REMAINING_GUESS,
  CHESS_TIME_CONTROL_SETUP,
  type ChessClock,
  type ChessColor,
  type ChessTimeControl,
} from "./types";

/**
 * The chess clock: how time is charged, when a flag falls, and how much of what is
 * left the computer may spend on one move.
 *
 * **Nothing here reads a clock.** Every function takes the elapsed milliseconds as an
 * argument, so the whole module is pure and testable, and the one thing that has to
 * measure real time — the view — is also the only thing that can. A `startedAt`
 * timestamp stored in the game would have been wrong the moment a save sat on disk
 * overnight, which is the bug this shape exists to make impossible.
 */

/** A fresh clock for a control, or undefined when the control is `untimed`. */
export function createChessClock(control: ChessTimeControl): ChessClock | undefined {
  const setup = CHESS_TIME_CONTROL_SETUP[control];
  if (setup.initialMs <= 0) return undefined;
  return { control, remainingMs: { w: setup.initialMs, b: setup.initialMs } };
}

/**
 * What a side's clock reads right now: what it has banked, less whatever it is
 * currently spending. Never below zero.
 *
 * `spentMs` is 0 for the side that is not to move, which is why this takes it rather
 * than working it out — only the caller knows whose turn it is and when that turn
 * began.
 */
export function chessClockReading(clock: ChessClock, color: ChessColor, spentMs = 0): number {
  return Math.max(0, clock.remainingMs[color] - Math.max(0, spentMs));
}

/** Whether a side has run out, given what it is currently spending. */
export function hasChessClockFlagged(
  clock: ChessClock,
  color: ChessColor,
  spentMs = 0,
): boolean {
  return chessClockReading(clock, color, spentMs) <= 0;
}

/**
 * Charges one side for a completed move, then adds the increment.
 *
 * The order is the rule, not a preference: the increment is only earned by a move the
 * player got out in time, so a side that flags **does not** receive it and cannot be
 * rescued back above zero by one. `flagged` therefore means "this move did not make
 * it", and the caller must not apply the move.
 */
export function chargeChessClock(
  clock: ChessClock,
  color: ChessColor,
  elapsedMs: number,
): { clock: ChessClock; flagged: boolean } {
  const remaining = chessClockReading(clock, color, elapsedMs);
  const charged: ChessClock = {
    ...clock,
    remainingMs: { ...clock.remainingMs, [color]: remaining },
  };

  if (remaining <= 0) return { clock: charged, flagged: true };

  const increment = CHESS_TIME_CONTROL_SETUP[clock.control].incrementMs;
  if (increment <= 0) return { clock: charged, flagged: false };

  return {
    clock: {
      ...charged,
      remainingMs: { ...charged.remainingMs, [color]: remaining + increment },
    },
    flagged: false,
  };
}

/** Sets a side's clock to zero — what the view calls when the ticker reaches it. */
export function zeroChessClock(clock: ChessClock, color: ChessColor): ChessClock {
  return { ...clock, remainingMs: { ...clock.remainingMs, [color]: 0 } };
}

/**
 * How long the computer may think about one move.
 *
 * The smaller of its level's own budget and a share of what it has left, so a level
 * does not flag itself: Advanced wants 2.5 seconds a move, which loses a one-minute
 * game on time long before it loses it on the board. An untimed game is just the
 * level's budget.
 *
 * Floored at `CHESS_MIN_SEARCH_MS` so that a nearly-flagged computer still returns a
 * legal move rather than an unfinished search.
 */
export function chessSearchBudgetMs(
  clock: ChessClock | undefined,
  color: ChessColor,
  levelBudgetMs: number,
): number {
  if (!clock) return levelBudgetMs;

  const setup = CHESS_TIME_CONTROL_SETUP[clock.control];
  const share =
    clock.remainingMs[color] / CHESS_MOVES_REMAINING_GUESS + setup.incrementMs / 2;

  return Math.max(CHESS_MIN_SEARCH_MS, Math.min(levelBudgetMs, Math.floor(share)));
}

/**
 * A clock as it is read on the board: `3:02`, or `9.4` under ten seconds.
 *
 * Tenths only at the end, because a figure that changes ten times a second is harder
 * to read than one that changes once — and is worth the cost exactly when a player has
 * stopped glancing at the clock and started watching it.
 */
export function formatChessClock(ms: number): string {
  const safe = Math.max(0, ms);

  if (safe < CHESS_CLOCK_URGENT_MS) return (Math.floor(safe / 100) / 10).toFixed(1);

  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 60) return `${minutes}:${String(seconds).padStart(2, "0")}`;

  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Whether a reading is low enough to warrant the urgent treatment. */
export function isChessClockUrgent(ms: number): boolean {
  return ms < CHESS_CLOCK_URGENT_MS;
}

/** A control as PGN writes it: `180+2`, or `-` when there is no clock. */
export function chessTimeControlTag(clock: ChessClock | undefined): string {
  if (!clock) return "-";
  const setup = CHESS_TIME_CONTROL_SETUP[clock.control];
  return `${Math.floor(setup.initialMs / 1000)}+${Math.floor(setup.incrementMs / 1000)}`;
}
