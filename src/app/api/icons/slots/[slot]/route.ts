import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getOverrideImage } from "@/lib/icons";
import { DEFAULT_ICON_SET_ID, getSetting } from "@/lib/settings";
import { deps } from "@/lib/wiring";

// Serves the raster bytes of a slot icon override. This is the only place those bytes
// are read — `listForSet` deliberately leaves the BLOB behind, so overriding an icon
// doesn't add image reads to every page render.
//
// SVG overrides never come through here: they are stored as sanitized markup and inlined
// by `SlotIcon`, which is what lets them tint to the theme accent.
export async function GET(_request: Request, { params }: { params: Promise<{ slot: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const { slot } = await params;
  if (slot.trim() === "") return new NextResponse(null, { status: 400 });

  // The set isn't in the URL: an override only ever renders under the set it was uploaded
  // for, so the request means "whatever applies right now". Taking it from the setting
  // rather than the caller also stops the URL being used to enumerate other sets' art.
  const setId = getSetting(deps.settingsRepo, "icon_set")?.value ?? DEFAULT_ICON_SET_ID;

  const icon = getOverrideImage(deps.iconOverridesRepo, slot, setId);
  if (!icon) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(icon.data), {
    headers: {
      "Content-Type": icon.mimeType,
      // Private: it's behind a session. Immutable-ish caching is safe because callers
      // append a ?v= built from `updated_at`, so a replaced icon arrives on a new URL.
      "Cache-Control": "private, max-age=300",
      // The upload allowlist excludes SVG for this column, but a mislabelled raster
      // must not be re-sniffed as one.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
