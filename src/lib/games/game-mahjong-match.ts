import {
  MAHJONG_MATCH_HINT_PENALTY,
  MAHJONG_MATCH_MIN_SCORE,
  MAHJONG_MATCH_SETUP,
  MAHJONG_MATCH_SHUFFLE_PENALTY,
  MAHJONG_MATCH_TIME_PENALTY,
  type BoardTile,
  type MahjongLayoutName,
  type MahjongMatchDifficulty,
  type MahjongMatchState,
  type TilePosition,
} from "./types";
import { buildWall, groupByFace, matches, type Tile } from "./mahjong-tiles";

/**
 * The rules of Mahjong Match, as pure functions over an immutable `MahjongMatchState`.
 *
 * Nothing here touches React, the DOM, a timer or `Math.random` directly — the RNG
 * arrives as an argument, exactly as in `game-2048.ts`, `game-sudoku.ts` and
 * `game-minesweeper.ts`, and the clock arrives as `elapsedSeconds` on the state. That
 * is what lets a test deal a reproducible board and score a "ten minute" clear without
 * waiting ten minutes.
 *
 * Every exported function returns a NEW state and never mutates its argument, so the
 * view can hold one in `useState` and React sees each entry as a change.
 *
 * The tile *set* is not here. `Tile`, the 144 tiles and `matches` come from
 * `mahjong-tiles.ts`, which no game owns — this module knows only where a tile sits and
 * when it can be lifted.
 */

/** A source of randomness in [0, 1). `Math.random` in the app; a stub in tests. */
export type Random = () => number;

/**
 * Half-steps across a tile. A tile spans two of them in each axis.
 *
 * The unit exists so a layout can offset a row or a column by *half* a tile, which the
 * classic turtle does in several places and which integer coordinates cannot express.
 * See `TilePosition`.
 */
export const TILE_SPAN = 2;


/* ---------------------------------------------------------------------------------
   The layouts.

   Coordinate tables rather than generated shapes. A turtle is a specific figure that
   players recognise — the rows are different lengths, the third and fourth layers are
   inset unevenly, and a single tile caps the top. Anything generated from a rule comes
   out as a symmetric pyramid, which is a different game to look at.

   Positions are `[layer, col, row]` in half-steps. Each table's length must be even,
   since tiles are dealt in pairs; `LAYOUTS` is asserted for that in the test.
--------------------------------------------------------------------------------- */

/** The width of the field every layout is centred on, in whole tiles. */
const FIELD_TILES = 12;

/**
 * The easy board: two layers, 72 tiles.
 *
 * A 12x5 field with a small 4x3 patch raised on top of its middle. Deliberately not a
 * turtle — the point of the easy board is that almost nothing is buried, so a beginner
 * learns the blocking rule (a tile is held by its *sides*, not just by what sits above
 * it) on a board where being stuck is nearly impossible. The raised patch is there so
 * the rule is met at all; a single flat rectangle would never exercise it.
 */
const GARDEN: readonly (readonly [number, number, number])[] = [
  ...gridLayer(0, 12, 5, 0, 0),
  // Half-offset from the layer below, for the reason `TURTLE` records: a patch sitting
  // exactly on the grid buries single tiles and can leave a final pair unreachable.
  ...gridLayer(1, 4, 3, 4, 1, 1),
];

/**
 * The classic turtle: 144 tiles across five layers.
 *
 * The real figure, not a pyramid. Layer 0 is the shell — eight rows of uneven width
 * (12, 8, 10, 12, 12, 10, 8, 12) centred on a 12-tile field, giving the waisted outline
 * the shape is known for. Layers 1 to 3 step inward as the dome, and layer 4 is the
 * single cap tile.
 *
 * The three tiles beyond the shell on layer 0 are the head (one tile, left) and the
 * tail (two tiles, right), level with the middle rows. They are what make the figure
 * read as an animal rather than a mound, and they are also why `boardBounds` computes
 * the extent rather than assuming a zero origin — the head sits at a negative `col`.
 *
 * The counts are load-bearing: 84 shell + 3 head/tail + 36 + 16 + 4 + 1 = 144, exactly
 * one full tile set. The test asserts the total and that no two positions coincide.
 */
