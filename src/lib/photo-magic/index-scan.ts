import {
  EXIF_HEADER_BYTES,
  dateFromFileName,
  dayFolderDateOf,
  listPhotoFoldersForRange,
  readExifDate,
  readJpegSize,
  type PhotoFileStore,
} from "@/lib/journal-photos";
import type { MagicScanRunRepository, PhotoIndexRepository } from "./ports";
import type { IndexedPhoto, ScanRunProgress } from "./types";

// Building the file-facts index: walk a date range, learn each photograph's size,
// dimensions and capture date, and write them down.
//
// The expensive half of the feature, and the reason the index exists at all. Every
// number here was chosen for a NAS over SMB, not for a local disk -- see the constants.
//
// NOTHING IS WRITTEN TO THE ARCHIVE. The facts go to the database; the photographs are
// read and never touched. `journal-photos/ports.ts` states that rule and
// `migrations/0093.md` justifies the one new (still read-only) port method this needs.

/** Yields to the event loop so synchronous better-sqlite3 writes don't freeze the app. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * How many files to process before letting the event loop breathe.
 *
 * `better-sqlite3` is synchronous, so a long uninterrupted run of writes blocks
 * everything else the app is doing -- on a DS223 that is the difference between "a scan
 * is running" and "the site is down". Same value, same reason, as the music scanner.
 */
const BATCH_SIZE = 200;

/** How often to write progress. Every file would be thousands of extra UPDATEs. */
const PROGRESS_EVERY = 25;

export interface IndexScanDependencies {
  photoIndex: PhotoIndexRepository;
  scanRuns: MagicScanRunRepository;
  fileStore: PhotoFileStore;
}

export interface IndexScanOptions {
  /** Inclusive `YYYY-MM-DD` bounds. Both absent means the whole archive. */
  fromDate?: string;
  toDate?: string;
  /**
   * An existing run row to report into, instead of opening a new one.
   *
   * The web adapter creates the row inside the request (so it can hand the id straight
   * back for polling) and then runs the scan without awaiting it. Without this the scan
   * would open a SECOND row and the screen would poll the wrong one. The CLI passes
   * nothing and gets a row created here.
   */
  scanRunId?: number;
  /** Stop early. For timing a sample on the NAS before committing to a full run. */
  limit?: number;
  isCancelled?: () => boolean;
}

export interface IndexScanSummary {
  scanRunId: number;
  status: "completed" | "failed" | "cancelled";
  filesTotal: number;
  filesSeen: number;
  filesIndexed: number;
  filesCached: number;
  filesFailed: number;
  lastError?: string;
}

/**
 * Indexes every photograph in the date range, reusing what has not changed.
 *
 * TWO PHASES, deliberately. Phase one walks the range and counts files without opening
 * any of them, so the progress bar has a denominator; until it lands, `filesTotal` is 0
 * and the bar reads as indeterminate rather than sitting at 0%. Phase two does the
 * reading. The count is cheap (directory listings) and the read is not, so paying for
 * the first buys an honest bar over the second.
 *
 * The whole archive when no range is given. That is a long walk, and the screen warns
 * before offering it, but it has to be possible: a photograph whose date cannot be
 * established has no range to be found in.
 */
export async function scanPhotoIndex(
  deps: IndexScanDependencies,
  options: IndexScanOptions = {},
): Promise<IndexScanSummary> {
  const fromDate = options.fromDate ?? "0001-01-01";
  const toDate = options.toDate ?? "9999-12-31";

  const scanRunId =
    options.scanRunId ??
    deps.scanRuns.createRun({
      fromDate: options.fromDate ?? "",
      toDate: options.toDate ?? "",
    });

  const progress: ScanRunProgress = {
    filesSeen: 0,
    filesIndexed: 0,
    filesCached: 0,
    filesFailed: 0,
    currentPath: "",
  };

  try {
    // --- Phase one: which folders, and how many files in them ----------------------
    //
    // `listPhotoFoldersForRange` is reused rather than re-walked: it reads each YEAR
    // folder exactly once and tests every name against the interval, so a ten-year
    // range costs ten directory reads instead of one per day. Re-implementing the walk
    // here would be a second copy of the archive's two folder conventions.
    const lookup = await listPhotoFoldersForRange(deps.fileStore, {
      from: fromDate,
      to: toDate,
    });

    if (!lookup.isAvailable) {
      const reason = lookup.reason ?? "unreachable";
      deps.scanRuns.finishRun(scanRunId, "failed", `The photo archive is ${reason}.`);
      return {
        scanRunId,
        status: "failed",
        filesTotal: 0,
        ...counts(progress),
        lastError: `The photo archive is ${reason}.`,
      };
    }

    // Folder names first, then their file lists. Collected up front so the total is
    // known before any photograph is opened.
    const files: { relativePath: string; folderDate?: string }[] = [];
    for (const folder of lookup.folders) {
      if (options.isCancelled?.() === true) break;
      const names = await deps.fileStore.listPhotoNames(folder.relativePath);
      // A day folder's name IS the date, which is the cheapest possible evidence and
      // the fallback when a photograph carries no EXIF and no dated filename.
      const folderDate = dayFolderDateOf(folder.name);
      for (const name of names) {
        files.push({ relativePath: `${folder.relativePath}/${name}`, folderDate });
      }
      // The listing itself is I/O; yield periodically so a wide range does not block.
      if (files.length % (BATCH_SIZE * 5) < names.length) await yieldToEventLoop();
    }

    const capped =
      options.limit === undefined ? files : files.slice(0, Math.max(0, options.limit));
    deps.scanRuns.setRunTotal(scanRunId, capped.length);

    if (options.isCancelled?.() === true) {
      deps.scanRuns.updateProgress(scanRunId, progress);
      deps.scanRuns.finishRun(scanRunId, "cancelled");
      return { scanRunId, status: "cancelled", filesTotal: capped.length, ...counts(progress) };
    }

    // --- Phase two: the facts ------------------------------------------------------
    for (let index = 0; index < capped.length; index += 1) {
      const file = capped[index]!;
      progress.filesSeen += 1;
      progress.currentPath = file.relativePath;

      await indexOneFile(deps, file, progress);

      if (progress.filesSeen % PROGRESS_EVERY === 0) {
        deps.scanRuns.updateProgress(scanRunId, progress);
      }

      if ((index + 1) % BATCH_SIZE === 0) {
        await yieldToEventLoop();
        if (options.isCancelled?.() === true) {
          deps.scanRuns.updateProgress(scanRunId, progress);
          deps.scanRuns.finishRun(scanRunId, "cancelled");
          return {
            scanRunId,
            status: "cancelled",
            filesTotal: capped.length,
            ...counts(progress),
          };
        }
      }
    }

    // The final write, so the bar lands on the real numbers rather than on whatever the
    // last multiple of PROGRESS_EVERY happened to be.
    progress.currentPath = "";
    deps.scanRuns.updateProgress(scanRunId, progress);
    deps.scanRuns.finishRun(scanRunId, "completed");

    return { scanRunId, status: "completed", filesTotal: capped.length, ...counts(progress) };
  } catch (error) {
    // A scan that throws must still close its row, or the `running` guard blocks every
    // later attempt until the staleness check eventually times it out.
    const message = error instanceof Error ? error.message : "The scan failed.";
    deps.scanRuns.updateProgress(scanRunId, progress);
    deps.scanRuns.finishRun(scanRunId, "failed", message);
    return {
      scanRunId,
      status: "failed",
      filesTotal: 0,
      ...counts(progress),
      lastError: message,
    };
  }
}

