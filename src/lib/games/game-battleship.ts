import {
  BATTLESHIP_CELLS,
  BATTLESHIP_FLEET,
  BATTLESHIP_ROW_LABELS,
  BATTLESHIP_SCORE_BASE,
  BATTLESHIP_SETUP,
  BATTLESHIP_SHIP_KINDS,
  BATTLESHIP_SIZE,
  type BattleshipBoard,
  type BattleshipDifficulty,
  type BattleshipMaskedCell,
  type BattleshipOwnCell,
  type BattleshipPlayerView,
  type BattleshipShip,
  type BattleshipShipKind,
  type BattleshipShot,
  type BattleshipSide,
  type BattleshipState,
} from "./types";

/**
 * The rules of Battleship, as pure functions over an immutable `BattleshipState`.
 *
 * The RNG arrives as an argument, as in every other game here, so a test can lay a
 * known fleet. Every function returns a new state and never mutates its argument.
 *
 * The rules are the authority: `fire` refuses an out-of-turn or repeated shot rather
 * than trusting the screen to have disabled the button, and `ready` refuses a fleet
 * that is incomplete, overlapping or off the board.
 */

/** A source of randomness in [0, 1). `Math.random` in the app; a stub in tests. */
export type Random = () => number;

export const rowOf = (index: number): number => Math.floor(index / BATTLESHIP_SIZE);
export const colOf = (index: number): number => index % BATTLESHIP_SIZE;
export const indexOf = (row: number, col: number): number => row * BATTLESHIP_SIZE + col;

/** `B7` for row 1, column 6. */
export function coordLabel(index: number): string {
  return `${BATTLESHIP_ROW_LABELS[rowOf(index)]}${colOf(index) + 1}`;
}

/** The ship's cells, or `undefined` when any of them is off the board. */
export function shipCells(ship: BattleshipShip): readonly number[] | undefined {
  const { length } = BATTLESHIP_FLEET[ship.kind];
  const cells: number[] = [];
  for (let step = 0; step < length; step += 1) {
    const row = ship.orientation === "vertical" ? ship.row + step : ship.row;
    const col = ship.orientation === "horizontal" ? ship.col + step : ship.col;
    if (row < 0 || row >= BATTLESHIP_SIZE || col < 0 || col >= BATTLESHIP_SIZE) return undefined;
    cells.push(indexOf(row, col));
  }
  return cells;
}

/** The ship occupying `index`, if any. */
export function shipAt(ships: readonly BattleshipShip[], index: number): BattleshipShip | undefined {
  return ships.find((ship) => shipCells(ship)?.includes(index));
}

/**
 * Whether `ship` fits among `ships`: on the board and overlapping nothing. A ship of
 * the same kind already in the list is ignored, so moving a placed ship checks against
 * the rest of the fleet rather than against itself.
 */
export function canPlaceShip(ships: readonly BattleshipShip[], ship: BattleshipShip): boolean {
  const cells = shipCells(ship);
  if (!cells) return false;
  const taken = new Set(
    ships.filter((other) => other.kind !== ship.kind).flatMap((other) => shipCells(other) ?? []),
  );
  return cells.every((cell) => !taken.has(cell));
}

export type FleetCheck = { ok: true } | { ok: false; reason: string };

/**
 * Whether `ships` is a legal fleet: exactly one of each kind, every ship on the board,
 * no two overlapping. Lengths cannot be wrong — they come from the kind — so a fleet
 * that passes here has exactly 17 ship cells.
 */
export function validateFleet(ships: readonly BattleshipShip[]): FleetCheck {
  for (const kind of BATTLESHIP_SHIP_KINDS) {
    const count = ships.filter((ship) => ship.kind === kind).length;
    if (count === 0) return { ok: false, reason: `Place your ${BATTLESHIP_FLEET[kind].name}.` };
    if (count > 1) return { ok: false, reason: `Only one ${BATTLESHIP_FLEET[kind].name} allowed.` };
  }
  if (ships.length !== BATTLESHIP_SHIP_KINDS.length) {
    return { ok: false, reason: "The fleet has an unknown ship in it." };
  }

  const taken = new Set<number>();
  for (const ship of ships) {
    const cells = shipCells(ship);
    const name = BATTLESHIP_FLEET[ship.kind].name;
    if (!cells) return { ok: false, reason: `The ${name} runs off the board.` };
    for (const cell of cells) {
      if (taken.has(cell)) return { ok: false, reason: `The ${name} overlaps another ship.` };
      taken.add(cell);
    }
  }
  return { ok: true };
}

