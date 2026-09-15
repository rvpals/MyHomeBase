// Builds a Magic List from the terminal, and indexes the archive for one.
//
// The same use-cases the web screen drives, with argv instead of a form -- which is the
// litmus test in ARCHITECTURE.md. Nothing in src/lib/photo-magic changed to add this
// command, because the use-cases never assumed a browser.
//
// Usage:
//   npm run cli -- photo-magic [--from YYYY-MM-DD] [--to YYYY-MM-DD]
//                              [--min-mb N] [--max-mb N]
//                              [--min-width N] [--min-height N]
//                              [--max-width N] [--max-height N]
//                              [--count N] [--save "Name"] [--description "..."]
//   npm run cli -- photo-magic --scan [--from ...] [--to ...] [--limit N]
//   npm run cli -- photo-magic --status
//   npm run cli -- photo-magic --list
//   npm run cli -- photo-magic --load <id>
//   npm run cli -- photo-magic --regenerate <id>
//   npm run cli -- photo-magic --delete <id>
//   npm run cli -- photo-magic --clear-index
//
//   npm run cli -- photo-magic --scan --from 2019-01-01 --to 2019-12-31
//   npm run cli -- photo-magic --from 2019-06-01 --to 2019-08-31 --min-width 1920 --count 50
//   npm run cli -- photo-magic --min-mb 4 --count 25 --save "Big ones"
//
// SCAN BEFORE SEARCHING. A folder listing knows a photograph's name but not its size or
// dimensions, so the index has to be built once per period before anything will match.
// `--scan` here is the same walk the web screen's progress bar drives; unlike the web
// one it runs in the foreground, which is what makes it useful for timing a real range
// against the NAS.

import {
  canStartScan,
  clearPhotoIndex,
  countIndexedPhotos,
  countPhotoMagicCandidates,
  deletePhotoMagicList,
  describeCriteria,
  describeGeneration,
  describePhotoMagicFailure,
  emptyCriteria,
  formatBytes,
  generatePhotoMagicList,
  getScanStatus,
  listPhotoMagicLists,
  loadGeneratedPhotos,
  loadPhotoMagicList,
  regeneratePhotoMagicList,
  savePhotoMagicList,
  scanPhotoIndex,
  scanProgressPercent,
  type GeneratedPhotoSet,
  type IndexedPhoto,
  type PhotoMagicCriteria,
  type PhotoMagicDependencies,
} from "@/lib/photo-magic";
import { NodePhotoFileStore } from "@/lib/journal-photos";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";

/** The three repositories the use-cases take -- the same set `wiring.ts` built. */
function magicDeps(): PhotoMagicDependencies {
  return {
    listRepo: deps.photoMagicListRepo,
    photoIndex: deps.photoIndexRepo,
    scanRuns: deps.photoMagicScanRunRepo,
  };
}

