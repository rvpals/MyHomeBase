// Server-side wrapper around JournalReviewView: groups the entries by date,
// resolves the taxonomy icon URLs for the viewer, and reads what the merge
// dialog's entry form needs.
//
// Same split as journal-correct-panel.tsx — the impure steps (the whole-journal
// read, the icon lookups, the preferences read) happen here and the view stays
// props-in / events-out. The view refreshes itself from the server actions after
// every mutation, so this initial read only has to be right on first render.

import {
  findSameDateGroups,
  listCategories,
  listEnabledPrefillTemplates,
  listEntries,
  listTags,
  listTaxonomyCombos,
  resolveJournalPreferences,
} from "@/lib/journal";
import { listDashboardTextures } from "@/lib/dashboard-texture";
import { listLocationCategories, listLocationTags } from "@/lib/sys-locations";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { deps } from "@/lib/wiring";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { userHasModuleAccess } from "@/lib/user";
import { JournalReviewView } from "./journal-review-view";
import { journalTaxonomyIconUrlsByName } from "./journal-shared";

const JOURNAL_MODULE_SLUG = "journal";

// `async` because deciding whether the opened entry offers the $ button means
// reading the session cookie, which `next/headers` only exposes as a promise —
// the same reason JournalCalendarPanel is async.
export async function JournalReviewPanel() {
  // The whole journal, not a page of it: four entries sharing a day in 2019 are
  // exactly what this screen exists to find, and any limit here would hide them.
  // The excerpt is cut to 100 words inside findSameDateGroups and only grouped
  // dates survive, so what crosses to the client is bounded even though this
  // read isn't.
  const groups = findSameDateGroups(listEntries(deps.journalRepo));

  const categories = listCategories(deps.journalRepo);
  const tags = listTags(deps.journalRepo);

  // The merge dialog mounts the ordinary entry form, so it needs everything that
  // form needs — the same reads the `new-entry` section does.
  const journalModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);
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
    <JournalReviewView
      groups={groups}
      canSeeExpense={canSeeExpense}
      categoryIcons={Object.fromEntries(journalTaxonomyIconUrlsByName("category", categories))}
      tagIcons={Object.fromEntries(journalTaxonomyIconUrlsByName("tag", tags))}
      categoryOptions={categories.map((category) => category.name)}
      tagOptions={tags.map((tag) => tag.name)}
      // For the edit-this-entry modal on this screen, which is the same editor
      // /entries/[id] mounts — an existing entry's tags are exactly what a combo
      // is for. The merge *draft* below it gets none: that form is building a new
      // entry inside a dialog, and it already carries the prefill templates.
      taxonomyCombos={listTaxonomyCombos(deps.journalRepo)}
      preferences={preferences}
      contentTextures={listDashboardTextures(deps.dashboardTextureRepo)}
      prefillTemplates={listEnabledPrefillTemplates(deps.journalRepo)}
      locationCategoryOptions={listLocationCategories(deps.sysLocationRepo).map(
        (row) => row.name,
      )}
      locationTagOptions={listLocationTags(deps.sysLocationRepo).map((row) => row.name)}
    />
  );
}
