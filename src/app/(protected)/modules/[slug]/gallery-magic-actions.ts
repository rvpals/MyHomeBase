"use server";

import { revalidatePath } from "next/cache";
import {
  canStartScan,
  clearPhotoIndex,
  countIndexedPhotos,
  countPhotoMagicCandidates,
  deletePhotoMagicList,
  describeGeneration,
  describePhotoMagicFailure,
  generatePhotoMagicList,
  getScanStatus,
  listPhotoMagicLists,
  loadGeneratedPhotos,
  loadPhotoMagicList,
  photoMagicCriteriaSchema,
  photoMagicListIdSchema,
  photoMagicListUpdateSchema,
  photoMagicListWriteSchema,
  regeneratePhotoMagicList,
  savePhotoMagicList,
  scanPhotoIndex,
  scanProgressPercent,
  scanRangeSchema,
  updatePhotoMagicList,
  type IndexedPhoto,
  type PhotoMagicCriteria,
  type PhotoMagicDependencies,
  type PhotoMagicList,
  type PhotoMagicListSummary,
  type PhotoMagicStats,
} from "@/lib/photo-magic";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";
import { photoStore } from "./journal-photo-root";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "picture-gallery";

// Server actions for Magic Lists. Thin on purpose: authorise, validate at the boundary,
// call a use-case, return data. Nothing here decides anything -- the decisions live in
// src/lib/photo-magic.
//
// EVERY EXPORT AUTHORISES ON ITS FIRST LINE. An action is its own POST endpoint, so
// neither the (protected) layout nor the page's own check runs before one fires --
// leaving the guard off would let any signed-in user drive the archive scanner whether
// or not they were granted this module.

const MAGIC_LIST_PATH = "/modules/picture-gallery/magic-list";

/** The dependency bundle the use-cases take. */
function magicDeps(): PhotoMagicDependencies {
  return {
    listRepo: deps.photoMagicListRepo,
    photoIndex: deps.photoIndexRepo,
    scanRuns: deps.photoMagicScanRunRepo,
  };
}

// ---------------------------------------------------------------------------------
// Saved lists
// ---------------------------------------------------------------------------------

export async function listMagicListsAction(): Promise<PhotoMagicListSummary[]> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return listPhotoMagicLists(magicDeps());
}

export async function loadMagicListAction(
  listId: number,
): Promise<{ ok: true; list: PhotoMagicList } | { ok: false; error: string }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const parsed = photoMagicListIdSchema.safeParse(listId);
  if (!parsed.success) return { ok: false, error: "That list id is not valid." };

  const result = loadPhotoMagicList(magicDeps(), parsed.data);
  if (!result.ok) return { ok: false, error: describePhotoMagicFailure(result.failure) };
  return { ok: true, list: result.value };
}

export async function saveMagicListAction(input: {
  name: string;
  description: string;
  criteria: PhotoMagicCriteria;
}): Promise<{ ok: true; listId: number } | { ok: false; error: string }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const parsed = photoMagicListWriteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }

  const result = savePhotoMagicList(magicDeps(), parsed.data);
  if (!result.ok) return { ok: false, error: describePhotoMagicFailure(result.failure) };

  revalidatePath(MAGIC_LIST_PATH);
  return { ok: true, listId: result.value };
}

