// Turning a raw embedded lyric tag into the plain text the player renders.
//
// Pure string work, kept out of metadata-reader.ts so it can be tested without an
// audio file -- the reader adapter's only job is to get the tag value out of the
// file and hand it here.
//
// What arrives here is messier than "the words of a song". Taggers write ID3 USLT
// frames, FLAC `LYRICS`/`UNSYNCEDLYRICS` comments and M4A `©lyr` atoms, and any of
// them may hold an LRC document complete with timestamps and header metadata rather
// than prose. The player shows plain text today, so all of that is normalised away
// here rather than being half-handled in the view.

/** An `[mm:ss]`, `[mm:ss.xx]` or `[mm:ss:xx]` stamp -- LRC's per-line time marker. */
const LRC_TIMESTAMP = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g;

/**
 * An LRC header line: `[ar:Lana Del Rey]`, `[ti:...]`, `[by:...]`, `[offset:+200]`.
 *
 * Matched as a whole line rather than as a bracket group, because a lyric can
 * legitimately contain brackets (`[Chorus]`, `[Verse 2]`) and those are section
 * labels a listener wants to keep. Only `word:value` in brackets alone on its line
 * is metadata.
 */
const LRC_METADATA_LINE = /^\[[a-z]+:[^\]]*\]$/i;

/**
 * Plain lyric text from a raw tag value, or `undefined` when the tag says nothing.
 *
 * Returns `undefined` rather than `''` for an absent lyric so a caller can tell
 * "this file carries no words" from "this file carries an empty string" -- the
 * first falls through to LRCLIB, and collapsing them would make an empty tag look
 * like a successful read of a song with no lyrics.
 */
export function normaliseEmbeddedLyrics(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;

  const lines = raw
    // CRLF and lone CR both appear in tags written on Windows; the view splits on \n.
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !LRC_METADATA_LINE.test(line.trim()))
    .map((line) => line.replace(LRC_TIMESTAMP, "").trim());

  // Leading and trailing blank lines are padding from the tagger, but a blank line
  // *between* verses is the formatting of the lyric and is kept.
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const text = lines.join("\n");
  return text === "" ? undefined : text;
}

/**
 * One entry of a tag reader's lyrics array, in the shape `music-metadata` returns.
 *
 * Declared here rather than imported so nothing under `src/lib/music` outside the
 * adapter depends on the library's types -- this is the narrow part of `ILyricsTag`
 * we actually read, and it keeps this file testable with plain object literals.
 */
export interface EmbeddedLyricsTag {
  /** Un-synchronised words (ID3 `USLT`, FLAC `LYRICS`, M4A `©lyr`). */
  text?: string;
  /** Synchronised words (ID3 `SYLT`), one entry per timed line. */
  syncText?: readonly { text: string }[];
}

/**
 * The first usable lyric among the entries a tag reader hands back.
 *
 * `music-metadata` returns `common.lyrics` as an array: a file can carry several
 * frames, one per language, and some taggers write an empty one alongside the real
 * thing. Taking the first *non-empty* entry rather than `[0]` is what keeps a stray
 * blank frame from reading as "no lyrics here".
 *
 * Both frame kinds are read. A `SYLT` frame has no `text` at all -- its words live
 * one-per-line in `syncText` -- so a file tagged only with synchronised lyrics would
 * otherwise look wordless and get sent to LRCLIB for something it already has. The
 * timestamps are dropped on the way through, since the panel renders plain text.
 */
export function pickEmbeddedLyrics(
  tags: readonly EmbeddedLyricsTag[] | undefined,
): string | undefined {
  if (tags === undefined) return undefined;

  for (const tag of tags) {
    const plain = normaliseEmbeddedLyrics(tag.text);
    if (plain !== undefined) return plain;

    const synced = tag.syncText;
    if (synced !== undefined && synced.length > 0) {
      const joined = normaliseEmbeddedLyrics(synced.map((line) => line.text).join("\n"));
      if (joined !== undefined) return joined;
    }
  }
  return undefined;
}
