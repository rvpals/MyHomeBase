import { describe, expect, it } from "vitest";
import type { BackupSettings } from "@/lib/backup/types";
import type { ExpenseSettings } from "@/lib/expense/settings";
import type { HelloWorldSettings } from "@/lib/hello-world/types";
import type { ScheduledRefreshSettings } from "@/lib/scheduled-refresh/types";
import { isJobArmed, listActiveTasks, listInactiveTasks, type JobSettings } from "./active-tasks";
import { listScheduledJobs } from "./jobs";
import { JOB_KEYS, type ScheduledRun } from "./types";

/** A stored run. The stamp is the SQLite-style UTC shape the table actually holds. */
function run(overrides: Partial<ScheduledRun> & { jobKey: string }): ScheduledRun {
  return { lastRunAt: "2026-08-26 04:00:00", ...overrides };
}

const STAMP_MS = Date.parse("2026-08-26T04:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function refreshSettings(
  overrides: Partial<ScheduledRefreshSettings> = {},
): ScheduledRefreshSettings {
  return { autoRefreshEnabled: true, autoRefreshInterval: "daily", ...overrides };
}

function expenseSettings(overrides: Partial<ExpenseSettings> = {}): ExpenseSettings {
  return {
    autoImportEnabled: true,
    autoImportPath: "C:/statements",
    autoImportIntervalMinutes: 60,
    ...overrides,
  };
}

/**
 * Configured but switched OFF by default, so the backup job stays out of the
 * assertions that are about the other four. The tests that care arm it explicitly.
 */
function backupSettings(overrides: Partial<BackupSettings> = {}): BackupSettings {
  return {
    enabled: false,
    attachmentRoot: "D:/backup/attachments",
    databaseRoot: "D:/backup/db",
    keepCount: 7,
    intervalCount: 1,
    intervalUnit: "day",
    startTime: "17:00",
    ...overrides,
  };
}

/** Switched OFF by default, for the same reason as the backup above. */
function helloWorldSettings(overrides: Partial<HelloWorldSettings> = {}): HelloWorldSettings {
  return {
    enabled: false,
    message: "Hello, world!",
    intervalCount: 1,
    intervalUnit: "minute",
    ...overrides,
  };
}

/** Every job's settings in one bag, with everything overridable per test. */
function allSettings(overrides: Partial<JobSettings> = {}): JobSettings {
  return {
    autoRefresh: refreshSettings(),
    expense: expenseSettings(),
    backup: backupSettings(),
    helloWorld: helloWorldSettings(),
    ...overrides,
  };
}

function rowsFor(runs: ScheduledRun[], overrides: Partial<JobSettings> = {}) {
  return listActiveTasks({
    jobs: listScheduledJobs(runs),
    ...allSettings(overrides),
    // Fixed so the never-run backup's anchor time is not read off the wall clock.
    nowMs: new Date(2026, 9, 9, 9, 0, 0).getTime(),
  });
}

