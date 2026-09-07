/**
 * Four-player mahjong, Hong Kong rules, against three bots.
 *
 * The whole game: the wall and the deal, the call detector and win evaluator, the turn
 * machine, Hong Kong fan scoring, and the bot policy the three opponents play.
 *
 * **The tile set is not here.** `buildWall`, `shuffle`, `draw`, `sortTiles` and
 * `tileFace` come from `mahjong-tiles.ts`, which no game owns — the same split
 * `game-mahjong-match.ts` makes. What this file adds is who sits where and how the 144
 * tiles are distributed among them.
 *
 * Every function takes data and returns data. Nothing mutates its argument, so a view
 * holding the previous state still renders it unchanged, and nothing reads a clock or a
 * global — the RNG arrives as a parameter, which is what makes a stacked wall testable.
 */

import {
  WINDS,
  buildWall,
  draw,
  groupByFace,
  isBonus,
  shuffle,
  sortTiles,
  tileFace,
  type Random,
  type Tile,
} from "./mahjong-tiles";
import {
  DEAD_WALL_SIZE,
  HAND_SIZE,
  HUMAN_SEAT,
  MAHJONG_BASE_FAN,
  MAHJONG_FLOWER_FAN,
  MAHJONG_MAX_FAN,
  MAHJONG_POINTS_PER_FAN,
  SEATS,
  type MahjongCall,
  type MahjongFan,
  type MahjongHand,
  type MahjongPhase,
  type MahjongOutcome,
  type MahjongScore,
  type MahjongState,
  type Meld,
  type MeldKind,
  type Seat,
} from "./types";

export type { Random };

/**
 * The wind each seat holds — `WINDS` indexed by seat, East first.
 *
 * Re-exported from here rather than declared in `types.ts` because that file imports
 * types only. See the note on `SEAT_WINDS` there.
 */
export const SEAT_WINDS = WINDS;

/** The wind a seat holds. East (seat 0) deals. */
export function windOf(seat: Seat): (typeof WINDS)[number] {
  return SEAT_WINDS[seat];
}

/** Whether a seat is played by a person. Exactly one is. */
export function isHumanSeat(seat: Seat): boolean {
  return seat === HUMAN_SEAT;
}

/**
 * The seat to a seat's left — the next to play, and the only seat it may chow from.
 *
 * Play passes counter-clockwise at a real table, which is left to right as the seats
 * are indexed here, so "next" and "left" are the same seat. Chow is restricted to the
 * left-hand neighbour's discard, and that rule reads as `discarder === leftOf(seat)`.
 */
export function nextSeat(seat: Seat): Seat {
  return ((seat + 1) % SEATS.length) as Seat;
}

/** The seat a given seat sits to the left of — the one it may claim a chow from. */
export function leftOf(seat: Seat): Seat {
  return ((seat + SEATS.length - 1) % SEATS.length) as Seat;
}

/**
 * How many tiles a seat is dealt. The dealer holds one more, and plays first.
 *
 * The extra tile is not a bonus: East's fourteenth tile *is* its first draw, which is
 * why the deal leaves the dealer able to discard immediately rather than drawing again.
 */
export function dealtCount(seat: Seat): number {
  return seat === 0 ? HAND_SIZE + 1 : HAND_SIZE;
}

/** An empty hand for a seat. The shape every deal starts from. */
function emptyHand(seat: Seat): MahjongHand {
  return { seat, tiles: [], melds: [], flowers: [], discards: [] };
}

/**
 * Moves any bonus tiles out of a freshly dealt hand, drawing a replacement for each.
 *
 * A flower or season is not playable: it is set aside face up, scores a fan, and the
 * holder draws again — which can itself be a bonus tile, so this loops rather than
 * making one pass. Bounded by the wall, so an exhausted wall stops it instead of
 * spinning.
 *
 * Separate from `deal` because it is also the rule for a bonus tile drawn *mid-hand*,
 * which Phase 3's draw step needs. Returns the tiles rather than a state, so it can
 * serve both without either constructing the other's shape.
 */
export function replaceBonusTiles(
  tiles: readonly Tile[],
  wall: readonly Tile[],
): { tiles: readonly Tile[]; flowers: readonly Tile[]; wall: readonly Tile[] } {
  const keep: Tile[] = [];
  const flowers: Tile[] = [];
  let rest = wall;

  const queue = [...tiles];
  while (queue.length > 0) {
    const tile = queue.shift() as Tile;
    if (!isBonus(tile)) {
      keep.push(tile);
      continue;
    }
    flowers.push(tile);
    // The replacement joins the queue rather than `keep`, so a bonus tile drawn as a
    // replacement is itself replaced — the actual rule, and the reason this is a loop.
    const pulled = draw(rest, 1);
    rest = pulled.rest;
    if (pulled.drawn.length === 0) break;
    queue.push(pulled.drawn[0]);
  }

  return { tiles: keep, flowers, wall: rest };
}

/**
 * A fresh hand of mahjong: a shuffled 144-tile wall, dealt to four seats.
 *
 * The dead wall is sliced off the back and discarded rather than modelled — nothing in
 * HK rules reads it, and its only job is to end the hand in a draw with tiles still on
 * the table. See the note on `MahjongState.wall`.
 *
 * Seats are dealt in order from East, each hand sorted as a player would hold it, and
 * bonus tiles replaced before play starts. East ends with fourteen tiles and the turn,
 * so the game opens in `awaiting-discard` with no draw owed.
 */
export function startGame(random: Random): MahjongState {
  const shuffled = shuffle(buildWall(), random);
  // The dead wall comes off the back, so a stacked wall in a test reads front to back
  // in deal order and its tail can be ignored.
  let wall: readonly Tile[] = shuffled.slice(0, shuffled.length - DEAD_WALL_SIZE);

  const hands: MahjongHand[] = [];
  for (const seat of SEATS) {
    const pulled = draw(wall, dealtCount(seat));
    const replaced = replaceBonusTiles(pulled.drawn, pulled.rest);
    wall = replaced.wall;
    hands.push({
      ...emptyHand(seat),
      tiles: sortTiles(replaced.tiles),
      flowers: replaced.flowers,
    });
  }

  return {
    hands,
    wall,
    turn: 0,
    phase: "awaiting-discard",
    liveDiscard: undefined,
    openCalls: [],
    // East's fourteenth tile is its first draw, but it was dealt rather than drawn, so
    // there is no single tile to mark apart from the rack.
    drawnId: undefined,
    winner: undefined,
    selfDrawn: false,
    outcome: "playing",
  };
}

