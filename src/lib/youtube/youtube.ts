import type { VideoCandidate, VideoQuery } from "./types";

// Choosing which YouTube result is *the* video. Pure decisions, kept out of the client
// adapter so they are testable without a network call.
//
// The constraint that shapes this file, and the way it differs from the Songfacts
// path: YouTube always returns something. A wrong Songfacts slug 404s and the miss is
// obvious; a wrong YouTube search returns twenty confident results, one of which is a
// ten-hour loop and another a karaoke backing track. So the interesting work is not
// *finding* a result, it is refusing the bad ones -- which is why this file is mostly
// penalties and a score floor rather than a search-term builder.

/** The term to type into YouTube: just the two halves, which is what a person types. */
export function buildSearchTerm(query: VideoQuery): string {
  return [query.artist, query.title]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(" ");
}

/** Where a human should be sent when we will not pick for them. */
export function youtubeSearchUrl(query: VideoQuery): string {
  const term = buildSearchTerm(query);
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(term)}`;
}

/** The page a "Watch on YouTube" link opens. */
export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/**
 * The iframe src for in-app playback.
 *
 * `youtube-nocookie.com` rather than `youtube.com`: it sets no third-party tracking
 * cookie until the viewer actually plays, which is the right default for a
 * self-hosted personal app. Same player, same embed API.
 */
export function embedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0`;
}

/**
 * Words that mean "this is not the recording you asked for".
 *
 * Each one is a real category of result that outranks the actual song on some
 * queries. `hour` and `loop` catch the ten-hour uploads that duration alone misses
 * when the caller has no tagged length to compare against.
 */
const OFF_TARGET = /\b(cover|covered|karaoke|instrumental|backing\s*track|reaction|review|remix|mashup|sped\s*up|slowed|nightcore|8d|tutorial|lesson|how\s+to\s+play|loop(ed)?|\d+\s*hours?)\b/i;

/** Words that mean "this is the song, but not the canonical upload". */
const SECOND_BEST = /\b(live|concert|acoustic|demo|rehearsal|remaster(ed)?|lyrics?|lyric\s*video)\b/i;

/** Channel suffixes YouTube's music partners use. A strong signal of the real upload. */
const OFFICIAL_CHANNEL = /(vevo|-?\s*topic)$/i;

/** How far a candidate's length may drift from the known recording before it is out. */
const DURATION_TOLERANCE = 0.2;

/**
 * The minimum score worth showing.
 *
 * Set above zero deliberately: a candidate that earns nothing positive and nothing
 * negative is a video we have no reason to believe in, and `not_found` plus a search
 * link is more honest than a shrug. Better to send the listener to YouTube than to
 * embed a stranger's karaoke track under their song's name.
 */
const SCORE_FLOOR = 1;

/** True when a candidate's length is close enough to the recording we have. */
export function isDurationPlausible(
  candidateSeconds: number | undefined,
  expectedSeconds: number | undefined,
): boolean {
  // Either side unknown -- no opinion. A live stream has no length, and an untagged
  // file has none either; neither is grounds for rejection on its own.
  if (candidateSeconds === undefined || expectedSeconds === undefined) return true;
  if (candidateSeconds <= 0 || expectedSeconds <= 0) return true;

  const drift = Math.abs(candidateSeconds - expectedSeconds) / expectedSeconds;
  return drift <= DURATION_TOLERANCE;
}

/**
 * Whether a candidate is *about* the song at all.
 *
 * A gate rather than a score component, and the difference matters: duration and
 * channel are **corroborating** evidence, not identifying evidence. A search for a
 * song that does not exist still returns twenty videos, and one of them will be
 * roughly three minutes long -- which is exactly how a random upload called
 * "Boy Band Dreams" scored a passing 2 on duration alone before this gate existed.
 *
 * So the title has to name the song before anything else is allowed to vouch for it.
 * The test is loose (every significant word of the title appears somewhere in the
 * candidate's) because YouTube titles are noisy -- "Billy Joel - Honesty (Official
 * Video) [HD Remaster]" must pass -- but it cannot be skipped.
 */
