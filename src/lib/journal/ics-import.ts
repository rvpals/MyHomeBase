// Turns parsed calendar events into journal entries: filter, preset, plan, write.
//
// Structured to match csv-import.ts deliberately -- one walk function that
// decides what each event would do, driven by both `planIcsImport` (writes
// nothing) and `importIcsEvents` (writes). The preview the reader confirms and
// the import that follows therefore cannot disagree.
//
// What differs from the CSV path, and why: a calendar event is matched on its
// UID rather than on date+time+title. A UID survives being renamed or moved in
// Google Calendar, so an edited event re-imports as the same entry instead of
// quietly duplicating. See migration 0088.

import { summarizeImportResults } from "@/lib/csv-import";
import type { ImportRowResult, ImportSummary } from "@/lib/csv-import";
import { createEntry, updateEntry } from "./journal";
import { parseIcsEvents } from "./ics-parse";
import type { JournalRepository } from "./ports";
import type { CreateEntryInput } from "./schema";
import type {
  IcsEvent,
  IcsImportFilter,
  IcsImportPlan,
  IcsImportPlanRow,
  IcsImportPresets,
  JournalEntry,
} from "./types";

/** The `source` value every entry from this importer carries. */
export const ICS_SOURCE = "ics";

/**
 * What separates the calendar's text from the reader's own inside `content`.
 *
 * A blank line, because that is what `icsEventToEntryInput` already uses to join
 * a note prefix to a DESCRIPTION — the two halves must be joined the same way
 * they are split, or a round trip would gain or lose blank lines each refresh.
 */
const CONTENT_JOIN = "\n\n";

/**
 * Splits a stored `content` into the part the calendar wrote and the part the
 * reader added, given what the importer last wrote there (`externalContent`).
 *
 * The external text is expected at the *start*, which is where
 * `icsEventToEntryInput` puts it. Three cases, in order:
 *
 * - **`externalContent` is `""`** — nothing is known to be external, so all of
 *   it is the reader's. This is the pre-0089 entry, and the conservative
 *   reading: the opposite would delete exactly the notes 0089 exists to protect,
 *   on the first refresh.
 * - **The content still starts with it** — the remainder (minus the joining
 *   blank line) is the reader's.
 * - **It doesn't match** — the reader has edited the calendar's half too. Their
 *   version wins whole; the importer will not try to guess which words were
 *   once its own.
 */
export function splitExternalContent(
  content: string,
  externalContent: string,
): { local: string; known: boolean } {
  // Nothing is known to be external. `known: false` tells the caller it must not
  // prepend the calendar's text -- the stored content may already contain a copy
  // of it (a pre-0089 import wrote it there), and prepending would duplicate it.
  if (externalContent === "") return { local: content, known: false };

  if (content === externalContent) return { local: "", known: true };

  if (content.startsWith(externalContent)) {
    const rest = content.slice(externalContent.length);
    return {
      local: rest.startsWith(CONTENT_JOIN) ? rest.slice(CONTENT_JOIN.length) : rest,
      known: true,
    };
  }

  // The reader has edited the calendar's half too, so which words were once the
  // importer's is no longer recoverable. Their version wins whole, and is left
  // alone rather than having the calendar's text pushed back on top of it.
  return { local: content, known: false };
}

/** Joins the calendar's text and the reader's, dropping either if it is empty. */
function joinContent(external: string, local: string): string {
  if (external === "") return local;
  if (local === "") return external;
  return `${external}${CONTENT_JOIN}${local}`;
}

/**
 * Adds `incoming` names to `existing` without duplicating, comparing
 * case-insensitively and keeping the stored spelling.
 *
 * Merge rather than replace is what lets a tag the reader added by hand survive
 * a refresh. The consequence, noted in 0089: a *preset* tag they deliberately
 * removed comes back, because nothing records that it once arrived from a preset.
 */
function mergeNames(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map((name) => name.trim().toLowerCase()));
  const merged = [...existing];
  for (const name of incoming) {
    const key = name.trim().toLowerCase();
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    merged.push(name);
  }
  return merged;
}

/** Empty presets — what the wizard's step 3 starts from before `Log` is applied. */
export function emptyIcsPresets(): IcsImportPresets {
  return {
    categories: [],
    tags: [],
    placeName: "",
    notePrefix: "",
    preserveLocalEdits: true,
  };
}

/** A filter that matches every event — the wizard's step 2 default. */
export function emptyIcsFilter(): IcsImportFilter {
  return {
    fromDate: "",
    toDate: "",
    summaryContains: "",
    summaryExcludes: "",
    requireSummary: false,
    includeAllDay: true,
  };
}

/**
 * Narrows a file's events with the wizard's filter. Conditions combine with AND;
 * an empty filter returns everything, in the order the file listed it.
 *
 * Date bounds compare YYYY-MM-DD strings directly — lexicographic order is
 * chronological order for that format, which is why the column is stored that
 * way (0027).
 */
