// A single mahjong tile: a face, a back, or an empty slot.
//
// Pure presentation, and the tile twin of `PlayingCard`. It takes a `Tile` from
// @/lib/games and draws it — no game knows how its tiles look, and this component knows
// nothing about what a tile is worth. See components.md before adding another treatment.
//
// The face is drawn rather than illustrated, the same choice `PlayingCard` makes and for
// a stronger reason here. The Unicode mahjong block (U+1F000-1F02B) has a glyph for all
// 144 tiles, and using it would be a one-liner — but those glyphs are emoji-coloured on
// Windows, monochrome on macOS, and missing entirely on plenty of Android builds, so the
// same board would render three different ways and re-theme on none of them. Drawing each
// face from parts (a numeral, a suit mark, a pip field, a letter panel) costs more code
// once and then scales cleanly, inverts with the theme, and looks the same everywhere.
//
// The 3D is CSS, in globals.css — `.mahjong-tile` and friends. A tile is a ~15mm block
// rather than a sheet, so it gets a real extruded body instead of the card's thin bevel;
// the reasoning is written out there, next to the card rules it deliberately differs from.

import { type CSSProperties, type ReactElement } from "react";
import {
  FLOWERS,
  SEASONS,
  type Dragon,
  type Flower,
  type Season,
  type Tile,
  type TileRank,
  type TileSuit,
  type Wind,
} from "@/lib/games";

/**
 * The default flight time for a dealt tile.
 *
 * Matches `PlayingCard`'s `DEAL_MS`, deliberately: a table that deals cards in 300ms and
 * tiles in 500 reads as two different apps. Short for the same reason — longer than this
 * stops reading as a deal and starts reading as lag.
 */
export const TILE_DEAL_MS = 300;

/**
 * How long a cleared pair takes to fly off the board.
 *
 * Longer than a deal (300ms), deliberately. A dealt tile is the game getting out of the
 * player's way, so it wants to be quick; a cleared pair is the reward for the move just
 * made, and it needs long enough to be *watched* — under about 350ms the two tiles read
 * as having blinked out rather than left. Still short enough that a fast player tapping
 * the next pair is never waiting on it: the board is already updated underneath, and the
 * flight is purely decorative by the time it finishes.
 */
export const TILE_FLY_MS = 420;

/**
 * Tile sizes, all at the 3:4 ratio a real tile has.
 *
 * Wider relative to its height than a playing card (which is 2.5:3.5), which is most of
 * why a rack of tiles reads differently from a hand of cards even at a glance.
 *
 * Named rather than free-form so every board in the app deals the same-sized tiles. `sm`
 * is for a full 144-tile layout or a phone rack, `md` the default, `lg` for a tile the
 * player is being asked to look at.
 */
export type MahjongTileSize = "sm" | "md" | "lg";

/**
 * Where a tile flies in from, and when.
 *
 * The same shape as `CardDeal`, and per-seat for the same reason: the offsets are the
 * tile's start position *relative to where it lands*, so one shared distance would send
 * one seat's tiles travelling the wrong way. Fixed units rather than viewport ones, so a
 * phone gets the same short legible flight instead of a tile crossing the whole screen.
 */
export interface TileDeal {
  /** Milliseconds before the flight starts. Sequences a deal; 0 for a lone draw. */
  delayMs?: number;
  /** Horizontal start offset, any CSS length. Default `"5rem"` (the wall is to the right). */
  fromX?: string;
  /** Vertical start offset. Default `"-3rem"` (the wall is above). */
  fromY?: string;
  /** Start rotation in degrees, straightening to 0 on arrival. Default `10`. */
  spinDeg?: number;
  /** Flight duration in milliseconds. Default `300`. */
  durationMs?: number;
}

/**
 * Where a cleared tile flies to, and how fast.
 *
 * Offsets are relative to where the tile currently sits, so `x: "4rem"` sends it right
 * regardless of its board position. Fixed units rather than viewport ones, so the flight
 * is the same short legible distance on a phone as on a desktop.
 */
export interface TileFly {
  /** Horizontal travel, any CSS length. Default `"4rem"`. */
  x?: string;
  /** Vertical travel. Default `"-3rem"` — a cleared pair drifts up as it leaves. */
  y?: string;
  /** Spin in degrees over the flight. Default `24`. */
  spinDeg?: number;
  /** Duration in milliseconds. Default `TILE_FLY_MS`. */
  durationMs?: number;
}

