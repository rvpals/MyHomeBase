import type { MessageModule } from "./schema";

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
  /**
   * The module the producer belongs to, e.g. "investments". Never blank:
   * "system" is the slug for the app's own producers (admin jobs, the CLI),
   * and the repository maps a pre-0142 row's empty string onto it, so there is
   * one spelling of "no module" everywhere above.
   *
   * Distinct from `source`, which names the producer itself. Two monitors and a
   * watch list are three sources and one module.
   */
  module: MessageModule;
  /**
   * Locked against deletion — by the bulk delete *and* by the age purge.
   *
   * The queue's only protected state. Unlock it to delete it; there is no
   * force-delete, by choice.
   */
  isLocked: boolean;
  /**
   * Filed by a producer that asked to interrupt — a ticker monitor with its
   * Popup option ticked (migrations/0149). The home screen shows every such
   * message that is still unread, in one dialog, and clicking OK marks them
   * read.
   *
   * **A fact about the message, not a lookup of its producer's current
   * setting.** Untick Popup this afternoon and the message filed this morning
   * was still a popup when it was filed. See migration 0149 for why it is
   * copied here rather than joined back to the monitor.
   *
   * So "is a popup pending" is `isPopup && !readAt` — there is no separate
   * dismissed flag, because `readAt` already is one.
   */
  isPopup: boolean;
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
