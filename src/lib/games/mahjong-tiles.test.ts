import { describe, expect, it } from "vitest";
import {
  BONUS_TILES,
  COPIES_PER_TILE,
  DISTINCT_TILES,
  DRAGONS,
  FLOWERS,
  SEASONS,
  TILES_IN_SET,
  TILE_RANKS,
  TILE_SUITS,
  WINDS,
  buildWall,
  draw,
  groupByFace,
  isBonus,
  isHonour,
  isSimple,
  isTerminal,
  matches,
  shuffle,
  shuffledWall,
  sortTiles,
  tileFace,
  type Tile,
} from "./mahjong-tiles";

/** A deterministic stand-in for `Math.random`, cycling a fixed list. */
function stubRandom(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  };
}

/** The first tile in the wall with this face. Keeps the tests readable. */
function tileWithFace(face: string): Tile {
  const tile = buildWall().find((candidate) => tileFace(candidate) === face);
  if (!tile) throw new Error(`no tile with face ${face}`);
  return tile;
}

describe("buildWall", () => {
  it("builds a full 144-tile set", () => {
    expect(buildWall()).toHaveLength(TILES_IN_SET);
    expect(TILES_IN_SET).toBe(144);
  });

  it("builds the 136-tile set when bonuses are excluded", () => {
    const wall = buildWall(false);

    expect(wall).toHaveLength(DISTINCT_TILES * COPIES_PER_TILE);
    expect(wall).toHaveLength(136);
    expect(wall.some(isBonus)).toBe(false);
  });

  it("holds exactly four copies of every suited and honour tile", () => {
    const groups = groupByFace(buildWall());

    for (const suit of TILE_SUITS) {
      for (const rank of TILE_RANKS) {
        expect(groups.get(`${suit}-${rank}`)).toHaveLength(COPIES_PER_TILE);
      }
    }
    for (const wind of WINDS) {
      expect(groups.get(`wind-${wind}`)).toHaveLength(COPIES_PER_TILE);
    }
    for (const dragon of DRAGONS) {
      expect(groups.get(`dragon-${dragon}`)).toHaveLength(COPIES_PER_TILE);
    }
  });

  it("holds exactly one of each flower and season", () => {
    const groups = groupByFace(buildWall());

    for (const flower of FLOWERS) {
      expect(groups.get(`flower-${flower}`)).toHaveLength(1);
    }
    for (const season of SEASONS) {
      expect(groups.get(`season-${season}`)).toHaveLength(1);
    }
    expect(buildWall().filter(isBonus)).toHaveLength(BONUS_TILES);
  });

  it("gives every tile a distinct id, so no two share a React key", () => {
    const wall = buildWall();
    const ids = new Set(wall.map((tile) => tile.id));

    expect(ids.size).toBe(wall.length);
  });
});

describe("tile predicates", () => {
  it("classifies terminals, simples and honours", () => {
    expect(isTerminal(tileWithFace("bamboo-1"))).toBe(true);
    expect(isTerminal(tileWithFace("bamboo-9"))).toBe(true);
    expect(isTerminal(tileWithFace("bamboo-5"))).toBe(false);

    expect(isSimple(tileWithFace("circles-5"))).toBe(true);
    expect(isSimple(tileWithFace("circles-1"))).toBe(false);

    expect(isHonour(tileWithFace("wind-east"))).toBe(true);
    expect(isHonour(tileWithFace("dragon-red"))).toBe(true);
    expect(isHonour(tileWithFace("characters-3"))).toBe(false);
  });

  it("does not count an honour or a bonus tile as a terminal", () => {
    expect(isTerminal(tileWithFace("wind-north"))).toBe(false);
    expect(isTerminal(tileWithFace("flower-plum"))).toBe(false);
  });

  it("counts flowers and seasons as bonuses, and nothing else", () => {
    expect(isBonus(tileWithFace("flower-orchid"))).toBe(true);
    expect(isBonus(tileWithFace("season-winter"))).toBe(true);
    expect(isBonus(tileWithFace("dragon-white"))).toBe(false);
  });
});

