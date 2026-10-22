import { CULLING_CONFIG } from "./config";
import { hammingDistance } from "./dhash";
import { sortByScore } from "./score";
import type { ScoredPhoto } from "./types";

// Grouping near-identical frames, and picking which one survives.

/** One set of near-identical images: the best, and the ones it beat. */
export interface DuplicateGroup {
  /** The highest-scoring image in the group. */
  readonly representative: ScoredPhoto;
  /** The rest, best first. Empty when the image had no near-duplicates. */
  readonly duplicates: readonly ScoredPhoto[];
}

/**
 * Groups images whose hashes are within `maxDistance` bits of each other.
 *
 * Grouping is TRANSITIVE, by union-find: if A is near B and B is near C, all three end
 * up in one group even when A and C are further apart than the threshold. That is the
 * right behaviour for the case this exists to handle -- a burst of twenty frames drifts
 * gradually, so the first and last can be well beyond ten bits apart while every
 * neighbouring pair is nearly identical. Pairwise grouping would split that burst into
 * several groups and keep a near-duplicate from each.
 *
 * The cost is quadratic in the number of images, which is acceptable at the scale this
 * runs: a 1,187-photo folder is ~700,000 nibble comparisons, far below the cost of
 * having decoded those files in the first place.
 *
 * @param photos Scored images. Order does not matter; groups are sorted internally.
 * @param maxDistance Bits of difference tolerated. Defaults to the config value.
 * @returns One group per cluster, each group's best image first, groups best-first.
 */
export function groupDuplicates(
  photos: readonly ScoredPhoto[],
  maxDistance: number = CULLING_CONFIG.duplicateDistance,
): DuplicateGroup[] {
  const parent = photos.map((_, index) => index);

  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    // Path compression, so a long burst does not walk the chain on every lookup.
    let walk = index;
    while (parent[walk] !== walk) {
      const next = parent[walk];
      parent[walk] = root;
      walk = next;
    }
    return root;
  };

  for (let left = 0; left < photos.length; left += 1) {
    for (let right = left + 1; right < photos.length; right += 1) {
      if (find(left) === find(right)) continue;
      if (hammingDistance(photos[left].hash, photos[right].hash) <= maxDistance) {
        parent[find(right)] = find(left);
      }
    }
  }

  const byRoot = new Map<number, ScoredPhoto[]>();
  photos.forEach((photo, index) => {
    const root = find(index);
    const existing = byRoot.get(root);
    if (existing) existing.push(photo);
    else byRoot.set(root, [photo]);
  });

  const groups = [...byRoot.values()].map((members) => {
    const ranked = sortByScore(members);
    return { representative: ranked[0], duplicates: ranked.slice(1) };
  });

  // Groups ordered by their representative, so the caller's keepers come out best-first
  // without a second sort.
  return groups.sort(
    (left, right) =>
      right.representative.score - left.representative.score ||
      left.representative.relativePath.localeCompare(right.representative.relativePath),
  );
}
