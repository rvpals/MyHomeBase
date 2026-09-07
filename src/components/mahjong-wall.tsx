// A group of mahjong tiles with an optional title, count and badge — one player's rack,
// the undealt wall, or the discard pool.
//
// Pure presentation: it arranges tiles and reports clicks. It does not know what the
// count means, so `count` arrives as a formatted string — the same choice `CardHand`
// makes with `total`, and for the same reason: a rack might show "13", a wall "84 left",
// and a solitaire board "56 pairs", none of which belongs in here.
//
// See components.md before adding another arrangement.

import { type ReactNode } from "react";
import {
  MahjongTile,
  type MahjongTileSize,
  type TileDeal,
} from "@/components/mahjong-tile";
import { type Tile } from "@/lib/games";

/**
 * How the tiles are arranged. The three shapes a real table has.
 *
 * `rack` stands them in a row, wrapping when it runs out of width — a player's own hand,
 * which must be readable tile by tile. The default.
 *
 * `wall` overlaps them tightly so only each tile's left edge shows, which is how the
 * undealt wall is stacked and the only way 84 tiles fit on a phone.
 *
 * `pool` is a loose wrapped grid with gaps — the discard pile, where tiles are thrown
 * rather than placed, and where reading any single one still has to be possible.
 *
 * One component with three layouts rather than three components, because they differ
 * only in spacing: the title row, the count, the deal animation and the click handling
 * are identical, and three files would be three places to fix the same bug.
 */
export type MahjongWallLayout = "rack" | "wall" | "pool";

export interface MahjongWallProps {
  /** The tiles, left to right. An empty array draws the placeholder slots. */
  tiles: readonly Tile[];
  /** Small heading above the group — "Your rack", "Wall", "Discards". */
  title?: string;
  /**
   * How many tiles, already formatted. A string, not a number: what a count *means* is
   * the game's business, and "84 left" and "13" are both right in different games.
   */
  count?: string;
  /** A note beside the count, in muted type — "to draw", "this round". */
  countNote?: string;
  /** Anything on the right of the title row: a seat wind, a score, a turn marker. */
  badge?: ReactNode;
  /** Tile size, passed through. Default `"md"`. */
  size?: MahjongTileSize;
  /** Default `"rack"`. */
  layout?: MahjongWallLayout;
  /**
   * Index from which tiles are drawn face down.
   *
   * `hideFrom={0}` hides everything — another player's rack. Omit it to show all.
   */
  hideFrom?: number;
  /** Draws this many empty slots when `tiles` is empty, so the table holds its shape. */
  placeholders?: number;
  /** Marks the group as the one in play. Draws a ring and lifts its tiles. */
  active?: boolean;
  /** Dims the whole group — one that is out of play. */
  dimmed?: boolean;
  /** Index of a selected tile, for the first half of an attempted pair. */
  selectedIndex?: number;
  /**
   * Which tiles are free to pick up, by id.
   *
   * Ids, not indices, for the reason `dealing` uses them: a tile's index shifts as tiles
   * are cleared. Omit it and every tile reads as playable, which is right for a rack —
   * this is for a solitaire layout, where most tiles are blocked.
   */
  freeIds?: ReadonlySet<number>;
  /** Makes each tile clickable. Receives the tile and its index. */
  onTileClick?: (tile: Tile, index: number) => void;
  /**
   * Flies the tiles named here in from the wall; everything else is drawn in place.
   *
   * Tile ids, not indices, because a tile's index shifts as a rack grows and is sorted —
   * an index-based set would re-fly a settled tile the moment another arrived beside it.
   * The caller works out which ids are new; this component has no memory of the previous
   * render. Returns `undefined` per tile to skip it, so one call site can animate an
   * arrival and leave its neighbours alone.
   */
  dealing?: (tile: Tile, index: number) => TileDeal | undefined;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/**
 * How far a stacked tile is pulled over the one before it, per size.
 *
 * Only `wall` overlaps. A tile is thicker than a card, so the overlap is shallower than
 * `CardHand`'s fan — pulling a tile as far as a card hides the extruded side that makes
 * the stack read as a stack rather than a stripe.
 */
const WALL_OVERLAP: Record<MahjongTileSize, string> = {
  sm: "-ml-5 max-lg:-ml-[22px]",
  md: "-ml-7 max-lg:-ml-8",
  lg: "-ml-10 max-lg:-ml-9",
};

/** The gap between tiles, per layout. `wall` sets none — it uses a negative margin instead. */
const LAYOUT_GAP: Record<MahjongWallLayout, string> = {
  // Tight but non-zero: a real rack has its tiles touching, and the extruded sides need
  // a hair of space or each tile's shadow lands on its neighbour's face.
  rack: "gap-1",
  wall: "",
  pool: "gap-2 max-lg:gap-1.5",
};

export function MahjongWall({
  tiles,
  title,
  count,
  countNote,
  badge,
  size = "md",
  layout = "rack",
  hideFrom,
  placeholders = 4,
  active = false,
  dimmed = false,
  selectedIndex,
  freeIds,
  onTileClick,
  dealing,
  className = "",
}: MahjongWallProps) {
  const showHeader = Boolean(title || count || badge);
  const overlap = layout === "wall" ? WALL_OVERLAP[size] : "";

  return (
    <div
      className={[
        "flex flex-col gap-2 rounded-lg border p-2 transition-colors",
        active ? "border-brass bg-brass/10" : "border-transparent",
        className,
      ].join(" ")}
    >
      {showHeader && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            {title && (
              <span className="text-[0.65rem] uppercase tracking-wide text-muted">{title}</span>
            )}
            {count && (
              <span className="font-display text-lg tabular-nums text-ink">
                {count}
                {countNote && <span className="ml-1 text-xs text-muted">{countNote}</span>}
              </span>
            )}
          </div>
          {badge}
        </div>
      )}

      {/*
        `items-end` so tiles of one size sit on a common baseline, and `pb` to leave room
        for the extrusion and the cast — without it, the bottom row's shadow is clipped by
        the container and the tiles look pasted on rather than resting on something.
      */}
      <div className={`flex flex-wrap items-end pb-1 pr-1 ${LAYOUT_GAP[layout]}`}>
        {tiles.length === 0
          ? Array.from({ length: placeholders }, (_, index) => (
              <MahjongTile
                key={`slot-${index}`}
                size={size}
                empty
                className={index > 0 ? overlap : ""}
              />
            ))
          : tiles.map((tile, index) => (
              <MahjongTile
                key={tile.id}
                // A hidden tile is drawn as a back: the component is handed no tile at
                // all rather than a tile plus a "hidden" flag, so a face-down tile's
                // value is never in the DOM for a curious player to read. Same rule
                // `CardHand` follows for a hole card.
                tile={hideFrom !== undefined && index >= hideFrom ? undefined : tile}
                size={size}
                dimmed={dimmed}
                selected={selectedIndex === index}
                // No `freeIds` means every tile is playable, which is right for a rack.
                free={freeIds ? freeIds.has(tile.id) : false}
                // The whole group rises when it is the one in play, reinforcing the ring
                // above with a physical cue. Per-tile rather than on the row, so each
                // tile keeps its own extrusion and cast.
                lifted={active}
                onClick={onTileClick ? () => onTileClick(tile, index) : undefined}
                dealing={dealing?.(tile, index)}
                className={index > 0 ? overlap : ""}
              />
            ))}
      </div>
    </div>
  );
}