export function titleNamesSong(candidate: VideoCandidate, query: VideoQuery): boolean {
  const haystack = normalizeForMatch(candidate.title);
  const songTitle = normalizeForMatch(query.title);
  if (songTitle === "") return false;

  // Normalizing collapses punctuation to single spaces, so padding both sides lets a
  // substring test respect word boundaries: " go " does not occur in " going under ".
  // Without this a two-letter title matches almost anything.
  const padded = ` ${haystack} `;

  // The whole title as a phrase is the common case and the strongest form.
  if (padded.includes(` ${songTitle} `)) return true;

  // Otherwise every word of four or more characters has to appear. Short words ("in",
  // "the", "a") are dropped -- they match everything -- but a title made *entirely* of
  // short words has already had its one fair test as a phrase above, so it fails here
  // rather than passing on an empty list.
  const words = songTitle.split(" ").filter((word) => word.length >= 4);
  if (words.length === 0) return false;

  return words.every((word) => padded.includes(` ${word} `) || haystack.includes(word));
}

/** Lowercased, accent-folded, punctuation-flattened -- for substring comparison only. */
function normalizeForMatch(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * How much we believe this candidate is the song, higher is better.
 *
 * Returns a hard -1 for anything that fails `titleNamesSong`, so no amount of
 * corroboration can rescue a video that is not about this song in the first place.
 *
 * Past that gate, the weights are ordered by how reliable the signal is in practice:
 *
 *   +3  the channel names the artist, or carries a partner suffix (`billyjoelVEVO`).
 *       By far the strongest signal -- an official upload is almost always the right
 *       answer, and this is what puts it above a lyrics video with more views.
 *   +2  the candidate's length matches the file we are playing.
 *   +1  the title names the song, which everything reaching this line does. It is
 *       what lifts a bare-but-plausible match to the floor.
 *   -4  an off-target keyword. Deliberately large enough to sink a candidate below
 *       the floor on its own: a karaoke upload from a VEVO-ish channel with the right
 *       runtime is still not the song.
 *   -1  a second-best keyword. A live version IS the song, so it is a tie-breaker
 *       against the studio cut rather than a rejection.
 */
export function scoreCandidate(candidate: VideoCandidate, query: VideoQuery): number {
  // The gate. Nothing below can compensate for failing it.
  if (!titleNamesSong(candidate, query)) return -1;

  const title = candidate.title.toLowerCase();
  const channel = candidate.channel.toLowerCase();
  const artist = query.artist.trim().toLowerCase();
  const songTitle = query.title.trim().toLowerCase();

  // +1 for clearing the gate: a plausible title with nothing else going for it sits
  // exactly at the floor.
  let score = 1;

  const channelNamesArtist = artist !== "" && channel.replace(/\s+/g, "").includes(artist.replace(/\s+/g, ""));
  if (channelNamesArtist || OFFICIAL_CHANNEL.test(candidate.channel)) score += 3;

  if (candidate.durationSeconds !== undefined && query.durationSeconds !== undefined) {
    if (isDurationPlausible(candidate.durationSeconds, query.durationSeconds)) score += 2;
    else score -= 4;
  }

  // A keyword in the *query* is the listener asking for it, so it must not be
  // penalised -- someone whose file is "Honesty (Live)" wants the live version.
  const queryText = `${songTitle} ${artist}`;
  if (OFF_TARGET.test(title) && !OFF_TARGET.test(queryText)) score -= 4;
  if (SECOND_BEST.test(title) && !SECOND_BEST.test(queryText)) score -= 1;

  return score;
}

/**
 * The candidates worth showing, best first.
 *
 * Drops anything that cannot be embedded (it would render as a grey box in the
 * iframe) and anything below the score floor, then sorts. Search order is preserved
 * among equal scores, so YouTube's own relevance breaks our ties -- it is a better
 * judge of that than anything this file could compute.
 */
export function rankCandidates(
  candidates: VideoCandidate[],
  query: VideoQuery,
): VideoCandidate[] {
  return candidates
    .filter((candidate) => candidate.videoId !== "")
    .filter((candidate) => candidate.playableInEmbed !== false)
    .map((candidate, index) => ({ candidate, index, score: scoreCandidate(candidate, query) }))
    .filter((entry) => entry.score >= SCORE_FLOOR)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.candidate);
}

/** The best candidate, or undefined when none clears the floor. */
export function pickBestCandidate(
  candidates: VideoCandidate[],
  query: VideoQuery,
): VideoCandidate | undefined {
  return rankCandidates(candidates, query)[0];
}

/**
 * Parses YouTube's `3:47` / `1:02:33` duration badge into seconds.
 *
 * Returns undefined for the badge a live stream carries ("LIVE"), which is not a
 * length and must not be read as one.
 */
export function parseDurationBadge(badge: string | undefined): number | undefined {
  if (badge === undefined) return undefined;

  const parts = badge.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return undefined;
  if (!parts.every((part) => /^\d+$/.test(part.trim()))) return undefined;

  return parts.reduce((total, part) => total * 60 + Number(part.trim()), 0);
}
