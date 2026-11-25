// Which classes a summary surface (the home screen's Classroom panel) should offer.
//
// Its own file, beside `weekday.ts`, for the same reason: a rule about dates over a
// plain list, with no repository in it.

import { weekdayOfIsoDate } from "./weekday";
import { CLASS_WEEKDAY_UNSET } from "./types";

/** The least a caller must tell us about a class to rank it. */
interface RankableClass {
  id: number;
  name: string;
  /** 1 = Monday to 5 = Friday, or `CLASS_WEEKDAY_UNSET`. */
  classWeekday: number;
  enrolledCount: number;
}

/** A class chosen for a short list, with whether it meets on the day asked about. */
export interface TopClass {
  id: number;
  name: string;
  enrolledCount: number;
  meetsToday: boolean;
}

/**
 * The first `count` classes worth offering on `isoDate`.
 *
 * **Classes that meet that weekday come first**, because the question a teacher
 * opens the app with is "who am I taking attendance for now". The rest follow in
 * the order given — callers pass `listClasses()`, which is name-sorted, so the
 * list is stable across reloads rather than arbitrary.
 *
 * Weekends, and classes with no weekday set, simply match nothing: the list then
 * reads as the first `count` classes by name, which is the honest fallback.
 * "Top" has no usage data behind it (nothing records which class is opened most),
 * so this ranks by schedule rather than pretending to a popularity it can't know.
 */
export function pickTopClasses(
  classes: readonly RankableClass[],
  isoDate: string,
  count: number,
): TopClass[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`pickTopClasses: count must be a non-negative integer, got ${count}.`);
  }

  const weekday = weekdayOfIsoDate(isoDate);
  const meets = (item: RankableClass) =>
    weekday !== CLASS_WEEKDAY_UNSET && item.classWeekday === weekday;

  // Stable partition: `filter` keeps the given order inside each half.
  const today = classes.filter(meets);
  const others = classes.filter((item) => !meets(item));

  return [...today, ...others].slice(0, count).map((item) => ({
    id: item.id,
    name: item.name,
    enrolledCount: item.enrolledCount,
    meetsToday: meets(item),
  }));
}
