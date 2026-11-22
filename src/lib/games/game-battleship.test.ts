import { describe, expect, it } from "vitest";
import {
  canPlaceShip,
  coordLabel,
  fire,
  maskBoard,
  placeShip,
  playerView,
  randomFleet,
  randomizePlayerFleet,
  ready,
  removeShip,
  revealedComputerFleet,
  scoreGame,
  shipCells,
  startGame,
  sunkShipPlacements,
  sunkShips,
  validateFleet,
} from "./game-battleship";
import {
  BATTLESHIP_FLEET_CELLS,
  BATTLESHIP_SCORE_BASE,
  type BattleshipShip,
  type BattleshipState,
} from "./types";

/** A deterministic LCG, so a "random" fleet is the same on every run. */
function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

/** Each ship on its own row, starting at column 0: A1–A5, B1–B4, C1–C3, D1–D3, E1–E2. */
const ROWS_FLEET: BattleshipShip[] = [
  { kind: "carrier", row: 0, col: 0, orientation: "horizontal" },
  { kind: "battleship", row: 1, col: 0, orientation: "horizontal" },
  { kind: "cruiser", row: 2, col: 0, orientation: "horizontal" },
  { kind: "submarine", row: 3, col: 0, orientation: "horizontal" },
  { kind: "destroyer", row: 4, col: 0, orientation: "horizontal" },
];

const ROWS_FLEET_CELLS = ROWS_FLEET.flatMap((ship) => [...(shipCells(ship) ?? [])]);

/** A battle with both fleets laid out as `ROWS_FLEET`, the player to fire. */
function battle(): BattleshipState {
  const placed = ROWS_FLEET.reduce(placeShip, startGame("normal"));
  const result = ready(placed, seeded(1));
  if (!result.ok) throw new Error(result.reason);
  return {
    ...result.state,
    boards: { ...result.state.boards, computer: { ships: ROWS_FLEET, shots: [] } },
  };
}

/** Fire `index` as the player, then a harmless computer shot, so it is the player's turn again. */
function volley(state: BattleshipState, index: number, computerIndex: number): BattleshipState {
  const mine = fire(state, "player", index);
  if (!mine.ok) throw new Error(mine.reason);
  if (mine.state.phase === "game-over") return mine.state;
  const theirs = fire(mine.state, "computer", computerIndex);
  if (!theirs.ok) throw new Error(theirs.reason);
  return theirs.state;
}

describe("coordinates and ship cells", () => {
  it("labels cells A1 to J10", () => {
    expect(coordLabel(0)).toBe("A1");
    expect(coordLabel(16)).toBe("B7");
    expect(coordLabel(99)).toBe("J10");
  });

  it("lays a ship out from its bow", () => {
    expect(shipCells({ kind: "destroyer", row: 0, col: 0, orientation: "horizontal" })).toEqual([0, 1]);
    expect(shipCells({ kind: "cruiser", row: 0, col: 9, orientation: "vertical" })).toEqual([9, 19, 29]);
  });

  it("refuses a ship that runs off the board", () => {
    expect(shipCells({ kind: "carrier", row: 0, col: 6, orientation: "horizontal" })).toBeUndefined();
    expect(shipCells({ kind: "carrier", row: 6, col: 0, orientation: "vertical" })).toBeUndefined();
  });
});

describe("placement", () => {
  it("accepts a complete, legal fleet", () => {
    expect(validateFleet(ROWS_FLEET)).toEqual({ ok: true });
  });

  it("refuses an incomplete fleet, naming the missing ship", () => {
    const check = validateFleet(ROWS_FLEET.slice(0, 4));
    expect(check).toEqual({ ok: false, reason: "Place your Destroyer." });
  });

  it("refuses overlapping ships", () => {
    const overlapping = [...ROWS_FLEET.slice(0, 4), { ...ROWS_FLEET[4], row: 0 }];
    const check = validateFleet(overlapping);
    expect(check.ok).toBe(false);
  });

  it("refuses a ship off the board and a duplicate kind", () => {
    const offBoard = [...ROWS_FLEET.slice(0, 4), { ...ROWS_FLEET[4], col: 9 }];
    expect(validateFleet(offBoard).ok).toBe(false);
    expect(validateFleet([...ROWS_FLEET, ROWS_FLEET[4]]).ok).toBe(false);
  });

  it("checks a moved ship against the others but not against itself", () => {
    expect(canPlaceShip(ROWS_FLEET, { ...ROWS_FLEET[4], col: 1 })).toBe(true);
    expect(canPlaceShip(ROWS_FLEET, { ...ROWS_FLEET[4], row: 3 })).toBe(false);
  });

  it("places, moves and removes a ship, and ignores an illegal placement", () => {
    let state = placeShip(startGame("easy"), ROWS_FLEET[0]);
    state = placeShip(state, { ...ROWS_FLEET[0], row: 5 });
    expect(state.boards.player.ships).toEqual([{ ...ROWS_FLEET[0], row: 5 }]);

    const unchanged = placeShip(state, { ...ROWS_FLEET[1], row: 5 });
    expect(unchanged).toBe(state);

    expect(removeShip(state, "carrier").boards.player.ships).toEqual([]);
  });

  it("lays a legal random fleet, every time", () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      expect(validateFleet(randomFleet(seeded(seed)))).toEqual({ ok: true });
    }
    expect(validateFleet(randomizePlayerFleet(startGame("hard"), seeded(3)).boards.player.ships)).toEqual({
      ok: true,
    });
  });

  it("won't start the battle with an incomplete fleet", () => {
    const result = ready(placeShip(startGame("easy"), ROWS_FLEET[0]), seeded(1));
    expect(result.ok).toBe(false);
  });

  it("lays the computer's fleet on ready and hands the player the first shot", () => {
    const placed = ROWS_FLEET.reduce(placeShip, startGame("easy"));
    expect(placed.boards.computer.ships).toEqual([]);
    const result = ready(placed, seeded(9));
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.phase).toBe("battle");
    expect(result.state.turn).toBe("player");
    expect(validateFleet(result.state.boards.computer.ships)).toEqual({ ok: true });
  });
});

