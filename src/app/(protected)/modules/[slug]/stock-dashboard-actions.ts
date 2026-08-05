"use server";

import { revalidatePath } from "next/cache";
import { saveModuleSettings } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { dashboardWidgetsToEntries, type DashboardWidgetsInput } from "@/lib/stock-dashboard";
import { deps } from "@/lib/wiring";

const STOCK_ETFS_MODULE_SLUG = "stock-etfs";
const STOCK_ETFS_MODULE_PATH = "/modules/stock-etfs";

export interface SaveDashboardWidgetsResult {
  ok: boolean;
  error?: string;
}

/**
 * Persists the dashboard layout as a module setting — the same store the scan
 * thresholds use. Validation (every widget once, no duplicates) belongs to the lib's
 * `dashboardWidgetsToEntries`, not to this adapter.
 */
export async function saveDashboardWidgetsAction(
  widgets: DashboardWidgetsInput,
): Promise<SaveDashboardWidgetsResult> {
  try {
    const appModule = getModuleBySlug(deps.moduleRepo, STOCK_ETFS_MODULE_SLUG);
    if (!appModule) throw new Error("Stocks & ETFs module not found.");

    saveModuleSettings(deps.moduleSettingsRepo, {
      moduleId: appModule.id,
      entries: dashboardWidgetsToEntries(widgets),
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to save the dashboard layout.",
    };
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}
