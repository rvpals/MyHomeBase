import type { ScoreWriteData } from "./schema";
import type {
  PictionaryTier,
  PictionaryWord,
  Score,
  StoredPictionaryWord,
} from "./types";

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

/**
 * The custom Pictionary word bank — words a household imported, in `gam_pictionary_words`.
 *
 * Separate from `ScoreRepository` rather than bolted onto it: a score and a word have
 * nothing to do with each other, and the CLI's word commands have no business holding a
 * handle that can write to the scoreboard. Both are implemented by the same SQLite class,
 * which is an implementation detail neither use-case can see.
 */
export interface PictionaryWordRepository {
  /** Every custom word, or only one tier's. Alphabetical, for a list someone reads. */
  listWords(tier: PictionaryTier | undefined): StoredPictionaryWord[];
  /**
   * Adds words, ignoring any that are already stored.
   *
   * Returns how many rows were actually inserted, which is what lets an import report
   * "40 added, 3 already there" without a round trip per word. The duplicate rule is the
   * table's unique index, not application code — see migration 0164.
   */
  addWords(words: readonly PictionaryWord[], userId: number): number;
  /** Removes one word by id. Returns whether a row went. */
  deleteWord(id: number): boolean;
  /** Removes every custom word, or every one in a tier. Returns how many went. */
  clearWords(tier: PictionaryTier | undefined): number;
  /** How many custom words exist, per tier. Tiers with none are present and zero. */
  countByTier(): Record<PictionaryTier, number>;
}
