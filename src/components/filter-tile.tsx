"use client";

// A square, toggleable filter tile: one category or tag, drawn big enough that
// its uploaded icon is actually legible.
//
// Its own component rather than a variant of `FilterChip`, because the chip is
// still the right shape for its two other jobs in the Location Manager -- the
// Venn diagram's chips and the per-location category/tag editor, where a grid
// of squares inside a form row would be far too heavy. Those keep the pill;
// this is for the *filter block* above a list of places.
//
// Presentational: it renders the name it is given, says when it was pressed,
// and knows nothing about what the filtering then does.

export interface FilterTileProps {
  /** The category or tag name. Also the tile's accessible name. */
  label: string;
  /** The uploaded taxonomy icon, when this name has one. */
  iconUrl?: string;
  /** Whether this name is currently part of the filter. */
  isActive: boolean;
  /** Raised on click; the caller owns the selection. */
  onToggle: () => void;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/**
 * The monogram shown when a name has no uploaded icon.
 *
 * `Array.from` rather than `label[0]`: a name may begin with an emoji or an
 * accented character outside the BMP, and indexing a string would cut such a
 * character in half and render a replacement box.
 */
function monogramOf(label: string): string {
  const first = Array.from(label.trim())[0] ?? "?";
  return first.toLocaleUpperCase();
}

export function FilterTile({
  label,
  iconUrl,
  isActive,
  onToggle,
  className = "",
}: FilterTileProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isActive}
      title={label}
      // The whole square is one target, so per design.md it takes `Button`'s
      // switch mechanic via `.shortcut-tile` rather than a card's soft lift --
      // the same borrowing My Shortcuts' tiles make, for the same reason.
      // `bg-paper-raised` gives the offset shadow a surface to read against.
      className={`shortcut-tile flex w-full flex-col items-center gap-1.5 rounded-lg border p-2 text-center transition-colors ${
        isActive
          ? "border-brass bg-brass-soft text-ink"
          : "border-line bg-paper-raised text-muted hover:border-brass hover:bg-brass-soft hover:text-ink"
      } ${className}`}
    >
      <span
        // Fixed square: every tile is the same size whether its icon loaded,
        // failed, or was never uploaded, so the grid stays even.
        className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md"
        aria-hidden="true"
      >
        {iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- icon bytes are served from our own DB-backed route, not a static asset next/image can optimize.
          <img src={iconUrl} alt="" loading="lazy" className="h-full w-full object-contain" />
        ) : (
          <span className="font-display text-lg leading-none text-brass-dark">
            {monogramOf(label)}
          </span>
        )}
      </span>

      {/* Two lines, then ellipsis: a long name like "Restaurants & Cafes"
          needs the second line to stay readable, but an unbounded label would
          make one tile taller than its neighbours and ripple the whole row. */}
      <span className="line-clamp-2 break-words text-[0.7rem] leading-tight">{label}</span>
    </button>
  );
}
