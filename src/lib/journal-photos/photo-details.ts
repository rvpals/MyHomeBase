import { EXIF_HEADER_BYTES, readExifDateTime } from "./exif";
import {
  dateFromFileName,
  dayFolderDateOf,
  isSafeRelativePath,
  normaliseRelativePath,
} from "./paths";
import type { PhotoFileStore } from "./ports";
import type { PhotoDetails } from "./types";

// Use-case: what one photograph can tell us about itself.
//
// Deliberately ONE PHOTO. The viewer calls this for the picture on the stage and no
// others, which is the whole reason it can afford to read a file at all: browsing a
// 1,187-photo folder reads 1,187 directory entries and exactly as many EXIF headers as
// there are photos someone actually looked at.
//
// That is why this is not folded into `listAllPhotosInFolder`, whose contract is "no
// file is ever opened". Adding a timestamp there would put a per-photo SMB read behind
// a folder listing, and a big folder would take minutes to paint. The split is the
// performance design, not an accident of organisation.

/**
 * The full path and capture timestamp of one photograph.
 *
 * Never throws and never reports failure as an error: a photo whose header cannot be
 * read still has a path worth showing, so the timestamp is simply absent. The viewer
 * renders "Not available" for that case, which is the truth and is all a reader can act
 * on -- there is nothing to retry and nothing to fix.
 *
 * `readHeader` is a PARTIAL read (`EXIF_HEADER_BYTES`), not the whole file. A 6MB photo
 * over SMB would otherwise be pulled in full to read a timestamp sitting in its first
 * few KB.
 */
export async function readPhotoDetails(
  store: PhotoFileStore,
  input: { relativePath: string },
): Promise<PhotoDetails> {
  const relativePath = normaliseRelativePath(input.relativePath);

  // Refused here as well as at the boundary schema and again in `NodePhotoFileStore`.
  // Belt and braces on any path that becomes a file read -- the same reasoning the
  // image route and `listAllPhotosInFolder` both document.
  if (!isSafeRelativePath(relativePath)) {
    return { relativePath, takenAtSource: "none" };
  }

  const exif = await readExifHeader(store, relativePath);
  if (exif !== undefined) {
    return {
      relativePath,
      takenAtDate: exif.date,
      ...(exif.time === undefined ? {} : { takenAtTime: exif.time }),
      takenAtSource: "exif",
    };
  }

  // No EXIF. The archive's own naming is the next best evidence and is often the only
  // evidence for a scan or a shared image, which carry no camera metadata at all.
  //
  // Reported with its source rather than silently presented as a capture time: "the
  // camera says 14:35" and "the file is called IMG_20190609" are different claims, and
  // the viewer labels them differently. A guess dressed up as a fact is worse than an
  // honest absence.
  const inferred = inferDateFromNames(relativePath);
  if (inferred !== undefined) {
    return { relativePath, takenAtDate: inferred.date, takenAtSource: inferred.source };
  }

  return { relativePath, takenAtSource: "none" };
}

/**
 * The EXIF timestamp, or `undefined` for every way that can fail.
 *
 * The try/catch is the point: `readHeader` reaches a NAS over SMB, and a share that
 * drops mid-read must leave the viewer showing a photo with an unknown date rather than
 * throwing across a server-action boundary.
 */
async function readExifHeader(store: PhotoFileStore, relativePath: string) {
  try {
    const header = await store.readHeader(relativePath, EXIF_HEADER_BYTES);
    if (header === undefined) return undefined;
    return readExifDateTime(header);
  } catch {
    return undefined;
  }
}

/**
 * A date from the file name, else from the folder name.
 *
 * File name FIRST because it is per-photo: inside a month folder every picture is a
 * different day, so the folder can only say which month. This is the same precedence
 * `photoJournalDate` uses for the Journal link, kept deliberately in step -- a viewer
 * that dated a photo one way and linked the journal another would be reporting two
 * different days for one picture.
 */
function inferDateFromNames(
  relativePath: string,
): { date: string; source: "file-name" | "folder" } | undefined {
  const segments = relativePath.split("/");
  const fileName = segments.at(-1) ?? "";

  const fromFileName = dateFromFileName(fileName);
  if (fromFileName !== undefined) return { date: fromFileName, source: "file-name" };

  // Only a DAY folder yields a date. A month folder (`2019-06 June`) establishes no
  // single day, and reporting the first of the month would be an invention.
  const folderName = segments.at(-2);
  const fromFolder = folderName === undefined ? undefined : dayFolderDateOf(folderName);
  if (fromFolder !== undefined) return { date: fromFolder, source: "folder" };

  return undefined;
}
