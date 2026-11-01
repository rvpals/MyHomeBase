// The thing callers actually hold: `log.debug(...)` and `log.operational(...)`.
//
// Pure in the sense that matters — it takes its settings source and its clock as
// arguments, so every behaviour below is testable without a database or a wait. The
// composition root supplies the real ones in `wiring.ts`.
//
// ## Three rules this file exists to enforce
//
//   1. A LINE COSTS NOTHING WHEN ITS SWITCH IS OFF. The settings are cached, so a
//      call is a timestamp comparison rather than a settings read, and `message` may
//      be a thunk that is never invoked. Both matter: this is called inside loops
//      that run once per document.
//
//   2. A LOGGING CALL NEVER THROWS. It is written inside the code being diagnosed,
//      often inside a `catch`. A logger that can fail turns a small bug into a crash
//      at the exact moment someone is trying to understand one.
//
//   3. THE SWITCH TAKES EFFECT WITHOUT A RESTART. The cache has a short TTL, so
//      ticking the box on Application Configuration changes what is written within
//      seconds rather than at the next deploy.

import { writeSystemLogSchema } from "./schema";
import { isKindEnabled, resolveSystemLogSettings } from "./settings";
import type { SystemLogRepository, SystemLogger } from "./ports";
import type { SystemLogKind, SystemLogSettings } from "./types";

/**
 * How long resolved settings are reused.
 *
 * Five seconds is the trade between the two things that matter: a tight loop must
 * not read `sys_app_settings` per line, and an admin who just ticked the box should
 * not wonder whether it worked. Anything longer makes the switch feel broken;
 * anything shorter stops being a cache on a job that logs a line per file.
 */
export const SETTINGS_CACHE_MS = 5000;

export interface SystemLoggerDeps {
  repo: SystemLogRepository;
  /**
   * Reads the three rows from `sys_app_settings`.
   *
   * A function rather than the rows themselves because a logger outlives any one
   * read: it is built once at startup and must see a switch ticked an hour later.
   */
  readSettings: () => { key: string; value: string }[];
}

/** Resolves a value that may be a thunk. The thunk is called only when we got here. */
function resolve(value: string | (() => string) | undefined): string {
  if (value === undefined) return "";
  return typeof value === "function" ? value() : value;
}

/**
 * Builds the logger the app injects everywhere.
 *
 * `now` is a parameter so the cache's expiry is testable without waiting five
 * seconds — the same shape as `isTextIndexPassDue` and every other clock in `lib/`.
 */
export function createSystemLogger(
  deps: SystemLoggerDeps,
  now: () => number = Date.now,
): SystemLogger {
  let cached: SystemLogSettings | undefined;
  let cachedAtMs = 0;

  function settings(): SystemLogSettings {
    const nowMs = now();
    if (cached !== undefined && nowMs - cachedAtMs < SETTINGS_CACHE_MS) return cached;

    try {
      cached = resolveSystemLogSettings(deps.readSettings());
    } catch {
      // The settings table is unreachable. Fall back to "everything off" rather than
      // to the last known value: an unreadable database is not a reason to start
      // writing to it, and the next call will try again in five seconds.
      cached = { debugEnabled: false, operationalEnabled: false, maxRows: 0 };
    }
    cachedAtMs = nowMs;
    return cached;
  }

  function enabled(kind: SystemLogKind): boolean {
    try {
      return isKindEnabled(settings(), kind);
    } catch {
      return false;
    }
  }

  function write(
    kind: SystemLogKind,
    source: string,
    message: string | (() => string),
    detail?: string | (() => string),
  ): void {
    try {
      const current = settings();
      // Re-checked here as well as in `enabled`, so a caller who skipped the guard
      // still pays nothing but this comparison. The guard exists to skip work done
      // BEFORE the call; this is what makes the call itself safe to leave in place.
      if (!isKindEnabled(current, kind)) return;

      // Resolved only now: a thunk passed by a hot loop has not run until this line.
      const parsed = writeSystemLogSchema.parse({
        kind,
        source,
        message: resolve(message),
        detail: resolve(detail),
      });
      deps.repo.write(parsed, current.maxRows);
    } catch {
      // Rule 2. A blank message fails the schema, the table may be missing on an
      // install that has not migrated, a thunk may throw — none of which is worth
      // taking down the caller for. The line is lost; the work continues.
    }
  }

  return {
    enabled,
    debug: (source, message, detail) => write("debug", source, message, detail),
    operational: (source, message, detail) => write("operational", source, message, detail),
  };
}

/**
 * A logger that writes nothing.
 *
 * For tests and for any composition that has no database — notably the CLI's
 * read-only commands. Distinct from `FakeSystemLogger` in `fakes.ts`, which records
 * what it was given so a test can assert on it; this one genuinely discards.
 */
export const noopSystemLogger: SystemLogger = {
  enabled: () => false,
  debug: () => {},
  operational: () => {},
};
