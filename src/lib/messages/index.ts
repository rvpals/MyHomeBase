export type { MessageCounts, MessageReadState, SystemMessage } from "./types";
export type { MessageRepository } from "./ports";
export {
  MESSAGE_TITLE_MAX,
  createMessageSchema,
  markMessagesReadSchema,
  messageReadStateSchema,
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
  getMessage,
  getMessageQueue,
  listMessages,
  markAllMessagesRead,
  markMessagesRead,
} from "./messages";
