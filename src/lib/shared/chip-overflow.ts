// Pure — no I/O, no React. Splitting a list into "the ones we draw" and "the
// ones the +N marker stands for".
//
// Lives here rather than inside the component because it is the only part of a
// capped chip row that can actually be wrong: an off-by-one leaves a `+0`
// marker, and a non-positive limit can hide everything. The drawing itself is
// presentation and stays in src/components/taxonomy-icon.tsx.

export interface ChipOverflow<T> {
  /** The items to draw, in the order given. */
  shown: T[];
  /** The rest — what the `+N` marker stands for. Empty when nothing overflows. */
  hidden: T[];
}

/**
 * Caps a list at `limit` items.
 *
 * A `limit` of zero or less would hide the whole row behind a `+N` that explains
 * nothing, so it is floored at 1 — a capped row always shows at least one item.
 * When `items` fits within the limit, `hidden` is empty and the caller draws no
 * marker; there is deliberately no "+0" case to guard against downstream.
 */
export function splitChipOverflow<T>(items: T[], limit: number): ChipOverflow<T> {
  const safeLimit = Math.max(1, Math.floor(limit));
  return {
    shown: items.slice(0, safeLimit),
    hidden: items.slice(safeLimit),
  };
}
