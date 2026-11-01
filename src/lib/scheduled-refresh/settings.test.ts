import { describe, expect, it } from "vitest";
import type { ModuleSetting } from "@/lib/module-settings";
import type { ScheduledRefreshSettings } from "./types";
import {
  DEFAULT_REFRESH_INTERVAL,
  intervalToMinutes,
  isAutoRefreshEnabled,
  nextRunDueAtMs,
  resolveScheduledRefreshSettings,
  scheduledRefreshSettingsToEntries,
  shouldRunNow,
} from "./settings";

function setting(key: string, value: string): ModuleSetting {
  return { id: 1, moduleId: 1, key, value };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A trading day and a closed one, for the market-day gate. */
const WEDNESDAY = "2026-11-18";
const SATURDAY = "2026-11-28";
const THANKSGIVING = "2026-11-26";

function settingsOf(
  overrides: Partial<ScheduledRefreshSettings> = {},
): ScheduledRefreshSettings {
  return {
    autoRefreshEnabled: true,
    autoRefreshInterval: "daily",
    marketDaysOnly: true,
    ...overrides,
  };
}

describe("resolveScheduledRefreshSettings", () => {
  it("reads an enabled switch and an explicit interval", () => {
    const settings = resolveScheduledRefreshSettings([
      setting("auto_refresh_enabled", "true"),
      setting("auto_refresh_interval", "hourly"),
    ]);

    expect(settings).toEqual({
      autoRefreshEnabled: true,
      autoRefreshInterval: "hourly",
      // Absent, so on -- the default this install gets without a migration.
      marketDaysOnly: true,
    });
  });

  it("treats no rows at all as off — an install where the seed never landed stays disabled", () => {
    expect(resolveScheduledRefreshSettings([])).toEqual({
      autoRefreshEnabled: false,
      autoRefreshInterval: DEFAULT_REFRESH_INTERVAL,
    });
  });

  it("treats a missing switch as off, unlike the expense importer's absent switch", () => {
    const settings = resolveScheduledRefreshSettings([
      setting("auto_refresh_interval", "hourly"),
    ]);

    expect(settings.autoRefreshEnabled).toBe(false);
  });

  it("is tolerant of casing and surrounding whitespace", () => {
    const settings = resolveScheduledRefreshSettings([
      setting("auto_refresh_enabled", " TRUE "),
      setting("auto_refresh_interval", " half-daily "),
    ]);

    expect(settings).toEqual({
      autoRefreshEnabled: true,
      autoRefreshInterval: "half-daily",
      marketDaysOnly: true,
    });
  });

  it("falls back to the safe cadence when the interval is hand-edited to nonsense", () => {
    const settings = resolveScheduledRefreshSettings([
      setting("auto_refresh_enabled", "true"),
      setting("auto_refresh_interval", "every 7 minutes"),
    ]);

    // Degrades rather than throwing: this is parsed inside a background tick,
    // where an exception would go unseen.
    expect(settings.autoRefreshInterval).toBe(DEFAULT_REFRESH_INTERVAL);
  });

  it("defaults the market-day gate to ON when the key is absent", () => {
    // The one key here that defaults on, and the reason no migration seeds it:
    // an install that predates the setting starts skipping closed days without
    // anyone touching the screen.
    expect(
      resolveScheduledRefreshSettings([setting("auto_refresh_enabled", "true")]).marketDaysOnly,
    ).toBe(true);
    expect(resolveScheduledRefreshSettings([]).marketDaysOnly).toBe(true);
  });

  it("turns the market-day gate off only for an explicit 'false'", () => {
    expect(
      resolveScheduledRefreshSettings([setting("market_days_only", "false")]).marketDaysOnly,
    ).toBe(false);
    expect(
      resolveScheduledRefreshSettings([setting("market_days_only", " FALSE ")]).marketDaysOnly,
    ).toBe(false);

    // Anything unrecognised stays on, which is the safe direction here.
    for (const value of ["true", "", "0", "no", "nonsense"]) {
      expect(
        resolveScheduledRefreshSettings([setting("market_days_only", value)]).marketDaysOnly,
        value,
      ).toBe(true);
    }
  });

  it("reads anything other than 'true' as off", () => {
    for (const value of ["false", "0", "yes", "", "off"]) {
      expect(resolveScheduledRefreshSettings([setting("auto_refresh_enabled", value)]).autoRefreshEnabled).toBe(
        false,
      );
    }
  });
});

describe("scheduledRefreshSettingsToEntries", () => {
  it("round-trips through resolve", () => {
    const original = settingsOf({ autoRefreshInterval: "half-daily", marketDaysOnly: false });
    const rows = scheduledRefreshSettingsToEntries(original).map((entry) =>
      setting(entry.key, entry.value),
    );

    expect(resolveScheduledRefreshSettings(rows)).toEqual(original);
  });

  it("keeps the chosen interval even when the switch is off", () => {
    const entries = scheduledRefreshSettingsToEntries(
      settingsOf({ autoRefreshEnabled: false, autoRefreshInterval: "hourly" }),
    );

    // So turning the switch back on doesn't silently reset the cadence to daily.
    expect(entries).toEqual([
      { key: "auto_refresh_enabled", value: "false" },
      { key: "auto_refresh_interval", value: "hourly" },
      { key: "market_days_only", value: "true" },
    ]);
  });
});

describe("shouldRunNow", () => {
  it("runs on the first tick when the job has never run", () => {
    expect(shouldRunNow(undefined, settingsOf(), 1_000, WEDNESDAY)).toBe(true);
  });

  it("waits until the interval has fully elapsed", () => {
    const lastRun = 10 * HOUR;
    const hourly = settingsOf({ autoRefreshInterval: "hourly" });

    expect(shouldRunNow(lastRun, hourly, lastRun + 59 * MINUTE, WEDNESDAY)).toBe(false);
    expect(shouldRunNow(lastRun, hourly, lastRun + HOUR, WEDNESDAY)).toBe(true);
  });

  it("scales with the chosen interval", () => {
    const lastRun = 0;
    const thirteenHours = 13 * HOUR;

    expect(
      shouldRunNow(lastRun, settingsOf({ autoRefreshInterval: "hourly" }), thirteenHours, WEDNESDAY),
    ).toBe(true);
    expect(
      shouldRunNow(
        lastRun,
        settingsOf({ autoRefreshInterval: "half-daily" }),
        thirteenHours,
        WEDNESDAY,
      ),
    ).toBe(true);
    expect(
      shouldRunNow(lastRun, settingsOf({ autoRefreshInterval: "daily" }), thirteenHours, WEDNESDAY),
    ).toBe(false);
  });

  it("does not run again for a clock that went backwards", () => {
    // NTP correction on a NAS that booted with a bad clock. Not due is the safe
    // answer: the alternative is a refresh on every tick until time catches up.
    expect(shouldRunNow(100 * HOUR, settingsOf(), 1 * HOUR, WEDNESDAY)).toBe(false);
  });

  it("refuses a weekend and a holiday even when the interval is long past due", () => {
    const lastRun = 0;
    const longPastDue = 100 * HOUR;

    expect(shouldRunNow(lastRun, settingsOf(), longPastDue, SATURDAY)).toBe(false);
    expect(shouldRunNow(lastRun, settingsOf(), longPastDue, THANKSGIVING)).toBe(false);
    expect(shouldRunNow(lastRun, settingsOf(), longPastDue, WEDNESDAY)).toBe(true);
  });

  it("refuses a closed day even on the very first tick", () => {
    // The never-run shortcut must not outrank the calendar: an install that
    // first boots on a Sunday waits for Monday.
    expect(shouldRunNow(undefined, settingsOf(), 1_000, SATURDAY)).toBe(false);
    expect(shouldRunNow(undefined, settingsOf(), 1_000, WEDNESDAY)).toBe(true);
  });

  it("runs on a closed day once the market-day gate is switched off", () => {
    const off = settingsOf({ marketDaysOnly: false });

    expect(shouldRunNow(undefined, off, 1_000, SATURDAY)).toBe(true);
    expect(shouldRunNow(0, off, 100 * HOUR, THANKSGIVING)).toBe(true);
  });

  it("still honours the interval on a trading day with the gate off", () => {
    // Switching the gate off must not turn the job into "run every heartbeat".
    const off = settingsOf({ autoRefreshInterval: "hourly", marketDaysOnly: false });

    expect(shouldRunNow(10 * HOUR, off, 10 * HOUR + 59 * MINUTE, SATURDAY)).toBe(false);
  });
});

describe("intervalToMinutes", () => {
  it("maps each interval", () => {
    expect(intervalToMinutes("hourly")).toBe(60);
    expect(intervalToMinutes("half-daily")).toBe(720);
    expect(intervalToMinutes("daily")).toBe(1440);
  });
});

describe("isAutoRefreshEnabled / nextRunDueAtMs", () => {
  // Local midnight of a given day. `nextRunDueAtMs` reads the due date on the
  // server's own clock (see its comment), so these are built the same way.
  function localMidnight(isoDate: string): number {
    const [year, month, day] = isoDate.split("-").map(Number);
    return new Date(year, month - 1, day).getTime();
  }

  it("is enabled purely by the switch", () => {
    expect(isAutoRefreshEnabled(settingsOf())).toBe(true);
    expect(isAutoRefreshEnabled(settingsOf({ autoRefreshEnabled: false }))).toBe(false);
  });

  it("reports the next due time one interval after the last run", () => {
    // Midday Wednesday + an hour is still Wednesday, so nothing rolls.
    const lastRun = localMidnight(WEDNESDAY) + 12 * HOUR;

    expect(nextRunDueAtMs(lastRun, settingsOf({ autoRefreshInterval: "hourly" }))).toBe(
      lastRun + HOUR,
    );
  });

  it("has no next run when off, or when nothing has run yet", () => {
    const lastRun = localMidnight(WEDNESDAY) + 12 * HOUR;

    expect(
      nextRunDueAtMs(lastRun, settingsOf({ autoRefreshEnabled: false })),
    ).toBeUndefined();
    expect(nextRunDueAtMs(undefined, settingsOf())).toBeUndefined();
  });

  it("rolls a due time landing on a closed day forward to the next trading day", () => {
    // Friday midday + a day lands on Saturday, which the job will refuse. The
    // card must say Monday rather than promising a run it will not make.
    const friday = localMidnight("2026-11-27") + 12 * HOUR;

    expect(nextRunDueAtMs(friday, settingsOf({ autoRefreshInterval: "daily" }))).toBe(
      localMidnight("2026-11-30"),
    );
  });

  it("rolls past a holiday as well as a weekend", () => {
    // Wednesday midday + a day is Thanksgiving; the next trading day is Friday.
    const wednesday = localMidnight("2026-11-25") + 12 * HOUR;

    expect(nextRunDueAtMs(wednesday, settingsOf({ autoRefreshInterval: "daily" }))).toBe(
      localMidnight("2026-11-27"),
    );
  });

  it("does not roll when the gate is off", () => {
    const friday = localMidnight("2026-11-27") + 12 * HOUR;

    expect(
      nextRunDueAtMs(friday, settingsOf({ autoRefreshInterval: "daily", marketDaysOnly: false })),
    ).toBe(friday + 24 * HOUR);
  });
});
