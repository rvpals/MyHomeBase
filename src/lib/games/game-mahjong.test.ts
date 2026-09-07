import { describe, expect, it } from "vitest";
import {
  DEAD_WALL_SIZE,
  HAND_SIZE,
  HUMAN_SEAT,
  MAHJONG_FLOWER_FAN,
  MAHJONG_MAX_FAN,
  MAHJONG_POINTS_PER_FAN,
  SEATS,
  type MahjongCall,
  type MahjongHand,
  type MahjongState,
  type Meld,
  type Seat,
} from "./types";
import {
  SEAT_WINDS,
  allTiles,
  applyCall,
  canDeclareWin,
  claimOrder,
  concealedKongOptions,
  dealtCount,
  declareConcealedKong,
  declareSelfWin,
  discardTile,
  drawTile,
  getAvailableCalls,
  getSanitizedState,
  handOf,
  isHandOver,
  isHumanSeat,
  isOneAway,
  isSevenPairs,
  isWinningHand,
  leftOf,
  nextSeat,
  replaceBonusTiles,
  resolveCalls,
  botAcceptsCall,
  botCall,
  botDiscard,
  handFans,
  isWaitingForHuman,
  scoreGame,
  scoreHand,
  startGame,
  stepBots,
  tileValue,
  tilesLeft,
  windOf,
  winningWaits,
} from "./game-mahjong";
// `TILES_IN_SET` comes from here rather than from `./types`, which re-exports the tile
// *types* but not the tile set's constants — importing it from there silently yielded
// `undefined` and every count assertion compared against `NaN`.
import {
  TILES_IN_SET,
  buildWall,
  isBonus,
  tileFace,
  type Dragon,
  type Tile,
  type TileRank,
  type TileSuit,
  type Wind,
} from "./mahjong-tiles";

/**
 * A deterministic RNG.
 *
 * A linear congruential generator rather than a replayed list, for the reason
 * `game-blackjack.test.ts` gives: shuffling 144 tiles consumes one random number per
 * tile, so a fixed list would run out and degenerate into a constant.
 */
function rng(seed = 1) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** An RNG that never swaps, so the wall stays in `buildWall` order. */
const identity = () => 0.999999;

/** The first tile in a full set with this face. Keeps the tests readable. */
function tileWithFace(face: string): Tile {
  const tile = buildWall().find((candidate) => tileFace(candidate) === face);
  if (!tile) throw new Error(`no tile with face ${face}`);
  return tile;
}

describe("seat geometry", () => {
  it("seats four players and gives each a wind, East first", () => {
    expect(SEATS).toHaveLength(4);
    expect(SEAT_WINDS).toEqual(["east", "south", "west", "north"]);
    expect(windOf(0)).toBe("east");
    expect(windOf(3)).toBe("north");
  });

  it("passes play to the left and wraps at the last seat", () => {
    expect(nextSeat(0)).toBe(1);
    expect(nextSeat(3)).toBe(0);
  });

  it("makes leftOf the inverse of nextSeat, which is the chow rule", () => {
    for (const seat of SEATS) {
      expect(nextSeat(leftOf(seat))).toBe(seat);
      expect(leftOf(nextSeat(seat))).toBe(seat);
    }
  });

  it("seats exactly one human", () => {
    expect(SEATS.filter(isHumanSeat)).toEqual([HUMAN_SEAT]);
  });

  it("deals the dealer one extra tile", () => {
    expect(dealtCount(0)).toBe(HAND_SIZE + 1);
    expect(dealtCount(1)).toBe(HAND_SIZE);
    expect(dealtCount(2)).toBe(HAND_SIZE);
    expect(dealtCount(3)).toBe(HAND_SIZE);
  });
});

