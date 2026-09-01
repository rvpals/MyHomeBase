import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import {
  MAX_DOWNLOAD_BYTES,
  MAX_DOWNLOAD_PHOTOS,
  favPhotoArchiveName,
  planFavPhotoDownload,
} from "@/lib/fav-photos";
import { buildZip, type ZipEntry } from "@/lib/zip";
import { deps } from "@/lib/wiring";
import { photoStore } from "@/app/(protected)/modules/[slug]/journal-photo-root";

// Bundles several photographs into one zip download, for the My Favorite Photos
// screen's bulk "Download" action.
//
// A POST rather than a GET, which is unusual for something that only reads. The reason
// is the payload: a selection of 200 photographs is several kilobytes of paths, and
// these paths are long and full of spaces (`2019-06-09 Von Thun Farm Strawberry
// Festival Washington`). As a query string that overruns what proxies and servers will
// accept for a URL, and it would be logged in full on every request. The body also
// keeps the list out of the browser's history, which is the right place for it.
//
// The cost of POST is that a plain `<a download>` can't trigger it, so the client
// fetches this and saves the blob itself. That trade is made deliberately in
// `fav-photos-list.tsx`, which explains the other half of it.
//
// The zip is assembled WHOLE IN MEMORY and returned as one response. Streaming it
// entry-by-entry would hold less at once, but a store-only zip's central directory is
// written last and needs every entry's size and CRC — so a streamed version has to
// either buffer anyway or use data descriptors, and the ceilings below make the simple
// version safe. `MAX_DOWNLOAD_PHOTOS` and `MAX_DOWNLOAD_BYTES` are what stand between
// one click and the server reading the entire archive into RAM.

/**
 * What the screen sends.
 *
 * The paths themselves are NOT validated here — `planFavPhotoDownload` runs them
 * through the photo archive's own path schema, which is the same refinement guarding
 * the single-photo route. This schema's job is only to establish that the body is a
 * list of strings of a plausible length before any of it is trusted.
 */
const requestSchema = z.object({
  paths: z.array(z.string()).min(1).max(MAX_DOWNLOAD_PHOTOS),
});

export async function POST(request: Request) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Select between 1 and ${MAX_DOWNLOAD_PHOTOS} photos.` },
      { status: 400 },
    );
  }

  // Throws on a path that fails the archive's schema, or a selection past the ceiling.
  // Reported as a 400 with the message, because both are things the reader can act on
  // ("too many photos") rather than server faults.
  let plan;
  try {
    plan = planFavPhotoDownload(parsed.data.paths);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "That selection can't be downloaded." },
      { status: 400 },
    );
  }

  // Read one at a time, not with `Promise.all`. These come off an SMB share, and firing
  // 200 concurrent reads at a NAS is how you turn a download into a timeout for
  // everything else the app is doing. Sequential is also what makes the running byte
  // total below a real brake rather than an after-the-fact check.
  const entries: ZipEntry[] = [];
  const missing: string[] = [];
  let totalBytes = 0;

  const store = photoStore();
  for (const entry of plan) {
    const photo = await store.readPhoto(entry.relativePath);
    // Covers an unset root, a moved folder and a deleted file — all "no such photo".
    // A favourite whose file has gone is skipped rather than failing the whole
    // download: the other nineteen photos are still what was asked for, and the reader
    // is told how many were missing.
    if (photo === undefined) {
      missing.push(entry.relativePath);
      continue;
    }

    totalBytes += photo.data.length;
    if (totalBytes > MAX_DOWNLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `Those photos add up to more than ${Math.round(MAX_DOWNLOAD_BYTES / (1024 * 1024))} MB. Select fewer.`,
        },
        { status: 413 },
      );
    }

    entries.push({ name: entry.entryName, data: photo.data });
  }

  // Every single file was missing. An empty zip is a valid file that opens onto
  // nothing, which reads as a broken feature — so this is an error instead.
  if (entries.length === 0) {
    return NextResponse.json(
      { error: "None of those photos could be read. The archive may have moved." },
      { status: 404 },
    );
  }

  const archive = buildZip(entries);
  const fileName = favPhotoArchiveName(new Date());

  return new NextResponse(new Uint8Array(archive), {
    headers: {
      "Content-Type": "application/zip",
      // ASCII-only `filename` plus the RFC 5987 form: the name is generated from a date
      // so it is ASCII either way, but the pair is what browsers agree on.
      "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Length": String(archive.length),
      // Assembled per request from a selection — there is nothing here worth caching,
      // and a cached zip keyed by URL would be wrong for the next selection anyway.
      "Cache-Control": "no-store",
      // How many favourites had no file behind them, for the screen to mention. A header
      // rather than part of the body, because the body is the archive.
      "X-Missing-Photos": String(missing.length),
    },
  });
}
