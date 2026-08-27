"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { runExpenseAutoImport } from "@/lib/expense/auto-import-runner";
import {
  EXPENSE_SETTING_KEYS,
  type ExpenseSettings,
} from "@/lib/expense/settings";
import type { AutoImportRunSummary } from "@/lib/expense/auto-import";
import { saveModuleSettingsPartial } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import {
  runScheduledRefreshNow,
  scheduledRefreshSettingsSchema,
  scheduledRefreshSettingsToEntries,
  STOCK_ETFS_MODULE_SLUG,
  type ScheduledRefreshSettingsInput,
  type ScheduledRefreshSummary,
} from "@/lib/scheduled-refresh";
import { isAdmin } from "@/lib/user";
import { deps } from "@/lib/wiring";

const BACKGROUND_TASKS_PATH = "/admin/background-tasks";
const EXPENSE_MODULE_SLUG = "expense";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Arming a background service is administration, so these are admin-only. The
 * route layout already redirects non-admins, but a server action is its own
 * endpoint — callable without ever rendering the page — so the check has to live
 * on this side too (same reasoning as security and user-management).
 *
 * NOTE this is a permissions change from where these controls used to live: the
 * Expense switch was previously on the module's own settings screen, so any user
 * with Expense access could arm or disarm the importer. Now only an admin can.
 */
async function requireAdmin(): Promise<void> {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) throw new Error("Not authenticated.");
  if (!isAdmin(currentUser)) throw new Error("Only an admin can configure background tasks.");
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

/**
 * Persists the Stocks auto-refresh switch and interval.
 *
 * Moved here verbatim from the Stocks module's own configuration screen, including
 * the reason it uses `saveModuleSettingsPartial` and not `saveModuleSettings`: the
 * wholesale save deletes every row for the module and reinserts only what it is
 * handed, so writing just these two keys with it would wipe the scan thresholds
 * and the dashboard layout.
 */
export async function saveAutoRefreshSettingsAction(
  input: ScheduledRefreshSettingsInput,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const stockModule = getModuleBySlug(deps.moduleRepo, STOCK_ETFS_MODULE_SLUG);
    if (!stockModule) throw new Error("Stocks & ETFs module not found.");

    const validated = scheduledRefreshSettingsSchema.parse(input);
    saveModuleSettingsPartial(
      deps.moduleSettingsRepo,
      stockModule.id,
      scheduledRefreshSettingsToEntries(validated),
    );
  } catch (error) {
    return toErrorResult(error, "Failed to save the auto-refresh settings.");
  }
  revalidatePath(BACKGROUND_TASKS_PATH);
  // The Stocks configuration screen no longer shows these, but its cached render
  // still describes the module — cheap to keep honest.
  revalidatePath("/modules/stock-etfs");
  return { ok: true };
}

/**
 * Persists the Expense auto-import switch and interval — and only those two keys.
 *
 * The watched folder deliberately stays on the Expense module's own settings
 * screen: it is configuration of *what* to import, not of *when*. Writing it from
 * here would mean this form owned a field it doesn't render, and a partial save
 * that omitted it would blank it.
 */
export async function saveAutoImportScheduleAction(input: {
  autoImportEnabled: boolean;
  autoImportIntervalMinutes: number;
}): Promise<ActionResult> {
  try {
    await requireAdmin();
    const expenseModule = getModuleBySlug(deps.moduleRepo, EXPENSE_MODULE_SLUG);
    if (!expenseModule) throw new Error("Expense module not found.");

    const interval = Number(input.autoImportIntervalMinutes);
    if (!Number.isFinite(interval) || interval < 0 || !Number.isInteger(interval)) {
      throw new Error("Interval must be a whole number of minutes.");
    }

    saveModuleSettingsPartial(deps.moduleSettingsRepo, expenseModule.id, [
      {
        key: EXPENSE_SETTING_KEYS.autoImportEnabled,
        value: input.autoImportEnabled ? "true" : "false",
      },
      { key: EXPENSE_SETTING_KEYS.autoImportIntervalMinutes, value: String(interval) },
    ]);
  } catch (error) {
    return toErrorResult(error, "Failed to save the auto-import schedule.");
  }
  revalidatePath(BACKGROUND_TASKS_PATH);
  revalidatePath("/modules/expense");
  return { ok: true };
}

export interface RunAutoRefreshNowResult extends ActionResult {
  summary?: ScheduledRefreshSummary;
}

/** Runs a refresh pass now. `force`, so the switch and the interval don't gate it. */
export async function runAutoRefreshNowAction(): Promise<RunAutoRefreshNowResult> {
  try {
    await requireAdmin();
    const summary = await runScheduledRefreshNow({ force: true });
    revalidatePath(BACKGROUND_TASKS_PATH);
    return { ok: true, summary };
  } catch (error) {
    return toErrorResult(error, "Failed to run the refresh.");
  }
}

export interface RunAutoImportNowResult extends ActionResult {
  summary?: AutoImportRunSummary;
}

/**
 * Runs an import pass now. `force` for the same reason — trying a folder before
 * arming the service is exactly what this button is for.
 */
export async function runAutoImportNowAction(): Promise<RunAutoImportNowResult> {
  try {
    await requireAdmin();
    const summary = runExpenseAutoImport({ force: true });
    revalidatePath(BACKGROUND_TASKS_PATH);
    return { ok: true, summary };
  } catch (error) {
    return toErrorResult(error, "Failed to run the auto-import.");
  }
}

// Re-exported for the view's prop types, which need the settings shape without
// importing the lib index into a client component.
export type { ExpenseSettings };
