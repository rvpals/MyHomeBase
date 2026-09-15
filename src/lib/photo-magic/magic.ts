import type { RandomSource } from "@/lib/shared/random";
import { matchesCriteria } from "./criteria";
import type {
  MagicScanRunRepository,
  PhotoIndexRepository,
  PhotoMagicListRepository,
} from "./ports";
import { selectPhotos } from "./select";
import type {
  GeneratedPhotoSet,
  MagicScanRun,
  PhotoMagicCriteria,
  PhotoMagicList,
  PhotoMagicListSummary,
} from "./types";
import { hasResolutionFilter, isScanRunStale } from "./types";

// The use-cases: save, load, generate, and report on a scan. Each takes its
// dependencies as a parameter and returns data, so the web app and the CLI drive the
// identical function. Mirrors `music-magic/magic.ts`.

export interface PhotoMagicDependencies {
  listRepo: PhotoMagicListRepository;
  photoIndex: PhotoIndexRepository;
  scanRuns: MagicScanRunRepository;
}

/**
 * Why a write did not happen.
 *
 * A discriminated result rather than a thrown error, because every one of these is
 * something the reader can fix from the form in front of them. The adapters turn it
 * into a message; nothing here formats prose for a screen.
 */
export type PhotoMagicFailure =
  | { kind: "duplicate-name"; name: string }
  | { kind: "not-found"; id: number }
  | { kind: "scan-in-progress" };

export type PhotoMagicResult<T> = { ok: true; value: T } | { ok: false; failure: PhotoMagicFailure };

/** A sentence for one failure. Here rather than in the view so the CLI says the same thing. */
export function describePhotoMagicFailure(failure: PhotoMagicFailure): string {
  switch (failure.kind) {
    case "duplicate-name":
      return `A list called “${failure.name}” already exists. Pick another name.`;
    case "not-found":
      return "That list no longer exists.";
    case "scan-in-progress":
      return "A scan is already running. Wait for it to finish before starting another.";
  }
}

/** Every saved list, for the picker. */
export function listPhotoMagicLists(
  deps: PhotoMagicDependencies,
): PhotoMagicListSummary[] {
  return deps.listRepo.listLists();
}

/** One saved list with its criteria, for loading back into the form. */
export function loadPhotoMagicList(
  deps: PhotoMagicDependencies,
  id: number,
): PhotoMagicResult<PhotoMagicList> {
  const list = deps.listRepo.getList(id);
  if (list === undefined) return { ok: false, failure: { kind: "not-found", id } };
  return { ok: true, value: list };
}

/**
 * Saves a new list.
 *
 * The duplicate check is the database's unique index, caught here rather than a
 * `SELECT` first: between a check and an insert two tabs can both pass, and the index
 * is the only thing that is actually true under a race. The repository throws on the
 * constraint and this turns it into a readable failure.
 */
export function savePhotoMagicList(
  deps: PhotoMagicDependencies,
  input: { name: string; description: string; criteria: PhotoMagicCriteria },
): PhotoMagicResult<number> {
  try {
    return { ok: true, value: deps.listRepo.createList(input) };
  } catch (error) {
    if (isUniqueNameViolation(error)) {
      return { ok: false, failure: { kind: "duplicate-name", name: input.name } };
    }
    throw error;
  }
}

/** Updates a saved list's name, description and criteria. Its stored photos are untouched. */
export function updatePhotoMagicList(
  deps: PhotoMagicDependencies,
  input: { id: number; name: string; description: string; criteria: PhotoMagicCriteria },
): PhotoMagicResult<void> {
  if (deps.listRepo.getList(input.id) === undefined) {
    return { ok: false, failure: { kind: "not-found", id: input.id } };
  }
  try {
    deps.listRepo.updateList(input.id, input);
    return { ok: true, value: undefined };
  } catch (error) {
    if (isUniqueNameViolation(error)) {
      return { ok: false, failure: { kind: "duplicate-name", name: input.name } };
    }
    throw error;
  }
}

/** Deletes a list and its stored set. No photograph is touched. */
export function deletePhotoMagicList(
  deps: PhotoMagicDependencies,
  id: number,
): PhotoMagicResult<void> {
  if (deps.listRepo.getList(id) === undefined) {
    return { ok: false, failure: { kind: "not-found", id } };
  }
  deps.listRepo.deleteList(id);
  return { ok: true, value: undefined };
}

/**
 * Draws a set from the index, and stores it when the criteria belong to a saved list.
 *
 * Reads the WHOLE candidate set and shuffles it rather than asking SQL for a random
 * sample: `ORDER BY RANDOM() LIMIT n` cannot report an honest `candidateCount`, and the
 * count is what explains a thin result to the reader.
 *
 * `listId` is optional because "Create the list" works on whatever is in the form,
 * saved or not. Without one the draw is returned and nothing is written.
 */
