import {
  countSameDateEntries,
  createEntry,
  findSameDateGroups,
  getEntry,
  listEntries,
  mergeEntryDraft,
  recycleEntries,
  type JournalEntry,
} from "@/lib/journal";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * The Journal → Review Data screen from the terminal: the dates carrying more
 * than one entry, plus the same Merge and Delete the web grid offers.
 *
 *   journal-same-date
 *   journal-same-date --date 2026-03-14
 *   journal-same-date --merge 41,42,43
 *   journal-same-date --merge 41,42,43 --save
 *   journal-same-date --delete 41,42
 *
 * This is the proof the section's logic really is in `src/lib/`: the grouping,
 * the excerpt, the reading order and the whole merged draft come from
 * `same-date.ts`, and this file only prints what it is handed and calls the same
 * use-cases the server actions call. Nothing here is web-specific and nothing
 * the web does is unavailable here.
 *
 * `--merge` prints the draft it would create and writes nothing, matching the
 * web dialog: merging is non-destructive, so the sources survive it. Add
 * `--save` to actually create the merged entry — still leaving the sources
 * alone, exactly as clicking Save in the dialog does.
 *
 * `--delete` moves entries to the recycle bin (the same bin the Correct tab
 * restores from), so it is undoable there rather than destructive here.
 */
export async function journalSameDateCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (flags.merge !== undefined) {
    mergeSelection(flags.merge, args.includes("--save"));
    return;
  }

  if (flags.delete !== undefined) {
    deleteSelection(flags.delete);
    return;
  }

  // The whole journal, as the web panel reads it: a limit would hide the pair
  // sitting on one day in 2019, which is the thing this screen is for.
  const groups = findSameDateGroups(listEntries(deps.journalRepo));
  const shown = flags.date ? groups.filter((group) => group.date === flags.date) : groups;

  if (shown.length === 0) {
    console.log(
      flags.date
        ? `${flags.date} does not carry more than one entry.`
        : "No date has more than one entry.",
    );
    return;
  }

  console.log(
    `${shown.length} ${shown.length === 1 ? "date" : "dates"} · ` +
      `${countSameDateEntries(shown)} entries`,
  );

  for (const group of shown) {
    console.log("");
    console.log(`${group.date} — ${group.entries.length} entries`);
    for (const entry of group.entries) {
      const time = entry.time === "" ? "  —  " : entry.time.slice(0, 5).padEnd(5);
      const title = entry.title.trim() === "" ? "(untitled)" : entry.title;
      const lock = entry.isLocked ? " [locked]" : "";
      console.log(`  #${String(entry.id).padStart(5)}  ${time}  ${title}${lock}`);
      if (entry.excerpt !== "") console.log(`         ${entry.excerpt.slice(0, 120)}`);
    }
  }
}

/** `--merge 41,42,43` — print the draft, and with `--save` write it. */
function mergeSelection(raw: string, save: boolean): void {
  const ids = parseIds(raw);
  if (ids === undefined) return;

  const entries: JournalEntry[] = [];
  for (const id of ids) {
    const entry = getEntry(deps.journalRepo, id);
    if (!entry) {
      console.error(`No journal entry with id ${id}.`);
      process.exitCode = 1;
      return;
    }
    entries.push(entry);
  }

  // The same pure function the server action calls, on the same full entries —
  // so what prints here is character-for-character what the web dialog would
  // have shown.
  const draft = mergeEntryDraft(entries);

  console.log(`Merged draft from ${entries.length} ${entries.length === 1 ? "entry" : "entries"}:`);
  console.log("");
  console.log(`  Date:       ${draft.date}`);
  console.log(`  Time:       ${draft.time || "(none)"}`);
  console.log(`  Title:      ${draft.title || "(none)"}`);
  console.log(`  Place:      ${draft.placeName || "(none)"}`);
  console.log(`  Categories: ${draft.categories.join(", ") || "(none)"}`);
  console.log(`  Tags:       ${draft.tags.join(", ") || "(none)"}`);
  console.log("");
  console.log(draft.content);

  if (!save) {
    console.log("");
    console.log("Nothing was written. Re-run with --save to create this entry.");
    return;
  }

  // Through the module's front door, not `deps.journalRepo.createEntry`: the
  // use-case validates with the zod schema and registers any category or tag the
  // merged draft carries that does not exist yet — which is exactly what the web
  // path does, and skipping it here would make the two front-ends differ.
  //
  // The draft is a CreateEntryInput minus the two fields a merge deliberately
  // does not carry (locations and weather — see mergeEntryDraft).
  const created = createEntry(deps.journalRepo, {
    date: draft.date,
    time: draft.time,
    title: draft.title,
    content: draft.content,
    placeName: draft.placeName,
    categories: draft.categories,
    tags: draft.tags,
    locations: [],
    isPinned: false,
  });
  console.log("");
  console.log(`Created entry #${created.id}. The ${entries.length} source entries are untouched.`);
}

/** `--delete 41,42` — move entries to the recycle bin. */
function deleteSelection(raw: string): void {
  const ids = parseIds(raw);
  if (ids === undefined) return;

  try {
    const { movedCount, skippedCount } = recycleEntries(deps.journalRepo, ids);
    console.log(
      `Moved ${movedCount} ${movedCount === 1 ? "entry" : "entries"} to the recycle bin` +
        `${skippedCount ? `, skipped ${skippedCount} that no longer existed` : ""}.`,
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
