import type { Track } from "@/lib/music";

// Domain types for Magic Playlists. No zod, no SQL -- schema.ts validates boundary
// input, repository.ts talks to SQLite.

/**
 * What the listener picked: which music to draw from, and how much of it.
 *
 * Every list field is OR within itself; an EMPTY list means "no restriction on this
 * field" rather than "match nothing". That distinction is the whole semantics of the
 * form -- picking no genres must not produce an empty playlist -- so it is stated here
 * and enforced in one place (`buildCandidateFilter`), never re-derived by a caller.
 */
export interface MagicCriteria {
  /** Genre names, matched exactly and case-insensitively. '' selects untagged tracks. */
  genres: string[];
  /** Artist names, matched exactly and case-insensitively. '' selects untagged tracks. */
  artists: string[];
  /** Album ids from mus_albums. */
  albumIds: number[];
  /** How long the playlist should run. Approximate by design -- see selectTracksForTarget. */
  targetSeconds: number;
  /**
   * false (the default): OR inside each field, AND across fields --
   * `(genre = Rock OR Pop) AND (artist = MJ OR Vandross)`.
   * true: OR everything together.
   *
   * Part of what a saved list MEANS, not a per-generation toggle -- see migrations/0057.
   */
  matchAny: boolean;
  /** Exclude formats no browser can decode. Defaults ON here -- see migrations/0057. */
  streamableOnly: boolean;
}

/** A saved Magic Playlist: its criteria, and when it last produced a set. */
export interface MagicList {
  id: number;
  name: string;
  description: string;
  criteria: MagicCriteria;
  /** undefined when saved but never generated -- the view shows an empty state, not a list. */
  lastGeneratedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** A saved list as it appears in a picker: no criteria, just enough to choose one. */
export interface MagicListSummary {
  id: number;
  name: string;
  description: string;
  targetSeconds: number;
  /** Tracks currently stored for this list, after dropping any whose file has gone. */
  trackCount: number;
  lastGeneratedAt?: string;
  updatedAt: string;
}

/**
 * Why a generated playlist came out the way it did.
 *
 * Returned alongside the tracks rather than computed in the view, because the honest
 * explanation of a thin result is the feature: AND-across-fields is strict enough that
 * a plausible-looking criteria set can match far less than expected (a genre clause can
 * exclude every track by one of the chosen artists). A candidate count turns that from
 * "the app is broken" into "those two things do not overlap".
 */
export interface MagicGenerationStats {
  /** Tracks that matched the criteria and had a usable duration. */
  candidateCount: number;
  /** Tracks actually selected. */
  selectedCount: number;
  totalSeconds: number;
  targetSeconds: number;
  /** Signed: positive means the playlist overruns the target. */
  deltaSeconds: number;
  /** True when every candidate was used and the total still fell short of the target. */
  exhaustedCandidates: boolean;
}

/** The result of one generation: the tracks, in play order, and why. */
export interface GeneratedPlaylist {
  tracks: Track[];
  stats: MagicGenerationStats;
}

// `RandomSource` moved to @/lib/shared/random alongside `shuffle`; re-exported from this
// module's barrel so callers are unaffected.

/** Common target lengths, offered as one-tap chips before the free-entry field. */
export const MAGIC_TARGET_PRESETS: readonly { label: string; seconds: number }[] = [
  { label: "30 min", seconds: 30 * 60 },
  { label: "50 min", seconds: 50 * 60 },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "90 min", seconds: 90 * 60 },
  { label: "2 hours", seconds: 120 * 60 },
  { label: "3 hours", seconds: 180 * 60 },
];

/** The default target when nothing has been picked yet. */
export const DEFAULT_TARGET_SECONDS = 60 * 60;

/** Criteria with nothing selected: the whole (streamable, duration-tagged) library. */
export function emptyCriteria(): MagicCriteria {
  return {
    genres: [],
    artists: [],
    albumIds: [],
    targetSeconds: DEFAULT_TARGET_SECONDS,
    matchAny: false,
    streamableOnly: true,
  };
}

/**
 * Whether a criteria set restricts anything at all.
 *
 * Used by the view to say "the whole library" rather than listing nothing, and by the
 * generator's stats message. Target length is not a restriction on WHICH tracks are
 * eligible, so it is deliberately not part of this answer.
 */
export function hasAnyFilter(criteria: MagicCriteria): boolean {
  return (
    criteria.genres.length > 0 || criteria.artists.length > 0 || criteria.albumIds.length > 0
  );
}

/**
 * "1 h 05 m" for a number of seconds -- the running time of a playlist.
 *
 * Domain logic rather than a view helper so the web app and the CLI print the same
 * duration, exactly as `scanProgressPercent` is shared. Distinct from
 * `formatPlayerTime`'s mm:ss, which is for a position inside one track: an hour-long
 * playlist shown as "65:00" is worse than useless.
 */
export function formatRunningTime(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${String(minutes).padStart(2, "0")} m`;
}
