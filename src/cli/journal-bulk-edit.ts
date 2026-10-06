import {
  bulkEditEntries,
  describeBulkEditResult,
  getEntry,
  recycleEntries,
  type BulkEntryEditInput,
  type BulkNameMode,
} from "@/lib/journal";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * The Journal → Entries screen's bulk actions from the terminal: the same
 * selection edit and selection delete the grid's tick-boxes drive.
 *
 *   journal-bulk-edit --ids 41,42,43 --add-tags "Beach,Summer"
 *   journal-bulk-edit --ids 41,42 --remove-tags "Draft"
 *   journal-bulk-edit --ids 41,42 --set-tags "Beach"
 *   journal-bulk-edit --ids 41,42 --add-categories "Travel"
 *   journal-bulk-edit --ids 41,42 --set-categories ""
 *   journal-bulk-edit --ids 41,42 --place "Lisbon"
 *   journal-bulk-edit --ids 41,42 --add-tags "Beach" --dry-run
 *   journal-bulk-edit --ids 41,42 --delete
 *
 * This is the proof the feature's logic lives in `src/lib/`: every flag maps to
 * a field of the one `bulkEditEntries` input, and the summary line is built by
 * `describeBulkEditResult` — the same function the web notice prints, so the two
 * front-ends cannot disagree about what happened.
 *
 * The three modes are three flag prefixes rather than a `--mode` switch, so one
 * command can add tags and replace categories in a single pass, exactly as the
 * dialog's two independent mode pickers allow.
 *
 * `--set-…` is Replace, and it is the one that discards what an entry already
 * carries — `--set-tags ""` clears the field outright. `--dry-run` prints the
 * entries that would change (and which are locked) and writes nothing.
 *
 * **Locked entries are skipped by an edit and moved by `--delete`.** That
 * asymmetry is deliberate and is the web behaviour too; src/lib/journal/recycle.ts
 * explains it.
 */
export async function journalBulkEditCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (flags.ids === undefined || flags.ids === "") {
    console.error("Usage: journal-bulk-edit --ids 41,42 [--add-tags …] [--place …] [--delete]");
    process.exitCode = 1;
    return;
  }

  const ids = parseIds(flags.ids);
  if (ids === undefined) return;

  if (args.includes("--delete")) {
    deleteSelection(ids);
    return;
  }

  const changes: BulkEntryEditInput = {};
  const categories = nameChange(flags, "categories");
  const tags = nameChange(flags, "tags");
  if (categories) changes.categories = categories;
  if (tags) changes.tags = tags;
  if (flags.place !== undefined) changes.placeName = flags.place;

  if (Object.keys(changes).length === 0) {
    console.error(
      "Nothing to change. Pass one of --add-tags/--remove-tags/--set-tags, " +
        "--add-categories/--remove-categories/--set-categories, or --place.",
    );
    process.exitCode = 1;
    return;
  }

  if (args.includes("--dry-run")) {
    previewSelection(ids);
    return;
  }

  try {
    const result = bulkEditEntries(deps.journalRepo, ids, changes);
    console.log(describeBulkEditResult(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to edit those entries.");
    process.exitCode = 1;
  }
}

/**
 * Reads the three flags for one field into the single change the library takes.
 *
 * Only one mode per field: passing two would be an instruction with no defined
 * order ("add Beach and replace with Summer"), so it is refused rather than
 * silently resolved by flag order.
 */
function nameChange(
  flags: Record<string, string>,
  field: "categories" | "tags",
): { mode: BulkNameMode; names: string[] } | undefined {
  const given: { mode: BulkNameMode; raw: string }[] = [];
  if (flags[`add-${field}`] !== undefined) given.push({ mode: "add", raw: flags[`add-${field}`] });
  if (flags[`remove-${field}`] !== undefined) {
    given.push({ mode: "remove", raw: flags[`remove-${field}`] });
  }
  if (flags[`set-${field}`] !== undefined) {
    given.push({ mode: "replace", raw: flags[`set-${field}`] });
  }

  if (given.length === 0) return undefined;
  if (given.length > 1) {
    console.error(
      `Pass only one of --add-${field}, --remove-${field} or --set-${field}; got ${given.length}.`,
    );
    process.exitCode = 1;
    return undefined;
  }

  return { mode: given[0].mode, names: splitNames(given[0].raw) };
}

/** `"Beach, Summer"` -> `["Beach", "Summer"]`. An empty string yields []. */
function splitNames(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/** `--dry-run`: say what each id is and whether the lock would skip it. */
function previewSelection(ids: number[]): void {
  let skipped = 0;
  for (const id of ids) {
    const entry = getEntry(deps.journalRepo, id);
    if (!entry) {
      console.log(`  #${String(id).padStart(5)}  (no such entry)`);
      continue;
    }
    const title = entry.title.trim() === "" ? "(untitled)" : entry.title;
    if (entry.isLocked) skipped += 1;
    console.log(
      `  #${String(id).padStart(5)}  ${entry.date}  ${title}${entry.isLocked ? "  [locked — would be skipped]" : ""}`,
    );
  }
  console.log("");
  console.log(
    `Dry run — nothing written. ${ids.length - skipped} would change` +
      (skipped > 0 ? `, ${skipped} locked and skipped.` : "."),
  );
}

/**
 * `--delete` — move the selection to the recycle bin.
 *
 * The bin, not a hard delete, so this is undoable from the web Correct tab.
 * Locked entries go too, keeping their lock; see the note at the top.
 */
function deleteSelection(ids: number[]): void {
  try {
    const { movedCount, skippedCount } = recycleEntries(deps.journalRepo, ids);
    console.log(
      `Moved ${movedCount} ${movedCount === 1 ? "entry" : "entries"} to the recycle bin` +
        (skippedCount > 0 ? `, skipped ${skippedCount} that no longer exist.` : "."),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to delete those entries.");
    process.exitCode = 1;
  }
}

/** "41,42,43" -> [41, 42, 43]. Reports and returns undefined on a bad list. */
function parseIds(raw: string): number[] | undefined {
  const ids = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => Number(part));

  if (ids.length === 0 || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    console.error(`Expected a comma-separated list of entry ids, got "${raw}".`);
    process.exitCode = 1;
    return undefined;
  }
  return ids;
}
