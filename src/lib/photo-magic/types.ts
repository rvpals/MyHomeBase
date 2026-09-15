// Domain types for Magic Lists. No zod, no SQL -- schema.ts validates boundary input,
// repository.ts talks to SQLite.

/**
 * What the reader picked: which photographs to draw from, and how many.
 *
 * Every bound is OPTIONAL, and an absent bound means "no restriction on this end"
 * rather than zero or infinity. That distinction is the whole semantics of the form --
 * leaving the minimum size blank must not produce an empty list -- so it is stated here
 * and enforced in one place (`matchesCriteria`), never re-derived by a caller.
 *
 * Mirrors `MagicCriteria` in `music-magic`, which made the same call for the same
 * reason. The fields differ because the questions do: a playlist is filtered by tags
 * and filled toward a running time, a photo list is filtered by the file's own measured
 * facts and capped by a count.
 */
export interface PhotoMagicCriteria {
  /**
   * The capture-date range, inclusive, as `YYYY-MM-DD`.
   *
   * Matched against a photograph's CAPTURE date, never its file mtime -- an archive
   * that has been copied or restored has mtimes from the day of the copy, which would
   * make every range meaningless. See `migrations/0093`.
   */
  fromDate?: string;
  toDate?: string;

  /** File size bounds in BYTES -- the unit the filesystem reports and the index stores. */
  minBytes?: number;
  maxBytes?: number;

  /**
   * Resolution bounds in pixels, width and height separately.
   *
   * Not a megapixel count: "at least 1920x1080" is what a slideshow criterion means,
   * and a 3000x700 panorama and a 1450x1450 square are the same 2.1MP with only one of
   * them filling a screen. A photograph whose dimensions could not be read is EXCLUDED
   * by any of these, rather than guessed at.
   */
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;

  /**
   * The ceiling on how many photographs to draw.
   *
   * Required, unlike every bound above: "no limit" is not a sensible answer when a
   * decade-wide range would return tens of thousands of paths and the screen would try
   * to thumbnail all of them. The draw is random, so this is a sample size, not a
   * "first N".
   */
  maxPhotos: number;
}

