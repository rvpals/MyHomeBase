import { describe, expect, it } from "vitest";
import {
  BACKUP_SETTING_KEYS,
  DEFAULT_INTERVAL_COUNT,
  DEFAULT_INTERVAL_UNIT,
  DEFAULT_KEEP_COUNT,
  DEFAULT_START_TIME,
  backupSettingsToEntries,
  checkBackupSettings,
  describeBackupInterval,
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
    documentRoot: "D:/backup/documents",
    databaseRoot: "D:/backup/db",
    keepCount: 7,
    intervalCount: 1,
    intervalUnit: "day",
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
        [BACKUP_SETTING_KEYS.documentRoot]: "D:/d",
        [BACKUP_SETTING_KEYS.databaseRoot]: "D:/b",
        [BACKUP_SETTING_KEYS.keepCount]: "12",
        [BACKUP_SETTING_KEYS.intervalCount]: "6",
        [BACKUP_SETTING_KEYS.intervalUnit]: "hour",
        [BACKUP_SETTING_KEYS.startTime]: "05:30",
      }),
    );

    expect(resolved).toEqual({
      enabled: true,
      attachmentRoot: "D:/a",
      documentRoot: "D:/d",
      databaseRoot: "D:/b",
      keepCount: 12,
      intervalCount: 6,
      intervalUnit: "hour",
      startTime: "05:30",
    });
  });

  it("defaults to switched off when nothing is stored", () => {
    // An install that has never configured a backup must not start writing archives
    // into a folder nobody chose.
    const resolved = resolveBackupSettings([]);

    expect(resolved.enabled).toBe(false);
    expect(resolved.attachmentRoot).toBe("");
    expect(resolved.intervalCount).toBe(DEFAULT_INTERVAL_COUNT);
    expect(resolved.intervalUnit).toBe(DEFAULT_INTERVAL_UNIT);
    expect(resolved.keepCount).toBe(DEFAULT_KEEP_COUNT);
    expect(resolved.startTime).toBe(DEFAULT_START_TIME);
  });

  it("maps the no-folder sentinel back to blank", () => {
    const resolved = resolveBackupSettings(
      rows({ [BACKUP_SETTING_KEYS.attachmentRoot]: NO_FOLDER }),
    );

    expect(resolved.attachmentRoot).toBe("");
  });

  it("degrades a nonsense cadence, keep count and time to the safe defaults", () => {
    // These run inside a background tick, where a throw would be invisible.
    const resolved = resolveBackupSettings(
      rows({
        [BACKUP_SETTING_KEYS.intervalCount]: "every 7",
        [BACKUP_SETTING_KEYS.intervalUnit]: "fortnight",
        [BACKUP_SETTING_KEYS.keepCount]: "9000",
        [BACKUP_SETTING_KEYS.startTime]: "25:99",
      }),
    );

    expect(resolved.intervalCount).toBe(DEFAULT_INTERVAL_COUNT);
    expect(resolved.intervalUnit).toBe(DEFAULT_INTERVAL_UNIT);
    expect(resolved.keepCount).toBe(DEFAULT_KEEP_COUNT);
    expect(resolved.startTime).toBe(DEFAULT_START_TIME);
  });

  it("rejects a fractional or out-of-range count", () => {
    // `intervalCountSchema` is `int()` 1..1000 at the boundary, and the resolver has
    // to agree: a hand-edited row never passes through that schema.
    expect(
      resolveBackupSettings(rows({ [BACKUP_SETTING_KEYS.intervalCount]: "1.5" })).intervalCount,
    ).toBe(DEFAULT_INTERVAL_COUNT);
    expect(
      resolveBackupSettings(rows({ [BACKUP_SETTING_KEYS.intervalCount]: "0" })).intervalCount,
    ).toBe(DEFAULT_INTERVAL_COUNT);
    expect(
      resolveBackupSettings(rows({ [BACKUP_SETTING_KEYS.intervalCount]: "1001" })).intervalCount,
    ).toBe(DEFAULT_INTERVAL_COUNT);
  });

  it("ignores the superseded pre-0138 key", () => {
    // `backup_interval` is left in the table for the record (migrations/0138), but
    // nothing reads it. A row saying "weekly" must not quietly become the cadence.
    const resolved = resolveBackupSettings(rows({ backup_interval: "weekly" }));

    expect(resolved.intervalCount).toBe(DEFAULT_INTERVAL_COUNT);
    expect(resolved.intervalUnit).toBe(DEFAULT_INTERVAL_UNIT);
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
    const original = settings({ intervalCount: 30, intervalUnit: "day", keepCount: 30 });
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
    if (!result.ok) {
      expect(describeBackupPreflight(result.failure)).toContain("attachment backup folder");
    }
  });

  it("names the missing document folder", () => {
    const result = checkBackupSettings(settings({ documentRoot: "" }));

    expect(result).toEqual({ ok: false, failure: { kind: "document-root-not-set" } });
    if (!result.ok) {
      expect(describeBackupPreflight(result.failure)).toContain("document backup folder");
    }
  });

  it("names the missing database folder", () => {
    const result = checkBackupSettings(settings({ databaseRoot: "" }));

    expect(result).toEqual({ ok: false, failure: { kind: "database-root-not-set" } });
  });

  it("rejects an out-of-range keep count", () => {
    const result = checkBackupSettings(settings({ keepCount: 0 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("keep-count-invalid");
      expect(describeBackupPreflight(result.failure)).toContain("0");
    }
  });

  it("is not armed when switched on but unconfigured", () => {
    expect(isBackupEnabled(settings({ enabled: true, databaseRoot: "" }))).toBe(false);
  });

  it("is not armed when configured but switched off", () => {
    expect(isBackupEnabled(settings({ enabled: false }))).toBe(false);
  });
});

