import { describe, expect, it } from "vitest";
import {
  MAHJONG_FIGURES,
  MAHJONG_MATCH_DIFFICULTIES,
  MAHJONG_MATCH_HINT_PENALTY,
  MAHJONG_MATCH_MIN_SCORE,
  MAHJONG_MATCH_SETUP,
  MAHJONG_MATCH_SHUFFLE_PENALTY,
  MAHJONG_MATCH_TIME_PENALTY,
  type MahjongMatchDifficulty,
  type MahjongMatchState,
} from "./types";
import {
  MAHJONG_LAYOUTS,
  TILE_SPAN,
  boardBounds,
  canShuffle,
  faceSet,
  findPair,
  freeTiles,
  hasMove,
  isFree,
  layoutPositions,
  paintOrder,
  reshuffle,
  scoreGame,
  selectTile,
  startGame,
  takeHint,
  tick,
  tilesLeft,
  undo,
} from "./game-mahjong-match";
import { matches, tileFace } from "./mahjong-tiles";

/**
 * A seeded RNG, so a failing board can be reproduced from its seed.
 *
 * Mulberry32 — small, fast, and good enough that a "random" board is genuinely varied
 * rather than a repeating pattern that would make the solvability test meaningless.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plays a board greedily, shuffling whenever it runs dry.
 *
 * This is how the game is actually played and therefore what the tests assert on. The
 * deal carries no solvability guarantee — see `deal` — so clearing a board is a claim
 * about the *game* (pairs plus unlimited shuffles always get there) rather than about
 * the deal alone.
 *
 * `shuffleLimit` bounds the run so a bug that stops making progress fails the test
 * instead of hanging it. It is generous: a real player needs a handful at most.
 */
function playToEnd(start: MahjongMatchState, shuffleLimit = 200): MahjongMatchState {
  let state = start;
  let shuffles = 0;

  while (state.outcome === undefined && shuffles <= shuffleLimit) {
    const pair = findPair(state);
    if (pair) {
      state = selectTile(state, pair[0]);
      state = selectTile(state, pair[1]);
      continue;
    }
    // Dead board: shuffle and carry on, which is the whole point of the aid.
    state = reshuffle(state, seeded(1000 + shuffles));
    shuffles += 1;
  }
  return state;
}

/** Plays greedily and stops when no pair is left, without shuffling. */
function playGreedily(start: MahjongMatchState): MahjongMatchState {
  let state = start;
  for (let move = 0; move <= start.tiles.length; move += 1) {
    const pair = findPair(state);
    if (!pair) break;
    state = selectTile(state, pair[0]);
    state = selectTile(state, pair[1]);
  }
  return state;
}