/** The hand at a seat. */
export function handOf(state: MahjongState, seat: Seat): MahjongHand {
  return state.hands[seat];
}

/** How many tiles are left to draw. What the view shows beside the wall. */
export function tilesLeft(state: MahjongState): number {
  return state.wall.length;
}

/**
 * Every tile in the game, wherever it currently sits.
 *
 * The conservation check: tiles move between wall, racks, melds, flowers and the pond,
 * and no operation may create or lose one. Exported because it is the invariant the
 * tests assert after every action, not just after the deal.
 */
export function allTiles(state: MahjongState): readonly Tile[] {
  return [
    ...state.wall,
    ...(state.liveDiscard ? [state.liveDiscard] : []),
    ...state.hands.flatMap((hand) => [
      ...hand.tiles,
      ...hand.melds.flatMap((meld) => meld.tiles),
      ...hand.flowers,
      ...hand.discards,
    ]),
  ];
}

/* -----------------------------------------------------------------------------------
   Phase 2 — meld algorithms, the win evaluator and the call detector.

   Everything below works on *faces*, not tile identities: whether a hand wins depends
   on what the tiles are, never on which of the four copies they happen to be. The
   public functions still take and return `Tile`s, because a caller has to know which
   physical tiles a call would spend — the face arithmetic is an internal detail.
----------------------------------------------------------------------------------- */

/** Whether a tile can take part in a run. Only the three numbered suits can. */
function isSuited(tile: Tile): boolean {
  return tile.kind === "suited";
}

/**
 * A multiset of faces, as a plain count map.
 *
 * The representation every algorithm below runs on. A count map rather than a sorted
 * array because the two operations that matter — "take three of this face" and "take a
 * run starting here" — are both O(1) on counts and O(n) on an array.
 */
type FaceCounts = Map<string, number>;

function countFaces(tiles: readonly Tile[]): FaceCounts {
  const counts: FaceCounts = new Map();
  for (const tile of tiles) {
    const face = tileFace(tile);
    counts.set(face, (counts.get(face) ?? 0) + 1);
  }
  return counts;
}

/** A suited face split into its suit and rank, or `undefined` for an honour. */
function splitSuited(face: string): { suit: string; rank: number } | undefined {
  const match = /^(bamboo|circles|characters)-([1-9])$/.exec(face);
  if (!match) return undefined;
  return { suit: match[1], rank: Number(match[2]) };
}

/** The face one rank above a suited face, or `undefined` if there is none. */
function nextInSuit(face: string): string | undefined {
  const parts = splitSuited(face);
  if (!parts || parts.rank === 9) return undefined;
  return `${parts.suit}-${parts.rank + 1}`;
}

/**
 * The lowest remaining face, in a stable order.
 *
 * Lexicographic on the face string, which for a suited face sorts by suit then rank
 * because the rank is a single digit — so a run is always three faces the decomposer
 * meets in ascending order. That would break silently if ranks ever reached two digits,
 * hence the note.
 */
function lowestFace(counts: FaceCounts): string | undefined {
  let lowest: string | undefined;
  for (const [face, count] of counts) {
    if (count <= 0) continue;
    if (lowest === undefined || face < lowest) lowest = face;
  }
  return lowest;
}

function take(counts: FaceCounts, face: string, howMany: number): boolean {
  const held = counts.get(face) ?? 0;
  if (held < howMany) return false;
  counts.set(face, held - howMany);
  return true;
}

function give(counts: FaceCounts, face: string, howMany: number): void {
  counts.set(face, (counts.get(face) ?? 0) + howMany);
}

/**
 * Whether the remaining faces split cleanly into `setsNeeded` sets and nothing else.
 *
 * Depth-first over the lowest remaining face, which is what makes this correct rather
 * than merely plausible: every set must contain the lowest face left, so trying only
 * "a triplet of it" and "a run starting at it" explores the whole space without
 * enumerating orderings. Backtracks by putting the tiles back, so one count map is
 * reused down the whole search instead of copied per branch.
 *
 * A pung of the lowest face is tried before a chow deliberately — a hand like
 * 2-2-2-3-4 decomposes either way, and taking the triplet first finds it a step sooner
 * in the common case. Both are still explored, so the answer does not depend on the
 * order.
 */
function splitsIntoSets(counts: FaceCounts, setsNeeded: number): boolean {
  if (setsNeeded === 0) {
    // Nothing may be left over: a stray tile means the hand is not complete.
    for (const count of counts.values()) if (count > 0) return false;
    return true;
  }

  const face = lowestFace(counts);
  if (face === undefined) return false;

  if (take(counts, face, 3)) {
    if (splitsIntoSets(counts, setsNeeded - 1)) return true;
    give(counts, face, 3);
  }

  const second = nextInSuit(face);
  const third = second ? nextInSuit(second) : undefined;
  if (second && third && take(counts, face, 1)) {
    if (take(counts, second, 1)) {
      if (take(counts, third, 1)) {
        if (splitsIntoSets(counts, setsNeeded - 1)) return true;
        give(counts, third, 1);
      }
      give(counts, second, 1);
    }
    give(counts, face, 1);
  }

  return false;
}

/**
 * Whether `tiles` form a standard hand: `setsNeeded` sets plus one pair.
 *
 * Every face held twice or more is tried as the eye rather than guessing one, because a
 * hand can hold several candidate pairs and only one of them may leave a decomposable
 * remainder. 2-2-3-3-4-4 is the standard example — read as the pair 3-3 it leaves
 * 2-2-4-4, which is nothing, but read as the pair 2-2 it leaves 3-3-4-4, which is also
 * nothing, and read as 4-4 it leaves 2-2-3-3. Only exhausting the eye gets these right.
 */
function splitsIntoSetsAndPair(counts: FaceCounts, setsNeeded: number): boolean {
  for (const [face, count] of [...counts]) {
    if (count < 2) continue;
    take(counts, face, 2);
    const won = splitsIntoSets(counts, setsNeeded);
    give(counts, face, 2);
    if (won) return true;
  }
  return false;
}

/**
 * Whether `tiles` are seven distinct pairs.
 *
 * Distinct is the point: four of a kind is two pairs arithmetically but is *not* a
 * seven-pairs hand under any ruleset, so counting pairs alone would wrongly accept
 * a hand holding four of one face and pairs elsewhere.
 */
