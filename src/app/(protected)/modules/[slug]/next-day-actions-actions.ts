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

const STOCK_ETFS_MODULE_SLUG = "stock-etfs";
const STOCK_ETFS_MODULE_PATH = "/modules/stock-etfs";

export interface RunScanResult {
  ok: boolean;
  signals?: NextDayActionSignal[];
  error?: string;
}

export async function runNextDayActionsScanAction(): Promise<RunScanResult> {
  try {
    const appModule = getModuleBySlug(deps.moduleRepo, STOCK_ETFS_MODULE_SLUG);
    if (!appModule) throw new Error("Stocks & ETFs module not found.");

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
  try {
    const appModule = getModuleBySlug(deps.moduleRepo, STOCK_ETFS_MODULE_SLUG);
    if (!appModule) throw new Error("Stocks & ETFs module not found.");

    saveModuleSettings(deps.moduleSettingsRepo, {
      moduleId: appModule.id,
      entries: thresholdsToEntries(input),
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to save thresholds." };
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}
