import type { Track } from "./types";

// What to search for, and whether to search again. Pure decisions, kept out of the
// client adapter so both are testable without a network call -- and so the same
// rules apply whether the fetch is triggered from the player or the CLI.

export type LyricsStatus = "found" | "instrumental" | "not_found" | "failed";

export interface TrackLyrics {
  trackId: number;
  status: LyricsStatus;
  /** Plain text. `''` unless status is `found`. */
  lyrics: string;
  /** `'lrclib'` today; `'manual'` if hand-entered lyrics are ever added. */
  source: string;
  searchArtist: string;
  searchTitle: string;
  fetchedAt: string;
}

/** What the client will ask LRCLIB for. */
export interface LyricsQuery {
  artist: string;
  title: string;
  /** Sent only to disambiguate -- see `shouldSendDuration`. */
  durationSeconds?: number;
  album?: string;
}

/**
 * Strips the decoration filenames and tags collect, so a search has a chance.
 *
 * This library is full of titles like `APT (ROSE & Bruno Mars).mp3` and
 * `Brandi Carlile - Before It Breaks (Live At Benaroya Hall).mp3`, and LRCLIB matches
 * on the actual song name. Removing a trailing parenthetical is what turns most of
 * those into a hit.
 *
 * Deliberately conservative: only a trailing bracketed group is dropped, and only
 * when something is left over. `Amani (Live)` becomes `Amani`, but a title that is
 * nothing but a bracket is left alone rather than reduced to an empty string.
 */
export function cleanSearchTerm(raw: string): string {
  let value = raw.trim();

  // A leading track number: "01 Amani", "01. Amani", "01 - Amani".
  value = value.replace(/^\d{1,3}\s*[-.)]?\s+/, "");

  // Repeatedly drop a trailing (...) or [...] group.
  for (;;) {
    const stripped = value.replace(/\s*[([][^()[\]]*[)\]]\s*$/, "").trim();
    if (stripped === "" || stripped === value) break;
    value = stripped;
  }

  return value.trim();
}

/**
 * The artist and title to search with, falling back through the tags to the
 * filename.
 *
 * An untagged file is common in this library, so the filename is a real source and
 * not just a safety net. `Artist - Title.mp3` is the one filename convention worth
 * parsing, because it is the one that actually appears here.
 */
export function deriveLyricsQuery(track: Track): LyricsQuery | undefined {
  const taggedArtist = cleanSearchTerm(track.artist);
  const taggedTitle = cleanSearchTerm(track.title);

  if (taggedArtist !== "" && taggedTitle !== "") {
    return {
      artist: taggedArtist,
      title: taggedTitle,
      durationSeconds: track.durationSeconds,
      album: track.album === "" ? undefined : track.album,
    };
  }

  // Fall back to the filename, minus its extension.
  const base = track.fileName.replace(/\.[^.]+$/, "");
  const dashSplit = base.split(/\s+-\s+/);

  if (dashSplit.length >= 2) {
    const artist = cleanSearchTerm(taggedArtist !== "" ? taggedArtist : dashSplit[0]);
    const title = cleanSearchTerm(dashSplit.slice(1).join(" - "));
    if (artist !== "" && title !== "") {
      return { artist, title, durationSeconds: track.durationSeconds };
    }
  }

  // A title with no artist is still worth searching -- LRCLIB's search endpoint
  // takes a free-text query. An artist with no title is not.
  const title = taggedTitle !== "" ? taggedTitle : cleanSearchTerm(base);
  if (title === "") return undefined;

  return { artist: taggedArtist, title, durationSeconds: track.durationSeconds };
}

/**
 * Whether an already-cached result should be fetched again.
 *
 * `found` and `instrumental` are final answers. `instrumental` especially: LRCLIB
 * saying "this track has no words" is information, and retrying it would mean
 * re-requesting the same track forever.
 *
 * `not_found` and `failed` are retryable -- the first because LRCLIB's database is
 * community-contributed and grows, the second because it usually means the NAS was
 * offline. Neither retries automatically; the listener presses the button again.
 */
export function shouldRefetchLyrics(cached: TrackLyrics | undefined): boolean {
  if (cached === undefined) return true;
  return cached.status === "not_found" || cached.status === "failed";
}

/**
 * Whether to send our duration to LRCLIB.
 *
 * The API matches duration strictly -- a 290-second track asked for with
 * `duration=5` comes back 404 rather than loosely matched. Sending a duration we are
 * unsure of therefore converts a would-be hit into a miss, so it is only sent when
 * the tag reader gave us something plausible.
 */
export function shouldSendDuration(durationSeconds: number | undefined): boolean {
  return durationSeconds !== undefined && durationSeconds > 0 && Number.isFinite(durationSeconds);
}

/**
 * Whether a candidate from LRCLIB's search endpoint is close enough in length to be
 * the same recording.
 *
 * Used only for the fallback path, where the exact lookup missed and several
 * candidates come back. Two seconds is the tolerance a differently-mastered copy of
 * the same song usually falls inside.
 */
export function isDurationMatch(
  ours: number | undefined,
  theirs: number | undefined,
  toleranceSeconds = 2,
): boolean {
  if (ours === undefined || theirs === undefined) return true;
  return Math.abs(ours - theirs) <= toleranceSeconds;
}