export function isSevenPairs(tiles: readonly Tile[]): boolean {
  if (tiles.length !== 14) return false;
  const counts = countFaces(tiles);
  if (counts.size !== 7) return false;
  for (const count of counts.values()) if (count !== 2) return false;
  return true;
}

/**
 * Whether a hand is complete — four sets and an eye, or seven pairs.
 *
 * `melds` are already-declared sets, so a hand with two melds down only has to
 * decompose its concealed tiles into the remaining two sets plus the eye. That is why
 * this takes the whole hand rather than fourteen loose tiles: after a pung the rack
 * holds eleven, and a bare tile count could not tell a legal hand from a short one.
 *
 * Bonus tiles are excluded before counting. They sit beside the hand and score a fan,
 * but they belong to no set, and leaving them in would make every hand holding one
 * undecomposable.
 *
 * A kong counts as one set while holding four tiles, which is why the arithmetic is on
 * sets rather than on tiles.
 */
export function isWinningHand(tiles: readonly Tile[], melds: readonly Meld[] = []): boolean {
  const concealed = tiles.filter((tile) => !isBonus(tile));
  const declared = melds.filter((meld) => meld.kind !== "pair").length;
  const setsNeeded = 4 - declared;
  if (setsNeeded < 0) return false;

  // Seven pairs is a concealed hand only: any declared meld rules it out.
  if (melds.length === 0 && isSevenPairs(concealed)) return true;

  // A set is 3 tiles and the eye is 2, so a legal rack holds exactly this many.
  if (concealed.length !== setsNeeded * 3 + 2) return false;

  return splitsIntoSetsAndPair(countFaces(concealed), setsNeeded);
}

/**
 * Whether adding `tile` to a hand completes it. The question a claim on a discard asks.
 *
 * Takes the winning tile separately from the rack because that is how both win
 * conditions arrive — a self-draw and a claimed discard are the same test with a
 * different source, and merging them here keeps the caller from assembling a
 * fourteen-tile array twice.
 */
export function canDeclareWin(
  tiles: readonly Tile[],
  tile: Tile,
  melds: readonly Meld[] = [],
): boolean {
  return isWinningHand([...tiles, tile], melds);
}

/**
 * Which faces would complete this hand, if any.
 *
 * The waits, not just a yes/no: a bot policy needs to know what it is fishing for in
 * order to discard sensibly, and a "you are one away" hint needs the same list. Faces
 * rather than tiles, because the answer is about what would complete the hand, not
 * about a particular copy that may all be discarded already.
 *
 * Every distinct non-bonus face is tried — 34 decomposition runs, each microseconds on
 * a 14-tile hand. A cleverer candidate filter would be faster and would also be a
 * second place for the rules to be wrong.
 */
export function winningWaits(
  tiles: readonly Tile[],
  melds: readonly Meld[] = [],
): readonly string[] {
  const waits: string[] = [];
  const seen = new Set<string>();
  for (const candidate of buildWall(false)) {
    const face = tileFace(candidate);
    if (seen.has(face)) continue;
    seen.add(face);
    if (canDeclareWin(tiles, candidate, melds)) waits.push(face);
  }
  return waits;
}

/** Whether a hand is one tile away from a win. */
export function isOneAway(tiles: readonly Tile[], melds: readonly Meld[] = []): boolean {
  return winningWaits(tiles, melds).length > 0;
}

/**
 * The chow combinations a hand could make with `tile`, as the concealed pairs to spend.
 *
 * All three shapes are returned when the hand holds them — a discarded 3 can be taken
 * with 1-2, 2-4 or 4-5 — because which to use is the player's choice and can matter:
 * spending 4-5 keeps a 1-2 that may become a run of its own.
 *
 * Honours never chow, and a run never wraps 9 round to 1. Both fall out of the rank
 * window being clamped to 1-9 rather than needing a rule of their own.
 */
function chowOptions(tiles: readonly Tile[], tile: Tile): readonly (readonly Tile[])[] {
  if (tile.kind !== "suited") return [];
  const { suit, rank } = tile;
  const byFace = groupByFace(tiles.filter(isSuited));
  const options: (readonly Tile[])[] = [];

  // The three windows a run containing `rank` can sit in: two below, one either side,
  // two above.
  for (const offsets of [
    [-2, -1],
    [-1, 1],
    [1, 2],
  ]) {
    const ranks = offsets.map((offset) => rank + offset);
    if (ranks.some((candidate) => candidate < 1 || candidate > 9)) continue;
    const found = ranks.map((candidate) => byFace.get(`${suit}-${candidate}`)?.[0]);
    if (found.every((candidate): candidate is Tile => candidate !== undefined)) {
      options.push(found);
    }
  }
  return options;
}

/**
 * Every call a seat may legally make on a discard.
 *
 * Returned highest priority first — win, then kong, then pung, then chow — so a caller
 * resolving competing claims can take the head of the list, and a view can offer the
 * buttons in a stable order. Priority *between* seats is Phase 3; this is one seat.
 *
 * The seat restriction is chow's alone: a pung, kong or win may be claimed from any
 * seat, but a chow only from the player to the claimant's left. `discarder` is
 * therefore required rather than optional — making it optional would let a caller
 * silently skip the one positional rule in the game.
 *
 * A seat never calls its own discard, which is why the discarder is checked first.
 */
export function getAvailableCalls(
  hand: MahjongHand,
  tile: Tile,
  discarder: Seat,
): readonly MahjongCall[] {
  if (hand.seat === discarder) return [];
  if (isBonus(tile)) return [];

  const calls: MahjongCall[] = [];
  const matching = hand.tiles.filter((held) => tileFace(held) === tileFace(tile));

  if (canDeclareWin(hand.tiles, tile, hand.melds)) {
    calls.push({ seat: hand.seat, action: "win", tiles: [] });
  }
  // Kong before pung: it spends three where a pung spends two, so a hand holding three
  // can do either and the stronger call is listed first.
  if (matching.length >= 3) {
    calls.push({ seat: hand.seat, action: "kong", tiles: matching.slice(0, 3) });
  }
  if (matching.length >= 2) {
    calls.push({ seat: hand.seat, action: "pung", tiles: matching.slice(0, 2) });
  }
  if (leftOf(hand.seat) === discarder) {
    for (const option of chowOptions(hand.tiles, tile)) {
      calls.push({ seat: hand.seat, action: "chow", tiles: option });
    }
  }
  return calls;
}

