import type { ChessResultRepository } from "./ports";
import { chessPlayerSchema, recordChessResultSchema } from "./schema";
import {
  CHESS_LEVELS,
  type ChessGame,
  type ChessLevel,
  type ChessRecord,
  type ChessResult,
} from "./types";

/**
 * A player's record against each level — wins, losses and draws.
 *
 * Separate from the scoreboard because a **result** and a **score** are different
 * facts, and for chess the scoreboard cannot recover the first from the second: a
 * loss scores 0, a draw scores 0, and a win scores 0 once enough hints have been
 * charged against it. See migration 0175.
 */

/** How a finished game went, from the player's point of view. */
export function chessResultOf(game: ChessGame): ChessResult | undefined {
  if (game.winner === undefined) {
    // Every finished status with no winner is a draw of some kind — stalemate, the
    // fifty-move rule, repetition, dead material, an agreement, or a flag against a
    // side that could not have mated.
    return game.status === "playing" || game.status === "check" ? undefined : "draw";
  }
  return game.winner === game.humanColor ? "win" : "loss";
}

/**
 * Records a finished game.
 *
 * Takes the result rather than the game, so the action does not have to ship a whole
 * board across — and so a result can be recorded from the CLI.
 */
export function recordChessResult(repo: ChessResultRepository, input: unknown): void {
  const parsed = recordChessResultSchema.parse(input);
  repo.recordChessResult({ ...parsed, playedAt: new Date().toISOString() });
}

/**
 * The player's record against each level, every level present.
 *
 * All three are returned even when a level has never been played, so the screen reads
 * `0–0–0` rather than having to distinguish "no row" from "no games" — the same call
 * `countByTier` makes for the Pictionary word bank.
 */
export function listChessRecords(repo: ChessResultRepository, input: unknown): ChessRecord[] {
  const { userId } = chessPlayerSchema.parse(input);
  const counted = repo.countChessResults(userId);

  return CHESS_LEVELS.map((level) => ({
    level,
    wins: counted[level]?.win ?? 0,
    losses: counted[level]?.loss ?? 0,
    draws: counted[level]?.draw ?? 0,
  }));
}

/** How many games a record covers. */
export function chessRecordGames(record: ChessRecord): number {
  return record.wins + record.losses + record.draws;
}

/**
 * A record as a line of text: `12–3–1`, or a note when nothing has been played.
 *
 * Wins–losses–draws is the order every scoreboard uses, and it is in the library so
 * the board and the CLI print the same thing.
 */
export function formatChessRecord(record: ChessRecord): string {
  if (chessRecordGames(record) === 0) return "no games yet";
  return `${record.wins}–${record.losses}–${record.draws}`;
}

/** The levels a player has actually played, for a screen that hides the rest. */
export function playedChessLevels(records: readonly ChessRecord[]): ChessLevel[] {
  return records.filter((record) => chessRecordGames(record) > 0).map((record) => record.level);
}
