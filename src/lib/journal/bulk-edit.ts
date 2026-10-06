// Bulk edit for a selection of journal entries — the Entries screen's "Bulk
// edit" button, on both the Main and the Log tab.
//
// The companion to recycle.ts: that one is the selection *delete*, this one is
// the selection *change*. They sit next to each other deliberately, because the
// two differ on locked entries and the reason is easy to lose:
//
//   - **Delete moves locked entries too.** The bin stores `isLocked` with the
//     row, so the lock survives the trip and a restore brings it back locked.
//     Nothing is bypassed.
//   - **Edit skips locked entries.** `updateEntry` refuses a locked entry
//     outright, so a bulk path that wrote them would be exactly the bypass the
//     lock exists to prevent. They are skipped and counted, not refused — one
//     locked row must not block a fifty-row edit.
//
// Validation and the reported contract live here; the transaction and the SQL
// live in the repository, next to the statements they run. Same division as
// recycle.ts.

import type { JournalRepository } from "./ports";
import type { BulkEntryEditOutcome } from "./ports";
import { bulkEntryEditSchema, entryIdsSchema, type BulkEntryEditInput } from "./schema";
import type { BulkNameChangeData } from "./schema";

export interface BulkEditResult {
  /** How many entries were actually written. */
  updatedCount: number;
  /** How many were left alone because they are locked. */
  skippedLockedCount: number;
  /** How many requested ids no longer existed. */
  missingCount: number;
}

/**
 * Applies one change to every selected entry.
 *
 * Only the fields named in `changes` are touched; everything else on each row —
 * its content, its date, its locations — is left exactly as it was. Which fields
 * are eligible is decided by `bulkEntryEditSchema`, so the rule holds for the CLI
 * as much as for the web app.
 *
 * Any category or tag named here joins the managed lists first, exactly as
 * `createEntry`/`updateEntry` do it, so a bulk add can introduce a new name
 * without a separate trip to the Meta Data screen. `remove` registers nothing —
 * naming something to strip it is not a reason to mint it.
 */
export function bulkEditEntries(
  repo: JournalRepository,
  ids: number[],
  changes: BulkEntryEditInput,
): BulkEditResult {
  const validatedIds = [...new Set(entryIdsSchema.parse(ids))];
  const validated = bulkEntryEditSchema.parse(changes);

  const normalized = {
    categories: normalizeChange(validated.categories),
    tags: normalizeChange(validated.tags),
    placeName: validated.placeName,
  };

  // The schema's own refine runs *before* trimming, so a list of whitespace
  // ("  ", "") satisfies it and then normalizes to nothing. Re-checking after the
  // fold is what stops that reaching the repository as a no-op that would still
  // report every row as updated.
  assertNamesPresent(normalized.categories, "category");
  assertNamesPresent(normalized.tags, "tag");

  if (normalized.categories && normalized.categories.mode !== "remove") {
    repo.registerCategoriesIfMissing(normalized.categories.names);
  }
  if (normalized.tags && normalized.tags.mode !== "remove") {
    repo.registerTagsIfMissing(normalized.tags.names);
  }

  const outcome = repo.bulkEditEntries(validatedIds, normalized);
  return toResult(outcome);
}

/**
 * Trims, drops blanks and de-dupes a name list, keeping the first spelling of
 * any name repeated in different cases.
 *
 * Case-insensitive, unlike `normalizeNames` in journal.ts, and on purpose: the
 * folding has to agree with how the names are *applied* (see
 * `mergeNames`/`removeNames` below), or an "add Museum" against an entry already
 * carrying "museum" would read as a no-op in one place and a duplicate in the
 * other. `TokenPicker` folds case the same way on the screen that feeds this.
 */
function normalizeNamesFoldingCase(names: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (name === "") continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(name);
  }
  return cleaned;
}

function normalizeChange(change: BulkNameChangeData | undefined): BulkNameChangeData | undefined {
  if (!change) return undefined;
  return { mode: change.mode, names: normalizeNamesFoldingCase(change.names) };
}

function assertNamesPresent(change: BulkNameChangeData | undefined, kind: "category" | "tag"): void {
  if (!change || change.mode === "replace" || change.names.length > 0) return;
  throw new Error(
    `Name at least one ${kind} to ${change.mode}, or switch the mode to Replace.`,
  );
}

/**
 * The names an entry ends up with. Exported because the repository applies it
 * per row and the tests assert it directly — the fold is the actual behaviour of
 * this feature, so it is worth testing without a database in the way.
 *
 * `add` appends what isn't already there, **keeping the entry's existing
 * spelling** of any name it already carries: an entry tagged "museum" that is
 * bulk-added "Museum" keeps "museum". Re-casing an entry's existing names is a
 * rename, which belongs in the Meta Data screen, not in a bulk add.
 */
export function applyNameChange(current: string[], change: BulkNameChangeData): string[] {
  if (change.mode === "replace") return [...change.names];
  if (change.mode === "remove") {
    const dropped = new Set(change.names.map((name) => name.toLowerCase()));
    return current.filter((name) => !dropped.has(name.toLowerCase()));
  }
  const held = new Set(current.map((name) => name.toLowerCase()));
  const added = change.names.filter((name) => !held.has(name.toLowerCase()));
  return [...current, ...added];
}

function toResult(outcome: BulkEntryEditOutcome): BulkEditResult {
  return {
    updatedCount: outcome.updatedIds.length,
    skippedLockedCount: outcome.skippedLockedIds.length,
    missingCount: outcome.missingIds.length,
  };
}

/**
 * One line summarising what a bulk edit did, for the web notice and the CLI's
 * stdout to print identically.
 *
 * In `lib` rather than in the view because both adapters show it and the counts
 * it has to get right — notably "nothing changed" — are the kind of thing two
 * copies drift on.
 */
export function describeBulkEditResult(result: BulkEditResult): string {
  const parts: string[] = [];
  parts.push(
    result.updatedCount === 1 ? "Updated 1 entry." : `Updated ${result.updatedCount} entries.`,
  );
  if (result.skippedLockedCount > 0) {
    parts.push(
      result.skippedLockedCount === 1
        ? "1 was locked and skipped."
        : `${result.skippedLockedCount} were locked and skipped.`,
    );
  }
  if (result.missingCount > 0) {
    parts.push(
      result.missingCount === 1 ? "1 no longer exists." : `${result.missingCount} no longer exist.`,
    );
  }
  return parts.join(" ");
}