/**
 * Learns (or re-confirms) the facts for one photograph.
 *
 * One file's failure is counted and stepped over, never thrown: a single unreadable
 * photo in a folder of four hundred must not fail the scan, which is the same call
 * `readHeader` and `listPhotosInFolder` already make.
 */
async function indexOneFile(
  deps: IndexScanDependencies,
  file: { relativePath: string; folderDate?: string },
  progress: ScanRunProgress,
): Promise<void> {
  const stat = await deps.fileStore.statPhoto(file.relativePath);
  if (stat === undefined) {
    progress.filesFailed += 1;
    return;
  }

  // THE SKIP. Same size and same mtime means the file has not changed, so its
  // dimensions and capture date cannot have either -- no header read, no write. This is
  // what makes a re-scan of a range take seconds instead of minutes, and it is the
  // entire reason the index stores `file_mtime`.
  const known = deps.photoIndex.getFileFacts(file.relativePath);
  if (known !== undefined && known.bytes === stat.bytes && known.mtime === stat.mtime) {
    progress.filesCached += 1;
    return;
  }

  // One partial read serves BOTH remaining questions. The EXIF block and the JPEG frame
  // header both live in the first bytes, so the date and the dimensions come out of the
  // same buffer -- reading the file twice would double the cost of the scan for nothing.
  const header = await deps.fileStore.readHeader(file.relativePath, EXIF_HEADER_BYTES);
  if (header === undefined) {
    progress.filesFailed += 1;
    return;
  }

  const size = readJpegSize(header);
  const resolved = resolveDate(header, file);

  const photo: IndexedPhoto & { mtime: string } = {
    relativePath: file.relativePath,
    bytes: stat.bytes,
    width: size?.width,
    height: size?.height,
    takenAtDate: resolved.date,
    takenAtSource: resolved.source,
    mtime: stat.mtime,
  };

  deps.photoIndex.upsertPhoto(photo);
  progress.filesIndexed += 1;
}

/**
 * A photograph's capture date, and what kind of evidence produced it.
 *
 * The same three-tier preference the rest of the module uses -- EXIF, then a dated
 * filename, then the day folder's name -- so a picture's date means the same thing here
 * as it does in the viewer. The SOURCE is stored alongside because the three are not
 * equally trustworthy, and an index that flattened them would be asserting that
 * `IMG_20190609.jpg` is the camera's own word.
 */
function resolveDate(
  header: Uint8Array,
  file: { relativePath: string; folderDate?: string },
): { date?: string; source: IndexedPhoto["takenAtSource"] } {
  const exifDate = readExifDate(header);
  if (exifDate !== undefined) return { date: exifDate, source: "exif" };

  const name = file.relativePath.split("/").pop() ?? "";
  const nameDate = dateFromFileName(name);
  if (nameDate !== undefined) return { date: nameDate, source: "file-name" };

  if (file.folderDate !== undefined) return { date: file.folderDate, source: "folder" };

  return { source: "none" };
}

/** The four counters, for a summary. */
function counts(progress: ScanRunProgress) {
  return {
    filesSeen: progress.filesSeen,
    filesIndexed: progress.filesIndexed,
    filesCached: progress.filesCached,
    filesFailed: progress.filesFailed,
  };
}
