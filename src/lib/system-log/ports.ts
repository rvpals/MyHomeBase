import type { WriteSystemLog } from "./schema";
import type { SystemLogCounts, SystemLogEntry, SystemLogFilter, SystemLogKind } from "./types";

/**
 * Storage for the system log. One row per line.
 *
 * `write` takes an already-validated shape and **never throws**: see `logger.ts` for
 * why a logging call that can fail is worse than no logging at all.
 */
export interface SystemLogRepository {
  /**
   * Appends one line, stamping it with the database's clock.
   *
   * Prunes to `maxRows` as part of the same call. The implementation decides how
   * often it actually looks — the contract is only that the table stays bounded,
   * not that every insert pays for a count.
   */
  write(entry: WriteSystemLog, maxRows: number): void;
  /** Newest first. */
  list(filter: SystemLogFilter): SystemLogEntry[];
  /** How many lines of each kind, for the screen's header. */
  counts(): SystemLogCounts;
  /** Deletes one kind, or every line when `kind` is absent. Returns rows removed. */
  clear(kind?: SystemLogKind): number;
}

/**
 * What a caller holds to write a line. **The thing injected into use-cases**, not the
 * repository — a caller should be unable to read or clear the log, only add to it.
 *
 * ## The gate is the whole design
 *
 * Both methods are no-ops when their kind's switch is off, and that check has to be
 * cheap enough to sit inside a loop. Two things make it so:
 *
 *   1. The resolved settings are **cached** by the implementation, so a call is a
 *      timestamp comparison rather than a settings read.
 *   2. `message` may be a **thunk**. `() => \`page ${i}: ${summarise(doc)}\`` is not
 *      called when the switch is off, so the work of building a line costs nothing
 *      on an install that is not debugging.
 *
 * A plain string is accepted too, because most call sites are cheap and
 * `log.operational("jobs", "Backup triggered.")` should not have to be a lambda. Use
 * a thunk wherever building the message costs more than reading two fields.
 *
 * ## It never throws
 *
 * Every method swallows its own errors. A logging call is written inside the code
 * being diagnosed — frequently inside a `catch` — and a logger that can fail turns a
 * small bug into a crash at exactly the moment someone is trying to understand one.
 */
export interface SystemLogger {
  /**
   * Whether a kind is currently being written.
   *
   * Cheap. Call it before doing any work that only exists to build a log line:
   *
   * ```ts
   * if (log.enabled("debug")) {
   *   log.debug("documents/text-index", expensiveSummary());
   * }
   * ```
   *
   * Not required — `debug` re-checks — but it is the only way to skip work that
   * happens *before* the call.
   */
  enabled(kind: SystemLogKind): boolean;
  /** Writes a DEBUG line, if DEBUG is on. */
  debug(source: string, message: string | (() => string), detail?: string | (() => string)): void;
  /** Writes an OPERATIONAL line, if OPERATIONAL is on. */
  operational(
    source: string,
    message: string | (() => string),
    detail?: string | (() => string),
  ): void;
}
