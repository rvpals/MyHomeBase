import type { MessageRepository } from "./ports";
import type { CreateMessage } from "./schema";
import type { MessageCounts, MessageReadState, SystemMessage } from "./types";

/**
 * An in-memory message queue for tests — a hand-written fake rather than a
 * mock, per ARCHITECTURE.md, so a test reads as "given these messages" instead
 * of as a list of expected calls.
 *
 * Shared by this module's tests and by `ticker-monitors`, which files messages
 * through this port and needs to assert what came out.
 */
export class FakeMessageRepository implements MessageRepository {
  readonly messages: SystemMessage[] = [];
  private nextId = 1;

  constructor(seed: SystemMessage[] = []) {
    for (const message of seed) {
      this.messages.push(message);
      this.nextId = Math.max(this.nextId, message.id + 1);
    }
  }

  listMessages(state: MessageReadState): SystemMessage[] {
    return this.messages
      .filter((message) => (state === "unread" ? !message.readAt : Boolean(message.readAt)))
      .sort((a, b) => b.id - a.id);
  }

  getMessageById(id: number): SystemMessage | undefined {
    return this.messages.find((message) => message.id === id);
  }

  countMessages(): MessageCounts {
    return {
      unread: this.messages.filter((message) => !message.readAt).length,
      read: this.messages.filter((message) => Boolean(message.readAt)).length,
    };
  }

  createMessage(input: CreateMessage): SystemMessage {
    const message: SystemMessage = {
      id: this.nextId++,
      // Fixed rather than `new Date()`: a test asserting on ordering or on a
      // rendered date should not depend on the clock.
      createdAt: "2026-01-01 00:00:00",
      title: input.title,
      body: input.body,
      source: input.source,
      module: input.module,
      // Always unlocked on arrival: `createMessageSchema` has no `isLocked`, so a
      // producer cannot file something nobody can delete. Locking is an admin act.
      isLocked: false,
      // Carried from the input, unlike `isLocked`: interrupting is the
      // producer's decision at the moment of filing (migrations/0149).
      isPopup: input.isPopup,
    };
    this.messages.push(message);
    return message;
  }

  listPendingPopups(): SystemMessage[] {
    // Oldest first, matching the SQL's `(created_at ASC, id ASC)`. Sorted by id
    // alone because the fake stamps every row with the same fixed date, which
    // is the tie the real query's second key breaks.
    return this.messages
      .filter((message) => message.isPopup && !message.readAt)
      .sort((a, b) => a.id - b.id);
  }

  markRead(messageIds: number[]): number {
    let changed = 0;
    for (const message of this.messages) {
      // Already-read rows are skipped, exactly as the SQL's `read_at IS NULL`
      // predicate does — so the count means "how many this call changed".
      if (messageIds.includes(message.id) && !message.readAt) {
        message.readAt = "2026-01-02 00:00:00";
        changed += 1;
      }
    }
    return changed;
  }

  markAllRead(): number {
    let changed = 0;
    for (const message of this.messages) {
      if (!message.readAt) {
        message.readAt = "2026-01-02 00:00:00";
        changed += 1;
      }
    }
    return changed;
  }

  listAllMessages(): SystemMessage[] {
    // Newest first. Sorted by id rather than by `createdAt` because the fake stamps
    // every row with the same fixed date -- id is insertion order, which is what the
    // SQL's `(created_at DESC, id DESC)` falls back to for exactly that tie.
    return [...this.messages].sort((a, b) => b.id - a.id);
  }

  setLocked(messageIds: number[], locked: boolean): number {
    let changed = 0;
    for (const message of this.messages) {
      // Rows already in the requested state are skipped, exactly as the SQL's
      // `is_locked != ?` predicate does -- so the count means "how many changed".
      if (messageIds.includes(message.id) && message.isLocked !== locked) {
        message.isLocked = locked;
        changed += 1;
      }
    }
    return changed;
  }

  deleteMessages(messageIds: number[]): number {
    let removed = 0;
    for (const id of new Set(messageIds)) {
      const index = this.messages.findIndex((message) => message.id === id);
      // Locked rows are skipped, matching the SQL's `is_locked = 0`. A fake that
      // deleted them would let a test pass against behaviour the real table
      // refuses -- the one thing a hand-written fake must never do.
      if (index !== -1 && !this.messages[index].isLocked) {
        this.messages.splice(index, 1);
        removed += 1;
      }
    }
    return removed;
  }

  deleteMessagesBefore(cutoff: string): number {
    // String comparison, matching the SQL exactly -- both halves of this port have to
    // agree on strictly-before, or a test would pass against a fake the real table
    // disagrees with.
    // `!isLocked` as well: purge immunity is the lock's point, and both halves of
    // this port have to agree on it.
    const doomed = this.messages.filter(
      (message) => !message.isLocked && message.createdAt < cutoff,
    );
    for (const message of doomed) {
      this.messages.splice(this.messages.indexOf(message), 1);
    }
    return doomed.length;
  }
}
