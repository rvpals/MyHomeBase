// The application-wide message queue from the terminal — the same use-cases the
// header's bell drives.
//
//   npm run cli -- messages list
//   npm run cli -- messages list read
//   npm run cli -- messages count
//   npm run cli -- messages read 12 13
//   npm run cli -- messages read-all
//   npm run cli -- messages file "Title" "Body text"
//   npm run cli -- messages list-all
//   npm run cli -- messages delete 12 13
//   npm run cli -- messages prune 30
//
// `file` exists so a shell script or a cron job can put a notice in front of the
// household without going through the web app — which is the point of the queue
// being a library use-case rather than a screen.

import {
  countMessages,
  createMessage,
  deleteMessages,
  listAllMessages,
  listMessages,
  markAllMessagesRead,
  markMessagesRead,
  pruneMessages,
  type SystemMessage,
} from "@/lib/messages";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";

const USAGE = `Usage:
  messages list [unread|read]
  messages list-all
  messages count
  messages read <id> [id...]
  messages read-all
  messages file <title> [body]
  messages delete <id> [id...]
  messages prune <days>`;

function printMessage(message: SystemMessage): void {
  const mark = message.readAt ? " " : "*";
  console.log(`${mark} [${message.id}] ${message.createdAt}  ${message.title}`);
  if (message.body !== "") console.log(`       ${message.body}`);
  if (message.source !== "") console.log(`       — ${message.source}`);
}

export async function messagesCommand(args: string[]): Promise<void> {
  const [action, ...rest] = args;

  // Wrapped for the same reason every other write command is: the schema throws
  // on a blank title or an empty id list, and that should print as a message
  // with an exit code rather than a stack trace.
  try {
    switch (action) {
      case undefined:
      case "list": {
        const state = rest[0] ?? "unread";
        if (state !== "unread" && state !== "read") {
          console.error(USAGE);
          process.exitCode = 1;
          return;
        }
        const messages = listMessages(deps.messageRepo, state);
        if (messages.length === 0) {
          console.log(state === "unread" ? "No unread messages." : "Nothing read yet.");
          return;
        }
        for (const message of messages) printMessage(message);
        return;
      }

      case "count": {
        const counts = countMessages(deps.messageRepo);
        console.log(`${counts.unread} unread, ${counts.read} read.`);
        return;
      }

      case "read": {
        const ids = rest.map(Number);
        if (ids.length === 0 || ids.some((id) => !Number.isInteger(id))) {
          console.error(USAGE);
          process.exitCode = 1;
          return;
        }
        const changed = markMessagesRead(deps.messageRepo, ids);
        console.log(`Marked ${changed} message(s) read.`);
        return;
      }

      case "read-all": {
        console.log(`Marked ${markAllMessagesRead(deps.messageRepo)} message(s) read.`);
        return;
      }

      case "file": {
        const [title, ...bodyParts] = rest;
        const message = createMessage(deps.messageRepo, {
          title: title ?? "",
          body: bodyParts.join(" "),
          source: "CLI",
        });
        console.log(`Filed message ${message.id}: ${message.title}`);
        return;
      }

      case "list-all": {
        // Read and unread together, the way the admin screen lists them.
        const messages = listAllMessages(deps.messageRepo);
        if (messages.length === 0) {
          console.log("The queue is empty.");
          return;
        }
        for (const message of messages) printMessage(message);
        return;
      }

      case "delete": {
        const ids = rest.map(Number);
        if (ids.length === 0 || ids.some((id) => !Number.isInteger(id))) {
          console.error(USAGE);
          process.exitCode = 1;
          return;
        }
        // Permanent, and unlike `read` it is not idempotent in a useful way --
        // the count is how many rows actually went.
        const removed = deleteMessages(deps.messageRepo, ids);
        console.log(`Deleted ${removed} message(s).`);
        return;
      }

      case "prune": {
        const days = Number(rest[0]);
        if (!Number.isInteger(days)) {
          console.error(USAGE);
          process.exitCode = 1;
          return;
        }
        // Deletes read and unread alike -- age is the only criterion. The schema
        // rejects 0, so this cannot be talked into emptying the table.
        const removed = pruneMessages(deps.messageRepo, days);
        console.log(`Deleted ${removed} message(s) older than ${days} day(s).`);
        return;
      }

      default:
        console.error(USAGE);
        process.exitCode = 1;
    }
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}