describe("isJobArmed", () => {
  it("treats both prunes as always armed — they have no switch", () => {
    const settings = allSettings({
      autoRefresh: refreshSettings({ autoRefreshEnabled: false }),
      expense: expenseSettings({ autoImportPath: "" }),
    });

    expect(isJobArmed(JOB_KEYS.authEventPrune, settings)).toBe(true);
    expect(isJobArmed(JOB_KEYS.siteVisitPrune, settings)).toBe(true);
  });

  it("arms the stock refresh only when its switch is on", () => {
    expect(isJobArmed(JOB_KEYS.stockAutoRefresh, allSettings())).toBe(true);
    expect(
      isJobArmed(
        JOB_KEYS.stockAutoRefresh,
        allSettings({ autoRefresh: refreshSettings({ autoRefreshEnabled: false }) }),
      ),
    ).toBe(false);
  });

  it("needs switch AND folder AND interval to arm the expense importer", () => {
    // The case the card exists to get right: switched on but unconfigured is not
    // running, so it must not appear as an active task.
    expect(
      isJobArmed(
        JOB_KEYS.expenseAutoImport,
        allSettings({ expense: expenseSettings({ autoImportPath: "" }) }),
      ),
    ).toBe(false);
    expect(
      isJobArmed(
        JOB_KEYS.expenseAutoImport,
        allSettings({ expense: expenseSettings({ autoImportIntervalMinutes: 0 }) }),
      ),
    ).toBe(false);
    expect(
      isJobArmed(
        JOB_KEYS.expenseAutoImport,
        allSettings({ expense: expenseSettings({ autoImportEnabled: false }) }),
      ),
    ).toBe(false);
  });

  it("needs switch AND both folders to arm the data backup", () => {
    expect(
      isJobArmed(JOB_KEYS.dataBackup, allSettings({ backup: backupSettings({ enabled: true }) })),
    ).toBe(true);
    expect(isJobArmed(JOB_KEYS.dataBackup, allSettings())).toBe(false);
    expect(
      isJobArmed(
        JOB_KEYS.dataBackup,
        allSettings({ backup: backupSettings({ enabled: true, databaseRoot: "" }) }),
      ),
    ).toBe(false);
  });

  it("arms Hello, world! on its switch alone — it has no other precondition", () => {
    expect(
      isJobArmed(
        JOB_KEYS.helloWorld,
        allSettings({ helloWorld: helloWorldSettings({ enabled: true }) }),
      ),
    ).toBe(true);
    expect(isJobArmed(JOB_KEYS.helloWorld, allSettings())).toBe(false);
  });

  it("does not arm an unknown job key", () => {
    expect(isJobArmed("some_future_job", allSettings())).toBe(false);
  });
});

