import { formatOf, type MusicExtension } from "./formats";
import { parentFolderOf } from "./paths";
import type { AudioMetadataReader, MusicFileStore, MusicRepository, TrackTags } from "./ports";
import type { ScanRunProgress, TrackFileFacts, TrackUpsert } from "./types";

// The library scanner.
//
// TWO PHASES, and the reason is the progress bar: a percentage needs a denominator, so
// a fast walk counts candidate files first (reading directory entries, opening
// nothing) and writes the total. The slow pass then reads tags, reporting the file it
// is on as it goes. While the total is 0 the UI shows an indeterminate bar.
//
// BATCHED AND YIELDING, and the reason is the NAS: a DS223 with 2 GB of RAM, already
// swapping at idle (scripts/publish-nas.mjs), and `better-sqlite3` is synchronous. A
// tight loop writing 20k rows would block the event loop and make every other page in
// the app unresponsive. So writes are committed a batch at a time and the loop yields
// between batches -- slightly slower overall, deliberately, so the app stays usable
// while a scan runs. A worker thread would isolate this properly but needs a third
// bundled entry point in publish-nas.mjs and a worker path that resolves both under
// `next dev` and in the standalone build; see migrations/0052 for that decision.
//
// READ-ONLY: everything here goes through MusicFileStore, which has no write method.
// A scan never modifies, moves or deletes a music file. `deleteTracksMissingFrom`
// removes CATALOG rows for files that are already gone from disk.

/**
 * Lets the event loop run before continuing.
 *
 * A bare `setTimeout(0)` rather than `node:timers/promises`: this module is reached from
 * the library's barrel export, which a client component may import for a type or a
 * constant, and a `node:` builtin in that graph fails the Turbopack browser build even
 * though the scanner itself only ever runs on the server.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** How many files to process before committing and letting the event loop breathe. */
const BATCH_SIZE = 200;

/** How often to write progress. Every file would be 20k extra UPDATEs. */
const PROGRESS_EVERY = 25;

export interface ScanDependencies {
  musicRepo: MusicRepository;
  fileStore: MusicFileStore;
  metadataReader: AudioMetadataReader;
}

export interface ScanOptions {
  /** Relative to the music root. '' scans everything. */
  folder: string;
  extensions: readonly MusicExtension[];
  /** Skip formats no browser can play (ape, wma) rather than cataloguing them. */
  skipUnstreamable: boolean;
  /**
   * Stop after this many files. For timing a sample on the NAS before committing to a
   * full run -- the difference between a guess and a measurement.
   */
  limit?: number;
  /** Remove catalog rows whose files have vanished. Off for a limited/sample scan. */
  pruneMissing?: boolean;
  /** Checked between batches so a scan can be stopped without waiting for it to end. */
  isCancelled?: () => boolean;
}

export interface ScanSummary {
  scanRunId: number;
  status: "completed" | "failed" | "cancelled";
  filesTotal: number;
  filesSeen: number;
  tracksAdded: number;
  tracksUpdated: number;
  filesSkipped: number;
  filesFailed: number;
  tracksRemoved: number;
  lastError: string;
}

/**
 * Scans a folder and writes what it finds to the catalog.
 *
 * Returns a summary; progress is written to `mus_scan_runs` as it goes so the web UI
 * can poll it and a CLI run can print it. Never throws for a per-file problem -- an
 * unreadable or corrupt file is counted in `filesFailed` and the scan continues.
 */
