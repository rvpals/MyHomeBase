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
import {
  countLocationsByCategory,
  countLocationsByTag,
  listLocationCategories,
  listLocationTags,
  listSavedLocations,
  type LocationTaxonomyKind,
} from "@/lib/journal-locations";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { deps } from "@/lib/wiring";
import { JOURNAL_SECTION_INFO, type JournalSection } from "./journal-sections";
import { JournalCalendarPanel } from "./journal-calendar-panel";
import { JournalEntriesPanel } from "./journal-entries-panel";
import { journalTaxonomyIconUrlsByName, locationTaxonomyIconUrl } from "./journal-shared";
import { JournalShell } from "./journal-shell";
import { JournalHomeHeader } from "./journal-search-view";
import { JournalCorrectPanel } from "./journal-correct-panel";
import { JournalCalendarImportView } from "./journal-calendar-import-view";
import { JournalImportView } from "./journal-import-view";
import { JournalLocationMapView } from "./journal-location-map-view";
import { JournalLocationTaxonomyView } from "./journal-location-taxonomy-view";
import { JournalLocationsView } from "./journal-locations-view";
import {
  JournalMetadataBackupButton,
  JournalMetadataRestoreCard,
} from "./journal-metadata-transfer-view";
import { JournalNewEntryView } from "./journal-new-entry-view";
import { JournalPreferencesView } from "./journal-preferences-view";
import { JournalTaxonomyView } from "./journal-taxonomy-view";
import { JournalTemplatesView } from "./journal-templates-view";
import { JournalView } from "./journal-view";

const JOURNAL_MODULE_SLUG = "journal";
const RECENT_JOURNAL_ENTRY_LIMIT = 25;
const TOP_TAXONOMY_LIMIT = 10;

/**
 * Location category/tag name -> icon URL, for the screens that render a place's
 * taxonomy as bare strings (the Location Manager's chips, the map's pins).
 *
 * A plain record rather than a Map because it crosses the server/client boundary
 * into a client component, and a Map doesn't survive that serialization. Only
 * names that actually have an icon get an entry, so a lookup miss means "no
 * icon" without needing a second flag.
 */
