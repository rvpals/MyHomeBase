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
  resolveJournalPreferences,
} from "@/lib/journal";
import { listLocationCategories, listLocationTags } from "@/lib/journal-locations";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { deps } from "@/lib/wiring";
import { JournalReviewView } from "./journal-review-view";
import { journalTaxonomyIconUrlsByName } from "./journal-shared";

const JOURNAL_MODULE_SLUG = "journal";

export function JournalReviewPanel() {
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

  return (
    <JournalReviewView
      groups={groups}
      categoryIcons={Object.fromEntries(journalTaxonomyIconUrlsByName("category", categories))}
      tagIcons={Object.fromEntries(journalTaxonomyIconUrlsByName("tag", tags))}
      categoryOptions={categories.map((category) => category.name)}
      tagOptions={tags.map((tag) => tag.name)}
      preferences={preferences}
      prefillTemplates={listEnabledPrefillTemplates(deps.journalRepo)}
      locationCategoryOptions={listLocationCategories(deps.savedLocationRepo).map(
        (row) => row.name,
      )}
      locationTagOptions={listLocationTags(deps.savedLocationRepo).map((row) => row.name)}
    />
  );
}
