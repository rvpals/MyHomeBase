import { describe, expect, it } from "vitest";
import type { ModuleSetting } from "@/lib/module-settings";
import {
  ATTENDANCE_SETTING_KEYS,
  attendanceSettingsToEntries,
  resolveAttendanceSettings,
} from "./settings";

function rows(values: Record<string, string>): ModuleSetting[] {
  return Object.entries(values).map(([key, value], index) => ({
    id: index + 1,
    moduleId: 1,
    key,
    value,
  })) as ModuleSetting[];
}

describe("resolveAttendanceSettings", () => {
  it("defaults to no class and a today-based report", () => {
    expect(resolveAttendanceSettings([])).toEqual({
      defaultClassId: undefined,
      reportDefaultsToToday: true,
      cardsUseLastNameFirst: false,
    });
  });

  it("reads a configured default class", () => {
    const settings = resolveAttendanceSettings(
      rows({ [ATTENDANCE_SETTING_KEYS.defaultClassId]: "4" }),
    );
    expect(settings.defaultClassId).toBe(4);
  });

  it("treats a blank, zero or unparseable class id as not set", () => {
    for (const value of ["", "   ", "0", "-2", "abc", "1.5"]) {
      const settings = resolveAttendanceSettings(
        rows({ [ATTENDANCE_SETTING_KEYS.defaultClassId]: value }),
      );
      expect(settings.defaultClassId, `for ${JSON.stringify(value)}`).toBeUndefined();
    }
  });

  it("defaults the card name order to first-name-first", () => {
    // Off when absent: the module read "Ava Chen" before this setting existed,
    // and an upgrade must not reorder every card on its own.
    expect(resolveAttendanceSettings([]).cardsUseLastNameFirst).toBe(false);
  });

  it("reads the card name order, case-insensitively", () => {
    expect(
      resolveAttendanceSettings(rows({ [ATTENDANCE_SETTING_KEYS.cardsUseLastNameFirst]: "TRUE" }))
        .cardsUseLastNameFirst,
    ).toBe(true);
    expect(
      resolveAttendanceSettings(rows({ [ATTENDANCE_SETTING_KEYS.cardsUseLastNameFirst]: "false" }))
        .cardsUseLastNameFirst,
    ).toBe(false);
  });

  it("reads the report toggle, case-insensitively", () => {
    expect(
      resolveAttendanceSettings(rows({ [ATTENDANCE_SETTING_KEYS.reportDefaultsToToday]: "FALSE" }))
        .reportDefaultsToToday,
    ).toBe(false);
    expect(
      resolveAttendanceSettings(rows({ [ATTENDANCE_SETTING_KEYS.reportDefaultsToToday]: "true" }))
        .reportDefaultsToToday,
    ).toBe(true);
  });
});

describe("attendanceSettingsToEntries", () => {
  it("round-trips through resolve", () => {
    const original = {
      defaultClassId: 7,
      reportDefaultsToToday: false,
      cardsUseLastNameFirst: true,
    };
    const entries = attendanceSettingsToEntries(original);
    expect(resolveAttendanceSettings(rows(Object.fromEntries(entries.map((e) => [e.key, e.value]))))).toEqual(
      original,
    );
  });

  // moduleSettingEntrySchema requires a non-empty value, so "not set" has to be
  // an absent row rather than a blank one.
  it("omits the default-class row entirely when there is no default", () => {
    const entries = attendanceSettingsToEntries({
      reportDefaultsToToday: true,
      cardsUseLastNameFirst: false,
    });

    expect(entries.some((entry) => entry.key === ATTENDANCE_SETTING_KEYS.defaultClassId)).toBe(
      false,
    );
    expect(entries.every((entry) => entry.value !== "")).toBe(true);
  });

  it("round-trips 'no default class' back to undefined", () => {
    const entries = attendanceSettingsToEntries({
      reportDefaultsToToday: true,
      cardsUseLastNameFirst: false,
    });
    const resolved = resolveAttendanceSettings(
      rows(Object.fromEntries(entries.map((entry) => [entry.key, entry.value]))),
    );

    expect(resolved.defaultClassId).toBeUndefined();
  });
});