/**
 * The concealed kongs a seat could declare on its own turn.
 *
 * Separate from `getAvailableCalls` because it is not a call on a discard: it happens
 * on the seat's own turn, needs all four copies in hand, and no other seat can contest
 * it. Returns the tiles rather than a `MahjongCall`, since there is no discard to claim
 * and no competing seat to name.
 */
export function concealedKongOptions(hand: MahjongHand): readonly (readonly Tile[])[] {
  const options: (readonly Tile[])[] = [];
  for (const group of groupByFace(hand.tiles).values()) {
    if (group.length === 4) options.push(group);
  }
  return options;
}

/* -----------------------------------------------------------------------------------
   Phase 3 — the turn machine.

   The state machine your spec asks for, minus the transport-driven states. With no
   network there is no window in which responses arrive out of order, so
   `RESOLVING_CALLS` collapses into the action that resolves them:

     awaiting-discard --discard--> awaiting-calls --resolveCalls--> awaiting-discard
            |                            |                                |
            +--------- win/kong ---------+------------ wall empty --------+--> ended

   Every transition is a function from state to state. Nothing here decides *whether* a
   bot calls — that is the policy in Phase 4 — so this file stays the referee rather
   than a player: it says what is legal and what follows, never what is wise.
----------------------------------------------------------------------------------- */

/** How the calls a seat may make rank against another seat's. Higher wins. */
const CALL_PRIORITY: Record<MahjongCall["action"], number> = {
  win: 3,
  kong: 2,
  pung: 2,
  chow: 1,
};

/**
 * Seats in claim order starting from the discarder's left.
 *
 * The tie-break your spec names: two seats holding the same claim are resolved in turn
 * order from the discarder, which is the physical rule — the nearer hand to the
 * discarder's left gets it. Excludes the discarder, who cannot claim their own tile.
 */
export function claimOrder(discarder: Seat): readonly Seat[] {
  const order: Seat[] = [];
  let seat = nextSeat(discarder);
  while (seat !== discarder) {
    order.push(seat);
    seat = nextSeat(seat);
  }
  return order;
}

/**
 * Every call every seat could make on the tile now on the table, best first.
 *
 * Sorted by priority and then by distance from the discarder, so `[0]` is the claim
 * that wins outright and a caller resolving competing claims never has to compare two
 * itself. A stable sort over a list already built in claim order, so equal-priority
 * claims keep that order rather than depending on the sort's internals.
 */
export function collectCalls(state: MahjongState, tile: Tile, discarder: Seat): readonly MahjongCall[] {
  const calls: MahjongCall[] = [];
  for (const seat of claimOrder(discarder)) {
    calls.push(...getAvailableCalls(handOf(state, seat), tile, discarder));
  }
  return [...calls].sort((a, b) => CALL_PRIORITY[b.action] - CALL_PRIORITY[a.action]);
}

/** A hand with one field replaced. Keeps the transitions below to one shape each. */
function withHand(
  state: MahjongState,
  seat: Seat,
  change: Partial<MahjongHand>,
): readonly MahjongHand[] {
  return state.hands.map((hand) => (hand.seat === seat ? { ...hand, ...change } : hand));
}

/** Removes tiles by id. Ids, not faces: spending a pung must not take the wrong copy. */
function without(tiles: readonly Tile[], remove: readonly Tile[]): readonly Tile[] {
  const ids = new Set(remove.map((tile) => tile.id));
  return tiles.filter((tile) => !ids.has(tile.id));
}

/**
 * The hand ends in a draw when the wall runs out.
 *
 * A `draw` outcome with no winner. The dead wall is what makes this reachable with
 * tiles still on the table, which is the rule that stops the last few discards from
 * being forced — see `MahjongState.wall`.
 */
function exhausted(state: MahjongState): MahjongState {
  return {
    ...state,
    phase: "ended",
    liveDiscard: undefined,
    openCalls: [],
    drawnId: undefined,
    winner: undefined,
    selfDrawn: false,
    outcome: "draw",
  };
}

/**
 * Ends the hand with `winner` having won.
 *
 * `outcome` is from the human's point of view — `won` when the human seat won and
 * `lost` when a bot did — because it drives the view's banner and the score, and a
 * single game reports one result. `winner` carries who it actually was, so nothing is
 * lost by the flattening.
 */
function finish(state: MahjongState, winner: Seat, selfDrawn: boolean): MahjongState {
  return {
    ...state,
    phase: "ended",
    liveDiscard: undefined,
    openCalls: [],
    drawnId: undefined,
    winner,
    selfDrawn,
    outcome: winner === HUMAN_SEAT ? "won" : "lost",
  };
}

/**
 * Draws the next tile for the seat whose turn it is.
 *
 * Bonus tiles are set aside and replaced as they are at the deal, which is why this
 * calls the same `replaceBonusTiles` rather than repeating the rule — a flower drawn
 * mid-hand behaves exactly like one dealt.
 *
 * A self-drawn win is NOT declared here. Drawing and winning are separate steps so a
 * player can choose to draw and keep playing on a hand that is technically complete,
 * and so a bot policy decides for itself; `canDeclareWin` on the drawn tile is what
 * the caller asks afterwards.
 *
 * An empty wall ends the hand in a draw rather than dealing `undefined`.
 */
export function drawTile(state: MahjongState): MahjongState {
  if (state.phase !== "awaiting-discard") return state;

  const hand = handOf(state, state.turn);
  // Already holding a full hand — the dealer at the opening, or a seat that just
  // claimed a discard. Nothing to draw.
  if (hand.tiles.length + hand.melds.length * 3 >= HAND_SIZE + 1) return state;
  if (state.wall.length === 0) return exhausted(state);

  const pulled = draw(state.wall, 1);
  const replaced = replaceBonusTiles([...hand.tiles, ...pulled.drawn], pulled.rest);
  if (replaced.tiles.length === hand.tiles.length) {
    // Every tile drawn was a bonus and the wall gave nothing playable back.
    return exhausted({ ...state, wall: replaced.wall });
  }

  // The drawn tile is the one `replaceBonusTiles` did not already hold, found by id so
  // the sort below cannot lose track of it.
  const heldIds = new Set(hand.tiles.map((tile) => tile.id));
  const gained = replaced.tiles.find((tile) => !heldIds.has(tile.id));

  return {
    ...state,
    hands: withHand(state, state.turn, {
      tiles: sortTiles(replaced.tiles),
      flowers: [...hand.flowers, ...replaced.flowers],
    }),
    wall: replaced.wall,
    drawnId: gained?.id,
  };
}