describe("layouts", () => {
  it("gives the turtle exactly one full tile set across five layers", () => {
    const positions = layoutPositions("turtle");

    expect(positions).toHaveLength(144);
    expect(new Set(positions.map((p) => p.layer))).toEqual(new Set([0, 1, 2, 3, 4]));
  });

  it("gives the garden 72 tiles across two layers", () => {
    const positions = layoutPositions("garden");

    expect(positions).toHaveLength(72);
    expect(new Set(positions.map((p) => p.layer))).toEqual(new Set([0, 1]));
  });

  it("never puts two tiles in the same place", () => {
    for (const layout of ["turtle", "garden"] as const) {
      const positions = layoutPositions(layout);
      const keys = positions.map((p) => `${p.layer}:${p.col}:${p.row}`);

      expect(new Set(keys).size, layout).toBe(positions.length);
    }
  });

  it("holds an even number of tiles, so every tile can be paired", () => {
    for (const layout of ["turtle", "garden"] as const) {
      expect(layoutPositions(layout).length % 2, layout).toBe(0);
    }
  });

  it("puts the turtle's head outside the shell, at a negative column", () => {
    const positions = layoutPositions("turtle");

    expect(Math.min(...positions.map((p) => p.col))).toBeLessThan(0);
  });

  /*
   * The structural checks, run over *every* registered figure rather than the two the
   * game shipped with. Each of these caught a real bug while the figures were being
   * drawn — a butterfly with two tiles floating over its wing notch, a turtle with the
   * tail overlapping the shell, a cat 16 tiles short — and they are exactly the faults
   * that are invisible in code review and obvious the moment you play the board.
   */
  describe("every figure", () => {
    it("holds exactly one full tile set", () => {
      for (const layout of MAHJONG_LAYOUTS) {
        // The garden is the 72-tile beginner board; every other figure is a full set.
        const expected = layout === "garden" ? 72 : 144;
        expect(layoutPositions(layout).length, layout).toBe(expected);
      }
    });

    it("never puts two tiles in the same place", () => {
      for (const layout of MAHJONG_LAYOUTS) {
        const positions = layoutPositions(layout);
        const keys = positions.map((p) => `${p.layer}:${p.col}:${p.row}`);

        expect(new Set(keys).size, layout).toBe(positions.length);
      }
    });

    it("holds an even number of tiles, so every tile can be paired", () => {
      for (const layout of MAHJONG_LAYOUTS) {
        expect(layoutPositions(layout).length % 2, layout).toBe(0);
      }
    });

    it("rests every raised tile on at least one tile below it", () => {
      for (const layout of MAHJONG_LAYOUTS) {
        const positions = layoutPositions(layout);
        const overlaps = (a: { col: number; row: number }, b: { col: number; row: number }) =>
          Math.abs(a.col - b.col) < TILE_SPAN && Math.abs(a.row - b.row) < TILE_SPAN;

        for (const tile of positions) {
          if (tile.layer === 0) continue;
          const supported = positions.some(
            (other) => other.layer === tile.layer - 1 && overlaps(other, tile),
          );
          // A floating tile is not a cosmetic fault: it can never be blocked from above,
          // so it distorts the whole freedom calculation and it looks broken.
          expect(
            supported,
            `${layout}: tile at layer ${tile.layer} col ${tile.col} row ${tile.row} floats`,
          ).toBe(true);
        }
      }
    });

    it("uses contiguous layers from 0, so no layer is skipped", () => {
      for (const layout of MAHJONG_LAYOUTS) {
        const layers = [...new Set(layoutPositions(layout).map((p) => p.layer))].sort(
          (a, b) => a - b,
        );

        expect(layers[0], layout).toBe(0);
        expect(layers, layout).toEqual(layers.map((_, index) => index));
      }
    });

    it("deals and plays to a clear on every figure", () => {
      // The end-to-end check: a figure that passes the structural tests can still be
      // unplayable if its geometry never frees a pair.
      for (const { layout } of MAHJONG_FIGURES) {
        const state = startGame("classic", seeded(layout.length + 7), layout);

        expect(state.tiles, layout).toHaveLength(144);
        expect(hasMove(state), `${layout} has no opening move`).toBe(true);
        expect(tilesLeft(playToEnd(state)), `${layout} did not clear`).toBe(0);
      }
    });
  });
});

