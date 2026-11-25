import { describe, expect, it } from "vitest";
import { pickTopClasses } from "./top-classes";

const cls = (id: number, name: string, classWeekday: number, enrolledCount = 10) => ({
  id,
  name,
  classWeekday,
  enrolledCount,
});

// 2026-11-23 is a Monday, 2026-11-28 a Saturday.
const MONDAY = "2026-11-23";
const SATURDAY = "2026-11-28";

describe("pickTopClasses", () => {
  const classes = [cls(1, "Art", 3), cls(2, "Band", 1), cls(3, "Chess", 5), cls(4, "Drama", 1)];

  it("puts the classes meeting that weekday first, keeping the given order", () => {
    expect(pickTopClasses(classes, MONDAY, 3).map((c) => c.id)).toEqual([2, 4, 1]);
  });

  it("flags which of them meet that day", () => {
    expect(pickTopClasses(classes, MONDAY, 3).map((c) => c.meetsToday)).toEqual([true, true, false]);
  });

  it("falls back to the given order on a weekend", () => {
    const picked = pickTopClasses(classes, SATURDAY, 3);
    expect(picked.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(picked.every((c) => !c.meetsToday)).toBe(true);
  });

  it("never matches a class with no weekday set, even on a Sunday", () => {
    // getDay() is 0 on a Sunday and an unset class stores 0.
    const picked = pickTopClasses([cls(1, "Unset", 0)], "2026-11-29", 3);
    expect(picked[0].meetsToday).toBe(false);
  });

  it("returns fewer when there are fewer classes, and nothing for none", () => {
    expect(pickTopClasses([cls(1, "Art", 1)], MONDAY, 3)).toHaveLength(1);
    expect(pickTopClasses([], MONDAY, 3)).toEqual([]);
  });

  it("carries the enrolled count through for the row label", () => {
    expect(pickTopClasses([cls(1, "Art", 1, 24)], MONDAY, 3)[0].enrolledCount).toBe(24);
  });

  it("rejects a negative or fractional count", () => {
    expect(() => pickTopClasses(classes, MONDAY, -1)).toThrow();
    expect(() => pickTopClasses(classes, MONDAY, 1.5)).toThrow();
  });
});