const TURTLE: readonly (readonly [number, number, number])[] = [
  // Layer 0 — the shell, each row centred on the 12-tile field.
  ...shellRow(0, 12),
  ...shellRow(1, 8),
  ...shellRow(2, 10),
  ...shellRow(3, 12),
  ...shellRow(4, 12),
  ...shellRow(5, 10),
  ...shellRow(6, 8),
  ...shellRow(7, 12),
  // The head, one tile off the left flank, level with row 3.
  [0, -TILE_SPAN, 3 * TILE_SPAN],
  // The tail, two tiles off the right flank. The field ends at col 22, so these
  // continue it.
  [0, FIELD_TILES * TILE_SPAN, 3 * TILE_SPAN],
  [0, (FIELD_TILES + 1) * TILE_SPAN, 3 * TILE_SPAN],
  // Layers 1-3, each a rectangle inset from the one below and offset half a tile from
  // it. The half-step offsets are the load-bearing part, not decoration: with every
  // layer on the same grid, an upper tile sits *exactly* on one lower tile and buries
  // it permanently — and the endgame can then reach two tiles in one column where the
  // buried one could only ever pair with the tile burying it. Offsetting means an upper
  // tile straddles four below, so no tile is ever held by exactly one other.
  ...gridLayer(1, 6, 6, 3, 1, 1),
  ...gridLayer(2, 4, 4, 4, 2, 0),
  ...gridLayer(3, 2, 2, 5, 3, 1),
  // The cap, straddling layer 3's four tiles (cols 11-13, rows 7-9).
  [4, 12, 8],
];

/**
 * A stepped pyramid: 84 + 36 + 16 + 4 + 4 = 144.
 *
 * The plainest of the figures on purpose — it is the one board where the whole stack is
 * legible at a glance, so a player learning which tiles are buried can see the answer.
 * Every layer is half-offset from the one below, so no tile is held by exactly one other
 * (see the note in `TURTLE` for why that matters).
 */
const PYRAMID: readonly (readonly [number, number, number])[] = [
  ...gridLayer(0, 12, 7, 0, 0),
  ...gridLayer(1, 6, 6, 3, 0, 1),
  ...gridLayer(2, 4, 4, 4, 1, 0),
  ...gridLayer(3, 2, 2, 5, 2, 1),
  ...gridLayer(4, 2, 2, 5, 2, 0),
];

/**
 * A sitting cat: 86 + 40 + 14 + 4 = 144.
 *
 * A silhouette rather than a mound — the head and ears at the top, a widening body, and
 * a tail curling up the right-hand side. The dome sits on the body only, which is what
 * keeps the outline readable: covering the head would turn the figure back into a blob.
 *
 * The ears sit at a negative row and the tail past the body's right edge, so this is the
 * second layout after `TURTLE` that relies on `boardBounds` computing the extent rather
 * than assuming a zero origin.
 */
const CAT: readonly (readonly [number, number, number])[] = [
  // The silhouette, row by row: head, shoulders, body, haunches.
  ...shellRow(0, 4, 5),
  ...shellRow(1, 6, 4),
  ...shellRow(2, 6, 4),
  ...shellRow(3, 10, 2),
  ...shellRow(4, 12, 1),
  ...shellRow(5, 12, 1),
  ...shellRow(6, 12, 1),
  ...shellRow(7, 10, 2),
  ...shellRow(8, 8, 3),
  // The two ears, a row above the head.
  [0, 4 * TILE_SPAN, -TILE_SPAN],
  [0, 9 * TILE_SPAN, -TILE_SPAN],
  // The tail, curling up the right flank.
  [0, 13 * TILE_SPAN, 8 * TILE_SPAN],
  [0, 14 * TILE_SPAN, 8 * TILE_SPAN],
  [0, 14 * TILE_SPAN, 7 * TILE_SPAN],
  [0, 14 * TILE_SPAN, 6 * TILE_SPAN],
  // The dome, on the body and clear of the head.
  ...gridLayer(1, 10, 4, 1, 4, 1),
  ...gridLayer(2, 7, 2, 3, 5, 0),
  ...gridLayer(3, 4, 1, 5, 6, 1),
];

/**
 * A thick cross: 72 + 44 + 20 + 8 = 144.
 *
 * Two short arms above and below a long horizontal bar. The bar carries the whole stack,
 * so the arms stay one tile deep and are cleared early — which makes this the fastest of
 * the figures to open up, and the one where the endgame is a single tall ridge.
 */
const CROSS: readonly (readonly [number, number, number])[] = [
  ...gridLayer(0, 4, 3, 4, 0),
  ...gridLayer(0, 12, 4, 0, 3),
  ...gridLayer(0, 4, 3, 4, 7),
  ...gridLayer(1, 11, 4, 0, 3, 1),
  ...gridLayer(2, 10, 2, 1, 4, 0),
  ...gridLayer(3, 8, 1, 2, 5, 1),
];

