// Turns stored history rows into what the history dialog shows.
//
// Pure -- takes data, returns data. The two things a reader actually wants from a
// run log are "how long did it take" and "did it finish at all", and neither is
// stored: the first is derived from the two timestamps, and the second is the
// ABSENCE of them. Computing both here keeps the view free of date arithmetic.

import type {
  ScheduledRunHistoryEntry,
  ScheduledRunHistoryView,
  ScheduledRunStatus,
} from "./types";

/**
 * A stored stamp as epoch millis.
 *
 * The columns hold a SQLite-style UTC timestamp (`YYYY-MM-DD HH:MM:SS`), which
 * `Date.parse` treats as *local* in some engines and UTC in others. The `T` and the
 * trailing `Z` make it unambiguous -- without them a duration computed from two
 * stamps would still be right (both drift equally), but a stamp rendered against
 * any other clock would be hours out.
 */
export function parseStampMs(stamp: string): number | undefined {
  const trimmed = stamp.trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed.replace(" ", "T")}Z`
    : trimmed;
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * How long a pass took, or `undefined` when that cannot be known.
 *
 * Undefined covers three cases that all mean the same thing to a reader -- no
 * finish time, an unparseable stamp, or a finish before the start (a clock change
 * mid-pass). A negative duration is suppressed rather than displayed: "-3s" reads
 * as a bug in the screen, which is not what happened.
 */
export function durationMsOf(entry: ScheduledRunHistoryEntry): number | undefined {
  if (!entry.finishedAt) return undefined;
  const started = parseStampMs(entry.startedAt);
  const finished = parseStampMs(entry.finishedAt);
  if (started === undefined || finished === undefined) return undefined;
  const elapsed = finished - started;
  return elapsed >= 0 ? elapsed : undefined;
}

/**
 * A duration as a short human string: `820ms`, `4.2s`, `1m 05s`, `2h 03m`.
 *
 * Sub-second passes are the common case for the two prunes, and rounding those to
 * "0s" would make every prune look identical. The web and the CLI share this.
 */
export function describeDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs}ms`;

  const totalSeconds = durationMs / 1_000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** The outcome shown for one pass. An absent status is never reported as success. */
export function resolveHistoryStatus(
  status: ScheduledRunStatus | undefined,
): ScheduledRunHistoryView["status"] {
  return status ?? "interrupted";
}

/**
 * Every stored pass as the dialog renders it, newest first.
 *
 * The repository already returns newest-first (the index is `job_key, id DESC`), so
 * this does not re-sort: doing so would quietly paper over a repository that had
 * stopped ordering, and the ordering is the one thing a run log must get right.
 */
export function toHistoryViews(entries: ScheduledRunHistoryEntry[]): ScheduledRunHistoryView[] {
  return entries.map((entry) => ({
    id: entry.id,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    durationMs: durationMsOf(entry),
    status: resolveHistoryStatus(entry.status),
    detail: entry.detail,
  }));
}

/** How one pass reads on a single line. The CLI uses this; the web renders a table. */
export function describeHistoryEntry(view: ScheduledRunHistoryView): string {
  const duration = view.durationMs === undefined ? "" : ` in ${describeDuration(view.durationMs)}`;
  const detail = view.detail ? ` — ${view.detail}` : "";
  const outcome =
    view.status === "interrupted" ? "did not finish" : `${view.status}${duration}`;
  return `${view.startedAt} UTC — ${outcome}${detail}`;
}
