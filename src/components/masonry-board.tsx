"use client";

// A variable-height card board: cards of differing heights dealt into balanced
// columns, reading left to right.
//
// Pure presentation. It takes items already in the order they should be read and a
// function that draws one, and owns nothing but the layout.

import { type ReactNode } from "react";

/**
 * How many columns to draw at each width.
 *
 * One boundary, 1024px, the same one `design.md` fixes for the whole app. `compact`
 * is the base and `wide` is what `lg:` adds — the direction design.md asks for, so a
 * wide screen provably cannot regress when the narrow layout changes.
 */
export interface MasonryColumns {
  /** Below 1024px. Almost always 1 — two columns of cards on a phone are unreadable. */
  compact: number;
  /** From 1024px up. */
  wide: number;
}

export interface MasonryBoardProps<T> {
  /** The cards, in reading order. Dealt into columns by `deal`. */
  items: T[];
  /**
   * Splits the items into columns.
   *
   * A prop rather than logic in here, because *how* to balance columns is a domain
   * decision — the Clips board estimates a card's height from its own fields, which
   * this component has no way to know. Must return exactly `count` arrays, some
   * possibly empty.
   */
  deal: (items: T[], count: number) => T[][];
  /** Draws one card. */
  renderItem: (item: T) => ReactNode;
  /** A stable key per item. */
  itemKey: (item: T) => string | number;
  /** Columns per breakpoint. Defaults to one narrow, three wide. */
  columns?: MasonryColumns;
  className?: string;
}

/**
 * The Tailwind class for each supported wide column count.
 *
 * A lookup and not `lg:grid-cols-${n}`: Tailwind scans source text for complete
 * class names, so an interpolated one is never generated and the board silently
 * falls back to a single column. Every value that can be asked for is spelled out
 * here, which is also why `columns.wide` is clamped to this set.
 */
const WIDE_GRID_CLASS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
};

const COMPACT_GRID_CLASS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
};

export function MasonryBoard<T>({
  items,
  deal,
  renderItem,
  itemKey,
  columns = { compact: 1, wide: 3 },
  className = "",
}: MasonryBoardProps<T>) {
  const wide = WIDE_GRID_CLASS[columns.wide] ? columns.wide : 3;
  const compact = COMPACT_GRID_CLASS[columns.compact] ? columns.compact : 1;

  // Dealt for the WIDE count. A narrow screen then stacks those columns one above
  // another, which keeps every card present and in a sensible order — see the note
  // below on why that is accepted rather than re-dealt.
  const dealt = deal(items, wide);

  if (items.length === 0) return null;

  return (
    // `items-start` so a short column does not stretch to match a tall one: without
    // it, grid's default `stretch` makes every column the height of the tallest and
    // the cards inside it spread out, which is the opposite of a masonry board.
    <div
      className={`grid items-start gap-3 ${COMPACT_GRID_CLASS[compact]} ${WIDE_GRID_CLASS[wide]} ${className}`}
    >
      {dealt.map((column, index) => (
        <div key={index} className="flex flex-col gap-3">
          {column.map((item) => (
            <div key={itemKey(item)}>{renderItem(item)}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

/*
 * ## Why the columns are real elements and not CSS `columns`
 *
 * CSS multi-column fills column one to the bottom, then column two — so a board of
 * eight cards reads top-to-bottom-then-across while every reader scans a card board
 * left-to-right. It also re-flows on resize in ways that move a card the reader was
 * about to click, and `break-inside: avoid` is only mostly honoured.
 *
 * ## Why a narrow screen stacks rather than re-deals
 *
 * At `compact: 1` the grid becomes one column and the dealt columns stack in order,
 * so a phone reads column one's cards, then column two's. That is not the same order
 * as a single-column deal would give.
 *
 * Accepted deliberately: every card is present, each column's internal order is
 * preserved, and the alternative — dealing again at the compact count — would mean
 * knowing the viewport during render. That is `useViewport()`, which design.md
 * reserves for when the small screen needs a genuinely *different component* rather
 * than a restyled one. A board is the same component either way.
 */