/**
 * A butterfly: 86 + 38 + 16 + 4 = 144.
 *
 * Two wing masses either side of a narrow body, with a notch between the upper and lower
 * wing on each side. The notch is the interesting part: it splits each wing into two
 * pools that open independently, so the board plays as four small puzzles plus a spine
 * rather than as one mass.
 *
 * The upper layers are confined to the wing halves and deliberately do **not** span the
 * notch — a block laid across it would have nothing beneath its middle, and a tile with
 * no support under it is a floating tile.
 */
const BUTTERFLY: readonly (readonly [number, number, number])[] = [
  ...butterflyWing(0),
  ...butterflyWing(9),
  // The body, a two-wide column down the middle.
  ...gridLayer(0, 2, 9, 6, 0),
  // Wing domes, each sitting on one half of one wing, clear of the row-4 notch.
  ...gridLayer(1, 4, 2, 1, 1, 1),
  ...gridLayer(1, 4, 2, 1, 6, 1),
  ...gridLayer(1, 4, 2, 10, 1, 1),
  ...gridLayer(1, 4, 2, 10, 6, 1),
  ...gridLayer(1, 2, 3, 6, 1, 1),
  ...gridLayer(2, 3, 1, 2, 1, 0),
  ...gridLayer(2, 3, 1, 11, 1, 0),
  ...gridLayer(2, 3, 1, 2, 6, 0),
  ...gridLayer(2, 3, 1, 11, 6, 0),
  ...gridLayer(2, 2, 2, 6, 2, 0),
  ...gridLayer(3, 1, 2, 6, 2, 1),
  ...gridLayer(3, 2, 1, 2, 1, 1),
];

/**
 * One wing of the butterfly, offset `colOffset` tiles from the left.
 *
 * Row 4 is deliberately empty — that gap is the notch between the upper and lower wing,
 * and it is what gives the figure its shape rather than making it an oval.
 */
function butterflyWing(
  colOffset: number,
): readonly (readonly [number, number, number])[] {
  const shape: readonly (readonly [number, number, number])[] = [
    [0, 3, 1],
    [1, 5, 0],
    [2, 5, 0],
    [3, 4, 0],
    // row 4: the notch.
    [5, 4, 0],
    [6, 5, 0],
    [7, 5, 0],
    [8, 3, 1],
  ];
  const out: (readonly [number, number, number])[] = [];
  for (const [rowIndex, count, inset] of shape) {
    for (let i = 0; i < count; i += 1) {
      out.push([0, (colOffset + inset + i) * TILE_SPAN, rowIndex * TILE_SPAN]);
    }
  }
  return out;
}

/** A horizontal run of `count` tiles on `layer` at `rowIndex`, centred on the field. */
function shellRow(
  rowIndex: number,
  count: number,
  indent = (FIELD_TILES - count) / 2,
): readonly (readonly [number, number, number])[] {
  const out: (readonly [number, number, number])[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push([0, (indent + i) * TILE_SPAN, rowIndex * TILE_SPAN]);
  }
  return out;
}

/**
 * A `cols` x `rows` rectangle on `layer`, offset by `colOffset`/`rowOffset` whole tiles.
 *
 * `half` adds a further half-tile in both axes — 1 for a layer that should straddle the
 * one below it, 0 for one that sits on the same grid. See the note in `TURTLE` for why
 * the alternation matters to whether the game can dead-end.
 */
function gridLayer(
  layer: number,
  cols: number,
  rows: number,
  colOffset: number,
  rowOffset: number,
  half = 0,
): readonly (readonly [number, number, number])[] {
  const out: (readonly [number, number, number])[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      out.push([layer, (colOffset + c) * TILE_SPAN + half, (rowOffset + r) * TILE_SPAN + half]);
    }
  }
  return out;
}

/** The coordinate table per layout name. */
const LAYOUTS: Record<MahjongLayoutName, readonly (readonly [number, number, number])[]> = {
  garden: GARDEN,
  turtle: TURTLE,
  pyramid: PYRAMID,
  cat: CAT,
  cross: CROSS,
  butterfly: BUTTERFLY,
};

/** Every layout name, for a view offering a board picker. */
export const MAHJONG_LAYOUTS = Object.keys(LAYOUTS) as readonly MahjongLayoutName[];

/** The positions of `layout`, as `TilePosition` values. */
export function layoutPositions(layout: MahjongLayoutName): readonly TilePosition[] {
  return LAYOUTS[layout].map(([layer, col, rowIndex]) => ({ layer, col, row: rowIndex }));
}

/* ---------------------------------------------------------------------------------
   Freedom — the one rule the whole game turns on.
--------------------------------------------------------------------------------- */

