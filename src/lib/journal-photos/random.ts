import { EXIF_HEADER_BYTES, readExifDate } from "./exif";
import { dateFromFileName } from "./paths";
import type { PhotoFileStore } from "./ports";
import type { PhotoRootCheck } from "./types";
import type { RandomSource } from "@/lib/shared/random";

// The "surprise me" use-case: one photograph from anywhere in the archive.
//
// Deliberately NOT built on `listPhotoFoldersForDate`. That one answers "which folders
// belong to this date", which means matching every folder name in a year against a
// pattern; here nothing is being matched, so the cheap path is three directory reads
// and two dice rolls. Asking the date lookup instead would read the whole year to
// filter it down and then throw the filter away.
//
// The cost model is what shapes this file. Every step is one round trip to an SMB
// share, so the walk reads exactly one listing per level -- root, year, folder -- and
// never enumerates what it does not need. A folder of 2,000 photos costs the same as a
// folder of 3: the names come back in one call and one index is chosen from them, with
// no file opened until the browser asks the image route for the bytes.

/**
 * How many times to re-roll when a pick lands somewhere with no photographs in it.
 *
 * Empty and RAW-only folders are ordinary in a real archive, and a card that says "no
 * photo found" because it happened to land on one would look broken. Eight is enough
 * that hitting empties every time is vanishingly unlikely in an archive with anything
 * in it, and small enough to bound the walk at 24 directory reads on the pathological
 * case rather than letting it wander the whole share.
 */
const MAX_ATTEMPTS = 8;

/**
 * One photograph drawn at random, or why none could be.
 *
 * Shaped like `PhotoFolderLookup`'s result rather than returning a bare `PhotoFile |
 * undefined`, for the same reason: the card has to tell an unconfigured archive apart
 * from an unreachable one apart from an empty one, and those are three different
 * things for the reader to do something about.
 */
export interface RandomPhotoPick {
  /** Whether the photo root is configured AND readable. */
  isAvailable: boolean;
  /**
   * Why no photo was drawn.
   *
   * `no-photos` means the archive read fine and the walk still came up empty -- an
   * archive with no year folders, or one where every pick landed on a folder with no
   * JPEGs in it. Every other value is carried verbatim from `PhotoRootCheck`, so the
   * card can name the actual fix.
   */
  reason?: PhotoRootCheck["kind"] | "no-photos";
  /** The configured path, echoed back so the card can show what it tried. */
  rootPath?: string;
  /** The file name, e.g. `IMG_20190609_143501.jpg`. */
  name?: string;
  /** Path from the photo root, for the image route to serve. */
  relativePath?: string;
  /** The name of the folder it came from, for the caption. */
  folderName?: string;
  /** The year folder it came from, e.g. `2019`. */
  year?: string;
  /**
   * The day it was taken, `YYYY-MM-DD`, or `undefined` when nothing readable says.
   *
   * Only the day, not the instant: that is all EXIF's `DateTimeOriginal` is parsed
   * down to elsewhere in this module, and "how long ago" is a question about days.
   */
  takenAt?: string;
  /**
   * Where `takenAt` came from — the same vocabulary as `PhotoFile.matchedBy`, so a
   * reader can tell a camera's own stamp from a guess off the file name.
   */
  takenAtSource?: "exif" | "file-name";
}

/**
 * Draws one photograph from anywhere in the archive.
 *
 * The walk, one uniform pick per level: a year folder from the root, then any folder
 * inside that year -- a `YYYY-MM` month folder and a `YYYY-MM-DD <event>` day folder
 * are equally eligible, so nothing filed under an event is unreachable -- then one file
 * from that folder's JPEGs.
 *
 * Note that this is uniform over FOLDERS, not over photographs: a day folder holding
 * three shots is as likely to be chosen as a month folder holding four hundred, so a
 * photo in the small folder is far likelier to surface than any given one in the large
 * one. That is the behaviour asked for, and it is arguably the nicer one for a
 * dashboard -- weighting by count would make the card a window onto whichever month
 * happened to be dumped in bulk. Correcting it would mean counting every folder in the
 * year on every draw, which is the full-archive read this design exists to avoid.
 *
 * `random` is a parameter rather than `Math.random` so the walk is testable; callers
 * pass the real thing.
 */