export async function scanLibrary(
  deps: ScanDependencies,
  options: ScanOptions,
): Promise<ScanSummary> {
  const extensions = effectiveExtensions(options);
  const scanRunId = deps.musicRepo.createScanRun({
    rootFolder: options.folder,
    extensions,
  });

  const progress: ScanRunProgress = {
    filesSeen: 0,
    tracksAdded: 0,
    tracksUpdated: 0,
    filesSkipped: 0,
    filesFailed: 0,
    currentPath: "",
  };
  let tracksRemoved = 0;
  let filesTotal = 0;
  // Albums touched by this scan, so their track_count can be refreshed once at the
  // end. Recounting per track would be one extra UPDATE per file.
  const touchedAlbumIds = new Set<number>();

  try {
    if (!(await deps.fileStore.isRootAvailable())) {
      deps.musicRepo.finishScanRun(scanRunId, "failed", "The music folder is not reachable.");
      return {
        ...summaryOf(scanRunId, "failed", 0, progress, 0),
        lastError: "The music folder is not reachable.",
      };
    }

    // --- Phase one: count, so the progress bar has a denominator. -------------
    for await (const _candidate of deps.fileStore.walkAudioFiles(options.folder, extensions)) {
      filesTotal += 1;
      if (options.limit !== undefined && filesTotal >= options.limit) break;
      // Yield periodically: even the cheap walk is 20k iterations.
      if (filesTotal % (BATCH_SIZE * 5) === 0) await yieldToEventLoop();
    }
    deps.musicRepo.setScanRunTotal(scanRunId, filesTotal);

    if (options.isCancelled?.() === true) {
      deps.musicRepo.finishScanRun(scanRunId, "cancelled");
      return summaryOf(scanRunId, "cancelled", filesTotal, progress, tracksRemoved);
    }

    // --- Phase two: read tags and write rows. --------------------------------
    const seenPaths: string[] = [];
    let batch: TrackFileFacts[] = [];

    for await (const facts of deps.fileStore.walkAudioFiles(options.folder, extensions)) {
      batch.push(facts);
      seenPaths.push(facts.relativePath);

      if (batch.length >= BATCH_SIZE) {
        await processBatch(deps, batch, progress, scanRunId, touchedAlbumIds);
        batch = [];
        // The yield that keeps the rest of the app responsive.
        await yieldToEventLoop();
        if (options.isCancelled?.() === true) {
          deps.musicRepo.updateScanRunProgress(scanRunId, progress);
          deps.musicRepo.finishScanRun(scanRunId, "cancelled");
          return summaryOf(scanRunId, "cancelled", filesTotal, progress, tracksRemoved);
        }
      }

      if (options.limit !== undefined && progress.filesSeen + batch.length >= options.limit) break;
    }

    if (batch.length > 0) await processBatch(deps, batch, progress, scanRunId, touchedAlbumIds);

    // track_count is denormalized on mus_albums so the browse screen does not need a
    // correlated subquery per row; refreshing it here is what keeps it true.
    refreshAlbumCounts(deps.musicRepo, [...touchedAlbumIds]);

    // Files in the catalog that are no longer on disk. Only for a full folder scan --
    // a limited sample has not seen enough to conclude anything is missing.
    if (options.pruneMissing === true && options.limit === undefined) {
      tracksRemoved = deps.musicRepo.deleteTracksMissingFrom(options.folder, seenPaths);
    }

    progress.currentPath = "";
    deps.musicRepo.updateScanRunProgress(scanRunId, progress);
    deps.musicRepo.finishScanRun(scanRunId, "completed");
    return summaryOf(scanRunId, "completed", filesTotal, progress, tracksRemoved);
  } catch (error) {
    // Only a whole-scan failure reaches here -- per-file problems are counted, not
    // thrown. Recorded on the run so the UI can say what happened.
    const message = error instanceof Error ? error.message : String(error);
    deps.musicRepo.updateScanRunProgress(scanRunId, { ...progress, lastError: message });
    deps.musicRepo.finishScanRun(scanRunId, "failed", message);
    return { ...summaryOf(scanRunId, "failed", filesTotal, progress, tracksRemoved), lastError: message };
  }
}

/** One batch: read tags, upsert, then report progress once. */
async function processBatch(
  deps: ScanDependencies,
  batch: readonly TrackFileFacts[],
  progress: ScanRunProgress,
  scanRunId: number,
  touchedAlbumIds: Set<number>,
): Promise<void> {
  for (const facts of batch) {
    progress.currentPath = facts.relativePath;
    progress.filesSeen += 1;

    try {
      const existing = deps.musicRepo.getTrackFileFacts(facts.relativePath);

      // The cheap skip that makes a re-scan take seconds instead of minutes: same size
      // and same mtime means the tags cannot have changed.
      if (
        existing !== undefined &&
        existing.fileSize === facts.fileSize &&
        existing.fileMtime === facts.fileMtime
      ) {
        progress.filesSkipped += 1;
        continue;
      }

      const tags = await deps.metadataReader.read(facts.relativePath);
      if (tags === undefined) {
        // Unreadable or corrupt. Counted, not fatal.
        progress.filesFailed += 1;
        progress.lastError = `Could not read tags from ${facts.relativePath}`;
        continue;
      }

      const upsert = await toUpsert(deps, facts, tags);
      if (upsert === undefined) {
        progress.filesSkipped += 1;
        continue;
      }

      deps.musicRepo.upsertTrack(upsert);
      if (upsert.albumId !== undefined) touchedAlbumIds.add(upsert.albumId);
      if (existing === undefined) progress.tracksAdded += 1;
      else progress.tracksUpdated += 1;
    } catch (error) {
      progress.filesFailed += 1;
      progress.lastError = error instanceof Error ? error.message : String(error);
    }

    if (progress.filesSeen % PROGRESS_EVERY === 0) {
      deps.musicRepo.updateScanRunProgress(scanRunId, progress);
    }
  }

  deps.musicRepo.updateScanRunProgress(scanRunId, progress);
}

