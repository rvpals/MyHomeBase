import { NextResponse } from "next/server";
import type { DecodedImage } from "@/lib/shared/image-upload";

/**
 * The response for a Document Library category/tag icon, shared by the two icon routes
 * so their headers can't drift apart. Mirrors `api/journal/icon-response.ts`.
 *
 * Unlike the Journal's, every icon here is an uploaded raster — PNG, JPEG, WebP or GIF,
 * enforced by `@/lib/shared/image-upload`. This module has no icon generator, so there
 * is no SVG case to sandbox. `nosniff` still matters: it stops a mislabelled file being
 * re-read as something else by a browser that thinks it knows better.
 */
export function documentIconResponse(icon: DecodedImage): NextResponse {
  return new NextResponse(new Uint8Array(icon.data), {
    headers: {
      "Content-Type": icon.mimeType,
      // Private: it's behind a session. Short max-age so a replaced icon shows up
      // quickly; callers also add a ?v= cache-buster from updatedAt.
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