describe("faceSet", () => {
  it("returns exactly the requested number of tiles", () => {
    expect(faceSet(144, seeded(1))).toHaveLength(144);
    expect(faceSet(72, seeded(2))).toHaveLength(72);
  });

  it("gives every plain face an even count, so no tile is left unpairable", () => {
    for (const size of [72, 144]) {
      const counts = new Map<string, number>();
      for (const tile of faceSet(size, seeded(size))) {
        // The bonus tiles are deliberately excluded. There is only one of each flower
        // and season in a set, so counting them per face would always look odd — they
        // pair across their *group* via `matches`, which the next test covers. The
        // property being asserted here is the one the plain tiles must have.
        if (tile.kind === "flower" || tile.kind === "season") continue;
        const key = tileFace(tile);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const [key, count] of counts) {
        expect(count % 2, `${size}: ${key}`).toBe(0);
      }
    }
  });

  it("takes the bonus tiles all-or-nothing, so the group is always pairable", () => {
    for (const size of [72, 144]) {
      const bonus = faceSet(size, seeded(size + 1)).filter(
        (tile) => tile.kind === "flower" || tile.kind === "season",
      );

      // Eight or none. Four flowers and four seasons pair within their own group, so a
      // partial handful — three flowers, say — would strand one tile.
      expect([0, 8], `size ${size}`).toContain(bonus.length);
      expect(bonus.filter((tile) => tile.kind === "flower").length % 2, `size ${size}`).toBe(0);
      expect(bonus.filter((tile) => tile.kind === "season").length % 2, `size ${size}`).toBe(0);
    }
  });

  it("includes the eight bonus tiles on a full board", () => {
    const bonus = faceSet(144, seeded(7)).filter(
      (tile) => tile.kind === "flower" || tile.kind === "season",
    );

    expect(bonus).toHaveLength(8);
  });

  it("rejects an odd tile count rather than dealing an unpairable board", () => {
    expect(() => faceSet(71, seeded(1))).toThrow(/even tile count/);
  });

  // The regression guard for the bug that quietly broke every board: `faceSet` used to
  // shuffle its result, which destroyed the pair adjacency `deal` depends on. The board
  // still looked fine and was almost never solvable.
  it("returns faces pair-adjacent, so deal can seat a real pair per position pair", () => {
    for (const size of [72, 144]) {
      const faces = faceSet(size, seeded(size));

      for (let i = 0; i + 1 < faces.length; i += 2) {
        expect(
          matches(faces[i], faces[i + 1]),
          `size ${size}: faces[${i}] and faces[${i + 1}] must match`,
        ).toBe(true);
      }
    }
  });
});

describe("startGame", () => {
  it("deals a full board with nothing cleared and no selection", () => {
    const state = startGame("classic", seeded(3));

    expect(state.tiles).toHaveLength(144);
    expect(tilesLeft(state)).toBe(144);
    expect(state.selected).toBeUndefined();
    expect(state.pairsCleared).toBe(0);
    expect(state.outcome).toBeUndefined();
    expect(state.history).toEqual([]);
  });

  it("deals a different board per seed", () => {
    const faces = (seed: number) =>
      startGame("classic", seeded(seed))
        .tiles.map((entry) => `${entry.tile.kind}`)
        .join("");

    expect(faces(11)).not.toBe(faces(12));
  });

  it("deals every difficulty at its configured size", () => {
    for (const difficulty of MAHJONG_MATCH_DIFFICULTIES) {
      const state = startGame(difficulty, seeded(5));
      const expected = layoutPositions(MAHJONG_MATCH_SETUP[difficulty].layout).length;

      expect(state.tiles, difficulty).toHaveLength(expected);
    }
  });

  it("always has a legal opening move", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      expect(hasMove(startGame("classic", seeded(seed))), `seed ${seed}`).toBe(true);
    }
  });
});

/**
 * Every board can be finished — by pairing and shuffling, which is the game.
 *
 * Deliberately NOT a claim that a fresh deal is clearable on its own. It usually is not,
 * and with unlimited shuffles it does not need to be; see `deal`. What must hold is that
 * a player can always reach the end, and that a dead board is recoverable rather than
 * terminal.
 */
