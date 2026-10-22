import { isSafeRelativePath, normaliseRelativePath } from "../journal-photos";
import { analyzeImage } from "./analyze";
import { CULLING_CONFIG, DEFAULT_CULL_IMAGES } from "./config";
import { groupDuplicates } from "./group";
import type { CullingImageStore } from "./ports";
import { scoreBatch, sortByScore } from "./score";
import type {
  AnalysisFailure,
  AnalyzedPhoto,
  CullOptions,
  CullResult,
  RejectedPhoto,
  ScoredPhoto,
  UnreadablePhoto,
} from "./types";

// The use-case: given a folder, which photographs are worth keeping.
//
// Four passes, in this order, because each needs the whole batch the previous one
// produced: read and measure every image -> rank them against each other -> group the
// near-identical ones -> apply the caller's keep limit, if any.

/**
 * The most images one call will decode, when the caller names no ceiling of its own.
 *
 * A ceiling rather than a slow success: culling reads every file WHOLE, unlike the
 * journal's EXIF scan which reads only a header, so a thousand-photo month over SMB is
 * minutes rather than seconds. A caller that hits this gets a message naming the count
 * and can narrow the selection; the alternative is a request that looks hung.
 *
 * Re-exported from `config.ts` under the name callers already use. The REAL ceiling at
 * runtime is the stored setting (`settings.ts`), which the server actions resolve and
 * pass in as `maxImages` -- this is only the fallback for a caller that has no settings
 * to read, such as the CLI.
 */
export const MAX_CULL_IMAGES = DEFAULT_CULL_IMAGES;

/**
 * Culls one folder of the photo archive.
 *
 * The folder is ADDRESSED RELATIVE TO THE ARCHIVE ROOT -- `"2019/2019-06"`, not an
 * absolute path -- and validated with the same guard the journal's image route uses.
 * That is what keeps a folder name arriving from a browser or a CLI argument from
 * reaching outside the configured root.
 *
 * Nothing is written, moved or deleted. The entire output is the returned result; what
 * a caller does with it is the caller's decision.
 *
 * @param store Read-only access to the archive.
 * @param relativeFolder Folder path relative to the archive root.
 * @param options Duplicate threshold, concurrency, and an optional keep limit.
 * @returns Keepers, rejects and unreadable files, each sorted best-first.
 * @throws If `relativeFolder` is unsafe or the archive root is unusable.
 */
export async function cullFolder(
  store: CullingImageStore,
  relativeFolder: string,
  options: CullOptions = {},
): Promise<CullResult> {
  if (!isSafeRelativePath(relativeFolder)) {
    throw new Error(`Not a safe archive-relative folder: ${relativeFolder}`);
  }

  const folder = normaliseRelativePath(relativeFolder);

  // The specific reason, not just "unavailable" -- an unset path, a wrong one, and a
  // share the app cannot read need three different fixes.
  const rootCheck = await store.checkRoot();
  if (rootCheck.kind !== "ok") {
    throw new Error(
      `Photo archive is not usable (${rootCheck.kind})` +
        ("path" in rootCheck ? `: ${rootCheck.path}` : "."),
    );
  }

  const allNames = await store.listImageNames(folder);
  const allUndecodable = await store.listUndecodableNames(folder);

  // Narrowed by the same list, so a HEIC the caller never asked about is not reported
  // as a problem with their selection.
  const undecodableNames =
    options.only === undefined
      ? allUndecodable
      : allUndecodable.filter((name) => new Set(options.only).has(name));

  // Narrowed to the caller's list when it gave one. Intersected with what the folder
  // actually holds rather than trusted outright: the names arrive from a browser, and
  // a name that is not in the listing must not become a read.
  const names =
    options.only === undefined
      ? allNames
      : allNames.filter((name) => new Set(options.only).has(name));

  const maxImages = options.maxImages ?? MAX_CULL_IMAGES;
  if (names.length > maxImages) {
    throw new Error(
      `That folder holds ${names.length} images, more than the ${maxImages} this ` +
        `can cull in one pass. Culling decodes every file, so a larger set takes minutes ` +
        `over a network share — narrow the selection first.`,
    );
  }

  const { analyzed, failures } = await analyzeAll(
    store,
    folder,
    names,
    options.concurrency ?? CULLING_CONFIG.concurrency,
  );

  const unreadable: UnreadablePhoto[] = [
    ...failures.map((failure) => ({ ...failure, rejectReason: "unreadable" as const })),
    // Reported rather than silently skipped: in an iPhone folder every file is HEIC,
    // and a culler that returned nothing would look broken rather than limited.
    ...undecodableNames.map((name) => ({
      relativePath: `${folder}/${name}`,
      name,
      error: "HEIC is not supported by this build of sharp (no libheif).",
      rejectReason: "unreadable" as const,
    })),
  ];

  const { keepers, rejects, duplicateGroups } = reachVerdicts(analyzed, options);

  return {
    folder,
    keepers,
    rejects,
    unreadable,
    examined: names.length + undecodableNames.length,
    duplicateGroups,
  };
}