describe("listActiveTasks", () => {
  it("lists only armed jobs, in catalogue order", () => {
    const rows = rowsFor([run({ jobKey: JOB_KEYS.stockAutoRefresh, status: "ok" })], {
      autoRefresh: refreshSettings({ autoRefreshEnabled: false }),
      expense: expenseSettings({ autoImportPath: "" }),
    });

    expect(rows.map((row) => row.key)).toEqual([JOB_KEYS.authEventPrune, JOB_KEYS.siteVisitPrune]);
  });

  it("lists every job when everything is armed, in catalogue order", () => {
    const rows = rowsFor([], {
      backup: backupSettings({ enabled: true }),
      helloWorld: helloWorldSettings({ enabled: true }),
    });

    expect(rows.map((row) => row.key)).toEqual([
      JOB_KEYS.stockAutoRefresh,
      JOB_KEYS.expenseAutoImport,
      JOB_KEYS.authEventPrune,
      JOB_KEYS.dataBackup,
      JOB_KEYS.helloWorld,
      JOB_KEYS.siteVisitPrune,
    ]);
  });

  it("gives a never-run backup its anchor time, not 'pending'", () => {
    // Unlike the other jobs, the backup knows when it is next due even before its
    // first run: the next time its configured start time comes round.
    const rows = rowsFor([], { backup: backupSettings({ enabled: true }) });
    const backup = rows.find((row) => row.key === JOB_KEYS.dataBackup);

    expect(backup?.nextRun).toEqual({
      kind: "at",
      atMs: new Date(2026, 9, 9, 17, 0, 0).getTime(),
    });
    expect(backup?.status).toBe("never");
  });

  it("computes the stock refresh's next run from its interval", () => {
    const rows = rowsFor([run({ jobKey: JOB_KEYS.stockAutoRefresh, status: "ok", detail: "38 priced" })], {
      autoRefresh: refreshSettings({ autoRefreshInterval: "hourly" }),
    });
    const stocks = rows.find((row) => row.key === JOB_KEYS.stockAutoRefresh);

    expect(stocks?.nextRun).toEqual({ kind: "at", atMs: STAMP_MS + HOUR_MS });
    expect(stocks?.detail).toBe("38 priced");
  });

  it("computes the expense importer's next run from its interval in minutes", () => {
    const rows = rowsFor([run({ jobKey: JOB_KEYS.expenseAutoImport, status: "ok" })], {
      expense: expenseSettings({ autoImportIntervalMinutes: 30 }),
    });

    expect(rows.find((row) => row.key === JOB_KEYS.expenseAutoImport)?.nextRun).toEqual({
      kind: "at",
      atMs: STAMP_MS + 30 * 60_000,
    });
  });

  it("computes Hello, world!'s next run from its count and unit", () => {
    const rows = rowsFor([run({ jobKey: JOB_KEYS.helloWorld, status: "ok", detail: "Hi" })], {
      helloWorld: helloWorldSettings({ enabled: true, intervalCount: 2, intervalUnit: "hour" }),
    });
    const hello = rows.find((row) => row.key === JOB_KEYS.helloWorld);

    expect(hello?.nextRun).toEqual({ kind: "at", atMs: STAMP_MS + 2 * HOUR_MS });
    expect(hello?.detail).toBe("Hi");
  });

  it("shows Hello, world!'s sub-minute cadence at the heartbeat floor it can actually hit", () => {
    const rows = rowsFor([run({ jobKey: JOB_KEYS.helloWorld, status: "ok" })], {
      helloWorld: helloWorldSettings({ enabled: true, intervalCount: 5, intervalUnit: "second" }),
    });

    expect(rows.find((row) => row.key === JOB_KEYS.helloWorld)?.nextRun).toEqual({
      kind: "at",
      atMs: STAMP_MS + 60_000,
    });
  });

  it("gives the prunes a 24h window rather than an invented time", () => {
    // The prune timer is rearmed from zero on every boot and nothing records when
    // that was, so a precise `lastRun + 24h` would routinely be wrong.
    const rows = rowsFor([run({ jobKey: JOB_KEYS.authEventPrune, status: "ok" })]);

    expect(rows.find((row) => row.key === JOB_KEYS.authEventPrune)?.nextRun).toEqual({
      kind: "within",
      windowMs: DAY_MS,
      fromMs: STAMP_MS,
    });
  });

  it("reports an armed job that has never run as pending, not never-due", () => {
    const rows = rowsFor([]);

    expect(rows.every((row) => row.nextRun.kind === "pending")).toBe(true);
    expect(rows.every((row) => row.status === "never")).toBe(true);
    expect(rows.every((row) => row.lastRunAt === undefined)).toBe(true);
  });

  it("reports a run with no stored status as interrupted", () => {
    // The process died between the start stamp and the finish write. Claiming
    // "ok" here would be the worst possible lie on this screen.
    const rows = rowsFor([run({ jobKey: JOB_KEYS.stockAutoRefresh })]);

    expect(rows.find((row) => row.key === JOB_KEYS.stockAutoRefresh)?.status).toBe("interrupted");
  });

  it("carries failed and partial outcomes through unchanged", () => {
    const rows = rowsFor([
      run({ jobKey: JOB_KEYS.stockAutoRefresh, status: "failed", detail: "provider down" }),
      run({ jobKey: JOB_KEYS.expenseAutoImport, status: "partial", detail: "1 of 2 imported" }),
    ]);

    expect(rows.find((row) => row.key === JOB_KEYS.stockAutoRefresh)?.status).toBe("failed");
    expect(rows.find((row) => row.key === JOB_KEYS.expenseAutoImport)?.status).toBe("partial");
  });

  it("reads the stored stamp as UTC, not local time", () => {
    // Guards the drift this would otherwise have on a host in a non-UTC zone:
    // `Date.parse("2026-08-26 04:00:00")` is local in some engines.
    const rows = rowsFor([run({ jobKey: JOB_KEYS.stockAutoRefresh, status: "ok" })], {
      autoRefresh: refreshSettings({ autoRefreshInterval: "hourly" }),
    });
    const next = rows.find((row) => row.key === JOB_KEYS.stockAutoRefresh)?.nextRun;

    expect(next).toEqual({ kind: "at", atMs: Date.parse("2026-08-26T05:00:00Z") });
  });

  it("falls back to pending when a stored stamp is unparseable", () => {
    const rows = rowsFor([run({ jobKey: JOB_KEYS.stockAutoRefresh, lastRunAt: "not a date" })]);
    const stocks = rows.find((row) => row.key === JOB_KEYS.stockAutoRefresh);

    expect(stocks?.nextRun).toEqual({ kind: "pending" });
    // The row still reports the stamp it was given rather than hiding it.
    expect(stocks?.lastRunAt).toBe("not a date");
  });
});

