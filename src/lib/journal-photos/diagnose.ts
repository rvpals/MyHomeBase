import { yearFolderOf } from "./paths";
import type { PhotoFileStore } from "./ports";
import type { PhotoArchiveDiagnosis, PhotoRootCheck } from "./types";

// The "Check Access" report for the Journal configuration screen.
//
// Exists because a boolean "can't be reached" was not enough to fix a real
// misconfiguration: the path was right, the volume was right, and the message still said
// nothing about which of four causes applied. This walks the same steps the photo card
// takes and reports what happened at each one, so the screen can show evidence rather
// than a verdict.
//
// Read-only, like everything else in this module -- it lists and stats, nothing more.

/** How many year folders to list in the report. Enough to prove it read the archive. */
const SAMPLE_YEAR_LIMIT = 40;

/** How many child folders of the sample year to show. */
const SAMPLE_FOLDER_LIMIT = 12;

/**
 * How many folders to look inside for JPEGs before giving up.
 *
 * Small on purpose: this is proof that files are readable, not a survey. An archive
 * whose first few folders are all empty is unusual enough that reporting 0 is fair.
 */
const PHOTO_PROBE_LIMIT = 5;

/**
 * Checks the configured archive and reports what was found, step by step.
 *
 * Deliberately does NOT throw: every failure is part of the report, because the whole
 * point is to describe a broken configuration rather than fail on one.
 *
 * `sampleDate` decides which year folder gets inspected in detail -- the caller passes
 * an entry's date (or today) so the report answers "would a lookup for this date have
 * worked", not just "does the root exist".
 */
export async function diagnosePhotoArchive(
  store: PhotoFileStore,
  sampleDate: string,
): Promise<PhotoArchiveDiagnosis> {
  const rootCheck: PhotoRootCheck = await store.checkRoot();

  // Nothing below can succeed if the root itself is unusable, and each of these has its
  // own fix -- so the report stops here rather than adding noise about missing years.
  if (rootCheck.kind !== "ok") {
    return {
      rootCheck,
      yearFolders: [],
      yearFolderCount: 0,
      truncatedYears: false,
      sampleYear: yearFolderOf(sampleDate),
      sampleYearExists: false,
      sampleFolders: [],
      sampleFolderCount: 0,
      truncatedFolders: false,
      samplePhotoCount: undefined,
      samplePhotoFolder: undefined,
    };
  }

  // The root reads. Now: can its children be listed? A root that stats but lists empty
  // is the signature of a permissions problem one level down, which is worth showing
  // rather than reporting as an empty archive.
  const allYears = await store.listFolderNames("");
  const yearFolders = allYears.slice(0, SAMPLE_YEAR_LIMIT);

  const sampleYear = yearFolderOf(sampleDate);
  const sampleYearExists = await store.folderExists(sampleYear);

  let sampleFolders: string[] = [];
  let sampleFolderCount = 0;
  let samplePhotoCount: number | undefined;
  let samplePhotoFolder: string | undefined;

  if (sampleYearExists) {
    const children = await store.listFolderNames(sampleYear);
    sampleFolderCount = children.length;
    sampleFolders = children.slice(0, SAMPLE_FOLDER_LIMIT);

    // One folder's JPEG count, as end-to-end proof that FILES -- not just directory
    // names -- are readable.
    //
    // Tries a few folders rather than only the first, and reports the first non-empty
    // one. An empty folder is common and harmless (a month nobody filed photos in, or a
    // RAW-only folder), but reporting "0 JPEGs" for a perfectly healthy archive reads
    // like a failure. Capped at a handful so a diagnostic never becomes a full scan.
    for (const child of children.slice(0, PHOTO_PROBE_LIMIT)) {
      const count = (await store.listPhotoNames(`${sampleYear}/${child}`)).length;
      // Record the first result either way, so a genuinely empty year still reports 0
      // rather than nothing at all.
      samplePhotoCount ??= count;
      if (count > 0) {
        samplePhotoCount = count;
        samplePhotoFolder = child;
        break;
      }
    }
  }

  return {
    rootCheck,
    yearFolders,
    yearFolderCount: allYears.length,
    truncatedYears: allYears.length > yearFolders.length,
    sampleYear,
    sampleYearExists,
    sampleFolders,
    sampleFolderCount,
    truncatedFolders: sampleFolderCount > sampleFolders.length,
    samplePhotoCount,
    samplePhotoFolder,
  };
}
