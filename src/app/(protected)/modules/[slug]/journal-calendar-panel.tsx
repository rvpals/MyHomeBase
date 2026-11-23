// Server-side wrapper around JournalCalendarView: resolves the requested scope
// and anchor, reads just the entries in that period, and hands the client view
// plain data.
//
// The split is the same one journal-entries-panel.tsx uses — the impure steps
// (the range read, the icon lookups, "what day is it") happen here, and the view
// stays props-in / events-out. It matters more here than usual because "today"
// must be one value: read on the client it would be the device's clock, so a
// phone in another timezone would highlight a different cell than the entry
// dates were saved against.

import {
  categoryColorMap,
  isJournalCalendarScope,
  journalCalendarRange,
  listCategories,
  listEnabledPrefillTemplates,
  listEntriesInDateRange,
  listTags,
  resolveJournalPreferences,
  type JournalCalendarScope,
} from "@/lib/journal";
import { listDashboardTextures } from "@/lib/dashboard-texture";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { listLocationCategories, listLocationTags } from "@/lib/sys-locations";
import { todayIsoLocal } from "@/lib/shared/date";
import { deps } from "@/lib/wiring";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getModuleBySlug } from "@/lib/modules";
import { userHasModuleAccess } from "@/lib/user";
import { JournalCalendarView } from "./journal-calendar-view";
import { journalTaxonomyIconUrlsByName } from "./journal-shared";

/** Matched by full slug, never by prefix — the same rule the actions follow. */
const EXPENSE_MODULE_SLUG = "expense";

export interface JournalCalendarPanelProps {
  /** Raw ?scope= — anything unrecognized falls back to the month view. */
  scope?: string;
  /** Raw ?anchor= — anything unparseable falls back to today. */
  anchor?: string;
  /** Raw ?date= — the clicked day, dropped if it isn't an ISO date. */
  selectedDate?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// `async` because deciding whether to draw the day panel's $ button means
// reading the session cookie, which `next/headers` only exposes as a promise —
// the same reason `ExpenseShell` is async. Everything else here stays sync.
export async function JournalCalendarPanel({
  scope: rawScope,
  anchor: rawAnchor,
  selectedDate: rawSelectedDate,
}: JournalCalendarPanelProps) {
  // The shared local-calendar helper, not toISOString(): UTC would pick
  // tomorrow for part of every evening west of Greenwich and highlight the
  // wrong cell.
  const today = todayIsoLocal();

  // A bad param degrades to the default rather than throwing. These arrive from
  // a URL anyone can edit, and a hand-mangled ?anchor= should show this month,
  // not a 500 — the screen is still perfectly usable at the default.
  const scope: JournalCalendarScope =
    rawScope !== undefined && isJournalCalendarScope(rawScope) ? rawScope : "month";
  const anchor = rawAnchor !== undefined && ISO_DATE.test(rawAnchor) ? rawAnchor : today;
  const selectedDate =
    rawSelectedDate !== undefined && ISO_DATE.test(rawSelectedDate) ? rawSelectedDate : undefined;

  // One read, bounded by the scope: a month is ~42 days, a year ~380. The range
  // includes the padding days a month grid borrows, so a title never disappears
  // just because its day belongs to the neighbouring month.
  // ISO_DATE matches 2026-02-30 — well-formed, but not a real day, which the
  // library rejects. Resolve the anchor and the range together so a fallback
  // moves both: passing the rejected anchor to the view would have it build the
  // grid from a date the range wasn't read for.
  let resolvedAnchor = anchor;
  let range;
  try {
    range = journalCalendarRange(scope, anchor);
  } catch {
    resolvedAnchor = today;
    range = journalCalendarRange(scope, today);
  }
  const entries = listEntriesInDateRange(deps.journalRepo, range.start, range.end);

  const categories = listCategories(deps.journalRepo);
  const tags = listTags(deps.journalRepo);

  // Whether the open day's panel offers the "expenses around this date" button.
  // A separate grant from the journal one the route already checked — plenty of
  // readers have one module and not the other. The real guard is inside
  // `expensesOnDateAction`; this only decides whether the control is drawn.
  // The Merge bulk action mounts the ordinary entry form, so it needs the same
  // reads the Entries panel makes.
  const journalModule = getModuleBySlug(deps.moduleRepo, "journal");
  const preferences = resolveJournalPreferences(
    journalModule ? listModuleSettingsFor(deps.moduleSettingsRepo, journalModule.id) : [],
  );

  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  const expenseModule = getModuleBySlug(deps.moduleRepo, EXPENSE_MODULE_SLUG);
  const canSeeExpense =
    currentUser !== undefined &&
    expenseModule !== undefined &&
    userHasModuleAccess(currentUser, expenseModule.id, deps.userRepo);

  return (
    <JournalCalendarView
      scope={scope}
      anchor={resolvedAnchor}
      today={today}
      selectedDate={selectedDate}
      entries={entries}
      categoryIcons={Object.fromEntries(journalTaxonomyIconUrlsByName("category", categories))}
      tagIcons={Object.fromEntries(journalTaxonomyIconUrlsByName("tag", tags))}
      canSeeExpense={canSeeExpense}
      categoryColors={categoryColorMap(categories)}
      mergeFormOptions={{
        categoryOptions: categories.map((category) => category.name),
        tagOptions: tags.map((tag) => tag.name),
        preferences,
        contentTextures: listDashboardTextures(deps.dashboardTextureRepo),
        prefillTemplates: listEnabledPrefillTemplates(deps.journalRepo),
        locationCategoryOptions: listLocationCategories(deps.sysLocationRepo).map(
          (row) => row.name,
        ),
        locationTagOptions: listLocationTags(deps.sysLocationRepo).map((row) => row.name),
      }}
    />
  );
}
