import { describe, expect, it } from "vitest";
import { CLASS_WEEKDAY_UNSET } from "./types";
import { resolveWeekdayClassId, weekdayOfIsoDate } from "./weekday";

// September 2026, for the dates used below:
//   Mon 7th, Tue 1st, Wed 2nd, Thu 3rd, Fri 4th, Sat 5th, Sun 6th.

const MONDAY = "2026-09-07";
const WEDNESDAY = "2026-09-02";
const FRIDAY = "2026-09-04";
const SATURDAY = "2026-09-05";
const SUNDAY = "2026-09-06";

/** A class list in the order `listClasses()` returns — sorted by name. */
function classes(...pairs: [id: number, classWeekday: number][]) {
  return pairs.map(([id, classWeekday]) => ({ id, classWeekday }));
}

describe("weekdayOfIsoDate", () => {
  it("numbers the days the way Date.getDay() does", () => {
    expect(weekdayOfIsoDate(SUNDAY)).toBe(0);
    expect(weekdayOfIsoDate(MONDAY)).toBe(1);
    expect(weekdayOfIsoDate(WEDNESDAY)).toBe(3);
    expect(weekdayOfIsoDate(FRIDAY)).toBe(5);
    expect(weekdayOfIsoDate(SATURDAY)).toBe(6);
  });

  it("reads the date on the local calendar, not in UTC", () => {
    // `new Date("2026-09-07")` is UTC midnight, which is still Sunday evening in
    // every negative-offset timezone — this must be Monday regardless.
    expect(weekdayOfIsoDate(MONDAY)).toBe(1);
  });

  it("rejects anything that isn't a real YYYY-MM-DD date", () => {
    expect(() => weekdayOfIsoDate("07/09/2026")).toThrow();
    expect(() => weekdayOfIsoDate("2026-02-31")).toThrow();
  });
});

describe("resolveWeekdayClassId", () => {
  it("finds the class meeting on the day", () => {
    const list = classes([7, 1], [8, 3], [9, 5]);

    expect(resolveWeekdayClassId(list, MONDAY)).toBe(7);
    expect(resolveWeekdayClassId(list, WEDNESDAY)).toBe(8);
    expect(resolveWeekdayClassId(list, FRIDAY)).toBe(9);
  });

  it("finds nothing on a weekday no class claims", () => {
    expect(resolveWeekdayClassId(classes([7, 1]), FRIDAY)).toBeUndefined();
  });

  it("finds nothing at the weekend", () => {
    // Saturday is 6 and Sunday is 0, and neither is storable — so a weekend can
    // only ever fall through to the caller's default.
    const list = classes([7, 1], [8, 2], [9, 3], [10, 4], [11, 5]);

    expect(resolveWeekdayClassId(list, SATURDAY)).toBeUndefined();
    expect(resolveWeekdayClassId(list, SUNDAY)).toBeUndefined();
  });

  it("never matches a class with no weekday set, not even on a Sunday", () => {
    // The regression this guards: an unset class stores 0 and getDay() returns 0
    // on a Sunday, so a naive equality check would open every Sunday on a class
    // nobody had configured.
    const list = classes([7, CLASS_WEEKDAY_UNSET]);

    expect(resolveWeekdayClassId(list, SUNDAY)).toBeUndefined();
    expect(resolveWeekdayClassId(list, MONDAY)).toBeUndefined();
  });

  it("takes the first of several classes sharing a weekday", () => {
    // A Monday morning and a Monday afternoon class is ordinary. Callers pass
    // the name-sorted list, so "first" is stable rather than arbitrary.
    expect(resolveWeekdayClassId(classes([7, 1], [8, 1]), MONDAY)).toBe(7);
  });

  it("finds nothing in an empty class list", () => {
    expect(resolveWeekdayClassId([], MONDAY)).toBeUndefined();
  });
});