describe("startGame", () => {
  it("deals thirteen tiles to each seat and fourteen to the dealer", () => {
    const state = startGame(rng());

    // Flowers are set aside and replaced, so a rack is always its dealt size.
    expect(handOf(state, 0).tiles).toHaveLength(HAND_SIZE + 1);
    for (const seat of [1, 2, 3] as const) {
      expect(handOf(state, seat).tiles).toHaveLength(HAND_SIZE);
    }
  });

  it("opens with East to play and nothing on the table", () => {
    const state = startGame(rng());

    expect(state.turn).toBe(0);
    expect(state.phase).toBe("awaiting-discard");
    expect(state.liveDiscard).toBeUndefined();
    expect(state.openCalls).toEqual([]);
    expect(state.winner).toBeUndefined();
    expect(state.outcome).toBe("playing");
  });

  it("conserves all 144 tiles across wall, racks and flowers", () => {
    const state = startGame(rng(7));

    expect(allTiles(state)).toHaveLength(TILES_IN_SET - DEAD_WALL_SIZE);
  });

  it("never repeats a tile id", () => {
    const state = startGame(rng(11));
    const ids = allTiles(state).map((tile) => tile.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("holds back the dead wall", () => {
    const state = startGame(rng());
    // `sum: number` is annotated because `SEATS` is a tuple of literal seats, so
    // `reduce` otherwise infers the accumulator as `Seat` and rejects the running total.
    const dealt = SEATS.reduce((sum: number, seat) => sum + dealtCount(seat), 0);
    const flowers = state.hands.reduce((sum, hand) => sum + hand.flowers.length, 0);

    // Every flower cost an extra tile off the wall, so the live wall is the set less
    // the dead wall, less what was dealt, less each replacement drawn.
    expect(tilesLeft(state)).toBe(TILES_IN_SET - DEAD_WALL_SIZE - dealt - flowers);
  });

  it("leaves no bonus tile in any rack", () => {
    // Several seeds, because whether a flower is dealt at all depends on the shuffle.
    for (const seed of [1, 2, 3, 42, 99]) {
      const state = startGame(rng(seed));
      for (const seat of SEATS) {
        expect(handOf(state, seat).tiles.some(isBonus)).toBe(false);
      }
    }
  });

  it("sets aside every bonus tile it dealt, face up", () => {
    const state = startGame(rng(3));

    for (const seat of SEATS) {
      expect(handOf(state, seat).flowers.every(isBonus)).toBe(true);
    }
  });

  it("sorts each rack as a player would hold it", () => {
    const state = startGame(rng(5));
    const order = new Map(buildWall().map((tile, index) => [tileFace(tile), index]));

    for (const seat of SEATS) {
      const positions = handOf(state, seat).tiles.map((tile) => order.get(tileFace(tile)) ?? -1);
      expect([...positions]).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it("starts every seat with no melds and an empty pond", () => {
    const state = startGame(rng());

    for (const seat of SEATS) {
      expect(handOf(state, seat).melds).toEqual([]);
      expect(handOf(state, seat).discards).toEqual([]);
    }
  });

  it("deals a different wall from a different seed", () => {
    const a = startGame(rng(1));
    const b = startGame(rng(2));

    expect(a.wall.map((tile) => tile.id)).not.toEqual(b.wall.map((tile) => tile.id));
  });

  it("is deterministic for one seed", () => {
    const a = startGame(rng(4));
    const b = startGame(rng(4));

    expect(a.wall.map((tile) => tile.id)).toEqual(b.wall.map((tile) => tile.id));
    expect(handOf(a, 0).tiles.map((tile) => tile.id)).toEqual(
      handOf(b, 0).tiles.map((tile) => tile.id),
    );
  });

  it("does not mutate a dealt state when another game is dealt", () => {
    const state = startGame(rng(8));
    const before = handOf(state, 0).tiles.map((tile) => tile.id);
    startGame(rng(9));

    expect(handOf(state, 0).tiles.map((tile) => tile.id)).toEqual(before);
  });

  it("deals off the front of the wall in seat order", () => {
    // `buildWall` opens with four 1-of-bamboo, so with an RNG that never swaps East
    // holds them — which proves the deal reads the front of the wall, East first.
    const state = startGame(identity);

    expect(tileFace(handOf(state, 0).tiles[0])).toBe("bamboo-1");
  });
});

describe("replaceBonusTiles", () => {
  it("leaves a rack with no bonus tiles untouched", () => {
    const tiles = [tileWithFace("bamboo-1"), tileWithFace("circles-5")];
    const wall = [tileWithFace("characters-9")];

    const result = replaceBonusTiles(tiles, wall);

    expect(result.tiles).toEqual(tiles);
    expect(result.flowers).toEqual([]);
    expect(result.wall).toEqual(wall);
  });

  it("sets a flower aside and draws a replacement", () => {
    const flower = tileWithFace("flower-plum");
    const replacement = tileWithFace("characters-9");

    const result = replaceBonusTiles([tileWithFace("bamboo-1"), flower], [replacement]);

    expect(result.flowers).toEqual([flower]);
    expect(result.tiles.map(tileFace)).toEqual(["bamboo-1", "characters-9"]);
    expect(result.wall).toEqual([]);
  });

  it("replaces a replacement that is itself a bonus tile", () => {
    const flower = tileWithFace("flower-plum");
    const season = tileWithFace("season-spring");
    const playable = tileWithFace("circles-3");

    const result = replaceBonusTiles([flower], [season, playable]);

    expect(result.flowers).toEqual([flower, season]);
    expect(result.tiles).toEqual([playable]);
    expect(result.wall).toEqual([]);
  });

  it("stops when the wall runs out rather than looping forever", () => {
    const flower = tileWithFace("flower-plum");

    const result = replaceBonusTiles([flower], []);

    expect(result.flowers).toEqual([flower]);
    expect(result.tiles).toEqual([]);
    expect(result.wall).toEqual([]);
  });

  it("keeps the hand size when a flower is replaced", () => {
    const tiles = [tileWithFace("flower-plum"), tileWithFace("bamboo-2")];
    const wall = [tileWithFace("circles-7"), tileWithFace("characters-1")];

    const result = replaceBonusTiles(tiles, wall);

    expect(result.tiles).toHaveLength(tiles.length);
  });

  it("does not mutate its arguments", () => {
    const tiles = [tileWithFace("flower-plum"), tileWithFace("bamboo-2")];
    const wall = [tileWithFace("circles-7")];

    replaceBonusTiles(tiles, wall);

    expect(tiles.map(tileFace)).toEqual(["flower-plum", "bamboo-2"]);
    expect(wall.map(tileFace)).toEqual(["circles-7"]);
  });
});

/* -----------------------------------------------------------------------------------
   Phase 2 — the call detector and the win evaluator.

   Hands are written as face strings through `hand()` rather than built from a dealt
   wall, for the reason `game-blackjack.test.ts` stacks its shoe: dealing until the
   wanted shape turns up hides the test subject and re-rolls whenever a constant
   changes. Spelling the hand out states the case in the test itself.
----------------------------------------------------------------------------------- */

/**
 * Tiles from a compact face list, e.g. `hand("b1 b2 b3 c5 c5")`.
 *
 * `b`/`c`/`k` are bamboo, circles and characters; `e s w n` the winds and `R G W` the
 * dragons. Each call gets fresh ids, so two tiles of one face are distinguishable
 * exactly as the four physical copies are.
 */
let nextTileId = 10_000;
function hand(spec: string): Tile[] {
  return spec
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      nextTileId += 1;
      const id = nextTileId;
      const suits: Record<string, TileSuit> = {
        b: "bamboo",
        c: "circles",
        k: "characters",
      };
      const winds: Record<string, Wind> = {
        e: "east",
        s: "south",
        w: "west",
        n: "north",
      };
      const dragons: Record<string, Dragon> = { R: "red", G: "green", W: "white" };

      if (token in winds) return { id, kind: "wind", wind: winds[token] } as Tile;
      if (token in dragons) return { id, kind: "dragon", dragon: dragons[token] } as Tile;

      const suit = suits[token[0]];
      const rank = Number(token.slice(1));
      if (!suit || !Number.isInteger(rank) || rank < 1 || rank > 9) {
        throw new Error(`bad tile token: ${token}`);
      }
      return { id, kind: "suited", suit, rank: rank as TileRank } as Tile;
    });
}

/** One tile from a face token. */
function one(token: string): Tile {
  return hand(token)[0];
}

/** A hand at a seat, with optional melds — what `getAvailableCalls` takes. */
function seatHand(seat: Seat, spec: string, melds: Meld[] = []): MahjongHand {
  return { seat, tiles: hand(spec), melds, flowers: [], discards: [] };
}

/** A declared meld of a given kind. Its exact tiles never matter to the call detector. */
function meld(kind: Meld["kind"], spec: string): Meld {
  return { kind, tiles: hand(spec), concealed: false, claimedFrom: undefined };
}

describe("isWinningHand", () => {
  it("accepts four runs and a pair", () => {
    expect(isWinningHand(hand("b1 b2 b3 b4 b5 b6 c1 c2 c3 k7 k8 k9 e e"))).toBe(true);
  });

  it("accepts four triplets and a pair", () => {
    expect(isWinningHand(hand("b1 b1 b1 c5 c5 c5 k9 k9 k9 R R R e e"))).toBe(true);
  });

  it("accepts a mix of runs and triplets", () => {
    expect(isWinningHand(hand("b1 b2 b3 c5 c5 c5 k7 k8 k9 G G G w w"))).toBe(true);
  });

  it("accepts a run at the bottom terminal, 1-2-3", () => {
    expect(isWinningHand(hand("b1 b2 b3 c1 c2 c3 k1 k2 k3 b7 b8 b9 R R"))).toBe(true);
  });

  it("accepts a run at the top terminal, 7-8-9", () => {
    expect(isWinningHand(hand("b7 b8 b9 c7 c8 c9 k7 k8 k9 c1 c2 c3 n n"))).toBe(true);
  });

  it("rejects a run that wraps from 9 round to 1", () => {
    // b8 b9 k1 is not a run: the suits differ and ranks do not wrap.
    expect(isWinningHand(hand("b8 b9 k1 c1 c2 c3 k7 k8 k9 b1 b2 b3 e e"))).toBe(false);
  });

  it("rejects a run spanning two suits", () => {
    expect(isWinningHand(hand("b1 c2 k3 c1 c2 c3 k7 k8 k9 b7 b8 b9 e e"))).toBe(false);
  });

  it("rejects a run of honours", () => {
    // The winds are consecutive in seat order but never form a run.
    expect(isWinningHand(hand("e s w b1 b2 b3 c1 c2 c3 k1 k2 k3 R R"))).toBe(false);
  });

  it("rejects a hand one tile short of complete", () => {
    expect(isWinningHand(hand("b1 b2 b3 b4 b5 b6 c1 c2 c3 k7 k8 k9 e"))).toBe(false);
  });

  it("rejects thirteen tiles with no pair", () => {
    expect(isWinningHand(hand("b1 b2 b3 b4 b5 b6 c1 c2 c3 k7 k8 k9 e s"))).toBe(false);
  });

  it("finds the eye when a naive first-pair choice would fail", () => {
    // 2-2-3-3-4-4 in one suit: only reading 2-2 (or 4-4) as the eye leaves a run pair.
    // Taking 3-3 as the eye leaves 2-2-4-4, which decomposes into nothing.
    expect(isWinningHand(hand("c2 c2 c3 c3 c4 c4 b1 b2 b3 k7 k8 k9 e e"))).toBe(true);
  });

  it("prefers a run over a triplet when only that reading wins", () => {
    // b1 b1 b1 b2 b3 is a triplet plus a broken pair, or a run plus a pair — the
    // decomposer has to try the run to find the win.
    expect(isWinningHand(hand("b1 b1 b1 b2 b3 c1 c2 c3 k7 k8 k9 R R R"))).toBe(true);
  });

  it("counts a declared meld as one of the four sets", () => {
    const melds = [meld("pung", "R R R")];

    // Eleven concealed tiles: three sets and the eye.
    expect(isWinningHand(hand("b1 b2 b3 c1 c2 c3 k7 k8 k9 e e"), melds)).toBe(true);
  });

  it("counts a kong as one set despite holding four tiles", () => {
    const melds = [meld("kong", "R R R R")];

    expect(isWinningHand(hand("b1 b2 b3 c1 c2 c3 k7 k8 k9 e e"), melds)).toBe(true);
  });

  it("wins on four declared melds and a pair in hand", () => {
    const melds = [
      meld("pung", "R R R"),
      meld("pung", "G G G"),
      meld("chow", "b1 b2 b3"),
      meld("kong", "c5 c5 c5 c5"),
    ];

    expect(isWinningHand(hand("e e"), melds)).toBe(true);
    expect(isWinningHand(hand("e s"), melds)).toBe(false);
  });

  it("rejects a rack whose size does not match its melds", () => {
    const melds = [meld("pung", "R R R")];

    // Fourteen concealed tiles alongside a declared pung is too many.
    expect(isWinningHand(hand("b1 b2 b3 b4 b5 b6 c1 c2 c3 k7 k8 k9 e e"), melds)).toBe(false);
  });

  it("ignores bonus tiles sitting beside the hand", () => {
    const flower: Tile = { id: 999, kind: "flower", flower: "plum" };
    const tiles = [...hand("b1 b2 b3 b4 b5 b6 c1 c2 c3 k7 k8 k9 e e"), flower];

    expect(isWinningHand(tiles)).toBe(true);
  });
});

describe("isSevenPairs", () => {
  it("accepts seven distinct pairs", () => {
    expect(isSevenPairs(hand("b1 b1 b3 b3 c2 c2 c7 c7 k5 k5 e e R R"))).toBe(true);
  });

  it("is accepted by isWinningHand as a concealed hand", () => {
    expect(isWinningHand(hand("b1 b1 b3 b3 c2 c2 c7 c7 k5 k5 e e R R"))).toBe(true);
  });

  it("rejects four of a kind standing in for two pairs", () => {
    expect(isSevenPairs(hand("b1 b1 b1 b1 c2 c2 c7 c7 k5 k5 e e R R"))).toBe(false);
  });

  it("rejects a hand that is not fourteen tiles", () => {
    expect(isSevenPairs(hand("b1 b1 b3 b3 c2 c2 c7 c7 k5 k5 e e R"))).toBe(false);
  });

  it("is not available once a meld is declared", () => {
    // Seven pairs is concealed-only, so a declared meld rules it out even though the
    // concealed tiles would otherwise read as pairs.
    const melds = [meld("pung", "G G G")];

    expect(isWinningHand(hand("b1 b1 b3 b3 c2 c2 c7 c7 k5 k5 e e R R"), melds)).toBe(false);
  });
});

describe("canDeclareWin", () => {
  it("completes a hand with the claimed tile", () => {
    const tiles = hand("b1 b2 b3 b4 b5 b6 c1 c2 c3 k7 k8 k9 e");

    expect(canDeclareWin(tiles, one("e"))).toBe(true);
  });

  it("rejects a tile that does not complete the hand", () => {
    const tiles = hand("b1 b2 b3 b4 b5 b6 c1 c2 c3 k7 k8 k9 e");

    expect(canDeclareWin(tiles, one("s"))).toBe(false);
  });

  it("does not mutate the hand it is given", () => {
    const tiles = hand("b1 b2 b3 b4 b5 b6 c1 c2 c3 k7 k8 k9 e");
    canDeclareWin(tiles, one("e"));

    expect(tiles).toHaveLength(13);
  });
});

describe("winningWaits", () => {
  it("names the single tile a one-away hand is fishing for", () => {
    expect(winningWaits(hand("b1 b2 b3 b4 b5 b6 c1 c2 c3 k7 k8 k9 e"))).toEqual([
      "wind-east",
    ]);
  });

  it("finds both ends of an open wait", () => {
    // b1 b2 waiting on b3, plus the pair — b3 completes the run.
    const waits = winningWaits(hand("b1 b2 c1 c2 c3 k7 k8 k9 R R R e e"));

    expect(waits).toContain("bamboo-3");
  });

  it("finds a two-sided wait on both faces", () => {
    // c3 c4 waits on c2 and c5.
    const waits = winningWaits(hand("c3 c4 b1 b2 b3 k7 k8 k9 R R R e e"));

    expect([...waits].sort()).toEqual(["circles-2", "circles-5"]);
  });

  it("finds a closed wait in the middle of a run", () => {
    // b1 b3 needs exactly b2 — a wait a naive edge check would miss.
    const waits = winningWaits(hand("b1 b3 c1 c2 c3 k7 k8 k9 R R R e e"));

    expect(waits).toEqual(["bamboo-2"]);
  });

  it("finds a wait on either of two pairs, the shanpon shape", () => {
    // R R and e e: whichever fills becomes the triplet, the other the eye.
    const waits = winningWaits(hand("R R e e b1 b2 b3 c1 c2 c3 k7 k8 k9"));

    expect([...waits].sort()).toEqual(["dragon-red", "wind-east"]);
  });

  it("returns nothing for a hand two or more away", () => {
    expect(winningWaits(hand("b1 b2 b4 b5 c1 c3 c5 k2 k4 k6 e s w"))).toEqual([]);
  });

  it("respects declared melds when computing waits", () => {
    const melds = [meld("pung", "R R R"), meld("pung", "G G G")];
    const waits = winningWaits(hand("b1 b2 b3 c1 c2 c3 e"), melds);

    expect(waits).toEqual(["wind-east"]);
  });

  it("drives isOneAway", () => {
    expect(isOneAway(hand("b1 b2 b3 b4 b5 b6 c1 c2 c3 k7 k8 k9 e"))).toBe(true);
    expect(isOneAway(hand("b1 b2 b4 b5 c1 c3 c5 k2 k4 k6 e s w"))).toBe(false);
  });
});

describe("getAvailableCalls", () => {
  it("offers a pung to a hand holding two of the discard", () => {
    const player = seatHand(2, "R R b1 b2 b5 c3 c7 c9 k2 k4 k6 e s");

    const calls = getAvailableCalls(player, one("R"), 0);

    expect(calls.map((call) => call.action)).toEqual(["pung"]);
    expect(calls[0].tiles).toHaveLength(2);
    expect(calls[0].seat).toBe(2);
  });

  it("offers both kong and pung to a hand holding three, strongest first", () => {
    const player = seatHand(2, "R R R b1 b2 b5 c3 c7 c9 k2 k4 k6 e");

    const calls = getAvailableCalls(player, one("R"), 0);

    expect(calls.map((call) => call.action)).toEqual(["kong", "pung"]);
    expect(calls[0].tiles).toHaveLength(3);
    expect(calls[1].tiles).toHaveLength(2);
  });

  it("offers nothing to a hand holding only one of the discard", () => {
    const player = seatHand(2, "R b1 b2 b5 c3 c7 c9 k2 k4 k6 e s w");

    expect(getAvailableCalls(player, one("R"), 0)).toEqual([]);
  });

  it("offers a chow only from the seat to the left", () => {
    // Seat 2 sits to seat 1's left, so seat 2 may chow seat 1's discard.
    const player = seatHand(2, "b2 b3 c1 c5 c7 c9 k2 k4 k6 e s w R");

    expect(getAvailableCalls(player, one("b1"), 1).map((call) => call.action)).toEqual([
      "chow",
    ]);
    // The same tile from any other seat is not chowable.
    expect(getAvailableCalls(player, one("b1"), 0)).toEqual([]);
    expect(getAvailableCalls(player, one("b1"), 3)).toEqual([]);
  });

  it("offers every chow shape the hand can make", () => {
    // Holding b1 b2 b4 b5, a discarded b3 can be taken three ways.
    const player = seatHand(1, "b1 b2 b4 b5 c7 c9 k2 k4 k6 e s w R");

    const chows = getAvailableCalls(player, one("b3"), 0).filter(
      (call) => call.action === "chow",
    );

    expect(chows).toHaveLength(3);
    const shapes = chows
      .map((call) => call.tiles.map((tile) => (tile.kind === "suited" ? tile.rank : 0)).sort())
      .sort();
    expect(shapes).toEqual([
      [1, 2],
      [2, 4],
      [4, 5],
    ]);
  });

  it("does not offer a chow that would run past 9", () => {
    // b8 b9 in hand cannot chow a discarded b7 upward; only 8-9 below it works.
    const player = seatHand(1, "b8 b9 c7 c9 k2 k4 k6 e s w R G n");

    const chows = getAvailableCalls(player, one("b7"), 0).filter(
      (call) => call.action === "chow",
    );

    expect(chows).toHaveLength(1);
    expect(chows[0].tiles.map((tile) => (tile.kind === "suited" ? tile.rank : 0)).sort()).toEqual(
      [8, 9],
    );
  });

  it("does not offer a chow that would run below 1", () => {
    const player = seatHand(1, "b2 b3 c7 c9 k2 k4 k6 e s w R G n");

    const chows = getAvailableCalls(player, one("b1"), 0).filter(
      (call) => call.action === "chow",
    );

    expect(chows).toHaveLength(1);
    expect(chows[0].tiles.map((tile) => (tile.kind === "suited" ? tile.rank : 0)).sort()).toEqual(
      [2, 3],
    );
  });

  it("never offers a chow on an honour", () => {
    const player = seatHand(1, "e e s w R G b1 b2 c4 c5 k7 k8 n");

    expect(getAvailableCalls(player, one("s"), 0).map((call) => call.action)).toEqual([]);
    // A pair of east is still pungable, which proves the honour is not simply skipped.
    expect(getAvailableCalls(player, one("e"), 0).map((call) => call.action)).toEqual([
      "pung",
    ]);
  });

  it("never offers a chow across suits", () => {
    const player = seatHand(1, "b2 c3 c7 c9 k2 k4 k6 e s w R G n");

    expect(getAvailableCalls(player, one("b1"), 0)).toEqual([]);
  });

  it("lists a win first, ahead of a pung on the same tile", () => {
    // Thirteen tiles: three runs, R R, and e e. A discarded R makes the R triplet the
    // fourth set with e e as the eye — so the same tile both wins and pungs, and the
    // win has to come first. (A waiting hand holds 13; a 14-tile rack here would make
    // the claim a 15th tile and no win would be possible at all.)
    const player = seatHand(2, "b1 b2 b3 c1 c2 c3 k7 k8 k9 R R e e");

    const calls = getAvailableCalls(player, one("R"), 0);

    expect(calls[0].action).toBe("win");
    expect(calls.map((call) => call.action)).toContain("pung");
  });

  it("never lets a seat call its own discard", () => {
    const player = seatHand(0, "R R b1 b2 b5 c3 c7 c9 k2 k4 k6 e s");

    expect(getAvailableCalls(player, one("R"), 0)).toEqual([]);
  });

  it("offers nothing on a bonus tile", () => {
    const player = seatHand(2, "R R b1 b2 b5 c3 c7 c9 k2 k4 k6 e s");
    const flower: Tile = { id: 998, kind: "flower", flower: "orchid" };

    expect(getAvailableCalls(player, flower, 0)).toEqual([]);
  });

  it("considers declared melds when offering a win", () => {
    const melds = [meld("pung", "G G G"), meld("chow", "c1 c2 c3")];
    const player = seatHand(2, "b1 b2 b3 k7 k8 k9 e", melds);

    expect(getAvailableCalls(player, one("e"), 0).map((call) => call.action)).toContain(
      "win",
    );
  });

  it("names only tiles the hand actually holds in a call", () => {
    const player = seatHand(2, "R R b1 b2 b5 c3 c7 c9 k2 k4 k6 e s");
    const held = new Set(player.tiles.map((tile) => tile.id));

    for (const call of getAvailableCalls(player, one("R"), 0)) {
      for (const tile of call.tiles) expect(held.has(tile.id)).toBe(true);
    }
  });
});

describe("concealedKongOptions", () => {
  it("finds a face held four times", () => {
    const player = seatHand(1, "R R R R b1 b2 b5 c3 c7 c9 k2 k4 k6");

    const options = concealedKongOptions(player);

    expect(options).toHaveLength(1);
    expect(options[0]).toHaveLength(4);
  });

  it("finds nothing when the hand holds only three", () => {
    const player = seatHand(1, "R R R b1 b2 b5 c3 c7 c9 k2 k4 k6 e");

    expect(concealedKongOptions(player)).toEqual([]);
  });

  it("finds every four-of-a-kind in the hand", () => {
    const player = seatHand(1, "R R R R e e e e b1 b2 b5 c3 c7");

    expect(concealedKongOptions(player)).toHaveLength(2);
  });
});

/* -----------------------------------------------------------------------------------
   Phase 3 — the turn machine and call priority.

   States are built with `table()` rather than played into from a deal, for the reason
   the hands above are spelled out: reaching "seat 2 can pung while seat 1 can chow"
   by dealing would take an unreproducible number of turns and would hide the case.
----------------------------------------------------------------------------------- */

/** A whole table from four hand specs, ready to discard. Seat 0 is to play. */
function table(
  specs: readonly [string, string, string, string],
  options: {
    wall?: string;
    turn?: Seat;
    melds?: Partial<Record<Seat, Meld[]>>;
  } = {},
): MahjongState {
  return {
    hands: SEATS.map((seat) => ({
      seat,
      tiles: hand(specs[seat]),
      melds: options.melds?.[seat] ?? [],
      flowers: [],
      discards: [],
    })),
    wall: hand(options.wall ?? "c9 c9 k1 k1 b6 b6 e s w n R G b4 c4"),
    turn: options.turn ?? 0,
    phase: "awaiting-discard",
    liveDiscard: undefined,
    openCalls: [],
    drawnId: undefined,
    winner: undefined,
    selfDrawn: false,
    outcome: "playing",
  };
}

/** The tile in a seat's rack with this face. What a test discards. */
function held(state: MahjongState, seat: Seat, face: string): Tile {
  const tile = handOf(state, seat).tiles.find((candidate) => tileFace(candidate) === face);
  if (!tile) throw new Error(`seat ${seat} does not hold ${face}`);
  return tile;
}

describe("claimOrder", () => {
  it("starts at the discarder's left and excludes the discarder", () => {
    expect(claimOrder(0)).toEqual([1, 2, 3]);
    expect(claimOrder(2)).toEqual([3, 0, 1]);
    expect(claimOrder(3)).toEqual([0, 1, 2]);
  });
});

describe("discardTile", () => {
  it("takes the tile out of the rack and puts it on the table", () => {
    const state = table(["b1 b2 b3 c1 c2 c3 k7 k8 k9 R R G G n", "e e e s s s w w w n n b5 b5", "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w", "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w"]);
    const tile = held(state, 0, "wind-north");

    const next = discardTile(state, tile);

    expect(next.phase).toBe("awaiting-calls");
    expect(next.liveDiscard?.id).toBe(tile.id);
    expect(handOf(next, 0).tiles.some((t) => t.id === tile.id)).toBe(false);
    // Not in the pond yet — only a closed window puts it there.
    expect(handOf(next, 0).discards).toEqual([]);
  });

  it("ignores a discard from a seat that is not to play", () => {
    const state = table(["b1 b2 b3 c1 c2 c3 k7 k8 k9 R R G G n", "e e e s s s w w w n n b5 b5", "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w", "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w"]);
    const notMine = held(state, 2, "wind-west");

    expect(discardTile(state, notMine)).toBe(state);
  });

  it("ignores a tile the seat does not hold", () => {
    const state = table(["b1 b2 b3 c1 c2 c3 k7 k8 k9 R R G G n", "e e e s s s w w w n n b5 b5", "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w", "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w"]);
    const stranger = one("c8");

    expect(discardTile(state, stranger)).toBe(state);
  });

  it("skips the call window entirely when nobody can claim", () => {
    // Nobody holds a pair of north or a run around it.
    const state = table([
      "b1 b2 b3 c1 c2 c3 k7 k8 k9 R R G G n",
      "b5 c5 k5 b7 c7 k7 b9 c9 k9 e s w R",
      "b1 c1 k1 b3 c3 k3 e s w R G n b6",
      "b2 c2 k2 b4 c4 k4 e s w R G b8 c8",
    ]);

    const next = discardTile(state, held(state, 0, "wind-north"));

    // Straight to the next seat, tile in the pond, no window flashed.
    expect(next.phase).toBe("awaiting-discard");
    expect(next.liveDiscard).toBeUndefined();
    expect(handOf(next, 0).discards).toHaveLength(1);
    expect(next.turn).toBe(1);
  });
});

describe("call priority", () => {
  it("gives a pung precedence over a chow", () => {
    // Seat 1 can chow b3 (holds b1 b2, sits to seat 0's left); seat 2 can pung it.
    const state = table([
      "b3 b7 c1 c2 c3 k7 k8 k9 R R G G n",
      "b1 b2 c5 c6 c7 k2 k3 k4 e s w n R",
      "b3 b3 c9 k1 k5 b8 e e s s w w n",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
    ]);

    const open = discardTile(state, held(state, 0, "bamboo-3"));
    expect(open.openCalls[0].action).toBe("pung");
    expect(open.openCalls[0].seat).toBe(2);

    const resolved = resolveCalls(open);
    expect(handOf(resolved, 2).melds[0].kind).toBe("pung");
    expect(resolved.turn).toBe(2);
  });

  it("gives a win precedence over a pung", () => {
    // Seat 3 wins on R; seat 2 could only pung it.
    const state = table([
      "R b7 c1 c2 c3 k7 k8 k9 G G n n w",
      "b1 b2 c5 c6 c7 k2 k3 k4 e s w n R",
      "R R c9 k1 k5 b8 e e s s w w n",
      "b1 b2 b3 c1 c2 c3 k7 k8 k9 R R e e",
    ]);

    const open = discardTile(state, held(state, 0, "dragon-red"));

    expect(open.openCalls[0].action).toBe("win");
    expect(open.openCalls[0].seat).toBe(3);

    const resolved = resolveCalls(open);
    expect(resolved.outcome).toBe("lost");
    expect(resolved.winner).toBe(3);
  });

  it("breaks a tie between two pungs in turn order from the discarder", () => {
    // Seats 2 and 3 both hold a pair of west. Seat 2 is nearer seat 0's left.
    const state = table([
      "w b7 c1 c2 c3 k7 k8 k9 R R G G n",
      "b1 b5 c5 c6 c7 k2 k3 k4 e s n n R",
      "w w c9 k1 k5 b8 e e s s R G n",
      "w w c8 k4 k6 b9 e s s R G n n",
    ]);

    const open = discardTile(state, held(state, 0, "wind-west"));
    const resolved = resolveCalls(open);

    expect(resolved.turn).toBe(2);
    expect(handOf(resolved, 2).melds).toHaveLength(1);
    expect(handOf(resolved, 3).melds).toHaveLength(0);
  });

  it("breaks a tie between two wins in turn order from the discarder", () => {
    const winning = "b1 b2 b3 c1 c2 c3 k7 k8 k9 R R e e";
    const state = table([
      "G b7 c4 c5 c6 k1 k2 k3 R R n n w",
      "b1 b5 c5 c6 c7 k2 k3 k4 e s n n R",
      winning.replace("R R", "G G"),
      winning.replace("R R", "G G"),
    ]);

    const open = discardTile(state, held(state, 0, "dragon-green"));
    const resolved = resolveCalls(open);

    // Both could ron; the nearer seat to the discarder's left takes it.
    expect(resolved.winner).toBe(2);
  });

  it("lets a lower-priority claim through when the higher one passes", () => {
    // Seat 2 can pung, seat 1 can chow. Seat 2 declines, so the chow stands.
    const state = table([
      "b3 b7 c1 c2 c3 k7 k8 k9 R R G G n",
      "b1 b2 c5 c6 c7 k2 k3 k4 e s w n R",
      "b3 b3 c9 k1 k5 b8 e e s s w w n",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
    ]);

    const open = discardTile(state, held(state, 0, "bamboo-3"));
    const resolved = resolveCalls(open, [2]);

    expect(handOf(resolved, 1).melds[0].kind).toBe("chow");
    expect(resolved.turn).toBe(1);
  });

  it("falls back to passing the tile when every eligible seat declines", () => {
    // This is what the call-window timeout resolves to.
    const state = table([
      "b3 b7 c1 c2 c3 k7 k8 k9 R R G G n",
      "b1 b2 c5 c6 c7 k2 k3 k4 e s w n R",
      "b3 b3 c9 k1 k5 b8 e e s s w w n",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
    ]);

    const open = discardTile(state, held(state, 0, "bamboo-3"));
    const resolved = resolveCalls(open, [1, 2, 3]);

    expect(handOf(resolved, 0).discards).toHaveLength(1);
    expect(resolved.turn).toBe(1);
    expect(resolved.phase).toBe("awaiting-discard");
    // Seat 1 drew, so it holds fourteen and can discard.
    expect(handOf(resolved, 1).tiles).toHaveLength(14);
  });
});

describe("applyCall", () => {
  it("moves the claimed tile into the meld, not the pond", () => {
    const state = table([
      "b3 b7 c1 c2 c3 k7 k8 k9 R R G G n",
      "b1 b2 c5 c6 c7 k2 k3 k4 e s w n R",
      "b3 b3 c9 k1 k5 b8 e e s s w w n",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
    ]);
    const tile = held(state, 0, "bamboo-3");

    const resolved = resolveCalls(discardTile(state, tile));

    expect(handOf(resolved, 0).discards).toEqual([]);
    expect(handOf(resolved, 2).melds[0].tiles.some((t) => t.id === tile.id)).toBe(true);
  });

  it("records who the meld was claimed from and that it is not concealed", () => {
    const state = table([
      "b3 b7 c1 c2 c3 k7 k8 k9 R R G G n",
      "b1 b2 c5 c6 c7 k2 k3 k4 e s w n R",
      "b3 b3 c9 k1 k5 b8 e e s s w w n",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
    ]);

    const resolved = resolveCalls(discardTile(state, held(state, 0, "bamboo-3")));
    const meld = handOf(resolved, 2).melds[0];

    expect(meld.claimedFrom).toBe(0);
    expect(meld.concealed).toBe(false);
  });

  it("does not let the claimant draw after a pung", () => {
    // The point of a pung: it is the claimant's turn to discard immediately.
    const state = table([
      "b3 b7 c1 c2 c3 k7 k8 k9 R R G G n",
      "b1 b2 c5 c6 c7 k2 k3 k4 e s w n R",
      "b3 b3 c9 k1 k5 b8 e e s s w w n",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
    ]);
    const before = state.wall.length;

    const resolved = resolveCalls(discardTile(state, held(state, 0, "bamboo-3")));

    expect(resolved.wall).toHaveLength(before);
    expect(resolved.phase).toBe("awaiting-discard");
    // Eleven concealed plus a three-tile meld is a discardable fourteen.
    expect(handOf(resolved, 2).tiles).toHaveLength(11);
  });

  it("draws a replacement after a claimed kong", () => {
    const state = table([
      "w b7 c1 c2 c3 k7 k8 k9 R R G G n",
      "b1 b5 c5 c6 c7 k2 k3 k4 e s n n R",
      "w w w c9 k1 k5 b8 e e s s R G",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n b9",
    ]);
    const before = state.wall.length;

    const open = discardTile(state, held(state, 0, "wind-west"));
    expect(open.openCalls[0].action).toBe("kong");

    const resolved = resolveCalls(open);

    // Four tiles for one set leaves the hand short, so it draws back up.
    expect(resolved.wall).toHaveLength(before - 1);
    expect(handOf(resolved, 2).melds[0].kind).toBe("kong");
    expect(handOf(resolved, 2).melds[0].tiles).toHaveLength(4);
    expect(handOf(resolved, 2).tiles).toHaveLength(11);
  });

  it("puts the winning tile into the winner's hand", () => {
    const state = table([
      "R b7 c1 c2 c3 k7 k8 k9 G G n n w",
      "b1 b2 c5 c6 c7 k2 k3 k4 e s w n R",
      "c9 k1 k5 b8 e e s s w w n G b6",
      "b1 b2 b3 c1 c2 c3 k7 k8 k9 R R e e",
    ]);
    const tile = held(state, 0, "dragon-red");

    const resolved = resolveCalls(discardTile(state, tile));

    expect(handOf(resolved, 3).tiles).toHaveLength(14);
    expect(handOf(resolved, 3).tiles.some((t) => t.id === tile.id)).toBe(true);
  });

  it("rejects a call naming tiles the claimant does not hold", () => {
    const state = table([
      "b3 b7 c1 c2 c3 k7 k8 k9 R R G G n",
      "b1 b2 c5 c6 c7 k2 k3 k4 e s w n R",
      "b3 b3 c9 k1 k5 b8 e e s s w w n",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
    ]);
    const open = discardTile(state, held(state, 0, "bamboo-3"));
    const forged: MahjongCall = { seat: 3, action: "pung", tiles: hand("b3 b3") };

    expect(applyCall(open, forged)).toBe(open);
  });

  it("reports the human winning as won and a bot winning as lost", () => {
    const winning = "b1 b2 b3 c1 c2 c3 k7 k8 k9 R R e e";
    const humanWins = table([
      "G b7 c4 c5 c6 k1 k2 k3 R R n n w",
      winning.replace("R R", "G G"),
      "c9 k1 k5 b8 e e s s w w n b6 b9",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R n w b9",
    ]);

    const resolved = resolveCalls(discardTile(humanWins, held(humanWins, 0, "dragon-green")));

    expect(resolved.winner).toBe(HUMAN_SEAT);
    expect(resolved.outcome).toBe("won");
  });
});

describe("drawTile", () => {
  it("draws one tile for the seat to play and marks it", () => {
    const state = { ...table(["b1 b2 b3 c1 c2 c3 k7 k8 k9 R R G n", "e e e s s s w w w n n b5 b5", "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w", "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w"]) };
    const before = state.wall.length;

    const next = drawTile(state);

    expect(handOf(next, 0).tiles).toHaveLength(14);
    expect(next.wall).toHaveLength(before - 1);
    expect(next.drawnId).toBeDefined();
    expect(handOf(next, 0).tiles.some((t) => t.id === next.drawnId)).toBe(true);
  });

  it("does not draw for a seat already holding a full hand", () => {
    // The dealer at the opening holds fourteen and owes no draw.
    const state = table(["b1 b2 b3 c1 c2 c3 k7 k8 k9 R R G G n", "e e e s s s w w w n n b5 b5", "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w", "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w"]);

    expect(drawTile(state)).toBe(state);
  });

  it("sets a drawn flower aside and draws again", () => {
    const state = {
      ...table(["b1 b2 b3 c1 c2 c3 k7 k8 k9 R R G n", "e e e s s s w w w n n b5 b5", "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w", "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w"]),
      wall: [{ id: 5001, kind: "flower", flower: "plum" } as Tile, ...hand("c8 b9")],
    };

    const next = drawTile(state);

    expect(handOf(next, 0).flowers).toHaveLength(1);
    expect(handOf(next, 0).tiles).toHaveLength(14);
    expect(handOf(next, 0).tiles.some(isBonus)).toBe(false);
  });

  it("ends the hand in a draw when the wall is empty", () => {
    const state = { ...table(["b1 b2 b3 c1 c2 c3 k7 k8 k9 R R G n", "e e e s s s w w w n n b5 b5", "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w", "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w"]), wall: [] };

    const next = drawTile(state);

    expect(next.phase).toBe("ended");
    expect(next.outcome).toBe("draw");
    expect(next.winner).toBeUndefined();
  });
});

describe("declareSelfWin", () => {
  it("ends the hand when the rack is already complete", () => {
    const state = table([
      "b1 b2 b3 c1 c2 c3 k7 k8 k9 b7 b8 b9 R R",
      "e e e s s s w w w n n b5 b5",
      "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
    ]);

    const next = declareSelfWin(state);

    expect(next.phase).toBe("ended");
    expect(next.winner).toBe(0);
    expect(next.outcome).toBe("lost");
  });

  it("does nothing on a hand that has not won", () => {
    const state = table([
      "b1 b2 b3 c1 c2 c3 k7 k8 k9 b7 b8 b9 R G",
      "e e e s s s w w w n n b5 b5",
      "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
    ]);

    expect(declareSelfWin(state)).toBe(state);
  });
});

describe("declareConcealedKong", () => {
  it("lays four concealed tiles down and draws a replacement", () => {
    const state = table([
      "R R R R b1 b2 b3 c1 c2 c3 k7 k8 k9 n",
      "e e e s s s w w w n n b5 b5",
      "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
    ]);
    const four = handOf(state, 0).tiles.filter((t) => tileFace(t) === "dragon-red");
    const before = state.wall.length;

    const next = declareConcealedKong(state, four);

    expect(handOf(next, 0).melds[0].kind).toBe("kong");
    expect(handOf(next, 0).melds[0].concealed).toBe(true);
    expect(handOf(next, 0).melds[0].claimedFrom).toBeUndefined();
    expect(next.wall).toHaveLength(before - 1);
  });

  it("refuses four tiles that are not the same face", () => {
    const state = table([
      "R R R G b1 b2 b3 c1 c2 c3 k7 k8 k9 n",
      "e e e s s s w w w n n b5 b5",
      "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
    ]);
    const mixed = handOf(state, 0).tiles.slice(0, 4);

    expect(declareConcealedKong(state, mixed)).toBe(state);
  });

  it("refuses tiles the seat does not hold", () => {
    const state = table([
      "R R R b1 b2 b3 c1 c2 c3 k7 k8 k9 n w",
      "e e e s s s w w w n n b5 b5",
      "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
    ]);

    expect(declareConcealedKong(state, hand("R R R R"))).toBe(state);
  });
});

describe("tile conservation across a played hand", () => {
  it("never creates or loses a tile through discards and calls", () => {
    let state = table([
      "b3 b7 c1 c2 c3 k7 k8 k9 R R G G n",
      "b1 b2 c5 c6 c7 k2 k3 k4 e s w n R",
      "b3 b3 c9 k1 k5 b8 e e s s w w n",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
    ]);
    const total = allTiles(state).length;

    state = discardTile(state, held(state, 0, "bamboo-3"));
    expect(allTiles(state)).toHaveLength(total);

    state = resolveCalls(state);
    expect(allTiles(state)).toHaveLength(total);

    state = discardTile(state, handOf(state, state.turn).tiles[0]);
    expect(allTiles(state)).toHaveLength(total);

    const ids = allTiles(state).map((tile) => tile.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("plays a whole hand from the deal to an ending without losing a tile", () => {
    let state = startGame(rng(2024));
    const total = allTiles(state).length;
    let guard = 0;

    while (!isHandOver(state) && guard < 400) {
      guard += 1;
      if (state.phase === "awaiting-discard") {
        const rack = handOf(state, state.turn).tiles;
        if (rack.length === 0) break;
        state = discardTile(state, rack[0]);
      } else {
        state = resolveCalls(state);
      }
      expect(allTiles(state)).toHaveLength(total);
    }

    expect(isHandOver(state)).toBe(true);
    expect(guard).toBeLessThan(400);
  });
});

describe("getSanitizedState", () => {
  it("shows the viewer their own tiles in full", () => {
    const state = table([
      "b1 b2 b3 c1 c2 c3 k7 k8 k9 R R G G n",
      "e e e s s s w w w n n b5 b5",
      "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
    ]);

    const view = getSanitizedState(state, HUMAN_SEAT);

    expect(view.seat).toBe(HUMAN_SEAT);
    expect(view.tiles).toHaveLength(13);
    expect(view.tiles).toEqual(handOf(state, HUMAN_SEAT).tiles);
  });

  it("redacts every opponent rack to a count", () => {
    const state = table([
      "b1 b2 b3 c1 c2 c3 k7 k8 k9 R R G G n",
      "e e e s s s w w w n n b5 b5",
      "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
    ]);

    const view = getSanitizedState(state, HUMAN_SEAT);
    const serialized = JSON.stringify(view);

    for (const seat of SEATS) {
      if (seat === HUMAN_SEAT) continue;
      // No opponent tile id may appear anywhere in the payload.
      for (const tile of handOf(state, seat).tiles) {
        expect(serialized).not.toContain(`"id":${tile.id}`);
      }
      expect(view.seats[seat].concealed).toBe(handOf(state, seat).tiles.length);
    }
  });

  it("does not disclose the wall, only its count", () => {
    const state = table([
      "b1 b2 b3 c1 c2 c3 k7 k8 k9 R R G G n",
      "e e e s s s w w w n n b5 b5",
      "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
    ]);

    const view = getSanitizedState(state, HUMAN_SEAT);
    const serialized = JSON.stringify(view);

    expect(view.wallCount).toBe(state.wall.length);
    for (const tile of state.wall) {
      expect(serialized).not.toContain(`"id":${tile.id}`);
    }
  });

  it("keeps melds, flowers and ponds visible, as they are on a real table", () => {
    const melds: Partial<Record<Seat, Meld[]>> = {
      2: [{ kind: "pung", tiles: hand("G G G"), concealed: false, claimedFrom: 1 }],
    };
    const state = table(
      [
        "b1 b2 b3 c1 c2 c3 k7 k8 k9 R R G G n",
        "e e e s s s w w w n n b5 b5",
        "c5 c6 c7 k2 k3 k4 b8 b8 n n w",
        "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
      ],
      { melds },
    );

    const view = getSanitizedState(state, HUMAN_SEAT);

    expect(view.seats[2].melds).toHaveLength(1);
    expect(view.seats[2].melds[0].tiles).toHaveLength(3);
  });

  it("shows each seat its own calls and nobody else's", () => {
    const state = table([
      "b3 b7 c1 c2 c3 k7 k8 k9 R R G G n",
      "b1 b2 c5 c6 c7 k2 k3 k4 e s w n R",
      "b3 b3 c9 k1 k5 b8 e e s s w w n",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
    ]);
    const open = discardTile(state, held(state, 0, "bamboo-3"));

    // Seat 1 sees only its chow, seat 2 only its pung, seat 3 nothing at all.
    expect(getSanitizedState(open, 1).calls.map((call) => call.action)).toEqual(["chow"]);
    expect(getSanitizedState(open, 2).calls.map((call) => call.action)).toEqual(["pung"]);
    expect(getSanitizedState(open, 3).calls).toEqual([]);
  });

  it("names each seat's wind, East at seat zero", () => {
    const state = table([
      "b1 b2 b3 c1 c2 c3 k7 k8 k9 R R G G n",
      "e e e s s s w w w n n b5 b5",
      "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
    ]);

    const view = getSanitizedState(state, HUMAN_SEAT);

    expect(view.seats.map((s) => s.wind)).toEqual(["east", "south", "west", "north"]);
  });
});

/* -----------------------------------------------------------------------------------
   Phase 4 — fan scoring and the bot policy.
----------------------------------------------------------------------------------- */

/** A finished hand, for scoring. Melds optional; flowers spelled out when they matter. */
function scoringHand(spec: string, extra: Partial<MahjongHand> = {}): MahjongHand {
  return { seat: 0, tiles: hand(spec), melds: [], flowers: [], discards: [], ...extra };
}

/** The fan ids a hand earned, for asserting a pattern was or was not seen. */
function fanIds(hand: MahjongHand, options: Parameters<typeof handFans>[1] = {}): string[] {
  return handFans(hand, options).map((entry) => entry.id);
}

describe("handFans", () => {
  it("earns nothing for a hand that has not won", () => {
    expect(handFans(scoringHand("b1 b2 b3 c1 c2 c3 k7 k8 k9 R R G n"))).toEqual([]);
  });

  it("always earns the base fan for going out", () => {
    expect(fanIds(scoringHand("b1 b2 b3 c1 c2 c3 k7 k8 k9 b5 b6 b7 e e"))).toContain("win");
  });

  it("scores a full flush — one suit and no honours", () => {
    const ids = fanIds(scoringHand("b1 b2 b3 b4 b5 b6 b7 b8 b9 b2 b3 b4 b6 b6"));

    expect(ids).toContain("full-flush");
    expect(ids).not.toContain("half-flush");
  });

  it("scores a half flush — one suit plus honours", () => {
    const ids = fanIds(scoringHand("b1 b2 b3 b4 b5 b6 b7 b8 b9 R R R e e"));

    expect(ids).toContain("half-flush");
    expect(ids).not.toContain("full-flush");
  });

  it("scores neither flush on a hand spanning two suits", () => {
    const ids = fanIds(scoringHand("b1 b2 b3 c1 c2 c3 k7 k8 k9 b5 b6 b7 e e"));

    expect(ids).not.toContain("full-flush");
    expect(ids).not.toContain("half-flush");
  });

  it("scores all honours, and prefers it to a flush", () => {
    const ids = fanIds(scoringHand("e e e s s s w w w R R R G G"));

    expect(ids).toContain("all-honours");
    expect(ids).not.toContain("full-flush");
    expect(ids).not.toContain("half-flush");
  });

  it("scores all triplets", () => {
    const ids = fanIds(scoringHand("b1 b1 b1 c5 c5 c5 k9 k9 k9 R R R e e"));

    expect(ids).toContain("all-triplets");
    expect(ids).not.toContain("all-sequences");
  });

  it("scores all sequences", () => {
    const ids = fanIds(scoringHand("b1 b2 b3 c1 c2 c3 k7 k8 k9 b5 b6 b7 e e"));

    expect(ids).toContain("all-sequences");
    expect(ids).not.toContain("all-triplets");
  });

  it("scores seven pairs", () => {
    const ids = fanIds(scoringHand("b1 b1 b3 b3 c2 c2 c7 c7 k5 k5 e e R R"));

    expect(ids).toContain("seven-pairs");
  });

  it("scores a dragon triplet", () => {
    const ids = fanIds(scoringHand("R R R b1 b2 b3 c1 c2 c3 k7 k8 k9 e e"));

    expect(ids.filter((id) => id.startsWith("dragon-"))).toHaveLength(1);
  });

  it("scores two dragon triplets separately", () => {
    const ids = fanIds(scoringHand("R R R G G G b1 b2 b3 c1 c2 c3 e e"));

    expect(ids.filter((id) => id.startsWith("dragon-"))).toHaveLength(2);
  });

  it("scores the seat wind only for the seat that holds it", () => {
    const held = scoringHand("e e e b1 b2 b3 c1 c2 c3 k7 k8 k9 G G");

    expect(fanIds(held, { seatWind: "east" })).toContain("seat-wind");
    expect(fanIds(held, { seatWind: "south" })).not.toContain("seat-wind");
  });

  it("does not score a wind run as a seat wind, there being no such thing", () => {
    // A chow can never be made of honours, so this hand simply does not win.
    expect(handFans(scoringHand("e s w b1 b2 b3 c1 c2 c3 k7 k8 k9 G G"))).toEqual([]);
  });

  it("scores terminals and honours when every set touches an edge", () => {
    const ids = fanIds(scoringHand("b1 b2 b3 c7 c8 c9 k1 k2 k3 R R R e e"));

    expect(ids).toContain("all-edges");
  });

  it("does not score terminals and honours when a set is all middles", () => {
    const ids = fanIds(scoringHand("b4 b5 b6 c7 c8 c9 k1 k2 k3 R R R e e"));

    expect(ids).not.toContain("all-edges");
  });

  it("scores fully concealed only with no declared meld", () => {
    const concealed = scoringHand("b1 b2 b3 c1 c2 c3 k7 k8 k9 b5 b6 b7 e e");
    expect(fanIds(concealed)).toContain("concealed");

    const open = scoringHand("b1 b2 b3 c1 c2 c3 k7 k8 k9 e e", {
      melds: [{ kind: "pung", tiles: hand("R R R"), concealed: false, claimedFrom: 1 }],
    });
    expect(fanIds(open)).not.toContain("concealed");
  });

  it("scores self drawn only when told the win was a self draw", () => {
    const held = scoringHand("b1 b2 b3 c1 c2 c3 k7 k8 k9 b5 b6 b7 e e");

    expect(fanIds(held, { selfDrawn: true })).toContain("self-drawn");
    expect(fanIds(held, { selfDrawn: false })).not.toContain("self-drawn");
  });

  it("scores a fan per flower, as one grouped entry", () => {
    const flowers: Tile[] = [
      { id: 8001, kind: "flower", flower: "plum" },
      { id: 8002, kind: "season", season: "spring" },
    ];
    const held = scoringHand("b1 b2 b3 c1 c2 c3 k7 k8 k9 b5 b6 b7 e e", { flowers });

    const entry = handFans(held).find((fan) => fan.id === "flowers");
    expect(entry?.fan).toBe(2 * MAHJONG_FLOWER_FAN);
    expect(entry?.label).toContain("2");
  });

  it("counts a declared meld toward the sets it scores", () => {
    const held = scoringHand("b1 b2 b3 c1 c2 c3 k7 k8 k9 e e", {
      melds: [{ kind: "pung", tiles: hand("R R R"), concealed: false, claimedFrom: 1 }],
    });

    expect(fanIds(held)).toContain("win");
  });

  it("lists the fans best first", () => {
    const fans = handFans(scoringHand("e e e s s s w w w R R R G G"));
    const values = fans.map((fan) => fan.fan);

    expect([...values]).toEqual([...values].sort((a, b) => b - a));
  });
});

describe("scoreHand", () => {
  it("pays nothing for a hand that has not won", () => {
    const score = scoreHand(scoringHand("b1 b2 b3 c1 c2 c3 k7 k8 k9 R R G n"));

    expect(score).toEqual({ fans: [], fan: 0, points: 0 });
  });

  it("doubles the points for each fan", () => {
    const plain = scoreHand(scoringHand("b1 b2 b3 c1 c2 c3 k7 k8 k9 b5 b6 b7 e e"));

    // Whatever the fan total is, the points must be the doubling of it.
    expect(plain.points).toBe(MAHJONG_POINTS_PER_FAN * 2 ** plain.fan);
    expect(plain.fan).toBeGreaterThan(0);
  });

  it("caps the fan total, and caps the exponent rather than the points", () => {
    // All honours plus concealed plus self drawn plus four flowers overshoots the cap.
    const flowers: Tile[] = [1, 2, 3, 4].map((n) => ({
      id: 8100 + n,
      kind: "flower",
      flower: "plum",
    })) as Tile[];
    const monster = scoringHand("e e e s s s w w w R R R G G", { flowers });

    const score = scoreHand(monster, { selfDrawn: true, seatWind: "east" });

    expect(score.fan).toBe(MAHJONG_MAX_FAN);
    expect(score.points).toBe(MAHJONG_POINTS_PER_FAN * 2 ** MAHJONG_MAX_FAN);
  });

  it("scores a bigger hand above a plain one", () => {
    const plain = scoreHand(scoringHand("b1 b2 b3 c1 c2 c3 k7 k8 k9 b5 b6 b7 e e"));
    const flush = scoreHand(scoringHand("b1 b2 b3 b4 b5 b6 b7 b8 b9 b2 b3 b4 b6 b6"));

    expect(flush.points).toBeGreaterThan(plain.points);
  });
});

describe("scoreGame", () => {
  it("records nothing for a hand still in play", () => {
    expect(scoreGame(startGame(rng(1)))).toBe(0);
  });

  it("records nothing when a bot won", () => {
    const state = table([
      "R b7 c4 c5 c6 k1 k2 k3 G G n n w",
      "b1 b5 c5 c6 c7 k2 k3 k4 e s n n R",
      "c9 k1 k5 b8 e e s s w w n G b6",
      "b1 b2 b3 c1 c2 c3 k7 k8 k9 R R e e",
    ]);

    const resolved = resolveCalls(discardTile(state, held(state, 0, "dragon-red")));

    expect(resolved.winner).toBe(3);
    expect(resolved.outcome).toBe("lost");
    expect(scoreGame(resolved)).toBe(0);
  });

  it("records nothing for a drawn hand", () => {
    const state = { ...startGame(rng(3)), wall: [] as Tile[] };

    const ended = drawTile({ ...state, turn: 1 });

    expect(ended.outcome).toBe("draw");
    expect(scoreGame(ended)).toBe(0);
  });

  it("records the human's points when the human won", () => {
    const winning = "b1 b2 b3 c1 c2 c3 k7 k8 k9 R R e e";
    const state = table([
      "G b7 c4 c5 c6 k1 k2 k3 R R n n w",
      winning.replace("R R", "G G"),
      "c9 k1 k5 b8 e e s s w w n b6 b9",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R n w b9",
    ]);

    const resolved = resolveCalls(discardTile(state, held(state, 0, "dragon-green")));

    expect(resolved.winner).toBe(HUMAN_SEAT);
    expect(resolved.outcome).toBe("won");
    expect(scoreGame(resolved)).toBeGreaterThan(0);
  });

  it("pays a self-drawn win more than the same hand claimed", () => {
    // The same fourteen tiles, won two ways. Self Drawn is a fan, so it must pay more.
    const tiles = "b1 b2 b3 c1 c2 c3 k7 k8 k9 b5 b6 b7 e e";
    const selfDrawn = scoreHand(scoringHand(tiles), { selfDrawn: true });
    const claimed = scoreHand(scoringHand(tiles), { selfDrawn: false });

    expect(selfDrawn.points).toBeGreaterThan(claimed.points);
  });

  it("marks a self-drawn win on the state and a claimed one not", () => {
    const selfWin = table([
      "b1 b2 b3 c1 c2 c3 k7 k8 k9 b7 b8 b9 R R",
      "e e e s s s w w w n n b5 b5",
      "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
    ]);
    expect(declareSelfWin(selfWin).selfDrawn).toBe(true);

    const claimWin = table([
      "R b7 c4 c5 c6 k1 k2 k3 G G n n w",
      "b1 b5 c5 c6 c7 k2 k3 k4 e s n n R",
      "c9 k1 k5 b8 e e s s w w n G b6",
      "b1 b2 b3 c1 c2 c3 k7 k8 k9 R R e e",
    ]);
    const claimed = resolveCalls(discardTile(claimWin, held(claimWin, 0, "dragon-red")));
    expect(claimed.selfDrawn).toBe(false);
  });
});

describe("tileValue", () => {
  it("values a lone honour at nothing", () => {
    const tiles = hand("R b1 b2 c5 c6 k9 e s w n G b8 c3");

    expect(tileValue(tiles, tiles[0])).toBe(0);
  });

  it("values a pair above a lone tile", () => {
    const tiles = hand("R R b1 c5 k9 e s w n G b8 c3 k4");
    const lone = tiles.find((tile) => tileFace(tile) === "wind-east")!;

    expect(tileValue(tiles, tiles[0])).toBeGreaterThan(tileValue(tiles, lone));
  });

  it("values a tile with neighbours above an isolated one", () => {
    const tiles = hand("b3 b4 c9 e s w n G R k2 k6 c1 b8");
    const connected = tiles.find((tile) => tileFace(tile) === "bamboo-3")!;
    const isolated = tiles.find((tile) => tileFace(tile) === "circles-9")!;

    expect(tileValue(tiles, connected)).toBeGreaterThan(tileValue(tiles, isolated));
  });

  it("values an adjacent neighbour above a gapped one", () => {
    const adjacent = hand("b3 b4 e s w n G R k2 k6 c1 b8 c5");
    const gapped = hand("b3 b5 e s w n G R k2 k6 c1 b8 c5");

    const a = tileValue(adjacent, adjacent.find((t) => tileFace(t) === "bamboo-3")!);
    const g = tileValue(gapped, gapped.find((t) => tileFace(t) === "bamboo-3")!);

    expect(a).toBeGreaterThan(g);
  });

  it("values a terminal below a middle tile of the same shape", () => {
    const terminal = hand("b1 b2 e s w n G R k2 k6 c1 b8 c5");
    const middle = hand("b5 b6 e s w n G R k2 k6 c1 b8 c9");

    const t = tileValue(terminal, terminal.find((x) => tileFace(x) === "bamboo-1")!);
    const m = tileValue(middle, middle.find((x) => tileFace(x) === "bamboo-5")!);

    expect(t).toBeLessThan(m);
  });
});

describe("botDiscard", () => {
  it("throws an isolated honour rather than a connected tile", () => {
    const player = seatHand(1, "b3 b4 b5 c6 c7 c8 k2 k3 k4 R R R n");

    const thrown = botDiscard(player, () => 0);

    expect(tileFace(thrown)).toBe("wind-north");
  });

  it("keeps a pair and throws a lone tile", () => {
    const player = seatHand(1, "R R b3 b4 b5 c6 c7 c8 k2 k3 k4 e s");

    const thrown = botDiscard(player, () => 0);

    expect(["wind-east", "wind-south"]).toContain(tileFace(thrown));
  });

  it("always throws a tile the hand actually holds", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const state = startGame(rng(seed));
      const player = handOf(state, 1);
      const thrown = botDiscard(player, rng(seed * 3));

      expect(player.tiles.some((tile) => tile.id === thrown.id)).toBe(true);
    }
  });

  it("is deterministic for one RNG", () => {
    const player = seatHand(1, "b3 b4 b5 c6 c7 c8 k2 k3 k4 e s w n");

    expect(botDiscard(player, rng(5)).id).toBe(botDiscard(player, rng(5)).id);
  });

  it("breaks ties with the RNG rather than always taking the first", () => {
    // Four equally worthless lone honours: the choice must vary with the RNG.
    const player = seatHand(1, "b3 b4 b5 c6 c7 c8 k2 k3 k4 e s w n");
    const picks = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) {
      picks.add(tileFace(botDiscard(player, rng(seed))));
    }

    expect(picks.size).toBeGreaterThan(1);
  });
});

describe("botAcceptsCall", () => {
  it("always takes a win", () => {
    const player = seatHand(1, "b1 b2 b3 c1 c2 c3 k7 k8 k9 R R e e");

    expect(botAcceptsCall(player, { seat: 1, action: "win", tiles: [] })).toBe(true);
  });

  it("takes a pung", () => {
    const player = seatHand(1, "R R b3 b4 b5 c6 c7 c8 k2 k3 k4 e s");
    const pair = player.tiles.filter((tile) => tileFace(tile) === "dragon-red");

    expect(botAcceptsCall(player, { seat: 1, action: "pung", tiles: pair })).toBe(true);
  });

  it("takes a chow that does not break a pair", () => {
    const player = seatHand(1, "b1 b2 c6 c7 c8 k2 k3 k4 e s w n R");
    const run = player.tiles.filter((tile) => ["bamboo-1", "bamboo-2"].includes(tileFace(tile)));

    expect(botAcceptsCall(player, { seat: 1, action: "chow", tiles: run })).toBe(true);
  });

  it("declines a chow that would break a pair", () => {
    // Holding b2 twice, so spending one on a run costs a near-triplet.
    const player = seatHand(1, "b1 b2 b2 c6 c7 c8 k2 k3 k4 e s w n");
    const run = [
      player.tiles.find((tile) => tileFace(tile) === "bamboo-1")!,
      player.tiles.find((tile) => tileFace(tile) === "bamboo-2")!,
    ];

    expect(botAcceptsCall(player, { seat: 1, action: "chow", tiles: run })).toBe(false);
  });
});

describe("stepBots", () => {
  it("does nothing when it is the human's turn", () => {
    const state = table(
      [
        "b1 b2 b3 c1 c2 c3 k7 k8 k9 R R G n",
        "e e e s s s w w w n n b5 b5",
        "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w",
        "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
      ],
      { turn: HUMAN_SEAT },
    );

    expect(stepBots(state, rng(1))).toBe(state);
  });

  it("does nothing while the human has a call to answer", () => {
    // Seat 0 throws a tile the human (seat 1) can chow.
    const state = table([
      "b3 b7 c1 c2 c3 k7 k8 k9 R R G G n",
      "b1 b2 c5 c6 c7 k2 k3 k4 e s w n R",
      "c9 k1 k5 b8 e e s s w w n G b6",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
    ]);
    const open = discardTile(state, held(state, 0, "bamboo-3"));

    expect(open.openCalls.some((call) => call.seat === HUMAN_SEAT)).toBe(true);
    expect(stepBots(open, rng(1))).toBe(open);
  });

  it("discards for a bot whose turn it is", () => {
    const state = table(
      [
        "b1 b2 b3 c1 c2 c3 k7 k8 k9 R R G G n",
        "e e e s s s w w w n n b5 b5",
        "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w",
        "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
      ],
      { turn: 0 },
    );

    const next = stepBots(state, rng(1));

    expect(next).not.toBe(state);
    // Either the window is open on its discard, or nobody could claim and play moved on.
    expect(next.phase === "awaiting-calls" || next.turn !== 0).toBe(true);
  });

  it("takes a win rather than discarding", () => {
    const state = table(
      [
        "b1 b2 b3 c1 c2 c3 k7 k8 k9 b7 b8 b9 R R",
        "e e e s s s w w w n n b5 b5",
        "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w",
        "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
      ],
      { turn: 0 },
    );

    const next = stepBots(state, rng(1));

    expect(next.phase).toBe("ended");
    expect(next.winner).toBe(0);
    expect(next.selfDrawn).toBe(true);
  });

  it("resolves a call window the human is not part of", () => {
    // Seat 3 throws; seat 2 can pung. The human holds nothing relevant.
    const state = table(
      [
        "b1 b5 c1 c2 c3 k7 k8 k9 R G n n w",
        "b7 c4 c5 c6 k1 k2 k3 e s w n G b9",
        "w w c9 k1 k5 b8 e e s s R G n",
        "w b7 c7 c8 b2 b3 b4 k4 k5 k6 R G n",
      ],
      { turn: 3 },
    );
    const open = discardTile(state, held(state, 3, "wind-west"));

    expect(open.openCalls.some((call) => call.seat === HUMAN_SEAT)).toBe(false);
    const resolved = stepBots(open, rng(1));

    expect(resolved.phase).not.toBe("awaiting-calls");
  });

  it("does nothing once the hand has ended", () => {
    const ended = { ...startGame(rng(1)), phase: "ended" as const, outcome: "draw" as const };

    expect(stepBots(ended, rng(1))).toBe(ended);
  });
});

describe("isWaitingForHuman", () => {
  it("is true on the human's turn to discard", () => {
    const state = table(
      [
        "b1 b2 b3 c1 c2 c3 k7 k8 k9 R R G n",
        "e e e s s s w w w n n b5 b5",
        "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w",
        "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
      ],
      { turn: HUMAN_SEAT },
    );

    expect(isWaitingForHuman(state)).toBe(true);
  });

  it("is false on a bot's turn", () => {
    const state = table(
      [
        "b1 b2 b3 c1 c2 c3 k7 k8 k9 R R G G n",
        "e e e s s s w w w n n b5 b5",
        "c5 c6 c7 k2 k3 k4 b8 b8 G G n n w",
        "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
      ],
      { turn: 0 },
    );

    expect(isWaitingForHuman(state)).toBe(false);
  });

  it("is true when the human has a call open", () => {
    const state = table([
      "b3 b7 c1 c2 c3 k7 k8 k9 R R G G n",
      "b1 b2 c5 c6 c7 k2 k3 k4 e s w n R",
      "c9 k1 k5 b8 e e s s w w n G b6",
      "b4 b5 b6 c4 c5 c6 k1 k2 k3 R G n w",
    ]);

    expect(isWaitingForHuman(discardTile(state, held(state, 0, "bamboo-3")))).toBe(true);
  });

  it("is false once the hand has ended", () => {
    const ended = { ...startGame(rng(1)), phase: "ended" as const, outcome: "draw" as const };

    expect(isWaitingForHuman(ended)).toBe(false);
  });
});

describe("a bot-driven hand plays itself out", () => {
  it("reaches an ending from the deal with bots on every seat", () => {
    // The human seat is driven by the same policy here, so the whole hand can run
    // unattended — which is what proves the machine and the policy agree.
    let state = startGame(rng(77));
    const total = allTiles(state).length;
    let guard = 0;

    while (!isHandOver(state) && guard < 500) {
      guard += 1;
      const before = state;

      if (state.phase === "awaiting-calls") {
        const claimants = new Set(
          SEATS.map((seat) => botCall(state, seat))
            .filter((call): call is MahjongCall => call !== undefined)
            .map((call) => call.seat),
        );
        state = resolveCalls(
          state,
          SEATS.filter((seat) => !claimants.has(seat)),
        );
      } else {
        const player = handOf(state, state.turn);
        state = isWinningHand(player.tiles, player.melds)
          ? declareSelfWin(state)
          : discardTile(state, botDiscard(player, rng(guard * 13)));
      }

      expect(state).not.toBe(before);
      expect(allTiles(state)).toHaveLength(total);
    }

    expect(isHandOver(state)).toBe(true);
  });
});
