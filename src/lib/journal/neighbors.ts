// "Which day near this one actually has an entry?" — the logic behind the
// calendar's « » jump buttons.
//
// This can't be answered from the grid the calendar is already holding. That
// grid is one period's worth of entries, and the whole point of the jump is to
// cross an empty stretch that may be longer than the period: pressing » in a
// month with nothing after the 3rd should land on the next entry even if it is
// four months away. So it asks the repository, which answers with an indexed
// single-row read rather than by loading a range and scanning it.

import type { JournalRepository } from "./ports";

/** Which way to look from the starting date. */
export type AdjacentEntryDirection = "prev" | "next";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const DIRECTIONS: readonly AdjacentEntryDirection[] = ["prev", "next"];

export function isAdjacentEntryDirection(value: string): value is AdjacentEntryDirection {
  return (DIRECTIONS as readonly string[]).includes(value);
}

export interface FindAdjacentEntryDateOptions {
  /** The day to look out from, "YYYY-MM-DD". Not itself a candidate. */
  from: string;
  direction: AdjacentEntryDirection;
}

/**
 * The nearest date **strictly** before (`prev`) or after (`next`) `from` that
 * has at least one entry, or `undefined` when there is none in that direction.
 *
 * Strict on purpose: pressing » twice from a day that has an entry should walk
 * forward two entry-days, not stick on the first one. `undefined` is the honest
 * answer at either end of the journal — the caller disables its button rather
 * than reporting an error, because "no earlier entry" is a normal state, not a
 * failure.
 */
export function findAdjacentEntryDate(
  repo: JournalRepository,
  { from, direction }: FindAdjacentEntryDateOptions,
): string | undefined {
  if (!ISO_DATE_PATTERN.test(from)) {
    throw new Error(`findAdjacentEntryDate: from must be YYYY-MM-DD, got "${from}".`);
  }
  if (!isAdjacentEntryDirection(direction)) {
    throw new Error(`findAdjacentEntryDate: direction must be "prev" or "next", got "${direction}".`);
  }
  return repo.findAdjacentEntryDate(from, direction);
}