describe("finishability", () => {
  it("always clears a turtle, given pairs and shuffles", () => {
    for (let seed = 1; seed <= 15; seed += 1) {
      const finished = playToEnd(startGame("classic", seeded(seed)));

      expect(tilesLeft(finished), `seed ${seed} stranded tiles`).toBe(0);
      expect(finished.outcome, `seed ${seed}`).toBe("cleared");
      expect(finished.pairsCleared, `seed ${seed}`).toBe(72);
    }
  });

  it("always clears a garden, given pairs and shuffles", () => {
    for (let seed = 1; seed <= 15; seed += 1) {
      const finished = playToEnd(startGame("easy", seeded(seed)));

      expect(tilesLeft(finished), `seed ${seed}`).toBe(0);
      expect(finished.outcome, `seed ${seed}`).toBe("cleared");
    }
  });

  it("leaves a board with no pair still shuffleable, never terminal", () => {
    // Play greedily without shuffling until it stalls, then confirm the run is alive
    // and the aid is available — the property that replaces the dealer's guarantee.
    const stalled = playGreedily(startGame("classic", seeded(41)));

    if (tilesLeft(stalled) > 0) {
      expect(hasMove(stalled)).toBe(false);
      expect(stalled.outcome).toBeUndefined();
      expect(canShuffle(stalled)).toBe(true);
    }
  });

  it("deals a board that can be cleared without shuffling at all", () => {
    // The dealer's actual guarantee, checked by search rather than by trusting it. A
    // bounded DFS over board states: enough to catch a dealer that stopped producing
    // solvable boards, which is exactly what the `faceSet` shuffle bug caused.
    const solvable = (start: MahjongMatchState, budget = 40000): boolean => {
      const seen = new Set<string>();
      let nodes = 0;

      const search = (state: MahjongMatchState): boolean => {
        if (tilesLeft(state) === 0) return true;
        if (nodes++ > budget) return false;

        const key = state.tiles.map((entry) => (entry.cleared ? "1" : "0")).join("");
        if (seen.has(key)) return false;
        seen.add(key);

        const free = freeTiles(state);
        for (let i = 0; i < free.length; i += 1) {
          for (let j = i + 1; j < free.length; j += 1) {
            if (!matches(state.tiles[free[i]].tile, state.tiles[free[j]].tile)) continue;
            if (search(selectTile(selectTile(state, free[i]), free[j]))) return true;
          }
        }
        return false;
      };

      return search(start);
    };

    for (let seed = 1; seed <= 6; seed += 1) {
      expect(solvable(startGame("easy", seeded(seed))), `easy seed ${seed}`).toBe(true);
    }
  });

  it("keeps every tile pairable, so a shuffle can always open the board up", () => {
    // The invariant the deal does guarantee: no tile is ever without a possible
    // partner somewhere on the board, whatever the geometry happens to be blocking.
    const state = startGame("classic", seeded(42));
    const counts = new Map<string, number>();
    for (const entry of state.tiles) {
      const key =
        entry.tile.kind === "flower" || entry.tile.kind === "season"
          ? entry.tile.kind
          : tileFace(entry.tile);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    for (const [key, count] of counts) {
      expect(count % 2, key).toBe(0);
    }
  });
});

describe("isFree", () => {
  it("frees the cap, which has nothing above and no side neighbours", () => {
    const state = startGame("classic", seeded(4));
    const cap = state.tiles.findIndex((entry) => entry.position.layer === 4);

    expect(isFree(state, cap)).toBe(true);
  });

  it("buries a tile that has one on a higher layer overlapping it", () => {
    const state = startGame("classic", seeded(4));
    // Layer 3 sits directly under the cap, which straddles all four of its tiles.
    const underCap = state.tiles.findIndex((entry) => entry.position.layer === 3);

    expect(isFree(state, underCap)).toBe(false);
  });

  it("pins a tile that has neighbours on both sides", () => {
    const state = startGame("easy", seeded(6));
    // The garden's bottom layer is 12 wide, so a middle tile of row 0 has both sides
    // occupied and nothing above it — pinned by its sides alone, which is the rule
    // that is easy to get wrong.
    const middle = state.tiles.findIndex(
      (entry) => entry.position.layer === 0 && entry.position.row === 0 && entry.position.col === 10,
    );

    expect(middle).toBeGreaterThanOrEqual(0);
    expect(isFree(state, middle)).toBe(false);
  });

  it("frees the end of a row, which has one side open", () => {
    const state = startGame("easy", seeded(6));
    const leftEnd = state.tiles.findIndex(
      (entry) => entry.position.layer === 0 && entry.position.row === 0 && entry.position.col === 0,
    );

    expect(isFree(state, leftEnd)).toBe(true);
  });

  it("frees a pinned tile once a side neighbour is lifted", () => {
    let state = startGame("easy", seeded(6));
    const at = (col: number, row: number) =>
      state.tiles.findIndex(
        (entry) =>
          entry.position.layer === 0 && entry.position.row === row && entry.position.col === col,
      );

    const middle = at(10, 0);
    expect(isFree(state, middle)).toBe(false);

    // Clear its left neighbour by hand, bypassing the matching rule — this is a test of
    // the freedom rule, not of pairing.
    const neighbour = at(10 - TILE_SPAN, 0);
    state = {
      ...state,
      tiles: state.tiles.map((entry, index) =>
        index === neighbour ? { ...entry, cleared: true } : entry,
      ),
    };

    expect(isFree(state, middle)).toBe(true);
  });

  it("never frees a cleared tile", () => {
    const state = startGame("easy", seeded(6));
    const cleared = {
      ...state,
      tiles: state.tiles.map((entry, index) => (index === 0 ? { ...entry, cleared: true } : entry)),
    };

    expect(isFree(cleared, 0)).toBe(false);
  });

  it("returns false for an index that is not on the board", () => {
    const state = startGame("easy", seeded(6));

    expect(isFree(state, 9999)).toBe(false);
    expect(isFree(state, -1)).toBe(false);
  });
});

describe("selectTile", () => {
  it("selects a free tile", () => {
    const state = startGame("classic", seeded(8));
    const free = freeTiles(state)[0];

    expect(selectTile(state, free).selected).toBe(free);
  });

  it("ignores a tap on a buried tile", () => {
    const state = startGame("classic", seeded(8));
    const buried = state.tiles.findIndex((entry) => entry.position.layer === 3);

    expect(selectTile(state, buried)).toBe(state);
  });

  it("deselects when the same tile is tapped twice", () => {
    const state = startGame("classic", seeded(8));
    const free = freeTiles(state)[0];

    expect(selectTile(selectTile(state, free), free).selected).toBeUndefined();
  });

  it("clears a matching pair and records it in history", () => {
    const state = startGame("classic", seeded(9));
    const pair = findPair(state);
    if (!pair) throw new Error("a fresh board must have a pair");

    const after = selectTile(selectTile(state, pair[0]), pair[1]);

    expect(after.tiles[pair[0]].cleared).toBe(true);
    expect(after.tiles[pair[1]].cleared).toBe(true);
    expect(after.pairsCleared).toBe(1);
    expect(after.selected).toBeUndefined();
    expect(after.history).toEqual([pair]);
    expect(tilesLeft(after)).toBe(142);
  });

  it("moves the selection to a non-matching second tile rather than clearing it", () => {
    const state = startGame("classic", seeded(10));
    const free = freeTiles(state);
    const first = free[0];
    const other = free.find(
      (index) => index !== first && !findPair({ ...state, tiles: state.tiles })?.includes(index),
    );

    // Find a genuinely non-matching free tile.
    const mismatch = free.find(
      (index) =>
        index !== first &&
        JSON.stringify({ ...state.tiles[index].tile, id: 0 }) !==
          JSON.stringify({ ...state.tiles[first].tile, id: 0 }),
    );
    expect(mismatch ?? other).toBeDefined();

    const after = selectTile(selectTile(state, first), mismatch as number);

    expect(after.selected).toBe(mismatch);
    expect(after.pairsCleared).toBe(0);
  });

  it("does nothing once the run is over", () => {
    const finished = playToEnd(startGame("easy", seeded(12)));
    expect(finished.outcome).toBe("cleared");

    expect(selectTile(finished, 0)).toBe(finished);
  });

  it("reports a fully cleared board as cleared", () => {
    const finished = playToEnd(startGame("easy", seeded(13)));

    expect(finished.outcome).toBe("cleared");
    expect(tilesLeft(finished)).toBe(0);
  });
});

describe("undo", () => {
  it("puts the last pair back exactly where it was", () => {
    const state = startGame("classic", seeded(14));
    const pair = findPair(state);
    if (!pair) throw new Error("a fresh board must have a pair");

    const after = selectTile(selectTile(state, pair[0]), pair[1]);
    const back = undo(after);

    expect(back.tiles[pair[0]].cleared).toBe(false);
    expect(back.tiles[pair[1]].cleared).toBe(false);
    expect(back.tiles[pair[0]].tile).toEqual(state.tiles[pair[0]].tile);
    expect(back.tiles[pair[0]].position).toEqual(state.tiles[pair[0]].position);
    expect(back.pairsCleared).toBe(0);
    expect(back.history).toEqual([]);
    expect(tilesLeft(back)).toBe(144);
  });

  it("does nothing with an empty history", () => {
    const state = startGame("classic", seeded(15));

    expect(undo(state)).toBe(state);
  });

  it("will not undo a finished win", () => {
    const finished = playToEnd(startGame("easy", seeded(16)));

    expect(undo(finished)).toBe(finished);
  });

  it("clears the selection, so an undo cannot leave a stale highlight", () => {
    const state = startGame("classic", seeded(17));
    const pair = findPair(state);
    if (!pair) throw new Error("a fresh board must have a pair");

    let after = selectTile(selectTile(state, pair[0]), pair[1]);
    after = selectTile(after, freeTiles(after)[0]);
    expect(after.selected).toBeDefined();

    expect(undo(after).selected).toBeUndefined();
  });
});

describe("takeHint", () => {
  it("counts a hint", () => {
    const state = startGame("classic", seeded(18));

    expect(takeHint(state).hints).toBe(1);
    expect(takeHint(takeHint(state)).hints).toBe(2);
  });

  it("does not count a hint once the run is over", () => {
    const finished = playToEnd(startGame("easy", seeded(19)));

    expect(takeHint(finished)).toBe(finished);
  });

  it("offers a pair that is actually liftable and actually matches", () => {
    const state = startGame("classic", seeded(20));
    const pair = findPair(state);
    if (!pair) throw new Error("a fresh board must have a pair");

    expect(isFree(state, pair[0])).toBe(true);
    expect(isFree(state, pair[1])).toBe(true);
    // Clearing it must work, which is the only claim that matters.
    expect(selectTile(selectTile(state, pair[0]), pair[1]).pairsCleared).toBe(1);
  });
});

describe("reshuffle", () => {
  it("keeps the positions and the tile count, changing only which face is where", () => {
    const state = startGame("classic", seeded(21));
    const after = reshuffle(state, seeded(99));

    expect(tilesLeft(after)).toBe(144);
    expect(after.tiles.map((entry) => entry.position)).toEqual(
      state.tiles.map((entry) => entry.position),
    );
    expect(after.shuffles).toBe(1);
  });

  it("leaves a re-dealt board finishable", () => {
    const state = reshuffle(startGame("classic", seeded(22)), seeded(23));

    expect(tilesLeft(playToEnd(state))).toBe(0);
  });

  it("clears the undo history, which no longer refers to the tiles that were lifted", () => {
    const state = startGame("classic", seeded(24));
    const pair = findPair(state);
    if (!pair) throw new Error("a fresh board must have a pair");

    const played = selectTile(selectTile(state, pair[0]), pair[1]);
    expect(played.history).toHaveLength(1);

    expect(reshuffle(played, seeded(25)).history).toEqual([]);
  });

  it("leaves the cleared tiles cleared", () => {
    const state = startGame("classic", seeded(26));
    const pair = findPair(state);
    if (!pair) throw new Error("a fresh board must have a pair");

    const played = selectTile(selectTile(state, pair[0]), pair[1]);
    const after = reshuffle(played, seeded(27));

    expect(after.tiles[pair[0]].cleared).toBe(true);
    expect(after.tiles[pair[1]].cleared).toBe(true);
    expect(tilesLeft(after)).toBe(142);
  });

  it("is unlimited, and keeps counting for the score", () => {
    let state = startGame("hard", seeded(28));

    for (let used = 0; used < 12; used += 1) {
      expect(canShuffle(state), `after ${used}`).toBe(true);
      state = reshuffle(state, seeded(30 + used));
      expect(state.shuffles).toBe(used + 1);
    }
  });

  it("refuses on a finished board, so a win cannot be re-dealt and replayed", () => {
    const finished = playToEnd(startGame("easy", seeded(29)));

    expect(finished.outcome).toBe("cleared");
    expect(canShuffle(finished)).toBe(false);
    expect(reshuffle(finished, seeded(40))).toBe(finished);
  });
});

describe("tick", () => {
  it("advances the clock", () => {
    const state = startGame("classic", seeded(31));

    expect(tick(state).elapsedSeconds).toBe(1);
    expect(tick(tick(state)).elapsedSeconds).toBe(2);
  });

  it("stops once the run is over, so a finished board cannot bleed points", () => {
    const finished = playToEnd(startGame("easy", seeded(32)));

    expect(tick(finished)).toBe(finished);
  });
});

describe("scoreGame", () => {
  /** A cleared state with the fields scoring reads, without playing a whole board. */
  function cleared(
    difficulty: MahjongMatchDifficulty,
    fields: Partial<Pick<MahjongMatchState, "elapsedSeconds" | "hints" | "shuffles">> = {},
  ): MahjongMatchState {
    return {
      ...startGame(difficulty, seeded(33)),
      tiles: [],
      outcome: "cleared",
      elapsedSeconds: 0,
      hints: 0,
      shuffles: 0,
      ...fields,
    };
  }

  it("scores an instant clear at the difficulty's base", () => {
    for (const difficulty of MAHJONG_MATCH_DIFFICULTIES) {
      expect(scoreGame(cleared(difficulty)), difficulty).toBe(
        MAHJONG_MATCH_SETUP[difficulty].base,
      );
    }
  });

  it("charges for time, hints and shuffles", () => {
    const state = cleared("classic", { elapsedSeconds: 60, hints: 2, shuffles: 1 });
    const expected =
      MAHJONG_MATCH_SETUP.classic.base -
      60 * MAHJONG_MATCH_TIME_PENALTY -
      2 * MAHJONG_MATCH_HINT_PENALTY -
      1 * MAHJONG_MATCH_SHUFFLE_PENALTY;

    expect(scoreGame(state)).toBe(expected);
  });

  it("floors a long grind rather than going negative", () => {
    const state = cleared("easy", { elapsedSeconds: 100000, hints: 50 });

    expect(scoreGame(state)).toBe(MAHJONG_MATCH_MIN_SCORE);
  });

  it("scores an unfinished board zero", () => {
    const state = startGame("classic", seeded(34));

    expect(state.outcome).toBeUndefined();
    expect(scoreGame(state)).toBe(0);
  });

  it("scores a board with no moves left zero until it is actually cleared", () => {
    // A dead board is not an ending — it is shuffleable — so it scores nothing while
    // the run is still open.
    const stalled = playGreedily(startGame("classic", seeded(35)));

    expect(stalled.outcome).toBeUndefined();
    expect(scoreGame(stalled)).toBe(0);
  });

  it("makes hard worth more than easy for the same clear", () => {
    expect(scoreGame(cleared("hard"))).toBeGreaterThan(scoreGame(cleared("easy")));
  });
});

describe("paintOrder", () => {
  it("paints the bottom layer first, so no tile is drawn before the one it rests on", () => {
    const state = startGame("classic", seeded(36));
    const layers = paintOrder(state).map((index) => state.tiles[index].position.layer);

    expect(layers).toEqual([...layers].sort((a, b) => a - b));
  });

  it("includes every tile exactly once", () => {
    const state = startGame("classic", seeded(37));
    const order = paintOrder(state);

    expect(order).toHaveLength(state.tiles.length);
    expect(new Set(order).size).toBe(state.tiles.length);
  });
});

describe("boardBounds", () => {
  it("covers the turtle's head, which sits at a negative column", () => {
    const state = startGame("classic", seeded(38));
    const bounds = boardBounds(state);

    expect(bounds.minCol).toBeLessThan(0);
    for (const entry of state.tiles) {
      expect(entry.position.col).toBeGreaterThanOrEqual(bounds.minCol);
      expect(entry.position.col - bounds.minCol + TILE_SPAN).toBeLessThanOrEqual(bounds.cols);
    }
  });

  it("reports the turtle's five layers", () => {
    expect(boardBounds(startGame("classic", seeded(39))).layers).toBe(5);
  });
});
