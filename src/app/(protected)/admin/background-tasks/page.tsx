import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { resolveExpenseSettings } from "@/lib/expense/settings";
import { listScheduledJobs } from "@/lib/scheduled-jobs";
import { resolveScheduledRefreshSettings } from "@/lib/scheduled-refresh";
import { deps } from "@/lib/wiring";
import { BackgroundTasksView } from "./view";

/**
 * Administration -> Background Tasks: what the app runs on a timer, whether each
 * job is armed, and — the reason this screen exists — whether it has actually run.
 *
 * The three jobs' switches live here rather than on their own modules' screens, so
 * arming a background service is one place. Their *configuration* stays with the
 * module (the Expense watched folder, say), and this screen shows those
 * preconditions read-only so a switch can't be turned on with no visible reason
 * why nothing happens.
 */
export default async function BackgroundTasksPage() {
  // Driven by the job catalogue, not by the table's rows: a job that has never run
  // has no row, and listing the table would silently omit it.
  const jobs = listScheduledJobs(deps.scheduledRunRepo.list());

  const stockModule = getModuleBySlug(deps.moduleRepo, "stock-etfs");
  const autoRefresh = resolveScheduledRefreshSettings(
    stockModule ? listModuleSettingsFor(deps.moduleSettingsRepo, stockModule.id) : [],
  );

  const expenseModule = getModuleBySlug(deps.moduleRepo, "expense");
  const expense = resolveExpenseSettings(
    expenseModule ? listModuleSettingsFor(deps.moduleSettingsRepo, expenseModule.id) : [],
  );

  return <BackgroundTasksView jobs={jobs} autoRefresh={autoRefresh} expense={expense} />;
}