/**
 * Discards `tile` from the seat whose turn it is, opening the call window.
 *
 * The tile leaves the rack and goes on the table as `liveDiscard` — NOT yet into the
 * discarder's pond. It only lands there when the window closes without a claim, which
 * is what makes a claimed tile end up in the claimant's meld instead of in the pond.
 *
 * Rejects a discard from a seat that is not to play, or of a tile it does not hold, by
 * returning the state unchanged. An invalid action is a no-op rather than a throw, the
 * same call every other game here makes: a mistimed click should do nothing, not crash
 * the board.
 */
export function discardTile(state: MahjongState, tile: Tile): MahjongState {
  if (state.phase !== "awaiting-discard") return state;
  const hand = handOf(state, state.turn);
  if (!hand.tiles.some((held) => held.id === tile.id)) return state;

  const next: MahjongState = {
    ...state,
    hands: withHand(state, state.turn, { tiles: without(hand.tiles, [tile]) }),
    phase: "awaiting-calls",
    liveDiscard: tile,
    drawnId: undefined,
    openCalls: [],
  };

  const calls = collectCalls(next, tile, state.turn);
  // Nobody can claim it, so the window would open and immediately close. Skipping
  // straight to the next seat keeps a view from flashing an empty call bar.
  if (calls.length === 0) return passCalls(next);

  return { ...next, openCalls: calls };
}

/**
 * Closes the call window with nobody claiming the tile.
 *
 * The discard lands in the discarder's pond and play passes to their left. This is what
 * a timeout resolves to, and what every seat passing resolves to — the same rule, so
 * one function rather than two.
 */
export function passCalls(state: MahjongState): MahjongState {
  if (state.phase !== "awaiting-calls" || !state.liveDiscard) return state;

  const discarder = state.turn;
  const pond = [...handOf(state, discarder).discards, state.liveDiscard];
  const settled: MahjongState = {
    ...state,
    hands: withHand(state, discarder, { discards: pond }),
    phase: "awaiting-discard",
    liveDiscard: undefined,
    openCalls: [],
    turn: nextSeat(discarder),
  };

  // The next seat has to be able to draw. An empty wall is a drawn hand.
  if (settled.wall.length === 0) return exhausted(settled);
  return drawTile(settled);
}

/**
 * Applies one call to the live discard, ending the window.
 *
 * The claimed tile joins the meld rather than the pond, the claimant becomes the seat
 * to play, and they discard *without drawing* — which is the rule that makes a pung
 * profitable and is why `drawTile` checks the hand is short before dealing.
 *
 * A kong is the exception: it consumes a fourth tile, so the claimant draws a
 * replacement to get back to a discardable hand. Without that a kong would leave the
 * hand one tile short for the rest of the game.
 *
 * `call` must be one of `state.openCalls` — a call assembled elsewhere could name tiles
 * the hand does not hold. Verified by id rather than trusted.
 */
export function applyCall(state: MahjongState, call: MahjongCall): MahjongState {
  if (state.phase !== "awaiting-calls" || !state.liveDiscard) return state;

  const tile = state.liveDiscard;
  const claimant = handOf(state, call.seat);
  const discarder = state.turn;

  // Every tile the call spends must actually be in the claimant's rack.
  const heldIds = new Set(claimant.tiles.map((held) => held.id));
  if (!call.tiles.every((spent) => heldIds.has(spent.id))) return state;

  if (call.action === "win") {
    // The winning tile joins the hand so the final rack is what the player actually
    // holds — the view shows it, and Phase 4's scoring reads it.
    const won = withHand(state, call.seat, {
      tiles: sortTiles([...claimant.tiles, tile]),
    });
    return finish({ ...state, hands: won }, call.seat, false);
  }

  const kind: MeldKind = call.action === "chow" ? "chow" : call.action === "kong" ? "kong" : "pung";
  const meld: Meld = {
    kind,
    tiles: sortTiles([...call.tiles, tile]),
    // Claimed from another seat, so never concealed — that is what `concealed` records.
    concealed: false,
    claimedFrom: discarder,
  };

  const claimed: MahjongState = {
    ...state,
    hands: withHand(state, call.seat, {
      tiles: without(claimant.tiles, call.tiles),
      melds: [...claimant.melds, meld],
    }),
    phase: "awaiting-discard",
    liveDiscard: undefined,
    openCalls: [],
    drawnId: undefined,
    turn: call.seat,
  };

  // A kong spent four tiles for one set, so the hand is a tile short until it draws.
  if (call.action === "kong") return drawTile(claimed);
  return claimed;
}

/**
 * Resolves the call window, giving the tile to the highest-priority claim.
 *
 * What a timeout runs, and what a "everyone has answered" resolution runs. `passed`
 * names the seats that declined, so a window where the only eligible seat passed
 * resolves to nobody rather than forcing a call on them.
 *
 * Priority is `win > pung/kong > chow`, ties broken in turn order from the discarder —
 * both already encoded in `openCalls`, which is sorted, so this takes the first call
 * whose seat has not passed. That keeps the priority rule in exactly one place.
 */
export function resolveCalls(
  state: MahjongState,
  passed: readonly Seat[] = [],
): MahjongState {
  if (state.phase !== "awaiting-calls") return state;

  const declined = new Set(passed);
  const winner = state.openCalls.find((call) => !declined.has(call.seat));
  if (!winner) return passCalls(state);
  return applyCall(state, winner);
}

/**
 * Declares a self-drawn win for the seat to play.
 *
 * Separate from `applyCall` because there is no discard to claim and no competing seat:
 * the hand is already complete in the rack, having just drawn. Returns the state
 * unchanged if it is not actually a winning hand, so a misfired button cannot end a
 * hand that has not been won.
 */
export function declareSelfWin(state: MahjongState): MahjongState {
  if (state.phase !== "awaiting-discard") return state;
  const hand = handOf(state, state.turn);
  if (!isWinningHand(hand.tiles, hand.melds)) return state;
  return finish(state, state.turn, true);
}

/**
 * Declares a concealed kong from the seat's own hand, then draws a replacement.
 *
 * All four copies leave the rack for a face-up meld — face-up because the set is
 * declared, `concealed: true` because no other seat contributed to it, which is the
 * distinction Phase 4's scoring reads.
 */