function locationIconMap(kind: LocationTaxonomyKind): Record<string, string> {
  const rows =
    kind === "category"
      ? listLocationCategories(deps.savedLocationRepo)
      : listLocationTags(deps.savedLocationRepo);
  const urls: Record<string, string> = {};
  for (const row of rows) {
    const url = locationTaxonomyIconUrl(kind, row);
    if (url) urls[row.name] = url;
  }
  return urls;
}

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
      // The category and tag rows carry the icon mime types the Statistics
      // lists need — the top-N queries return names and counts only, so icons
      // are matched back by name. The entry form's dropdowns used to be fed
      // from the same reads; that form is the New Journal Entry section now.
      const categories = listCategories(deps.journalRepo);
      const tags = listTags(deps.journalRepo);
      return (
        <JournalView
          entries={listRecentEntries(deps.journalRepo, RECENT_JOURNAL_ENTRY_LIMIT)}
          topTags={listTopTags(deps.journalRepo, TOP_TAXONOMY_LIMIT)}
          topCategories={listTopCategories(deps.journalRepo, TOP_TAXONOMY_LIMIT)}
          categoryIcons={Object.fromEntries(journalTaxonomyIconUrlsByName("category", categories))}
          tagIcons={Object.fromEntries(journalTaxonomyIconUrlsByName("tag", tags))}
          canRunSql={isAdmin}
        />
      );
    }

    case "new-entry": {
      // The form needs the managed category and tag names for its dropdowns, the
      // preferences for which fields it shows, the enabled templates for its
      // prefill picker, and the location library's own taxonomy for the filter
      // chips on the location picker's "From location database" tab.
      const journalModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);
      const preferences = resolveJournalPreferences(
        journalModule ? listModuleSettingsFor(deps.moduleSettingsRepo, journalModule.id) : [],
      );
      return (
        <JournalNewEntryView
          categoryOptions={listCategories(deps.journalRepo).map((category) => category.name)}
          tagOptions={listTags(deps.journalRepo).map((tag) => tag.name)}
          preferences={preferences}
          prefillTemplates={listEnabledPrefillTemplates(deps.journalRepo)}
          locationCategoryOptions={listLocationCategories(deps.savedLocationRepo).map(
            (row) => row.name,
          )}
          locationTagOptions={listLocationTags(deps.savedLocationRepo).map((row) => row.name)}
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
      // The Correct tab is a server panel handed over as a slot: it reads the
      // whole journal to group duplicates, which the client importer can't do.
      return (
        <JournalImportView
          namedMappings={listNamedMappings(deps.csvImportMappingRepo, "Journal")}
          correctSlot={<JournalCorrectPanel />}
        />
      );

    case "calendar-import": {
      // The managed lists feed the preset fields' autocomplete. Read here on the
      // server, like every other section's data.
      //
      // The preferences come along for one flag: whether importing pauses to show
      // what the journal already holds on each date. Same three lines the
      // `configuration` case below uses.
      const calendarImportModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);
      const calendarImportPreferences = resolveJournalPreferences(
        calendarImportModule
          ? listModuleSettingsFor(deps.moduleSettingsRepo, calendarImportModule.id)
          : [],
      );
      return (
        <JournalCalendarImportView
          categories={listCategories(deps.journalRepo)}
          tags={listTags(deps.journalRepo)}
          reviewBeforeImport={calendarImportPreferences.reviewBeforeCalendarImport}
        />
      );
    }

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
      //
      // The restore card sits below it, and is collapsed by default: it's the
      // rare half of the backup pair, and an always-open dropzone above the
      // lists would push the thing the reader actually came for down the page.
      // The download half is the title bar's button — see `sectionAction`.
      return (
        <div className="space-y-6">
          <CollapsibleCard title="Categories & Tags" defaultOpen>
            <JournalTaxonomyView
              categories={listCategories(deps.journalRepo)}
              tags={listTags(deps.journalRepo)}
            />
          </CollapsibleCard>
          <JournalMetadataRestoreCard />
        </div>
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

    case "locations": {
      // The counts feed the filter chips; the manager needs only the names, but
      // reading them from the same two calls keeps this screen and the Meta Data
      // one from disagreeing about which lists exist.
      return (
        <JournalLocationsView
          locations={listSavedLocations(deps.savedLocationRepo)}
          categoryOptions={countLocationsByCategory(deps.savedLocationRepo).map((row) => row.name)}
          tagOptions={countLocationsByTag(deps.savedLocationRepo).map((row) => row.name)}
          categoryIcons={locationIconMap("category")}
          tagIcons={locationIconMap("tag")}
        />
      );
    }

    case "location-map":
      // The same list the manager reads. The map filters it down client-side
      // through the search action, so the server hands over the unfiltered set
      // once rather than on every chip.
      return (
        <JournalLocationMapView
          locations={listSavedLocations(deps.savedLocationRepo)}
          categoryOptions={countLocationsByCategory(deps.savedLocationRepo).map((row) => row.name)}
          tagOptions={countLocationsByTag(deps.savedLocationRepo).map((row) => row.name)}
          categoryIcons={locationIconMap("category")}
          tagIcons={locationIconMap("tag")}
        />
      );

    case "location-metadata": {
      // The editor wants both halves: the descriptions (from the taxonomy rows)
      // and the usage counts (from the count queries). Joined here by name
      // rather than in a third repository method, since this is the only screen
      // that needs them together.
      // iconMimeType and updatedAt ride along so the list can build each row's
      // icon URL — the mime type says whether there *is* one, updatedAt busts
      // the cache when it's replaced. The bytes stay behind the route.
      const withCounts = (
        rows: {
          name: string;
          description: string;
          iconMimeType?: string;
          updatedAt: string;
        }[],
        counts: { name: string; count: number }[],
      ) =>
        rows.map((row) => ({
          name: row.name,
          description: row.description,
          iconMimeType: row.iconMimeType,
          updatedAt: row.updatedAt,
          count: counts.find((entry) => entry.name === row.name)?.count ?? 0,
        }));
      // In a card, open by default — the same presentation the entry-side
      // Categories & Tags editor gets, since it is the same kind of screen.
      return (
        <CollapsibleCard title="Location categories & tags" defaultOpen>
          <JournalLocationTaxonomyView
            categories={withCounts(
              listLocationCategories(deps.savedLocationRepo),
              countLocationsByCategory(deps.savedLocationRepo),
            )}
            tags={withCounts(
              listLocationTags(deps.savedLocationRepo),
              countLocationsByTag(deps.savedLocationRepo),
            )}
          />
        </CollapsibleCard>
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
      {/* The home screen keeps its own header component for the search button
          and the results panel it reveals. It no longer takes the body as
          `children` — that was only so it could own the New Journal card's
          open/closed state, and the card is its own section now. */}
      {section === "main" ? (
        <JournalHomeHeader label={info.label} description={info.description} />
      ) : (
        // Title on the left, the section's own action on the right. Wraps and
        // goes full-width under 1024px, so the button drops below the
        // description rather than squeezing the heading. Sections with no
        // action render exactly as they did before this row existed.
        <>
          <div className="flex items-start justify-between gap-4 max-lg:flex-wrap">
            <div className="min-w-0">
              <h2 className="font-display text-2xl font-semibold text-ink">{info.label}</h2>
              <p className="mt-1 text-sm text-muted">{info.description}</p>
            </div>
            {section === "metadata" && <JournalMetadataBackupButton />}
          </div>
          <div className="mt-3 h-px w-full bg-line" />
        </>
      )}
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
    </JournalShell>
  );
}
