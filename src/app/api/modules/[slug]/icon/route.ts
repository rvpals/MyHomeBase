import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getModuleCustomIcon } from "@/lib/modules";
import { deps } from "@/lib/wiring";

// Serves the raster bytes of a module's uploaded icon. This is the only place
// those bytes are read — `MODULE_COLUMNS` deliberately leaves the BLOB behind,
// so uploading an icon doesn't add an image read to every page render. See
// migrations/0150_module_custom_icon.md.
//
// SVG uploads never come through here: they are stored as sanitized markup and
// inlined by `ModuleIcon`, which is what lets them tint to the theme accent and
// to the brass of an active nav row.
//
// Mirrors the carousel-image route next door; the differences are that the bytes
// here are a 256px PNG rather than someone's full-size artwork, and that a
// mislabelled file must not be re-sniffed.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const { slug } = await params;
  if (slug.trim() === "") return new NextResponse(null, { status: 400 });

  // No module-access check, for the same reason the carousel route gives: this
  // is chrome, and every nav only asks for modules it already decided to show.
  // A module's icon is not private information — the session check above is what
  // keeps it off the public internet.
  const icon = getModuleCustomIcon(deps.moduleRepo, slug);
  if (!icon?.data || !icon.mimeType) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(icon.data), {
    headers: {
      "Content-Type": icon.mimeType,
      // Private: it's behind a session. Immutable and long-lived because every
      // caller addresses this with a `?v=` built from `updated_at` — a replaced
      // icon arrives under a new URL, so there is nothing to revalidate. This
      // one is in the nav on every page, so re-fetching it per visit would be
      // the most-repeated wasted request in the app.
      "Cache-Control": "private, max-age=31536000, immutable",
      // The upload allowlist excludes SVG for this column, but a mislabelled
      // raster must not be re-sniffed as one.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