/** Whether two positions overlap in the horizontal axis. Half-step spans, so `< 2` apart. */
function overlapsCol(a: TilePosition, b: TilePosition): boolean {
  return Math.abs(a.col - b.col) < TILE_SPAN;
}

/** Whether two positions overlap in the vertical axis. */
function overlapsRow(a: TilePosition, b: TilePosition): boolean {
  return Math.abs(a.row - b.row) < TILE_SPAN;
}

/**
 * Whether the tile at `index` can be lifted.
 *
 * The classic rule, and it is two conditions, not one:
 *
 *   1. **Nothing on top.** No uncleared tile on a higher layer overlaps it in both
 *      axes. Note *overlaps*, not "sits at the same coordinates" — the layers are
 *      offset, so one tile above can rest across two below and hold them both.
 *   2. **A free long side.** Its left or its right neighbour on the same layer must be
 *      gone. A tile with tiles on both sides is pinned even with a clear top, because
 *      it slides out sideways rather than lifting straight up.
 *
 * Condition 2 is the one that is easy to miss and the reason a random deal can be
 * unsolvable — see `deal`. A tile blocked only above becomes free as the board comes
 * down; a tile pinned between two others of the same face can deadlock permanently.
 *
 * A cleared tile is never free: there is nothing to lift.
 */
export function isFree(state: MahjongMatchState, index: number): boolean {
  const target = state.tiles[index];
  if (!target || target.cleared) return false;

  let blockedLeft = false;
  let blockedRight = false;

  for (const other of state.tiles) {
    if (other.cleared || other === target) continue;
    const { position: p } = other;
    const { position: t } = target;

    // Above and overlapping in both axes — the tile is buried.
    if (p.layer > t.layer && overlapsCol(p, t) && overlapsRow(p, t)) return false;

    // Beside it on the same layer: touching in the vertical axis, exactly one tile
    // away horizontally. `=== TILE_SPAN` rather than `<=`, so a tile half-offset above
    // or below on the same layer does not count as a side neighbour — it overlaps
    // rather than abuts, and a layout that produced one would be malformed.
    if (p.layer === t.layer && overlapsRow(p, t)) {
      if (p.col === t.col - TILE_SPAN) blockedLeft = true;
      else if (p.col === t.col + TILE_SPAN) blockedRight = true;
    }
  }

  return !(blockedLeft && blockedRight);
}

/** The indexes of every tile that can currently be lifted. */
export function freeTiles(state: MahjongMatchState): readonly number[] {
  const out: number[] = [];
  for (let index = 0; index < state.tiles.length; index += 1) {
    if (isFree(state, index)) out.push(index);
  }
  return out;
}

/**
 * A liftable matching pair, or `undefined` when none exists.
 *
 * Used both by `hintPair` and by the stuck test, which is why it returns the pair
 * rather than a boolean — "is there a move" and "show me one" are the same search, and
 * running it twice for two answers would be the same work done differently.
 */
export function findPair(state: MahjongMatchState): readonly [number, number] | undefined {
  const free = freeTiles(state);

  for (let i = 0; i < free.length; i += 1) {
    for (let j = i + 1; j < free.length; j += 1) {
      if (matches(state.tiles[free[i]].tile, state.tiles[free[j]].tile)) {
        return [free[i], free[j]];
      }
    }
  }
  return undefined;
}

/** Whether any legal move remains. */
export function hasMove(state: MahjongMatchState): boolean {
  return findPair(state) !== undefined;
}

/** Tiles still on the board. */
export function tilesLeft(state: MahjongMatchState): number {
  return state.tiles.reduce((count, entry) => (entry.cleared ? count : count + 1), 0);
}

/**
 * Whether the board may be re-dealt.
 *
 * True for any run still in progress: shuffles are unlimited, and their price is what
 * rations them (see `MAHJONG_MATCH_SHUFFLE_PENALTY`). A finished board is the only
 * refusal — re-dealing a win would let a player bank a score and then keep playing.
 *
 * Kept as a function rather than inlining `outcome !== "cleared"` at the two call sites,
 * so the view and `reshuffle` cannot drift apart on what "can shuffle" means.
 */
export function canShuffle(state: MahjongMatchState): boolean {
  return state.outcome !== "cleared";
}

/* ---------------------------------------------------------------------------------
   Dealing — solvable by construction.
--------------------------------------------------------------------------------- */

