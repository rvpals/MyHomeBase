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
  cloneSeedFromEntry,
  countAllEntries,
  countEntriesByYearAndMonth,
  countEntriesPerSavedLocation,
  hasLinkedEntries,
  getEntry,
  listCategories,
  listEntries,
  listEnabledPrefillTemplates,
  listPrefillSuggestions,
  listPrefillTemplates,
  listPinnedEntries,
  listRecentEntries,
  listRecentlyEditedEntries,
  listTags,
  listTopCategories,
  listTopTags,
  getJournalHomeWidgets,
  visibleJournalHomeWidgets,
  topWords,
  resolveJournalPreferences,
  type JournalEntryCloneSeed,
  type JournalPrefillField,
} from "@/lib/journal";
// The entry form's location picker offers these names as filter chips. They
// come from the application-wide library (migration 0140) now that the
// journal's own jrn_location* tables are gone (0141).
import {
  listLocationCategories,
  listLocationTags,
  listSavedLocations,
} from "@/lib/sys-locations";
import {
  getReportWithDetails,
  listReports,
  reportDocument,
  reportFileName,
  runReport,
} from "@/lib/journal-reports";
// Topics: pure matching over the entries this branch reads. Nothing in here
// touches the database or the settings — the two preferences that steer it are
// resolved above and passed in.
import {
  buildCooccurrence,
  buildEpisodes,
  buildTopicMap,
  matchTopic,
  suggestTopics,
} from "@/lib/journal-topics";
// The entry form's Content background is a pointer into the app texture
// library, so the Preferences screen needs the library to draw its picker.
import { listDashboardTextures } from "@/lib/dashboard-texture";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { deps } from "@/lib/wiring";
import { requireUser } from "../../require-access";
import { JOURNAL_SECTION_INFO, type JournalSection } from "./journal-sections";
import { JournalCalendarPanel } from "./journal-calendar-panel";
import { JournalTopicsView } from "./journal-topics-view";
import { JournalEntriesPanel } from "./journal-entries-panel";
import { journalTaxonomyIconUrlsByName } from "./journal-shared";
// The same name -> icon-URL map the Location Manager builds, reused rather than
// rebuilt: these are the same taxonomy rows behind the same icon routes.
import { locationTaxonomyIconMap } from "@/app/(protected)/admin/locations/icon-map";
import { JournalSavedLocationsView } from "./journal-saved-locations-view";
import { JournalShell } from "./journal-shell";
import { JournalHomeHeader } from "./journal-search-view";
import { JournalCorrectPanel } from "./journal-correct-panel";
import { JournalCalendarImportView } from "./journal-calendar-import-view";
import { JournalImportView } from "./journal-import-view";
import {
  JournalMetadataBackupButton,
  JournalMetadataRestoreCard,
} from "./journal-metadata-transfer-view";
import { JournalHomeScreenView } from "./journal-home-screen-view";
import { JournalNewEntryView } from "./journal-new-entry-view";
import { JournalPreferencesView } from "./journal-preferences-view";
import { JournalReportEditor } from "./journal-report-editor";
import { JournalReportRunView } from "./journal-report-run-view";
import { JournalReportsView } from "./journal-reports-view";
import { JournalReviewPanel } from "./journal-review-panel";
import { JournalTaxonomyView } from "./journal-taxonomy-view";
import { JournalTemplatesView } from "./journal-templates-view";
import { JournalView } from "./journal-view";

const JOURNAL_MODULE_SLUG = "journal";
const RECENT_JOURNAL_ENTRY_LIMIT = 25;
const TOP_TAXONOMY_LIMIT = 10;
// The Top Words figure is the reader's own, from `topWordLimit` in the module's
// preferences — no constant here. Scanning every entry's text is the cost of the
// card either way: there is no cache, so it is recomputed per render, and the
// limit only decides how much of the ranking survives the final slice.

/**
 * How many tags and how many categories the Topics picker offers.
 *
 * Generous rather than ten: this is a browse list the reader scans for a
 * subject, not a home-screen summary, and the view filters it down as they
 * type.
 */
const TOPIC_SUGGESTION_LIMIT = 50;

