// Randomness as a parameter, not a global.
//
// Lives in shared/ because two modules now need it: music-magic builds a playlist from a
// query, and the play queue shuffles what is already queued. It started in
// music-magic/generate.ts and moved here the moment the queue became its second caller
// -- ARCHITECTURE.md's rule for a piece two modules want, since a player importing from
// the Magic Playlist module would be a dependency pointing the wrong way.

/**
 * A source of randomness.
 *
 * Returns a float in [0, 1) -- the same contract as `Math.random`, which is the real
 * implementation. A port-shaped parameter rather than a seedrandom dependency: the only
 * thing the tests need is determinism, and a counter or a fixed sequence gives them that
 * for free.
 */
export type RandomSource = () => number;

/**
 * Fisher-Yates, out of place.
 *
 * Written out rather than `sort(() => Math.random() - 0.5)`, which is the usual shortcut
 * and is genuinely biased -- a comparator that answers inconsistently for the same pair
 * makes the result depend on the sort implementation, so some orderings become far more
 * likely than others. For a feature whose entire value is "surprise me", a shuffle that
 * quietly favours certain arrangements is a real defect rather than a purity nit.
 */
export function shuffle<T>(items: readonly T[], random: RandomSource): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    // A pathological rng returning >= 1 would index off the end; clamping costs nothing
    // and keeps a bad injected source from producing `undefined` holes in the array.
    const safeIndex = Math.min(Math.max(swapIndex, 0), index);
    const held = result[index] as T;
    result[index] = result[safeIndex] as T;
    result[safeIndex] = held;
  }
  return result;
}