/**
 * Deals `faces` onto `positions` so the board opens up as it is played.
 *
 * Dealt **backwards**: starting from the full layout, repeatedly take two positions that
 * are free *at that moment*, give them a matching pair of faces, and mark them gone.
 * Replaying those assignments in reverse is a complete solution, so the board can always
 * be cleared — and, more importantly for how it feels to play, matching pairs are spread
 * across positions that become reachable together rather than scattered at random.
 *
 * This was briefly a plain random deal, on the reasoning that unlimited shuffles make a
 * dead board harmless. Measured, that was wrong: a random turtle needed **~17 shuffles**
 * on average to clear, because free tiles kept having no free partner. A board that
 * demands a shuffle every few pairs is not a puzzle, it is a slot machine. Dealing
 * backwards brings that to nearly zero while costing one freedom scan per pair.
 *
 * Shuffles remain unlimited regardless: a player who takes pairs in a different order
 * than the deal assumed can still strand themselves, and the aid is what rescues that.
 * The two are complements — this makes a good board, the shuffle handles a bad line of
 * play.
 *
 * Falls back to filling any leftover positions in order if the free-pair search dries up
 * early. Unreachable for the shipped layouts, but a malformed one should produce a
 * playable board rather than throw.
 */
function deal(
  positions: readonly TilePosition[],
  faces: readonly Tile[],
  random: Random,
): readonly BoardTile[] {
  const assigned = new Array<Tile | undefined>(positions.length).fill(undefined);
  // `open` is which positions are still notionally on the board as pairs are peeled
  // off. It shrinks exactly as a real board would while being cleared.
  const open = new Set<number>(positions.map((_, index) => index));
  let next = 0;

  while (open.size >= 2 && next + 1 < faces.length) {
    const free = freePositions(positions, open);
    if (free.length < 2) break;

    // Two distinct free positions. The second draw is over the remaining ones, so a
    // position cannot be chosen twice.
    const first = free[Math.floor(random() * free.length)];
    const rest = free.filter((index) => index !== first);
    const second = rest[Math.floor(random() * rest.length)];

    // The faces come from an already-shuffled list, taken in order. Drawing the
    // *positions* at random and the *faces* in order is deliberate: randomising both
    // biases the early picks toward the outside of the board and leaves the centre
    // stacked with one suit.
    assigned[first] = faces[next];
    assigned[second] = faces[next + 1];
    next += 2;
    open.delete(first);
    open.delete(second);
  }

  for (let index = 0; index < positions.length; index += 1) {
    if (!assigned[index]) {
      assigned[index] = faces[next % faces.length];
      next += 1;
    }
  }

  return positions.map((position, index) => ({
    tile: assigned[index] as Tile,
    position,
    cleared: false,
  }));
}

/**
 * Which of the still-open positions are free, by the same rule `isFree` applies.
 *
 * Duplicated rather than sharing `isFree`, because `isFree` reads a `MahjongMatchState`
 * and the dealer has no state yet — it is deciding what the state will be. Building a
 * throwaway state per pair (72 of them, each 144 tiles) to reuse one function would cost
 * more than the twenty lines it saves. The two must stay in step, which is why the test
 * checks a dealt board against `isFree` rather than against this.
 */
function freePositions(
  positions: readonly TilePosition[],
  open: ReadonlySet<number>,
): readonly number[] {
  const out: number[] = [];

  for (const index of open) {
    const target = positions[index];
    let blockedLeft = false;
    let blockedRight = false;
    let buried = false;

    for (const other of open) {
      if (other === index) continue;
      const q = positions[other];

      if (q.layer > target.layer && overlapsCol(q, target) && overlapsRow(q, target)) {
        buried = true;
        break;
      }
      if (q.layer === target.layer && overlapsRow(q, target)) {
        if (q.col === target.col - TILE_SPAN) blockedLeft = true;
        else if (q.col === target.col + TILE_SPAN) blockedRight = true;
      }
    }

    if (!buried && !(blockedLeft && blockedRight)) out.push(index);
  }
  return out;
}

/**
 * A pairable set of faces for `count` tiles, ordered so `[0]` pairs with `[1]`.
 *
 * Built from `buildWall`, so the faces are the real 144-tile set rather than an
 * invented multiset. Two constraints the deal depends on: the length is exactly
 * `count`, and every face appears an even number of times — an odd count would leave
 * one tile with no possible partner and a board that cannot be finished.
 *
 * The bonus tiles are the wrinkle. There is one of each flower and season, so they
 * cannot be paired by face — but `matches` pairs any flower with any flower, so the
 * eight of them form four pairs as a group. They are therefore taken all-or-nothing:
 * either the full eight are in, or none are.
 */
