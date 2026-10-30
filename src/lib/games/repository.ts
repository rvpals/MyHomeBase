import type Database from "better-sqlite3";
import type { PictionaryWordRepository, ScoreRepository } from "./ports";
import type { ScoreWriteData } from "./schema";
import {
  PICTIONARY_TIERS,
  type PictionaryTier,
  type PictionaryWord,
  type Score,
  type StoredPictionaryWord,
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