export function filterIcsEvents(events: IcsEvent[], filter: IcsImportFilter): IcsEvent[] {
  const from = (filter.fromDate ?? "").trim();
  const to = (filter.toDate ?? "").trim();
  const contains = (filter.summaryContains ?? "").trim().toLowerCase();
  const excludes = (filter.summaryExcludes ?? "").trim().toLowerCase();
  const requireSummary = filter.requireSummary ?? false;
  const includeAllDay = filter.includeAllDay ?? true;

  return events.filter((event) => {
    if (from !== "" && event.date < from) return false;
    if (to !== "" && event.date > to) return false;
    if (!includeAllDay && event.isAllDay) return false;

    const summary = event.summary.trim();
    if (requireSummary && summary === "") return false;

    const haystack = summary.toLowerCase();
    if (contains !== "" && !haystack.includes(contains)) return false;
    // An empty summary can't contain anything, so it is never excluded by this.
    if (excludes !== "" && haystack.includes(excludes)) return false;

    return true;
  });
}

/**
 * Builds the entry a single event would become, with the presets applied.
 *
 * Exported because the wizard's step 3 previews one row with the presets live,
 * and re-deriving that in the view would be logic in a `.tsx`.
 */
export function icsEventToEntryInput(
  event: IcsEvent,
  presets: IcsImportPresets,
): CreateEntryInput {
  const presetPlace = (presets.placeName ?? "").trim();
  const notePrefix = (presets.notePrefix ?? "").trim();

  // The prefix and the event's own description are joined by a blank line, so a
  // multi-paragraph DESCRIPTION stays readable under the note.
  const content =
    notePrefix === ""
      ? event.description
      : event.description === ""
        ? notePrefix
        : `${notePrefix}\n\n${event.description}`;

  return {
    date: event.date,
    time: event.time,
    title: event.summary,
    content,
    // A preset place overrides LOCATION entirely; that is the point of it.
    placeName: presetPlace !== "" ? presetPlace : event.location,
    categories: presets.categories,
    tags: presets.tags,
    locations: [],
    source: ICS_SOURCE,
    externalId: event.uid,
    // Remembered verbatim so the next refresh can tell this text from anything
    // the reader adds below it. See 0089.
    externalContent: content,
  };
}

/**
 * The entry a *matched* event should become when "keep my notes" is on.
 *
 * Starts from what the calendar now says, then restores everything the reader
 * owns: their half of `content`, their pin and lock, their weather and GPS
 * points, and any category or tag they added by hand.
 *
 * Exported for the same reason `icsEventToEntryInput` is — the plan and the
 * write both go through it, so the preview cannot promise something the import
 * doesn't do.
 */
export function mergeRefreshedEntry(
  existing: JournalEntry,
  event: IcsEvent,
  presets: IcsImportPresets,
): CreateEntryInput {
  const incoming = icsEventToEntryInput(event, presets);
  const { local, known } = splitExternalContent(existing.content, existing.externalContent);

  return {
    ...incoming,
    // When the split is known, the calendar's new text goes back above the
    // reader's own. When it isn't -- a pre-0089 entry, or one whose calendar
    // half was rewritten -- the stored content is kept verbatim: it may already
    // hold a copy of the DESCRIPTION, and prepending would duplicate it. The
    // calendar's other fields (title, date, time, place) still update, and
    // `externalContent` is recorded now so the *next* refresh can split cleanly.
    content: known ? joinContent(incoming.externalContent ?? "", local) : existing.content,
    // Added to, never replaced — so a hand-added tag survives.
    categories: mergeNames(existing.categories, incoming.categories ?? []),
    tags: mergeNames(existing.tags, incoming.tags ?? []),
    // Purely the reader's: the calendar has no opinion on any of these.
    isPinned: existing.isPinned,
    isLocked: existing.isLocked,
    weather: existing.weather,
    locations: existing.locations.map((location) => ({
      latitude: location.latitude,
      longitude: location.longitude,
      locationName: location.locationName,
    })),
  };
}

/**
 * Decides what each filtered event would do, and hands it to `onRow`.
 *
 * `selectedIndexes` is the set of rows the reader ticked, indexed against
 * `events` as given. An index that isn't selected is reported as a skip rather
 * than omitted, so the summary's counts still add up to the file the reader saw.
 */
