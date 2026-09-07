/**
 * A box of mahjong tiles, and the operations any tile game needs from one.
 *
 * **Game-agnostic on purpose**, the same split `playing-cards.ts` makes and for the
 * same reason. Nothing here knows what a tile is *worth*: a red dragon is a scoring
 * triplet in Hong Kong mahjong, a wildcard under some house rules, and just another
 * pair in tile-matching solitaire. What a *set* is — the 144 tiles, their order, how to
 * shuffle, deal and pair them — is all that lives here.
 *
 * That is what makes a second tile game cheap, and what lets `MahjongTile` and
 * `MahjongWall` in `src/components/` be genuinely reusable rather than only look it.
 *
 * Deliberately parallel to `playing-cards.ts`: the same id-for-React-keys convention,
 * the same `Random` type, the same immutable `draw`. A reader who knows the deck
 * already knows this module.
 */

/**
 * The three numbered suits, each running 1-9.
 *
 * `bamboo` is the "sticks" suit and `circles` the "dots"; `characters` is the
 * ten-thousands suit, drawn with the 萬 mark. English identifiers because every
 * identifier in this codebase is English — the glyphs live in the component that draws
 * them, not in the type.
 */
export const TILE_SUITS = ["bamboo", "circles", "characters"] as const;

export type TileSuit = (typeof TILE_SUITS)[number];

/**
 * The nine ranks in each numbered suit.
 *
 * Numbers here, unlike a card's `Rank`, which is a string. A card's rank is not its
 * value — an ace is 1 or 11 — but a 3 of circles is a 3 in every mahjong variant, and
 * runs are built by arithmetic on it. So the type that makes runs easy is the right one.
 */
export const TILE_RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export type TileRank = (typeof TILE_RANKS)[number];

/**
 * The four winds, in the conventional seat order.
 *
 * The order matters and is deliberately not alphabetical: it is the order the seats
 * rotate, so a game dealing or rotating seats can walk this array directly.
 */
export const WINDS = ["east", "south", "west", "north"] as const;

export type Wind = (typeof WINDS)[number];

/** The three dragons. The white dragon is the blank-framed tile. */
export const DRAGONS = ["red", "green", "white"] as const;

export type Dragon = (typeof DRAGONS)[number];

/** The four flowers. A bonus group: one of each, never four of a kind. */
export const FLOWERS = ["plum", "orchid", "chrysanthemum", "bamboo"] as const;

export type Flower = (typeof FLOWERS)[number];

/** The four seasons. The other bonus group, also one of each. */
export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;

export type Season = (typeof SEASONS)[number];

/**
 * One tile.
 *
 * A discriminated union on `kind` rather than one wide interface with optional fields,
 * because the groups genuinely carry different data: a suited tile has a rank and a
 * suit, a wind has neither. The union is what makes `tile.rank` a compile error on a
 * dragon instead of a silent `undefined` at runtime.
 *
 * `id` exists for the reason `Card.id` does: a set holds four identical 3-of-circles,
 * and React needs a stable key per rendered tile. Assigned when the set is built and
 * carried unchanged from wall to hand to discard, so the key survives a tile being drawn.
 */
export type Tile =
  | { id: number; kind: "suited"; suit: TileSuit; rank: TileRank }
  | { id: number; kind: "wind"; wind: Wind }
  | { id: number; kind: "dragon"; dragon: Dragon }
  | { id: number; kind: "flower"; flower: Flower }
  | { id: number; kind: "season"; season: Season };

export type TileKind = Tile["kind"];

/** How many copies of each non-bonus tile a set holds. */
export const COPIES_PER_TILE = 4;

/** The 34 distinct non-bonus tiles: 27 suited (3 suits x 9 ranks) plus 7 honours (4 winds + 3 dragons). */
export const DISTINCT_TILES = TILE_SUITS.length * TILE_RANKS.length + WINDS.length + DRAGONS.length;

/** The 8 bonus tiles — 4 flowers and 4 seasons, one of each. */
export const BONUS_TILES = FLOWERS.length + SEASONS.length;

/**
 * Tiles in a full set: 136 + 8 bonus = 144.
 *
 * The full set including flowers and seasons, which is what a physical box holds. A
 * game playing the 136-tile set filters the bonuses out rather than building a
 * different wall — `buildWall` takes a flag for exactly that.
 */
export const TILES_IN_SET = DISTINCT_TILES * COPIES_PER_TILE + BONUS_TILES;

/** The honour kinds — winds and dragons. Neither has a rank. */
export const HONOUR_KINDS: readonly TileKind[] = ["wind", "dragon"];

/** The bonus kinds — flowers and seasons. One of each, and they never form a set. */
export const BONUS_KINDS: readonly TileKind[] = ["flower", "season"];

/** Whether a tile is an honour — a wind or a dragon. */
export function isHonour(tile: Tile): boolean {
  return HONOUR_KINDS.includes(tile.kind);
}

/** Whether a tile is a bonus tile — a flower or a season. */
export function isBonus(tile: Tile): boolean {
  return BONUS_KINDS.includes(tile.kind);
}

/**
 * Whether a tile is a terminal — a 1 or a 9 of a numbered suit.
 *
 * Here rather than in a game because "terminal" is a property of the tile itself, the
 * way `isRedSuit` is a property of a suit. What a terminal *scores* is the game's business.
 */
export function isTerminal(tile: Tile): boolean {
  return tile.kind === "suited" && (tile.rank === 1 || tile.rank === 9);
}

/** Whether a tile is a simple — a 2 through 8 of a numbered suit. */
export function isSimple(tile: Tile): boolean {
  return tile.kind === "suited" && tile.rank > 1 && tile.rank < 9;
}

