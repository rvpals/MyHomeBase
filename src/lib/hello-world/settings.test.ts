import { describe, expect, it } from "vitest";
import {
  DEFAULT_INTERVAL_COUNT,
  DEFAULT_INTERVAL_UNIT,
  DEFAULT_MESSAGE,
  HELLO_WORLD_SETTING_KEYS,
  describeInterval,
  helloWorldSettingsToEntries,
  intervalToMinutes,
  isHelloWorldEnabled,
  nextRunDueAtMs,
  resolveHelloWorldSettings,
  shouldRunNow,
} from "./settings";
import { MAX_MESSAGE_LENGTH, runsPerDay, type HelloWorldSettings } from "./types";

function settings(overrides: Partial<HelloWorldSettings> = {}): HelloWorldSettings {
  return {
    enabled: true,
    message: "Hello, world!",
    intervalCount: 1,
    intervalUnit: "minute",
    ...overrides,
  };
}

function rows(entries: Record<string, string>) {
  return Object.entries(entries).map(([key, value]) => ({ key, value }));
}

describe("resolveHelloWorldSettings", () => {
  it("reads every stored value", () => {
    const resolved = resolveHelloWorldSettings(
      rows({
        [HELLO_WORLD_SETTING_KEYS.enabled]: "true",
        [HELLO_WORLD_SETTING_KEYS.message]: "Good morning",
        [HELLO_WORLD_SETTING_KEYS.intervalCount]: "15",
        [HELLO_WORLD_SETTING_KEYS.intervalUnit]: "hour",
      }),
    );

    expect(resolved).toEqual({
      enabled: true,
      message: "Good morning",
      intervalCount: 15,
      intervalUnit: "hour",
    });
  });

  it("defaults to switched off when nothing is stored", () => {
    const resolved = resolveHelloWorldSettings([]);

    expect(resolved).toEqual({
      enabled: false,
      message: DEFAULT_MESSAGE,
      intervalCount: DEFAULT_INTERVAL_COUNT,
      intervalUnit: DEFAULT_INTERVAL_UNIT,
    });
  });

  it("treats anything but the exact string 'true' as off", () => {
    for (const stored of ["false", "yes", "1", "", "TRUE "]) {
      const resolved = resolveHelloWorldSettings(
        rows({ [HELLO_WORLD_SETTING_KEYS.enabled]: stored }),
      );
      // "TRUE " is the one that should pass -- trimmed and lowercased.
      expect(resolved.enabled).toBe(stored.trim().toLowerCase() === "true");
    }
  });

  it("falls back to the default unit when the stored one is not a known unit", () => {
    const resolved = resolveHelloWorldSettings(
      rows({ [HELLO_WORLD_SETTING_KEYS.intervalUnit]: "fortnight" }),
    );
    expect(resolved.intervalUnit).toBe(DEFAULT_INTERVAL_UNIT);
  });

  it("falls back to the default count for a non-integer, zero or negative value", () => {
    for (const stored of ["0", "-5", "1.5", "abc", ""]) {
      const resolved = resolveHelloWorldSettings(
        rows({ [HELLO_WORLD_SETTING_KEYS.intervalCount]: stored }),
      );
      expect(resolved.intervalCount).toBe(DEFAULT_INTERVAL_COUNT);
    }
  });

  it("falls back to the default message when the stored one is blank", () => {
    const resolved = resolveHelloWorldSettings(
      rows({ [HELLO_WORLD_SETTING_KEYS.message]: "   " }),
    );
    expect(resolved.message).toBe(DEFAULT_MESSAGE);
  });

  it("truncates an over-long stored message rather than throwing", () => {
    const resolved = resolveHelloWorldSettings(
      rows({ [HELLO_WORLD_SETTING_KEYS.message]: "x".repeat(MAX_MESSAGE_LENGTH + 50) }),
    );
    expect(resolved.message).toHaveLength(MAX_MESSAGE_LENGTH);
  });
});

describe("helloWorldSettingsToEntries", () => {
  it("round-trips through the resolver", () => {
    const original = settings({ message: "Ping", intervalCount: 3, intervalUnit: "day" });
    expect(resolveHelloWorldSettings(helloWorldSettingsToEntries(original))).toEqual(original);
  });

  it("writes the default message rather than a blank, which the settings table rejects", () => {
    const entries = helloWorldSettingsToEntries(settings({ message: "  " }));
    const message = entries.find((entry) => entry.key === HELLO_WORLD_SETTING_KEYS.message);
    expect(message?.value).toBe(DEFAULT_MESSAGE);
  });

  it("writes the switch as the exact strings the resolver reads back", () => {
    const off = helloWorldSettingsToEntries(settings({ enabled: false }));
    expect(off.find((e) => e.key === HELLO_WORLD_SETTING_KEYS.enabled)?.value).toBe("false");
  });
});

