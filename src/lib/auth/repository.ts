import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type { SessionRepository } from "./ports";
import type { Session } from "./types";

interface SessionRow {
  id: string;
  user_id: number;
  created_at: string;
  expires_at: string;
}

function toDomain(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

// The real repository. Swap the database without touching any use-case.
export class SqliteSessionRepository implements SessionRepository {
  constructor(private db: Database.Database) {}

  createSession(userId: number, expiresAt: string): Session {
    const id = randomBytes(32).toString("hex");
    this.db
      .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
      .run(id, userId, expiresAt);

    const created = this.getSessionById(id);
    if (!created) throw new Error("Failed to read back newly created session.");
    return created;
  }

  getSessionById(id: string): Session | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
      | SessionRow
      | undefined;
    return row ? toDomain(row) : undefined;
  }

  deleteSession(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  deleteSessionsForUser(userId: number): void {
    this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }
}
