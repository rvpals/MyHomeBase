import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import {
  buildMetadataBundle,
  metadataExportFileName,
  resolveJournalPreferences,
  serializeMetadataBundle,
} from "@/lib/journal";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { deps } from "@/lib/wiring";

// Downloads the My Journal module's metadata as one JSON file — the "Back up all
// meta data" button in the Meta Data section's title bar.
//
// A GET, unlike the fav-photos zip route next door. That one is a POST only
// because its request carries a selection of up to 200 long file paths; this has
// no payload at all — "everything" is the only thing it can export. So a plain
// `<a href download>` triggers it, and the client needs no fetch, no blob and no
// object URL. The button in `journal-section.tsx` is therefore a link.
//
// Icons are inlined as base64 by `buildMetadataBundle`, so the response is a
// single self-contained file. There is deliberately no size ceiling: the export
// is bounded by what the reader has actually built (a few hundred 128 KB-capped
// icons at worst), it is assembled from the local SQLite file rather than off the
// NAS, and refusing to back up a journal for being too large would defeat the
// point of the button.

const JOURNAL_MODULE_SLUG = "journal";

export async function GET() {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  // Preferences live in sys_module_settings, not the jrn_ tables, so they're
  // resolved here and handed in — `buildMetadataBundle` has no business knowing
  // the journal's module id.
  const journalModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);
  const preferences = resolveJournalPreferences(
    journalModule ? listModuleSettingsFor(deps.moduleSettingsRepo, journalModule.id) : [],
  );

  const bundle = buildMetadataBundle(deps.journalRepo, preferences);
  const body = serializeMetadataBundle(bundle);
  const fileName = metadataExportFileName(new Date());

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // ASCII-only `filename` plus the RFC 5987 form — the name is generated from
      // a date so it's ASCII either way, but the pair is what browsers agree on.
      "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      // Byte length, not string length: the JSON is ASCII in practice but a
      // category name can hold anything.
      "Content-Length": String(Buffer.byteLength(body, "utf8")),
      // Assembled per request from live tables. A cached copy keyed by URL would
      // hand back yesterday's metadata as today's backup, which is the one thing
      // a backup must never do.
      "Cache-Control": "no-store",
    },
  });
}
