// The board's arrangement rules: which clips are pinned, how they fall into
// columns, and how a clip's checklist splits into outstanding and completed.
//
// All pure — data in, data out, no React and no DOM. These are domain rules rather
// than rendering details, which is why they live here and not in the view: "pinned
// first", "completed items go last, most recent first" and "balance the columns by
// height" are decisions about what the board *means*, and they have to hold
// identically whether a board is drawn in the browser or described by the CLI.
//
// `ClipSummary.items` is what makes this possible without a second query — see the
// note there on why the items ride on the summary where the body deliberately does
// not.

import type { ClipItem, ClipSummary } from "./types";

/**
 * A clip's checklist, split the way a card draws it.
 *
 * The two halves are **ordered differently**, which is the whole reason this is a
 * type and not a filter at the call site: outstanding items keep the arrangement
 * whoever wrote the clip gave them, while completed ones read most-recently-ticked
 * first, so the thing you just struck through is at the top of the collapsed group
 * where you can undo it. `TodoCategoryBoard` makes the same split for the same reason.
 */
export interface ClipItemBoard {
  /** Still to do, in the writer's arrangement. */
  open: ClipItem[];
  /** Ticked, most recently first. */
  done: ClipItem[];
}

/**
 * Splits one clip's items into the two halves a card draws.
 *
 * `sortOrder` is deliberately ignored for the completed half — an item's position in
 * the list stops being interesting the moment it is ticked, and `doneAt` is the only
 * ordering a reader can predict there.
 *
 * Items with no `doneAt` but `isDone: true` (a row hand-edited in the database, or
 * one written before the column existed) sort last rather than throwing: a missing
 * timestamp is a cosmetic defect in one row, not a reason to refuse to draw a board.
 */
export function buildClipItemBoard(items: ClipItem[]): ClipItemBoard {
  const open = items
    .filter((item) => !item.isDone)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

  const done = items
    .filter((item) => item.isDone)
    .sort((a, b) => {
      // Descending by tick time. An absent timestamp sorts to the bottom in both
      // directions, which is why it is compared before the strings rather than
      // folded into them as "".
      if (a.doneAt === b.doneAt) return b.id - a.id;
      if (a.doneAt === undefined) return 1;
      if (b.doneAt === undefined) return -1;
      return b.doneAt.localeCompare(a.doneAt);
    });

  return { open, done };
}

/** The board, split into its pinned band and everything else. */
export interface ClipBoard {
  /** Drawn first, under a PINNED heading. Empty when nothing is pinned. */
  pinned: ClipSummary[];
  /** Everything else, in the order the repository returned. */
  rest: ClipSummary[];
}

/**
 * Splits the list into the pinned band and the rest.
 *
 * The *order within* each half is left exactly as the repository returned it — this
 * function only partitions. That matters: ordering lives in one `ORDER BY`
 * (`idx_clp_clips_pinned_updated`, migration 0157) precisely so the list view and the
 * board cannot disagree about it, and re-sorting here would be a second, divergent
 * answer to the same question.
 */
export function buildClipBoard(clips: ClipSummary[]): ClipBoard {
  return {
    pinned: clips.filter((clip) => clip.isPinned),
    rest: clips.filter((clip) => !clip.isPinned),
  };
}

/**
 * Deals clips into `columnCount` columns for a masonry layout.
 *
 * ## Why this is not CSS `columns`
 *
 * CSS multi-column fills column one to the bottom, then column two — so a board of
 * eight cards reads top-to-bottom-then-across, while every reader scans a card board
 * left-to-right. Worse, it re-flows on resize in ways that move a card the reader was
 * about to click.
 *
 * ## Why it is not round-robin either
 *
 * Dealing 1-2-3-1-2-3 keeps reading order but ignores height, so a column that drew
 * three long clips runs far past one that drew three one-liners — the ragged bottom
 * the screenshot's layout exists to avoid.
 *
 * So: shortest-column-first, using an *estimate* of each card's height. Reading order
 * is preserved left-to-right for equal heights (ties take the leftmost column), and
 * the columns come out close to level.
 *
 * Returns `columnCount` arrays, some possibly empty — a caller rendering four columns
 * with three clips gets one empty column rather than three columns, so the grid's
 * widths stay stable.
 */
export function dealClipsIntoColumns(
  clips: ClipSummary[],
  columnCount: number,
): ClipSummary[][] {
  // A board with no columns is a caller bug, but refusing to draw is a worse answer
  // than drawing one column — this is layout, not data integrity.
  const count = Math.max(1, Math.floor(columnCount));
  const columns: ClipSummary[][] = Array.from({ length: count }, () => []);
  const heights = new Array<number>(count).fill(0);

  for (const clip of clips) {
    // `indexOf` on the running minimum, so ties resolve to the LEFTMOST column.
    // That is what keeps a short board reading left-to-right: with all heights
    // equal, this degenerates to exactly the round-robin a reader expects.
    let target = 0;
    for (let i = 1; i < count; i += 1) {
      if (heights[i] < heights[target]) target = i;
    }
    columns[target].push(clip);
    heights[target] += estimateCardHeight(clip);
  }

  return columns;
}

/**
 * A rough height for one card, in arbitrary units.
 *
 * Only ever compared against other cards' estimates, never used as a pixel value —
 * so it needs to be *monotonic in the things that make a card tall*, not accurate.
 * Getting it wrong makes a column slightly ragged; nothing breaks.
 *
 * Measuring the real rendered heights would be exact, but it would also mean a
 * layout pass in the browser, a re-deal on every resize, and cards visibly jumping
 * between columns after paint. An estimate computed on the server, from data already
 * in hand, draws the board correctly on the first paint instead.
 */
function estimateCardHeight(clip: ClipSummary): number {
  // The frame: border, padding, title, and the footer row of chips.
  let height = 6;

  // Roughly one line per 40 characters of excerpt. The excerpt is already clamped to
  // the reader's preferred length before it reaches here, so a long clip and a very
  // long clip contribute the same — which is correct, because the card shows the same
  // amount of both.
  height += Math.ceil(clip.excerpt.length / 40);

  // Each item is its own line, and the completed group collapses to a single row
  // however many it holds — so counting all items would badly over-estimate a clip
  // with forty things ticked off.
  const open = clip.items.filter((item) => !item.isDone).length;
  const done = clip.items.length - open;
  height += open + (done > 0 ? 1 : 0);

  // Chips wrap at roughly four to a row.
  const chips = clip.categories.length + clip.tags.length;
  height += Math.ceil(chips / 4);

  // An image count line, when there is one.
  if (clip.imageCount > 0) height += 1;

  return height;
}
