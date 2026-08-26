import { describe, expect, it } from "vitest";
import type { ModuleSetting } from "@/lib/module-settings";
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

describe("resolveScheduledRefreshSettings", () => {
  it("reads an enabled switch and an explicit interval", () => {
    const settings = resolveScheduledRefreshSettings([
      setting("auto_refresh_enabled", "true"),
      setting("auto_refresh_interval", "hourly"),
    ]);

    expect(settings).toEqual({ autoRefreshEnabled: true, autoRefreshInterval: "hourly" });
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

    expect(settings).toEqual({ autoRefreshEnabled: true, autoRefreshInterval: "half-daily" });
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
    const original = { autoRefreshEnabled: true, autoRefreshInterval: "half-daily" } as const;
    const rows = scheduledRefreshSettingsToEntries(original).map((entry) =>
      setting(entry.key, entry.value),
    );

    expect(resolveScheduledRefreshSettings(rows)).toEqual(original);
  });

  it("keeps the chosen interval even when the switch is off", () => {
    const entries = scheduledRefreshSettingsToEntries({
      autoRefreshEnabled: false,
      autoRefreshInterval: "hourly",
    });

    // So turning the switch back on doesn't silently reset the cadence to daily.
    expect(entries).toEqual([
      { key: "auto_refresh_enabled", value: "false" },
      { key: "auto_refresh_interval", value: "hourly" },
    ]);
  });
});

describe("shouldRunNow", () => {
  it("runs on the first tick when the job has never run", () => {
    expect(shouldRunNow(undefined, "daily", 1_000)).toBe(true);
  });

  it("waits until the interval has fully elapsed", () => {
    const lastRun = 10 * HOUR;

    expect(shouldRunNow(lastRun, "hourly", lastRun + 59 * MINUTE)).toBe(false);
    expect(shouldRunNow(lastRun, "hourly", lastRun + HOUR)).toBe(true);
  });

  it("scales with the chosen interval", () => {
    const lastRun = 0;
    const thirteenHours = 13 * HOUR;

    expect(shouldRunNow(lastRun, "hourly", thirteenHours)).toBe(true);
    expect(shouldRunNow(lastRun, "half-daily", thirteenHours)).toBe(true);
    expect(shouldRunNow(lastRun, "daily", thirteenHours)).toBe(false);
  });

  it("does not run again for a clock that went backwards", () => {
    // NTP correction on a NAS that booted with a bad clock. Not due is the safe
    // answer: the alternative is a refresh on every tick until time catches up.
    expect(shouldRunNow(100 * HOUR, "daily", 1 * HOUR)).toBe(false);
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
  it("is enabled purely by the switch", () => {
    expect(isAutoRefreshEnabled({ autoRefreshEnabled: true, autoRefreshInterval: "daily" })).toBe(true);
    expect(isAutoRefreshEnabled({ autoRefreshEnabled: false, autoRefreshInterval: "daily" })).toBe(false);
  });

  it("reports the next due time one interval after the last run", () => {
    expect(
      nextRunDueAtMs(HOUR, { autoRefreshEnabled: true, autoRefreshInterval: "hourly" }),
    ).toBe(2 * HOUR);
  });

  it("has no next run when off, or when nothing has run yet", () => {
    expect(nextRunDueAtMs(HOUR, { autoRefreshEnabled: false, autoRefreshInterval: "hourly" })).toBeUndefined();
    expect(
      nextRunDueAtMs(undefined, { autoRefreshEnabled: true, autoRefreshInterval: "hourly" }),
    ).toBeUndefined();
  });
});
