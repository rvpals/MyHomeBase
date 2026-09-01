// Composes one My Journal section: the section nav, a heading with the section's
// description, and the section's own view. Data is loaded per section rather than
// all at once.
//
// A server component, so it can talk to `deps` directly and hand plain data to
// the client views. Mirrors stock-section.tsx and expense-section.tsx.

import { CollapsibleCard } from "@/components/collapsible-card";
import { listNamedMappings } from "@/lib/csv-import";
import {
  JOURNAL_PREFILL_FIELDS,
  listCategories,
  listEnabledPrefillTemplates,
  listPrefillSuggestions,
  listPrefillTemplates,
  listRecentEntries,
  listTags,
  listTopCategories,
  listTopTags,
  resolveJournalPreferences,
  type JournalPrefillField,
} from "@/lib/journal";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { deps } from "@/lib/wiring";
import { JOURNAL_SECTION_INFO, type JournalSection } from "./journal-sections";
import { JournalCalendarPanel } from "./journal-calendar-panel";
import { JournalEntriesPanel } from "./journal-entries-panel";
import { journalTaxonomyIconUrlsByName } from "./journal-shared";
import { JournalShell } from "./journal-shell";
import { JournalHomeHeader } from "./journal-search-view";
import { JournalImportView } from "./journal-import-view";
import { JournalPreferencesView } from "./journal-preferences-view";
import { JournalTaxonomyView } from "./journal-taxonomy-view";
import { JournalTemplatesView } from "./journal-templates-view";
import { JournalView } from "./journal-view";

const JOURNAL_MODULE_SLUG = "journal";
const RECENT_JOURNAL_ENTRY_LIMIT = 25;
const TOP_TAXONOMY_LIMIT = 10;

