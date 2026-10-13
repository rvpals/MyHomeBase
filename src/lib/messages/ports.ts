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
   * Locks or unlocks the given messages. Returns how many rows actually changed,
   * so re-locking an already-locked message counts 0 rather than throwing — the
   * same tolerance `markRead` has, for the same two-tabs-open reason.
   */
  setLocked(messageIds: number[], locked: boolean): number;
  /**
   * Deletes the given messages permanently, **skipping locked ones**. Returns how
   * many rows actually went, so an id already deleted in another tab counts 0
   * rather than throwing — and so does a locked id, which is why the caller must
   * not read the count as "all of them went". See migration 0142.
   */
  deleteMessages(messageIds: number[]): number;
  /**
   * Deletes every message filed strictly before `cutoff` (a SQLite timestamp),
   * **skipping locked ones**. Returns how many went. The age-based purge the
   * admin screen drives.
   *
   * Purge immunity is the point of the lock, not a side effect: a locked message
   * stays however old it gets.
   */
  deleteMessagesBefore(cutoff: string): number;
}