export async function photoMagicCommand(args: string[]): Promise<void> {
  // Sub-modes first: each is a different verb and they do not combine with generating.
  if (args.includes("--list")) {
    printSavedLists();
    return;
  }

  if (args.includes("--status")) {
    printScanStatus();
    return;
  }

  if (args.includes("--clear-index")) {
    clearPhotoIndex(magicDeps());
    console.log("The photo index was cleared. Saved lists are untouched.");
    return;
  }

  if (args.includes("--scan")) {
    await withReadableErrorsAsync(() => runScan(args));
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

  withReadableErrors(() => runGenerate(args));
}

/** Thrown for a bad argument, so the catch below can tell it from a real crash. */
class UsageError extends Error {}

/**
 * Runs a sub-command, turning a validation failure into one readable line.
 *
 * Without this, a mistyped date reaches the zod schema and Node prints a ZodError with
 * a stack trace -- a wall of JSON for a typo. The schemas hold the right wording; this
 * just makes sure that is what gets shown.
 */
function withReadableErrors(run: () => void): void {
  try {
    run();
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}

async function withReadableErrorsAsync(run: () => Promise<void>): Promise<void> {
  try {
    await run();
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

/** Criteria assembled from argv. Absent flag = absent bound, exactly as on the web. */
function criteriaFrom(args: string[]): PhotoMagicCriteria {
  const mb = (flag: string): number | undefined => {
    const raw = valueOf(args, flag);
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new UsageError(`${flag} needs a number of megabytes, not "${raw}".`);
    }
    return Math.round(parsed * 1024 * 1024);
  };

  const pixels = (flag: string): number | undefined => {
    const raw = valueOf(args, flag);
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new UsageError(`${flag} needs a whole number of pixels, not "${raw}".`);
    }
    return parsed;
  };

  const count = valueOf(args, "--count");

  return {
    ...emptyCriteria(),
    fromDate: valueOf(args, "--from"),
    toDate: valueOf(args, "--to"),
    minBytes: mb("--min-mb"),
    maxBytes: mb("--max-mb"),
    minWidth: pixels("--min-width"),
    minHeight: pixels("--min-height"),
    maxWidth: pixels("--max-width"),
    maxHeight: pixels("--max-height"),
    maxPhotos: count === undefined ? emptyCriteria().maxPhotos : requireId(count, "--count"),
  };
}

/** Generates from criteria on the command line, optionally saving them first. */
function runGenerate(args: string[]): void {
  const dependencies = magicDeps();
  const criteria = criteriaFrom(args);

  const indexed = countIndexedPhotos(dependencies);
  if (indexed === 0) {
    console.log("Nothing is indexed yet. Run with --scan first, e.g.");
    console.log("  npm run cli -- photo-magic --scan --from 2019-01-01 --to 2019-12-31");
    return;
  }

  console.log(describeCriteria(criteria));
  console.log(`${countPhotoMagicCandidates(dependencies, criteria)} indexed photographs match.`);

  const saveName = valueOf(args, "--save");
  let listId: number | undefined;

  if (saveName !== undefined) {
    const saved = savePhotoMagicList(dependencies, {
      name: saveName,
      description: valueOf(args, "--description") ?? "",
      criteria,
    });
    if (!saved.ok) {
      console.error(describePhotoMagicFailure(saved.failure));
      process.exitCode = 1;
      return;
    }
    listId = saved.value;
    console.log(`Saved as list ${listId}: “${saveName}”.`);
  }

  const result = generatePhotoMagicList(dependencies, { listId, criteria }, Math.random);
  if (!result.ok) {
    console.error(describePhotoMagicFailure(result.failure));
    process.exitCode = 1;
    return;
  }

  printGenerated(result.value);
}

/** Walks the archive and fills the index, reporting progress as it goes. */
async function runScan(args: string[]): Promise<void> {
  const dependencies = magicDeps();

  if (!canStartScan(dependencies)) {
    console.error(describePhotoMagicFailure({ kind: "scan-in-progress" }));
    process.exitCode = 1;
    return;
  }

  const fromDate = valueOf(args, "--from");
  const toDate = valueOf(args, "--to");
  const limitRaw = valueOf(args, "--limit");
  const limit = limitRaw === undefined ? undefined : requireId(limitRaw, "--limit");

  console.log(
    fromDate === undefined && toDate === undefined
      ? "Scanning the whole archive. This reads every photograph once and can take a while."
      : `Scanning ${fromDate ?? "the beginning"} to ${toDate ?? "the end"}.`,
  );

  const summary = await scanPhotoIndex(
    {
      photoIndex: dependencies.photoIndex,
      scanRuns: dependencies.scanRuns,
      // The archive path comes from the Journal module's setting in the web app; on the
      // command line the env var is the only source, which is what `deps` already holds.
      fileStore: new NodePhotoFileStore(deps.photoRootFromEnv),
    },
    { fromDate, toDate, limit },
  );

  if (summary.status !== "completed") {
    console.error(`Scan ${summary.status}: ${summary.lastError ?? "no reason given"}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Scanned ${summary.filesSeen} files — ${summary.filesIndexed} indexed, ` +
      `${summary.filesCached} unchanged, ${summary.filesFailed} unreadable.`,
  );
  console.log(`${countIndexedPhotos(dependencies)} photographs are now indexed.`);
}

/** What a scan is doing right now, for a run started in the browser. */
function printScanStatus(): void {
  const dependencies = magicDeps();
  const run = getScanStatus(dependencies);

  if (run === undefined) {
    console.log(`No scan is running. ${countIndexedPhotos(dependencies)} photographs indexed.`);
    return;
  }

  const percent = scanProgressPercent(run);
  console.log(
    `Scan ${run.id}: ${run.status}${run.isStale ? " (stale)" : ""} — ` +
      `${percent === undefined ? "counting" : `${percent}%`}, ` +
      `${run.filesSeen}/${run.filesTotal} files, ` +
      `${run.filesIndexed} indexed, ${run.filesCached} unchanged.`,
  );
  if (run.currentPath !== "") console.log(`  reading: ${run.currentPath}`);
  if (run.lastError !== "") console.log(`  error: ${run.lastError}`);
}

function printSavedLists(): void {
  const lists = listPhotoMagicLists(magicDeps());
  if (lists.length === 0) {
    console.log("No saved Magic Lists.");
    return;
  }
  for (const list of lists) {
    const generated = list.lastGeneratedAt ?? "never generated";
    console.log(
      `${String(list.id).padStart(4)}  ${list.name} — ${list.photoCount} photos, ` +
        `up to ${list.maxPhotos} (${generated})`,
    );
    if (list.description !== "") console.log(`        ${list.description}`);
  }
}

function runLoad(id: number): void {
  const dependencies = magicDeps();
  const result = loadPhotoMagicList(dependencies, id);
  if (!result.ok) {
    console.error(describePhotoMagicFailure(result.failure));
    process.exitCode = 1;
    return;
  }

  console.log(`${result.value.name}`);
  if (result.value.description !== "") console.log(result.value.description);
  console.log(describeCriteria(result.value.criteria));

  // The stored set, not a fresh draw -- loading must show what was kept, matching the
  // web screen. `--regenerate` is the explicit way to re-roll.
  const photos = loadGeneratedPhotos(dependencies, id);
  console.log(`\n${photos.length} photographs in the stored set:`);
  printPhotos(photos);
}

function runRegenerate(id: number): void {
  const result = regeneratePhotoMagicList(magicDeps(), id, Math.random);
  if (!result.ok) {
    console.error(describePhotoMagicFailure(result.failure));
    process.exitCode = 1;
    return;
  }
  printGenerated(result.value);
}

function runDelete(id: number): void {
  const result = deletePhotoMagicList(magicDeps(), id);
  if (!result.ok) {
    console.error(describePhotoMagicFailure(result.failure));
    process.exitCode = 1;
    return;
  }
  console.log(`Deleted list ${id}. No photograph was touched.`);
}

function printGenerated(generated: GeneratedPhotoSet): void {
  console.log(describeGeneration(generated.stats));
  printPhotos(generated.photos);
}

function printPhotos(photos: readonly IndexedPhoto[]): void {
  for (const photo of photos) {
    const size =
      photo.width === undefined || photo.height === undefined
        ? "unknown size"
        : `${photo.width}×${photo.height}`;
    console.log(
      `  ${photo.takenAtDate ?? "undated"}  ${formatBytes(photo.bytes).padStart(9)}  ` +
        `${size.padStart(11)}  ${photo.relativePath}`,
    );
  }
}

/** The value after `--flag`, or undefined when the flag is absent. */
function valueOf(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  // A flag followed by another flag has no value -- treated as absent rather than
  // silently consuming "--count" as a date.
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}
