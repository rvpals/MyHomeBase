"use client";

// A variable-height card board: cards of differing heights dealt into balanced
// columns, reading left to right.
//
// Pure presentation. It takes items already in the order they should be read and a
// function that draws one, and owns nothing but the layout.

import { useEffect, useRef, useState, type ReactNode } from "react";

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
  /**
   * Fixed-width mode: the narrowest a column may be, in pixels.
   *
   * Set it and the board stops drawing a fixed number of stretched columns and
   * starts fitting as many ~this-wide ones as the space allows — so a card is the
   * same width on a laptop and on a 4K monitor, and a wider window shows *more*
   * cards rather than fatter ones.
   *
   * Only applies from 1024px up. Below that the board is always one column
   * (`columns.compact`), because two 280px cards side by side on a phone is exactly
   * the unreadable layout the compact rule exists to prevent.
   *
   * Leave it unset for the classic fixed-column behaviour.
   */
  minColumnWidth?: number;
  /**
   * The most columns `minColumnWidth` may produce. Ignored without it.
   *
   * A ceiling rather than a limit of the maths: a very wide monitor would otherwise
   * draw a dozen slivers, and a board that reads across twelve columns stops being
   * scannable long before it stops fitting.
   */
  maxColumns?: number;
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

/** The `minColumnWidth` ceiling when the caller names none. */
const DEFAULT_MAX_COLUMNS = 6;

/** `gap-3` in pixels — the gap the grid actually draws between columns. */
const COLUMN_GAP = 12;

/**
 * The compact boundary, in pixels — `design.md`'s one breakpoint, as a number.
 *
 * Measured mode needs the boundary as a value rather than as a `lg:` class, because
 * the column count is computed in JS. It is the same 1024px either way; if that ever
 * moves, it moves in both places together.
 */
const COMPACT_MAX_WIDTH = 1024;

export function MasonryBoard<T>({
  items,
  deal,
  renderItem,
  itemKey,
  columns = { compact: 1, wide: 3 },
  minColumnWidth,
  maxColumns = DEFAULT_MAX_COLUMNS,
  className = "",
}: MasonryBoardProps<T>) {
  const wide = WIDE_GRID_CLASS[columns.wide] ? columns.wide : 3;
  const compact = COMPACT_GRID_CLASS[columns.compact] ? columns.compact : 1;

  // Measured mode's own count. `undefined` until the board has been measured, which
  // covers the server render and the first client paint — both fall back to the
  // class-driven `wide`/`compact` counts below, so nothing flashes empty and a
  // reader with JS disabled still gets a board.
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<number | undefined>(undefined);

  useEffect(() => {
    const host = hostRef.current;
    if (minColumnWidth === undefined || minColumnWidth <= 0 || host === null) {
      // Clearing matters: a board switched back to fixed columns would otherwise
      // keep drawing the last measured count forever.
      setMeasured(undefined);
      return;
    }

    // Bound to a const so `recount` sees a plain `number`. The guard above narrows
    // the prop, but that narrowing does not reach inside a nested function.
    const columnWidth = minColumnWidth;
    const ceiling = Math.max(1, Math.floor(maxColumns));

    function recount(width: number) {
      // Below the boundary the compact rule wins outright — see `minColumnWidth`.
      if (width < COMPACT_MAX_WIDTH) {
        setMeasured(compact);
        return;
      }
      // `gap-3` is 12px, so n columns need (n-1) gaps. Solving for n exactly would
      // be fussier than it is worth; starting from the ungapped count and stepping
      // down while it does not fit is two iterations at most.
      let count = Math.max(1, Math.floor(width / columnWidth));
      while (count > 1 && count * columnWidth + (count - 1) * COLUMN_GAP > width) {
        count -= 1;
      }
      setMeasured(Math.min(count, ceiling));
    }

    recount(host.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) recount(entry.contentRect.width);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [minColumnWidth, maxColumns, compact]);

  // Dealt for the count actually being drawn. In class mode that is the WIDE count,
  // and a narrow screen then stacks those columns one above another — which keeps
  // every card present and in a sensible order, for the reasons in the note below.
  const columnCount = measured ?? wide;
  const dealt = deal(items, columnCount);

  if (items.length === 0) return null;

  // In measured mode the count is a number, not a class — so the template is inline
  // and the `lg:grid-cols-*` class is left off entirely rather than fighting it.
  const gridClass =
    measured === undefined
      ? `${COMPACT_GRID_CLASS[compact]} ${WIDE_GRID_CLASS[wide]}`
      : "";
  const gridStyle =
    measured === undefined
      ? undefined
      : { gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` };

  return (
    // `items-start` so a short column does not stretch to match a tall one: without
    // it, grid's default `stretch` makes every column the height of the tallest and
    // the cards inside it spread out, which is the opposite of a masonry board.
    <div
      ref={hostRef}
      className={`grid items-start gap-3 ${gridClass} ${className}`}
      style={gridStyle}
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
 * ## Why measured mode needs JS at all
 *
 * `repeat(auto-fill, minmax(280px, 1fr))` would fit the columns without measuring —
 * but it never tells anyone how many it produced, and `deal` has to know the count
 * to balance the cards by height. CSS can lay out a fixed-width grid or it can
 * balance heights, not both. So the width is measured once, the count is derived
 * from it, and the deal and the template agree because they come from one number.
 *
 * ## Why a narrow screen stacks rather than re-deals (class mode)
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
 *
 * Measured mode does not have this problem: it already knows the width, so below the
 * boundary it deals at the compact count directly and a phone reads straight down.
 */