export async function updateMagicListAction(input: {
  id: number;
  name: string;
  description: string;
  criteria: PhotoMagicCriteria;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const parsed = photoMagicListUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const result = updatePhotoMagicList(magicDeps(), parsed.data);
  if (!result.ok) return { ok: false, error: describePhotoMagicFailure(result.failure) };

  revalidatePath(MAGIC_LIST_PATH);
  return { ok: true };
}

export async function deleteMagicListAction(
  listId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const parsed = photoMagicListIdSchema.safeParse(listId);
  if (!parsed.success) return { ok: false, error: "That list id is not valid." };

  const result = deletePhotoMagicList(magicDeps(), parsed.data);
  if (!result.ok) return { ok: false, error: describePhotoMagicFailure(result.failure) };

  revalidatePath(MAGIC_LIST_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------------
// Generating
// ---------------------------------------------------------------------------------

/**
 * One photograph as the grid needs it.
 *
 * Mapped rather than sending the domain type straight out, matching how
 * `MagicPlaylistTrack` narrows a `Track`: the view needs a path and two captions, and
 * the wire should not carry fields nothing renders.
 */
export interface MagicPhotoView {
  relativePath: string;
  name: string;
  bytes: number;
  width?: number;
  height?: number;
  takenAtDate?: string;
}

export interface MagicGenerationView {
  photos: MagicPhotoView[];
  stats: PhotoMagicStats;
  /** The honest one-liner explaining a thin result. Built in `lib`, not here. */
  summary: string;
}

function toPhotoView(photo: IndexedPhoto): MagicPhotoView {
  return {
    relativePath: photo.relativePath,
    name: photo.relativePath.split("/").pop() ?? photo.relativePath,
    bytes: photo.bytes,
    width: photo.width,
    height: photo.height,
    takenAtDate: photo.takenAtDate,
  };
}

/**
 * Draws a list from whatever criteria the form holds.
 *
 * `Math.random` is injected HERE rather than defaulted inside the library, so the
 * library keeps no ambient randomness and a test can hand it a deterministic source.
 */
export async function generateMagicListAction(input: {
  listId?: number;
  criteria: PhotoMagicCriteria;
}): Promise<{ ok: true; result: MagicGenerationView } | { ok: false; error: string }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const parsedCriteria = photoMagicCriteriaSchema.safeParse(input.criteria);
  if (!parsedCriteria.success) return { ok: false, error: firstIssue(parsedCriteria.error) };

  const result = generatePhotoMagicList(
    magicDeps(),
    { listId: input.listId, criteria: parsedCriteria.data },
    Math.random,
  );
  if (!result.ok) return { ok: false, error: describePhotoMagicFailure(result.failure) };

  if (input.listId !== undefined) revalidatePath(MAGIC_LIST_PATH);

  return {
    ok: true,
    result: {
      photos: result.value.photos.map(toPhotoView),
      stats: result.value.stats,
      summary: describeGeneration(result.value.stats),
    },
  };
}

/** Re-rolls a saved list from its OWN stored criteria, not from the form. */
export async function regenerateMagicListAction(
  listId: number,
): Promise<{ ok: true; result: MagicGenerationView } | { ok: false; error: string }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const parsed = photoMagicListIdSchema.safeParse(listId);
  if (!parsed.success) return { ok: false, error: "That list id is not valid." };

  const result = regeneratePhotoMagicList(magicDeps(), parsed.data, Math.random);
  if (!result.ok) return { ok: false, error: describePhotoMagicFailure(result.failure) };

  revalidatePath(MAGIC_LIST_PATH);
  return {
    ok: true,
    result: {
      photos: result.value.photos.map(toPhotoView),
      stats: result.value.stats,
      summary: describeGeneration(result.value.stats),
    },
  };
}

/** The set a list last generated — reopening it without re-rolling. */
export async function loadGeneratedPhotosAction(listId: number): Promise<MagicPhotoView[]> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const parsed = photoMagicListIdSchema.safeParse(listId);
  if (!parsed.success) return [];
  return loadGeneratedPhotos(magicDeps(), parsed.data).map(toPhotoView);
}

/** How many photographs the criteria currently match, for the form's live preview. */
export async function countCandidatesAction(criteria: PhotoMagicCriteria): Promise<number> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const parsed = photoMagicCriteriaSchema.safeParse(criteria);
  if (!parsed.success) return 0;
  return countPhotoMagicCandidates(magicDeps(), parsed.data);
}

// ---------------------------------------------------------------------------------
// The index and its scan
// ---------------------------------------------------------------------------------

export interface ScanStatusView {
  id: number;
  status: string;
  fromDate: string;
  toDate: string;
  /** undefined while the counting phase runs — the bar shows indeterminate. */
  percent?: number;
  filesTotal: number;
  filesSeen: number;
  filesIndexed: number;
  filesCached: number;
  filesFailed: number;
  currentPath: string;
  lastError: string;
  startedAt: string;
  finishedAt?: string;
  isStale: boolean;
}