/** Builds the row for one file, grouping it into an album and saving cover art. */
async function toUpsert(
  deps: ScanDependencies,
  facts: TrackFileFacts,
  tags: TrackTags,
): Promise<TrackUpsert | undefined> {
  const format = formatOf(facts.relativePath);
  if (format === undefined) return undefined;

  const fileName = facts.relativePath.split("/").pop() ?? facts.relativePath;
  const album = tags.album ?? "";
  // Compilations tag albumartist differently from artist; fall back so an album is not
  // split into one-track albums per featured performer.
  const albumArtist = tags.albumArtist ?? tags.artist ?? "";

  const folder = parentFolderOf(facts.relativePath);

  // Albums come from tags where there are tags, and from the containing folder where
  // there are not. Plenty of this library is untagged FLAC sitting in a per-artist
  // folder -- grouping those under the folder name is what gets them artwork and a
  // sensible heading, instead of a flat list of orphans. The folder is a fallback
  // ONLY: a real album tag always wins, because folder layout here is inconsistent
  // (2-8 levels deep, mixing genres, languages and alphabet buckets).
  const isFolderDerived = album === "";
  const albumName = isFolderDerived ? (folder.split("/").pop() ?? "") : album;

  let albumId: number | undefined;
  if (albumName !== "") {
    albumId = deps.musicRepo.upsertAlbum({
      name: albumName,
      albumArtist,
      genre: tags.genre ?? "",
      releaseYear: tags.releaseYear,
    });

    // Cover art is COPIED into the database -- never written back beside the track.
    // Only when the album has none yet: the first track to carry artwork wins, and
    // re-setting it for every track would be thousands of pointless
    // multi-hundred-kilobyte writes.
    if (!deps.musicRepo.albumHasCover(albumId)) {
      // Embedded art first, then a sibling Cover.jpg/folder.png. The fallback matters:
      // 756 cover files were counted on disk, and untagged FLAC rarely embeds art.
      const cover = tags.cover ?? (await deps.fileStore.readFolderCover(folder));
      if (cover !== undefined) deps.musicRepo.setAlbumCover(albumId, cover);
    }
  }

  return {
    relativePath: facts.relativePath,
    fileName,
    title: tags.title ?? "",
    artist: tags.artist ?? "",
    album: albumName,
    albumArtist,
    genre: tags.genre ?? "",
    releaseYear: tags.releaseYear,
    trackNumber: tags.trackNumber,
    discNumber: tags.discNumber,
    durationSeconds: tags.durationSeconds,
    extension: format.extension,
    mimeType: format.mimeType,
    fileSize: facts.fileSize,
    fileMtime: facts.fileMtime,
    isStreamable: format.isStreamable,
    // Set by a later pass if cue-sheet support is ever built; the column exists so
    // those 398 single-file albums can be found without a re-scan.
    hasCueSheet: false,
    albumId,
  };
}

/**
 * The extensions actually used, after applying `skipUnstreamable`.
 *
 * Filtering here rather than mid-walk means unplayable files are never opened at all,
 * which is where the time goes.
 */
function effectiveExtensions(options: ScanOptions): MusicExtension[] {
  const requested = [...new Set(options.extensions)];
  if (!options.skipUnstreamable) return requested;
  return requested.filter((extension) => {
    const format = formatOf(`x.${extension}`);
    return format?.isStreamable === true;
  });
}

function summaryOf(
  scanRunId: number,
  status: ScanSummary["status"],
  filesTotal: number,
  progress: ScanRunProgress,
  tracksRemoved: number,
): ScanSummary {
  return {
    scanRunId,
    status,
    filesTotal,
    filesSeen: progress.filesSeen,
    tracksAdded: progress.tracksAdded,
    tracksUpdated: progress.tracksUpdated,
    filesSkipped: progress.filesSkipped,
    filesFailed: progress.filesFailed,
    tracksRemoved,
    lastError: progress.lastError ?? "",
  };
}

/** Recounts every album's tracks. Cheap, and keeps the browse screen honest. */
export function refreshAlbumCounts(musicRepo: MusicRepository, albumIds: readonly number[]): void {
  for (const albumId of new Set(albumIds)) musicRepo.recountAlbumTracks(albumId);
}

/** Unused folders are grouped by their parent, which is how the scan view reports. */
export function folderOf(relativePath: string): string {
  return parentFolderOf(relativePath);
}
