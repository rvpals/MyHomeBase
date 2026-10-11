// Pure — no I/O, no React. Turning a stored UTC timestamp into the two halves the
// admin screens print: the UTC stamp as written, and the reader's local equivalent.
//
// The companion to `date.ts`. That file is about *calendar days* in the server's
// local zone; this one is about *instants* stored in UTC and shown to a person who
// is probably not in UTC. They stay separate because mixing them is the bug both
// are written to prevent.

/**
 * Parses the timestamp shape SQLite's `datetime('now')` writes —
 * `YYYY-MM-DD HH:MM:SS`, UTC, space-separated — into a `Date`.
 *
 * The space and the missing zone are both load-bearing problems. `new Date("2026-08-16
 * 14:30:00")` is parsed as *local* by V8 and as Invalid Date by Safari: an
 * implementation-defined format, so neither engine is wrong. Rewriting it to
 * `2026-08-16T14:30:00Z` is the only reading that is unambiguously the instant the
 * database meant.
 *
 * Returns `null` rather than an Invalid Date for anything else, so callers have one
 * obvious branch to render the raw text through instead of printing "Invalid Date"
 * where a time should be.
 */
export function parseUtcStamp(stamp: string): Date | null {
  const trimmed = stamp.trim();
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(trimmed)) return null;

  const parsed = new Date(`${trimmed.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * An epoch-ms instant as the same `YYYY-MM-DD HH:MM:SS` UTC shape the database
 * stores, so a computed time (a *next* run, say) prints identically to a recorded one.
 */
export function formatUtcStamp(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * An instant on the reader's own clock, with the zone named: `"3:00 PM EST"`.
 *
 * Seconds are dropped deliberately. This label always sits beside a full UTC stamp
 * that already carries them, and the question it answers — "when was that for *me*?"
 * — is never answered to the second. Repeating them doubles the width of every cell
 * for no information.
 *
 * `timeZoneName: "short"` is what produces `EST`/`EDT` rather than a raw offset, and
 * it resolves daylight saving per-instant: a run from last July reads `EDT` and one
 * from January reads `EST`, which is the honest answer in both cases.
 *
 * `locale` and `timeZone` are injectable so tests don't depend on the machine they run
 * on. Left undefined in the app, where the browser's own settings are exactly right.
 */
export function formatLocalTimeLabel(
  instant: Date,
  locale?: string,
  timeZone?: string,
): string {
  return instant.toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  });
}

/**
 * The local label, plus the date when it differs from the UTC one.
 *
 * A UTC stamp near either end of the day lands on a different calendar date for most
 * readers: `2026-08-16 02:30:00 UTC` is the 15th in New York. Showing a bare
 * `"10:30 PM EDT"` next to a stamp dated the 16th reads as a typo, so the date comes
 * along whenever it has actually shifted — and stays out of the way, which is most of
 * the time, when it hasn't.
 */
export function describeLocalInstant(
  instant: Date,
  locale?: string,
  timeZone?: string,
): string {
  const time = formatLocalTimeLabel(instant, locale, timeZone);

  const utcDay = instant.toISOString().slice(0, 10);
  // Same instant, read on the target clock, reduced to a comparable YYYY-MM-DD.
  const localDay = instant.toLocaleDateString("en-CA", { timeZone });
  if (localDay === utcDay) return time;

  const dayLabel = instant.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    timeZone,
  });
  return `${dayLabel}, ${time}`;
}
