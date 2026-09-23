"use server";

import { revalidatePath } from "next/cache";
import { getModuleBySlug } from "@/lib/modules";
import { listModuleSettingsFor, saveModuleSettings } from "@/lib/module-settings";
import {
  resolveThresholds,
  runScan,
  thresholdsToEntries,
  type NextDayActionSignal,
  type NextDayActionThresholdsInput,
} from "@/lib/next-day-actions";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";


const INVESTMENTS_MODULE_SLUG = "investments";
const INVESTMENTS_MODULE_PATH = "/modules/investments";

export interface RunScanResult {
  ok: boolean;
  signals?: NextDayActionSignal[];
  error?: string;
}

export async function runNextDayActionsScanAction(): Promise<RunScanResult> {
  await requireModuleAccess(INVESTMENTS_MODULE_SLUG);
  try {
    const appModule = getModuleBySlug(deps.moduleRepo, INVESTMENTS_MODULE_SLUG);
    if (!appModule) throw new Error("Investments module not found.");

    const thresholds = resolveThresholds(listModuleSettingsFor(deps.moduleSettingsRepo, appModule.id));
    const signals = await runScan(deps.stockPositionRepo, deps.marketDataClient, thresholds);
    return { ok: true, signals };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to run scan." };
  }
}

export interface SaveThresholdsResult {
  ok: boolean;
  error?: string;
}

/**
 * Persists the scan thresholds as module settings. Same store the Administration
 * → Module Configuration screen writes, so the two stay in sync; validation is
 * the lib's `thresholdsToEntries`, not this adapter's.
 */
export async function saveNextDayThresholdsAction(
  input: NextDayActionThresholdsInput,
): Promise<SaveThresholdsResult> {
  await requireModuleAccess(INVESTMENTS_MODULE_SLUG);
  try {
    const appModule = getModuleBySlug(deps.moduleRepo, INVESTMENTS_MODULE_SLUG);
    if (!appModule) throw new Error("Investments module not found.");

    saveModuleSettings(deps.moduleSettingsRepo, {
      moduleId: appModule.id,
      entries: thresholdsToEntries(input),
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to save thresholds." };
  }
  revalidatePath(INVESTMENTS_MODULE_PATH);
  return { ok: true };
}
