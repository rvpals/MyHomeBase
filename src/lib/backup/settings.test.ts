import { describe, expect, it } from "vitest";
import {
  BACKUP_SETTING_KEYS,
  DEFAULT_BACKUP_INTERVAL,
  DEFAULT_KEEP_COUNT,
  DEFAULT_START_TIME,
  backupSettingsToEntries,
  checkBackupSettings,
  describeBackupPreflight,
  firstRunAtOrAfter,
  intervalToMinutes,
  isBackupEnabled,
  nextRunDueAtMs,
  resolveBackupSettings,
  shouldRunNow,
  toMinutesOfDay,
} from "./settings";
import { NO_FOLDER, type BackupSettings } from "./types";

function settings(overrides: Partial<BackupSettings> = {}): BackupSettings {
  return {
    enabled: true,
    attachmentRoot: "D:/backup/attachments",
    databaseRoot: "D:/backup/db",
    keepCount: 7,
    interval: "daily",
    startTime: "17:00",
    ...overrides,
  };
}

function rows(entries: Record<string, string>) {
  return Object.entries(entries).map(([key, value]) => ({ key, value }));
}

describe("resolveBackupSettings", () => {
  it("reads every stored value", () => {
    const resolved = resolveBackupSettings(
      rows({
        [BACKUP_SETTING_KEYS.enabled]: "true",
        [BACKUP_SETTING_KEYS.attachmentRoot]: "D:/a",
        [BACKUP_SETTING_KEYS.databaseRoot]: "D:/b",
        [BACKUP_SETTING_KEYS.keepCount]: "12",
        [BACKUP_SETTING_KEYS.interval]: "weekly",
        [BACKUP_SETTING_KEYS.startTime]: "05:30",
      }),
    );

    expect(resolved).toEqual({
      enabled: true,
      attachmentRoot: "D:/a",
      databaseRoot: "D:/b",
      keepCount: 12,
      interval: "weekly",
      startTime: "05:30",
    });
  });

  it("defaults to switched off when nothing is stored", () => {
    // An install that has never configured a backup must not start writing archives
    // into a folder nobody chose.
    const resolved = resolveBackupSettings([]);

    expect(resolved.enabled).toBe(false);
    expect(resolved.attachmentRoot).toBe("");
    expect(resolved.interval).toBe(DEFAULT_BACKUP_INTERVAL);
    expect(resolved.keepCount).toBe(DEFAULT_KEEP_COUNT);
    expect(resolved.startTime).toBe(DEFAULT_START_TIME);
  });

  it("maps the no-folder sentinel back to blank", () => {
    const resolved = resolveBackupSettings(
      rows({ [BACKUP_SETTING_KEYS.attachmentRoot]: NO_FOLDER }),
    );

    expect(resolved.attachmentRoot).toBe("");
  });

  it("degrades a nonsense interval, keep count and time to the safe defaults", () => {
    // These run inside a background tick, where a throw would be invisible.
    const resolved = resolveBackupSettings(
      rows({
        [BACKUP_SETTING_KEYS.interval]: "every 7 minutes",
        [BACKUP_SETTING_KEYS.keepCount]: "9000",
        [BACKUP_SETTING_KEYS.startTime]: "25:99",
      }),
    );

    expect(resolved.interval).toBe(DEFAULT_BACKUP_INTERVAL);
    expect(resolved.keepCount).toBe(DEFAULT_KEEP_COUNT);
    expect(resolved.startTime).toBe(DEFAULT_START_TIME);
  });
});

describe("backupSettingsToEntries", () => {
  it("writes the sentinel rather than a blank path", () => {
    // `settingUpdateSchema` rejects an empty value, so a blank would throw at the
    // boundary and the reader could never clear a path they had set.
    const entries = backupSettingsToEntries(settings({ attachmentRoot: "", databaseRoot: "" }));
    const byKey = new Map(entries.map((entry) => [entry.key, entry.value]));

    expect(byKey.get(BACKUP_SETTING_KEYS.attachmentRoot)).toBe(NO_FOLDER);
    expect(byKey.get(BACKUP_SETTING_KEYS.databaseRoot)).toBe(NO_FOLDER);
    expect(entries.every((entry) => entry.value !== "")).toBe(true);
  });

  it("round-trips through resolve unchanged", () => {
    const original = settings({ interval: "monthly", keepCount: 30 });
    expect(resolveBackupSettings(backupSettingsToEntries(original))).toEqual(original);
  });
});

