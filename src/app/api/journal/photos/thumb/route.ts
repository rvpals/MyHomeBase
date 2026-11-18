import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { photoRelativePathSchema, readPhotoThumbnail } from "@/lib/journal-photos";
import { deps } from "@/lib/wiring";
import { photoStore } from "@/app/(protected)/modules/[slug]/journal-photo-root";

// Serves one photo's strip thumbnail: a few KB instead of the multi-MB original, so the
// viewer's strip no longer ties up the browser's connections. Same session gate, the
// same query-parameter path and the same traversal guard as `../route.ts`; which bytes
// to send is decided in `readPhotoThumbnail`.
export async function GET(request: Request) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const parsed = photoRelativePathSchema.safeParse(
    new URL(request.url).searchParams.get("path") ?? "",
  );
  if (!parsed.success) return new NextResponse(null, { status: 400 });

  const thumbnail = await readPhotoThumbnail(
    { store: photoStore(), renderer: deps.photoThumbnailRenderer, limit: deps.photoThumbnailLimit },
    { relativePath: parsed.data },
  );
  if (thumbnail === undefined) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(thumbnail.data), {
    // Private and an hour, matching the full-size route: behind a session, and a
    // photo's content does not change in practice.
    headers: { "Content-Type": thumbnail.mimeType, "Cache-Control": "private, max-age=3600" },
  });
}
