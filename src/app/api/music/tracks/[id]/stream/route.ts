import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import {
  contentRangeHeader,
  getTrackForStreaming,
  openTrackRange,
  trackIdSchema,
  unsatisfiableContentRangeHeader,
} from "@/lib/music";
import { deps } from "@/lib/wiring";

// Streams one track's bytes, honouring HTTP Range.
//
// Range support is not an optimisation here -- it is the difference between a player
// that can seek and one that must download a whole FLAC first, and on iOS Safari the
// difference between playing and not playing at all: it refuses an <audio> source
// whose server does not advertise `Accept-Ranges` and answer 206. The parsing itself
// is pure and unit-tested in src/lib/music/range.ts.
//
// Mirrors the existing binary routes (module carousel image, account icons, avatars)
// for the session check, and adds HEAD because audio elements probe with it.

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return serve(request, context, "GET");
}

/**
 * HEAD is required, not optional.
 *
 * Browsers probe a media URL with HEAD to learn its length and whether ranges are
 * supported before they will seek. Answering 405 here makes a player that appears to
 * work but cannot scrub.
 */
export async function HEAD(request: Request, context: { params: Promise<{ id: string }> }) {
  return serve(request, context, "HEAD");
}

async function serve(
  request: Request,
  context: { params: Promise<{ id: string }> },
  method: "GET" | "HEAD",
): Promise<Response> {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const parsedId = trackIdSchema.safeParse((await context.params).id);
  if (!parsedId.success) return new NextResponse(null, { status: 400 });

  const resolved = await getTrackForStreaming(
    { musicRepo: deps.musicRepo, fileStore: deps.musicFileStore },
    parsedId.data,
    request.headers.get("range"),
  );

  // Covers both "no such row" and "the row is stale and the file is gone" -- either
  // way there is nothing to play, and a listener does not need to know which.
  if (resolved === undefined) return new NextResponse(null, { status: 404 });

  const { track, fileSize, range } = resolved;

  // A format no browser can decode is refused rather than streamed as bytes that
  // would fail silently in the <audio> element. 415 says why.
  if (!track.isStreamable) {
    return NextResponse.json(
      {
        error: `${track.extension.toUpperCase()} cannot be played in a browser.`,
        extension: track.extension,
      },
      { status: 415 },
    );
  }

  const baseHeaders: Record<string, string> = {
    "Content-Type": track.mimeType,
    // Without this a browser will not attempt to seek at all.
    "Accept-Ranges": "bytes",
    // Private: these bytes sit behind a session. Long max-age because a track's
    // content never changes -- a re-scan that replaces the file gives it a new
    // mtime, and the player can add a cache-buster if that ever matters.
    "Cache-Control": "private, max-age=3600",
  };

  if (range.kind === "unsatisfiable") {
    // Must be 416 with the real size, not a 200. A player that has seeked past the
    // end of a replaced, shorter file otherwise retries the same bad offset forever.
    return new NextResponse(null, {
      status: 416,
      headers: { ...baseHeaders, "Content-Range": unsatisfiableContentRangeHeader(fileSize) },
    });
  }

  if (range.kind === "full") {
    const headers = { ...baseHeaders, "Content-Length": String(fileSize) };
    if (method === "HEAD") return new NextResponse(null, { status: 200, headers });
    const stream = await openTrackRange(deps.musicFileStore, track, {
      start: 0,
      end: Math.max(0, fileSize - 1),
      length: fileSize,
    });
    return new NextResponse(stream, { status: 200, headers });
  }

  const headers = {
    ...baseHeaders,
    "Content-Length": String(range.range.length),
    "Content-Range": contentRangeHeader(range.range, fileSize),
  };
  if (method === "HEAD") return new NextResponse(null, { status: 206, headers });

  const stream = await openTrackRange(deps.musicFileStore, track, range.range);
  return new NextResponse(stream, { status: 206, headers });
}
