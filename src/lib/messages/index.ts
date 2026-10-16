export type { MessageCounts, MessageReadState, SystemMessage } from "./types";
export type { MessageRepository } from "./ports";
export {
  LEGACY_MESSAGE_MODULE,
  MAX_BULK_IDS,
  MESSAGE_MODULES,
  MESSAGE_TITLE_MAX,
  createMessageSchema,
  deleteMessagesSchema,
  markMessagesReadSchema,
  messageModuleSchema,
  messageReadStateSchema,
  messageRetentionDaysSchema,
  setMessagesLockedSchema,
  systemMessageSchema,
  type CreateMessage,
  type CreateMessageInput,
  type MarkMessagesReadInput,
  type MessageModule,
  type SetMessagesLockedInput,
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
  listPendingPopupMessages,
  markAllMessagesRead,
  markMessagesRead,
  pruneMessages,
  setMessagesLocked,
} from "./messages";