export function declareConcealedKong(state: MahjongState, tiles: readonly Tile[]): MahjongState {
  if (state.phase !== "awaiting-discard") return state;
  const hand = handOf(state, state.turn);
  if (tiles.length !== 4) return state;

  const heldIds = new Set(hand.tiles.map((held) => held.id));
  if (!tiles.every((tile) => heldIds.has(tile.id))) return state;
  // All four must be the same face, or this is not a kong at all.
  if (new Set(tiles.map(tileFace)).size !== 1) return state;

  const meld: Meld = {
    kind: "kong",
    tiles: sortTiles(tiles),
    concealed: true,
    claimedFrom: undefined,
  };

  return drawTile({
    ...state,
    hands: withHand(state, state.turn, {
      tiles: without(hand.tiles, tiles),
      melds: [...hand.melds, meld],
    }),
    drawnId: undefined,
  });
}

/** Whether the hand is over, however it ended. */
export function isHandOver(state: MahjongState): boolean {
  return state.phase === "ended";
}

/**
 * What one seat is allowed to see.
 *
 * Your spec's `getSanitizedState`, kept as a *view* concern rather than a security
 * boundary: with no network there is no client to distrust, but a view still needs to
 * know which racks to draw face down, and putting that here means the answer is the
 * same for the human and for a bot policy that is meant to play fair.
 *
 * Opponent racks come back as counts, not tiles. Melds, flowers, ponds and the wall
 * count stay visible because they are face up on a real table.
 */
export interface MahjongViewState {
  seat: Seat;
  /** The viewer's own tiles, in full. */
  tiles: readonly Tile[];
  /** Every seat's public information, indexed by seat. */
  seats: readonly {
    seat: Seat;
    wind: (typeof WINDS)[number];
    /** How many concealed tiles they hold. Their faces are not disclosed. */
    concealed: number;
    melds: readonly Meld[];
    flowers: readonly Tile[];
    discards: readonly Tile[];
  }[];
  wallCount: number;
  turn: Seat;
  phase: MahjongPhase;
  liveDiscard: Tile | undefined;
  /** Only this seat's own calls — another seat's options are not disclosed. */
  calls: readonly MahjongCall[];
  drawnId: number | undefined;
  winner: Seat | undefined;
  selfDrawn: boolean;
  outcome: MahjongOutcome;
}

export function getSanitizedState(state: MahjongState, seat: Seat): MahjongViewState {
  return {
    seat,
    tiles: handOf(state, seat).tiles,
    seats: state.hands.map((hand) => ({
      seat: hand.seat,
      wind: windOf(hand.seat),
      concealed: hand.tiles.length,
      melds: hand.melds,
      flowers: hand.flowers,
      discards: hand.discards,
    })),
    wallCount: state.wall.length,
    turn: state.turn,
    phase: state.phase,
    liveDiscard: state.liveDiscard,
    calls: state.openCalls.filter((call) => call.seat === seat),
    drawnId: state.drawnId,
    winner: state.winner,
    selfDrawn: state.selfDrawn,
    outcome: state.outcome,
  };
}

/* -----------------------------------------------------------------------------------
   Phase 4a — Hong Kong fan scoring.

   Patterns are detected off the *decomposition* rather than off the raw tiles, because
   almost every one asks a question about the sets: "are all four triplets", "is every
   set in one suit", "does every set contain a terminal". So the decomposer is run once
   more here to recover which sets the hand actually made — `isWinningHand` only answers
   yes or no, deliberately, since a boolean is all the turn machine needs.
----------------------------------------------------------------------------------- */

/** One set recovered from a winning decomposition. */
interface ScoredSet {
  kind: "chow" | "pung" | "kong" | "pair";
  /** The faces in the set, so a pattern can ask about suits and ranks. */
  faces: readonly string[];
}

/**
 * One way a hand decomposes into sets and an eye, or `undefined` if it does not.
 *
 * Returns the *first* decomposition found rather than every one. A hand with two
 * readings almost always scores the same either way under this pattern set, and
 * enumerating all of them to pick the best would multiply the work for a difference a
 * player would never notice. Noted rather than hidden: if a pattern is added where the
 * reading matters, this is the function to widen.
 */
function decompose(counts: FaceCounts, setsNeeded: number, sets: ScoredSet[]): ScoredSet[] | undefined {
  if (setsNeeded === 0) {
    for (const count of counts.values()) if (count > 0) return undefined;
    return sets;
  }

  const face = lowestFace(counts);
  if (face === undefined) return undefined;

  if (take(counts, face, 3)) {
    const found = decompose(counts, setsNeeded - 1, [
      ...sets,
      { kind: "pung", faces: [face, face, face] },
    ]);
    if (found) return found;
    give(counts, face, 3);
  }

  const second = nextInSuit(face);
  const third = second ? nextInSuit(second) : undefined;
  if (second && third && take(counts, face, 1)) {
    if (take(counts, second, 1)) {
      if (take(counts, third, 1)) {
        const found = decompose(counts, setsNeeded - 1, [
          ...sets,
          { kind: "chow", faces: [face, second, third] },
        ]);
        if (found) return found;
        give(counts, third, 1);
      }
      give(counts, second, 1);
    }
    give(counts, face, 1);
  }

  return undefined;
}

/**
 * The sets a winning hand is made of — declared melds plus the concealed decomposition.
 *
 * `undefined` when the hand does not win, so a caller cannot accidentally score an
 * incomplete hand.
 */
function setsOf(hand: MahjongHand): readonly ScoredSet[] | undefined {
  const concealed = hand.tiles.filter((tile) => !isBonus(tile));
  const declared: ScoredSet[] = hand.melds
    .filter((meld) => meld.kind !== "pair")
    .map((meld) => ({
      kind: meld.kind === "chow" ? "chow" : meld.kind === "kong" ? "kong" : "pung",
      faces: meld.tiles.map(tileFace),
    }));

  const setsNeeded = 4 - declared.length;
  if (setsNeeded < 0) return undefined;
  if (concealed.length !== setsNeeded * 3 + 2) return undefined;

  const counts = countFaces(concealed);
  for (const [face, count] of [...counts]) {
    if (count < 2) continue;
    take(counts, face, 2);
    const rest = decompose(counts, setsNeeded, []);
    give(counts, face, 2);
    if (rest) {
      return [...declared, ...rest, { kind: "pair", faces: [face, face] }];
    }
  }
  return undefined;
}