describe("firing", () => {
  it("reports a miss, then a hit, then a sunk ship by class", () => {
    const miss = fire(battle(), "player", 99);
    expect(miss.ok && miss.shot).toEqual({ by: "player", index: 99, result: "miss" });
    expect(miss.ok && miss.state.turn).toBe("computer");

    let state = volley(battle(), 99, 99);
    const hit = fire(state, "player", 40);
    expect(hit.ok && hit.shot).toEqual({ by: "player", index: 40, result: "hit" });

    state = volley(state, 40, 98);
    const sunk = fire(state, "player", 41);
    expect(sunk.ok && sunk.shot).toEqual({ by: "player", index: 41, result: "sunk", sunk: "destroyer" });
  });

  it("refuses a shot out of turn", () => {
    expect(fire(battle(), "computer", 0)).toEqual({ ok: false, reason: "not-your-turn" });
  });

  it("refuses a repeated shot", () => {
    const state = volley(battle(), 50, 50);
    expect(fire(state, "player", 50)).toEqual({ ok: false, reason: "already-fired" });
  });

  it("refuses a shot off the board or before the battle", () => {
    expect(fire(battle(), "player", 100)).toEqual({ ok: false, reason: "off-board" });
    expect(fire(battle(), "player", 1.5)).toEqual({ ok: false, reason: "off-board" });
    expect(fire(startGame("easy"), "player", 0)).toEqual({ ok: false, reason: "not-in-battle" });
  });

  it("ends the game on the 17th hit and scores by shots fired", () => {
    let state = battle();
    const misses = [99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83];
    ROWS_FLEET_CELLS.forEach((cell, shot) => {
      state = volley(state, cell, misses[shot]);
    });
    expect(ROWS_FLEET_CELLS).toHaveLength(BATTLESHIP_FLEET_CELLS);
    expect(state.phase).toBe("game-over");
    expect(state.winner).toBe("player");
    expect(state.lastShot?.result).toBe("sunk");
    // A perfect game at Normal (x2).
    expect(scoreGame(state)).toBe((BATTLESHIP_SCORE_BASE - 17) * 2);
    expect(fire(state, "computer", 0)).toEqual({ ok: false, reason: "not-in-battle" });
  });

  it("scores nothing for a loss or an unfinished game", () => {
    expect(scoreGame(battle())).toBe(0);
    const lost: BattleshipState = { ...battle(), phase: "game-over", winner: "computer" };
    expect(scoreGame(lost)).toBe(0);
  });
});

describe("what the player can see", () => {
  it("masks unhit ships as unknown and shows hits, misses and sunk ships", () => {
    const board = { ships: ROWS_FLEET, shots: [0, 99, 40, 41] };
    const view = maskBoard(board);
    expect(view[0]).toBe("hit");
    expect(view[1]).toBe("unknown"); // the rest of the carrier stays hidden
    expect(view[99]).toBe("miss");
    expect(view[40]).toBe("sunk");
    expect(view[41]).toBe("sunk");
    expect(sunkShips(board)).toEqual(["destroyer"]);
  });

  it("gives the position of sunk ships only, not of damaged or untouched ones", () => {
    // The destroyer is sunk; the carrier is hit once; the rest are untouched.
    const board = { ships: ROWS_FLEET, shots: [0, 40, 41] };
    expect(sunkShipPlacements(board)).toEqual([ROWS_FLEET[4]]);
    expect(sunkShipPlacements({ ships: ROWS_FLEET, shots: [] })).toEqual([]);
  });

  it("never puts the computer's unhit ships in the player's view mid-game", () => {
    const view = playerView(volley(battle(), 0, 99));
    const known = view.opponent.filter((cell) => cell !== "unknown");
    expect(known).toEqual(["hit"]);
    expect(view.own.filter((cell) => cell.ship).length).toBe(BATTLESHIP_FLEET_CELLS);
    expect(revealedComputerFleet(battle())).toBeUndefined();
  });
});
