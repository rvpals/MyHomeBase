import { describe, expect, it } from "vitest";
import { handAngles, hourMarkAngles } from "./analog";

// A local-time Date, built from parts so these cases don't depend on the host timezone
// the way `new Date("2026-09-15T06:30:00")` would.
function at(hours: number, minutes: number, seconds: number): Date {
  return new Date(2026, 8, 15, hours, minutes, seconds);
}

describe("handAngles", () => {
  it("puts every hand at 0 at midnight", () => {
    expect(handAngles(at(0, 0, 0))).toEqual({ hour: 0, minute: 0, second: 0 });
  });

  it("maps noon to 0 too, since the face is 12-hour", () => {
    expect(handAngles(at(12, 0, 0))).toEqual({ hour: 0, minute: 0, second: 0 });
  });

  it("puts 3 o'clock's hour hand at 90 degrees", () => {
    expect(handAngles(at(3, 0, 0)).hour).toBe(90);
  });

  it("sweeps the hour hand between the marks", () => {
    // The case a naive `hours * 30` gets wrong: at 6:30 the hour hand belongs halfway
    // between 6 (180) and 7 (210), not squarely on 180.
    expect(handAngles(at(6, 30, 0)).hour).toBe(195);
  });

  it("sweeps the minute hand with the seconds", () => {
    // Halfway through the minute, so halfway between the 10 and 11 minute marks.
    expect(handAngles(at(1, 10, 30)).minute).toBe(63);
  });

  it("puts the second hand at 180 on the half minute", () => {
    expect(handAngles(at(1, 1, 30)).second).toBe(180);
  });

  it("keeps every hand under a full turn at the last second of the cycle", () => {
    const angles = handAngles(at(11, 59, 59));
    expect(angles.hour).toBeLessThan(360);
    expect(angles.minute).toBeLessThan(360);
    expect(angles.second).toBeLessThan(360);
    // Just shy of the top of the dial, not past it.
    expect(angles.hour).toBeCloseTo(359.5, 1);
  });

  it("ignores milliseconds, which the once-a-second repaint could not show anyway", () => {
    const whole = new Date(2026, 8, 15, 4, 20, 10, 0);
    const fraction = new Date(2026, 8, 15, 4, 20, 10, 999);
    expect(handAngles(whole)).toEqual(handAngles(fraction));
  });
});

describe("hourMarkAngles", () => {
  it("gives 12 marks, 30 degrees apart, starting at the top", () => {
    const marks = hourMarkAngles();
    expect(marks).toHaveLength(12);
    expect(marks[0]).toBe(0);
    expect(marks[3]).toBe(90);
    expect(marks[11]).toBe(330);
  });

  it("agrees with the hour hand on every mark", () => {
    // The two must not drift apart: a dial whose ticks don't line up with its hand is
    // the bug this shared constant exists to prevent.
    for (const [hour, angle] of hourMarkAngles().entries()) {
      expect(handAngles(at(hour, 0, 0)).hour).toBe(angle);
    }
  });
});
