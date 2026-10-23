import { cloneSeedFromEntry, createEntry, getEntry } from "@/lib/journal";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * Clone a journal entry from the terminal — the same use-case the entry
 * viewer's Clone button drives.
 *
 *   journal-clone show --id 42                      what would be copied
 *   journal-clone new  --id 42 --date 2026-10-29
 *   journal-clone new  --id 42 --date 2026-10-29 --time 17:30 --title "..."
 *
 * This is the litmus test from ARCHITECTURE.md applied to cloning: the web
 * button navigates to a seeded form and the terminal writes the entry outright,
 * but both get their field selection from the one `cloneSeedFromEntry` in
 * `src/lib/journal`. If the two ever disagree about what a clone carries, the
 * rule has leaked out of the library.
 *
 * `--date` is required on `new` and deliberately has no default. The entire
 * point of a clone is that it lands on a *different* day, and defaulting to
 * today would make the one field the reader must think about the one field they
 * can forget — a mistake that writes a real row into the journal.
 */
export async function journalCloneCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const flags = parseFlags(rest);

  switch (subcommand) {
    case "show":
      return showSeed(flags);
    case "new":
      return writeClone(flags);
    default:
      console.log(
        "Usage:\n" +
          "  journal-clone show --id <entryId>\n" +
          "  journal-clone new  --id <entryId> --date <YYYY-MM-DD> [--time HH:MM] [--title <text>]",
      );
  }
}

/**
 * Resolves `--id` to an entry, or prints why it can't and sets a failing exit
 * code. Returns undefined on every refusal so both subcommands share one set of
 * messages — and one view of what "cloneable" means.
 */
function resolveSource(flags: Record<string, string>) {
  const id = Number(flags.id);
  if (!Number.isInteger(id) || id <= 0) {
    console.error("journal-clone: --id must be a positive entry id.");
    process.exitCode = 1;
    return undefined;
  }

  const entry = getEntry(deps.journalRepo, id);
  if (!entry) {
    console.error(`journal-clone: no journal entry with id ${id}.`);
    process.exitCode = 1;
    return undefined;
  }

  // The same refusal the web path makes, for the same reason: a sealed entry's
  // title and content read as "" here, so cloning one would quietly produce an
  // entry missing its headline. Refusing says so instead.
  if (entry.isEncrypted) {
    console.error(
      `journal-clone: entry ${id} is encrypted, so its title cannot be read here. ` +
        "Clone it from the entry screen after unlocking it.",
    );
    process.exitCode = 1;
    return undefined;
  }

  return entry;
}

function showSeed(flags: Record<string, string>): void {
  const entry = resolveSource(flags);
  if (!entry) return;

  const seed = cloneSeedFromEntry(entry);
  console.log(`Cloning entry ${seed.sourceEntryId} would copy:`);
  console.log(`  title       ${seed.title === "" ? "(none)" : seed.title}`);
  console.log(`  placeName   ${seed.placeName === "" ? "(none)" : seed.placeName}`);
  console.log(`  categories  ${seed.categories.join(", ") || "(none)"}`);
  console.log(`  tags        ${seed.tags.join(" ") || "(none)"}`);
  if (seed.locations.length === 0) {
    console.log("  locations   (none)");
  } else {
    console.log(`  locations   ${seed.locations.length}`);
    for (const location of seed.locations) {
      const name = location.locationName === "" ? "(unnamed)" : location.locationName;
      console.log(
        `              ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}  ${name}`,
      );
    }
  }
  // Named explicitly rather than left to be inferred from what isn't listed:
  // "what a clone drops" is the part a reader is most likely to get wrong.
  console.log("\nNot copied: date, time, content, weather, pinned/locked state.");
}

function writeClone(flags: Record<string, string>): void {
  const entry = resolveSource(flags);
  if (!entry) return;

  const date = (flags.date ?? "").trim();
  if (date === "") {
    console.error("journal-clone new: --date is required (a clone lands on a new day).");
    process.exitCode = 1;
    return;
  }

  const seed = cloneSeedFromEntry(entry);
  let created;
  try {
    // The schema validates the date, so a malformed one is rejected here rather
    // than written — no pre-check of the format in this file.
    created = createEntry(deps.journalRepo, {
      date,
      time: flags.time ?? "",
      // `--title` overrides the copied one, for the common case where the clone
      // differs by name as well as by day ("AG3 practice" -> "AG3 meet").
      title: flags.title ?? seed.title,
      placeName: seed.placeName,
      categories: seed.categories,
      tags: seed.tags,
      locations: seed.locations,
    });
  } catch (error) {
    console.error(
      `journal-clone new: ${error instanceof Error ? error.message : "failed to write the entry."}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Created entry ${created.id} on ${created.date} from entry ${seed.sourceEntryId}.`);
  console.log("Content is empty — write it on the entry screen.");
}