export async function pickRandomPhoto(
  store: PhotoFileStore,
  random: RandomSource = Math.random,
): Promise<RandomPhotoPick> {
  // The specific reason, not just "unavailable" -- an unset path, a wrong one, and a
  // share the app's user cannot read need three different fixes, and the card says
  // which. Checked once, outside the retry loop: none of these get better by re-rolling.
  const rootCheck = await store.checkRoot();
  if (rootCheck.kind !== "ok") {
    return {
      isAvailable: false,
      reason: rootCheck.kind,
      rootPath: "path" in rootCheck ? rootCheck.path : undefined,
    };
  }

  const years = await store.listFolderNames("");
  if (years.length === 0) {
    return { isAvailable: true, reason: "no-photos", rootPath: rootCheck.path };
  }

  // Re-rolls the WHOLE walk, not just the innermost step. A year whose only folder is
  // empty would otherwise trap the retry loop in that one year for all eight attempts;
  // starting over each time keeps every attempt an independent draw.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const year = pickOne(years, random);
    if (year === undefined) continue;

    const folders = await store.listFolderNames(year);
    if (folders.length === 0) continue;

    const folderName = pickOne(folders, random);
    if (folderName === undefined) continue;

    const relativeFolder = `${year}/${folderName}`;
    const photoNames = await store.listPhotoNames(relativeFolder);
    if (photoNames.length === 0) continue;

    const name = pickOne(photoNames, random);
    if (name === undefined) continue;

    const relativePath = `${relativeFolder}/${name}`;

    return {
      isAvailable: true,
      rootPath: rootCheck.path,
      name,
      relativePath,
      folderName,
      year,
      ...(await takenDateOf(store, relativePath, name)),
    };
  }

  // Readable archive, nothing found in eight tries. Reported as an ordinary empty
  // result rather than an error: the likeliest cause is an archive of RAW files or
  // one still being filled, neither of which is a fault to report.
  return { isAvailable: true, reason: "no-photos", rootPath: rootCheck.path };
}

/**
 * One item chosen uniformly, or `undefined` from an empty list.
 *
 * The clamp is for a pathological `random` returning exactly 1 (or more), which would
 * index off the end and hand back `undefined` -- the same guard, for the same reason,
 * as `shuffle` in shared/random.ts.
 */
function pickOne<T>(items: readonly T[], random: RandomSource): T | undefined {
  if (items.length === 0) return undefined;
  const index = Math.min(Math.max(Math.floor(random() * items.length), 0), items.length - 1);
  return items[index];
}

/**
 * When one photograph was taken, and on what evidence.
 *
 * EXIF first, the file name second, nothing third — the same order and the same
 * reasoning as `matchPhoto` in photos.ts: a camera's own stamp beats a name that a
 * copy or a rename can have got wrong.
 *
 * One extra partial read per draw, and only ever for the single file that was picked —
 * not for the folder it sits in. That is what keeps this affordable on a card that
 * redraws on a button press: the walk above is three directory listings, and this adds
 * one header read of a few KB, not a scan.
 *
 * Never throws and never returns a reason. A photo whose header cannot be read, or
 * whose metadata is missing or corrupt, simply has no date — the card drops the age
 * from its title and still shows the picture, which is the only sensible outcome. A
 * missing timestamp is not a failed draw.
 */
async function takenDateOf(
  store: PhotoFileStore,
  relativePath: string,
  name: string,
): Promise<{ takenAt?: string; takenAtSource?: "exif" | "file-name" }> {
  try {
    const header = await store.readHeader(relativePath, EXIF_HEADER_BYTES);
    const fromExif = header === undefined ? undefined : readExifDate(header);
    if (fromExif !== undefined) return { takenAt: fromExif, takenAtSource: "exif" };
  } catch {
    // A read that fails on this one file — a permission, a dropped share mid-draw.
    // Falls through to the file name, which needs no I/O at all.
  }

  const fromName = dateFromFileName(name);
  if (fromName !== undefined) return { takenAt: fromName, takenAtSource: "file-name" };

  return {};
}
