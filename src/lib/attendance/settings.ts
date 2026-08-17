import type { ModuleSetting } from "@/lib/module-settings";

// Module settings for Attendance, stored as key/value rows in
// sys_module_settings — the same mechanism the Expense auto-import and the
// journal preferences use.

export const ATTENDANCE_SETTING_KEYS = {
  defaultClassId: "attendance_default_class_id",
  reportDefaultsToToday: "attendance_report_defaults_to_today",
} as const;

export interface AttendanceSettings {
  /**
   * The class the home screen opens on, so a teacher with one main class
   * doesn't pick it every morning. `undefined` means "no default — ask".
   */
  defaultClassId?: number;
  /**
   * Whether the Report screen opens on today's date. Off means it opens on the
   * most recent day that actually has attendance, which suits a teacher who
   * prints yesterday's register the next morning.
   */
  reportDefaultsToToday: boolean;
}

/**
 * Parses the module's settings rows into typed values.
 *
 * A blank or unparseable default class is treated as "not set" rather than
 * throwing: the row can outlive the class it names (deleting a class doesn't
 * reach into settings), and a stale id must not break the home screen.
 */
export function resolveAttendanceSettings(settings: ModuleSetting[]): AttendanceSettings {
  const byKey = new Map(settings.map((setting) => [setting.key, setting.value]));

  const rawClassId = Number(byKey.get(ATTENDANCE_SETTING_KEYS.defaultClassId));
  const defaultClassId =
    Number.isInteger(rawClassId) && rawClassId > 0 ? rawClassId : undefined;

  // Missing means on — today is the overwhelmingly common case, so a fresh
  // install should land there without anyone configuring it.
  const rawToday = byKey.get(ATTENDANCE_SETTING_KEYS.reportDefaultsToToday);
  const reportDefaultsToToday =
    rawToday === undefined ? true : rawToday.trim().toLowerCase() === "true";

  return { defaultClassId, reportDefaultsToToday };
}

/**
 * The settings as key/value rows, ready to persist.
 *
 * "No default class" is written by **omitting the row**, not by storing a blank:
 * `moduleSettingEntrySchema` requires `value` to be non-empty, so a blank would
 * be rejected at the boundary. A save replaces the module's whole entry set, so
 * leaving the key out is what deletes it — and `resolveAttendanceSettings`
 * already reads a missing key as "not set".
 */
export function attendanceSettingsToEntries(
  settings: AttendanceSettings,
): { key: string; value: string }[] {
  return [
    ...(settings.defaultClassId
      ? [
          {
            key: ATTENDANCE_SETTING_KEYS.defaultClassId,
            value: String(settings.defaultClassId),
          },
        ]
      : []),
    {
      key: ATTENDANCE_SETTING_KEYS.reportDefaultsToToday,
      value: String(settings.reportDefaultsToToday),
    },
  ];
}
