// Grouping a topic's entries into episodes — the runs of activity that turn a
// flat tag into a story.
//
// The insight this encodes: twelve entries tagged `HSA` spread over three years
// are not one topic, they are three or four separate dealings with the same
// subject. A reader looking at the timeline wants to see "November 2024: four
// entries" rather than twelve dots on an axis.

import type { TopicEntry, TopicEpisode } from "./types";

/**
 * Days between consecutive entries before a new episode starts, when the
 * reader has not set one.
 *
 * Fourteen: long enough that a fortnight of silence reads as "that was a
 * separate occasion", short enough that a once-a-week recurring thing stays in
 * one run. Stored as the `topic_episode_gap_days` journal preference.
 */
export const DEFAULT_EPISODE_GAP_DAYS = 14;

/** The narrowest and widest gaps the preference accepts. */
export const MIN_EPISODE_GAP_DAYS = 1;
export const MAX_EPISODE_GAP_DAYS = 365;

/**
 * Whole days between two "YYYY-MM-DD" dates.
 *
 * Parsed as UTC midnight on purpose: a local-time parse would make the gap
 * between two dates change by an hour across a daylight-saving boundary, and
 * twice a year a 14-day gap would measure 13.96 and round wrong.
 */
export function daysBetween(earlier: string, later: string): number {
  const a = Date.parse(`${earlier}T00:00:00Z`);
  const b = Date.parse(`${later}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Splits a topic's entries into runs separated by more than `gapDays`.
 *
 * Takes entries in any order and sorts them by date ascending first — callers
 * get them sorted by relevance from `matchTopic`, and clustering that order
 * would produce nonsense.
 *
 * A gap of exactly `gapDays` keeps the entries together; it takes *more* than
 * the gap to split. So with the default 14, entries a fortnight apart are one
 * episode and entries 15 days apart are two — "within a fortnight" reading the
 * way a person means it.
 */
export function buildEpisodes(
  entries: readonly TopicEntry[],
  gapDays: number = DEFAULT_EPISODE_GAP_DAYS,
): TopicEpisode[] {
  if (entries.length === 0) return [];

  const sorted = [...entries].sort((a, b) => {
    if (a.entry.date !== b.entry.date) return a.entry.date < b.entry.date ? -1 : 1;
    // Same day: order by time, then id, so the run is stable and reads in the
    // order the entries were written.
    if (a.entry.time !== b.entry.time) return a.entry.time < b.entry.time ? -1 : 1;
    return a.entry.id - b.entry.id;
  });

  const episodes: TopicEpisode[] = [];
  let current: TopicEntry[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1].entry.date;
    const next = sorted[i].entry.date;

    if (daysBetween(previous, next) > gapDays) {
      episodes.push(toEpisode(current));
      current = [sorted[i]];
    } else {
      current.push(sorted[i]);
    }
  }
  episodes.push(toEpisode(current));

  // Most recent episode first: a reader opening a topic almost always wants
  // "what happened lately", and the deep history is a scroll away rather than
  // the other way round.
  return episodes.reverse();
}

function toEpisode(entries: TopicEntry[]): TopicEpisode {
  return {
    startDate: entries[0].entry.date,
    endDate: entries[entries.length - 1].entry.date,
    entries,
  };
}

/**
 * Clamps a stored or user-supplied gap to something usable.
 *
 * A gap of 0 would make every entry its own episode — the timeline with the
 * feature switched off — so 1 is the floor. Anything unparseable falls back to
 * the default rather than erroring, matching how every other journal preference
 * treats a hand-edited row.
 *
 * Blank and whitespace are checked before coercion, because `Number("")` is 0
 * — an integer, and in range once clamped. Without this an absent preference
 * row (the common case, not an edge case) would read as a one-day gap and give
 * every entry its own episode.
 */
export function clampEpisodeGapDays(value: unknown): number {
  if (typeof value === "string" && value.trim() === "") return DEFAULT_EPISODE_GAP_DAYS;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) return DEFAULT_EPISODE_GAP_DAYS;
  if (parsed < MIN_EPISODE_GAP_DAYS) return MIN_EPISODE_GAP_DAYS;
  if (parsed > MAX_EPISODE_GAP_DAYS) return MAX_EPISODE_GAP_DAYS;
  return parsed;
}
