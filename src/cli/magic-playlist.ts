// Builds a Magic Playlist from the terminal.
//
// The same use-cases the web screen drives, with argv instead of a form -- which is the
// litmus test in ARCHITECTURE.md. Nothing in src/lib/music-magic changed to add this
// command, because the use-cases never assumed a browser.
//
// Usage:
//   npm run cli -- magic-playlist [--genre G]... [--artist A]... [--album ID]...
//                                 [--folder PATH]... [--minutes N] [--any]
//                                 [--include-unplayable]
//                                 [--save "Name"] [--description "..."]
//   npm run cli -- magic-playlist --folders [PATH]
//   npm run cli -- magic-playlist --list
//   npm run cli -- magic-playlist --load <id>
//   npm run cli -- magic-playlist --regenerate <id>
//   npm run cli -- magic-playlist --delete <id>
//
//   npm run cli -- magic-playlist --genre Rock --genre Pop --minutes 60
//   npm run cli -- magic-playlist --artist "Michael Jackson" --artist "Luther Vandross" --any
//   npm run cli -- magic-playlist --genre Jazz --minutes 90 --save "Sunday morning"
//   npm run cli -- magic-playlist --folder "Rock/Queen" --minutes 45
//   npm run cli -- magic-playlist --folders "Rock"        # browse one level of the tree
//
// A folder selects its whole SUBTREE, so --folder Rock covers Rock/Queen/Live too. Use
// --folders to walk the tree and find the path to pass, since a folder criterion is a path
// rather than a name you can guess.
//
// A repeated flag is how a multi-select arrives here: `--genre Rock --genre Pop` is the
// OR-within-a-field group, matching what the web pickers post.

import {
  countMagicCandidates,
  deleteMagicList,
  describeGeneration,
  describeMagicFailure,
  emptyCriteria,
  formatRunningTime,
  generateMagicPlaylist,
  listMagicFolderOptions,
  listMagicLists,
  loadMagicList,
  regenerateMagicList,
  saveMagicList,
  type GeneratedPlaylist,
  type MagicCriteria,
  type MagicDependencies,
} from "@/lib/music-magic";
import { deps } from "@/lib/wiring";

/** Math.random is injected here, not defaulted in the library -- same as the web adapter. */
function magicDeps(): MagicDependencies {
  return {
    magicListRepo: deps.magicListRepo,
    candidateSource: deps.magicCandidateSource,
    random: Math.random,
  };
}

export async function magicPlaylistCommand(args: string[]): Promise<void> {
  // Sub-modes first: each is a different verb, and they do not combine with generation.
  if (args.includes("--list")) {
    printSavedLists();
    return;
  }

  const loadId = valueOf(args, "--load");
  if (loadId !== undefined) {
    withReadableErrors(() => runLoad(requireId(loadId, "--load")));
    return;
  }

  const regenerateId = valueOf(args, "--regenerate");
  if (regenerateId !== undefined) {
    withReadableErrors(() => runRegenerate(requireId(regenerateId, "--regenerate")));
    return;
  }

  const deleteId = valueOf(args, "--delete");
  if (deleteId !== undefined) {
    withReadableErrors(() => runDelete(requireId(deleteId, "--delete")));
    return;
  }

  // `--folders` with no value means the top level, which is why this tests for the FLAG
  // rather than for a value -- `valueOf` returning undefined is a legitimate case here,
  // unlike for --load or --delete.
  if (args.includes("--folders")) {
    withReadableErrors(() => printFolders(valueOf(args, "--folders") ?? ""));
    return;
  }

  withReadableErrors(() => runGenerate(args));
}

/** Thrown for a bad argument, so the catch below can tell it from a real crash. */
class UsageError extends Error {}

/**
 * Runs a sub-command, turning a validation failure into one readable line.
 *
 * Without this, a mistyped id reaches `magicListIdSchema.parse` and Node prints a
 * ZodError with a stack trace -- a wall of JSON for a typo. The schemas hold the right
 * wording; this just makes sure that is what gets shown.
 */
function withReadableErrors(run: () => void): void {
  try {
    run();
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}

/** A list id from the command line, refused early with a message rather than a stack. */
function requireId(raw: string, flag: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new UsageError(`${flag} needs a positive list id, not "${raw}". Try --list.`);
  }
  return parsed;
}

