import { cleanSearchTerm } from "./lyrics";
import type { Track } from "./types";

// Working out which Songfacts URL to ask for. Pure decisions, kept out of the client
// adapter so they are testable without a network call.
//
// The constraint that shapes this whole file: Songfacts has no API and no sanctioned
// search. Their robots.txt disallows /search for every user agent, so unlike the
// lyrics path -- where LRCLIB offers a free-text search endpoint to fall back on -- a
// wrong guess here cannot be recovered by searching. The URL must be *derived*.
//
// That makes candidate ordering the interesting part: we get a small number of tries
// at guessing a slug, and a miss is final.

/**
 * What a story lookup can come back as.
 *
 * Three outcomes, not four: nothing is cached, so the lyrics table's `not_found` /
 * `failed` split -- which exists purely to decide what may be retried later -- has no
 * job here. Every view re-fetches anyway.
 */
export type StoryStatus = "found" | "not_found" | "failed";

export interface SongStory {
  status: StoryStatus;
  /** The facts, in page order. Empty unless status is `found`. */
  facts: string[];
  /** The page the facts came from, for the attribution link. */
  sourceUrl: string;
  /** What Songfacts says the page is about, so a wrong hit is visible. */
  matchedTitle?: string;
  matchedArtist?: string;
}

/** The artist and title a story lookup will be built from. */
export interface StoryQuery {
  artist: string;
  title: string;
}

const SONGFACTS_BASE = "https://www.songfacts.com/facts";

/** Where a human should be sent when we cannot find the page ourselves. */
export function songfactsSearchUrl(query: StoryQuery): string {
  const term = [query.artist, query.title].filter((part) => part !== "").join(" ");
  return `https://www.songfacts.com/search/songs/${encodeURIComponent(term)}`;
}

/**
 * One path segment of a Songfacts URL.
 *
 * Their slugs are lowercase ASCII words joined by single hyphens. Two details matter
 * and both come from real URLs on the site:
 *
 *   - Accents are folded, not dropped -- `Beyoncé` is `beyonce`, so decomposing to
 *     NFD and removing the combining marks is what gets a hit rather than `beyonc`.
 *   - Apostrophes close up rather than becoming hyphens: `Don't Stop` is
 *     `dont-stop`, never `don-t-stop`.
 */
export function slugifySongfacts(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Removed, not hyphenated -- see above.
    .replace(/['\u2018\u2019]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The Songfacts URL for an already-slugged artist and title. */
export function songfactsUrl(artistSlug: string, titleSlug: string): string {
  return `${SONGFACTS_BASE}/${artistSlug}/${titleSlug}`;
}

/**
 * The artist and title to look a story up with.
 *
 * Reuses `cleanSearchTerm` from the lyrics path, which already strips the track
 * numbers and trailing parentheticals this library's filenames are full of --
 * `01 Amani (Live)` down to `Amani`. Sharing it means a title that finds its lyrics
 * finds its story too.
 *
 * Returns `undefined` when there is no artist: a Songfacts URL needs both halves, and
 * unlike a lyrics search there is no title-only endpoint to fall back on.
 */
export function deriveStoryQuery(track: Track): StoryQuery | undefined {
  const artist = cleanSearchTerm(track.artist);
  const title = cleanSearchTerm(track.title);
  if (artist !== "" && title !== "") return { artist, title };

  // Fall back to an `Artist - Title.mp3` filename, the one convention that actually
  // appears in this library.
  const base = track.fileName.replace(/\.[^.]+$/, "");
  const parts = base.split(/\s+-\s+/);
  if (parts.length >= 2) {
    const fromFile = {
      artist: cleanSearchTerm(artist !== "" ? artist : parts[0]),
      title: cleanSearchTerm(parts.slice(1).join(" - ")),
    };
    if (fromFile.artist !== "" && fromFile.title !== "") return fromFile;
  }

  return undefined;
}

/**
 * The URLs worth trying, best guess first.
 *
 * Each candidate is a real pattern observed on the site, and the list is short on
 * purpose -- every entry is one more request to a free service that asks nothing in
 * return, so this trades a little coverage for not hammering them.
 *
 *   1. The plain slug. The common case: `billy-joel/honesty`.
 *   2. Without a leading `the-` on the artist. Tags disagree with Songfacts about
 *      this constantly, in both directions.
 *   3. With `the-` added, for the same reason in reverse.
 *   4. The title's first half, when it carries a `/` or `:` subtitle that Songfacts
 *      usually omits.
 *
 * Deduplicated, so a query where two rules agree does not spend two requests
 * discovering the same URL twice.
 */
export function songfactsCandidates(query: StoryQuery): string[] {
  const artist = slugifySongfacts(query.artist);
  const title = slugifySongfacts(query.title);
  if (artist === "" || title === "") return [];

  const artistVariants = [artist];
  if (artist.startsWith("the-")) artistVariants.push(artist.slice(4));
  else artistVariants.push(`the-${artist}`);

  const titleVariants = [title];
  const [firstHalf] = query.title.split(/\s*[/:]\s*/);
  const shortened = slugifySongfacts(firstHalf);
  if (shortened !== "" && shortened !== title) titleVariants.push(shortened);

  const urls: string[] = [];
  for (const titleSlug of titleVariants) {
    for (const artistSlug of artistVariants) {
      const url = songfactsUrl(artistSlug, titleSlug);
      if (!urls.includes(url)) urls.push(url);
    }
  }
  return urls;
}