describe("intervalToMinutes", () => {
  it("multiplies the count by the unit", () => {
    expect(intervalToMinutes(settings({ intervalCount: 1, intervalUnit: "hour" }))).toBe(60);
    expect(intervalToMinutes(settings({ intervalCount: 6, intervalUnit: "hour" }))).toBe(360);
    expect(intervalToMinutes(settings({ intervalCount: 1, intervalUnit: "day" }))).toBe(24 * 60);
    expect(intervalToMinutes(settings({ intervalCount: 1, intervalUnit: "week" }))).toBe(
      7 * 24 * 60,
    );
  });

  it("does not round a sub-minute cadence", () => {
    // The heartbeat floor belongs to `shouldRunNow`, not here: 30 seconds really is
    // half a minute, and saying so keeps `nextRunDueAtMs` honest too.
    expect(intervalToMinutes(settings({ intervalCount: 30, intervalUnit: "second" }))).toBe(0.5);
  });
});

describe("describeBackupInterval", () => {
  it("reads as a sentence with the anchor", () => {
    expect(describeBackupInterval(settings({ intervalCount: 6, intervalUnit: "hour" }))).toBe(
      "every 6 hour(s), anchored to 17:00",
    );
  });

  it("appends the caveat below a minute", () => {
    const described = describeBackupInterval(
      settings({ intervalCount: 30, intervalUnit: "second" }),
    );

    expect(described).toContain("every 30 second(s)");
    expect(described).toContain("runs once a minute");
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

    expect(
      shouldRunNow(lastRun, settings({ intervalCount: 1, intervalUnit: "day" }), anHourLater),
    ).toBe(false);
    expect(
      shouldRunNow(lastRun, settings({ intervalCount: 1, intervalUnit: "hour" }), anHourLater),
    ).toBe(true);
  });

  it("honours a count greater than one", () => {
    // The whole point of the flexible cadence: "every 6 hours" was not expressible
    // under the old four-value enum.
    const lastRun = new Date(2026, 9, 9, 17, 0, 0).getTime();
    const sixHours = settings({ intervalCount: 6, intervalUnit: "hour" });

    expect(shouldRunNow(lastRun, sixHours, lastRun + 5 * 60 * 60_000)).toBe(false);
    expect(shouldRunNow(lastRun, sixHours, lastRun + 6 * 60 * 60_000)).toBe(true);
  });

  it("clamps a sub-minute cadence to the heartbeat", () => {
    // The scheduler ticks once a minute, so "every 30 seconds" fires once a minute
    // and no faster. Without the clamp this would be true at 30s too.
    const lastRun = new Date(2026, 9, 9, 17, 0, 0).getTime();
    const everyThirtySeconds = settings({ intervalCount: 30, intervalUnit: "second" });

    expect(shouldRunNow(lastRun, everyThirtySeconds, lastRun + 30_000)).toBe(false);
    expect(shouldRunNow(lastRun, everyThirtySeconds, lastRun + 60_000)).toBe(true);
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
    expect(
      nextRunDueAtMs(lastRun, settings({ intervalCount: 1, intervalUnit: "week" }), lastRun),
    ).toBe(lastRun + 7 * 24 * 60 * 60_000);
  });

  it("reports the clamped time for a sub-minute cadence", () => {
    // The card must show the time the job will actually fire, not one the 60s
    // heartbeat cannot hit.
    const lastRun = new Date(2026, 9, 9, 17, 0, 0).getTime();
    expect(
      nextRunDueAtMs(lastRun, settings({ intervalCount: 10, intervalUnit: "second" }), lastRun),
    ).toBe(lastRun + 60_000);
  });
});