describe("matches", () => {
  it("pairs two copies of the same face", () => {
    const [first, second] = buildWall().filter(
      (tile) => tileFace(tile) === "circles-7",
    );

    expect(matches(first, second)).toBe(true);
  });

  it("does not pair different faces", () => {
    expect(matches(tileWithFace("circles-7"), tileWithFace("circles-8"))).toBe(false);
    expect(matches(tileWithFace("wind-east"), tileWithFace("wind-south"))).toBe(false);
  });

  it("pairs any flower with any other flower, and any season with any season", () => {
    expect(matches(tileWithFace("flower-plum"), tileWithFace("flower-orchid"))).toBe(true);
    expect(matches(tileWithFace("season-spring"), tileWithFace("season-autumn"))).toBe(true);
  });

  it("does not pair a flower with a season", () => {
    expect(matches(tileWithFace("flower-plum"), tileWithFace("season-spring"))).toBe(false);
  });

  it("does not pair a tile with itself", () => {
    const tile = tileWithFace("bamboo-4");

    expect(matches(tile, tile)).toBe(false);
  });
});

describe("shuffle", () => {
  it("keeps every tile, changing only the order", () => {
    const wall = buildWall();
    const shuffled = shuffle(wall, stubRandom([0.1, 0.9, 0.4, 0.7, 0.2]));

    expect(shuffled).toHaveLength(wall.length);
    expect([...shuffled].sort((a, b) => a.id - b.id)).toEqual([...wall].sort((a, b) => a.id - b.id));
  });

  it("leaves the input untouched", () => {
    const wall = buildWall();
    const before = wall.map((tile) => tile.id);

    shuffle(wall, stubRandom([0.3, 0.8]));

    expect(wall.map((tile) => tile.id)).toEqual(before);
  });

  it("is deterministic for a given RNG", () => {
    const first = shuffledWall(stubRandom([0.42, 0.17, 0.93]));
    const second = shuffledWall(stubRandom([0.42, 0.17, 0.93]));

    expect(first.map((tile) => tile.id)).toEqual(second.map((tile) => tile.id));
  });
});

describe("draw", () => {
  it("takes tiles off the front and returns the rest", () => {
    const wall = buildWall();
    const { drawn, rest } = draw(wall, 13);

    expect(drawn).toHaveLength(13);
    expect(rest).toHaveLength(wall.length - 13);
    expect(drawn[0]).toEqual(wall[0]);
    expect(rest[0]).toEqual(wall[13]);
  });

  it("returns everything it has when asked for more than the wall holds", () => {
    const { drawn, rest } = draw(buildWall().slice(0, 3), 10);

    expect(drawn).toHaveLength(3);
    expect(rest).toHaveLength(0);
  });

  it("returns nothing from an empty wall rather than throwing", () => {
    const { drawn, rest } = draw([], 4);

    expect(drawn).toHaveLength(0);
    expect(rest).toHaveLength(0);
  });
});

describe("sortTiles", () => {
  it("puts a scrambled hand back into box order", () => {
    const hand = [
      tileWithFace("season-spring"),
      tileWithFace("dragon-red"),
      tileWithFace("circles-2"),
      tileWithFace("bamboo-9"),
      tileWithFace("wind-east"),
      tileWithFace("bamboo-1"),
    ];

    expect(sortTiles(hand).map(tileFace)).toEqual([
      "bamboo-1",
      "bamboo-9",
      "circles-2",
      "wind-east",
      "dragon-red",
      "season-spring",
    ]);
  });

  it("leaves the input untouched", () => {
    const hand = [tileWithFace("dragon-white"), tileWithFace("bamboo-3")];
    const before = hand.map(tileFace);

    sortTiles(hand);

    expect(hand.map(tileFace)).toEqual(before);
  });

  it("orders two copies of one face by id, so the order is stable", () => {
    const [first, second] = buildWall().filter((tile) => tileFace(tile) === "characters-6");

    expect(sortTiles([second, first]).map((tile) => tile.id)).toEqual([first.id, second.id]);
  });
});

describe("groupByFace", () => {
  it("groups copies together and keeps first-appearance order", () => {
    const groups = groupByFace([
      tileWithFace("circles-3"),
      tileWithFace("bamboo-1"),
      ...buildWall().filter((tile) => tileFace(tile) === "circles-3").slice(1, 2),
    ]);

    expect([...groups.keys()]).toEqual(["circles-3", "bamboo-1"]);
    expect(groups.get("circles-3")).toHaveLength(2);
  });

  it("returns an empty map for no tiles", () => {
    expect(groupByFace([]).size).toBe(0);
  });
});
