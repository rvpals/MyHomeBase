/**
 * One message in the application-wide queue.
 *
 * Household-wide: there is one queue and one read state, so `readAt` is the
 * answer for everybody rather than for the reader who asked. See
 * `migrations/0109_create_system_messages.md` for why, and for the shape this
 * would take if that ever stops holding.
 */
export interface SystemMessage {
  id: number;
  createdAt: string;
  /**
   * When somebody read it. **Absent, never null** — SQLite's NULL is mapped to
   * `undefined` in the repository so nothing downstream has to handle two
   * spellings of "not read".
   */
  readAt?: string;
  title: string;
  /** May be blank: a title-only message is a legitimate one-liner. */
  body: string;
  /** Who filed it, e.g. "Investments monitor". Blank when unattributed. */
  source: string;
}

/** Which half of the queue — the screen's two tabs. */
export type MessageReadState = "unread" | "read";

/**
 * Both halves in one read. The header's badge needs `unread`, and the Read
 * tab's label shows `read`, so returning them together is one query rather
 * than two round trips for a number each.
 */
export interface MessageCounts {
  unread: number;
  read: number;
}