/** A saved Magic List: its criteria, and when it last produced a set. */
export interface PhotoMagicList {
  id: number;
  name: string;
  description: string;
  criteria: PhotoMagicCriteria;
  /** undefined when saved but never generated -- the view shows an empty state, not a grid. */
  lastGeneratedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** A saved list as it appears in a picker: no criteria, just enough to choose one. */
export interface PhotoMagicListSummary {
  id: number;
  name: string;
  description: string;
  maxPhotos: number;
  /** Photographs currently stored for this list. */
  photoCount: number;
  lastGeneratedAt?: string;
  updatedAt: string;
}

/**
 * One photograph as the index knows it: where it is, and the facts criteria filter on.
 *
 * The cached shape, read back from `pho_photo_index`. `width`/`height` are optional
 * because a truncated or unrecognised JPEG yields no frame header, and `undefined`
 * means UNKNOWN -- never zero, which would quietly satisfy a "no maximum" criterion.
 */
export interface IndexedPhoto {
  relativePath: string;
  bytes: number;
  width?: number;
  height?: number;
  /** `YYYY-MM-DD`, absent when no date could be established at all. */
  takenAtDate?: string;
  /** Which kind of evidence produced the date -- matches `PhotoDateSource`. */
  takenAtSource: "exif" | "file-name" | "folder" | "none";
}

/**
 * The facts the skip check compares, and nothing else.
 *
 * Deliberately narrow -- a three-column read -- because it runs once per file in the
 * range and the whole point is to be cheaper than opening the photograph. Same shape
 * and same reasoning as `TrackFileFacts` in the music scanner.
 */
export interface PhotoFileFacts {
  relativePath: string;
  bytes: number;
  mtime: string;
}

export type ScanStatus = "running" | "completed" | "failed" | "cancelled";

/** The counters a scan updates as it works. */
export interface ScanRunProgress {
  filesSeen: number;
  /** Read from disk and written to the index. */
  filesIndexed: number;
  /** Unchanged since last time, so the cached row stood. */
  filesCached: number;
  filesFailed: number;
  /** The file being read right now, relative to the photo root. */
  currentPath: string;
  lastError?: string;
}

/** One run of the indexer, as the progress bar reads it. */
export interface MagicScanRun {
  id: number;
  fromDate: string;
  toDate: string;
  status: ScanStatus;
  /** 0 while phase one is still counting -- the bar shows indeterminate. */
  filesTotal: number;
  filesSeen: number;
  filesIndexed: number;
  filesCached: number;
  filesFailed: number;
  currentPath: string;
  lastError: string;
  startedAt: string;
  finishedAt?: string;
  updatedAt: string;
}

/**
 * Why a generated list came out the way it did.
 *
 * Returned alongside the photographs rather than computed in the view, because the
 * honest explanation of a thin result is the feature: four criteria ANDed together can
 * match far less than expected, and a resolution bound silently excludes every photo
 * whose header could not be read. A candidate count turns "the app is broken" into
 * "those things do not overlap". Mirrors `MagicGenerationStats`.
 */
export interface PhotoMagicStats {
  /** Photographs in the index that matched every criterion. */
  candidateCount: number;
  /** How many were actually drawn -- `min(candidateCount, maxPhotos)`. */
  selectedCount: number;
  maxPhotos: number;
  /** True when the ceiling, not the criteria, is what limited the result. */
  cappedByLimit: boolean;
  /**
   * Indexed photographs in the date range that were skipped for having no readable
   * dimensions, when a resolution bound was set.
   *
   * Reported because it is the one exclusion a reader cannot see coming: the picture is
   * in the archive and in the range, and it is missing because its header would not
   * parse. Zero when no resolution bound was asked for.
   */
  excludedUnknownSize: number;
}

/** The result of one generation: the photographs, in draw order, and why. */
export interface GeneratedPhotoSet {
  photos: IndexedPhoto[];
  stats: PhotoMagicStats;
}

/**
 * The most photographs one list may hold.
 *
 * Well above the zip export's own 200-photo ceiling, and deliberately so: a Magic List
 * is for looking at and playing as a slideshow, which has no such limit, so capping the
 * list at what a zip can carry would be letting the least-used action dictate the
 * feature. Export refuses past its own ceiling with a message naming it instead.
 */
export const MAX_LIST_PHOTOS = 1000;

/** The default ceiling when nothing has been picked yet. */
export const DEFAULT_MAX_PHOTOS = 100;

/** One-tap chips before the free-entry field, as the music module offers for durations. */
export const PHOTO_COUNT_PRESETS: readonly { label: string; count: number }[] = [
  { label: "25", count: 25 },
  { label: "50", count: 50 },
  { label: "100", count: 100 },
  { label: "250", count: 250 },
  { label: "500", count: 500 },
];

/**
 * Common resolution floors, as one-tap chips.
 *
 * Named by what they are FOR rather than by their numbers -- a reader choosing pictures
 * for a slideshow is thinking "will this fill the TV", not "is this 2073600 pixels".
 */
export const RESOLUTION_PRESETS: readonly {
  label: string;
  width: number;
  height: number;
}[] = [
  { label: "HD (1280×720)", width: 1280, height: 720 },
  { label: "Full HD (1920×1080)", width: 1920, height: 1080 },
  { label: "4K (3840×2160)", width: 3840, height: 2160 },
];

/** Criteria with nothing restricted: the whole indexed archive, capped at the default. */
export function emptyCriteria(): PhotoMagicCriteria {
  return { maxPhotos: DEFAULT_MAX_PHOTOS };
}

/**
 * Whether a criteria set restricts anything at all.
 *
 * Used by the view to say "the whole archive" rather than listing nothing. The photo
 * ceiling is NOT a restriction on which photographs are eligible -- it caps the draw
 * after the matching is done -- so it is deliberately not part of this answer, exactly
 * as `hasAnyFilter` excludes the music target length.
 */
export function hasAnyFilter(criteria: PhotoMagicCriteria): boolean {
  return (
    criteria.fromDate !== undefined ||
    criteria.toDate !== undefined ||
    criteria.minBytes !== undefined ||
    criteria.maxBytes !== undefined ||
    criteria.minWidth !== undefined ||
    criteria.minHeight !== undefined ||
    criteria.maxWidth !== undefined ||
    criteria.maxHeight !== undefined
  );
}

/** Whether the criteria bound resolution at all -- the stats need to know. */
export function hasResolutionFilter(criteria: PhotoMagicCriteria): boolean {
  return (
    criteria.minWidth !== undefined ||
    criteria.minHeight !== undefined ||
    criteria.maxWidth !== undefined ||
    criteria.maxHeight !== undefined
  );
}

/**
 * Percent complete, 0-100, or `undefined` while the total is still unknown.
 *
 * Domain logic rather than something the progress bar computes, so the web view and the
 * CLI report the same number and neither divides by zero. Clamped because a folder can
 * gain files between the counting phase and the reading phase, which would otherwise
 * show 103%. Lifted from `scanProgressPercent` in the music module.
 */
export function scanProgressPercent(run: MagicScanRun): number | undefined {
  if (run.filesTotal <= 0) return undefined;
  const percent = Math.round((run.filesSeen / run.filesTotal) * 100);
  return Math.min(100, Math.max(0, percent));
}

/**
 * Whether a scan row is genuinely still running, as opposed to abandoned.
 *
 * A process that died mid-scan leaves a `running` row nobody will ever finish, and
 * without this the "Create the list" button would be wedged forever. Checked on READ
 * rather than by a timer, matching `isScanRunStale`: there is no scheduler here, and a
 * stale row only matters at the moment someone looks at it.
 */
export function isScanRunStale(
  run: MagicScanRun,
  now: Date,
  staleAfterSeconds = 120,
): boolean {
  if (run.status !== "running") return false;
  // SQLite writes `datetime('now')` as UTC without a zone marker; `Z` is what stops it
  // being read as local time, which on a machine behind UTC makes every row look stale.
  const updated = Date.parse(`${run.updatedAt.replace(" ", "T")}Z`);
  if (Number.isNaN(updated)) return false;
  return now.getTime() - updated > staleAfterSeconds * 1000;
}

/**
 * "4.2 MB" for a byte count -- a file size as a reader thinks of one.
 *
 * Domain logic rather than a view helper so the web app and the CLI print the same
 * size, exactly as `formatRunningTime` is shared in the music module. Binary units
 * (1024), because that is what both the filesystem and every other tool showing these
 * files will say.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** "1920 × 1080" for a photograph's dimensions, or "unknown" when they could not be read. */
export function formatResolution(photo: IndexedPhoto): string {
  if (photo.width === undefined || photo.height === undefined) return "unknown";
  // A true multiplication sign, not an 'x' -- this sits next to a file size in the same
  // line of metadata and the lowercase letter reads as part of the number.
  return `${photo.width} × ${photo.height}`;
}
