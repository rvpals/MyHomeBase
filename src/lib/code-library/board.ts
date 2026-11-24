// Dealing snippet cards into balanced board columns.
//
// `MasonryBoard` takes the split as a prop rather than doing it itself, because
// *how* to balance columns is a domain decision — only this module knows what
// makes a snippet card tall. Clips makes the same split in `lib/clips/board.ts`.
//
// Not round-robin. Dealing 1-2-3-1-2-3 keeps reading order but ignores height,
// so a column that drew three forty-line snippets runs far past one that drew
// three one-liners — exactly the ragged bottom a board exists to avoid.

import type { SnippetSummary } from "./types";

/**
 * Roughly how tall a snippet card will render, in arbitrary units.
 *
 * An **estimate**, and it only has to be good enough to keep columns level. The
 * card's height is dominated by its code block, which is why the preview's line
 * count carries the most weight; the rest are the fixed chrome and the things
 * that add a row each.
 *
 * A sealed snippet shows a one-line placeholder instead of a code block, which
 * is why it is nearly the cheapest card there is — getting that wrong would
 * leave a column of sealed cards looking oddly short.
 */
export function estimateSnippetCardHeight(snippet: SnippetSummary): number {
  // Title row, the action buttons, and the card's own padding.
  let height = 6;

  if (snippet.isEncrypted) {
    height += 2; // The "Sealed" placeholder, and nothing else.
  } else {
    // The preview is already cut to a few lines, so this is bounded — but a
    // one-line snippet really is much shorter than a six-line one.
    height += snippet.preview === "" ? 0 : snippet.preview.split("\n").length;
  }

  if (snippet.categories.length > 0 || snippet.tags.length > 0) height += 2;
  if (snippet.notes !== "") height += 2;
  if (snippet.sourceUrl !== "") height += 1;

  return height;
}

/**
 * Deals items into `count` columns, shortest column first.
 *
 * Generic over the weight so the board can hand back whatever it is rendering —
 * the view holds pre-rendered nodes, not snippets, by the time it deals.
 *
 * Ties take the **leftmost** column, which is what keeps a short board reading
 * left-to-right: with all weights equal this degenerates to exactly the
 * round-robin a reader expects.
 *
 * Always returns `count` arrays, some possibly empty — a caller rendering three
 * columns with two items gets one empty column rather than a grid that changes
 * width.
 */
export function dealIntoColumns<T>(
  items: T[],
  columnCount: number,
  weightOf: (item: T) => number,
): T[][] {
  // A board with no columns is a caller bug, but refusing to draw is a worse
  // answer than drawing one column — this is layout, not data integrity.
  const count = Math.max(1, Math.floor(columnCount));
  const columns: T[][] = Array.from({ length: count }, () => []);
  const heights = new Array<number>(count).fill(0);

  for (const item of items) {
    let target = 0;
    for (let i = 1; i < count; i += 1) {
      if (heights[i] < heights[target]) target = i;
    }
    columns[target].push(item);
    heights[target] += weightOf(item);
  }

  return columns;
}