function SectionBody({
  section,
  isAdmin,
  userId,
  filterQuery,
  requestedTab,
  calendarScope,
  calendarAnchor,
  selectedDate,
  requestedReportEdit,
  requestedReportRun,
  requestedTopic,
  requestedCloneId,
}: {
  section: JournalSection;
  isAdmin: boolean;
  /** The signed-in reader — whose home screen layout the main and home-screen sections read. */
  userId: number;
  /** From ?filter= — an ad-hoc filter query for the Entries section. */
  filterQuery?: string;
  /** From ?tab= — which Entries tab to open on: "main", "unlocked" or "log". */
  requestedTab?: string;
  /** From ?scope=/?anchor=/?date= — which period the Calendar shows, and the
   *  day whose entries are listed under it. */
  calendarScope?: string;
  calendarAnchor?: string;
  selectedDate?: string;
  /** From ?edit= — which report the Report section is editing, or "new". */
  requestedReportEdit?: string;
  /** From ?run= — which report the Report section is running. */
  requestedReportRun?: string;
  /**
   * From ?topic= — the subject the Topics section is showing.
   *
   * A topic is not a stored row, so this param IS the lookup: blank renders
   * the picker rather than 404ing, which is what lets any tag chip in the app
   * link here without knowing whether the term will match anything.
   */
  requestedTopic?: string;
  /**
   * From ?clone= — the entry the New Entry section is cloning.
   *
   * Already validated as a positive integer by the route; an id that no longer
   * names an entry is treated as absent here rather than as an error, so a
   * stale link (the source was deleted, or the reader edited the URL) opens the
   * ordinary blank form instead of 404ing a page that is perfectly usable
   * without the seed.
   */
  requestedCloneId?: number;
}) {
  switch (section) {
    case "main": {
      // The category and tag rows carry the icon mime types the Statistics
      // lists need — the top-N queries return names and counts only, so icons
      // are matched back by name. The entry form's dropdowns used to be fed
      // from the same reads; that form is the New Journal Entry section now.
      const categories = listCategories(deps.journalRepo);
      const tags = listTags(deps.journalRepo);
      // The word ranking honours the reader's dismissals, which live with the
      // module's other preferences rather than in a table of their own.
      const homeModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);
      const homePreferences = resolveJournalPreferences(
        homeModule ? listModuleSettingsFor(deps.moduleSettingsRepo, homeModule.id) : [],
      );
      // Read once and reused below, so the Pinned Entries card can skip its own query
      // when the reader has switched that card off — the same rule the app home screen
      // applies to its cards.
      const homeWidgets = getJournalHomeWidgets(deps.userPreferencesRepo, userId);
      // `topWordLimit` is passed as well as applied to `topWords` below,
      // because the card names its own figure in the heading. The ranked list
      // can be shorter than the limit — a small journal may not have that many
      // distinct words — so the heading has to come from the setting rather
      // than from `topWords.length`, or it would quietly rename itself on a
      // thin journal.
      return (
        <JournalView
          entries={listRecentEntries(deps.journalRepo, RECENT_JOURNAL_ENTRY_LIMIT)}
          tally={countAllEntries(deps.journalRepo)}
          topWords={topWords(
            listEntries(deps.journalRepo),
            homePreferences.topWordLimit,
            homePreferences.excludedWords,
          )}
          topWordLimit={homePreferences.topWordLimit}
          topTags={listTopTags(deps.journalRepo, TOP_TAXONOMY_LIMIT)}
          topCategories={listTopCategories(deps.journalRepo, TOP_TAXONOMY_LIMIT)}
          yearAndMonthCounts={countEntriesByYearAndMonth(deps.journalRepo)}
          pinnedEntries={
            visibleJournalHomeWidgets(homeWidgets).includes("pinnedAndRecentlyEdited")
              ? listPinnedEntries(deps.journalRepo)
              : []
          }
          recentlyEditedEntries={
            // Both tabs live in one card, so one visibility check gates both reads.
            visibleJournalHomeWidgets(homeWidgets).includes("pinnedAndRecentlyEdited")
              ? listRecentlyEditedEntries(deps.journalRepo)
              : []
          }
          categoryIcons={Object.fromEntries(journalTaxonomyIconUrlsByName("category", categories))}
          tagIcons={Object.fromEntries(journalTaxonomyIconUrlsByName("tag", tags))}
          canRunSql={isAdmin}
          widgets={homeWidgets}
        />
      );
    }

    case "home-screen":
      return <JournalHomeScreenView widgets={getJournalHomeWidgets(deps.userPreferencesRepo, userId)} />;

    case "new-entry": {
      // The form needs the managed category and tag names for its dropdowns, the
      // preferences for which fields it shows, the enabled templates for its
      // prefill picker, and the location library's own taxonomy for the filter
      // chips on the location picker's "From location database" tab.
      const journalModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);
      const preferences = resolveJournalPreferences(
        journalModule ? listModuleSettingsFor(deps.moduleSettingsRepo, journalModule.id) : [],
      );
      // Cloning (?clone=): the seed is built here, on the server, from a fresh
      // read of the source entry — so the form starts from what that entry says
      // now, and nothing about it had to travel in the URL.
      //
      // A missing entry yields no seed and the blank form renders, per the prop's
      // note. A *sealed* entry yields no seed either: `getEntry` returns its title
      // and content as "" with the real text in the encrypted columns, so cloning
      // one from a link would silently produce an entry missing its headline. The
      // viewer never offers Clone on a sealed entry anyway (the unlock prompt
      // renders in place of the toolbar), so this only closes the hand-edited-URL
      // path — and it closes it by falling back to a blank form, not by failing.
      let cloneSeed: JournalEntryCloneSeed | undefined;
      if (requestedCloneId !== undefined) {
        const source = getEntry(deps.journalRepo, requestedCloneId);
        if (source && !source.isEncrypted) cloneSeed = cloneSeedFromEntry(source);
      }
      return (
        <JournalNewEntryView
          cloneSeed={cloneSeed}
          categoryOptions={listCategories(deps.journalRepo).map((category) => category.name)}
          tagOptions={listTags(deps.journalRepo).map((tag) => tag.name)}
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

    case "entries":
      // ?filter= (set by the Top Tags/Categories cards) pre-selects a slice;
      // without it this lists everything and the reader picks from the dropdown.
      // ?tab=log (set by the Statistics card's Log tile) opens on the Log tab
      // and ?tab=main on All Entries; anything else opens on Unlocked Entries,
      // the first tab — ?filter= only ever narrows the grid tabs.
      return (
        <JournalEntriesPanel
          filterQuery={filterQuery}
          initialTab={requestedTab}
          canRunSql={isAdmin}
        />
      );

    case "saved-locations": {
      // The library is Admin -> Locations' to own; this screen only reads it.
      // `listSavedLocations` returns SavedLocationWithUsage, whose usageCount is
      // still the hardcoded 0 -- the real count comes from the journal's own
      // read below, because the library may not name a module's tables.
      const savedPlaces = listSavedLocations(deps.sysLocationRepo);
      const usage = countEntriesPerSavedLocation(
        deps.journalRepo,
        savedPlaces.map((place) => place.id),
      );
      const entryCounts = Object.fromEntries(
        usage.map((row) => [row.savedLocationId, row.entryCount]),
      );

      const locationCategories = listLocationCategories(deps.sysLocationRepo);
      const locationTags = listLocationTags(deps.sysLocationRepo);

      return (
        <JournalSavedLocationsView
          places={savedPlaces}
          entryCounts={entryCounts}
          hasLinkedEntries={hasLinkedEntries(deps.journalRepo)}
          categoryOptions={locationCategories.map((item) => item.name)}
          tagOptions={locationTags.map((item) => item.name)}
          categoryIcons={locationTaxonomyIconMap("category")}
          tagIcons={locationTaxonomyIconMap("tag")}
          basePath="/modules/journal/saved-locations"
        />
      );
    }

    case "topics": {
      // The whole journal, because a topic is a question about all of it —
      // there is no narrowing read that could answer "which entries are about
      // HSA" without first matching every entry's tags, categories and title.
      //
      // The matching itself is pure and lives in `@/lib/journal-topics`; this
      // branch only supplies the rows and the two preferences that steer it.
      const topicsModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);
      const topicsPreferences = resolveJournalPreferences(
        topicsModule ? listModuleSettingsFor(deps.moduleSettingsRepo, topicsModule.id) : [],
      );

      const term = (requestedTopic ?? "").trim();
      // Read once, used for whichever of the two views this is: the map before
      // a term is picked, the match after. Both need every entry — the map to
      // count pairings, the match because any entry might be about the term.
      const allEntries = listEntries(deps.journalRepo);
      const result = matchTopic(allEntries, term, {
        matchBody: topicsPreferences.topicMatchBody,
      });

      return (
        <JournalTopicsView
          term={term}
          result={result}
          episodes={buildEpisodes(result.entries, topicsPreferences.topicEpisodeGapDays)}
          related={buildCooccurrence(result.entries, { exclude: result.matchedNames })}
          // The picker's candidates. Read even when a term is set, so the
          // reader can jump straight to another topic without clearing first.
          suggestions={suggestTopics(
            listTopTags(deps.journalRepo, TOPIC_SUGGESTION_LIMIT),
            listTopCategories(deps.journalRepo, TOPIC_SUGGESTION_LIMIT),
          )}
          // Only when no term is picked: the map is not drawn alongside a
          // topic's results, so building it there would be work nothing shows.
          map={term === "" ? buildTopicMap(allEntries) : null}
          matchBody={topicsPreferences.topicMatchBody}
          episodeGapDays={topicsPreferences.topicEpisodeGapDays}
          basePath="/modules/journal/topics"
        />
      );
    }

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

    case "recycle-bin":
      // The same view the Correct tab renders, with the Duplicates card off.
      // Deleting an entry has always moved it here; until this section existed
      // the only way back was CSV Import → Correct, which no reader would guess.
      return <JournalCorrectPanel show="recycled" />;

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

    case "review-data":
      // A server panel, like the Correct tab's: grouping the dates that carry
      // more than one entry is a whole-journal read, which the client view
      // can't do. Everything the merge dialog's entry form needs is read there
      // too, so this case stays one line.
      return <JournalReviewPanel />;

    case "configuration": {
      const journalModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);
      const preferences = resolveJournalPreferences(
        journalModule ? listModuleSettingsFor(deps.moduleSettingsRepo, journalModule.id) : [],
      );
      return (
        <JournalPreferencesView
          preferences={preferences}
          textures={listDashboardTextures(deps.dashboardTextureRepo)}
        />
      );
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

    case "report": {
      // Three screens behind one route, chosen by the query string: the list,
      // the editor (?edit=), and a run report (?run=). In the URL rather than
      // client state so each is linkable and survives a refresh — the same
      // reasoning ?filter= uses on the Entries section.
      //
      // `isAdmin` gates the raw-SQL toggle in the editor. That is presentation
      // only: the actual guard is `requireAdmin()` inside the save and preview
      // actions, because an action is its own POST endpoint and a hidden
      // control protects nothing.
      if (requestedReportRun) {
        const id = Number(requestedReportRun);
        const loaded = Number.isFinite(id) ? getReportWithDetails(id, deps.journalReportRepo) : undefined;
        // A stale ?run= falls back to the list rather than 404ing.
        if (loaded) {
          // Same three lines every other section uses: the module row, its
          // settings, then resolve. `resolveJournalPreferences` takes the
          // settings list, not a repository.
          const reportModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);
          const reportPreferences = resolveJournalPreferences(
            reportModule ? listModuleSettingsFor(deps.moduleSettingsRepo, reportModule.id) : [],
          );
          try {
            const result = runReport(loaded.report.id, deps.journalReportRepo, {
              dismissedWords: reportPreferences.excludedWords,
            });
            return (
              <JournalReportRunView
                report={loaded.report}
                html={result.html}
                entryCount={result.entryCount}
                document={reportDocument(loaded.report.name, result.html)}
                fileName={reportFileName(loaded.report.name)}
              />
            );
          } catch (error) {
            // A bad filter query or SQL fragment. Rendered as the report's own
            // error with a link to fix it, rather than an error boundary that
            // says nothing about which report broke.
            return (
              <JournalReportRunView
                report={loaded.report}
                error={error instanceof Error ? error.message : "The report could not be run."}
              />
            );
          }
        }
      }

      if (requestedReportEdit) {
        if (requestedReportEdit === "new") {
          return <JournalReportEditor canUseSql={isAdmin} />;
        }
        const id = Number(requestedReportEdit);
        const loaded = Number.isFinite(id) ? getReportWithDetails(id, deps.journalReportRepo) : undefined;
        if (loaded) {
          return (
            <JournalReportEditor
              report={loaded.report}
              details={loaded.details}
              canUseSql={isAdmin}
            />
          );
        }
      }

      return (
        <JournalReportsView reports={listReports(deps.journalReportRepo)} canUseSql={isAdmin} />
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
  requestedTab,
  calendarScope,
  calendarAnchor,
  selectedDate,
  requestedReportEdit,
  requestedReportRun,
  requestedTopic,
  requestedCloneId,
}: {
  section: JournalSection;
  isAdmin: boolean;
  filterQuery?: string;
  requestedTab?: string;
  calendarScope?: string;
  calendarAnchor?: string;
  selectedDate?: string;
  requestedReportEdit?: string;
  requestedReportRun?: string;
  requestedTopic?: string;
  /** From ?clone= — the entry the New Entry section seeds itself from. */
  requestedCloneId?: number;
}) {
  // Defensive: an unknown section would otherwise crash on info.label. The route
  // already validates, so this only catches a future caller getting it wrong.
  const info = JOURNAL_SECTION_INFO[section] ?? JOURNAL_SECTION_INFO.main;
  const currentUser = await requireUser();

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
          userId={currentUser.id}
          filterQuery={filterQuery}
          requestedTab={requestedTab}
          calendarScope={calendarScope}
          calendarAnchor={calendarAnchor}
          selectedDate={selectedDate}
          requestedReportEdit={requestedReportEdit}
          requestedReportRun={requestedReportRun}
          requestedTopic={requestedTopic}
          requestedCloneId={requestedCloneId}
        />
      </div>
    </JournalShell>
  );
}
