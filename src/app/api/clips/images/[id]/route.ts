import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getModuleBySlug } from "@/lib/modules";
import { userHasModuleAccess } from "@/lib/user";
import { deps } from "@/lib/wiring";

// Serves one image pasted into a clip. This is the ONLY place the image bytes are
// read, which is what keeps them out of every clip list and out of the clip's own
// HTML — see migration 0155, and migration 0079 for what happens when they are not
// kept out.
//
// Access is checked against the Clips module, not merely "is signed in". A clip can
// hold a pasted email, so its images are as private as the clip is; a route that only
// checked for a session would serve them to any signed-in reader whether or not they
// were granted the module. `requireModuleAccess` is the server-action guard and
// throws, so the check is spelled out here against the same two library functions it
// uses.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const clipsModule = getModuleBySlug(deps.moduleRepo, "clips");
  if (!clipsModule) return new NextResponse(null, { status: 404 });
  if (!userHasModuleAccess(currentUser, clipsModule.id, deps.userRepo)) {
    // 404 rather than 403, matching how the module's pages hide themselves: an
    // ungranted module is indistinguishable from one that does not exist.
    return new NextResponse(null, { status: 404 });
  }

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return new NextResponse(null, { status: 400 });

  const image = deps.clipsRepo.getClipImage(id);
  if (!image) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.mimeType,
      // Private: it is behind a session and a module grant. Long max-age because a
      // stored image is immutable — editing a clip adds a new row with a new id
      // rather than rewriting these bytes, so a cached copy can never go stale.
      "Cache-Control": "private, max-age=31536000, immutable",
      // The upload allowlist refuses SVG (`@/lib/shared/image-upload`), so these are
      // always raster. `nosniff` stops a mislabelled file being re-read as something
      // that executes.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
