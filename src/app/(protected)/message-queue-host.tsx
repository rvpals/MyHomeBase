// Mounts the message queue into a shell's `headerActions` slot.
//
// A server component, so it can read the unread count from `deps` and hand the
// client component a first paint that already has the right badge — a count
// that appears a frame after hydration reads as a glitch on every page load.
//
// This exists so each module shell adds **one line** rather than repeating the
// action wiring ten times. The actions object is built here, at the one place
// the app layer and the component layer meet: a file under `src/components/`
// must not import from `src/app/`, which is why `MessageQueue` takes them as a
// prop at all.

import { MessageQueue, type MessageQueueActions } from "@/components/message-queue";
import { countMessages } from "@/lib/messages";
import { deps } from "@/lib/wiring";
import {
  loadMessageQueueAction,
  markAllMessagesReadAction,
  markMessagesReadAction,
} from "./messages-actions";

// Every value is the action **itself**, never an arrow around it. A wrapper
// closure compiles, typechecks and lints, then fails at request time with
// "Functions cannot be passed directly to Client Components" — the mistake
// `(protected)/layout.tsx` documents at length for the floating layer's props.
const messageQueueActions: MessageQueueActions = {
  load: loadMessageQueueAction,
  markRead: markMessagesReadAction,
  markAllRead: markAllMessagesReadAction,
};

export function MessageQueueHost() {
  // Counted rather than listed: the header needs one number, and reading both
  // halves of a year-old queue to render a badge would be the expensive way to
  // get it. The lists load when the window actually opens.
  const { unread } = countMessages(deps.messageRepo);

  return <MessageQueue initialUnreadCount={unread} actions={messageQueueActions} />;
}