export function generatePhotoMagicList(
  deps: PhotoMagicDependencies,
  input: { listId?: number; criteria: PhotoMagicCriteria },
  random: RandomSource,
): PhotoMagicResult<GeneratedPhotoSet> {
  if (input.listId !== undefined && deps.listRepo.getList(input.listId) === undefined) {
    return { ok: false, failure: { kind: "not-found", id: input.listId } };
  }

  const candidates = deps.photoIndex.listCandidates(input.criteria);

  // Only counted when a resolution bound is actually set -- otherwise unknown
  // dimensions exclude nothing and the number would be a meaningless aside.
  const excludedUnknownSize = hasResolutionFilter(input.criteria)
    ? deps.photoIndex.countUnknownSizeInRange(input.criteria)
    : 0;

  const generated = selectPhotos(candidates, input.criteria, random, {
    excludedUnknownSize,
  });

  if (input.listId !== undefined) {
    deps.listRepo.saveGeneratedPhotos(
      input.listId,
      generated.photos.map((photo) => photo.relativePath),
    );
  }

  return { ok: true, value: generated };
}

/**
 * Re-rolls a saved list from its own stored criteria.
 *
 * Distinct from `generatePhotoMagicList` with a `listId`: that one takes criteria from
 * the caller (the form, possibly edited and unsaved), this one takes them from the
 * record. Regenerating must use what was SAVED, or a list would quietly change meaning
 * to match whatever a form happened to be showing.
 */
export function regeneratePhotoMagicList(
  deps: PhotoMagicDependencies,
  id: number,
  random: RandomSource,
): PhotoMagicResult<GeneratedPhotoSet> {
  const list = deps.listRepo.getList(id);
  if (list === undefined) return { ok: false, failure: { kind: "not-found", id } };
  return generatePhotoMagicList(deps, { listId: id, criteria: list.criteria }, random);
}

/** The set a list last generated, for reopening it without re-rolling. */
export function loadGeneratedPhotos(deps: PhotoMagicDependencies, id: number) {
  return deps.listRepo.listGeneratedPhotos(id);
}

/** How many photographs the criteria currently match, for the form's live preview. */
export function countPhotoMagicCandidates(
  deps: PhotoMagicDependencies,
  criteria: PhotoMagicCriteria,
): number {
  return deps.photoIndex.countCandidates(criteria);
}

/**
 * A scan's progress, or `undefined` when there is no such run.
 *
 * Closes abandoned runs FIRST. A process that died mid-scan leaves a `running` row
 * nobody will finish, and since this is the call the polling view makes, it is the
 * natural place to notice -- there is no scheduler to do it on a timer.
 */
export function getScanStatus(
  deps: PhotoMagicDependencies,
  scanRunId?: number,
): (MagicScanRun & { isStale: boolean }) | undefined {
  deps.scanRuns.failAbandonedRuns();
  const run =
    scanRunId === undefined ? deps.scanRuns.getActiveRun() : deps.scanRuns.getRun(scanRunId);
  if (run === undefined) return undefined;
  return { ...run, isStale: isScanRunStale(run, new Date()) };
}

/**
 * Whether a new scan may start.
 *
 * Two concurrent scans would fight over the same SMB share and write the same rows for
 * no benefit, so one at a time. A STALE run does not block -- otherwise a crash would
 * lock the feature until someone edited the database.
 */
export function canStartScan(deps: PhotoMagicDependencies): boolean {
  deps.scanRuns.failAbandonedRuns();
  const active = deps.scanRuns.getActiveRun();
  return active === undefined || isScanRunStale(active, new Date());
}

/** How many photographs are indexed, for the screen's "what do I know about" line. */
export function countIndexedPhotos(deps: PhotoMagicDependencies): number {
  return deps.photoIndex.countIndexed();
}

/**
 * Forgets the whole index.
 *
 * Safe by construction -- saved lists store paths, not index ids, so nothing the reader
 * made depends on a row here. Offered because an archive reorganised wholesale leaves
 * rows for paths that no longer exist, and re-scanning adds rather than prunes.
 */
export function clearPhotoIndex(deps: PhotoMagicDependencies): void {
  deps.photoIndex.clearIndex();
}

/**
 * Whether a photograph would satisfy these criteria.
 *
 * Re-exported through the use-case layer so a caller that already HAS a photograph
 * (the CLI explaining why one is missing) can ask without reaching into `criteria.ts`.
 */
export { matchesCriteria };

/**
 * Whether an error is the list-name unique index complaining.
 *
 * Matched on the SQLite message rather than an error class because `better-sqlite3`
 * throws a plain `SqliteError` whose `code` is the only structured part, and the index
 * name is what distinguishes "duplicate list name" from any other constraint on the
 * table. Narrow on purpose: a different constraint must keep throwing rather than being
 * reported to the reader as a name clash.
 */
function isUniqueNameViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  return (
    code === "SQLITE_CONSTRAINT_UNIQUE" &&
    (error.message.includes("pho_magic_list.name") ||
      error.message.includes("idx_pho_magic_list_name"))
  );
}
