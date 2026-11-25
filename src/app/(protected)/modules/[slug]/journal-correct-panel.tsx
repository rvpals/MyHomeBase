// Server-side wrapper around JournalCorrectView: reads the duplicate groups and
// the recycle bin, resolves the taxonomy icon URLs, and hands the client view
// plain data.
//
// Same split as journal-calendar-panel.tsx — the impure steps (the whole-journal
// read, the icon lookups) happen here and the view stays props-in / events-out.
// The view refreshes itself from the server actions after every mutation, so
// this initial read only has to be right on first render.
//
// Two call sites, one per card: the Duplicate entries section (`show="duplicates"`)
// and the Recycle Bin section (`show="recycled"`). Each skips the other's read.

import {
  findDuplicateGroups,
  listCategories,
  listEnabledPrefillTemplates,
  listEntries,
  listRecycledEntries,
  listTags,
  listTaxonomyCombos,
  resolveJournalPreferences,
} from "@/lib/journal";
// Clips is read here, in the presentation layer, so `src/lib/journal` never has to
// import `src/lib/clips` — the Journal must not know about Clips, or the two
// library modules would import each other. See journal-entries-panel.tsx.
import { countClipsForTargets } from "@/lib/clips";
import { listDashboardTextures } from "@/lib/dashboard-texture";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
// The bulk-edit dialog's "From your saved places" tab filters by these. They are
// the *place* taxonomy from the application-wide library, unrelated to the entry
// categories/tags below.
import { listLocationCategories, listLocationTags } from "@/lib/sys-locations";
import { deps } from "@/lib/wiring";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { userHasModuleAccess } from "@/lib/user";
import { JournalCorrectView, type JournalCorrectViewMode } from "./journal-correct-view";
import { journalTaxonomyIconUrlsByName } from "./journal-shared";

// `async` because deciding whether the opened entry offers the $ button means
// reading the session cookie, which `next/headers` only exposes as a promise —
// the same reason JournalCalendarPanel is async.
export async function JournalCorrectPanel({
  show = "both",
}: { show?: JournalCorrectViewMode } = {}) {
  // The whole journal, not a page of it: two entries duplicating each other in
  // 2019 are exactly what this screen exists to find, and any limit here would
  // hide them. Each row carries its entry with the body blanked (see
  // src/lib/journal/duplicates.ts), so what crosses to the client is bounded
  // even though this read isn't.
  //
  // Skipped entirely for the Recycle Bin section: that screen never renders the
  // Duplicates card, so reading and grouping every entry in the journal would be
  // pure cost. The recycle bin alone is a cheap, bounded query. **This is the
  // read worth guarding** — everything else below is a handful of small lookups.
  const duplicateGroups =
    show === "recycled" ? [] : findDuplicateGroups(listEntries(deps.journalRepo));
  // And the mirror of that: the Duplicate entries section never renders the bin.
  // Its actions still return a bin list, which the view adopts — a restore made
  // here really does come out of it — but the first render needs none.
  const recycledEntries = show === "duplicates" ? [] : listRecycledEntries(deps.journalRepo);

  const categories = listCategories(deps.journalRepo);
  const tags = listTags(deps.journalRepo);

  // How many clips are attached to each duplicate row, for the paperclip badge.
  // One query for the whole card, not one per row: `countClipsForTargets` groups
  // in SQL, and ids with no clips are simply absent from the map.
  const clipCounts = countClipsForTargets(
    deps.clipsRepo,
    "journal",
    duplicateGroups.flatMap((group) => group.entries.map((entry) => entry.id)),
  );

  // What the Duplicates grid's Bulk edit, Bulk overwrite and Merge dialogs need
  // — the same reads journal-entries-panel.tsx makes for the Entries list, since
  // it is the same grid and the same dialogs.
  const journalModule = getModuleBySlug(deps.moduleRepo, "journal");
  const preferences = resolveJournalPreferences(
    journalModule ? listModuleSettingsFor(deps.moduleSettingsRepo, journalModule.id) : [],
  );

  // A separate grant from the journal one the route already checked — plenty of
  // readers have one module and not the other.
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  const expenseModule = getModuleBySlug(deps.moduleRepo, "expense");
  const canSeeExpense =
    currentUser !== undefined &&
    expenseModule !== undefined &&
    userHasModuleAccess(currentUser, expenseModule.id, deps.userRepo);

  return (
    <JournalCorrectView
      canSeeExpense={canSeeExpense}
      // For the opened entry's edit form — the same read the entry page makes.
      taxonomyCombos={listTaxonomyCombos(deps.journalRepo)}
      duplicateGroups={duplicateGroups}
      recycledEntries={recycledEntries}
      show={show}
      categoryIcons={Object.fromEntries(journalTaxonomyIconUrlsByName("category", categories))}
      tagIcons={Object.fromEntries(journalTaxonomyIconUrlsByName("tag", tags))}
      // A plain object rather than the Map: a client component's props have to be
      // serialisable across the server/client boundary, and a Map is not.
      clipCounts={Object.fromEntries(clipCounts)}
      categoryOptions={categories.map((category) => category.name)}
      tagOptions={tags.map((tag) => tag.name)}
      locationCategoryOptions={listLocationCategories(deps.sysLocationRepo).map((row) => row.name)}
      locationTagOptions={listLocationTags(deps.sysLocationRepo).map((row) => row.name)}
      preferences={preferences}
      contentTextures={listDashboardTextures(deps.dashboardTextureRepo)}
      prefillTemplates={listEnabledPrefillTemplates(deps.journalRepo)}
    />
  );
}
