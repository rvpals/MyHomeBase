// Server-side wrapper around JournalCorrectView: reads the duplicate groups and
// the recycle bin, resolves the taxonomy icon URLs, and hands the client view
// plain data.
//
// Same split as journal-calendar-panel.tsx — the impure steps (the whole-journal
// read, the icon lookups) happen here and the view stays props-in / events-out.
// The view refreshes itself from the server actions after every mutation, so
// this initial read only has to be right on first render.

import { findDuplicateGroups, listCategories, listEntries, listRecycledEntries, listTags } from "@/lib/journal";
import { deps } from "@/lib/wiring";
import { JournalCorrectView } from "./journal-correct-view";
import { journalTaxonomyIconUrlsByName } from "./journal-shared";

export function JournalCorrectPanel() {
  // The whole journal, not a page of it: two entries duplicating each other in
  // 2019 are exactly what this screen exists to find, and any limit here would
  // hide them. The excerpt is cut to 100 words inside findDuplicateGroups, so
  // what crosses to the client is bounded even though this read isn't.
  const duplicateGroups = findDuplicateGroups(listEntries(deps.journalRepo));
  const recycledEntries = listRecycledEntries(deps.journalRepo);

  const categories = listCategories(deps.journalRepo);
  const tags = listTags(deps.journalRepo);

  return (
    <JournalCorrectView
      duplicateGroups={duplicateGroups}
      recycledEntries={recycledEntries}
      categoryIcons={Object.fromEntries(journalTaxonomyIconUrlsByName("category", categories))}
      tagIcons={Object.fromEntries(journalTaxonomyIconUrlsByName("tag", tags))}
    />
  );
}
