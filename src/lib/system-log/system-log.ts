// Reading and clearing the system log — the use-cases the admin screen and the CLI
// sit on. Writing is not here: that is `logger.ts`, because a caller that writes a
// line must not also be able to read or clear the log.
//
// Takes data and ports, returns data. Every function below runs identically from the
// web action and from the CLI.

import { clearSystemLogSchema, systemLogFilterSchema } from "./schema";
import type { ClearSystemLogInput, SystemLogFilterInput } from "./schema";
import type { SystemLogRepository } from "./ports";
import type { SystemLogCounts, SystemLogEntry, SystemLogKind } from "./types";

/**
 * The newest lines, filtered.
 *
 * The filter is parsed here rather than trusted, because both adapters hand it raw
 * input — a query string on the web, argv on the CLI — and the limit in particular
 * is what stops a hand-typed `--limit 999999` pulling the table into memory.
 */
export function listSystemLog(
  repo: SystemLogRepository,
  input: SystemLogFilterInput = {},
): SystemLogEntry[] {
  const filter = systemLogFilterSchema.parse(input);
  return repo.list(filter);
}

/** How many lines of each kind the log holds. */
export function countSystemLog(repo: SystemLogRepository): SystemLogCounts {
  return repo.counts();
}

/**
 * Deletes one kind, or the whole log.
 *
 * Returns how many lines went, so the screen can say "Cleared 1,284 lines" rather
 * than leaving the reader to compare two numbers. Nothing is protected: unlike the
 * message queue there is no lock here, because a log line is not a record anybody
 * curates — if it mattered after the fact it belonged in the message queue.
 */
export function clearSystemLog(
  repo: SystemLogRepository,
  input: ClearSystemLogInput = {},
): number {
  const { kind } = clearSystemLogSchema.parse(input);
  return repo.clear(kind);
}

/**
 * One line summarising what the log holds — shared by the CLI and the screen header.
 *
 * In the library rather than the view because the CLI prints the same sentence, and
 * a formatter in a `.tsx` would leave the CLI assembling its own.
 */
export function describeSystemLogCounts(counts: SystemLogCounts): string {
  if (counts.total === 0) return "The system log is empty.";

  const parts: string[] = [];
  if (counts.operational > 0) parts.push(`${counts.operational.toLocaleString()} operational`);
  if (counts.debug > 0) parts.push(`${counts.debug.toLocaleString()} debug`);
  return `${counts.total.toLocaleString()} lines — ${parts.join(", ")}.`;
}

/** "OPERATIONAL" / "DEBUG" — how a kind is labelled on screen and in the CLI. */
export function describeSystemLogKind(kind: SystemLogKind): string {
  return kind === "debug" ? "DEBUG" : "OPERATIONAL";
}