/** Generates from criteria on the command line, optionally saving the result. */
function runGenerate(args: string[]): void {
  const criteria: MagicCriteria = {
    ...emptyCriteria(),
    genres: valuesOf(args, "--genre"),
    artists: valuesOf(args, "--artist"),
    albumIds: valuesOf(args, "--album").map((value) => Number(value)),
    folders: valuesOf(args, "--folder"),
    matchAny: args.includes("--any"),
    streamableOnly: !args.includes("--include-unplayable"),
  };

  const minutes = valueOf(args, "--minutes");
  if (minutes !== undefined) {
    const parsed = Number(minutes);
    if (!Number.isFinite(parsed)) {
      throw new UsageError(`--minutes needs a number, not "${minutes}".`);
    }
    criteria.targetSeconds = Math.round(parsed * 60);
  }

  const saveName = valueOf(args, "--save");

  // The schema does the validating -- the same schema the web action uses -- so a bad
  // target is reported once, in one wording, rather than checked twice. A throw here is
  // caught by withReadableErrors and printed as a single line.
  const candidateCount = countMagicCandidates(magicDeps(), criteria);

  if (saveName === undefined) {
    const generated = generateMagicPlaylist(magicDeps(), criteria);
    printCriteria(criteria, candidateCount);
    printPlaylist(generated);
    return;
  }

  const result = saveMagicList(magicDeps(), {
    name: saveName,
    description: valueOf(args, "--description") ?? "",
    criteria,
  });
  if (!result.ok) {
    console.error(describeMagicFailure(result.failure));
    process.exitCode = 1;
    return;
  }

  printCriteria(criteria, candidateCount);
  printPlaylist(result.value.generated);
  console.log("");
  console.log(`Saved as magic list #${result.value.magicList.id} "${result.value.magicList.name}".`);
}

/**
 * Walks one level of the folder tree, so a `--folder` path can be discovered rather than
 * guessed. The browsing counterpart of the web picker's drill-down.
 */
function printFolders(parentPath: string): void {
  const options = listMagicFolderOptions(magicDeps(), parentPath);
  const where = parentPath === "" ? "the library root" : parentPath;

  if (options.length === 0) {
    console.log(`No sub-folders in ${where}.`);
    return;
  }

  console.log(`Folders in ${where}:`);
  console.log("");
  for (const option of options) {
    // The subtree total is the number that matters -- it is what --folder would select.
    console.log(
      `  ${option.relativePath.padEnd(56)} ${String(option.totalTrackCount).padStart(6)} tracks` +
        `${option.hasChildren ? "   (has sub-folders)" : ""}`,
    );
  }
  console.log("");
  console.log(`Pass one as --folder "<path>" to select it and everything beneath it.`);
}

function printSavedLists(): void {
  const lists = listMagicLists(magicDeps());
  if (lists.length === 0) {
    console.log("No saved magic lists.");
    return;
  }

  console.log(`${lists.length} saved magic list${lists.length === 1 ? "" : "s"}:`);
  console.log("");
  for (const list of lists) {
    const generated = list.lastGeneratedAt ?? "never";
    console.log(
      `  #${String(list.id).padStart(3)}  ${list.name.padEnd(32)} ` +
        `${formatRunningTime(list.targetSeconds).padEnd(10)} ` +
        `${String(list.trackCount).padStart(4)} tracks   last built ${generated}`,
    );
    if (list.description !== "") console.log(`        ${list.description}`);
  }
}

/** Replays a saved list's stored set. Does NOT re-roll -- that is --regenerate. */
function runLoad(magicListId: number): void {
  const result = loadMagicList(magicDeps(), magicListId);
  if (!result.ok) {
    console.error(describeMagicFailure(result.failure));
    process.exitCode = 1;
    return;
  }

  const { magicList, tracks } = result.value;
  console.log(`#${magicList.id} "${magicList.name}"`);
  if (magicList.description !== "") console.log(magicList.description);
  printCriteria(magicList.criteria);
  console.log("");

  if (tracks.length === 0) {
    console.log("No stored tracks. Run with --regenerate to build the list.");
    return;
  }

  const totalSeconds = tracks.reduce((total, track) => total + (track.durationSeconds ?? 0), 0);
  tracks.forEach((track, index) => printTrack(index, track.displayTitle, track.artist, track.durationSeconds));
  console.log("");
  console.log(`${tracks.length} tracks, ${formatRunningTime(totalSeconds)}.`);
}

