import { describe, expect, it } from "vitest";
import { chooseShot, heatMap, takeComputerTurn } from "./battleship-bot";
import { fire, placeShip, randomFleet, ready, startGame } from "./game-battleship";
import {
  BATTLESHIP_CELLS,
  BATTLESHIP_DIFFICULTIES,
  BATTLESHIP_SHIP_KINDS,
  type BattleshipDifficulty,
  type BattleshipMaskedCell,
  type BattleshipState,
} from "./types";

function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

function blank(): BattleshipMaskedCell[] {
  return Array.from({ length: BATTLESHIP_CELLS }, () => "unknown");
}

/** A battle that has just started, with the player to fire first. */
function computerToMove(difficulty: BattleshipDifficulty, seed: number): BattleshipState {
  const placed = randomFleet(seeded(seed)).reduce(placeShip, startGame(difficulty));
  const started = ready(placed, seeded(seed + 1));
  if (!started.ok) throw new Error(started.reason);
  return started.state;
}

/** Play the computer against a passive player until it wins, returning its shot count. */
function computerShotsToWin(difficulty: BattleshipDifficulty, seed: number): number {
  let state = computerToMove(difficulty, seed);
  const random = seeded(seed + 2);
  while (state.phase === "battle") {
    // The player passes every turn, so only the computer's shooting is measured.
    state = { ...state, turn: "computer" };
    const result = takeComputerTurn(state, random);
    if (!result.ok) throw new Error(result.reason);
    state = result.state;
  }
  expect(state.winner).toBe("computer");
  return state.boards.player.shots.length;
}

describe("chooseShot", () => {
  it("only ever picks an unknown cell", () => {
    const view = blank();
    view[0] = "miss";
    view[1] = "hit";
    view[2] = "sunk";
    for (const difficulty of BATTLESHIP_DIFFICULTIES) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const shot = chooseShot(view, BATTLESHIP_SHIP_KINDS, difficulty, seeded(seed));
        expect(view[shot]).toBe("unknown");
      }
    }
  });

  it("follows up a lone hit with a neighbour on Normal", () => {
    const view = blank();
    view[55] = "hit";
    const shot = chooseShot(view, BATTLESHIP_SHIP_KINDS, "normal", seeded(4));
    expect([45, 65, 54, 56]).toContain(shot);
  });

  it("extends a line of two hits on Normal", () => {
    const view = blank();
    view[55] = "hit";
    view[56] = "hit";
    for (let seed = 1; seed <= 10; seed += 1) {
      expect([54, 57]).toContain(chooseShot(view, BATTLESHIP_SHIP_KINDS, "normal", seeded(seed)));
    }
  });

  it("hunts on the checkerboard on Normal when nothing is hit", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const shot = chooseShot(blank(), BATTLESHIP_SHIP_KINDS, "normal", seeded(seed));
      expect((Math.floor(shot / 10) + (shot % 10)) % 2).toBe(0);
    }
  });

  it("throws when the board is full", () => {
    const full: BattleshipMaskedCell[] = Array.from({ length: BATTLESHIP_CELLS }, () => "miss");
    expect(() => chooseShot(full, BATTLESHIP_SHIP_KINDS, "easy", seeded(1))).toThrow();
  });
});

describe("heatMap", () => {
  it("favours the middle of an empty board over the corners", () => {
    const heat = heatMap(blank(), BATTLESHIP_SHIP_KINDS);
    expect(heat[44]).toBeGreaterThan(heat[0]);
  });

  it("only scores cells next to a hit while one is unsunk", () => {
    const view = blank();
    view[0] = "hit";
    const heat = heatMap(view, ["destroyer"]);
    expect(heat[1]).toBeGreaterThan(0);
    expect(heat[10]).toBeGreaterThan(0);
    expect(heat[55]).toBe(0);
  });

  it("never scores a cell no remaining ship could fit through", () => {
    const view = blank();
    // Wall A2 and B1 off with misses: A1 is a one-cell pocket, too small for a destroyer.
    view[1] = "miss";
    view[10] = "miss";
    expect(heatMap(view, ["destroyer"])[0]).toBe(0);
  });
});

describe("takeComputerTurn", () => {
  it("fires a legal shot and hands the turn back", () => {
    const state = computerToMove("normal", 3);
    const afterPlayer = fire(state, "player", 99);
    if (!afterPlayer.ok) throw new Error(afterPlayer.reason);
    const result = takeComputerTurn(afterPlayer.state, seeded(5));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.turn).toBe("player");
  });

  it("refuses to fire out of turn", () => {
    expect(takeComputerTurn(computerToMove("easy", 3), seeded(5))).toEqual({
      ok: false,
      reason: "not-your-turn",
    });
  });

  it("finishes the player's fleet without repeating a shot, at every level", () => {
    for (const difficulty of BATTLESHIP_DIFFICULTIES) {
      const shots = computerShotsToWin(difficulty, 7);
      expect(shots).toBeGreaterThanOrEqual(17);
      expect(shots).toBeLessThanOrEqual(100);
    }
  });

  it("needs fewer shots on Hard than on Easy, on average", () => {
    const average = (difficulty: BattleshipDifficulty) => {
      let total = 0;
      for (let seed = 1; seed <= 15; seed += 1) total += computerShotsToWin(difficulty, seed * 11);
      return total / 15;
    };
    expect(average("hard")).toBeLessThan(average("easy"));
  });
});