function SectionBody({
  section,
  isAdmin,
  filterQuery,
  calendarScope,
  calendarAnchor,
  selectedDate,
}: {
  section: JournalSection;
  isAdmin: boolean;
  /** From ?filter= — an ad-hoc filter query for the Entries section. */
  filterQuery?: string;
  /** From ?scope=/?anchor=/?date= — which period the Calendar shows, and the
   *  day whose entries are listed under it. */
  calendarScope?: string;
  calendarAnchor?: string;
  selectedDate?: string;
}) {
  switch (section) {
    case "main": {
      const journalModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);
      const preferences = resolveJournalPreferences(
        journalModule ? listModuleSettingsFor(deps.moduleSettingsRepo, journalModule.id) : [],
      );
      // Read once and use twice: the names feed the entry form's dropdowns, and
      // the same rows carry the icon mime types the Statistics lists need. The
      // top-N queries return names and counts only, so icons are matched by name.
      const categories = listCategories(deps.journalRepo);
      const tags = listTags(deps.journalRepo);
      return (
        <JournalView
          entries={listRecentEntries(deps.journalRepo, RECENT_JOURNAL_ENTRY_LIMIT)}
          topTags={listTopTags(deps.journalRepo, TOP_TAXONOMY_LIMIT)}
          topCategories={listTopCategories(deps.journalRepo, TOP_TAXONOMY_LIMIT)}
          categoryOptions={categories.map((category) => category.name)}
          tagOptions={tags.map((tag) => tag.name)}
          categoryIcons={Object.fromEntries(journalTaxonomyIconUrlsByName("category", categories))}
          tagIcons={Object.fromEntries(journalTaxonomyIconUrlsByName("tag", tags))}
          preferences={preferences}
          prefillTemplates={listEnabledPrefillTemplates(deps.journalRepo)}
          canRunSql={isAdmin}
        />
      );
    }

    case "entries":
      // ?filter= (set by the Top Tags/Categories cards) pre-selects a slice;
      // without it this lists everything and the reader picks from the dropdown.
      return <JournalEntriesPanel filterQuery={filterQuery} />;

    case "calendar":
      // Unvalidated params by design: the panel degrades a bad one to the
      // default rather than 404ing a screen that is fine at its default.
      return (
        <JournalCalendarPanel
          scope={calendarScope}
          anchor={calendarAnchor}
          selectedDate={selectedDate}
        />
      );

    case "import":
      // Used to be an "Import from CSV" card at the bottom of the home screen.
      // It is its own section now: importing is an occasional, deliberate act,
      // and the mapping table it renders wants the whole page width.
      return <JournalImportView namedMappings={listNamedMappings(deps.csvImportMappingRepo, "Journal")} />;

    case "configuration": {
      const journalModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);
      const preferences = resolveJournalPreferences(
        journalModule ? listModuleSettingsFor(deps.moduleSettingsRepo, journalModule.id) : [],
      );
      return <JournalPreferencesView preferences={preferences} />;
    }

    case "metadata":
      // Categories & Tags used to sit under Preferences; it is its own section
      // now. Kept in a card (open by default) so it presents like Templates
      // rather than as a bare list bolted to the page heading.
      return (
        <CollapsibleCard title="Categories & Tags" defaultOpen>
          <JournalTaxonomyView
            categories={listCategories(deps.journalRepo)}
            tags={listTags(deps.journalRepo)}
          />
        </CollapsibleCard>
      );

    case "templates": {
      // Suggestions are read here, on the server, and handed down as plain data
      // — one read per field rather than a round trip each time the editor's
      // dropdown changes. The lists are small (25 values, or the managed
      // category/tag lists) so shipping all of them costs less than the actions
      // would.
      const suggestions = Object.fromEntries(
        JOURNAL_PREFILL_FIELDS.map((entry) => [
          entry.field,
          listPrefillSuggestions(deps.journalRepo, entry.field),
        ]),
      ) as Record<JournalPrefillField, string[]>;
      return (
        <JournalTemplatesView
          templates={listPrefillTemplates(deps.journalRepo)}
          suggestions={suggestions}
        />
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

export async function JournalSection({
  section,
  isAdmin,
  filterQuery,
  calendarScope,
  calendarAnchor,
  selectedDate,
}: {
  section: JournalSection;
  isAdmin: boolean;
  filterQuery?: string;
  calendarScope?: string;
  calendarAnchor?: string;
  selectedDate?: string;
}) {
  // Defensive: an unknown section would otherwise crash on info.label. The route
  // already validates, so this only catches a future caller getting it wrong.
  const info = JOURNAL_SECTION_INFO[section] ?? JOURNAL_SECTION_INFO.main;

  return (
    // The two-tier shell: a module rail, a section panel and a utility header,
    // all placed by `JournalShell`. See design.md, "Navigation: the two-tier
    // shell".
    //
    // `async` because the shell reads cookies for the session and the pinned
    // layout, which `next/headers` only exposes as a promise.
    <JournalShell>
      {/* On the home screen the body goes *inside* the header: the title row's
          New Entry button toggles the New Journal card down in JournalView, so
          one client component has to sit above both. Other sections keep the
          plain heading and render the body as a sibling. */}
      {section === "main" ? (
        <JournalHomeHeader label={info.label} description={info.description}>
          <div className="mt-6">
            <SectionBody
              section={section}
              isAdmin={isAdmin}
              filterQuery={filterQuery}
              calendarScope={calendarScope}
              calendarAnchor={calendarAnchor}
              selectedDate={selectedDate}
            />
          </div>
        </JournalHomeHeader>
      ) : (
        <>
          <h2 className="font-display text-2xl font-semibold text-ink">{info.label}</h2>
          <p className="mt-1 text-sm text-muted">{info.description}</p>
          <div className="mt-3 h-px w-full bg-line" />
          <div className="mt-6">
            <SectionBody
              section={section}
              isAdmin={isAdmin}
              filterQuery={filterQuery}
              calendarScope={calendarScope}
              calendarAnchor={calendarAnchor}
              selectedDate={selectedDate}
            />
          </div>
        </>
      )}
    </JournalShell>
  );
}
