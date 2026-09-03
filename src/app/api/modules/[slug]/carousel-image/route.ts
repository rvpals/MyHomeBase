import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getModuleCarouselImage } from "@/lib/modules";
import { deps } from "@/lib/wiring";

// Serves a module's carousel graphic. This is the only place those bytes are
// read — `sys_modules` is loaded on every authenticated page, so keeping the
// BLOB out of the ordinary reads is the whole point (see
// migrations/0040_add_carousel_image_to_modules.md). Mirrors the account-icon,
// card-image and user-avatar routes.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const { slug } = await params;
  if (slug.trim() === "") return new NextResponse(null, { status: 400 });

  // No module-access check: this is the home screen's artwork, and the home
  // screen only ever asks for modules it already decided to show. The session
  // check above is what keeps it off the public internet.
  const image = getModuleCarouselImage(deps.moduleRepo, slug);
  if (!image) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.mimeType,
      // Private: it's behind a session. Immutable and long-lived because every
      // caller addresses this with a `?v=` built from `updated_at` — a replaced
      // image arrives under a new URL, so there is nothing to revalidate. The
      // old 5-minute max-age just meant re-downloading the artwork on every
      // visit, which is exactly what made the carousel feel slow.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
