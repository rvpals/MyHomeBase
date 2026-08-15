// Composes one My Journal section: the section nav, a heading with the section's
// description, and the section's own view. Data is loaded per section rather than
// all at once.
//
// A server component, so it can talk to `deps` directly and hand plain data to
// the client views. Mirrors stock-section.tsx and expense-section.tsx.

import { CollapsibleCard } from "@/components/collapsible-card";
import { listNamedMappings } from "@/lib/csv-import";
import {
  listCategories,
  listRecentEntries,
  listTags,
  listTopCategories,
  listTopTags,
  resolveJournalPreferences,
} from "@/lib/journal";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { deps } from "@/lib/wiring";
import { JOURNAL_SECTION_INFO, type JournalSection } from "./journal-sections";
import { JournalEntriesPanel } from "./journal-entries-panel";
import { JournalHomeHeader } from "./journal-search-view";
import { JournalPreferencesView } from "./journal-preferences-view";
import { JournalTaxonomyView } from "./journal-taxonomy-view";
import { JournalView } from "./journal-view";
import { SectionLayout } from "./section-layout";

const JOURNAL_MODULE_SLUG = "journal";
const RECENT_JOURNAL_ENTRY_LIMIT = 25;
const TOP_TAXONOMY_LIMIT = 10;

function SectionBody({
  section,
  isAdmin,
  filterQuery,
}: {
  section: JournalSection;
  isAdmin: boolean;
  /** From ?filter= — an ad-hoc filter query for the Entries section. */
  filterQuery?: string;
}) {
  switch (section) {
    case "main": {
      const journalModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);
      const preferences = resolveJournalPreferences(
        journalModule ? listModuleSettingsFor(deps.moduleSettingsRepo, journalModule.id) : [],
      );
      return (
        <JournalView
          entries={listRecentEntries(deps.journalRepo, RECENT_JOURNAL_ENTRY_LIMIT)}
          topTags={listTopTags(deps.journalRepo, TOP_TAXONOMY_LIMIT)}
          topCategories={listTopCategories(deps.journalRepo, TOP_TAXONOMY_LIMIT)}
          categoryOptions={listCategories(deps.journalRepo).map((category) => category.name)}
          tagOptions={listTags(deps.journalRepo).map((tag) => tag.name)}
          preferences={preferences}
          namedMappings={listNamedMappings(deps.csvImportMappingRepo, "Journal")}
          canRunSql={isAdmin}
        />
      );
    }

    case "entries":
      // ?filter= (set by the Top Tags/Categories cards) pre-selects a slice;
      // without it this lists everything and the reader picks from the dropdown.
      return <JournalEntriesPanel filterQuery={filterQuery} />;

    case "configuration": {
      const journalModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);
      const preferences = resolveJournalPreferences(
        journalModule ? listModuleSettingsFor(deps.moduleSettingsRepo, journalModule.id) : [],
      );
      return (
        <div className="flex flex-col gap-8">
          <JournalPreferencesView preferences={preferences} />
          <CollapsibleCard title="Categories & Tags">
            <JournalTaxonomyView
              categories={listCategories(deps.journalRepo)}
              tags={listTags(deps.journalRepo)}
            />
          </CollapsibleCard>
        </div>
      );
    }

    default:
      return (
        <div className="rounded-xl border border-dashed border-line p-8 text-center">
          <p className="font-display text-lg text-ink">Coming soon</p>
          <p className="mt-1 text-sm text-muted">This section is not built out yet.</p>
        </div>
      );
  }
}

export function JournalSection({
  section,
  isAdmin,
  filterQuery,
}: {
  section: JournalSection;
  isAdmin: boolean;
  filterQuery?: string;
}) {
  // Defensive: an unknown section would otherwise crash on info.label. The route
  // already validates, so this only catches a future caller getting it wrong.
  const info = JOURNAL_SECTION_INFO[section] ?? JOURNAL_SECTION_INFO.main;

  return (
    // The nav/body split lives in SectionLayout: it's a bar in `full` and a
    // column in `rail`/`strip`, so which way this lays out is client state that
    // a server component can't hold.
    <SectionLayout nav="journal">
      {section === "main" ? (
        <JournalHomeHeader label={info.label} description={info.description} />
      ) : (
        <>
          <h2 className="font-display text-2xl font-semibold text-ink">{info.label}</h2>
          <p className="mt-1 text-sm text-muted">{info.description}</p>
          <div className="mt-3 h-px w-full bg-line" />
        </>
      )}

      <div className="mt-6">
        <SectionBody section={section} isAdmin={isAdmin} filterQuery={filterQuery} />
      </div>
    </SectionLayout>
  );
}