/** The suit part of a face, or `undefined` for an honour. */
function suitOf(face: string): string | undefined {
  return splitSuited(face)?.suit;
}

/** Whether a face is a terminal — a 1 or a 9 of a numbered suit. */
function isTerminalFace(face: string): boolean {
  const parts = splitSuited(face);
  return parts !== undefined && (parts.rank === 1 || parts.rank === 9);
}

/** Whether a face is an honour — a wind or a dragon. */
function isHonourFace(face: string): boolean {
  return face.startsWith("wind-") || face.startsWith("dragon-");
}

/**
 * Every fan a finished hand earns.
 *
 * Ordered best first, so a view showing only the top pattern shows the one that
 * mattered. Returns an empty list for a hand that has not won, which is what keeps
 * `scoreHand` from paying out on an incomplete rack.
 *
 * `selfDrawn` and `seatWind` come from the game state rather than the hand, because
 * neither is visible in the tiles: a hand that won on a claimed discard looks identical
 * to one that drew the same tile.
 */
export function handFans(
  hand: MahjongHand,
  options: { selfDrawn?: boolean; seatWind?: (typeof WINDS)[number] } = {},
): readonly MahjongFan[] {
  const concealed = hand.tiles.filter((tile) => !isBonus(tile));
  // Seven pairs has no four-sets-and-an-eye reading, so `setsOf` cannot describe it.
  // Its seven pairs stand in as the decomposition, which lets the suit and honour
  // patterns below apply to it unchanged — a seven-pair hand in one suit is still a
  // flush. Without this branch a legitimate winning hand scored nothing at all.
  const sevenPairs = hand.melds.length === 0 && isSevenPairs(concealed);
  const sets = sevenPairs
    ? [...countFaces(concealed).keys()].map(
        (face): ScoredSet => ({ kind: "pair", faces: [face, face] }),
      )
    : setsOf(hand);
  if (!sets) return [];

  const fans: MahjongFan[] = [];
  const scoring = sets.filter((set) => set.kind !== "pair");
  const allFaces = sets.flatMap((set) => set.faces);
  const suits = new Set(allFaces.map(suitOf).filter((suit): suit is string => suit !== undefined));
  const concealedHand = hand.melds.length === 0;

  /* --- The big hands, checked first so they lead the list. --- */

  // All honours: no numbered tile anywhere. The rarest hand this set scores.
  if (allFaces.every(isHonourFace)) {
    fans.push({ id: "all-honours", label: "All Honours", fan: 10 });
  } else if (suits.size === 1 && allFaces.every((face) => !isHonourFace(face))) {
    // Full flush: one suit and nothing else, honours included nowhere.
    fans.push({ id: "full-flush", label: "Full Flush", fan: 7 });
  } else if (suits.size === 1) {
    // Half flush: one suit plus honours.
    fans.push({ id: "half-flush", label: "Half Flush", fan: 3 });
  }

  // All triplets: four pungs or kongs and an eye, no runs at all.
  if (scoring.length === 4 && scoring.every((set) => set.kind !== "chow")) {
    fans.push({ id: "all-triplets", label: "All Triplets", fan: 3 });
  }

  if (sevenPairs) {
    fans.push({ id: "seven-pairs", label: "Seven Pairs", fan: 4 });
  }

  // All runs: four chows and an eye, the mirror of All Triplets.
  if (scoring.length === 4 && scoring.every((set) => set.kind === "chow")) {
    fans.push({ id: "all-sequences", label: "All Sequences", fan: 1 });
  }

  /* --- The small, common patterns. --- */

  // A triplet of dragons is a fan each; a triplet of the seat's own wind likewise.
  for (const set of scoring) {
    const face = set.faces[0];
    if (set.kind === "chow") continue;
    if (face.startsWith("dragon-")) {
      fans.push({ id: `dragon-${face}`, label: "Dragon Triplet", fan: 1 });
    }
    if (options.seatWind && face === `wind-${options.seatWind}`) {
      fans.push({ id: "seat-wind", label: "Seat Wind", fan: 1 });
    }
  }

  // All the sets contain a terminal or an honour — a hand of edges.
  if (
    scoring.length === 4 &&
    sets.every((set) => set.faces.some((face) => isTerminalFace(face) || isHonourFace(face)))
  ) {
    fans.push({ id: "all-edges", label: "Terminals & Honours", fan: 2 });
  }

  // Concealed: won without ever claiming a discard.
  if (concealedHand) {
    fans.push({ id: "concealed", label: "Fully Concealed", fan: 1 });
  }
  if (options.selfDrawn) {
    fans.push({ id: "self-drawn", label: "Self Drawn", fan: 1 });
  }

  // A fan per bonus tile. Grouped into one entry rather than one per flower, so the
  // banner does not list the same label four times.
  if (hand.flowers.length > 0) {
    fans.push({
      id: "flowers",
      label: hand.flowers.length === 1 ? "Flower" : `Flowers x${hand.flowers.length}`,
      fan: hand.flowers.length * MAHJONG_FLOWER_FAN,
    });
  }

  fans.push({ id: "win", label: "Winning Hand", fan: MAHJONG_BASE_FAN });

  return [...fans].sort((a, b) => b.fan - a.fan);
}

/**
 * What a finished hand scored.
 *
 * The fan total is capped at `MAHJONG_MAX_FAN` before converting, so the cap applies to
 * the exponent and not to the points — capping afterwards would let a 20-fan hand and a
 * 13-fan hand both land on the ceiling by different arithmetic.
 */
export function scoreHand(
  hand: MahjongHand,
  options: { selfDrawn?: boolean; seatWind?: (typeof WINDS)[number] } = {},
): MahjongScore {
  const fans = handFans(hand, options);
  if (fans.length === 0) return { fans: [], fan: 0, points: 0 };

  const total = Math.min(
    MAHJONG_MAX_FAN,
    fans.reduce((sum, entry) => sum + entry.fan, 0),
  );
  return { fans, fan: total, points: MAHJONG_POINTS_PER_FAN * 2 ** total };
}

/**
 * What the game records on the scoreboard.
 *
 * Zero unless the human won, the same call `game-blackjack.ts` makes with a cashed-out
 * shoe: a hand a bot won is a real game played and a real result, but it is not the
 * player's score. A draw scores nothing for the same reason.
 *
 * No floor constant here, unlike Sudoku or Minesweeper: those subtract penalties from a
 * base and can go negative, whereas a win here is always at least
 * `MAHJONG_POINTS_PER_FAN * 2` and needs no protecting.
 */
