export type { MessageCounts, MessageReadState, SystemMessage } from "./types";
export type { MessageRepository } from "./ports";
export {
  MAX_BULK_IDS,
  MESSAGE_TITLE_MAX,
  createMessageSchema,
  deleteMessagesSchema,
  markMessagesReadSchema,
  messageReadStateSchema,
  messageRetentionDaysSchema,
  systemMessageSchema,
  type CreateMessage,
  type CreateMessageInput,
  type MarkMessagesReadInput,
} from "./schema";
export { SqliteMessageRepository } from "./repository";
export { FakeMessageRepository } from "./fakes";
export {
  countMessages,
  createMessage,
  deleteMessages,
  getMessage,
  getMessageQueue,
  listAllMessages,
  listMessages,
  markAllMessagesRead,
  markMessagesRead,
  pruneMessages,
} from "./messages";
