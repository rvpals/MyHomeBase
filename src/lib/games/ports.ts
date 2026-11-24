import type { SavedRunWriteData, ScoreWriteData } from "./schema";
import type {
  ChessLevel,
  ChessResult,
  ChessResultWriteData,
  ChessSaveWriteData,
  PictionaryTier,
  PictionaryWord,
  Score,
  StoredChessSave,
  StoredPictionaryWord,
  StoredSavedRun,
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

/**
 * Runs in progress that a player can come back to, in `gam_saved_runs`.
 *
 * One row per player per game key: saving again replaces the row. The repository
 * stores `state` as text and never reads inside it. Each game decodes and checks its
 * own format (`restoreArrowRun` for Arrows).
 *
 * A separate port from the scoreboard: a run in progress is private to one player,
 * while every score is shared.
 */
export interface SavedRunRepository {
  getSavedRun(userId: number, gameKey: string): StoredSavedRun | undefined;
  /** Inserts the run, or replaces the player's existing one for that game. */
  upsertSavedRun(input: SavedRunWriteData): void;
  /** Returns whether a row was deleted. */
  deleteSavedRun(userId: number, gameKey: string): boolean;
  /** Most recently saved first, for everyone or for one player. */
  listSavedRuns(userId: number | undefined): StoredSavedRun[];
}

/**
 * Finished chess games, in `gam_chess_results` (migration 0175).
 *
 * A third chess port rather than methods on the save repository: a result is a public
 * fact about a game that is over, where a save is a private game still in progress, and
 * nothing that reads one has any business writing the other.
 *
 * Scoped by `userId` like the saves, because a record is personal — the shared thing
 * is the scoreboard.
 */
export interface ChessResultRepository {
  recordChessResult(input: ChessResultWriteData): void;
  /**
   * How many of each result the player has against each level.
   *
   * Counted in SQL rather than by listing the rows: a record is three numbers per
   * level, and reading every game ever played to add them up would grow without bound.
   */
  countChessResults(userId: number): Partial<Record<ChessLevel, Record<ChessResult, number>>>;
}

/**
 * Named chess games, in `gam_chess_saves` (migration 0173). Many rows per player,
 * unlike the one-per-game-key `SavedRunRepository` above — a library of games rather
 * than a resume point. See `chess-save.ts` for why chess uses both.
 *
 * **Every method is scoped by `userId`**, including the reads. A saved game is private,
 * and a repository that could return another player's row and then be filtered is one
 * forgotten `if` away from leaking it — the same contract `ScratchpadRepository` holds
 * for the same reason. There is deliberately no "list every player's saves" method:
 * nothing in the app needs one, and the scoreboard is where shared things live.
 */
export interface ChessSaveRepository {
  /** The player's saved games, most recently saved first. */
  listChessSaves(userId: number): StoredChessSave[];
  getChessSave(userId: number, id: number): StoredChessSave | undefined;
  /**
   * The player's save under this name, if any — matched the way the unique index does,
   * so the use-case's "saving over a name replaces it" and the table agree.
   */
  findChessSaveByName(userId: number, name: string): StoredChessSave | undefined;
  /** Inserts, or replaces the player's save of the same name. Returns the row's id. */
  upsertChessSave(input: ChessSaveWriteData): number;
  /** Returns whether a row was deleted. */
  deleteChessSave(userId: number, id: number): boolean;
  /** How many games this player has saved — for the per-player cap. */
  countChessSaves(userId: number): number;
}