describe("checkBackupSettings / isBackupEnabled", () => {
  it("passes when everything is set", () => {
    expect(checkBackupSettings(settings())).toEqual({ ok: true });
    expect(isBackupEnabled(settings())).toBe(true);
  });

  it("names the missing attachment folder", () => {
    const result = checkBackupSettings(settings({ attachmentRoot: "" }));

    expect(result).toEqual({ ok: false, failure: { kind: "attachment-root-not-set" } });
    expect(describeBackupPreflight({ kind: "attachment-root-not-set" })).toContain(
      "attachment backup folder",
    );
  });

  it("names the missing database folder", () => {
    expect(checkBackupSettings(settings({ databaseRoot: "" }))).toEqual({
      ok: false,
      failure: { kind: "database-root-not-set" },
    });
  });

  it("rejects an out-of-range keep count", () => {
    expect(checkBackupSettings(settings({ keepCount: 0 })).ok).toBe(false);
    expect(checkBackupSettings(settings({ keepCount: 101 })).ok).toBe(false);
    expect(checkBackupSettings(settings({ keepCount: 7.5 })).ok).toBe(false);
  });

  it("is not armed when switched on but unconfigured", () => {
    expect(isBackupEnabled(settings({ enabled: true, databaseRoot: "" }))).toBe(false);
  });

  it("is not armed when configured but switched off", () => {
    expect(isBackupEnabled(settings({ enabled: false }))).toBe(false);
  });
});

describe("intervalToMinutes", () => {
  it("maps each interval", () => {
    expect(intervalToMinutes("hourly")).toBe(60);
    expect(intervalToMinutes("daily")).toBe(24 * 60);
    expect(intervalToMinutes("weekly")).toBe(7 * 24 * 60);
    expect(intervalToMinutes("monthly")).toBe(30 * 24 * 60);
  });
});

describe("toMinutesOfDay / firstRunAtOrAfter", () => {
  it("reads an HH:MM anchor", () => {
    expect(toMinutesOfDay("17:00")).toBe(17 * 60);
    expect(toMinutesOfDay("00:30")).toBe(30);
  });

  it("finds today's anchor when it is still ahead", () => {
    const morning = new Date(2026, 9, 9, 9, 0, 0).getTime();
    expect(firstRunAtOrAfter(morning, "17:00")).toBe(new Date(2026, 9, 9, 17, 0, 0).getTime());
  });

  it("rolls to tomorrow when the anchor has passed", () => {
    const evening = new Date(2026, 9, 9, 18, 0, 0).getTime();
    expect(firstRunAtOrAfter(evening, "17:00")).toBe(new Date(2026, 9, 10, 17, 0, 0).getTime());
  });
});

describe("shouldRunNow", () => {
  it("waits for the anchor on a job that has never run", () => {
    // Setting "every day at 17:00" at breakfast should not take a backup immediately.
    const breakfast = new Date(2026, 9, 9, 8, 0, 0).getTime();
    expect(shouldRunNow(undefined, settings(), breakfast)).toBe(false);
  });

  it("runs once the anchor has passed on a job that has never run", () => {
    const evening = new Date(2026, 9, 9, 17, 30, 0).getTime();
    expect(shouldRunNow(undefined, settings(), evening)).toBe(true);
  });

  it("waits a full interval after a run", () => {
    const lastRun = new Date(2026, 9, 9, 17, 0, 0).getTime();
    const anHourLater = lastRun + 60 * 60_000;

    expect(shouldRunNow(lastRun, settings({ interval: "daily" }), anHourLater)).toBe(false);
    expect(shouldRunNow(lastRun, settings({ interval: "hourly" }), anHourLater)).toBe(true);
  });
});

describe("nextRunDueAtMs", () => {
  it("is undefined when the job is switched off", () => {
    expect(nextRunDueAtMs(1_000, settings({ enabled: false }), 2_000)).toBeUndefined();
  });

  it("is the anchor time for a job that has never run", () => {
    const morning = new Date(2026, 9, 9, 9, 0, 0).getTime();
    expect(nextRunDueAtMs(undefined, settings(), morning)).toBe(
      new Date(2026, 9, 9, 17, 0, 0).getTime(),
    );
  });

  it("is one interval after the last run", () => {
    const lastRun = new Date(2026, 9, 9, 17, 0, 0).getTime();
    expect(nextRunDueAtMs(lastRun, settings({ interval: "weekly" }), lastRun)).toBe(
      lastRun + 7 * 24 * 60 * 60_000,
    );
  });
});
