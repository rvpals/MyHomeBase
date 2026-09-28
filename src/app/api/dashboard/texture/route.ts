import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getDashboardTextureImage } from "@/lib/dashboard-texture";
import { deps } from "@/lib/wiring";

// Serves a dashboard background picture. This is the only place those bytes are
// read — the settings row is loaded on the home dashboard's render, so keeping
// the BLOB out of that read is the whole point (see
// migrations/0113_create_dashboard_texture_library.md). Mirrors the
// carousel-image, account-icon and user-avatar routes.
//
// With no `?id=`, serves the *selected* texture — that is what the dashboard's
// own CSS url resolves to. With `?id=<n>`, serves that library picture, which is
// what the admin gallery's thumbnails use.
export async function GET(request: Request) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  // No admin check: this is page decoration that every signed-in reader already
  // sees rendered. The session check above is what keeps it off the public
  // internet; only *changing* it is admin-gated, in the server actions.
  const rawId = new URL(request.url).searchParams.get("id");

  // A non-numeric `id` is a malformed request, not a request for the selected
  // texture — falling through to the selection would serve the wrong picture
  // under a URL that names a specific one, and the gallery would show every
  // tile as the same image.
  if (rawId !== null && !/^\d+$/.test(rawId)) {
    return new NextResponse(null, { status: 400 });
  }

  const image = getDashboardTextureImage(
    deps.dashboardTextureRepo,
    rawId === null ? undefined : Number(rawId),
  );
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