function runRegenerate(magicListId: number): void {
  const result = regenerateMagicList(magicDeps(), magicListId);
  if (!result.ok) {
    console.error(describeMagicFailure(result.failure));
    process.exitCode = 1;
    return;
  }

  console.log(`Regenerated #${result.value.magicList.id} "${result.value.magicList.name}".`);
  printCriteria(result.value.magicList.criteria);
  printPlaylist(result.value.generated);
}

function runDelete(magicListId: number): void {
  const result = deleteMagicList(magicDeps(), magicListId);
  if (!result.ok) {
    console.error(describeMagicFailure(result.failure));
    process.exitCode = 1;
    return;
  }
  console.log(`Deleted magic list #${magicListId}. No track or file was touched.`);
}

function printCriteria(criteria: MagicCriteria, candidateCount?: number): void {
  const parts: string[] = [];
  if (criteria.genres.length > 0) parts.push(`genres: ${criteria.genres.join(" | ")}`);
  if (criteria.artists.length > 0) parts.push(`artists: ${criteria.artists.join(" | ")}`);
  if (criteria.albumIds.length > 0) parts.push(`albums: ${criteria.albumIds.join(" | ")}`);
  // Marked as subtrees so the printed criteria cannot be misread as exact-folder matches.
  if (criteria.folders.length > 0) {
    parts.push(`folders: ${criteria.folders.map((folder) => `${folder}/*`).join(" | ")}`);
  }

  console.log(
    parts.length === 0
      ? `Criteria: the whole library, target ${formatRunningTime(criteria.targetSeconds)}`
      : `Criteria (${criteria.matchAny ? "match ANY" : "match ALL"}): ${parts.join("  ")}` +
          `  target ${formatRunningTime(criteria.targetSeconds)}`,
  );
  if (candidateCount !== undefined) console.log(`${candidateCount} eligible tracks.`);
}

function printPlaylist(generated: GeneratedPlaylist): void {
  console.log("");
  generated.tracks.forEach((track, index) =>
    printTrack(index, track.displayTitle, track.artist, track.durationSeconds),
  );
  console.log("");
  console.log(
    `${generated.stats.selectedCount} tracks, ${formatRunningTime(generated.stats.totalSeconds)} ` +
      `(target ${formatRunningTime(generated.stats.targetSeconds)}).`,
  );
  // The library's own wording, so the terminal and the browser explain a thin result
  // identically.
  console.log(describeGeneration(generated.stats));
}

function printTrack(
  index: number,
  title: string,
  artist: string,
  durationSeconds: number | undefined,
): void {
  const minutes = Math.floor((durationSeconds ?? 0) / 60);
  const seconds = Math.round((durationSeconds ?? 0) % 60);
  const length = `${minutes}:${String(seconds).padStart(2, "0")}`;
  console.log(
    `  ${String(index + 1).padStart(3)}. ${title.slice(0, 48).padEnd(48)} ` +
      `${artist.slice(0, 28).padEnd(28)} ${length.padStart(6)}`,
  );
}

/** The value after a flag, e.g. `--minutes 60` -> "60". */
function valueOf(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}

/** Every value for a REPEATED flag -- how a multi-select arrives on a command line. */
function valuesOf(args: string[], flag: string): string[] {
  const values: string[] = [];
  args.forEach((arg, index) => {
    if (arg !== flag) return;
    const value = args[index + 1];
    if (value !== undefined && !value.startsWith("--")) values.push(value);
  });
  return values;
}

/**
 * A readable message for a thrown error.
 *
 * A ZodError's `.message` is the serialized ISSUE ARRAY -- printing it dumps twelve lines
 * of JSON at someone who typed a too-large `--minutes`, burying the schema's own perfectly
 * good wording inside it. So the first issue's message is preferred when there is one.
 */
function messageOf(error: unknown): string {
  const issues = (error as { issues?: { message?: string }[] }).issues;
  if (Array.isArray(issues)) {
    const first = issues[0]?.message;
    if (typeof first === "string" && first !== "") return first;
  }
  return error instanceof Error ? error.message : String(error);
}
