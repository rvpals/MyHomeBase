import { NextResponse } from "next/server";
import type { JournalTaxonomyIcon } from "@/lib/journal";

/**
 * The response for a journal category/tag icon, shared by the two icon routes so
 * their headers can't drift apart.
 *
 * A taxonomy icon is either an uploaded raster (PNG/JPEG/WebP/GIF, enforced by
 * `@/lib/shared/image-upload`) or an SVG this app generated itself
 * (`@/lib/journal/generated-icons`). The SVG case gets extra headers: an SVG is a
 * document, not just pixels, so served from our own origin it would otherwise be
 * a script-execution context. `sandbox` with no allow-list drops scripting,
 * plugins, and same-origin privileges, which makes the file inert even in a
 * top-level tab; `nosniff` stops a mislabelled raster being re-read as one.
 *
 * These are defence in depth, not the primary control — the primary control is
 * that only our own generator can put an SVG in that column.
 */
export function journalIconResponse(icon: JournalTaxonomyIcon): NextResponse {
  const isSvg = icon.mimeType === "image/svg+xml";

  return new NextResponse(new Uint8Array(icon.data), {
    headers: {
      "Content-Type": icon.mimeType,
      // Private: it's behind a session. Short max-age so a replaced icon shows up
      // quickly; callers also add a ?v= cache-buster from updatedAt.
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      ...(isSvg
        ? {
            "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
            // Inline so <img src> still renders it; the sandbox above is what
            // makes that safe rather than the disposition.
            "Content-Disposition": "inline",
          }
        : {}),
    },
  });
}
