"use server";

// The one read behind the Calendar cell's **Today in history** dialog: every
// entry filed on the same month and day as the cell that was pressed, in any
// year.
//
// An action rather than a prop from `journal-calendar-panel.tsx`, because the
// calendar server-reads **one period** — a month is 42 days, a year 380 — and
// this question reaches outside it by definition. Pre-reading all 366 answers so
// the grid could be handed one would be the whole journal, shipped to the client
// so a reader might press one square.
//
// The writes the dialog's grid performs are the shared ones in
// journal-bulk-actions.ts, under the `{ tab: "onThisDay" }` refresh scope. This
// file holds the read alone.

import { listEntriesOnMonthDay, type OnThisDayRow } from "@/lib/journal";
// Clips is read here, in the presentation layer, so `src/lib/journal` never has
// to import `src/lib/clips` — the Journal must not know about Clips, or the two
// library modules would import each other. Same reasoning as
// journal-correct-panel.tsx.
import { countClipsForTargets } from "@/lib/clips";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "journal";

export interface OnThisDayResult {
  ok: boolean;
  error?: string;
  /**
   * The matching entries, newest first, each with `content` blanked and a
   * 100-word `excerpt` in its place — the dialog's Content column.
   */
  entries?: OnThisDayRow[];
  /**
   * Clips attached per entry id, for the grid's paperclip badge. A plain object
   * rather than the Map `countClipsForTargets` returns: this crosses the
   * server/client boundary, and a Map is not serialisable.
   */
  clipCounts?: Record<number, number>;
}

/**
 * Every entry sharing `date`'s month and day, across every year.
 *
 * **Includes the clicked date's own year and its Log entries**, unlike
 * `listTodayInHistory` behind the home screen's card. See the docblock on
 * src/lib/journal/on-this-day.ts for why the two deliberately disagree.
 */
export async function onThisDayEntriesAction(date: string): Promise<OnThisDayResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const entries = listEntriesOnMonthDay(deps.journalRepo, date);
    // One query for the whole list, not one per row: `countClipsForTargets`
    // groups in SQL, and ids with no clips are simply absent from the map.
    const clipCounts = countClipsForTargets(
      deps.clipsRepo,
      "journal",
      entries.map((entry) => entry.id),
    );
    return { ok: true, entries, clipCounts: Object.fromEntries(clipCounts) };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Failed to read that day's entries in history.",
    };
  }
}