/**
 * Rank, group, and split into keepers and rejects.
 *
 * The half of culling that does not care WHERE the photographs came from, which is why
 * it is factored out: `cullFolder` reads one folder, `cullPhotoPaths` reads a list
 * spanning many, and both need exactly this afterwards. Having it twice is how the two
 * copies drift — the same reasoning that keeps the single-date and range lookups on one
 * code path in `journal-photos`.
 *
 * @param analyzed Images that were measured successfully.
 * @param options The caller's duplicate threshold and keep limit.
 * @returns Keepers and rejects, each sorted best-first, and the duplicate-group count.
 */
export function reachVerdicts(
  analyzed: readonly AnalyzedPhoto[],
  options: CullOptions = {},
): { keepers: ScoredPhoto[]; rejects: RejectedPhoto[]; duplicateGroups: number } {
  const scored = scoreBatch(analyzed);
  const groups = groupDuplicates(
    scored,
    options.duplicateDistance ?? CULLING_CONFIG.duplicateDistance,
  );

  const rejects: RejectedPhoto[] = [];
  const survivors: ScoredPhoto[] = [];

  for (const group of groups) {
    survivors.push(group.representative);
    for (const duplicate of group.duplicates) {
      rejects.push({
        ...duplicate,
        rejectReason: "duplicate",
        duplicateOf: group.representative.relativePath,
      });
    }
  }

  const { keepers, cut } = applyKeepLimit(sortByScore(survivors), options);
  // `"exposure"` rather than `"low score"` when clipping is what sank it: the reason
  // string already says "overexposed", and a reject list that agrees with itself is
  // easier to act on.
  for (const photo of cut) {
    rejects.push({
      ...photo,
      rejectReason: /overexposed|underexposed/.test(photo.reason) ? "exposure" : "low score",
    });
  }

  return {
    keepers,
    rejects: sortByScore(rejects),
    duplicateGroups: groups.filter((group) => group.duplicates.length > 0).length,
  };
}

/**
 * Splits the survivors at the caller's keep limit.
 *
 * With neither `keepCount` nor `keepFraction` set, EVERYTHING SURVIVES -- the default
 * is deliberately no low-score rejection at all. A culler that discards on a threshold
 * nobody chose is hard to trust, and the caller is the one who knows how many pictures
 * they want out of this folder. Duplicates are still grouped either way, because that
 * judgement is about the pictures rather than about a quota.
 */
function applyKeepLimit(
  survivors: readonly ScoredPhoto[],
  options: CullOptions,
): { keepers: ScoredPhoto[]; cut: ScoredPhoto[] } {
  const limit = resolveKeepLimit(survivors.length, options);
  if (limit === undefined || limit >= survivors.length) {
    return { keepers: [...survivors], cut: [] };
  }
  return { keepers: survivors.slice(0, limit), cut: survivors.slice(limit) };
}

/** The keep limit as a count, or `undefined` when the caller set none. */
function resolveKeepLimit(total: number, options: CullOptions): number | undefined {
  if (options.keepCount !== undefined) return Math.max(0, Math.floor(options.keepCount));
  if (options.keepFraction !== undefined) {
    // At least one: asking for the top 10% of eight photos means one picture, not none.
    return Math.max(1, Math.round(total * Math.min(1, Math.max(0, options.keepFraction))));
  }
  return undefined;
}

/**
 * Reads and measures every image, a bounded number at a time.
 *
 * Batched rather than `Promise.all` over the whole folder for the reason the journal's
 * month scan documents: the cost is SMB round-trip latency, so several reads in flight
 * hide it -- but a thousand at once would open a thousand handles and starve the share.
 *
 * One unreadable file is recorded and skipped. A permissions problem on a single photo
 * must not fail the folder, which is the same contract `PhotoFileStore.readHeader` has.
 */
async function analyzeAll(
  store: CullingImageStore,
  folder: string,
  names: readonly string[],
  concurrency: number,
): Promise<{ analyzed: AnalyzedPhoto[]; failures: AnalysisFailure[] }> {
  const analyzed: AnalyzedPhoto[] = [];
  const failures: AnalysisFailure[] = [];
  const batchSize = Math.max(1, Math.floor(concurrency));

  for (let start = 0; start < names.length; start += batchSize) {
    const batch = names.slice(start, start + batchSize);
    const results = await Promise.all(
      batch.map((name) => analyzeOne(store, folder, name)),
    );

    for (const result of results) {
      if ("error" in result) failures.push(result);
      else analyzed.push(result);
    }
  }

  return { analyzed, failures };
}

/** One image, returning the failure rather than throwing it. */
async function analyzeOne(
  store: CullingImageStore,
  folder: string,
  name: string,
): Promise<AnalyzedPhoto | AnalysisFailure> {
  const relativePath = `${folder}/${name}`;

  try {
    const bytes = await store.readImage(relativePath);
    if (bytes === undefined) {
      return { relativePath, name, error: "File could not be read." };
    }
    return await analyzeImage(bytes, relativePath, name);
  } catch (error) {
    return {
      relativePath,
      name,
      error: error instanceof Error ? error.message : "Image could not be decoded.",
    };
  }
}
