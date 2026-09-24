import type { CreateMessage } from "./schema";
import type { MessageCounts, MessageReadState, SystemMessage } from "./types";

/**
 * What the message queue's use-cases need from storage. The concrete
 * implementation is wired in `wiring.ts`; tests wire in `FakeMessageRepository`.
 */
export interface MessageRepository {
  /**
   * One half of the queue, newest first. The screen's two tabs are two calls
   * with different arguments rather than one call the view filters, so the
   * unread tab's query can ride the partial index (migration 0109).
   */
  listMessages(state: MessageReadState): SystemMessage[];
  getMessageById(id: number): SystemMessage | undefined;
  /** Unread and read in one read — what the header badge needs. */
  countMessages(): MessageCounts;
  /** Takes the **validated** shape — the use-case parses before calling. */
  createMessage(input: CreateMessage): SystemMessage;
  /**
   * Stamps `read_at` on the given ids. Returns how many rows actually changed,
   * so an id already read (or already gone) is tolerated rather than throwing —
   * two tabs open on the same queue is an ordinary thing.
   */
  markRead(messageIds: number[]): number;
  /** Stamps every unread message. What the "Mark all read" control calls. */
  markAllRead(): number;
  /**
   * Both halves in one list, newest first. What the admin screen reads: it shows
   * read and unread together with a state column, so two calls would be two
   * queries for one table the screen then has to re-merge and re-sort.
   */
  listAllMessages(): SystemMessage[];
  /**
   * Deletes the given messages permanently. Returns how many rows actually went,
   * so an id already deleted in another tab counts 0 rather than throwing.
   */
  deleteMessages(messageIds: number[]): number;
  /**
   * Deletes every message filed strictly before `cutoff` (a SQLite timestamp).
   * Returns how many went. The age-based purge the admin screen drives.
   */
  deleteMessagesBefore(cutoff: string): number;
}
