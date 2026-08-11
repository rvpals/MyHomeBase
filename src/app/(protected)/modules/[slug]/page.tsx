import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { listEntries as listCsvAnalyticsEntries } from "@/lib/csv-analytics";
import { getModuleBySlug } from "@/lib/modules";
import { isAdmin, userHasModuleAccess } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { PAGE_CONTAINER } from "../../page-container";
import { CsvAnalyticsView } from "./csv-analytics-view";
import { ExpenseSection } from "./expense-section";
import { JournalSection } from "./journal-section";
import { StockSection } from "./stock-section";

const STOCK_ETFS_MODULE_SLUG = "stock-etfs";
const CSV_ANALYSIS_MODULE_SLUG = "csv-analysis";
const JOURNAL_MODULE_SLUG = "journal";
const EXPENSE_MODULE_SLUG = "expense";

function ModuleBody({ slug, isCurrentUserAdmin }: { slug: string; isCurrentUserAdmin: boolean }) {
  // Stocks & ETFs, My Journal, and Expense all use a tree nav: the module root
  // is their home/dashboard, and every other section is its own route under
  // [slug]/[section].
  if (slug === STOCK_ETFS_MODULE_SLUG) {
    return <StockSection section="main" />;
  }

  if (slug === CSV_ANALYSIS_MODULE_SLUG) {
    return <CsvAnalyticsView entries={listCsvAnalyticsEntries(deps.csvAnalyticsRepo)} />;
  }

  if (slug === JOURNAL_MODULE_SLUG) {
    return <JournalSection section="main" isAdmin={isCurrentUserAdmin} />;
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
      <h1 className="font-display text-3xl font-semibold text-ink">{appModule.longName}</h1>
      <div className="mt-3 h-px w-full bg-line" />
      <div className="mt-8">
        <ModuleBody slug={slug} isCurrentUserAdmin={isAdmin(currentUser)} />
      </div>
    </div>
  );
}
