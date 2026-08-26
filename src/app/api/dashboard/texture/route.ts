import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getDashboardTextureImage } from "@/lib/dashboard-texture";
import { deps } from "@/lib/wiring";

// Serves the home dashboard's background picture. This is the only place those
// bytes are read — the settings row is loaded in the root layout on every
// authenticated page, so keeping the BLOB out of that read is the whole point
// (see migrations/0063_create_dashboard_texture.md). Mirrors the carousel-image,
// account-icon and user-avatar routes.
export async function GET() {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  // No admin check: this is page decoration that every signed-in reader already
  // sees rendered. The session check above is what keeps it off the public
  // internet; only *changing* it is admin-gated, in the server action.
  const image = getDashboardTextureImage(deps.dashboardTextureRepo);
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