/**
 * Starts a scan and returns the run id to poll.
 *
 * FIRE AND FORGET. The run row is created inside the request so its id can be handed
 * straight back, then `scanPhotoIndex` is called WITHOUT being awaited so the scan
 * outlives the response — a walk of a decade of photographs over SMB is far longer than
 * any request should hold open. Passing `scanRunId` is what keeps the work reporting
 * into the row the screen is already polling instead of opening a second one. (The
 * music scanner needs a Proxy for the same effect because `scanLibrary` always creates
 * its own row; giving this one an explicit option was the simpler fix.)
 */
export async function startScanAction(input: {
  fromDate?: string;
  toDate?: string;
}): Promise<{ ok: true; scanRunId: number } | { ok: false; error: string }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const parsed = scanRangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const dependencies = magicDeps();
  // One scan at a time: two would fight over the same SMB share and write the same
  // rows for no benefit. A STALE run does not block, or a crash would lock the feature.
  if (!canStartScan(dependencies)) {
    return { ok: false, error: describePhotoMagicFailure({ kind: "scan-in-progress" }) };
  }

  const scanRunId = dependencies.scanRuns.createRun({
    fromDate: parsed.data.fromDate ?? "",
    toDate: parsed.data.toDate ?? "",
  });

  void runScanInBackground(scanRunId, parsed.data.fromDate, parsed.data.toDate);

  return { ok: true, scanRunId };
}

/**
 * Runs the scan outside the request.
 *
 * `scanPhotoIndex` closes its own run row on both the success and the failure path; the
 * catch here is the last resort so an unexpected throw can never leave a row stuck at
 * `running`. Without it the one-scan-at-a-time guard would block every later attempt
 * until the staleness check eventually timed it out.
 */
async function runScanInBackground(
  scanRunId: number,
  fromDate?: string,
  toDate?: string,
): Promise<void> {
  const dependencies = magicDeps();
  try {
    await scanPhotoIndex(
      {
        photoIndex: dependencies.photoIndex,
        scanRuns: dependencies.scanRuns,
        // Built per call, so correcting the archive path on the Configuration screen
        // takes effect on the next scan with no restart.
        fileStore: photoStore(),
      },
      { fromDate, toDate, scanRunId },
    );
  } catch (error) {
    dependencies.scanRuns.finishRun(
      scanRunId,
      "failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** A scan's progress, for the one-second poll while the bar is up. */
export async function getScanStatusAction(scanRunId?: number): Promise<ScanStatusView | undefined> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const run = getScanStatus(magicDeps(), scanRunId);
  if (run === undefined) return undefined;
  return {
    id: run.id,
    status: run.status,
    fromDate: run.fromDate,
    toDate: run.toDate,
    percent: scanProgressPercent(run),
    filesTotal: run.filesTotal,
    filesSeen: run.filesSeen,
    filesIndexed: run.filesIndexed,
    filesCached: run.filesCached,
    filesFailed: run.filesFailed,
    currentPath: run.currentPath,
    lastError: run.lastError,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    isStale: run.isStale,
  };
}

/** How many photographs are indexed, for the "what do I know about" line. */
export async function countIndexedAction(): Promise<number> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return countIndexedPhotos(magicDeps());
}

/**
 * Forgets the whole index.
 *
 * Safe by construction — saved lists store paths, not index ids, so nothing the reader
 * made depends on a row here and the worst this costs is the next scan's time.
 */
export async function clearIndexAction(): Promise<{ ok: true }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  clearPhotoIndex(magicDeps());
  revalidatePath(MAGIC_LIST_PATH);
  return { ok: true };
}

/**
 * The first validation problem, as a sentence.
 *
 * Zod's own message, because the schema writes them for the reader ("The end date is
 * before the start date.") rather than in field-path jargon.
 */
function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Those criteria are not valid.";
}
