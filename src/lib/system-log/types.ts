// Domain models for the system log: one row per logged line in `sys_system_log`
// (migrations/0167), plus the two switches that decide whether a line is written at
// all (migrations/0168).
//
// This is the third of the app's three after-the-fact channels, and the distinction
// is worth keeping straight:
//
//   `sys_messages`              a notice FOR A READER. Lights the header's unread
//                               badge, waits to be dismissed. See lib/messages.
//   `sys_scheduled_run_history` one row PER PASS of a background job.
//                               See lib/scheduled-jobs.
//   `sys_system_log`            what the code was DOING, in its own words. Here.
//
// A line here never reaches the bell and never counts as a run. If something needs a
// reader to act on it, it belongs in the message queue instead.

/**
 * Which switch a line is written under.
 *
 * Two independent kinds, not two levels of one scale. `debug` does not imply
 * `operational` and neither outranks the other — they answer different questions and
 * are switched on at different times. See migrations/0167 for why a severity ladder
 * was rejected.
 */
export type SystemLogKind = "debug" | "operational";

/** Both kinds, in the order the screen's filter lists them. */
export const SYSTEM_LOG_KINDS: readonly SystemLogKind[] = ["operational", "debug"];

/** One line in the log, as read back. */
export interface SystemLogEntry {
  id: number;
  /**
   * When it was written, as a SQLite-style UTC timestamp.
   *
   * **Always present.** The database stamps it (`DEFAULT (datetime('now'))`) and no
   * caller may supply one, so unlike `sys_messages.readAt` there is no "not yet"
   * state to encode. A log line without a time is not a log line.
   */
  createdAt: string;
  kind: SystemLogKind;
  /**
   * Where the line came from, e.g. `"documents/text-index"` or `"scheduled-jobs"`.
   *
   * Free text and may be blank. Deliberately unlike `SystemMessage.module`, which is
   * a fixed enum: this names a place in the code, and requiring a schema edit before
   * a file may log would stop lines being planted when they are needed.
   */
  source: string;
  /** The line itself, already rendered. */
  message: string;
  /** A stack, a JSON blob, a long value. Blank — never null — when there is none. */
  detail: string;
}

/**
 * The two switches plus the row cap, resolved from `sys_app_settings`.
 *
 * Every field degrades to a safe default rather than throwing: this is read inside a
 * background tick where a throw is invisible, so a hand-edited row has to fall back
 * rather than kill the caller. Same forgiving shape, and the same reason, as
 * `resolveTextIndexJobSettings`.
 */
export interface SystemLogSettings {
  debugEnabled: boolean;
  operationalEnabled: boolean;
  /** How many lines to keep. Always positive after resolution. */
  maxRows: number;
}

/** What the screen asks for: a half of the log, or all of it. */
export interface SystemLogFilter {
  /** Absent means both kinds. */
  kind?: SystemLogKind;
  /** Case-insensitive substring over `source` and `message`. Blank means no filter. */
  search?: string;
  limit: number;
}

/** How many lines of each kind the log currently holds, for the screen's header. */
export interface SystemLogCounts {
  debug: number;
  operational: number;
  total: number;
}
