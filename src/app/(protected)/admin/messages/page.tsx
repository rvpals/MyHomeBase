import { listAllMessages } from "@/lib/messages";
import { deps } from "@/lib/wiring";
import { MessagesView } from "./view";

/**
 * Administration → Message Queue: the whole queue in one grid, and the two ways
 * to remove from it — delete the ticked rows, or purge everything past an age.
 *
 * The header bell shows the same table but does a different job: it is the
 * reader's inbox, where the only verb is "mark read". This screen is the admin's,
 * where the verb is "delete". Nothing here marks anything read.
 */
export default async function AdminMessagesPage() {
  // Both halves together, newest first. The grid shows a state column and filters
  // in the view, so it wants one list rather than the header's split pair.
  const messages = listAllMessages(deps.messageRepo);

  return <MessagesView messages={messages} />;
}
