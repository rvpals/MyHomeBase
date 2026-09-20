import { describe, expect, it } from "vitest";
import {
  clampTimerSeconds,
  describeCountdown,
  formatCountdown,
  hasExpired,
  hoursMinutesToSeconds,
  MAX_SLEEP_TIMER_SECONDS,
  MIN_SLEEP_TIMER_SECONDS,
  remainingSeconds,
  SLEEP_TIMER_PRESETS,
} from "./sleep-timer";

// The sleep timer's arithmetic, pinned away from the interval that drives it.
//
// The cases worth having are the ones a real listener produces: an empty number field
// (NaN), a mistyped hour, and the boundary where the timer fires -- because "stops the
// music one second early" and "never stops the music" are both silent failures.

describe("hoursMinutesToSeconds", () => {
  it("adds the two fields", () => {
    expect(hoursMinutesToSeconds(1, 30)).toBe(5400);
    expect(hoursMinutesToSeconds(0, 20)).toBe(1200);
    expect(hoursMinutesToSeconds(4, 0)).toBe(14400);
  });

  it("treats an empty field as zero rather than throwing", () => {
    // What `Number("")` hands over from an <input type="number">.
    expect(hoursMinutesToSeconds(Number.NaN, 45)).toBe(2700);
    expect(hoursMinutesToSeconds(2, Number.NaN)).toBe(7200);
    expect(hoursMinutesToSeconds(Number.NaN, Number.NaN)).toBe(0);
  });

  it("floors negatives and fractions to whole units", () => {
    expect(hoursMinutesToSeconds(-3, 10)).toBe(600);
    expect(hoursMinutesToSeconds(0, -10)).toBe(0);
    expect(hoursMinutesToSeconds(1.9, 30.7)).toBe(5400);
  });
});

describe("clampTimerSeconds", () => {
  it("passes a sensible duration through", () => {
    expect(clampTimerSeconds(1200)).toBe(1200);
    expect(clampTimerSeconds(MIN_SLEEP_TIMER_SECONDS)).toBe(MIN_SLEEP_TIMER_SECONDS);
  });

  it("refuses anything under the minimum instead of rounding it up", () => {
    // Pressing Start with empty boxes means "not chosen yet" -- arming a one-minute
    // timer there would stop the music mid-song.
    expect(clampTimerSeconds(0)).toBeUndefined();
    expect(clampTimerSeconds(59)).toBeUndefined();
    expect(clampTimerSeconds(-600)).toBeUndefined();
    expect(clampTimerSeconds(Number.NaN)).toBeUndefined();
  });

  it("clamps an over-long duration down to the maximum", () => {
    expect(clampTimerSeconds(MAX_SLEEP_TIMER_SECONDS + 1)).toBe(MAX_SLEEP_TIMER_SECONDS);
    // A mistyped "99" in the hours box.
    expect(clampTimerSeconds(99 * 3600)).toBe(MAX_SLEEP_TIMER_SECONDS);
  });
});

describe("remainingSeconds", () => {
  it("counts down from the deadline", () => {
    expect(remainingSeconds(10_000, 0)).toBe(10);
    expect(remainingSeconds(10_000, 7_000)).toBe(3);
  });

  it("starts at the duration that was asked for", () => {
    // Rounded up, so a 60s timer reads 1:00 on its first tick, not 0:59.
    expect(remainingSeconds(60_000, 1)).toBe(60);
  });

  it("never goes negative once the deadline has passed", () => {
    expect(remainingSeconds(10_000, 10_000)).toBe(0);
    expect(remainingSeconds(10_000, 999_999)).toBe(0);
  });
});

describe("hasExpired", () => {
  it("is false while there is time left", () => {
    expect(hasExpired(10_000, 9_999)).toBe(false);
  });

  it("is true exactly at the deadline", () => {
    // Otherwise the countdown sits at 0:00 with the music still playing.
    expect(hasExpired(10_000, 10_000)).toBe(true);
  });

  it("is true after the deadline", () => {
    expect(hasExpired(10_000, 10_001)).toBe(true);
  });
});

describe("formatCountdown", () => {
  it("drops the hour field under an hour", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(9)).toBe("0:09");
    expect(formatCountdown(90)).toBe("1:30");
    expect(formatCountdown(3599)).toBe("59:59");
  });

  it("shows hours once there is one", () => {
    expect(formatCountdown(3600)).toBe("1:00:00");
    expect(formatCountdown(3930)).toBe("1:05:30");
    expect(formatCountdown(14400)).toBe("4:00:00");
  });

  it("reads as zero for a nonsense value", () => {
    expect(formatCountdown(-5)).toBe("0:00");
    expect(formatCountdown(Number.NaN)).toBe("0:00");
  });
});

describe("describeCountdown", () => {
  it("spells out the units rather than punctuating them", () => {
    // formatCountdown's "1:05:00" is announced as a time of day by most screen readers.
    expect(describeCountdown(3930)).toBe("1 hour 5 minutes left");
    expect(describeCountdown(7200)).toBe("2 hours left");
    expect(describeCountdown(1200)).toBe("20 minutes left");
  });

  it("counts seconds only in the last minute", () => {
    expect(describeCountdown(59)).toBe("59 seconds left");
    expect(describeCountdown(1)).toBe("1 second left");
    expect(describeCountdown(0)).toBe("0 seconds left");
  });
});

describe("SLEEP_TIMER_PRESETS", () => {
  it("lists the presets shortest first, all within the allowed range", () => {
    const minutes = SLEEP_TIMER_PRESETS.map((preset) => preset.minutes);

    expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
    for (const preset of SLEEP_TIMER_PRESETS) {
      expect(clampTimerSeconds(preset.minutes * 60)).toBe(preset.minutes * 60);
    }
  });
});
