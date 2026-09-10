import { parseDurationBadge } from "./youtube";
import type { VideoCandidate } from "./types";

// Pulling search results out of a YouTube results page.
//
// YouTube renders nothing useful into its HTML -- the page is a shell that a script
// fills in. Everything we want is in a single JSON blob assigned to `ytInitialData`
// in an inline <script>, so this file finds that blob, parses it, and walks down to
// the list of video renderers.
//
// That path is undocumented and Google can reshape it without notice. Every step
// below is therefore optional-chained and every field defaulted: a shape change makes
// this return an empty list (which the caller reports as `not_found`), never throw.
// The same bet the Yahoo Finance and Songfacts clients already make.

/** The assignment that carries the search results. */
// `[\s\S]` rather than `.` with the `s` flag: this project targets ES2017, which
// predates dotAll.
const YT_INITIAL_DATA = /(?:var\s+)?ytInitialData\s*=\s*(\{[\s\S]+?\})\s*;\s*<\/script>/;

/**
 * The `ytInitialData` object from a results page, or undefined when it is not there.
 *
 * Exported for the parser test, which asserts a missing blob is handled rather than
 * assumed away.
 */
export function extractInitialData(html: string): unknown {
  const match = html.match(YT_INITIAL_DATA);
  if (match === null) return undefined;

  try {
    return JSON.parse(match[1]);
  } catch {
    // A truncated response, or a blob whose closing brace our lazy regex found early.
    return undefined;
  }
}

/**
 * Every `videoRenderer` in the results, in YouTube's own relevance order.
 *
 * Order matters and is preserved: `rankCandidates` uses it to break ties between
 * candidates it scores equally, on the grounds that YouTube judges relevance better
 * than our keyword rules do.
 */
export function parseSearchResults(html: string): VideoCandidate[] {
  const data = extractInitialData(html);
  if (data === undefined) return [];

  const candidates: VideoCandidate[] = [];
  for (const renderer of collectVideoRenderers(data)) {
    const candidate = toCandidate(renderer);
    // Deduplicated: YouTube repeats a video across shelves ("People also watched"),
    // and a duplicate would waste a ranking slot on a video already considered.
    if (candidate !== undefined && !candidates.some((seen) => seen.videoId === candidate.videoId)) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

/**
 * Walks the payload for `videoRenderer` objects.
 *
 * A recursive walk rather than the documented-looking path
 * (`contents.twoColumnSearchResultsRenderer.primaryContents...`) on purpose: that path
 * is long, undocumented, and YouTube moves results between `itemSectionRenderer` and
 * various shelf renderers depending on the query. Searching for the leaf we actually
 * want survives all of that, and the leaf's own shape is the stable part.
 */
function collectVideoRenderers(node: unknown, depth = 0): Record<string, unknown>[] {
  // The payload is deep but not unbounded; a limit keeps a cyclic or pathological
  // object from turning a parse into a hang.
  if (depth > 30 || node === null || typeof node !== "object") return [];

  if (Array.isArray(node)) {
    return node.flatMap((item) => collectVideoRenderers(item, depth + 1));
  }

  const record = node as Record<string, unknown>;
  const found: Record<string, unknown>[] = [];

  for (const [key, value] of Object.entries(record)) {
    if (key === "videoRenderer" && value !== null && typeof value === "object") {
      found.push(value as Record<string, unknown>);
      // No recursion into a renderer we have taken: it holds no nested results.
      continue;
    }
    found.push(...collectVideoRenderers(value, depth + 1));
  }

  return found;
}

/** One renderer to a candidate, or undefined when it carries no usable id. */
function toCandidate(renderer: Record<string, unknown>): VideoCandidate | undefined {
  const videoId = typeof renderer.videoId === "string" ? renderer.videoId : "";
  if (videoId === "") return undefined;

  const title = readRuns(renderer.title);
  if (title === "") return undefined;

  return {
    videoId,
    title,
    // `ownerText` is the channel on a normal result; `longBylineText` carries it on
    // the shelf variants, so it is the fallback rather than a second choice.
    channel: readRuns(renderer.ownerText) || readRuns(renderer.longBylineText),
    durationSeconds: parseDurationBadge(readSimpleText(renderer.lengthText)),
    // Deliberately not set. The search payload does not carry embeddability -- it
    // only appears on the watch page -- and spending one extra request per candidate
    // to learn it is not worth it. `undefined` means "assume yes"; the panel offers a
    // "Watch on YouTube" link for the rare video that refuses to embed.
    playableInEmbed: undefined,
  };
}

/** The text of a `{ runs: [{ text }] }` node, joined. '' when absent. */
function readRuns(node: unknown): string {
  if (node === null || typeof node !== "object") return "";

  const runs = (node as { runs?: unknown }).runs;
  if (Array.isArray(runs)) {
    return runs
      .map((run) => (run !== null && typeof run === "object" ? String((run as { text?: unknown }).text ?? "") : ""))
      .join("")
      .trim();
  }

  // Some nodes carry a bare simpleText where a sibling carries runs.
  return readSimpleText(node) ?? "";
}

/** The text of a `{ simpleText }` node, or undefined when absent. */
function readSimpleText(node: unknown): string | undefined {
  if (node === null || typeof node !== "object") return undefined;

  const simpleText = (node as { simpleText?: unknown }).simpleText;
  return typeof simpleText === "string" ? simpleText : undefined;
}
