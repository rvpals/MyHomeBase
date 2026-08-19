import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { listEntries as listCsvAnalyticsEntries } from "@/lib/csv-analytics";
import { getModuleBySlug } from "@/lib/modules";
import { isAdmin, userHasModuleAccess } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { PAGE_CONTAINER } from "../../page-container";
import { AttendanceSection } from "./attendance-section";
import { CsvAnalyticsView } from "./csv-analytics-view";
import { ExpenseSection } from "./expense-section";
import { JournalSection } from "./journal-section";
import { MusicSection } from "./music-section";
import { StockSection } from "./stock-section";

const STOCK_ETFS_MODULE_SLUG = "stock-etfs";
const CSV_ANALYSIS_MODULE_SLUG = "csv-analysis";
const JOURNAL_MODULE_SLUG = "journal";
const EXPENSE_MODULE_SLUG = "expense";
const ATTENDANCE_MODULE_SLUG = "attendance";
const MUSIC_LIBRARY_MODULE_SLUG = "music-library";

function ModuleBody({
  slug,
  isCurrentUserAdmin,
  requestedClassId,
}: {
  slug: string;
  isCurrentUserAdmin: boolean;
  requestedClassId?: number;
}) {
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

  if (slug === ATTENDANCE_MODULE_SLUG) {
    return <AttendanceSection section="main" requestedClassId={requestedClassId} />;
  }

  if (slug === MUSIC_LIBRARY_MODULE_SLUG) {
    return <MusicSection section="main" />;
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
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  // `classId` picks the Attendance module's class, so a teacher can bookmark
  // their first-period register and land straight on it.
  searchParams: Promise<{ classId?: string | string[] }>;
}) {
  const { slug } = await params;
  const { classId } = await searchParams;
  // A repeated ?classId= yields an array; take the first rather than joining.
  const rawClassId = Array.isArray(classId) ? classId[0] : classId;
  const requestedClassId = Number(rawClassId) || undefined;

  const appModule = getModuleBySlug(deps.moduleRepo, slug);

  if (!appModule) notFound();

  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  // The (protected) layout already guarantees a logged-in user by this point;
  // this only guards against navigating straight to an unassigned module's URL.
  if (!currentUser || !userHasModuleAccess(currentUser, appModule.id, deps.userRepo)) notFound();

  return (
    <div className={PAGE_CONTAINER}>
      <ModuleBody
        slug={slug}
        isCurrentUserAdmin={isAdmin(currentUser)}
        requestedClassId={requestedClassId}
      />
    </div>
  );
}