export function scoreGame(state: MahjongState): number {
  if (state.outcome !== "won" || state.winner === undefined) return 0;
  return scoreHand(handOf(state, state.winner), {
    selfDrawn: state.selfDrawn,
    seatWind: windOf(state.winner),
  }).points;
}

/* -----------------------------------------------------------------------------------
   Phase 4b — the bot policy.

   One policy, no difficulty picker, per the plan. It plays a competent beginner: it
   always takes a win, calls a set when the set genuinely helps, and otherwise throws
   its least connected tile. It does NOT count the pond, read other seats or remember
   what has been discarded — a bot that did would need its own difficulty ladder to stay
   fun, which is a bigger feature than this game needs.

   Deterministic given a state and an RNG, so a bot turn is reproducible in a test.
----------------------------------------------------------------------------------- */

/**
 * How much a tile contributes to the hand it sits in.
 *
 * The heart of the discard choice. A tile scores for the company it keeps: copies of
 * itself (a pair is nearly a triplet), and neighbours within a run's reach. Honours
 * score only on copies, since they cannot form runs — which is exactly why a lone
 * honour is the right thing to throw early, and this arithmetic produces that without a
 * rule saying so.
 */
export function tileValue(tiles: readonly Tile[], tile: Tile): number {
  const counts = countFaces(tiles);
  const face = tileFace(tile);
  const copies = (counts.get(face) ?? 0) - 1;

  // A pair is worth much more than a lone tile, and a triplet more again.
  let value = copies * 4;

  const parts = splitSuited(face);
  if (parts) {
    for (const offset of [-2, -1, 1, 2]) {
      const rank = parts.rank + offset;
      if (rank < 1 || rank > 9) continue;
      const neighbours = counts.get(`${parts.suit}-${rank}`) ?? 0;
      if (neighbours === 0) continue;
      // Adjacent is worth more than a gap: 3-4 needs one tile, 3-5 also one but only
      // the single tile between them, so both count and adjacency counts double.
      value += Math.abs(offset) === 1 ? 2 : 1;
    }
    // A terminal reaches only one way, so it is worth slightly less than a middle tile
    // of the same shape. Small, because the run arithmetic above already sees most of it.
    if (parts.rank === 1 || parts.rank === 9) value -= 1;
  }

  return value;
}

/**
 * The tile a bot throws: its least valuable, ties broken by the RNG.
 *
 * Ties are broken randomly rather than by taking the first, so two bots holding the
 * same shape do not throw the same tile in the same order and the table does not look
 * mechanical.
 */
export function botDiscard(hand: MahjongHand, random: Random): Tile {
  const scored = hand.tiles.map((tile) => ({ tile, value: tileValue(hand.tiles, tile) }));
  const lowest = Math.min(...scored.map((entry) => entry.value));
  const candidates = scored.filter((entry) => entry.value === lowest);
  return candidates[Math.floor(random() * candidates.length)].tile;
}

/**
 * Whether a bot takes a call it is offered.
 *
 * A win is always taken. A pung or kong is taken when the tile is one the hand was
 * collecting anyway — which, since a pung needs a pair in hand, it always is. A chow is
 * taken only when it does not break a pair the hand is holding, because spending a
 * paired tile on a run trades a near-triplet for a completed run and usually leaves the
 * hand worse.
 *
 * Deliberately simple. A stronger policy would weigh the hand's shape after the call
 * against its shape before, which is a genuine improvement and also the point at which
 * a difficulty picker starts to be worth having.
 */
export function botAcceptsCall(hand: MahjongHand, call: MahjongCall): boolean {
  if (call.action === "win") return true;
  if (call.action === "pung" || call.action === "kong") return true;

  const counts = countFaces(hand.tiles);
  // A chow that spends a tile the hand holds two or more of breaks a pair.
  return call.tiles.every((tile) => (counts.get(tileFace(tile)) ?? 0) < 2);
}

/**
 * The call a bot makes on the live discard, or `undefined` to pass.
 *
 * Reads `openCalls` rather than recomputing, so a bot can only claim what the referee
 * already ruled legal — the same list the human's buttons come from.
 */
export function botCall(state: MahjongState, seat: Seat): MahjongCall | undefined {
  const mine = state.openCalls.filter((call) => call.seat === seat);
  const hand = handOf(state, seat);
  return mine.find((call) => botAcceptsCall(hand, call));
}

/**
 * Advances the game by one bot action, or returns the state unchanged.
 *
 * The single entry point a view drives on a timer: it does nothing when it is the
 * human's turn or when the human has a call to answer, so the caller does not have to
 * work out whose move it is. That check living here rather than in the view is what
 * keeps the turn rules out of the presentation layer.
 *
 * One action per call, not a loop to the human's turn, so a view can pace the table at
 * human speed and show each bot's move.
 */
export function stepBots(state: MahjongState, random: Random): MahjongState {
  if (state.phase === "ended") return state;

  if (state.phase === "awaiting-calls") {
    // The human still has a claim open, so nothing may resolve until they answer.
    if (state.openCalls.some((call) => call.seat === HUMAN_SEAT)) return state;

    const claimed = SEATS.map((seat) => (seat === HUMAN_SEAT ? undefined : botCall(state, seat)))
      .filter((call): call is MahjongCall => call !== undefined);
    // `resolveCalls` already holds the priority rule, so the passers are everyone who
    // did not claim rather than a ranking computed here.
    const claimants = new Set(claimed.map((call) => call.seat));
    const passed = SEATS.filter((seat) => !claimants.has(seat));
    return resolveCalls(state, passed);
  }

  if (state.turn === HUMAN_SEAT) return state;

  const hand = handOf(state, state.turn);
  // A completed hand goes out rather than discarding.
  if (isWinningHand(hand.tiles, hand.melds)) return declareSelfWin(state);

  return discardTile(state, botDiscard(hand, random));
}

/**
 * Whether the game is waiting on the human for something.
 *
 * What a view checks to decide whether to run the bot timer. Two cases: it is the
 * human's turn to discard, or a discard is on the table that the human may claim.
 */
export function isWaitingForHuman(state: MahjongState): boolean {
  if (state.phase === "ended") return false;
  if (state.phase === "awaiting-calls") {
    return state.openCalls.some((call) => call.seat === HUMAN_SEAT);
  }
  return state.turn === HUMAN_SEAT;
}