export function faceSet(count: number, random: Random): readonly Tile[] {
  if (count % 2 !== 0) throw new Error(`a board needs an even tile count, got ${count}`);

  const wall = buildWall();
  const bonus = wall.filter((tile) => tile.kind === "flower" || tile.kind === "season");
  const plain = wall.filter((tile) => tile.kind !== "flower" && tile.kind !== "season");

  const out: Tile[] = [];

  // The bonus eight go in first when the board is big enough to hold them, so a full
  // turtle always includes the flowers and seasons a real set has. All-or-nothing: they
  // pair as a group of eight, so a partial handful could strand one.
  if (count >= bonus.length + 2) out.push(...bonus);

  // Then whole *faces*, two tiles at a time.
  //
  // Grouping by face first is the point, and getting this wrong is subtle: shuffling the
  // 136 plain tiles and taking them two-at-a-time looks like it deals pairs, but two
  // adjacent entries in a shuffled list are two *different* faces — so truncating to
  // `count` would leave the last few faces with one tile each and no possible partner.
  // Selecting a face and emitting two copies of it keeps every count even by
  // construction, whatever `count` is.
  // `groupByFace` from `mahjong-tiles.ts` rather than a local key builder: the face
  // identity of a tile is the tile set's business, and a second implementation here
  // would be one to keep in step with `matches`.
  const byFace = groupByFace(plain);

  // Each face contributes up to two pairs (a set holds four of each). Shuffled, so a
  // smaller board is a random subset of the tile set rather than always the low ranks of
  // the first suit.
  const pairs: Tile[][] = [];
  for (const group of byFace.values()) {
    for (let i = 0; i + 1 < group.length; i += 2) {
      pairs.push([group[i], group[i + 1]]);
    }
  }

  for (const pair of shufflePairs(pairs, random)) {
    if (out.length + 2 > count) break;
    out.push(...pair);
  }

  // Returned **pair-adjacent**, NOT shuffled: `out[0]` matches `out[1]`, `out[2]`
  // matches `out[3]`, and so on. `deal` relies on exactly that, taking two faces at a
  // time and seating them on two positions it has proven mutually reachable.
  //
  // A final `shuffleTiles` here is the bug this comment exists to prevent, and it is not
  // hypothetical — it shipped that way for an afternoon. Shuffling destroys the
  // adjacency, so the dealer seats two *unrelated* faces on each reachable pair of
  // positions, and the board's solvability guarantee silently evaporates: measured, one
  // pair in 36 still matched by luck. Randomness comes from `shufflePairs` above (which
  // order the pairs go down in) and from the positions `deal` picks — the faces within a
  // pair must stay together.
  //
  // The bonus tiles are the one wrinkle: they were pushed as a block of eight, so they
  // are adjacent as flower-flower-flower-flower-season-season-season-season, which pairs
  // correctly under `matches` because any flower matches any flower.
  return out;
}

