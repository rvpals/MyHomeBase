// HTTP Range request parsing, per RFC 7233.
//
// This is the difference between "the whole song downloads before it plays" and
// "seeking to 2:30 is instant" — and on iOS Safari it is the difference between
// playing and not playing at all: it refuses an <audio> source whose server does
// not answer ranges. Pure arithmetic, so every awkward header form is covered by a
// test rather than by trial and error on a phone.

/** A resolved byte range, inclusive at both ends — the same convention as the header. */
export interface ByteRange {
  start: number;
  /** Inclusive. A 1-byte file at range 0- gives { start: 0, end: 0 }. */
  end: number;
  /** end - start + 1. What Content-Length must be for the 206. */
  length: number;
}

export type RangeParseResult =
  /** No Range header, or one we deliberately ignore — serve the whole file as 200. */
  | { kind: "full" }
  /** A satisfiable range — serve 206 with Content-Range. */
  | { kind: "partial"; range: ByteRange }
  /** Syntactically fine but outside the file — must be answered 416, not 200. */
  | { kind: "unsatisfiable" };

/**
 * Parses a `Range` header against a known file size.
 *
 * Returns `full` rather than failing for anything malformed. RFC 7233 says a
 * recipient MUST ignore a Range header it cannot understand, and for audio that is
 * also the friendlier outcome: a confused client gets the file instead of an error.
 *
 * Handles the three forms browsers actually send:
 *
 *   bytes=0-              from an offset to the end (the common opening request)
 *   bytes=500-999         an explicit window (seeking, and Chrome's probing)
 *   bytes=-500            the final N bytes (used to read trailing metadata)
 *
 * Deliberately unsupported: multi-range (`bytes=0-99,200-299`), which would need a
 * multipart/byteranges response. No audio element asks for one, so it is treated as
 * "cannot understand" and serves the whole file.
 */
export function parseRangeHeader(header: string | null | undefined, fileSize: number): RangeParseResult {
  if (header === null || header === undefined) return { kind: "full" };

  const trimmed = header.trim();
  if (trimmed === "") return { kind: "full" };

  // Only `bytes` is a unit we implement, and only a single range.
  const match = /^bytes=(\d*)-(\d*)$/.exec(trimmed);
  if (!match) return { kind: "full" };

  const [, rawStart, rawEnd] = match;

  // `bytes=-` is neither a start nor a suffix length: nothing to act on.
  if (rawStart === "" && rawEnd === "") return { kind: "full" };

  // A zero-length file has no satisfiable range at all. Answering 206 with a
  // negative length would be worse than the honest 416.
  if (fileSize <= 0) return { kind: "unsatisfiable" };

  if (rawStart === "") {
    // Suffix form: the last `rawEnd` bytes. A suffix of 0 bytes is unsatisfiable
    // (there is no such thing as an empty 206), and one longer than the file is
    // clamped to the whole file rather than rejected.
    const suffixLength = Number(rawEnd);
    if (suffixLength <= 0) return { kind: "unsatisfiable" };
    const start = Math.max(0, fileSize - suffixLength);
    return { kind: "partial", range: toRange(start, fileSize - 1) };
  }

  const start = Number(rawStart);
  // A start at or past the end is the classic 416 case — a client seeking past the
  // end of a file that has been replaced by a shorter one.
  if (start >= fileSize) return { kind: "unsatisfiable" };

  // An absent or over-long end means "to the end of the file".
  const requestedEnd = rawEnd === "" ? fileSize - 1 : Number(rawEnd);
  const end = Math.min(requestedEnd, fileSize - 1);

  // Backwards range (`bytes=500-100`). Invalid, so ignore per the rule above.
  if (end < start) return { kind: "full" };

  return { kind: "partial", range: toRange(start, end) };
}

function toRange(start: number, end: number): ByteRange {
  return { start, end, length: end - start + 1 };
}

/** The `Content-Range` value for a 206 response. */
export function contentRangeHeader(range: ByteRange, fileSize: number): string {
  return `bytes ${range.start}-${range.end}/${fileSize}`;
}

/**
 * The `Content-Range` value for a 416 response.
 *
 * A 416 must state the real size so the client can retry sensibly — omitting it
 * leaves a seeking player stuck retrying the same bad offset.
 */
export function unsatisfiableContentRangeHeader(fileSize: number): string {
  return `bytes */${fileSize}`;
}
