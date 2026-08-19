import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { trackIdSchema } from "@/lib/music";
import { deps } from "@/lib/wiring";

// Serves an album's cover art. The ONLY reader of the `mus_albums.cover_image` bytes
// -- every other query on that table uses an explicit column list exposing just
// `has_cover_image`, because the browse screens read albums in pages and would
// otherwise ship a hundred kilobytes per row. Same rule as the module carousel image
// (coding-guide.md, per-row images).
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const parsedId = trackIdSchema.safeParse((await context.params).id);
  if (!parsedId.success) return new NextResponse(null, { status: 400 });

  const cover = deps.musicRepo.getAlbumCover(parsedId.data);
  if (cover === undefined) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(cover.data), {
    headers: {
      "Content-Type": cover.mimeType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