/**
 * A complete, legal fleet laid at random.
 *
 * Rejection sampling, largest ship first: there are always far more free placements
 * than taken ones on a 10x10 board, so this ends in a handful of draws per ship.
 */
export function randomFleet(random: Random): BattleshipShip[] {
  const ships: BattleshipShip[] = [];
  for (const kind of BATTLESHIP_SHIP_KINDS) {
    for (;;) {
      const ship: BattleshipShip = {
        kind,
        orientation: random() < 0.5 ? "horizontal" : "vertical",
        row: Math.floor(random() * BATTLESHIP_SIZE),
        col: Math.floor(random() * BATTLESHIP_SIZE),
      };
      if (canPlaceShip(ships, ship)) {
        ships.push(ship);
        break;
      }
    }
  }
  return ships;
}

/** A new game at `difficulty`, waiting for the player to lay out a fleet. */
export function startGame(difficulty: BattleshipDifficulty): BattleshipState {
  return {
    phase: "placement",
    difficulty,
    boards: { player: { ships: [], shots: [] }, computer: { ships: [], shots: [] } },
    turn: "player",
  };
}

function withPlayerShips(state: BattleshipState, ships: readonly BattleshipShip[]): BattleshipState {
  return { ...state, boards: { ...state.boards, player: { ...state.boards.player, ships } } };
}

/**
 * Place (or move) one of the player's ships. Returns the state unchanged when the ship
 * does not fit or the game is past placement — the screen previews with `canPlaceShip`.
 */
export function placeShip(state: BattleshipState, ship: BattleshipShip): BattleshipState {
  if (state.phase !== "placement") return state;
  const ships = state.boards.player.ships;
  if (!canPlaceShip(ships, ship)) return state;
  return withPlayerShips(state, [...ships.filter((other) => other.kind !== ship.kind), ship]);
}

/** Take one of the player's ships back off the board. */
export function removeShip(state: BattleshipState, kind: BattleshipShipKind): BattleshipState {
  if (state.phase !== "placement") return state;
  return withPlayerShips(
    state,
    state.boards.player.ships.filter((ship) => ship.kind !== kind),
  );
}

/** The "Randomize Fleet" button: replaces whatever the player had placed. */
export function randomizePlayerFleet(state: BattleshipState, random: Random): BattleshipState {
  if (state.phase !== "placement") return state;
  return withPlayerShips(state, randomFleet(random));
}

export function clearPlayerFleet(state: BattleshipState): BattleshipState {
  if (state.phase !== "placement") return state;
  return withPlayerShips(state, []);
}

export type ReadyResult = { ok: true; state: BattleshipState } | { ok: false; reason: string };

/**
 * Lock in the player's fleet and start the battle. The computer's fleet is laid here
 * rather than in `startGame`, which keeps a fresh game deterministic — nothing random
 * happens until the player commits. The player fires first.
 */
export function ready(state: BattleshipState, random: Random): ReadyResult {
  if (state.phase !== "placement") return { ok: false, reason: "The fleet is already locked in." };
  const check = validateFleet(state.boards.player.ships);
  if (!check.ok) return check;
  return {
    ok: true,
    state: {
      ...state,
      phase: "battle",
      turn: "player",
      boards: { ...state.boards, computer: { ships: randomFleet(random), shots: [] } },
    },
  };
}

const opponentOf = (side: BattleshipSide): BattleshipSide =>
  side === "player" ? "computer" : "player";

/** Whether every cell of `ship` has been fired at on `board`. */
function isSunk(board: BattleshipBoard, ship: BattleshipShip): boolean {
  const shots = new Set(board.shots);
  return (shipCells(ship) ?? []).every((cell) => shots.has(cell));
}

/** The kinds sunk on `board`, in the order they went down. */
export function sunkShips(board: BattleshipBoard): BattleshipShipKind[] {
  const sunkAt = board.ships
    .map((ship) => {
      if (!isSunk(board, ship)) return undefined;
      // A ship goes down on the shot that hit its last cell.
      const last = Math.max(...(shipCells(ship) ?? []).map((cell) => board.shots.indexOf(cell)));
      return { kind: ship.kind, last };
    })
    .filter((entry): entry is { kind: BattleshipShipKind; last: number } => entry !== undefined);
  return sunkAt.sort((a, b) => a.last - b.last).map((entry) => entry.kind);
}

/** Whether every ship on `board` has gone down. An empty board has not been beaten. */
export function isFleetDestroyed(board: BattleshipBoard): boolean {
  return board.ships.length > 0 && board.ships.every((ship) => isSunk(board, ship));
}

export type FireRefusal = "not-in-battle" | "not-your-turn" | "off-board" | "already-fired";

