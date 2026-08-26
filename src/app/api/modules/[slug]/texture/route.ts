import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getModuleTextureImage } from "@/lib/module-texture";
import { deps } from "@/lib/wiring";

// Serves a module's background picture. This is the only place those bytes are
// read -- every other caller reads `hasImage` off the settings row, so the BLOB
// stays out of page renders (see migrations/0064_create_module_texture.md).
// Mirrors the dashboard-texture, carousel-image and user-avatar routes.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const { slug } = await params;

  // No admin check, and no per-module access check: this is page decoration that
  // every signed-in reader already sees rendered behind the module they are
  // looking at, and a background picture is not module data. The session check
  // above keeps it off the public internet; only *changing* it is admin-gated,
  // in the server action.
  //
  // A malformed slug throws out of the schema rather than reaching SQL; that is a
  // bad request, not a server fault.
  let image;
  try {
    image = getModuleTextureImage(deps.moduleTextureRepo, slug);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (!image) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.mimeType,
      // Private: it's behind a session. Short max-age so a replaced picture shows
      // up quickly; the CSS url also carries a ?v= cache-buster.
      "Cache-Control": "private, max-age=300",
    },
  });
}
