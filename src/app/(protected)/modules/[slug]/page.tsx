import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { listEntries as listCsvAnalyticsEntries } from "@/lib/csv-analytics";
import { listNamedMappings } from "@/lib/csv-import";
import {
  listCategories,
  listRecentEntries,
  listTags,
  listTodayInHistory,
  resolveJournalPreferences,
} from "@/lib/journal";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug, getModuleCode } from "@/lib/modules";
import { todayIsoLocal } from "@/lib/shared/date";
import { isAdmin, userHasModuleAccess } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { PAGE_CONTAINER } from "../../page-container";
import { CsvAnalyticsView } from "./csv-analytics-view";
import { ExpenseSection } from "./expense-section";
import { JournalView } from "./journal-view";
import { StockSection } from "./stock-section";

const STOCK_ETFS_MODULE_SLUG = "stock-etfs";
const CSV_ANALYSIS_MODULE_SLUG = "csv-analysis";
const JOURNAL_MODULE_SLUG = "journal";
const EXPENSE_MODULE_SLUG = "expense";
const RECENT_JOURNAL_ENTRY_LIMIT = 25;

function ModuleBody({ slug, isCurrentUserAdmin }: { slug: string; isCurrentUserAdmin: boolean }) {
  // Stocks & ETFs and Expense both use a tree nav: the module root is their
  // dashboard, and every other section is its own route under [slug]/[section].
  if (slug === STOCK_ETFS_MODULE_SLUG) {
    return <StockSection section="main" />;
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
    <div className={PAGE_CONTAINER}>
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
