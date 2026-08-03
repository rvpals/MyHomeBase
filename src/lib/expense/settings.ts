import type { ModuleSetting } from "@/lib/module-settings";

// Module settings for the Expense tracker, stored as key/value rows in
// sys_module_settings — the same mechanism the Stocks thresholds and the
// journal preferences use.

export const EXPENSE_SETTING_KEYS = {
  autoImportPath: "csv_autoimport_path",
  autoImportIntervalMinutes: "csv_autoimport_interval_minutes",
} as const;

export interface ExpenseSettings {
  /** Folder watched for statement CSVs. Empty disables auto-import. */
  autoImportPath: string;
  /** Minutes between runs. 0 disables auto-import. */
  autoImportIntervalMinutes: number;
}

export const DEFAULT_AUTO_IMPORT_INTERVAL_MINUTES = 60;

/**
 * Parses the module's settings rows into typed values. Auto-import is only
 * considered configured when both a folder and a positive interval are present —
 * a half-configured setup stays off rather than running against a blank path.
 */
export function resolveExpenseSettings(settings: ModuleSetting[]): ExpenseSettings {
  const byKey = new Map(settings.map((setting) => [setting.key, setting.value]));

  const rawInterval = Number(byKey.get(EXPENSE_SETTING_KEYS.autoImportIntervalMinutes));
  const autoImportIntervalMinutes =
    Number.isFinite(rawInterval) && rawInterval > 0 ? Math.floor(rawInterval) : 0;

  return {
    autoImportPath: (byKey.get(EXPENSE_SETTING_KEYS.autoImportPath) ?? "").trim(),
    autoImportIntervalMinutes,
  };
}

/** True when both settings are set, i.e. the scheduler should do anything at all. */
export function isAutoImportEnabled(settings: ExpenseSettings): boolean {
  return settings.autoImportPath !== "" && settings.autoImportIntervalMinutes > 0;
}

/**
 * Serializes settings back into module-setting entries. Module-setting values
 * must be non-empty, so a blank path is omitted rather than written as "".
 */
export function expenseSettingsToEntries(
  settings: ExpenseSettings,
): { key: string; value: string }[] {
  const entries: { key: string; value: string }[] = [
    {
      key: EXPENSE_SETTING_KEYS.autoImportIntervalMinutes,
      value: String(settings.autoImportIntervalMinutes),
    },
  ];
  if (settings.autoImportPath.trim() !== "") {
    entries.push({
      key: EXPENSE_SETTING_KEYS.autoImportPath,
      value: settings.autoImportPath.trim(),
    });
  }
  return entries;
}

/**
 * Whether enough time has passed to run again. Kept separate and pure so the
 * scheduling decision is testable without timers: the runner ticks on a short
 * fixed heartbeat and asks this, which means an interval change takes effect
 * without restarting anything.
 */
export function shouldRunNow(
  lastRunAtMs: number | undefined,
  intervalMinutes: number,
  nowMs: number,
): boolean {
  if (intervalMinutes <= 0) return false;
  if (lastRunAtMs === undefined) return true; // first tick after startup
  return nowMs - lastRunAtMs >= intervalMinutes * 60_000;
}