describe("listInactiveTasks", () => {
  function inactiveFor(overrides: Partial<JobSettings> = {}) {
    return listInactiveTasks({ jobs: listScheduledJobs([]), ...allSettings(overrides) });
  }

  it("is the exact complement of listActiveTasks", () => {
    // The property worth protecting: every job is in exactly one tab, never both
    // and never neither. Two independent predicates would eventually disagree.
    const settings = allSettings({
      autoRefresh: refreshSettings({ autoRefreshEnabled: false }),
      expense: expenseSettings({ autoImportPath: "" }),
    });
    const jobs = listScheduledJobs([]);

    const active = listActiveTasks({ jobs, ...settings }).map((row) => row.key);
    const inactive = listInactiveTasks({ jobs, ...settings }).map((row) => row.key);

    expect([...active, ...inactive].sort()).toEqual(jobs.map((job) => job.descriptor.key).sort());
    expect(active.filter((key) => inactive.includes(key))).toEqual([]);
  });

  it("never lists the prunes — they have no switch", () => {
    const keys = inactiveFor().map((row) => row.key);

    expect(keys).not.toContain(JOB_KEYS.authEventPrune);
    expect(keys).not.toContain(JOB_KEYS.siteVisitPrune);
  });

  it("names the switch when a job is merely switched off", () => {
    const rows = inactiveFor({ autoRefresh: refreshSettings({ autoRefreshEnabled: false }) });
    const stocks = rows.find((row) => row.key === JOB_KEYS.stockAutoRefresh);

    expect(stocks?.reason).toContain("Switched off");
  });

  it("names the switch for Hello, world! — its only possible reason", () => {
    const hello = inactiveFor().find((row) => row.key === JOB_KEYS.helloWorld);

    expect(hello?.reason).toContain("Switched off");
  });

  it("names the missing folder ahead of the switch", () => {
    // Both are wrong, and turning the switch on would not start it — naming the
    // switch alone would send the reader in a circle.
    const rows = inactiveFor({
      expense: expenseSettings({ autoImportEnabled: false, autoImportPath: "" }),
    });

    expect(rows.find((row) => row.key === JOB_KEYS.expenseAutoImport)?.reason).toBe(
      "No watched folder is set.",
    );
  });

  it("names a zero interval", () => {
    const rows = inactiveFor({ expense: expenseSettings({ autoImportIntervalMinutes: 0 }) });

    expect(rows.find((row) => row.key === JOB_KEYS.expenseAutoImport)?.reason).toContain(
      "interval is 0",
    );
  });

  it("distinguishes which backup folder is missing", () => {
    const neither = inactiveFor({
      backup: backupSettings({ enabled: true, attachmentRoot: "", databaseRoot: "" }),
    });
    const justDatabase = inactiveFor({
      backup: backupSettings({ enabled: true, databaseRoot: "" }),
    });

    expect(neither.find((row) => row.key === JOB_KEYS.dataBackup)?.reason).toBe(
      "Neither backup folder is set.",
    );
    expect(justDatabase.find((row) => row.key === JOB_KEYS.dataBackup)?.reason).toBe(
      "No database backup folder is set.",
    );
  });

  it("carries the last run through so an idle job still shows its history", () => {
    const rows = listInactiveTasks({
      jobs: listScheduledJobs([
        run({ jobKey: JOB_KEYS.stockAutoRefresh, status: "failed", detail: "provider down" }),
      ]),
      ...allSettings({ autoRefresh: refreshSettings({ autoRefreshEnabled: false }) }),
    });
    const stocks = rows.find((row) => row.key === JOB_KEYS.stockAutoRefresh);

    expect(stocks?.status).toBe("failed");
    expect(stocks?.detail).toBe("provider down");
  });
});
