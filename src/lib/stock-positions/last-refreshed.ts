// When the portfolio's numbers last actually moved, and how to say so.
//
// Pure — no I/O. The caller hands over the positions it has already read, so
// this costs nothing extra on a page that was loading them anyway.
//
// Why the positions and not `sys_scheduled_runs`: that table records only the
// *automatic* refresh, so a portfolio last priced by somebody pressing the
// dashboard button would report "never". Every refresh path — manual, scheduled,
// CLI — ends in a position write, and `updated_at` is trigger-maintained
// (migrations/0016, 0035), so the maximum across positions is the one figure
// that reflects all of them.
//
// The known imprecision, stated rather than hidden: the trigger fires on *any*
// position write, so hand-editing a holding also moves this. The line means "when
// these numbers last changed", which is what a reader is asking, and it is better
// to be honestly approximate than to under-report a real refresh.

import type { StockPosition } from "./types";

/**
 * Reads a SQLite `datetime('now')` timestamp — `YYYY-MM-DD HH:MM:SS` in **UTC**,
 * space-separated — as epoch millis.
 *
 * The trailing "Z" is the whole point: `Date.parse` reads a space-separated
 * timestamp as *local* time, which would shift the figure by the server's offset
 * in either direction. The NAS is not on UTC, so that error would always be live.
 * Same treatment as `scheduled-refresh/refresh-runner.ts`.
 *
 * Returns `undefined` for anything unparseable rather than `NaN`, so a corrupt
 * row can't propagate into an "Invalid Date" on screen.
 */
export function parseSqliteTimestampUtc(timestamp: string): number | undefined {
  const parsed = Date.parse(`${timestamp.trim().replace(" ", "T")}Z`);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * The most recent `updatedAt` across `positions`, as the raw stored string, or
 * `undefined` when there are no positions or none carries a readable timestamp.
 *
 * Compared as parsed instants, not as strings: the column is written in one
 * fixed format today, but a string `max` would silently pick the wrong row the
 * first time anything writes a differently-shaped value.
 */
export function lastRefreshedAt(positions: StockPosition[]): string | undefined {
  let newest: string | undefined;
  let newestMs = -Infinity;

  for (const position of positions) {
    const ms = parseSqliteTimestampUtc(position.updatedAt);
    if (ms === undefined || ms <= newestMs) continue;
    newestMs = ms;
    newest = position.updatedAt;
  }

  return newest;
}

/**
 * The stored timestamp as something to show a reader: the **local** calendar date
 * and clock time of a UTC instant, e.g. "Sep 21, 2026 at 3:42 PM".
 *
 * Local, because a reader wants the time on the clock they were looking at, not
 * the one the database writes in. `undefined` in means `undefined` out — the
 * caller renders nothing rather than a placeholder, since "never refreshed" and
 * "refreshed at an unreadable time" are both better said by saying nothing.
 *
 * `locale` is injectable so a test doesn't depend on the runner's own locale.
 */
export function formatLastRefreshed(
  timestamp: string | undefined,
  locale = "en-US",
): string | undefined {
  if (!timestamp) return undefined;
  const ms = parseSqliteTimestampUtc(timestamp);
  if (ms === undefined) return undefined;

  return new Date(ms).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
