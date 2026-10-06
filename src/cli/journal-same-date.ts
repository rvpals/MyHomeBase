import {
  countSameDateEntries,
  createEntry,
  findSameDateGroups,
  getEntry,
  listEntries,
  lockEntries,
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
 *   journal-same-date --log-only
 *   journal-same-date --date 2026-03-14
 *   journal-same-date --merge 41,42,43
 *   journal-same-date --merge 41,42,43 --save
 *   journal-same-date --merge 41,42,43 --save --delete-originals
 *   journal-same-date --delete 41,42
 *   journal-same-date --lock 41,42
 *   journal-same-date --include-locked
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
 * `--delete-originals` (with `--save`) also bins the sources, which is what the
 * web dialog's follow-up prompt offers. It always runs *after* the merged entry
 * is written, so a failure there leaves the originals intact.
 *
 * `--delete` moves entries to the recycle bin (the same bin the Correct tab
 * restores from), so it is undoable there rather than destructive here.
 *
 * `--lock` is the web card's "Lock & exclude from review": it marks the entries
 * settled, and since locked entries are dropped before grouping they — and any
 * date left with fewer than two unlocked entries — stop appearing in this
 * listing. Nothing is deleted; unlocking an entry brings its date back.
 *
 * `--include-locked` lists them anyway. The web card has no such toggle, so
 * this is the one place the two front-ends differ in what they *show* — not in
 * what they can do: the option is on the same library call, and a terminal is
 * where you go to find out what you excluded and which id to unlock.
 */
export async function journalSameDateCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (flags.merge !== undefined) {
    mergeSelection(flags.merge, args.includes("--save"), args.includes("--delete-originals"));
    return;
  }

  if (flags.delete !== undefined) {
    deleteSelection(flags.delete);
    return;
  }

  if (flags.lock !== undefined) {
    lockSelection(flags.lock);
    return;
  }

  // The whole journal, as the web panel reads it: a limit would hide the pair
  // sitting on one day in 2019, which is the thing this screen is for.
  //
  // `--log-only` is the card's "Review only Log entries" toggle, same option on
  // the same library call — so the two front-ends can't disagree about which
  // dates qualify.
  const logOnly = args.includes("--log-only");
  const includeLocked = args.includes("--include-locked");
  const groups = findSameDateGroups(listEntries(deps.journalRepo), { logOnly, includeLocked });
  const shown = flags.date ? groups.filter((group) => group.date === flags.date) : groups;

  if (shown.length === 0) {
    const what = logOnly ? "Log entry" : "entry";
    // Locked entries are excluded unless asked for, so an empty list can mean
    // "all reviewed" rather than "nothing to review" — say so, or the reader
    // has no way to tell the two apart from this output.
    const hint = includeLocked ? "" : " Locked entries are excluded; add --include-locked to see them.";
    console.log(
      flags.date
        ? `${flags.date} does not carry more than one unlocked ${what}.${hint}`
        : `No date has more than one unlocked ${what}.${hint}`,
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
      // The web list's "L" badge, spelled out: a terminal has no room for a
      // glyph whose meaning depends on a tooltip. Suppressed under --log-only,
      // where every row is a log and the marker would be noise on all of them.
      const log = !logOnly && entry.isLog ? " [log]" : "";
      console.log(`  #${String(entry.id).padStart(5)}  ${time}  ${title}${log}${lock}`);
      if (entry.excerpt !== "") console.log(`         ${entry.excerpt.slice(0, 120)}`);
    }
  }
}

/**
 * `--merge 41,42,43` — print the draft, and with `--save` write it.
 *
 * `--delete-originals` is the terminal's form of the web dialog's "would you
 * like to delete the originals?" prompt: a terminal can't ask mid-command, so
 * the answer is given up front as a flag. It is ignored without `--save`, since
 * there is nothing to clean up after a dry run, and it runs only *after* the
 * merged entry is safely written — the same ordering the web path guarantees.
 */
function mergeSelection(raw: string, save: boolean, deleteOriginals: boolean): void {
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
    if (deleteOriginals) {
      console.log("(--delete-originals was ignored: it only applies once --save writes.)");
    }
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
  if (!deleteOriginals) {
    console.log(
      `Created entry #${created.id}. The ${entries.length} source entries are untouched — ` +
        "re-run with --delete-originals, or use --delete, to bin them.",
    );
    return;
  }

  // Only now that the merged entry exists. The same `recycleEntries` the web
  // path calls, so the originals are restorable from the Correct tab rather
  // than destroyed.
  console.log(`Created entry #${created.id}.`);
  const { movedCount, skippedCount } = recycleEntries(
    deps.journalRepo,
    entries.map((entry) => entry.id),
  );
  console.log(
    `Moved ${movedCount} original ${movedCount === 1 ? "entry" : "entries"} to the recycle bin` +
      `${skippedCount ? `, skipped ${skippedCount} that no longer existed` : ""}.`,
  );
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

/**
 * `--lock 41,42` — mark entries settled and drop them out of this listing.
 *
 * The same `lockEntries` the web button calls, so the two front-ends cannot
 * disagree about what locking does or what it reports.
 */
function lockSelection(raw: string): void {
  const ids = parseIds(raw);
  if (ids === undefined) return;

  try {
    const { lockedCount, skippedCount } = lockEntries(deps.journalRepo, ids);
    if (lockedCount === 0) {
      console.log("Nothing changed — those entries were already locked, or no longer exist.");
      return;
    }
    console.log(
      `Locked ${lockedCount} ${lockedCount === 1 ? "entry" : "entries"} and excluded them from review` +
        `${skippedCount ? `, skipped ${skippedCount} already locked or missing` : ""}.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to lock those entries.");
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
