import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getCardFrameImage } from "@/lib/card-frame";
import { deps } from "@/lib/wiring";

// Serves a card frame picture. This is the only place those bytes are read —
// the selection is resolved on every protected render to emit the CSS
// variables, so keeping the BLOB out of that read is the whole point (see
// migrations/0133_create_card_frames.md). Mirrors the dashboard-texture,
// carousel-image, account-icon and user-avatar routes.
//
// With no `?id=`, serves the *selected* frame — that is what the application's
// own CSS url resolves to. With `?id=<n>`, serves that library picture, which
// is what the admin gallery's thumbnails and its live preview use.
export async function GET(request: Request) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  // No admin check: this is card decoration that every signed-in reader already
  // sees rendered. The session check above is what keeps it off the public
  // internet; only *changing* it is admin-gated, in the server actions.
  const rawId = new URL(request.url).searchParams.get("id");

  // A non-numeric `id` is a malformed request, not a request for the selected
  // frame — falling through to the selection would serve the wrong picture
  // under a URL naming a specific one, and the gallery would show every tile as
  // the same image.
  if (rawId !== null && !/^\d+$/.test(rawId)) {
    return new NextResponse(null, { status: 400 });
  }

  const image = getCardFrameImage(deps.cardFrameRepo, rawId === null ? undefined : Number(rawId));
  if (!image) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.mimeType,
      // Private: it's behind a session. Short max-age so a replaced picture
      // shows up quickly; the CSS url also carries a ?v= cache-buster.
      "Cache-Control": "private, max-age=300",
    },
  });
}
