import type Database from "better-sqlite3";
import type {
  ChessResultRepository,
  ChessSaveRepository,
  PictionaryWordRepository,
  SavedRunRepository,
  ScoreRepository,
} from "./ports";
import type { SavedRunWriteData, ScoreWriteData } from "./schema";
import {
  PICTIONARY_TIERS,
  type ChessLevel,
  type ChessResult,
  type ChessResultWriteData,
  type ChessSaveWriteData,
  type PictionaryTier,
  type PictionaryWord,
  type Score,
  type StoredChessSave,
  type StoredPictionaryWord,
  type StoredSavedRun,
} from "./types";

interface ScoreRow {
  id: number;
  game_key: string;
  user_id: number;
  user_name: string | null;
  score: number;
  moves: number;
  played_at: string;
  created_at: string;
}

/**
 * The only file in the Games module that knows SQL.
 *
 * Every read LEFT JOINs `sys_users` for the display name. LEFT rather than INNER: a
 * score outlives the account that set it (deleting a user must not silently empty the
 * shared scoreboard), so a missing user reads as "Unknown player" instead of dropping
 * the row.
 */
export class SqliteGamesRepository implements ScoreRepository {
  constructor(private readonly db: Database.Database) {}

  recordScore(input: ScoreWriteData): Score {
    const result = this.db
      .prepare(
        `INSERT INTO gam_scores (game_key, user_id, score, moves, played_at, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(input.gameKey, input.userId, input.score, input.moves, input.playedAt);

    const created = this.getById(Number(result.lastInsertRowid));
    // The row was just inserted in the same connection, so this cannot miss — but it
    // is checked rather than asserted away, since a non-null assertion here would
    // become a confusing crash if the SELECT ever changed shape.
    if (!created) throw new Error("Failed to read back the score just recorded.");
    return created;
  }

  listTopScores(gameKey: string | undefined, limit: number): Score[] {
    // An earlier tie breaks ahead of a later one: two equal scores are ranked by who
    // got there first, which is the convention a high-score table implies.
    const rows = gameKey
      ? this.db
          .prepare(
            `${SELECT_SCORES} WHERE s.game_key = ?
             ORDER BY s.score DESC, s.played_at ASC LIMIT ?`,
          )
          .all(gameKey, limit)
      : this.db
          .prepare(`${SELECT_SCORES} ORDER BY s.score DESC, s.played_at ASC LIMIT ?`)
          .all(limit);

    return (rows as ScoreRow[]).map(toScore);
  }

  listRecentScores(limit: number): Score[] {
    const rows = this.db
      .prepare(`${SELECT_SCORES} ORDER BY s.played_at DESC, s.id DESC LIMIT ?`)
      .all(limit);
    return (rows as ScoreRow[]).map(toScore);
  }

  getBestScore(gameKey: string): Score | undefined {
    return this.listTopScores(gameKey, 1)[0];
  }

  countScores(gameKey: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS total FROM gam_scores WHERE game_key = ?")
      .get(gameKey) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  private getById(id: number): Score | undefined {
    const row = this.db.prepare(`${SELECT_SCORES} WHERE s.id = ?`).get(id) as
      | ScoreRow
      | undefined;
    return row ? toScore(row) : undefined;
  }
}

const SELECT_SCORES = `
  SELECT s.id, s.game_key, s.user_id, u.full_name AS user_name,
         s.score, s.moves, s.played_at, s.created_at
  FROM gam_scores s
  LEFT JOIN sys_users u ON u.id = s.user_id
`;

function toScore(row: ScoreRow): Score {
  return {
    id: row.id,
    gameKey: row.game_key,
    userId: row.user_id,
    userName: row.user_name ?? "Unknown player",
    score: row.score,
    moves: row.moves,
    playedAt: row.played_at,
    createdAt: row.created_at,
  };
}

interface PictionaryWordRow {
  id: number;
  word: string;
  tier: string;
  created_by_name: string | null;
  created_at: string;
}

/**
 * The custom Pictionary word bank.
 *
 * A second class in this file rather than more methods on `SqliteGamesRepository`: the
 * two ports are unrelated (see `ports.ts`), and a word command holding a handle that
 * can write to the scoreboard is the thing keeping them apart avoids.
 *
 * Reads LEFT JOIN `sys_users` for the importer's name, on the same reasoning every read
 * above does: a word outlives the account that imported it, so a deleted user leaves the
 * word with no name rather than dropping it from the list.
 */
export class SqlitePictionaryWordRepository implements PictionaryWordRepository {
  constructor(private readonly db: Database.Database) {}

  listWords(tier: PictionaryTier | undefined): StoredPictionaryWord[] {
    const rows = tier
      ? (this.db
          .prepare(
            `SELECT w.id, w.word, w.tier, u.full_name AS created_by_name, w.created_at
               FROM gam_pictionary_words w
               LEFT JOIN sys_users u ON u.id = w.created_by
              WHERE w.tier = ?
              ORDER BY w.word COLLATE NOCASE`,
          )
          .all(tier) as PictionaryWordRow[])
      : (this.db
          .prepare(
            `SELECT w.id, w.word, w.tier, u.full_name AS created_by_name, w.created_at
               FROM gam_pictionary_words w
               LEFT JOIN sys_users u ON u.id = w.created_by
              ORDER BY w.tier, w.word COLLATE NOCASE`,
          )
          .all() as PictionaryWordRow[]);

    return rows.map((row) => this.toStoredWord(row));
  }

  addWords(words: readonly PictionaryWord[], userId: number): number {
    // OR IGNORE, so re-importing a list someone already added is a no-op rather than a
    // constraint error the caller has to interpret. The unique index decides what a
    // duplicate is -- see migration 0164.
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO gam_pictionary_words (word, tier, created_by, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
    );

    // One transaction: a 300-word paste is 300 inserts, and committing each separately
    // is both slow and a half-imported list if anything fails part-way.
    const insertAll = this.db.transaction((batch: readonly PictionaryWord[]) => {
      let added = 0;
      for (const entry of batch) {
        added += insert.run(entry.word, entry.tier, userId).changes;
      }
      return added;
    });

    return insertAll(words);
  }

  deleteWord(id: number): boolean {
    return this.db.prepare(`DELETE FROM gam_pictionary_words WHERE id = ?`).run(id).changes > 0;
  }

  clearWords(tier: PictionaryTier | undefined): number {
    return tier
      ? this.db.prepare(`DELETE FROM gam_pictionary_words WHERE tier = ?`).run(tier).changes
      : this.db.prepare(`DELETE FROM gam_pictionary_words`).run().changes;
  }

  countByTier(): Record<PictionaryTier, number> {
    const rows = this.db
      .prepare(`SELECT tier, COUNT(*) AS total FROM gam_pictionary_words GROUP BY tier`)
      .all() as { tier: string; total: number }[];

    // Every tier present and zeroed, so a caller never has to distinguish "no words" from
    // "no row for that tier" -- the screen reads `counts[tier]` and gets a number.
    const counts = {} as Record<PictionaryTier, number>;
    for (const tier of PICTIONARY_TIERS) counts[tier] = 0;
    for (const row of rows) {
      const tier = PICTIONARY_TIERS.find((entry) => entry === row.tier);
      if (tier) counts[tier] = row.total;
    }
    return counts;
  }

  /**
   * One row as a domain object.
   *
   * A stored `tier` that is not one this build knows falls back to `easy` rather than
   * throwing: the column is validated on the way in, so this can only happen to a row
   * written by a future build or edited by hand, and losing a word's tier is a better
   * outcome than a Configuration screen that cannot render.
   */
  private toStoredWord(row: PictionaryWordRow): StoredPictionaryWord {
    return {
      id: row.id,
      word: row.word,
      tier: PICTIONARY_TIERS.find((entry) => entry === row.tier) ?? "easy",
      createdBy: row.created_by_name ?? undefined,
      createdAt: row.created_at,
    };
  }
}

interface SavedRunRow {
  user_id: number;
  user_name: string | null;
  game_key: string;
  format_version: number;
  state_json: string;
  saved_at: string;
}

const SELECT_SAVED_RUNS = `
  SELECT r.user_id, u.full_name AS user_name, r.game_key, r.format_version,
         r.state_json, r.saved_at
  FROM gam_saved_runs r
  LEFT JOIN sys_users u ON u.id = r.user_id
`;

/**
 * Runs in progress (migration 0171). One row per player per game key, kept unique by
 * the table's UNIQUE index, so a save is a single upsert.
 *
 * Another class in this file, for the reason the word bank has one: a separate port.
 */
export class SqliteSavedRunRepository implements SavedRunRepository {
  constructor(private readonly db: Database.Database) {}

  getSavedRun(userId: number, gameKey: string): StoredSavedRun | undefined {
    const row = this.db
      .prepare(`${SELECT_SAVED_RUNS} WHERE r.user_id = ? AND r.game_key = ?`)
      .get(userId, gameKey) as SavedRunRow | undefined;
    return row ? toSavedRun(row) : undefined;
  }

  upsertSavedRun(input: SavedRunWriteData): void {
    // `created_at` is left as it was on an update, so it still shows when the run began.
    this.db
      .prepare(
        `INSERT INTO gam_saved_runs (user_id, game_key, format_version, state_json, saved_at, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT (user_id, game_key) DO UPDATE SET
           format_version = excluded.format_version,
           state_json     = excluded.state_json,
           saved_at       = excluded.saved_at`,
      )
      .run(input.userId, input.gameKey, input.formatVersion, input.state, input.savedAt);
  }

  deleteSavedRun(userId: number, gameKey: string): boolean {
    return (
      this.db
        .prepare(`DELETE FROM gam_saved_runs WHERE user_id = ? AND game_key = ?`)
        .run(userId, gameKey).changes > 0
    );
  }

  listSavedRuns(userId: number | undefined): StoredSavedRun[] {
    const rows =
      userId === undefined
        ? this.db.prepare(`${SELECT_SAVED_RUNS} ORDER BY r.saved_at DESC`).all()
        : this.db
            .prepare(`${SELECT_SAVED_RUNS} WHERE r.user_id = ? ORDER BY r.saved_at DESC`)
            .all(userId);
    return (rows as SavedRunRow[]).map(toSavedRun);
  }
}

function toSavedRun(row: SavedRunRow): StoredSavedRun {
  return {
    userId: row.user_id,
    userName: row.user_name ?? "Unknown player",
    gameKey: row.game_key,
    formatVersion: row.format_version,
    state: row.state_json,
    savedAt: row.saved_at,
  };
}

interface ChessSaveRow {
  id: number;
  user_id: number;
  name: string;
  format_version: number;
  state_json: string;
  saved_at: string;
  created_at: string;
}

/**
 * Named chess games (migration 0173).
 *
 * No `LEFT JOIN sys_users` here, unlike every read above: a saved game is only ever
 * read by the player it belongs to, so there is no name to show — the owner already
 * knows who they are. That is also why every statement carries `user_id = ?` in its
 * WHERE clause rather than relying on a caller to check afterwards.
 */
export class SqliteChessSaveRepository implements ChessSaveRepository {
  constructor(private readonly db: Database.Database) {}

  listChessSaves(userId: number): StoredChessSave[] {
    const rows = this.db
      .prepare(`${SELECT_CHESS_SAVES} WHERE user_id = ? ORDER BY saved_at DESC, id DESC`)
      .all(userId) as ChessSaveRow[];
    return rows.map(toChessSave);
  }

  getChessSave(userId: number, id: number): StoredChessSave | undefined {
    const row = this.db
      .prepare(`${SELECT_CHESS_SAVES} WHERE user_id = ? AND id = ?`)
      .get(userId, id) as ChessSaveRow | undefined;
    return row ? toChessSave(row) : undefined;
  }

  findChessSaveByName(userId: number, name: string): StoredChessSave | undefined {
    // NOCASE, matching the unique index exactly: "Sunday game" and "sunday game" are
    // the same save, and if these two disagreed the upsert below would hit a constraint
    // error instead of replacing the row the player meant.
    const row = this.db
      .prepare(`${SELECT_CHESS_SAVES} WHERE user_id = ? AND name = ? COLLATE NOCASE`)
      .get(userId, name) as ChessSaveRow | undefined;
    return row ? toChessSave(row) : undefined;
  }

  upsertChessSave(input: ChessSaveWriteData): number {
    // `created_at` is left alone on an update, so a save still shows when that game was
    // first kept rather than when it was last written — the same call `upsertSavedRun`
    // makes above.
    this.db
      .prepare(
        `INSERT INTO gam_chess_saves (user_id, name, format_version, state_json, saved_at, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT (user_id, name COLLATE NOCASE) DO UPDATE SET
           format_version = excluded.format_version,
           state_json     = excluded.state_json,
           saved_at       = excluded.saved_at`,
      )
      .run(input.userId, input.name, input.formatVersion, input.state, input.savedAt);

    // An ON CONFLICT update reports `lastInsertRowid` from the insert that did not
    // happen, so the id is read back by name rather than taken from the result.
    const saved = this.findChessSaveByName(input.userId, input.name);
    if (!saved) throw new Error("Failed to read back the game just saved.");
    return saved.id;
  }

  deleteChessSave(userId: number, id: number): boolean {
    return (
      this.db
        .prepare(`DELETE FROM gam_chess_saves WHERE user_id = ? AND id = ?`)
        .run(userId, id).changes > 0
    );
  }

  countChessSaves(userId: number): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS total FROM gam_chess_saves WHERE user_id = ?")
      .get(userId) as { total: number } | undefined;
    return row?.total ?? 0;
  }
}

/**
 * Finished chess games (migration 0175).
 *
 * Its own class for the reason the word bank and the saves have theirs: a separate
 * port. Nothing here reads a saved game and nothing in the save repository writes a
 * result.
 */
export class SqliteChessResultRepository implements ChessResultRepository {
  constructor(private readonly db: Database.Database) {}

  recordChessResult(input: ChessResultWriteData): void {
    this.db
      .prepare(
        `INSERT INTO gam_chess_results (user_id, level, result, moves, score, played_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(input.userId, input.level, input.result, input.moves, input.score, input.playedAt);
  }

  countChessResults(
    userId: number,
  ): Partial<Record<ChessLevel, Record<ChessResult, number>>> {
    // Grouped in SQL: a record is three numbers per level, and reading every game ever
    // played in order to add them up would grow without bound.
    const rows = this.db
      .prepare(
        `SELECT level, result, COUNT(*) AS total
           FROM gam_chess_results
          WHERE user_id = ?
          GROUP BY level, result`,
      )
      .all(userId) as { level: string; result: string; total: number }[];

    const counted: Partial<Record<ChessLevel, Record<ChessResult, number>>> = {};
    for (const row of rows) {
      const level = row.level as ChessLevel;
      const result = row.result as ChessResult;
      // A row whose level or result this build does not know is skipped rather than
      // crashing the screen — the columns are validated on the way in, so it can only
      // come from a future build or a hand-edited row.
      if (!["beginner", "intermediate", "advanced"].includes(level)) continue;
      if (!["win", "loss", "draw"].includes(result)) continue;

      const forLevel = (counted[level] ??= { win: 0, loss: 0, draw: 0 });
      forLevel[result] = row.total;
    }
    return counted;
  }
}

const SELECT_CHESS_SAVES = `
  SELECT id, user_id, name, format_version, state_json, saved_at, created_at
  FROM gam_chess_saves
`;

function toChessSave(row: ChessSaveRow): StoredChessSave {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    formatVersion: row.format_version,
    state: row.state_json,
    savedAt: row.saved_at,
    createdAt: row.created_at,
  };
}
