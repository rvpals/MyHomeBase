import type Database from "better-sqlite3";
import type { ScoreRepository } from "./ports";
import type { ScoreWriteData } from "./schema";
import type { Score } from "./types";

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
