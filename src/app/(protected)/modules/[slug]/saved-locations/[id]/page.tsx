// /modules/journal/saved-locations/<id> — every entry written at one saved
// place.
//
// A real route rather than a modal over the list: these are linkable. "Every
// entry at the playground" is a thing worth bookmarking and sending, which a
// dialog cannot be.
//
// Sits under the generic [slug] segment for the same reason entries/[id] does:
// a static `journal` folder here would shadow /modules/[slug] and break the
// module page itself.

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { listEntriesAtSavedLocation } from "@/lib/journal";
import { getSavedLocation } from "@/lib/sys-locations";
import { getModuleBySlug } from "@/lib/modules";
import { userHasModuleAccess } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { EntriesAtLocationView } from "./entries-at-location-view";
import { JournalShell } from "../../journal-shell";
import { PAGE_CONTAINER } from "../../../../page-container";

const JOURNAL_MODULE_SLUG = "journal";

export default async function EntriesAtSavedLocationPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  if (slug !== JOURNAL_MODULE_SLUG) notFound();

  const appModule = getModuleBySlug(deps.moduleRepo, slug);
  if (!appModule) notFound();

  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  // The same guard the module page and entries/[id] use: a journal entry must
  // not be readable by someone who has not been granted the journal module.
  if (!currentUser || !userHasModuleAccess(currentUser, appModule.id, deps.userRepo)) {
    notFound();
  }

  const savedLocationId = Number(id);
  if (!Number.isInteger(savedLocationId) || savedLocationId <= 0) notFound();

  // Deliberately *not* a 404 when the place is missing. There is no foreign key
  // (migration 0151), so deleting a saved place leaves its entries pointing at a
  // row that is gone — and those entries are still real, still readable from
  // their own copied fields, and still what this URL is about. The view says the
  // place is gone and lists them anyway.
  const place = getSavedLocation(deps.sysLocationRepo, savedLocationId);
  const entries = listEntriesAtSavedLocation(deps.journalRepo, savedLocationId);

  return (
    // The same two-tier shell every other journal screen renders — without it
    // this would draw into `.app-main` with no rail, no panel and no header.
    <JournalShell>
      <div className={PAGE_CONTAINER}>
        <EntriesAtLocationView
          place={place}
          entries={entries}
          entryBasePath={`/modules/${JOURNAL_MODULE_SLUG}/entries`}
          backHref={`/modules/${JOURNAL_MODULE_SLUG}/saved-locations`}
        />
      </div>
    </JournalShell>
  );
}
