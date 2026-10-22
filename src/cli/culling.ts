// Culling a folder of photographs from the terminal.
//
//   npm run cli -- culling "2019/2019-06"
//   npm run cli -- culling "2019/2019-06" --out results.json
//   npm run cli -- culling "2019/2019-06" --keep 20 --distance 6
//
// The folder is relative to the configured photo root (the Journal module's
// `photo_root`) — quote it, the folder names contain spaces.
//
// READ-ONLY. This prints a ranking and, if asked, writes one JSON file to a path you
// name. It never deletes a reject, moves a keeper, or writes anything into the
// archive — see `lib/culling/ports.ts`.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  configuredPhotoRoot,
  cullFolder,
  NodeCullingImageStore,
  type CullResult,
} from "@/lib/culling";
import { messageOf } from "./error-message";

const USAGE = `Usage:
  culling <folder> [--out <file.json>] [--keep <n>] [--fraction <0-1>]
                   [--distance <bits>] [--concurrency <n>]

  <folder>        Relative to the photo root, e.g. "2019/2019-06"
  --out           Write the full result as JSON to this path
  --keep          Keep only the best N; the rest become "low score" rejects
  --fraction      The same as a fraction, e.g. 0.25 for the top quarter
  --distance      Duplicate threshold in bits (default 10)
  --concurrency   Images decoded at once (default 4)

  With neither --keep nor --fraction, every non-duplicate is a keeper.`;

/** A named option's value, or `undefined` when the flag is absent. */
function optionOf(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

/** A numeric option, rejected rather than silently coerced to NaN. */
function numberOf(args: string[], flag: string): number | undefined {
  const raw = optionOf(args, flag);
  if (raw === undefined) return undefined;

  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${flag} needs a number, got "${raw}".`);
  return value;
}

export async function cullingCommand(args: string[]): Promise<void> {
  const folder = args[0];
  if (folder === undefined || folder.startsWith("--")) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  try {
    const root = configuredPhotoRoot();
    const result = await cullFolder(new NodeCullingImageStore(root), folder, {
      keepCount: numberOf(args, "--keep"),
      keepFraction: numberOf(args, "--fraction"),
      duplicateDistance: numberOf(args, "--distance"),
      concurrency: numberOf(args, "--concurrency"),
    });

    printResult(result);

    const outPath = optionOf(args, "--out");
    if (outPath !== undefined) {
      await writeResult(result, outPath, root);
    }
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}

function printResult(result: CullResult): void {
  console.log(`\n${result.folder} — examined ${result.examined} file(s)\n`);

  if (result.keepers.length === 0 && result.unreadable.length === 0) {
    console.log("  No images found in that folder.");
    return;
  }

  console.log(`  Keepers (${result.keepers.length}):`);
  for (const photo of result.keepers) {
    console.log(`    ${photo.score.toFixed(3)}  ${photo.name}  — ${photo.reason}`);
  }

  if (result.rejects.length > 0) {
    console.log(`\n  Rejects (${result.rejects.length}, ${result.duplicateGroups} duplicate group(s)):`);
    for (const photo of result.rejects) {
      const of = photo.duplicateOf === undefined ? "" : ` of ${path.basename(photo.duplicateOf)}`;
      console.log(
        `    ${photo.score.toFixed(3)}  ${photo.name}  — ${photo.rejectReason}${of}`,
      );
    }
  }

  if (result.unreadable.length > 0) {
    console.log(`\n  Unreadable (${result.unreadable.length}):`);
    for (const photo of result.unreadable) {
      console.log(`    ${photo.name}  — ${photo.error}`);
    }
  }
}

/**
 * Writes the result as JSON, refusing a path inside the photo archive.
 *
 * The archive is read-only by design and this is the one place in the feature that
 * writes anything at all, so the check belongs here rather than in the library: a
 * results file dropped beside the photographs is exactly the kind of stray index the
 * port's doctrine exists to prevent.
 */
async function writeResult(result: CullResult, outPath: string, photoRoot: string): Promise<void> {
  const absolute = path.resolve(outPath);
  const root = path.resolve(photoRoot);

  if (root !== "" && !path.relative(root, absolute).startsWith("..")) {
    throw new Error(
      `Refusing to write results inside the photo archive (${root}). ` +
        `Choose a path outside it — the archive is read-only.`,
    );
  }

  await writeFile(absolute, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`\n  Wrote ${absolute}`);
}
