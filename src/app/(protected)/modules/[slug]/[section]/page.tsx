import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getModuleBySlug } from "@/lib/modules";
import { isAdmin, userHasModuleAccess } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { PAGE_CONTAINER } from "../../../page-container";
import { ClassroomSection } from "../classroom-section";
import { isClassroomSection } from "../classroom-sections";
import { CsvSection } from "../csv-section";
import { isCsvSection } from "../csv-sections";
import { ExpenseSection } from "../expense-section";
import { isExpenseSection } from "../expense-sections";
import { GallerySection } from "../gallery-section";
import { isGallerySection } from "../gallery-sections";
import { GamesSection } from "../games-section";
import { isGamesSection } from "../games-sections";
import { isJournalSection } from "../journal-sections";
import { MusicSection } from "../music-section";
import { isMusicSection } from "../music-sections";
import { JournalSection } from "../journal-section";
import { StockSection } from "../stock-section";
import { isStockSection } from "../stock-sections";
import { ToolsSection } from "../tools-section";
import { isToolsSection } from "../tools-sections";
import { ClipsSection } from "../clips-section";
import { isClipsSection } from "../clips-sections";
import { DocumentsSection } from "../documents-section";
import { isDocumentsEditorRoute, isDocumentsSection } from "../documents-sections";
import { HouseholdSection } from "../household-section";
import { isHouseholdSection } from "../household-sections";

const CLASSROOM_MODULE_SLUG = "classroom";
/**
 * The slug Classroom carried until migration 0143. Kept only to redirect: every
 * attendance section kept its own slug, so `/modules/attendance/report` maps
 * one-for-one onto `/modules/classroom/report` and a bookmark survives.
 */
const RETIRED_ATTENDANCE_SLUG = "attendance";
const CSV_ANALYSIS_MODULE_SLUG = "csv-analysis";
const EXPENSE_MODULE_SLUG = "expense";
const GAMES_MODULE_SLUG = "games";
const JOURNAL_MODULE_SLUG = "journal";
const MUSIC_LIBRARY_MODULE_SLUG = "music-library";
const PICTURE_GALLERY_MODULE_SLUG = "picture-gallery";
const INVESTMENTS_MODULE_SLUG = "investments";
const TOOLS_MODULE_SLUG = "tools";
const HOUSEHOLD_MODULE_SLUG = "household";
const CLIPS_MODULE_SLUG = "clips";
const DOCUMENTS_MODULE_SLUG = "documents";

/**
 * A module's sub-section, e.g. /modules/expense/transactions or
 * /modules/investments/positions.
 *
 * Nested under the dynamic [slug] segment on purpose: a static `expense` folder
 * would shadow /modules/[slug] and break the module page itself. Only the modules
 * listed here have sections; anything else 404s.
 *
 * Each module validates its own section names, so an Expense section name can't be
 * reached under the Stocks slug (or vice versa) — that would render a nav pointing
 * at routes the other module doesn't have.
 */
