import type Database from "better-sqlite3";
import type { MessageRepository } from "./ports";
import type { CreateMessage } from "./schema";
import type { MessageCounts, MessageReadState, SystemMessage } from "./types";

interface MessageRow {
  id: number;
  created_at: string;
  read_at: string | null;
  title: string;
  body: string;
  source: string;
}

/**
 * Row to domain type. The one place SQLite's NULL becomes `undefined`, so
 * `SystemMessage.readAt` has a single spelling of "not read" everywhere above.
 */
function toMessage(row: MessageRow): SystemMessage {
  return {
    id: row.id,
    createdAt: row.created_at,
    readAt: row.read_at ?? undefined,
    title: row.title,
    body: row.body,
    source: row.source,
  };
}

/** The message queue's storage. See migrations/0109. */
export class SqliteMessageRepository implements MessageRepository {
  constructor(private readonly db: Database.Database) {}

  listMessages(state: MessageReadState): SystemMessage[] {
    // Two statements rather than one with a parameterised predicate: the unread
    // branch is what `idx_messages_unread` is partial on, and a predicate SQLite
    // cannot prove matches the index would quietly scan instead.
    //
    // `(created_at DESC, id DESC)` — created_at is a second-resolution string, so
    // several messages filed by one monitor run share it. The id breaks that tie
    // in insertion order, which is stable where an unordered tie is not.
    const sql =
      state === "unread"
        ? `SELECT * FROM sys_messages WHERE read_at IS NULL ORDER BY created_at DESC, id DESC`
        : `SELECT * FROM sys_messages WHERE read_at IS NOT NULL ORDER BY created_at DESC, id DESC`;
    const rows = this.db.prepare(sql).all() as MessageRow[];
    return rows.map(toMessage);
  }

  getMessageById(id: number): SystemMessage | undefined {
    const row = this.db.prepare("SELECT * FROM sys_messages WHERE id = ?").get(id) as
      | MessageRow
      | undefined;
    return row ? toMessage(row) : undefined;
  }

  countMessages(): MessageCounts {
    // One pass for both halves. Two `COUNT(*)` queries would read the table
    // twice to answer one question the header asks on every page.
    //
    // `SUM(CASE …)` rather than the tidier `COUNT(*) FILTER (WHERE …)`: FILTER
    // needs SQLite 3.30+, and this runs against whatever SQLite the NAS's build
    // of better-sqlite3 links. The CASE form is equivalent and has no floor.
    // `COALESCE` because SUM over zero rows is NULL, not 0 — an empty queue must
    // report 0/0 rather than crashing the header badge.
    const row = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN read_at IS NULL     THEN 1 ELSE 0 END), 0) AS unread,
           COALESCE(SUM(CASE WHEN read_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS read_count
         FROM sys_messages`,
      )
      .get() as { unread: number; read_count: number };
    return { unread: row.unread, read: row.read_count };
  }

  createMessage(input: CreateMessage): SystemMessage {
    const row = this.db
      .prepare(
        `INSERT INTO sys_messages (title, body, source)
         VALUES (?, ?, ?)
         RETURNING *`,
      )
      .get(input.title, input.body, input.source) as MessageRow;
    return toMessage(row);
  }

  markRead(messageIds: number[]): number {
    if (messageIds.length === 0) return 0;

    // `read_at IS NULL` in the predicate, not just the id list: stamping a
    // message that was already read would move its timestamp, rewriting when it
    // was first seen. It also makes the returned count mean "how many this call
    // actually changed", which is what tolerating a double-click depends on.
    const placeholders = messageIds.map(() => "?").join(", ");
    const result = this.db
      .prepare(
        `UPDATE sys_messages
            SET read_at = datetime('now')
          WHERE read_at IS NULL AND id IN (${placeholders})`,
      )
      .run(...messageIds);
    return result.changes;
  }

  markAllRead(): number {
    const result = this.db
      .prepare(`UPDATE sys_messages SET read_at = datetime('now') WHERE read_at IS NULL`)
      .run();
    return result.changes;
  }
}