function walkIcsEvents(
  repo: JournalRepository,
  events: IcsEvent[],
  presets: IcsImportPresets,
  selectedIndexes: number[] | undefined,
  onRow: (row: IcsImportPlanRow, input?: CreateEntryInput) => void,
): void {

  const selected = selectedIndexes ? new Set(selectedIndexes) : undefined;

  // UIDs already claimed by an earlier event in this same file. A Google export
  // can hold two VEVENTs sharing a UID (a recurrence exception carries the
  // series' UID plus a RECURRENCE-ID). Without this, the first would insert and
  // the second would be resolved against the entry the first just wrote --
  // reported as an update, overwriting it. The second copy is dropped instead.
  const seenUids = new Set<string>();

  events.forEach((event, eventIndex) => {
    const base = { eventIndex, event };

    if (selected && !selected.has(eventIndex)) {
      onRow({ ...base, action: "skip", blockedReason: "Not selected" });
      return;
    }

    if (event.date === "") {
      onRow({ ...base, action: "skip", blockedReason: "Event had no usable start date" });
      return;
    }

    const uid = event.uid.trim();

    // No UID means no stable identity, so this importer can't promise
    // idempotency for it. It still imports -- an untracked event is better than
    // a dropped one -- but a re-import will add it again, which the reason says.
    if (uid === "") {
      onRow({ ...base, action: "create" }, icsEventToEntryInput(event, presets));
      return;
    }

    if (seenUids.has(uid)) {
      onRow({
        ...base,
        action: "skip",
        blockedReason: "Another event in this file shares its UID",
      });
      return;
    }
    seenUids.add(uid);

    const existingIds = repo.findEntryIdsBySource(ICS_SOURCE, uid);
    if (existingIds.length === 0) {
      onRow({ ...base, action: "create" }, icsEventToEntryInput(event, presets));
      return;
    }

    // Already imported. Re-importing refreshes it in place: the event may have
    // been renamed or moved since, and the stored entry should follow.
    const entryId = existingIds[0];
    const existing = repo.getEntryById(entryId);
    if (existing?.isLocked) {
      // A lock says "do not touch this entry at all", which is stronger than
      // "keep my notes" and is honoured regardless of that option.
      onRow({
        ...base,
        action: "skip",
        blockedReason: "Locked — unlock it before re-importing",
      });
      return;
    }

    // With `preserveLocalEdits` (the default) the reader's own fields are carried
    // across; without it the entry is replaced whole, which is what this
    // importer did before 0089.
    const input =
      (presets.preserveLocalEdits ?? true) && existing
        ? mergeRefreshedEntry(existing, event, presets)
        : icsEventToEntryInput(event, presets);

    onRow({ ...base, action: "update", entryId }, input);
  });
}

/**
 * Works out what an import would do, writing nothing.
 *
 * Drives the wizard's selection table: every filtered event appears with the
 * action it would take, so "12 new, 3 already imported" is visible before the
 * reader commits. Shares its decision logic with `importIcsEvents`.
 */
export function planIcsImport(
  repo: JournalRepository,
  events: IcsEvent[],
  presets: IcsImportPresets = emptyIcsPresets(),
  selectedIndexes?: number[],
): IcsImportPlan {
  const rows: IcsImportPlanRow[] = [];
  walkIcsEvents(repo, events, presets, selectedIndexes, (row) => {
    rows.push(row);
  });

  return {
    rows,
    createCount: rows.filter((row) => row.action === "create").length,
    updateCount: rows.filter((row) => row.action === "update").length,
    skipCount: rows.filter((row) => row.action === "skip").length,
  };
}

/**
 * Imports the selected events as journal entries.
 *
 * Best-effort, like the CSV importer: a single event that fails to write is
 * recorded in the summary rather than aborting the rest. Idempotent for any
 * event carrying a UID — re-importing the same export updates in place instead
 * of duplicating.
 */
export function importIcsEvents(
  repo: JournalRepository,
  events: IcsEvent[],
  presets: IcsImportPresets = emptyIcsPresets(),
  selectedIndexes?: number[],
): ImportSummary {
  const results: ImportRowResult[] = [];

  walkIcsEvents(repo, events, presets, selectedIndexes, (row, input) => {
    // Row numbers are 1-based for display; there is no header line here, so an
    // event's number is its position in the filtered list.
    const rowNumber = row.eventIndex + 1;

    if (row.action === "skip" || !input) {
      results.push({ rowNumber, status: "skipped", reason: row.blockedReason });
      return;
    }

    try {
      if (row.action === "update" && row.entryId !== undefined) {
        updateEntry(repo, row.entryId, input);
        results.push({ rowNumber, status: "updated" });
      } else {
        createEntry(repo, input);
        results.push({ rowNumber, status: "imported" });
      }
    } catch (error) {
      results.push({
        rowNumber,
        status: "skipped",
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }
  });

  return summarizeImportResults(results);
}


/**
 * Parses a file and returns the events it holds, already filtered — the one call
 * the web action and the CLI both make for the wizard's steps 1 and 2.
 *
 * Kept here rather than in the parser so `ics-parse.ts` stays a pure format
 * reader with no opinion about journals.
 */
export function readIcsFile(
  fileText: string,
  filter: IcsImportFilter = emptyIcsFilter(),
): { events: IcsEvent[]; totalCount: number; skippedCount: number; calendarName: string } {
  const { events, skippedCount } = parseIcsEvents(fileText);
  const filtered = filterIcsEvents(events, filter);

  return {
    events: filtered,
    totalCount: events.length,
    skippedCount,
    calendarName: events[0]?.calendarName ?? "",
  };
}