function renderSection(
  slug: string,
  section: string,
  isAdmin: boolean,
  filterQuery: string | undefined,
  requestedClassId: number | undefined,
  requestedDate: string | undefined,
  requestedFormat: string | undefined,
  calendarScope: string | undefined,
  calendarAnchor: string | undefined,
  prefillRuleName: string | undefined,
  prefillRuleDescription: string | undefined,
  prefillRulePattern: string | undefined,
  requestedGroupBy: string | undefined,
  requestedGroupKey: string | undefined,
  requestedTicker: string | undefined,
  requestedLots: string | undefined,
  requestedTickerLots: string | undefined,
  requestedSeedTickers: string | undefined,
  recipeSearch: string | undefined,
  recipeCategory: string | undefined,
  recipeTag: string | undefined,
  requestedTab: string | undefined,
  requestedReportEdit: string | undefined,
  requestedReportRun: string | undefined,
  requestedTopic: string | undefined,
  requestedCloneId: number | undefined,
) {
  if (slug === CLASSROOM_MODULE_SLUG && isClassroomSection(section)) {
    return (
      <ClassroomSection
        section={section}
        requestedClassId={requestedClassId}
        requestedDate={requestedDate}
        requestedFormat={requestedFormat}
        // The same ?edit= the Journal report editor uses — one param meaning "open
        // this record for editing", not a second one spelled differently.
        requestedExamEdit={requestedReportEdit}
      />
    );
  }
  if (slug === CSV_ANALYSIS_MODULE_SLUG && isCsvSection(section)) {
    return <CsvSection section={section} />;
  }
  if (slug === EXPENSE_MODULE_SLUG && isExpenseSection(section)) {
    return (
      <ExpenseSection
        section={section}
        prefillRuleName={prefillRuleName}
        prefillRuleDescription={prefillRuleDescription}
        prefillRulePattern={prefillRulePattern}
        requestedGroupBy={requestedGroupBy}
        requestedGroupKey={requestedGroupKey}
      />
    );
  }
  // Double-gated on the slug AND this module's own section names, so a Games
  // section name cannot resolve under another module's slug.
  if (slug === GAMES_MODULE_SLUG && isGamesSection(section)) {
    return <GamesSection section={section} />;
  }
  if (slug === JOURNAL_MODULE_SLUG && isJournalSection(section)) {
    return (
      <JournalSection
        section={section}
        isAdmin={isAdmin}
        filterQuery={filterQuery}
        requestedTab={requestedTab}
        calendarScope={calendarScope}
        calendarAnchor={calendarAnchor}
        // ?date= is shared with the Classroom attendance report rather than given a second
        // name: both mean "the day this screen is showing".
        selectedDate={requestedDate}
        requestedReportEdit={requestedReportEdit}
        requestedReportRun={requestedReportRun}
        requestedTopic={requestedTopic}
        requestedCloneId={requestedCloneId}
      />
    );
  }
  if (slug === MUSIC_LIBRARY_MODULE_SLUG && isMusicSection(section)) {
    return <MusicSection section={section} />;
  }
  if (slug === PICTURE_GALLERY_MODULE_SLUG && isGallerySection(section)) {
    return <GallerySection section={section} />;
  }
  if (slug === TOOLS_MODULE_SLUG && isToolsSection(section)) {
    return <ToolsSection section={section} />;
  }
  if (slug === HOUSEHOLD_MODULE_SLUG && isHouseholdSection(section)) {
    return (
      <HouseholdSection
        section={section}
        isAdmin={isAdmin}
        search={recipeSearch}
        category={recipeCategory}
        tag={recipeTag}
      />
    );
  }
  // Reuses the `search`/`category`/`tag` params the Household branch above reads:
  // both modules filter a list by the same three things, and a second set of names
  // for the same idea would only make a URL harder to read. Clips parses them with
  // its own `clipFilterSchema`, so a stale value narrows the list to nothing rather
  // than 404ing.
  if (slug === CLIPS_MODULE_SLUG && isClipsSection(section)) {
    return (
      <ClipsSection
        section={section}
        search={recipeSearch}
        category={recipeCategory}
        tag={recipeTag}
        // The same ?tab= Journal's Entries screen reads — "which tab of this screen
        // is open", not a second name for the same idea.
        requestedTab={requestedTab}
        isAdmin={isAdmin}
      />
    );
  }
  // Both the three nav sections and the two editor routes (`new`, `edit`), which are
  // not sections: they are where the form opens, so they carry no nav row and no icon
  // slot. Gated on the slug AND on this module's own guards, so one module's section
  // name can never resolve under another module's slug.
  if (
    slug === DOCUMENTS_MODULE_SLUG &&
    (isDocumentsSection(section) || isDocumentsEditorRoute(section))
  ) {
    return (
      <DocumentsSection
        view={section}
        // The same three filter params Household and Clips read.
        search={recipeSearch}
        category={recipeCategory}
        tag={recipeTag}
        // The same ?edit= the Journal report and Classroom exam editors use — one
        // param meaning "open this record for editing".
        documentId={Number(requestedReportEdit) || undefined}
        isAdmin={isAdmin}
      />
    );
  }
  if (slug === INVESTMENTS_MODULE_SLUG && isStockSection(section)) {
    return (
      <StockSection
        section={section}
        requestedTicker={requestedTicker}
        requestedLots={requestedLots}
        requestedTickerLots={requestedTickerLots}
        requestedSeedTickers={requestedSeedTickers}
      />
    );
  }
  return undefined;
}

