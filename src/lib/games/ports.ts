import type { ScoreWriteData } from "./schema";
import type { Score } from "./types";

/**
 * The storage the Games use-cases depend on — an interface, not a database, so the
 * web app, the CLI and the tests can each supply their own.
 */
export interface ScoreRepository {
  /** Writes a finished game. Scores are immutable, so there is no update. */
  recordScore(input: ScoreWriteData): Score;
  /**
   * Highest scores first, across every game or one of them.
   *
   * Shared, not per-user: the board answers "who is best at this", so it is never
   * filtered by the viewer. A row still carries `userId`/`userName` to say whose it is.
   */
  listTopScores(gameKey: string | undefined, limit: number): Score[];
  /** Most recently played first, for the "latest games" list. */
  listRecentScores(limit: number): Score[];
  /** The single best score for one game, or undefined when nobody has played it. */
  getBestScore(gameKey: string): Score | undefined;
  /** How many games have been recorded for `gameKey`. */
  countScores(gameKey: string): number;
}