export type FireResult =
  | { ok: true; state: BattleshipState; shot: BattleshipShot }
  | { ok: false; reason: FireRefusal };

/**
 * `by` fires at `index` in the other side's waters.
 *
 * Refuses a shot out of turn, off the board, at a cell already fired at, or outside
 * the battle. Otherwise records it, reports miss / hit / sunk (naming the ship), and
 * ends the game the moment the last of the 17 ship cells is hit. Turns alternate on
 * every shot, hit or miss.
 */
export function fire(state: BattleshipState, by: BattleshipSide, index: number): FireResult {
  if (state.phase !== "battle") return { ok: false, reason: "not-in-battle" };
  if (state.turn !== by) return { ok: false, reason: "not-your-turn" };
  if (!Number.isInteger(index) || index < 0 || index >= BATTLESHIP_CELLS) {
    return { ok: false, reason: "off-board" };
  }

  const target = opponentOf(by);
  const board = state.boards[target];
  if (board.shots.includes(index)) return { ok: false, reason: "already-fired" };

  const after: BattleshipBoard = { ...board, shots: [...board.shots, index] };
  const struck = shipAt(after.ships, index);
  const shot: BattleshipShot = !struck
    ? { by, index, result: "miss" }
    : isSunk(after, struck)
      ? { by, index, result: "sunk", sunk: struck.kind }
      : { by, index, result: "hit" };

  const won = isFleetDestroyed(after);
  return {
    ok: true,
    shot,
    state: {
      ...state,
      boards: { ...state.boards, [target]: after },
      lastShot: shot,
      phase: won ? "game-over" : "battle",
      turn: won ? by : target,
      winner: won ? by : undefined,
    },
  };
}

/**
 * What a side may know of `board` when it is not its own: misses, hits, and sunk ships
 * in full. Open sea and an unhit ship both read `unknown`. The computer's opponent
 * makes its choices from this too, so it cannot see the player's fleet either.
 */
export function maskBoard(board: BattleshipBoard): BattleshipMaskedCell[] {
  const cells: BattleshipMaskedCell[] = Array.from({ length: BATTLESHIP_CELLS }, () => "unknown");
  const sunk = new Set(sunkShips(board));
  for (const index of board.shots) {
    const ship = shipAt(board.ships, index);
    cells[index] = !ship ? "miss" : sunk.has(ship.kind) ? "sunk" : "hit";
  }
  return cells;
}

/** A side's own waters, seen in full. */
export function ownBoard(board: BattleshipBoard): BattleshipOwnCell[] {
  const shots = new Set(board.shots);
  const cells: BattleshipOwnCell[] = Array.from({ length: BATTLESHIP_CELLS }, (_, index) => ({
    shot: shots.has(index),
  }));
  for (const ship of board.ships) {
    for (const cell of shipCells(ship) ?? []) cells[cell] = { ...cells[cell], ship: ship.kind };
  }
  return cells;
}

/**
 * The player's view of the game: their own board in full, the computer's masked.
 *
 * Once the game is over the computer's surviving ships are revealed, since there is
 * nothing left to hide — the masked board still marks which cells were found.
 */
export function playerView(state: BattleshipState): BattleshipPlayerView {
  return {
    phase: state.phase,
    turn: state.turn,
    winner: state.winner,
    lastShot: state.lastShot,
    own: ownBoard(state.boards.player),
    opponent: maskBoard(state.boards.computer),
    ownSunk: sunkShips(state.boards.player),
    opponentSunk: sunkShips(state.boards.computer),
    shotsFired: state.boards.computer.shots.length,
  };
}

/** The computer's ships, only once the game is over. Undefined mid-game. */
export function revealedComputerFleet(state: BattleshipState): readonly BattleshipShip[] | undefined {
  return state.phase === "game-over" ? state.boards.computer.ships : undefined;
}

/** A won game's points; a lost or unfinished one scores 0. See `BATTLESHIP_SCORE_BASE`. */
export function scoreGame(state: BattleshipState): number {
  if (state.winner !== "player") return 0;
  const shots = state.boards.computer.shots.length;
  return (BATTLESHIP_SCORE_BASE - shots) * BATTLESHIP_SETUP[state.difficulty].multiplier;
}

/**
 * The ships sunk on `board`, with their positions. Sinking a ship reveals every one of
 * its cells, so this is something the other side is allowed to know — the view uses it
 * to animate the wreck going down without reading the rest of the fleet.
 */
export function sunkShipPlacements(board: BattleshipBoard): BattleshipShip[] {
  const sunk = new Set(sunkShips(board));
  return board.ships.filter((ship) => sunk.has(ship.kind));
}