/** Fisher-Yates over the pair buckets, so whole pairs are chosen rather than tiles. */
function shufflePairs(pairs: readonly Tile[][], random: Random): Tile[][] {
  const out = pairs.map((pair) => [...pair]);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Fisher-Yates over a tile list. Local, so the module owns its own shuffling. */
function shuffleTiles(tiles: readonly Tile[], random: Random): Tile[] {
  const out = [...tiles];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A fresh board at `difficulty`.
 *
 * Takes an RNG, unlike Minesweeper's `startGame`: a mahjong board is random from the
 * first frame, with nothing like a safe opening click to defer it to. That means the
 * view must seed it in a mount effect rather than during render, or the server and the
 * client deal different boards and React reports a hydration mismatch — the same
 * constraint `game-sudoku.ts` carries, and for the same reason.
 *
 * `figure` picks the shape — turtle, pyramid, cat, cross or butterfly. All of them are
 * the same 144 tiles, so the shape is independent of the difficulty and does not change
 * what a clear is worth; see `MAHJONG_FIGURES`.
 */
export function startGame(
  difficulty: MahjongMatchDifficulty,
  random: Random,
  figure?: MahjongLayoutName,
): MahjongMatchState {
  // The figure is optional and defaults to the difficulty's own layout, so every
  // existing call site keeps working and a caller that does not care about the shape
  // does not have to name one. `easy` ignores a figure it is passed: its board is 72
  // tiles, and a 144-tile shape would quietly change what that difficulty means.
  const layout =
    difficulty === "easy" ? MAHJONG_MATCH_SETUP.easy.layout : figure ?? MAHJONG_MATCH_SETUP[difficulty].layout;
  const positions = layoutPositions(layout);

  return {
    difficulty,
    tiles: deal(positions, faceSet(positions.length, random), random),
    selected: undefined,
    pairsCleared: 0,
    hints: 0,
    shuffles: 0,
    history: [],
    elapsedSeconds: 0,
    outcome: undefined,
  };
}

/* ---------------------------------------------------------------------------------
   Playing.
--------------------------------------------------------------------------------- */

/**
 * Taps the tile at `index`.
 *
 * Four outcomes, in the order they are tested:
 *   - the tile is not free (or the run is over) — nothing happens at all, deliberately.
 *     A tap on a buried tile is a misread of the board, not a move, and there is no
 *     penalty for it: unlike Arrow Clearing, looking is the whole game here.
 *   - nothing is selected — this tile becomes the selection.
 *   - the same tile is tapped again — the selection is cleared, so a tap is its own undo.
 *   - a second tile is tapped — it pairs if the faces match, and otherwise *becomes* the
 *     new selection rather than clearing it. That last part matters: tapping around the
 *     board looking for a partner should not need a deselect tap between each one.
 */
export function selectTile(state: MahjongMatchState, index: number): MahjongMatchState {
  if (state.outcome !== undefined) return state;
  if (!isFree(state, index)) return state;

  if (state.selected === undefined) return { ...state, selected: index };
  if (state.selected === index) return { ...state, selected: undefined };

  const first = state.tiles[state.selected];
  const second = state.tiles[index];

  if (!matches(first.tile, second.tile)) return { ...state, selected: index };

  const pair: readonly [number, number] = [state.selected, index];
  const tiles = state.tiles.map((entry, at) =>
    at === pair[0] || at === pair[1] ? { ...entry, cleared: true } : entry,
  );
  const next: MahjongMatchState = {
    ...state,
    tiles,
    selected: undefined,
    pairsCleared: state.pairsCleared + 1,
    history: [...state.history, pair],
  };

  return { ...next, outcome: outcomeOf(next) };
}

/**
 * The run's outcome for a state that has just changed.
 *
 * An empty board is a win, and nothing else ends a run: with unlimited shuffles a board
 * with no legal move is a prompt to shuffle rather than a defeat. `hasMove` is still
 * exported for the view, which uses it to tell the player the board is dead and to draw
 * attention to the Shuffle button — a nudge, not an ending.
 */
function outcomeOf(state: MahjongMatchState): MahjongMatchState["outcome"] {
  return tilesLeft(state) === 0 ? "cleared" : undefined;
}

/**
 * Reveals a matching pair, at a cost.
 *
 * Returns the state with `hints` incremented; the *pair itself* is not stored on the
 * state. The view calls `findPair` for the indexes to highlight, because a highlight is
 * transient view business — persisting it would mean deciding when it expires, and the
 * state would carry a field only one component ever reads.
 *
 * Counted even when the board has no pair to show, which cannot happen in practice
 * (a board with no pair is already `stuck`) but would otherwise make a hint free at
 * exactly the moment it is worthless.
 */
export function takeHint(state: MahjongMatchState): MahjongMatchState {
  if (state.outcome !== undefined) return state;
  return { ...state, hints: state.hints + 1 };
}

/**
 * Takes back the last cleared pair.
 *
 * Free, deliberately — the time penalty already prices it, and a run that ends because
 * of a mis-tap on a crowded board is a frustration rather than a difficulty. It also
 * clears a `stuck` outcome, which is the case that matters most: undoing into a live
 * board is exactly the recovery a player reaches for.
 *
 * `pairsCleared` comes back down with it, so the progress readout and the score both
 * reflect the board as it now stands rather than as it briefly was.
 */
export function undo(state: MahjongMatchState): MahjongMatchState {
  if (state.history.length === 0) return state;
  // A finished board stays finished. Undoing a win would let a player bank a score and
  // then keep playing, and `cleared` is what the view has already scored.
  if (state.outcome === "cleared") return state;

  const pair = state.history[state.history.length - 1];
  const tiles = state.tiles.map((entry, at) =>
    at === pair[0] || at === pair[1] ? { ...entry, cleared: false } : entry,
  );

  return {
    ...state,
    tiles,
    selected: undefined,
    pairsCleared: state.pairsCleared - 1,
    history: state.history.slice(0, -1),
    outcome: undefined,
  };
}

/**
 * Re-deals the tiles still on the board, keeping the positions.
 *
 * The rescue for a dead board, and the reason the deal itself needs no solvability
 * guarantee. Unlimited, so a player can always keep going; each one costs
 * `MAHJONG_MATCH_SHUFFLE_PENALTY`, which is what stops it being free.
 *
 * A re-deal goes through the same backwards dealer a fresh board does, so the result is
 * clearable from where the player now stands rather than merely different. That is what
 * makes this a rescue: a board that had no matching free pair comes back with its pairs
 * laid out along positions that open up together.
 *
 * History is cleared. The undo stack refers to positions whose faces have just changed,
 * so replaying it would restore tiles that are no longer the ones that were lifted —
 * and a shuffle is a deliberate reset, not a move to walk back.
 */
export function reshuffle(state: MahjongMatchState, random: Random): MahjongMatchState {
  if (!canShuffle(state)) return state;

  const slots: number[] = [];
  state.tiles.forEach((entry, index) => {
    if (!entry.cleared) slots.push(index);
  });
  // An odd remainder cannot be paired and should be impossible: tiles leave two at a
  // time. Returning unchanged rather than throwing keeps a corrupt state playable.
  if (slots.length % 2 !== 0) return state;

  const positions = slots.map((index) => state.tiles[index].position);
  const faces = slots.map((index) => state.tiles[index].tile);

  // Re-dealt through the same backwards dealer as a fresh board, so a shuffle produces a
  // board as good as a new one rather than a re-roll of the dice. Dealing the *remaining*
  // positions means it works just as well ten pairs from the end as at the start.
  const dealt = deal(positions, shuffleTiles(faces, random), random);

  // Rebuild the full array, leaving the cleared entries alone — `tiles` indexes are React
  // keys and must not move.
  const faceBySlot = new Map(slots.map((index, at) => [index, dealt[at].tile]));
  const tiles = state.tiles.map((entry, index) => {
    const face = faceBySlot.get(index);
    return face ? { ...entry, tile: face } : entry;
  });

  const next: MahjongMatchState = {
    ...state,
    tiles,
    selected: undefined,
    shuffles: state.shuffles + 1,
    history: [],
  };

  return { ...next, outcome: outcomeOf(next) };
}

/** One second of clock. The view calls this on an interval; a test sets the field. */
export function tick(state: MahjongMatchState): MahjongMatchState {
  if (state.outcome !== undefined) return state;
  return { ...state, elapsedSeconds: state.elapsedSeconds + 1 };
}

/**
 * What a finished run scores.
 *
 * Only a full clear scores. A stuck or abandoned board records 0, the same rule Sudoku
 * applies to an unfinished puzzle and Minesweeper to a hit mine — a partial board is
 * not a result.
 *
 * Base for the difficulty, less the clock, less what the aids cost. Floored at
 * `MAHJONG_MATCH_MIN_SCORE` so a long, hint-heavy clear still banks something rather
 * than going negative and reading as never having finished.
 */
export function scoreGame(state: MahjongMatchState): number {
  if (state.outcome !== "cleared") return 0;

  const { base } = MAHJONG_MATCH_SETUP[state.difficulty];
  const earned =
    base -
    state.elapsedSeconds * MAHJONG_MATCH_TIME_PENALTY -
    state.hints * MAHJONG_MATCH_HINT_PENALTY -
    state.shuffles * MAHJONG_MATCH_SHUFFLE_PENALTY;

  return Math.max(MAHJONG_MATCH_MIN_SCORE, earned);
}

/**
 * The board sorted for painting: bottom layer first, then back to front.
 *
 * A render concern that lives here because it is derived from the geometry, and because
 * getting it wrong is a real bug rather than a cosmetic one — a tile painted before the
 * one it rests on appears to be underneath it. Row before column within a layer, so a
 * tile's own shadow falls on the tile behind and to its left, which is the direction
 * `.mahjong-tile`'s extrusion already lights.
 */
export function paintOrder(state: MahjongMatchState): readonly number[] {
  return state.tiles
    .map((_, index) => index)
    .sort((a, b) => {
      const p = state.tiles[a].position;
      const q = state.tiles[b].position;
      return p.layer - q.layer || p.row - q.row || p.col - q.col;
    });
}

/**
 * The board's extent in half-steps, for a view sizing its own canvas.
 *
 * Computed from the layout rather than hardcoded per board, so the turtle's head and
 * tail (which stick out past the shell at negative `col`) are inside the bounds. A view
 * that assumed a zero origin would clip the head.
 */
export function boardBounds(state: MahjongMatchState): {
  minCol: number;
  minRow: number;
  cols: number;
  rows: number;
  layers: number;
} {
  const cols = state.tiles.map((entry) => entry.position.col);
  const rows = state.tiles.map((entry) => entry.position.row);
  const minCol = Math.min(...cols);
  const minRow = Math.min(...rows);

  return {
    minCol,
    minRow,
    cols: Math.max(...cols) - minCol + TILE_SPAN,
    rows: Math.max(...rows) - minRow + TILE_SPAN,
    layers: Math.max(...state.tiles.map((entry) => entry.position.layer)) + 1,
  };
}
