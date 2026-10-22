import { isSafeRelativePath, normaliseRelativePath } from "../journal-photos";
import { analyzeImage } from "./analyze";
import { CULLING_CONFIG } from "./config";
import { MAX_CULL_IMAGES, reachVerdicts } from "./cull";
import type { CullingImageStore } from "./ports";
import type {
  AnalysisFailure,
  AnalyzedPhoto,
  CullOptions,
  CullPathsResult,
  UnreadablePhoto,
} from "./types";

// The use-case for an arbitrary SET of photographs, wherever they are filed.
//
// The Picture Gallery's case, and the reason this exists beside `cullFolder`: an album
// is assembled by hand and a Magic List is drawn from the whole archive, so both hold
// full paths spanning many folders -- `2019/2019-06/a.jpg` next to
// `2021/2021-03 Trip/b.jpg`. A folder-shaped call cannot express that set.
//
// Only the READING differs. Ranking, grouping and the keep limit are `reachVerdicts`,
// shared with `cullFolder`, so the two cannot drift in how they judge a photograph.

/**
 * Culls an arbitrary set of photographs.
 *
 * Every path is ADDRESSED RELATIVE TO THE ARCHIVE ROOT and validated with the same
 * guard the journal's image route uses, so a path arriving from a browser cannot reach
 * outside the configured root. An unsafe path is dropped and reported as unreadable
 * rather than failing the set — one bad row in an album must not cost the whole cull.
 *
 * DUPLICATES ARE GROUPED ACROSS THE WHOLE SET, not within each folder. Two
 * near-identical pictures group even when they were taken years apart and filed under
 * different years: the question this answers is "does this set hold redundant
 * photographs", and where they happen to live does not bear on it.
 *
 * Nothing is written, moved or deleted. The entire output is the returned result.
 *
 * @param store Read-only access to the archive.
 * @param relativePaths The photographs to judge, in the order the caller shows them.
 * @param options Duplicate threshold, concurrency, keep limit, and the ceiling.
 * @returns Keepers, rejects and unreadable files, with the truncation facts.
 * @throws If the archive root is unusable. Individual bad paths do not throw.
 */
export async function cullPhotoPaths(
  store: CullingImageStore,
  relativePaths: readonly string[],
  options: CullOptions = {},
): Promise<CullPathsResult> {
  // The specific reason, not just "unavailable" -- an unset path, a wrong one, and a
  // share the app cannot read need three different fixes.
  const rootCheck = await store.checkRoot();
  if (rootCheck.kind !== "ok") {
    throw new Error(
      `Photo archive is not usable (${rootCheck.kind})` +
        ("path" in rootCheck ? `: ${rootCheck.path}` : "."),
    );
  }

  const requested = relativePaths.length;
  const maxImages = options.maxImages ?? MAX_CULL_IMAGES;

  // TRUNCATED rather than refused, unlike `cullFolder`. A gallery set can legitimately
  // exceed the ceiling -- a Magic List may hold more than this, and an album
  // accumulates -- and refusing outright would leave no way to cull a large album at
  // all. The caller is told both numbers so it can say which photographs were judged.
  const wasTruncated = requested > maxImages;
  const considered = wasTruncated ? relativePaths.slice(0, maxImages) : relativePaths;

  // Split before reading: an unsafe path is a result to report, not a read to attempt.
  const safePaths: string[] = [];
  const unsafe: UnreadablePhoto[] = [];

  for (const path of considered) {
    if (isSafeRelativePath(path)) {
      safePaths.push(normaliseRelativePath(path));
    } else {
      unsafe.push({
        relativePath: path,
        name: baseNameOf(path),
        error: "Not a safe archive-relative path.",
        rejectReason: "unreadable",
      });
    }
  }

  const { analyzed, failures } = await analyzeAll(
    store,
    safePaths,
    options.concurrency ?? CULLING_CONFIG.concurrency,
  );

  const { keepers, rejects, duplicateGroups } = reachVerdicts(analyzed, options);

  return {
    keepers,
    rejects,
    unreadable: [
      ...unsafe,
      ...failures.map((failure) => ({ ...failure, rejectReason: "unreadable" as const })),
    ],
    requested,
    examined: considered.length,
    wasTruncated,
    duplicateGroups,
  };
}

/**
 * Reads and measures every path, a bounded number at a time.
 *
 * Batched rather than `Promise.all` over the whole set for the reason the journal's
 * month scan documents: the cost is SMB round-trip latency, so several reads in flight
 * hide it -- but a thousand at once would open a thousand handles and starve the share.
 *
 * Worth noting that a set spanning many folders is SLOWER PER PHOTO than the same
 * count inside one: there is no read locality, so every file is a fresh seek. The
 * batching matters more here than it does in `cullFolder`, not less.
 */
async function analyzeAll(
  store: CullingImageStore,
  paths: readonly string[],
  concurrency: number,
): Promise<{ analyzed: AnalyzedPhoto[]; failures: AnalysisFailure[] }> {
  const analyzed: AnalyzedPhoto[] = [];
  const failures: AnalysisFailure[] = [];
  const batchSize = Math.max(1, Math.floor(concurrency));

  for (let start = 0; start < paths.length; start += batchSize) {
    const batch = paths.slice(start, start + batchSize);
    const results = await Promise.all(batch.map((path) => analyzeOne(store, path)));

    for (const result of results) {
      if ("error" in result) failures.push(result);
      else analyzed.push(result);
    }
  }

  return { analyzed, failures };
}

/** One photograph, returning the failure rather than throwing it. */
async function analyzeOne(
  store: CullingImageStore,
  relativePath: string,
): Promise<AnalyzedPhoto | AnalysisFailure> {
  const name = baseNameOf(relativePath);

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

/** The file name at the end of an archive-relative path. */
function baseNameOf(relativePath: string): string {
  return relativePath.split("/").pop() ?? relativePath;
}
