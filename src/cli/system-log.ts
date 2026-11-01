// The system log from the terminal — the same use-cases the admin screen drives.
//
//   npm run cli -- system-log tail
//   npm run cli -- system-log tail 50
//   npm run cli -- system-log tail 50 debug
//   npm run cli -- system-log find "text-index"
//   npm run cli -- system-log status
//   npm run cli -- system-log clear
//   npm run cli -- system-log clear debug
//
// `tail` is the reason this exists: when a background job misbehaves on the NAS,
// reading its lines over SSH is faster than opening the admin screen, and it works
// when the web app is the thing that is broken.
//
// THERE IS NO `write` COMMAND, deliberately. A line is written by the code being
// diagnosed, through `deps.systemLogger`. A hand-typed line would be indistinguishable
// from one the app produced, which would make the log untrustworthy for the one job
// it has. `messages file` exists for the opposite reason: a notice for a reader is
// exactly the thing a shell script should be able to raise.

import {
  SYSTEM_LOG_KINDS,
  clearSystemLog,
  countSystemLog,
  describeSystemLogCounts,
  describeSystemLogState,
  listSystemLog,
  resolveSystemLogSettings,
  type SystemLogEntry,
  type SystemLogKind,
} from "@/lib/system-log";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";

const USAGE = `Usage:
  system-log tail [limit] [debug|operational]
  system-log find <text> [limit]
  system-log status
  system-log clear [debug|operational]`;

/** A kind argument, or `undefined` when the slot was empty. Throws on a bad one. */
function readKind(value: string | undefined): SystemLogKind | undefined {
  if (value === undefined) return undefined;
  if ((SYSTEM_LOG_KINDS as readonly string[]).includes(value)) return value as SystemLogKind;
  throw new Error(`Unknown kind "${value}". Use debug or operational.`);
}

function printEntry(entry: SystemLogEntry): void {
  // Padded so the kind column lines up — a tail is read by scanning down it.
  const kind = entry.kind === "debug" ? "DEBUG" : "OPER ";
  const source = entry.source === "" ? "" : ` ${entry.source}:`;
  console.log(`${entry.createdAt}  ${kind}${source} ${entry.message}`);
  if (entry.detail !== "") {
    for (const line of entry.detail.split("\n")) console.log(`    ${line}`);
  }
}

/**
 * Oldest first, unlike every other reader.
 *
 * `listSystemLog` returns newest-first, which is right for a grid you scroll. A
 * terminal tail is read top to bottom with the newest line nearest the prompt, which
 * is the opposite — the same convention as `tail -f`.
 */
function printTail(entries: SystemLogEntry[]): void {
  for (const entry of [...entries].reverse()) printEntry(entry);
}

export async function systemLogCommand(args: string[]): Promise<void> {
  const [action, ...rest] = args;

  // Wrapped like every other command that can be given bad input: the schemas throw
  // on an out-of-range limit or an unknown kind, and that should print as a message
  // with an exit code rather than a stack trace.
  try {
    switch (action) {
      case undefined:
      case "tail": {
        // Both arguments are optional and either order reads naturally, so the kind
        // is accepted in either slot rather than forcing `tail 200 debug`.
        const numeric = rest.find((value) => /^\d+$/.test(value));
        const kindArg = rest.find((value) => !/^\d+$/.test(value));
        const entries = listSystemLog(deps.systemLogRepo, {
          limit: numeric === undefined ? undefined : Number(numeric),
          kind: readKind(kindArg),
        });

        if (entries.length === 0) {
          console.log("No lines to show.");
          return;
        }
        printTail(entries);
        return;
      }

      case "find": {
        const [search, limit] = rest;
        if (search === undefined || search.trim() === "") {
          console.error(USAGE);
          process.exitCode = 1;
          return;
        }
        const entries = listSystemLog(deps.systemLogRepo, {
          search,
          limit: limit === undefined ? undefined : Number(limit),
        });
        if (entries.length === 0) {
          console.log(`Nothing matching "${search}".`);
          return;
        }
        printTail(entries);
        return;
      }

      case "status": {
        const settings = resolveSystemLogSettings(deps.settingsRepo.listSettings());
        console.log(describeSystemLogState(settings));
        console.log(describeSystemLogCounts(countSystemLog(deps.systemLogRepo)));
        return;
      }

      case "clear": {
        const kind = readKind(rest[0]);
        const removed = clearSystemLog(deps.systemLogRepo, { kind });
        const what = kind === undefined ? "line" : `${kind} line`;
        console.log(`Deleted ${removed} ${what}(s).`);
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
