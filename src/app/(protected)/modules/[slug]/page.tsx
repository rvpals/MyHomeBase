import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { listEntries as listCsvAnalyticsEntries } from "@/lib/csv-analytics";
import { listAccounts, listPerformanceRecords } from "@/lib/investment-accounts";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { listNamedMappings } from "@/lib/csv-import";
import {
  listCategories,
  listRecentEntries,
  listTags,
  listTodayInHistory,
  resolveJournalPreferences,
} from "@/lib/journal";
import { getModuleBySlug, getModuleCode } from "@/lib/modules";
import { resolveThresholds } from "@/lib/next-day-actions";
import { getCorrelationCache, getSharpeCache, listVolatilityCache } from "@/lib/stock-analytics";
import { listPositions, listTransactions } from "@/lib/stock-positions";
import { listItems, listWatchLists } from "@/lib/stock-watchlist";
import { isAdmin, userHasModuleAccess } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { CsvAnalyticsView } from "./csv-analytics-view";
import { CsvImportView } from "./csv-import-view";
import { ExpenseSection } from "./expense-section";
import { EXPENSE_PAGE_CONTAINER } from "./expense-sections";
import { JournalView } from "./journal-view";
import { NextDayActionsView } from "./next-day-actions-view";
import { StockAccountsView, type AccountEntry } from "./stock-accounts-view";
import { StockAnalyticsView } from "./stock-analytics-view";
import { StockPositionsView } from "./stock-positions-view";
import { StockWatchlistView, type WatchListEntry } from "./stock-watchlist-view";

const STOCK_ETFS_MODULE_SLUG = "stock-etfs";
const CSV_ANALYSIS_MODULE_SLUG = "csv-analysis";
const JOURNAL_MODULE_SLUG = "journal";
const EXPENSE_MODULE_SLUG = "expense";
const RECENT_JOURNAL_ENTRY_LIMIT = 25;

// Today's date in the server's local timezone as YYYY-MM-DD. Deliberately not
// `toISOString()`, which would shift to UTC and pick the wrong day for part of
// the evening in a negative-offset timezone.
function todayIsoLocal(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
const WIDE_LAYOUT_SLUGS = new Set([
  STOCK_ETFS_MODULE_SLUG,
  CSV_ANALYSIS_MODULE_SLUG,
  JOURNAL_MODULE_SLUG,
]);

/**
 * Expense gets a much wider container than the other modules — it has a nav
 * column plus wide tables, so the 6xl cap left most of a large display empty.
 */
function containerClassFor(slug: string): string {
  if (slug === EXPENSE_MODULE_SLUG) return EXPENSE_PAGE_CONTAINER;
  return WIDE_LAYOUT_SLUGS.has(slug) ? "mx-auto max-w-6xl" : "mx-auto max-w-3xl";
}

function StockEtfsModuleBody() {
  const accountEntries: AccountEntry[] = listAccounts(deps.investmentAccountRepo).map((account) => ({
    account,
    history: listPerformanceRecords(deps.investmentAccountRepo, account.id),
  }));

  const watchListEntries: WatchListEntry[] = listWatchLists(deps.stockWatchListRepo).map((list) => ({
    list,
    items: listItems(deps.stockWatchListRepo, list.id),
  }));

  const stockEtfsModule = getModuleBySlug(deps.moduleRepo, STOCK_ETFS_MODULE_SLUG);
  const thresholds = resolveThresholds(
    stockEtfsModule ? listModuleSettingsFor(deps.moduleSettingsRepo, stockEtfsModule.id) : [],
  );

  return (
    <div className="flex flex-col gap-10">
      <StockPositionsView
        positions={listPositions(deps.stockPositionRepo)}
        transactions={listTransactions(deps.stockPositionRepo)}
      />
      <StockWatchlistView entries={watchListEntries} />
      <NextDayActionsView initialThresholds={thresholds} />
      <StockAnalyticsView
        volatilityResults={listVolatilityCache(deps.stockAnalyticsRepo)}
        correlationResult={getCorrelationCache(deps.stockAnalyticsRepo)}
        sharpeResult={getSharpeCache(deps.stockAnalyticsRepo)}
      />
      <StockAccountsView entries={accountEntries} />
      <CsvImportView />
    </div>
  );
}

function ModuleBody({ slug, isCurrentUserAdmin }: { slug: string; isCurrentUserAdmin: boolean }) {
  if (slug === STOCK_ETFS_MODULE_SLUG) {
    return <StockEtfsModuleBody />;
  }

  if (slug === CSV_ANALYSIS_MODULE_SLUG) {
    return <CsvAnalyticsView entries={listCsvAnalyticsEntries(deps.csvAnalyticsRepo)} />;
  }

  if (slug === JOURNAL_MODULE_SLUG) {
    const journalModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);
    const preferences = resolveJournalPreferences(
      journalModule ? listModuleSettingsFor(deps.moduleSettingsRepo, journalModule.id) : [],
    );
    return (
      <JournalView
        entries={listRecentEntries(deps.journalRepo, RECENT_JOURNAL_ENTRY_LIMIT)}
        todayInHistory={listTodayInHistory(deps.journalRepo, todayIsoLocal())}
        categoryOptions={listCategories(deps.journalRepo).map((category) => category.name)}
        tagOptions={listTags(deps.journalRepo).map((tag) => tag.name)}
        preferences={preferences}
        namedMappings={listNamedMappings(deps.csvImportMappingRepo, "Journal")}
        canRunSql={isCurrentUserAdmin}
      />
    );
  }

  // The module root is the dashboard; every other section is its own route
  // under [slug]/[section].
  if (slug === EXPENSE_MODULE_SLUG) {
    return <ExpenseSection section="main" />;
  }

  return (
    <div className="rounded-xl border border-dashed border-line p-8 text-center">
      <p className="font-display text-lg text-ink">Coming soon</p>
      <p className="mt-1 text-sm text-muted">This module hasn&apos;t been built out yet.</p>
    </div>
  );
}

export default async function ModulePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const appModule = getModuleBySlug(deps.moduleRepo, slug);

  if (!appModule) notFound();

  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  // The (protected) layout already guarantees a logged-in user by this point;
  // this only guards against navigating straight to an unassigned module's URL.
  if (!currentUser || !userHasModuleAccess(currentUser, appModule.id, deps.userRepo)) notFound();

  return (
    <div className={containerClassFor(slug)}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        {getModuleCode(appModule.slug)}
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">{appModule.longName}</h1>
      <div className="mt-3 h-px w-full bg-line" />
      <div className="mt-8">
        <ModuleBody slug={slug} isCurrentUserAdmin={isAdmin(currentUser)} />
      </div>
    </div>
  );
}