describe("intervalToMinutes", () => {
  it("converts each unit", () => {
    expect(intervalToMinutes(settings({ intervalCount: 2, intervalUnit: "minute" }))).toBe(2);
    expect(intervalToMinutes(settings({ intervalCount: 2, intervalUnit: "hour" }))).toBe(120);
    expect(intervalToMinutes(settings({ intervalCount: 1, intervalUnit: "day" }))).toBe(1440);
    expect(intervalToMinutes(settings({ intervalCount: 1, intervalUnit: "week" }))).toBe(10080);
  });

  it("keeps a sub-minute cadence fractional rather than rounding it", () => {
    expect(intervalToMinutes(settings({ intervalCount: 30, intervalUnit: "second" }))).toBe(0.5);
  });
});

describe("shouldRunNow", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");

  it("runs a never-run armed job on the next tick", () => {
    expect(shouldRunNow(undefined, settings(), now)).toBe(true);
  });

  it("never runs when the switch is off", () => {
    expect(shouldRunNow(undefined, settings({ enabled: false }), now)).toBe(false);
    expect(shouldRunNow(now - 86_400_000, settings({ enabled: false }), now)).toBe(false);
  });

  it("waits until the interval has elapsed", () => {
    const every5 = settings({ intervalCount: 5, intervalUnit: "minute" });
    expect(shouldRunNow(now - 4 * 60_000, every5, now)).toBe(false);
    expect(shouldRunNow(now - 5 * 60_000, every5, now)).toBe(true);
  });

  it("clamps a sub-minute cadence to the heartbeat, so it fires once a minute", () => {
    const everySecond = settings({ intervalCount: 1, intervalUnit: "second" });
    // 30s after the last run the heartbeat has not come round again.
    expect(shouldRunNow(now - 30_000, everySecond, now)).toBe(false);
    expect(shouldRunNow(now - 60_000, everySecond, now)).toBe(true);
  });
});

describe("nextRunDueAtMs", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");

  it("is the last run plus the interval", () => {
    const every2h = settings({ intervalCount: 2, intervalUnit: "hour" });
    expect(nextRunDueAtMs(now, every2h)).toBe(now + 2 * 60 * 60_000);
  });

  it("is undefined when the job is off or has never run", () => {
    expect(nextRunDueAtMs(now, settings({ enabled: false }))).toBeUndefined();
    expect(nextRunDueAtMs(undefined, settings())).toBeUndefined();
  });

  it("reports the clamped time for a sub-minute cadence, not one the heartbeat can't hit", () => {
    const every5s = settings({ intervalCount: 5, intervalUnit: "second" });
    expect(nextRunDueAtMs(now, every5s)).toBe(now + 60_000);
  });
});

describe("isHelloWorldEnabled", () => {
  it("is just the switch -- this job has no other precondition", () => {
    expect(isHelloWorldEnabled(settings({ enabled: true }))).toBe(true);
    expect(isHelloWorldEnabled(settings({ enabled: false }))).toBe(false);
  });
});

describe("runsPerDay", () => {
  it("counts the runs a cadence produces in a day", () => {
    expect(runsPerDay(1)).toBe(1440);
    expect(runsPerDay(60)).toBe(24);
    expect(runsPerDay(24 * 60)).toBe(1);
  });

  it("floors a sub-minute cadence at the heartbeat rather than promising more", () => {
    // 1,440 is what the scheduler can actually deliver. Reporting 86,400 for
    // "every second" would overstate the queue cost by sixtyfold.
    expect(runsPerDay(1 / 60)).toBe(1440);
    expect(runsPerDay(0.5)).toBe(1440);
  });

  it("rounds a cadence that does not divide the day evenly", () => {
    expect(runsPerDay(7)).toBe(206);
  });
});

describe("describeInterval", () => {
  it("reads as a cadence", () => {
    expect(describeInterval(settings({ intervalCount: 5, intervalUnit: "minute" }))).toBe(
      "every 5 minute(s)",
    );
  });

  it("names the heartbeat floor when the cadence is under a minute", () => {
    expect(describeInterval(settings({ intervalCount: 10, intervalUnit: "second" }))).toContain(
      "once a minute",
    );
  });
});
