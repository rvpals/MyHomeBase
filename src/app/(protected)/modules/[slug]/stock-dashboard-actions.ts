"use server";

import { revalidatePath } from "next/cache";
import { saveModuleSettings } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { dashboardWidgetsToEntries, type DashboardWidgetsInput } from "@/lib/stock-dashboard";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";


const INVESTMENTS_MODULE_SLUG = "investments";
const INVESTMENTS_MODULE_PATH = "/modules/investments";

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
  await requireModuleAccess(INVESTMENTS_MODULE_SLUG);
  try {
    const appModule = getModuleBySlug(deps.moduleRepo, INVESTMENTS_MODULE_SLUG);
    if (!appModule) throw new Error("Investments module not found.");

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
  revalidatePath(INVESTMENTS_MODULE_PATH);
  return { ok: true };
}
