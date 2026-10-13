import type Database from "better-sqlite3";
import type { MessageRepository } from "./ports";
import { LEGACY_MESSAGE_MODULE, messageModuleSchema, type CreateMessage } from "./schema";
import type { MessageCounts, MessageReadState, SystemMessage } from "./types";

interface MessageRow {
  id: number;
  created_at: string;
  read_at: string | null;
  title: string;
  body: string;
  source: string;
  module: string;
  is_locked: number;
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
    // A pre-0142 row carries '' — the column's default, meaning "filed before
    // anyone recorded a module". It reads as `system`, so the domain type has one
    // spelling of "no module" and no screen handles two. See migration 0142.
    //
    // Parsed rather than cast: the column is TEXT with no FK, so a row written by
    // hand (the SQL explorer, a migration) could hold anything. `safeParse` keeps
    // a junk slug from reaching the grid as a value no filter will ever match.
    module: row.module === "" ? LEGACY_MESSAGE_MODULE : readModule(row.module),
    // SQLite has no boolean: the column is INTEGER 0/1. One `!== 0` here rather
    // than a truthiness test at each reader.
    isLocked: row.is_locked !== 0,
  };
}

/**
 * A stored slug to the domain enum, falling back to `system` for anything
 * unrecognised rather than throwing.
 *
 * A read of the queue must not fail because one row holds a slug the enum no
 * longer lists — a module removed from `MESSAGE_MODULES` would otherwise take
 * the whole admin screen down with it, which is exactly the orphaning migration
 * 0142 avoided by keeping the column free of a foreign key.
 */
function readModule(value: string) {
  const parsed = messageModuleSchema.safeParse(value);
  return parsed.success ? parsed.data : LEGACY_MESSAGE_MODULE;
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
        `INSERT INTO sys_messages (title, body, source, module)
         VALUES (?, ?, ?, ?)
         RETURNING *`,
      )
      .get(input.title, input.body, input.source, input.module) as MessageRow;
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

  listAllMessages(): SystemMessage[] {
    // Rides `idx_messages_created_at`, and uses the same `(created_at DESC, id DESC)`
    // tie-break as `listMessages` — several messages from one monitor run share a
    // second, and the admin grid must not reorder them between reloads.
    const rows = this.db
      .prepare(`SELECT * FROM sys_messages ORDER BY created_at DESC, id DESC`)
      .all() as MessageRow[];
    return rows.map(toMessage);
  }

  setLocked(messageIds: number[], locked: boolean): number {
    if (messageIds.length === 0) return 0;

    // `is_locked != ?` in the predicate, not just the id list: a row already in
    // the requested state is left alone, so `changes` means "how many this call
    // actually flipped". Same shape, and the same reason, as `markRead` above —
    // it is what lets the screen report a real number after a double-click.
    const placeholders = messageIds.map(() => "?").join(", ");
    const target = locked ? 1 : 0;
    const result = this.db
      .prepare(
        `UPDATE sys_messages
            SET is_locked = ?
          WHERE is_locked != ? AND id IN (${placeholders})`,
      )
      .run(target, target, ...messageIds);
    return result.changes;
  }

  deleteMessages(messageIds: number[]): number {
    if (messageIds.length === 0) return 0;

    // `is_locked = 0` is the lock. It lives here, in the predicate, rather than
    // as a check above the call: the use-case, the CLI and the admin screen all
    // reach this one statement, and a guard in any of them could be bypassed by
    // the others. See migration 0142.
    const placeholders = messageIds.map(() => "?").join(", ");
    const result = this.db
      .prepare(`DELETE FROM sys_messages WHERE is_locked = 0 AND id IN (${placeholders})`)
      .run(...messageIds);
    return result.changes;
  }

  deleteMessagesBefore(cutoff: string): number {
    // `<`, not `<=`: the cutoff is "now minus N days", so a message filed at exactly
    // that instant is N days old, not older than N. Strictly-before is the honest
    // reading of "older than", and it matches the two sibling logs' prunes.
    //
    // A string comparison, which is why the cutoff must be SQLite's own
    // `YYYY-MM-DD HH:MM:SS` shape — see `toSqliteTimestampUtc`, whose doc comment
    // records what an ISO string with its "T" would silently do here.
    // `is_locked = 0` again: purge immunity is the point of the lock, not a side
    // effect. A locked message stays however old it gets.
    const result = this.db
      .prepare(`DELETE FROM sys_messages WHERE is_locked = 0 AND created_at < ?`)
      .run(cutoff);
    return result.changes;
  }
}