export interface MahjongTileProps {
  /**
   * The tile to draw. Omit it for a face-down tile — one in another player's rack or in
   * an undealt wall, where the point is that the value is not known to the viewer.
   */
  tile?: Tile;
  /** Size preset. Default `"md"`. */
  size?: MahjongTileSize;
  /**
   * Draws an empty outline instead of a tile. For a board position that exists but holds
   * nothing yet, which reads better than a gap that collapses.
   */
  empty?: boolean;
  /** Dims the tile, for one that is out of play but still shown. */
  dimmed?: boolean;
  /** Draws the selected ring. For the first tile of an attempted pair. */
  selected?: boolean;
  /**
   * Marks the tile as one half of a hinted pair.
   *
   * Its own prop rather than reusing `selected`, which is what it did at first and did
   * not work: every *free* tile already carries a thin brass ring, so a hinted tile
   * drawing a slightly thicker brass ring was invisible among its neighbours. A hint has
   * to be findable at a glance across a 144-tile board, so it gets a treatment nothing
   * else on the board uses — a filled wash plus a pulse.
   */
  hinted?: boolean;
  /**
   * Marks the tile as playable — free to be picked up.
   *
   * A solitaire layout needs this: a tile buried under another is drawn but cannot be
   * chosen, and dimming every blocked tile is far too heavy when most of a 144-tile
   * board is blocked. So the *free* tiles are marked instead, with a warm edge.
   */
  free?: boolean;
  /** Raises the tile off the table, for one being acted on. Pairs with the wall's ring. */
  lifted?: boolean;
  /** Makes the tile a button. Omit for a tile that is only being displayed. */
  onClick?: () => void;
  /**
   * Flies the tile in from the wall instead of drawing it in place.
   *
   * For the frame a tile *arrives* on, and only that frame — a tile already on the table
   * must not be given this, or it re-flies on every re-render. The caller decides which
   * tiles are new and where the wall is relative to this seat, because a component
   * drawing one tile can know neither.
   */
  dealing?: TileDeal;
  /**
   * Flies the tile off the board — for a matched pair being cleared.
   *
   * The mirror of `dealing`, and the caller owns the direction for the same reason: only
   * it knows where this half of the pair sat, and the two halves should leave *outward*,
   * one to each side. A pair that both drift the same way reads as two unrelated tiles
   * that happened to go at once.
   *
   * The tile must stay mounted for the flight, so a board that removes a cleared tile
   * from the DOM immediately will never show this — see the note in
   * `game-mahjong-match-view.tsx`, which holds each pair for the animation's duration
   * before dropping it.
   */
  flying?: TileFly;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/**
 * Geometry per size: the tile box, its extruded depth, and the type scale inside it.
 *
 * Explicit Tailwind classes rather than computed strings — Tailwind only ships classes it
 * can see in the source, so a template literal would produce styles that work in dev and
 * vanish from a production build.
 *
 * `depth` is the one non-class value: it feeds `--tile-depth`, which drives how far the
 * CSS walks the extrusion and how far a lifted tile rises. A thinner tile at `sm` is
 * correct rather than a shortcut — a scale model of a tile is thinner too, and a full
 * 6px extrusion on a 34px-wide tile is most of its own width.
 *
 * Each steps down one level below 1024px via `max-lg:`, so a rack that fits a desktop
 * also fits a phone without the caller choosing a different size per breakpoint.
 */
const SIZES: Record<
  MahjongTileSize,
  {
    box: string;
    depth: number;
    /** A characters tile's numeral and its 萬 — two stacked lines, so each is modest. */
    numeral: string;
    /** A wind, a dragon or a bonus glyph: one character filling the face. */
    honour: string;
    /** The bonus tiles' corner ordinal. */
    mark: string;
    /** One ring on a circles tile. */
    pip: string;
    /** One bamboo cane's width. Height comes from the row it sits in. */
    cane: string;
  }
> = {
  sm: {
    box: "h-[45px] w-[34px] max-lg:h-[39px] max-lg:w-[29px]",
    depth: 3,
    numeral: "text-[0.6rem] max-lg:text-[0.55rem]",
    honour: "text-[0.95rem] max-lg:text-[0.85rem]",
    mark: "text-[0.45rem] max-lg:text-[0.4rem]",
    pip: "h-[5px] w-[5px] max-lg:h-1 max-lg:w-1",
    cane: "w-[2px]",
  },
  md: {
    box: "h-[64px] w-[48px] max-lg:h-[54px] max-lg:w-[41px]",
    depth: 5,
    numeral: "text-[0.8rem] max-lg:text-[0.7rem]",
    honour: "text-xl max-lg:text-lg",
    mark: "text-[0.55rem] max-lg:text-[0.5rem]",
    pip: "h-[7px] w-[7px] max-lg:h-[6px] max-lg:w-[6px]",
    cane: "w-[3px]",
  },
  lg: {
    box: "h-[88px] w-[66px] max-lg:h-[72px] max-lg:w-[54px]",
    depth: 7,
    numeral: "text-base max-lg:text-sm",
    honour: "text-3xl max-lg:text-2xl",
    mark: "text-[0.7rem] max-lg:text-[0.6rem]",
    pip: "h-[10px] w-[10px] max-lg:h-2 max-lg:w-2",
    cane: "w-1",
  },
};

/**
 * How many canes sit in each row of a bamboo tile, top row first.
 *
 * The conventional arrangements, which are not a uniform grid — a 5 is a row of two, a
 * single centre cane, then a row of two, and a 7 is one over two rows of three. These are
 * what make the suit readable at a glance the way a numeral never would.
 *
 * Rank 1 is absent: it is a bird on every set, handled separately in `BambooField`.
 */
const BAMBOO_ROWS: Record<TileRank, readonly number[]> = {
  1: [],
  2: [1, 1],
  3: [1, 2],
  4: [2, 2],
  5: [2, 1, 2],
  6: [3, 3],
  7: [1, 3, 3],
  8: [4, 4],
  9: [3, 3, 3],
};

/**
 * The colours a real set paints its pips in, as CSS custom properties.
 *
 * Fixed rather than theme tokens, and defined in globals.css alongside the ivory body —
 * see the note there. A suit's colour is a property of the tile set, not of the palette,
 * the same fixed-semantic exception `PlayingCard` takes for a red heart.
 */
const RED = "text-[var(--tile-red)]";
const GREEN = "text-[var(--tile-green)]";
const BLUE = "text-[var(--tile-blue)]";

/**
 * The Chinese numerals one to nine, for the characters suit.
 *
 * A characters tile is printed as a numeral over 萬 — 一萬, 二萬, 三萬 — never as an
 * Arabic digit, which is what a real set does and what the reference photo shows. The
 * numeral is the top half of the tile and 萬 the bottom, both in red on most sets
 * (some print the numeral in blue; red throughout is the commoner style).
 */
const CHINESE_NUMERALS: Record<TileRank, string> = {
  1: "一",
  2: "二",
  3: "三",
  4: "四",
  5: "伍",
  6: "六",
  7: "七",
  8: "八",
  9: "九",
};

/** Each suit's English name, for a screen reader, and the mark it prints. */
const SUIT_NAMES: Record<TileSuit, string> = {
  bamboo: "bamboo",
  circles: "circles",
  characters: "characters",
};

/**
 * The wind glyphs. Blue on a real set, which is how they read as a group.
 *
 * Note they are *not* the same blue as the circles suit by accident — both are the
 * set's one blue, and a wind is told from a circles tile by being a character rather
 * than by hue.
 */
const WIND_FACES: Record<Wind, { glyph: string; name: string }> = {
  east: { glyph: "東", name: "east" },
  south: { glyph: "南", name: "south" },
  west: { glyph: "西", name: "west" },
  north: { glyph: "北", name: "north" },
};

/**
 * The dragons: a glyph, its printed colour, and its name.
 *
 * The three conventional colours, which are the whole point of the dragons — red 中,
 * green 發, and the white dragon as a **blue frame**. The frame is what a real set
 * prints (the tile is otherwise blank), and it is drawn here rather than substituting a
 * 白 glyph: at 48px an empty tile with a rectangle on it is unmistakable, where a lone
 * character is just another honour.
 */
const DRAGON_FACES: Record<Dragon, { glyph: string; colour: string; name: string }> = {
  red: { glyph: "中", colour: RED, name: "red dragon" },
  green: { glyph: "發", colour: GREEN, name: "green dragon" },
  white: { glyph: "", colour: BLUE, name: "white dragon" },
};

/**
 * The four flowers, drawn.
 *
 * A real set prints the *plant*, not the word for it — which is what the reference set
 * shows and the reason these are drawings rather than 梅 / 蘭 / 菊 / 竹. A character
 * names the tile; the artwork *is* the tile, and at 48px a blossom is far easier to tell
 * from its neighbour than two similar CJK glyphs are.
 *
 * Each is a small scene in a 24x32 box, matching the tile's 3:4 ratio, and each is
 * distinguishable by silhouette alone: plum is a five-petal blossom, orchid a pair of
 * arcing leaves, chrysanthemum a many-rayed head, bamboo a segmented stalk with leaves.
 * Silhouette rather than detail, because two flowers that differ only in petal count are
 * the same tile to a player scanning a 144-tile board.
 */
const FLOWER_FACES: Record<
  Flower,
  { colour: string; name: string; art: (props: { className?: string }) => ReactElement }
> = {
  plum: { colour: RED, name: "plum", art: PlumArt },
  orchid: { colour: GREEN, name: "orchid", art: OrchidArt },
  chrysanthemum: { colour: RED, name: "chrysanthemum", art: ChrysanthemumArt },
  bamboo: { colour: GREEN, name: "bamboo", art: BambooPlantArt },
};

/**
 * The four seasons, drawn.
 *
 * The seasons have no single agreed artwork the way the flowers do — sets vary, and
 * several print only a numeral and a character. These take the natural reading: a
 * sprouting shoot, a sun, a falling leaf, a snowflake. Each is a distinct silhouette for
 * the same reason the flowers are.
 */
const SEASON_FACES: Record<
  Season,
  { colour: string; name: string; art: (props: { className?: string }) => ReactElement }
> = {
  spring: { colour: GREEN, name: "spring", art: SpringArt },
  summer: { colour: RED, name: "summer", art: SummerArt },
  autumn: { colour: RED, name: "autumn", art: AutumnArt },
  winter: { colour: BLUE, name: "winter", art: WinterArt },
};

/**
 * Shared attributes for the bonus artwork.
 *
 * `currentColor` throughout, so each drawing takes the colour its tile is printed in
 * from the wrapper rather than carrying one of its own. `vectorEffect` keeps the strokes
 * a constant weight as the tile scales between `sm` and `lg` — without it a `lg` tile's
 * outlines thin out and the artwork goes faint.
 */
const ART = {
  viewBox: "0 0 24 32",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Plum blossom: five rounded petals around a centre, on a short twig. */
function PlumArt({ className }: { className?: string }) {
  return (
    <svg {...ART} className={className}>
      {/* Five petals at 72-degree intervals, drawn as circles rather than a path — a
          blossom reads by its petal ring, and circles keep that even at 29px wide. */}
      {[0, 1, 2, 3, 4].map((petal) => {
        const angle = (petal * 72 - 90) * (Math.PI / 180);
        return (
          <circle
            key={petal}
            cx={12 + Math.cos(angle) * 5}
            cy={13 + Math.sin(angle) * 5}
            r="3.4"
          />
        );
      })}
      <circle cx="12" cy="13" r="1.3" fill="currentColor" stroke="none" />
      {/* The twig, so the blossom is attached to something rather than floating. */}
      <path d="M12 21v6M12 24l3-2" />
    </svg>
  );
}

/** Orchid: two long arcing leaves and a small bloom. */
function OrchidArt({ className }: { className?: string }) {
  return (
    <svg {...ART} className={className}>
      {/* The arcing leaves are the orchid's signature — long, asymmetric, springing from
          one base. Two sweeping in opposite directions read as an orchid where a
          symmetric pair reads as grass. */}
      <path d="M12 27c-6-3-8-10-7-16" />
      <path d="M12 27c6-4 8-11 6-17" />
      <path d="M12 27c-2-6-1-11 1-15" />
      {/* The bloom, at the top of the centre stem. */}
      <path d="M13 11c1.5-1.5 3.5-1 3.5 1s-2 3-3.5 2" />
      <path d="M13 11c-1.5-1.5-3.5-1-3.5 1s2 3 3.5 2" />
      <circle cx="13" cy="13.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Chrysanthemum: a many-rayed head on a leafy stem. */
function ChrysanthemumArt({ className }: { className?: string }) {
  return (
    <svg {...ART} className={className}>
      {/* Twelve rays. The many-petalled head is what distinguishes a chrysanthemum from
          the plum's five, so the count is the point rather than the shape of each ray. */}
      {Array.from({ length: 12 }, (_, ray) => {
        const angle = (ray * 30 - 90) * (Math.PI / 180);
        return (
          <path
            key={ray}
            d={`M${12 + Math.cos(angle) * 2.4} ${12 + Math.sin(angle) * 2.4}L${
              12 + Math.cos(angle) * 7
            } ${12 + Math.sin(angle) * 7}`}
            strokeWidth="1.3"
          />
        );
      })}
      <circle cx="12" cy="12" r="2.4" />
      <path d="M12 19v8" />
      <path d="M12 23c-2.5 0-4-1.5-4-3.5 2 0 4 1 4 3.5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Bamboo, as the flower group's fourth member: a segmented stalk with leaves. */
function BambooPlantArt({ className }: { className?: string }) {
  return (
    <svg {...ART} className={className}>
      {/* Two stalks with node lines — the segmentation is what says bamboo, and it is
          also what keeps this tile distinct from the *bamboo suit* tiles, which are
          plain canes with no leaves. */}
      <path d="M10 29V6" />
      <path d="M15 29V11" />
      <path d="M8.4 22h3.2M8.4 15h3.2M13.4 22h3.2M13.4 17h3.2" strokeWidth="1.2" />
      {/* Leaves, springing left and right from the taller stalk. */}
      <path d="M10 9c-3-1-5 0-6 2 2 1 5 1 6-2Z" fill="currentColor" stroke="none" />
      <path d="M10 12c3-1 5 0 6 2-2 1-5 1-6-2Z" fill="currentColor" stroke="none" />
      <path d="M15 13c2.5-.5 4 .5 4.5 2.5-2 .5-4-.5-4.5-2.5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Spring: a sprouting shoot with two opening leaves. */
function SpringArt({ className }: { className?: string }) {
  return (
    <svg {...ART} className={className}>
      <path d="M12 28V12" />
      <path d="M12 18c-4 0-6-2.5-6-6 3.5 0 6 2 6 6Z" fill="currentColor" stroke="none" />
      <path d="M12 15c4 0 6-2.5 6-6-3.5 0-6 2-6 6Z" fill="currentColor" stroke="none" />
      {/* The ground line, so the shoot is emerging rather than hanging. */}
      <path d="M7 28h10" strokeWidth="1.3" />
    </svg>
  );
}

/** Summer: the sun, rays out. */
function SummerArt({ className }: { className?: string }) {
  return (
    <svg {...ART} className={className}>
      <circle cx="12" cy="16" r="5" />
      {Array.from({ length: 8 }, (_, ray) => {
        const angle = (ray * 45 - 90) * (Math.PI / 180);
        return (
          <path
            key={ray}
            d={`M${12 + Math.cos(angle) * 7.5} ${16 + Math.sin(angle) * 7.5}L${
              12 + Math.cos(angle) * 10
            } ${16 + Math.sin(angle) * 10}`}
            strokeWidth="1.4"
          />
        );
      })}
    </svg>
  );
}

/** Autumn: a falling leaf, veined. */
function AutumnArt({ className }: { className?: string }) {
  return (
    <svg {...ART} className={className}>
      {/* Tilted, because a leaf drawn upright reads as a plant. The tilt is the season. */}
      <g transform="rotate(-20 12 16)">
        <path d="M12 8c5 3 6 9 3 13-2 2.5-4 2.5-6 0-3-4-2-10 3-13Z" />
        <path d="M12 8v16" strokeWidth="1.1" />
        <path d="M12 14l-3.5-2M12 18l3.5-2M12 21l-3-1.5" strokeWidth="1" />
      </g>
      <path d="M12 24v4" />
    </svg>
  );
}

/** Winter: a snowflake. */
function WinterArt({ className }: { className?: string }) {
  return (
    <svg {...ART} className={className}>
      {/* Six arms with forks — three arms would read as an asterisk, and the forks are
          what make it a snowflake rather than a star. */}
      {Array.from({ length: 6 }, (_, arm) => {
        const angle = (arm * 60 - 90) * (Math.PI / 180);
        const tipX = 12 + Math.cos(angle) * 9;
        const tipY = 16 + Math.sin(angle) * 9;
        const forkX = 12 + Math.cos(angle) * 5.5;
        const forkY = 16 + Math.sin(angle) * 5.5;
        const left = angle - 0.7;
        const right = angle + 0.7;
        return (
          <g key={arm} strokeWidth="1.3">
            <path d={`M12 16L${tipX} ${tipY}`} />
            <path
              d={`M${forkX} ${forkY}L${forkX + Math.cos(left) * 3} ${forkY + Math.sin(left) * 3}`}
            />
            <path
              d={`M${forkX} ${forkY}L${forkX + Math.cos(right) * 3} ${
                forkY + Math.sin(right) * 3
              }`}
            />
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Where the dots go on each circles tile, as `[column, row]` on a 3x3 lattice.
 *
 * The traditional arrangements, which are not a uniform grid: a 4 is a square, a 5 is
 * that square plus a centre, a 7 is a diagonal of three above a block of four. Hardcoding
 * the real layouts is what makes these read as mahjong dots rather than as dot counts —
 * the same reasoning, and the same shape of table, as `PlayingCard`'s pip layouts.
 *
 * Columns run 0 (left) to 2 (right); rows 0 (top) to 2 (bottom). Halves appear because
 * several layouts centre a pair between two columns — a 2 is vertical down the middle,
 * an 8 is two columns of four.
 */
const CIRCLE_LAYOUTS: Record<TileRank, readonly (readonly [number, number])[]> = {
  1: [[1, 1]],
  2: [
    [1, 0],
    [1, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [2, 2],
  ],
  7: [
    [0, 0],
    [1, 0],
    [2, 0],
    [0.5, 1],
    [1.5, 1],
    [0.5, 2],
    [1.5, 2],
  ],
  8: [
    [0.5, 0],
    [1.5, 0],
    [0.5, 0.67],
    [1.5, 0.67],
    [0.5, 1.33],
    [1.5, 1.33],
    [0.5, 2],
    [1.5, 2],
  ],
  9: [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ],
};

export function MahjongTile({
  tile,
  size = "md",
  empty = false,
  dimmed = false,
  selected = false,
  hinted = false,
  free = false,
  lifted = false,
  onClick,
  dealing,
  flying,
  className = "",
}: MahjongTileProps) {
  const geometry = SIZES[size];
  const base = `relative shrink-0 select-none border ${geometry.box}`;
  const fade = dimmed ? "opacity-45" : "";

  // The flight, when the caller says this tile is arriving. `animate-card-deal` and its
  // reduced-motion branch are shared with `PlayingCard` — a tile and a card arrive the
  // same way, and a second identical keyframe set would be a copy to keep in sync.
  // A tile is either arriving or leaving, never both — `flying` wins, since a tile
  // cleared on the same frame it was dealt is being cleared.
  const flight = flying ? "animate-mahjong-fly" : dealing ? "animate-card-deal" : "";
  // The custom properties, assembled into one record before the cast.
  //
  // Built by mutation rather than as a spread of conditional objects: three alternative
  // object shapes produce a *union* type, and TypeScript refuses to cast a union to
  // `CSSProperties` because no member sufficiently overlaps it. One `Record` has one
  // type, so the cast is honest and a new property cannot silently change it.
  const vars: Record<string, string | number> = {
    // The extruded depth, read by every `.mahjong-tile-*` rule in globals.css. Inline
    // because it is a per-size number and Tailwind cannot ship a class per value.
    "--tile-depth": geometry.depth,
  };

  if (flying) {
    vars["--fly-x"] = flying.x ?? "4rem";
    vars["--fly-y"] = flying.y ?? "-3rem";
    vars["--fly-spin"] = `${flying.spinDeg ?? 24}deg`;
    vars["--fly-ms"] = `${flying.durationMs ?? TILE_FLY_MS}ms`;
  } else if (dealing) {
    vars["--card-deal-delay"] = `${dealing.delayMs ?? 0}ms`;
    vars["--card-deal-ms"] = `${dealing.durationMs ?? TILE_DEAL_MS}ms`;
    vars["--card-deal-from-x"] = dealing.fromX ?? "5rem";
    vars["--card-deal-from-y"] = dealing.fromY ?? "-3rem";
    vars["--card-deal-spin"] = `${dealing.spinDeg ?? 10}deg`;
  }

  const style = vars as CSSProperties;

  // An empty slot: the position exists, nothing is in it. A dashed outline rather than a
  // gap, so a board does not reflow as tiles arrive or are cleared.
  if (empty) {
    return (
      <div
        aria-hidden
        // `border-line` here IS correct, unlike on a tile: an empty slot is a hole in
        // the board, which is a surface and does follow the theme.
        className={`${base} rounded-[0.45rem] border-dashed border-line bg-transparent ${fade} ${className}`}
      />
    );
  }

  const content = tile ? (
    <TileFace tile={tile} size={size} />
  ) : (
    <TileBack />
  );

  const shell = [
    base,
    // The body's extrusion and its inset face. `.mahjong-tile` carries the depth for
    // both sides; the face/back classes differ only in the printed surface.
    "mahjong-tile",
    // No `bg-paper` / `border-line` here, deliberately: the body colour and edge come
    // from `.mahjong-tile`'s fixed `--tile-face` / `--tile-edge` in globals.css. Using
    // the theme tokens is what made a tile turn near-black on the dark themes, which is
    // not a dark-mode tile but a different object — see the palette note in globals.css.
    tile ? "mahjong-tile-face" : "mahjong-tile-back",
    // Restates the cast, longer and softer, and raises the tile. It wins the box-shadow
    // by being declared later in globals.css — equal specificity, so source order
    // decides it, not this list's order.
    lifted ? "mahjong-tile-lifted" : "",
    // A warm edge on a tile that is free to pick up. Two cues with `free`, never colour
    // alone: the ring here and the pointer the button already gives.
    // The free ring is suppressed on a hinted tile: two brass edges on one tile is what
    // made the hint impossible to spot.
    free && !hinted ? "ring-1 ring-brass/60" : "",
    // `ring-offset-0`, not `ring-offset-paper`: an offset ring against a fixed-ivory
    // tile would show a band of the *theme's* background and break the object.
    selected ? "ring-2 ring-brass" : "",
    // A hint: a heavy ring plus the wash and pulse from globals.css. Deliberately louder
    // than every other tile state, because it is answering "where do I even look".
    hinted ? "ring-2 ring-brass mahjong-tile-hinted" : "",
    fade,
    flight,
    className,
  ].join(" ");

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={tileLabel(tile)}
        aria-pressed={selected}
        style={style}
        className={`${shell} mahjong-tile-tiltable focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass`}
      >
        {content}
      </button>
    );
  }

  return (
    <div role="img" aria-label={tileLabel(tile)} style={style} className={shell}>
      {content}
    </div>
  );
}

/** Spelled out for a screen reader, which cannot read 東 or a field of canes. */
function tileLabel(tile?: Tile): string {
  if (!tile) return "Face-down tile";
  switch (tile.kind) {
    case "suited":
      return `${tile.rank} of ${SUIT_NAMES[tile.suit]}`;
    case "wind":
      return `${WIND_FACES[tile.wind].name} wind`;
    case "dragon":
      return DRAGON_FACES[tile.dragon].name;
    case "flower":
      return `${FLOWER_FACES[tile.flower].name} flower`;
    case "season":
      return SEASON_FACES[tile.season].name;
  }
}

/**
 * The printed face. One treatment per group of tiles.
 *
 * The explicit `ReactElement` return is what makes the switch exhaustive: without it
 * TypeScript widens the return to include `undefined` and asks for a default branch,
 * which would swallow a new tile kind silently instead of failing the build.
 */
function TileFace({ tile, size }: { tile: Tile; size: MahjongTileSize }): ReactElement {
  const geometry = SIZES[size];

  // `relative z-10`, because the face's carved lip is drawn on the parent's `::before`
  // and would otherwise paint over the artwork.
  const inner = "relative z-10 flex h-full w-full flex-col items-center justify-center";

  switch (tile.kind) {
    case "suited":
      // Bamboo: drawn canes, never a numeral. This is the suit a numeral gets most
      // wrong — 條 means "stick", and a real set prints that many bamboo canes in a
      // conventional arrangement. The 1 is the exception every set makes: a bird.
      if (tile.suit === "bamboo") {
        return (
          <span aria-hidden className={`${inner} ${GREEN}`}>
            <BambooField rank={tile.rank} size={size} />
          </span>
        );
      }
      // Circles: concentric rings in the traditional arrangement, in blue.
      if (tile.suit === "circles") {
        return (
          <span aria-hidden className={`${inner} ${BLUE}`}>
            <CircleField rank={tile.rank} size={size} />
          </span>
        );
      }
      // Characters: a Chinese numeral over 萬, both in red — the proportions a real tile
      // prints them at, with the numeral the larger of the two.
      return (
        <span aria-hidden className={`${inner} ${RED}`}>
          <span className={`font-display leading-none ${geometry.numeral}`}>
            {CHINESE_NUMERALS[tile.rank]}
          </span>
          <span className={`leading-none ${geometry.numeral}`}>萬</span>
        </span>
      );

    case "wind":
      return (
        <span aria-hidden className={`${inner} ${BLUE}`}>
          <span className={`font-display leading-none ${geometry.honour}`}>
            {WIND_FACES[tile.wind].glyph}
          </span>
        </span>
      );

    case "dragon":
      // The white dragon is a blue frame rather than a glyph, as a real set prints it —
      // the tile is otherwise blank. At 48px an empty tile with a rectangle on it is
      // unmistakable, where a lone 白 is just another honour.
      if (tile.dragon === "white") {
        return (
          <span aria-hidden className={`${inner} ${BLUE} p-[20%]`}>
            <span className="h-full w-full rounded-[2px] border-2 border-current" />
          </span>
        );
      }
      return (
        <span aria-hidden className={`${inner} ${DRAGON_FACES[tile.dragon].colour}`}>
          <span className={`font-display leading-none ${geometry.honour}`}>
            {DRAGON_FACES[tile.dragon].glyph}
          </span>
        </span>
      );

    // The bonus tiles: a glyph with the group ordinal in the corner, which is how a set
    // tells the four flowers (and the four seasons) apart. No panel around it — the
    // corner index plus the colour is enough, and a box made them read as a different
    // kind of object entirely.
    case "flower":
      return (
        <BonusFace
          art={FLOWER_FACES[tile.flower].art}
          colour={FLOWER_FACES[tile.flower].colour}
          index={FLOWERS.indexOf(tile.flower) + 1}
          size={size}
        />
      );

    case "season":
      return (
        <BonusFace
          art={SEASON_FACES[tile.season].art}
          colour={SEASON_FACES[tile.season].colour}
          index={SEASONS.indexOf(tile.season) + 1}
          size={size}
        />
      );
  }
}

/**
 * A bonus tile: its drawn artwork, with the group ordinal in the top-left.
 *
 * The ordinal is how a real set tells the four flowers (and the four seasons) apart when
 * the artwork alone is ambiguous at a glance, and it doubles as the number a player calls
 * the tile by. Kept small and cornered so the drawing is the tile and the digit is a mark
 * on it, not a label under a picture.
 */
function BonusFace({
  art: Art,
  colour,
  index,
  size,
}: {
  art: (props: { className?: string }) => ReactElement;
  colour: string;
  index: number;
  size: MahjongTileSize;
}) {
  const geometry = SIZES[size];

  return (
    <span aria-hidden className={`relative z-10 block h-full w-full ${colour}`}>
      <span className={`absolute left-[11%] top-[4%] z-10 leading-none ${geometry.mark}`}>
        {index}
      </span>
      {/* Padded in from the tile edge so the artwork sits inside the carved face panel
          rather than running under its lip. Asymmetric at the top, to clear the ordinal. */}
      <Art className="h-full w-full pb-[10%] pl-[10%] pr-[10%] pt-[16%]" />
    </span>
  );
}

/**
 * The canes of a bamboo tile, in the traditional arrangements.
 *
 * Real layouts rather than a cane count: a 4 is two rows of two, a 6 two rows of three,
 * a 9 three rows of three. The 1 is a bird on every set, so it gets its own mark rather
 * than a lone cane — a single vertical bar would be indistinguishable from a tally mark.
 */
function BambooField({ rank, size }: { rank: TileRank; size: MahjongTileSize }) {
  const geometry = SIZES[size];

  // The 1 of bamboo is a bird. Drawn as a stylised shape rather than a glyph: every set
  // draws a different bird and none of them is a character, so a shape is more faithful
  // than borrowing an unrelated CJK glyph.
  if (rank === 1) {
    return (
      <svg viewBox="0 0 24 32" className="h-full w-full p-[12%]" fill="none">
        <path
          d="M16 8c3 2 3 6 1 9-2 3-6 4-9 3 2 4 5 7 8 8M16 8c-2-2-4-2-6-1"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="15" cy="10" r="1.1" fill="currentColor" />
      </svg>
    );
  }

  return (
    <span
      aria-hidden
      className="flex h-full w-full flex-col items-stretch justify-center gap-[7%] p-[14%]"
    >
      {BAMBOO_ROWS[rank].map((count, row) => (
        <span key={row} className="flex flex-1 items-stretch justify-center gap-[16%]">
          {Array.from({ length: count }, (_, cane) => (
            <Cane key={cane} width={geometry.cane} />
          ))}
        </span>
      ))}
    </span>
  );
}

/** One bamboo cane: a vertical bar with a segment notch, so it reads as a cane. */
function Cane({ width }: { width: string }) {
  return (
    <span className={`relative block rounded-[1px] bg-current ${width}`}>
      {/* The segment line, drawn as a gap in the cane rather than a stroke over it, so
          it survives at every size instead of a hairline vanishing. Its colour is the
          face panel behind it, which is why the panel is a fixed token — a themed one
          would show the wrong notch on half the palettes. */}
      <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-[var(--tile-panel)]" />
    </span>
  );
}

/** The rings of a circles tile, positioned on the traditional lattice. */
function CircleField({ rank, size }: { rank: TileRank; size: MahjongTileSize }) {
  const layout = CIRCLE_LAYOUTS[rank];
  const geometry = SIZES[size];

  return (
    <span aria-hidden className="relative h-full w-full">
      {layout.map(([column, row]) => (
        <span
          key={`${column}-${row}`}
          // A ring rather than a filled disc — a real circles tile is a concentric
          // annulus, and at these sizes the ring is what stops a 9 reading as a grid of
          // full stops.
          className={`absolute rounded-full border-2 border-current ${geometry.pip}`}
          style={{
            // Percentage positions on a 3x3 lattice, each ring centred on its cell.
            // Inline because they are computed from the layout table — Tailwind cannot
            // ship a class for every position, and the halves rule out a class per cell.
            left: `${(column / 2) * 100}%`,
            top: `${(row / 2) * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        />
      ))}
    </span>
  );
}

/**
 * The face-down side: the green backing most sets use.
 *
 * A flat colour with a thin inner keyline rather than a pattern. The colour is the whole
 * signal — a green tile is face-down, an ivory one is face-up, readable at any size and
 * from across a 144-tile board. The card back's brass lattice would be busier and less
 * legible here, and a face-down tile and a face-down card should not look related.
 */
function TileBack() {
  return (
    <span
      aria-hidden
      className="relative z-10 flex h-full w-full items-center justify-center rounded-[0.3rem] p-[7%]"
    >
      <span className="h-full w-full rounded-[2px] border border-white/25" />
    </span>
  );
}