/**
 * A stable string naming *what* a tile is, ignoring which copy it is.
 *
 * Two tiles are interchangeable in play exactly when their faces match, and `id`
 * deliberately differs between the four copies — so equality needs a key that drops it.
 * Used by `matches` below, and by any game grouping a hand into sets.
 */
export function tileFace(tile: Tile): string {
  switch (tile.kind) {
    case "suited":
      return `${tile.suit}-${tile.rank}`;
    case "wind":
      return `wind-${tile.wind}`;
    case "dragon":
      return `dragon-${tile.dragon}`;
    case "flower":
      return `flower-${tile.flower}`;
    case "season":
      return `season-${tile.season}`;
  }
}

/**
 * Whether two tiles may be paired.
 *
 * Identical faces match, which covers every suited and honour tile. The bonus tiles are
 * the exception every tile-matching game makes: there is only *one* plum blossom in the
 * box, so a rule requiring identical faces would leave all eight bonus tiles
 * unplayable. Any flower pairs with any flower, any season with any season — the
 * standard solitaire rule, and the reason this is a function rather than a `===`.
 *
 * A tile never matches itself: passing the same tile twice returns false, so a game
 * cannot clear a position by pairing it with itself.
 */
export function matches(a: Tile, b: Tile): boolean {
  if (a.id === b.id) return false;
  if (a.kind === "flower" && b.kind === "flower") return true;
  if (a.kind === "season" && b.kind === "season") return true;
  return tileFace(a) === tileFace(b);
}

/** A source of randomness in [0, 1). `Math.random` in the app; a stub in tests. */
export type Random = () => number;

/**
 * A full set of tiles in standard box order, unshuffled.
 *
 * The order a box is laid out in: the three numbered suits 1-9, then the winds in seat
 * order, then the dragons, then the flowers and the seasons. Four copies of everything
 * except the bonus tiles.
 *
 * `withBonus: false` builds the 136-tile set, for a game that does not play flowers and
 * seasons. Unshuffled, so the caller decides — a test stacking a known wall wants it
 * this way, which is why `shuffle` is a separate call rather than a flag.
 */
export function buildWall(withBonus = true): readonly Tile[] {
  const tiles: Tile[] = [];
  let id = 0;

  // Each `make` is handed the id rather than closing over the counter, so a copy loop
  // cannot accidentally emit four tiles sharing one id — which would collapse to a
  // single React key and silently drop three tiles from the wall.
  const push = (make: (id: number) => Tile, copies: number) => {
    for (let copy = 0; copy < copies; copy += 1) {
      tiles.push(make(id));
      id += 1;
    }
  };

  for (const suit of TILE_SUITS) {
    for (const rank of TILE_RANKS) {
      push((tileId) => ({ id: tileId, kind: "suited", suit, rank }), COPIES_PER_TILE);
    }
  }
  for (const wind of WINDS) {
    push((tileId) => ({ id: tileId, kind: "wind", wind }), COPIES_PER_TILE);
  }
  for (const dragon of DRAGONS) {
    push((tileId) => ({ id: tileId, kind: "dragon", dragon }), COPIES_PER_TILE);
  }
  if (withBonus) {
    for (const flower of FLOWERS) {
      push((tileId) => ({ id: tileId, kind: "flower", flower }), 1);
    }
    for (const season of SEASONS) {
      push((tileId) => ({ id: tileId, kind: "season", season }), 1);
    }
  }
  return tiles;
}

/**
 * A copy of `tiles` in a shuffled order. Fisher-Yates, driven by the supplied RNG.
 *
 * Returns a new array rather than shuffling in place, for the reason the deck's does: a
 * wall is part of an immutable game state, and a caller still holding the old one must
 * keep seeing it unchanged.
 */
export function shuffle<T>(tiles: readonly T[], random: Random): T[] {
  const out = [...tiles];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A shuffled full set. The common case, as one call. */
export function shuffledWall(random: Random, withBonus = true): readonly Tile[] {
  return shuffle(buildWall(withBonus), random);
}

/**
 * Takes `count` tiles off the front of a wall.
 *
 * Returns the drawn tiles and what is left rather than mutating, matching the deck's
 * `draw`. A wall with fewer than `count` tiles returns everything it has; keeping that
 * from happening mid-round is the game's job, since only the game knows how many tiles
 * a round can need.
 */
export function draw(
  wall: readonly Tile[],
  count: number,
): { drawn: readonly Tile[]; rest: readonly Tile[] } {
  return { drawn: wall.slice(0, count), rest: wall.slice(count) };
}

/**
 * Groups tiles by face, in first-appearance order.
 *
 * The primitive behind "have I got a triplet", counting what is left, and sorting a
 * rack — each of which a game would otherwise re-derive from `tileFace`.
 */
export function groupByFace(tiles: readonly Tile[]): ReadonlyMap<string, readonly Tile[]> {
  const groups = new Map<string, Tile[]>();
  for (const tile of tiles) {
    const face = tileFace(tile);
    const group = groups.get(face);
    if (group) group.push(tile);
    else groups.set(face, [tile]);
  }
  return groups;
}

/**
 * `tiles` in canonical box order — the suits by rank, then winds, dragons, bonuses.
 *
 * A sorted rack is how a mahjong hand is actually held, so this belongs with the tile
 * set rather than in each game. Ties break on `id`, so the order is total and two
 * copies of one face never swap between renders. Returns a new array; the input is
 * untouched.
 */
export function sortTiles(tiles: readonly Tile[]): readonly Tile[] {
  const order = new Map(buildWall().map((tile, index) => [tileFace(tile), index]));
  return [...tiles].sort(
    (a, b) => (order.get(tileFace(a)) ?? 0) - (order.get(tileFace(b)) ?? 0) || a.id - b.id,
  );
}