export default async function ModuleSectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; section: string }>;
  // `filter` carries a journal filter query, so a filtered entry list is a real
  // URL — linkable, shareable, and surviving a refresh or a back button. That's
  // why the Top Tags/Categories cards link here rather than pushing client state.
  // `classId`/`date` do the same job for the Classroom attendance report, and `date` is
  // reused by the Journal calendar for the day whose entries are listed.
  // `scope`/`anchor` carry which calendar period is on screen, so a month (or a
  // year, or one week) is a bookmarkable URL.
  searchParams: Promise<{
    filter?: string | string[];
    classId?: string | string[];
    date?: string | string[];
    format?: string | string[];
    scope?: string | string[];
    anchor?: string | string[];
    // `name`/`description` seed a new Expense transaction rule, so "add a rule
    // for this" can be a plain link that arrives with the form already filled.
    name?: string | string[];
    description?: string | string[];
    // The raw statement line to match on, seeding the rule's pattern field.
    vendorDescription?: string | string[];
    // Which grouping the Expense Transactions screen opens on, and which group
    // starts expanded. Set by the Meta Data cards, so clicking a category or a
    // vendor lands on just its rows.
    groupBy?: string | string[];
    group?: string | string[];
    // Which ticker the Tax Lots analyzer is showing, so one position's lot
    // breakdown is a bookmarkable URL rather than client state.
    ticker?: string | string[];
    // An encoded set of transactions for the Tax Lots analyzer to score without
    // storing them — set by the ticker viewer's Calculate Tax Lots button. In the
    // URL rather than client state because the ad-hoc analysis persists nowhere
    // else: the link IS the saved analysis.
    lots?: string | string[];
    // Several tickers, each with its own encoded lots — an edited multi-ticker
    // selection, so a refresh reproduces exactly what was on screen.
    tickers?: string | string[];
    // A comma-separated symbol list whose lots are built from the recorded buys.
    // What the "Add by tickers" picker emits: short, and always current with the
    // ledger rather than a snapshot of it.
    seedTickers?: string | string[];
    // The recipe list's filters, so a filtered box is a real URL — bookmarkable and
    // sendable, rather than client state that a refresh throws away.
    search?: string | string[];
    category?: string | string[];
    tag?: string | string[];
    // Which tab a tabbed section opens on — Journal's Entries (Main / Log) is
    // the only reader so far. Left raw: the view falls back to its first tab on
    // a key it doesn't know, so a stale link lands somewhere sensible.
    tab?: string | string[];
    // Which Journal report the Report section is editing (`new` for a fresh
    // one) or running. In the URL rather than client state so an editor and a
    // run are both linkable and survive a refresh -- the same reasoning
    // ?filter= uses.
    edit?: string | string[];
    run?: string | string[];
    // The subject the Journal's Topics section is showing. In the URL rather
    // than client state because that is the entire state of a topic: a topic is
    // not a stored row, so `?topic=HSA` IS the saved lookup — bookmarkable,
    // sendable, and linkable from any tag chip elsewhere in the app. Left raw:
    // the section renders its picker for a blank or unmatched term rather than
    // 404ing, the same forgiving rule `?tab=` follows.
    topic?: string | string[];
    // The entry Journal's New Entry section is cloning — set by the Clone button
    // in the entry viewer's toolbar. Only the id travels: the section re-reads
    // the entry server-side, so none of its text is in the URL and the seed is
    // whatever the entry says *now* rather than a snapshot from when the link
    // was made. That also makes the clone form reloadable and bookmarkable, the
    // same reasoning ?filter= and ?topic= follow.
    clone?: string | string[];
  }>;
}) {
  const { slug, section } = await params;
  const {
    filter,
    classId,
    date,
    format,
    scope,
    anchor,
    name,
    description,
    vendorDescription,
    groupBy,
    group,
    ticker,
    lots,
    tickers,
    seedTickers,
    search,
    category,
    tag,
    tab,
    edit,
    run,
    topic,
    clone,
  } = await searchParams;
  // A repeated ?filter= yields an array; take the first rather than joining, so a
  // crafted URL can't smuggle a second expression in.
  const filterQuery = Array.isArray(filter) ? filter[0] : filter;
  const rawClassId = Array.isArray(classId) ? classId[0] : classId;
  const requestedClassId = Number(rawClassId) || undefined;
  const requestedDate = Array.isArray(date) ? date[0] : date;
  // Which report shape to render. Left as a raw string here -- the section
  // validates it against ATTENDANCE_REPORT_FORMATS, so an unknown value falls
  // back to "brief" rather than 404ing a legitimate URL.
  const requestedFormat = Array.isArray(format) ? format[0] : format;
  // Same first-element rule as ?filter=: a repeated param must not concatenate
  // into a value neither branch would accept.
  const calendarScope = Array.isArray(scope) ? scope[0] : scope;
  const calendarAnchor = Array.isArray(anchor) ? anchor[0] : anchor;
  // Same first-element rule again: a repeated ?name= must not concatenate.
  const prefillRuleName = Array.isArray(name) ? name[0] : name;
  const prefillRuleDescription = Array.isArray(description) ? description[0] : description;
  const prefillRulePattern = Array.isArray(vendorDescription)
    ? vendorDescription[0]
    : vendorDescription;
  // Same first-element rule once more. Both stay raw strings: the Transactions
  // view validates the grouping against TRANSACTION_GROUP_BYS and matches the
  // key against the groups it actually built, so a stale or crafted URL falls
  // back to the ungrouped list rather than 404ing.
  // Same first-element rule, and both stay raw strings: the Report section
  // resolves each against the reports that actually exist, so a stale link lands
  // on the list rather than 404ing.
  const requestedReportEdit = Array.isArray(edit) ? edit[0] : edit;
  const requestedReportRun = Array.isArray(run) ? run[0] : run;
  const requestedGroupBy = Array.isArray(groupBy) ? groupBy[0] : groupBy;
  const requestedGroupKey = Array.isArray(group) ? group[0] : group;
  // Same first-element rule. Left raw: the section resolves it against the
  // tickers that actually have lots, so a stale URL falls back to the first
  // stored ticker rather than 404ing.
  const requestedTicker = Array.isArray(ticker) ? ticker[0] : ticker;
  // Same first-element rule. Also left raw: the section decodes it with the Tax
  // Lots module's own function, and an unusable payload falls back to the stored
  // lots rather than 404ing.
  const requestedLots = Array.isArray(lots) ? lots[0] : lots;
  // Same first-element rule, same fallback: the section decodes both and drops to
  // the stored view on anything it can't use.
  const requestedTickerLots = Array.isArray(tickers) ? tickers[0] : tickers;
  const requestedSeedTickers = Array.isArray(seedTickers) ? seedTickers[0] : seedTickers;
  // Same first-element rule. Both stay raw: the Household module parses them with
  // its own `recipeQuerySchema`, which trims and lower-cases, so a stale or crafted
  // value narrows the list to nothing rather than 404ing.
  const recipeSearch = Array.isArray(search) ? search[0] : search;
  const recipeCategory = Array.isArray(category) ? category[0] : category;
  const recipeTag = Array.isArray(tag) ? tag[0] : tag;
  // Same first-element rule. Raw again: an unknown tab key is ignored by the
  // strip rather than 404ing a link that was valid before a tab was renamed.
  const requestedTab = Array.isArray(tab) ? tab[0] : tab;
  // Same first-element rule, so a repeated ?topic= can't concatenate two
  // subjects into one nonsense term. Raw: the Topics section shows its picker
  // for anything that matches nothing.
  const requestedTopic = Array.isArray(topic) ? topic[0] : topic;
  // Same first-element rule. Parsed to a number here rather than left raw,
  // unlike the params above: this one is a row id, so "not a positive integer"
  // is not a value any section could interpret — it is simply absent, and the
  // New Entry section then renders the blank form it would have shown without
  // the param at all. `Number("12abc")` is NaN and `Number("")` is 0, so both
  // fall through to undefined.
  const rawCloneId = Array.isArray(clone) ? clone[0] : clone;
  const parsedCloneId = Number(rawCloneId);
  const requestedCloneId =
    Number.isInteger(parsedCloneId) && parsedCloneId > 0 ? parsedCloneId : undefined;

  // Before the lookup, because this slug no longer resolves to a module row. The
  // section slugs are unchanged, so the path maps one-for-one; only the three
  // params the attendance screens read are carried over, which is all any old
  // link can have held.
  if (slug === RETIRED_ATTENDANCE_SLUG) {
    const carried = new URLSearchParams();
    if (rawClassId) carried.set("classId", rawClassId);
    if (requestedDate) carried.set("date", requestedDate);
    if (requestedFormat) carried.set("format", requestedFormat);
    const query = carried.toString();
    redirect(`/modules/classroom/${section}${query ? `?${query}` : ""}`);
  }

  const appModule = getModuleBySlug(deps.moduleRepo, slug);
  if (!appModule) notFound();

  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  // Same guard as the module page — a section must not be reachable by someone
  // who hasn't been granted the module.
  if (!currentUser || !userHasModuleAccess(currentUser, appModule.id, deps.userRepo)) notFound();

  const body = renderSection(
    slug,
    section,
    isAdmin(currentUser),
    filterQuery,
    requestedClassId,
    requestedDate,
    requestedFormat,
    calendarScope,
    calendarAnchor,
    prefillRuleName,
    prefillRuleDescription,
    prefillRulePattern,
    requestedGroupBy,
    requestedGroupKey,
    requestedTicker,
    requestedLots,
    requestedTickerLots,
    requestedSeedTickers,
    recipeSearch,
    recipeCategory,
    recipeTag,
    requestedTab,
    requestedReportEdit,
    requestedReportRun,
    requestedTopic,
    requestedCloneId,
  );
  if (!body) notFound();

  return <div className={PAGE_CONTAINER}>{body}</div>;
}
