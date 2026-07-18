"use server";

import { getModuleBySlug } from "@/lib/modules";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { resolveThresholds, runScan, type NextDayActionSignal } from "@/lib/next-day-actions";
import { deps } from "@/lib/wiring";

const STOCK_ETFS_MODULE_SLUG = "stock-etfs";

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
