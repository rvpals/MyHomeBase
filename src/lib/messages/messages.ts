import type { MessageRepository } from "./ports";
import {
  createMessageSchema,
  markMessagesReadSchema,
  messageReadStateSchema,
  type CreateMessageInput,
} from "./schema";
import type { MessageCounts, MessageReadState, SystemMessage } from "./types";

/**
 * The message queue's use-cases.
 *
 * Every one takes the repository as its first argument and returns data, so the
 * web actions and the CLI drive the identical function — see ARCHITECTURE.md.
 * Nothing here knows about React, a request, or a screen.
 */

/** One half of the queue, newest first. */
export function listMessages(
  repo: MessageRepository,
  state: MessageReadState,
): SystemMessage[] {
  return repo.listMessages(messageReadStateSchema.parse(state));
}

export function getMessage(repo: MessageRepository, id: number): SystemMessage | undefined {
  return repo.getMessageById(id);
}

/** Unread and read together — the header badge and the tab labels in one read. */
export function countMessages(repo: MessageRepository): MessageCounts {
  return repo.countMessages();
}

/**
 * Files a message. The one way anything in the app adds to the queue.
 *
 * Validated here rather than at each caller, so a monitor, a CLI command and a
 * future scheduled job cannot file differently-shaped rows.
 */
export function createMessage(
  repo: MessageRepository,
  input: CreateMessageInput,
): SystemMessage {
  return repo.createMessage(createMessageSchema.parse(input));
}

/**
 * Marks the given messages read, returning how many rows actually changed.
 *
 * An id that was already read — or has since been deleted — counts as 0 rather
 * than throwing. Two tabs open on the same queue is an ordinary thing, and the
 * second one to be clicked should not produce an error for doing what the first
 * already did.
 */
export function markMessagesRead(repo: MessageRepository, messageIds: number[]): number {
  const input = markMessagesReadSchema.parse({ messageIds });
  return repo.markRead(input.messageIds);
}

/** Empties the unread half. Returns how many were stamped. */
export function markAllMessagesRead(repo: MessageRepository): number {
  return repo.markAllRead();
}

/**
 * The queue as the screen renders it: both halves and both counts, in one call.
 *
 * The window shows one tab at a time but names the count on the other, so a
 * caller that fetched only the active tab would still need a second read for
 * the inactive one's label. One function keeps the two consistent — a count
 * that disagrees with the list under it is the bug this prevents.
 */
export function getMessageQueue(repo: MessageRepository): {
  unread: SystemMessage[];
  read: SystemMessage[];
  counts: MessageCounts;
} {
  return {
    unread: repo.listMessages("unread"),
    read: repo.listMessages("read"),
    counts: repo.countMessages(),
  };
}
