import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import {
  photoRelativePathSchema,
  readPhotoThumbnail,
  resolvePhotoThumbnailSettings,
} from "@/lib/journal-photos";
import { listSettings } from "@/lib/settings";
import { deps } from "@/lib/wiring";
import { photoStore } from "@/app/(protected)/modules/[slug]/journal-photo-root";

// Serves one photo's strip thumbnail: a few KB instead of the multi-MB original, so the
// viewer's strip no longer ties up the browser's connections. Same session gate, the
// same query-parameter path and the same traversal guard as `../route.ts`; which bytes
// to send is decided in `readPhotoThumbnail`, which also takes the `photo_thumbnail_resize`
// switch (migrations/0185) -- off, a photo with no embedded preview falls back to its
// original rather than being shrunk here.
export async function GET(request: Request) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const parsed = photoRelativePathSchema.safeParse(
    new URL(request.url).searchParams.get("path") ?? "",
  );
  if (!parsed.success) return new NextResponse(null, { status: 400 });

  // Read per request, not at boot: switching resizing off on the Configuration screen
  // takes effect on the next tile with no restart. One indexed read of a small table.
  const { resizeOriginals } = resolvePhotoThumbnailSettings(listSettings(deps.settingsRepo));

  const thumbnail = await readPhotoThumbnail(
    {
      store: photoStore(),
      renderer: deps.photoThumbnailRenderer,
      limit: deps.photoThumbnailLimit,
      resizeOriginals,
    },
    { relativePath: parsed.data },
  );
  if (thumbnail === undefined) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(thumbnail.data), {
    // Private and an hour, matching the full-size route: behind a session, and a
    // photo's content does not change in practice.
    headers: { "Content-Type": thumbnail.mimeType, "Cache-Control": "private, max-age=3600" },
  });
}
