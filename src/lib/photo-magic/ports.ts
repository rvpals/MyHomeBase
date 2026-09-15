import type {
  IndexedPhoto,
  MagicScanRun,
  PhotoFileFacts,
  PhotoMagicCriteria,
  PhotoMagicList,
  PhotoMagicListSummary,
  ScanRunProgress,
} from "./types";

/**
 * The cache of file facts the generator draws from -- `pho_photo_index`.
 *
 * Its own port rather than methods on the list repository, because the two have
 * different lifetimes and different owners: this is a rebuildable CACHE of what the
 * filesystem said, and the other holds what the reader created. Keeping them apart is
 * what makes "clear the index and re-scan" an obviously safe operation, and it lets the
 * matching logic be tested against a hand-written array of photographs with no database
 * at all. Same split, and the same reasoning, as `MagicCandidateSource` against
 * `MagicListRepository`.
 */
export interface PhotoIndexRepository {
  /**
   * Every indexed photograph matching the criteria.
   *
   * Contract, relied on by `selectPhotos` and NOT re-checked there:
   *
   *  - An ABSENT bound means "no restriction on that end", never "match nothing".
   *  - A photograph with no `takenAtDate` is excluded whenever a date bound is set.
   *  - A photograph with unreadable dimensions is excluded whenever a resolution bound
   *    is set -- unknown is not treated as passing.
   *  - `maxPhotos` is NOT applied here. This returns the whole matching set.
   *
   * Returning everything is deliberate. The draw must see every candidate or the
   * "random" list would be random only within whatever arbitrary window SQL handed
   * back, and `ORDER BY RANDOM() LIMIT n` would defeat the honest `candidateCount` the
   * stats report. The set is bounded in practice by the index, and `countCandidates`
   * exists for the callers that only need the number.
   */
  listCandidates(criteria: PhotoMagicCriteria): IndexedPhoto[];

  /** How many photographs the criteria match, without materialising them. For the live preview. */
  countCandidates(criteria: PhotoMagicCriteria): number;

  /**
   * Indexed photographs in the criteria's DATE RANGE whose dimensions are unknown.
   *
   * For the one exclusion a reader cannot see coming: the picture is in the archive and
   * in the range, and it is missing from the result because its header would not parse.
   * Counted separately rather than inferred from the difference between two other
   * numbers, which would silently absorb any other reason a photo dropped out.
   */
  countUnknownSizeInRange(criteria: PhotoMagicCriteria): number;

  /**
   * The size and mtime already recorded for a path, for the scan's skip check.
   *
   * A deliberately narrow read -- three columns, no dimensions, no dates -- because it
   * runs once per file in the range and the whole point is to be cheaper than opening
   * the photograph. Mirrors `getTrackFileFacts`.
   */
  getFileFacts(relativePath: string): PhotoFileFacts | undefined;

  /** Writes (or replaces) what a scan learned about one photograph. */
  upsertPhoto(photo: IndexedPhoto & { mtime: string }): void;

  /** How many photographs are indexed in total, for the screen's "what do I know" line. */
  countIndexed(): number;

  /**
   * Forgets every indexed photograph.
   *
   * Safe by construction: nothing the reader made points at this table -- a saved list
   * stores paths, not index ids -- so the worst this costs is the next scan's time. It
   * exists because an archive that has been reorganised wholesale leaves rows for paths
   * that no longer exist, and re-scanning does not remove them.
   */
  clearIndex(): void;
}

/** Saved Magic Lists: their criteria, and the set each last generated. */
export interface PhotoMagicListRepository {
  /**
   * Saves a new list. Rejects a duplicate name via the unique index rather than
   * silently making a twin -- the use-case turns that into a readable message.
   */
  createList(list: {
    name: string;
    description: string;
    criteria: PhotoMagicCriteria;
  }): number;

  /** Replaces a saved list's name, description and criteria. Does not touch its photos. */
  updateList(
    id: number,
    list: { name: string; description: string; criteria: PhotoMagicCriteria },
  ): void;

  /** Deletes the list and its stored photos. No photograph on disk is touched. */
  deleteList(id: number): void;

  getList(id: number): PhotoMagicList | undefined;

  listLists(): PhotoMagicListSummary[];

  /**
   * Stores a generated set as this list's photographs, replacing whatever was there,
   * and stamps `last_generated_at`.
   *
   * Wholesale replacement in one transaction -- a re-roll is a fresh draw with no
   * relationship to its predecessor, so there is no diff worth computing.
   */
  saveGeneratedPhotos(id: number, relativePaths: readonly string[]): void;

  /**
   * The photographs stored for a list, in order.
   *
   * Returns the INDEXED facts where they are still known, so the grid can caption a
   * picture with its size and resolution. A path whose index row has gone (the cache
   * was cleared) still comes back, with its facts absent -- the saved set is what the
   * reader kept, and it must not shrink because a cache was rebuilt.
   */
  listGeneratedPhotos(id: number): IndexedPhoto[];
}

/**
 * Progress for one run of the indexer -- `pho_magic_scan_run`.
 *
 * A repository rather than an in-memory counter because progress held in a module
 * variable is lost on a page refresh, invisible to a scan started from the CLI, and
 * gone entirely if the process restarts mid-run. See `migrations/0093`.
 */
export interface MagicScanRunRepository {
  /** Opens a run in the `running` state and returns its id. */
  createRun(range: { fromDate: string; toDate: string }): number;

  /**
   * Sets the denominator once the counting phase has finished.
   *
   * Separate from `updateProgress` because it happens exactly once and means something
   * different: until it lands, `filesTotal` is 0 and the bar is indeterminate rather
   * than sitting at 0%.
   */
  setRunTotal(id: number, filesTotal: number): void;

  /** Writes the counters. Called every `PROGRESS_EVERY` files, not every file. */
  updateProgress(id: number, progress: ScanRunProgress): void;

  /** Closes the run, stamping `finished_at`. */
  finishRun(
    id: number,
    status: "completed" | "failed" | "cancelled",
    lastError?: string,
  ): void;

  getRun(id: number): MagicScanRun | undefined;

  /**
   * The run currently in the `running` state, if any -- the guard that stops two scans
   * racing each other over the same SMB share.
   */
  getActiveRun(): MagicScanRun | undefined;

  /**
   * Closes `running` rows that have not been written to in `staleAfterSeconds`.
   *
   * Called ON READ rather than by a timer: there is no scheduler here, and an abandoned
   * row only matters at the moment someone looks at it. Without this a process that
   * died mid-scan would wedge the button forever. Returns how many it closed.
   */
  failAbandonedRuns(staleAfterSeconds?: number): number;
}
