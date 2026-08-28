import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getModuleBySlug } from "@/lib/modules";
import { isAdmin, userHasModuleAccess } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { PAGE_CONTAINER } from "../../../page-container";
import { AttendanceSection } from "../attendance-section";
import { isAttendanceSection } from "../attendance-sections";
import { ExpenseSection } from "../expense-section";
import { isExpenseSection } from "../expense-sections";
import { isJournalSection } from "../journal-sections";
import { MusicSection } from "../music-section";
import { isMusicSection } from "../music-sections";
import { JournalSection } from "../journal-section";
import { StockSection } from "../stock-section";
import { isStockSection } from "../stock-sections";

const ATTENDANCE_MODULE_SLUG = "attendance";
const EXPENSE_MODULE_SLUG = "expense";
const JOURNAL_MODULE_SLUG = "journal";
const MUSIC_LIBRARY_MODULE_SLUG = "music-library";
const STOCK_ETFS_MODULE_SLUG = "stock-etfs";

/**
 * A module's sub-section, e.g. /modules/expense/transactions or
 * /modules/stock-etfs/positions.
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
  requestedRecordId: number | undefined,
  requestedFormat: string | undefined,
  calendarScope: string | undefined,
  calendarAnchor: string | undefined,
  prefillRuleName: string | undefined,
  prefillRuleDescription: string | undefined,
  prefillRulePattern: string | undefined,
) {
  if (slug === ATTENDANCE_MODULE_SLUG && isAttendanceSection(section)) {
    return (
      <AttendanceSection
        section={section}
        requestedClassId={requestedClassId}
        requestedDate={requestedDate}
        requestedRecordId={requestedRecordId}
        requestedFormat={requestedFormat}
      />
    );
  }
  if (slug === EXPENSE_MODULE_SLUG && isExpenseSection(section)) {
    return (
      <ExpenseSection
        section={section}
        prefillRuleName={prefillRuleName}
        prefillRuleDescription={prefillRuleDescription}
        prefillRulePattern={prefillRulePattern}
      />
    );
  }
  if (slug === JOURNAL_MODULE_SLUG && isJournalSection(section)) {
    return (
      <JournalSection
        section={section}
        isAdmin={isAdmin}
        filterQuery={filterQuery}
        calendarScope={calendarScope}
        calendarAnchor={calendarAnchor}
        // ?date= is shared with the Attendance report rather than given a second
        // name: both mean "the day this screen is showing".
        selectedDate={requestedDate}
      />
    );
  }
  if (slug === MUSIC_LIBRARY_MODULE_SLUG && isMusicSection(section)) {
    return <MusicSection section={section} />;
  }
  if (slug === STOCK_ETFS_MODULE_SLUG && isStockSection(section)) {
    return <StockSection section={section} />;
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
  // `classId`/`date` do the same job for the Attendance report, and `date` is
  // reused by the Journal calendar for the day whose entries are listed.
  // `scope`/`anchor` carry which calendar period is on screen, so a month (or a
  // year, or one week) is a bookmarkable URL.
  searchParams: Promise<{
    filter?: string | string[];
    classId?: string | string[];
    date?: string | string[];
    recordId?: string | string[];
    format?: string | string[];
    scope?: string | string[];
    anchor?: string | string[];
    // `name`/`description` seed a new Expense transaction rule, so "add a rule
    // for this" can be a plain link that arrives with the form already filled.
    name?: string | string[];
    description?: string | string[];
    // The raw statement line to match on, seeding the rule's pattern field.
    vendorDescription?: string | string[];
  }>;
}) {
  const { slug, section } = await params;
  const {
    filter,
    classId,
    date,
    recordId,
    format,
    scope,
    anchor,
    name,
    description,
    vendorDescription,
  } = await searchParams;
  // A repeated ?filter= yields an array; take the first rather than joining, so a
  // crafted URL can't smuggle a second expression in.
  const filterQuery = Array.isArray(filter) ? filter[0] : filter;
  const rawClassId = Array.isArray(classId) ? classId[0] : classId;
  const requestedClassId = Number(rawClassId) || undefined;
  const requestedDate = Array.isArray(date) ? date[0] : date;
  const rawRecordId = Array.isArray(recordId) ? recordId[0] : recordId;
  const requestedRecordId = Number(rawRecordId) || undefined;
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
    requestedRecordId,
    requestedFormat,
    calendarScope,
    calendarAnchor,
    prefillRuleName,
    prefillRuleDescription,
    prefillRulePattern,
  );
  if (!body) notFound();

  return <div className={PAGE_CONTAINER}>{body}</div>;
}
