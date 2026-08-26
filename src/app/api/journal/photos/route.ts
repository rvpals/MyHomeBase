import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { photoRelativePathSchema } from "@/lib/journal-photos";
import { deps } from "@/lib/wiring";
import { photoStore } from "@/app/(protected)/modules/[slug]/journal-photo-root";

// Serves one photo's bytes from the archive to the journal entry's picture card.
//
// The path is a QUERY PARAMETER rather than a catch-all route segment, because these
// folder names are full of spaces and characters a URL path handles badly
// (`2019-06-09 Von Thun Farm Strawberry Festival Washington`). A query value survives
// `encodeURIComponent` intact; a path segment would need every consumer to agree on how
// `#` and `+` were escaped.
//
// The traversal guard runs twice on purpose: `photoRelativePathSchema` rejects an
// unsafe value here with a clean 400, and `NodePhotoFileStore` refuses it again before
// touching the filesystem. Belt and braces on the one route that turns a request
// parameter into a file read.
export async function GET(request: Request) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const rawPath = new URL(request.url).searchParams.get("path");
  const parsed = photoRelativePathSchema.safeParse(rawPath ?? "");
  if (!parsed.success) return new NextResponse(null, { status: 400 });

  const photo = await photoStore().readPhoto(parsed.data);
  // Covers an unset root, a folder that has moved, and a file that is gone — all of
  // which are "no such photo" to the viewer.
  if (photo === undefined) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(photo.data), {
    headers: {
      "Content-Type": photo.mimeType,
      // Private: these bytes sit behind a session. Long max-age because a photo's
      // content never changes — a replaced file gets a different name in practice.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
