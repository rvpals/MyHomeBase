// Pure — no I/O. Which class a screen should open on, given the day.
//
// Its own file rather than another function in attendance.ts: this is the one
// piece of the module that is a *rule* about dates rather than a use-case over
// the repository, and the home screen is not the only caller that will want it
// (the report screen's "today" default is the obvious next one).

import { parseIsoDateLocal } from "@/lib/shared/date";
import { CLASS_WEEKDAY_UNSET } from "./types";

/** The least a caller must tell us about a class to match it against a day. */
interface WeekdayCandidate {
  id: number;
  /** 1 = Monday to 5 = Friday, or `CLASS_WEEKDAY_UNSET`. */
  classWeekday: number;
}

/**
 * The weekday of a "YYYY-MM-DD" date as a `Date.getDay()` number.
 *
 * Local-calendar via `parseIsoDateLocal`, not `new Date(iso)` — the latter parses
 * a bare date string as UTC midnight, which is the previous day's evening in
 * every negative-offset timezone and would hand back yesterday's weekday for the
 * whole working day.
 */
export function weekdayOfIsoDate(isoDate: string): number {
  return parseIsoDateLocal(isoDate).getDay();
}

/**
 * The class that meets on `isoDate`, or `undefined` when none does.
 *
 * Three cases return `undefined`, and they are deliberately the same answer:
 * a weekend (nothing is stored as 0 or 6, so nothing can match), a weekday no
 * class claims, and a class list where nobody has set a weekday yet. In all
 * three the caller should fall through to whatever default it has — the point of
 * this function is to be confident or silent, never to guess.
 *
 * When several classes share the weekday — a Monday morning and a Monday
 * afternoon class is ordinary, which is why no unique index stops it — the
 * **first in the given order** wins. Callers pass `listClasses()`, which is
 * sorted by name, so the choice is stable across reloads rather than arbitrary;
 * the dropdown is still there to switch.
 */
export function resolveWeekdayClassId(
  classes: readonly WeekdayCandidate[],
  isoDate: string,
): number | undefined {
  const weekday = weekdayOfIsoDate(isoDate);

  // Guard rather than trust the data: an unset class stores 0, and getDay()
  // returns 0 on a Sunday, so without this every Sunday would open on the first
  // class nobody had configured.
  if (weekday === CLASS_WEEKDAY_UNSET) return undefined;

  return classes.find((item) => item.classWeekday === weekday)?.id;
}
