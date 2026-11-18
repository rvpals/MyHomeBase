// Which photos the viewer's thumbnail strip shows as pictures, and which it folds into
// a "+n" tile.
//
// The strip shows the current photo and STRIP_RADIUS on each side. Every other run of
// photos collapses into one "+n" tile. Clicking a tile reveals the STRIP_REVEAL_BATCH
// photos of that run nearest the current one; revealed photos stay shown for as long as
// the viewer is open, even after the reader has arrowed away from them.
//
// Pure, so the rules -- the ends of the set, a set too small to fold, a revealed run
// split by a moving window -- are tested here rather than buried in the JSX.
// Imported by the client viewer from this leaf file, not the barrel (see the note in
// `photo-viewer.tsx`).

/** Photos shown on each side of the current one before the strip folds. */
export const STRIP_RADIUS = 2;

/** How many photos one click on a "+n" tile reveals. */
export const STRIP_REVEAL_BATCH = 10;

export type StripTile =
  | { kind: "photo"; index: number }
  /** A folded run, `start`..`end` inclusive. `count` is `end - start + 1`. */
  | { kind: "more"; start: number; end: number; count: number };

/**
 * The strip's tiles, left to right.
 *
 * `revealed` holds indices the reader has opened; out-of-range entries are ignored.
 * An empty set gives no tiles; a `current` outside the set is clamped into it.
 */
export function buildStripTiles(
  total: number,
  current: number,
  revealed: ReadonlySet<number>,
  radius: number = STRIP_RADIUS,
): StripTile[] {
  if (total <= 0) return [];
  const centre = Math.min(Math.max(current, 0), total - 1);

  const tiles: StripTile[] = [];
  let runStart: number | undefined;

  const closeRun = (end: number) => {
    if (runStart === undefined) return;
    tiles.push({ kind: "more", start: runStart, end, count: end - runStart + 1 });
    runStart = undefined;
  };

  for (let index = 0; index < total; index += 1) {
    const isShown = Math.abs(index - centre) <= radius || revealed.has(index);
    if (isShown) {
      closeRun(index - 1);
      tiles.push({ kind: "photo", index });
    } else if (runStart === undefined) {
      runStart = index;
    }
  }
  closeRun(total - 1);

  return tiles;
}

/**
 * The indices one click on a "+n" tile reveals: the `batch` of its run nearest the
 * current photo.
 *
 * A run before the current photo is opened from its right-hand end, a run after it
 * from its left-hand end -- the photos next to what the reader can already see.
 */
export function revealFromRun(
  run: { start: number; end: number },
  current: number,
  batch: number = STRIP_REVEAL_BATCH,
): number[] {
  const size = Math.max(0, Math.floor(batch));
  const indices: number[] = [];
  if (run.end < current) {
    for (let index = run.end; index >= run.start && indices.length < size; index -= 1) {
      indices.push(index);
    }
  } else {
    for (let index = run.start; index <= run.end && indices.length < size; index += 1) {
      indices.push(index);
    }
  }
  return indices;
}

/**
 * `indices` reordered nearest-to-`current` first, the photo AFTER winning a tie.
 *
 * The order thumbnails load in: next, previous, second next, second previous -- the
 * reader is usually moving forwards. Does not modify its input.
 */
export function nearestFirst(indices: readonly number[], current: number): number[] {
  return [...indices].sort((a, b) => {
    const distance = Math.abs(a - current) - Math.abs(b - current);
    if (distance !== 0) return distance;
    return b - a;
  });
}
