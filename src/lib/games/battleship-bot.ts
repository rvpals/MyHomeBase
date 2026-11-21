import { colOf, fire, indexOf, maskBoard, rowOf, shipCells, sunkShips, type FireResult, type Random } from "./game-battleship";
import {
  BATTLESHIP_CELLS,
  BATTLESHIP_FLEET,
  BATTLESHIP_SHIP_KINDS,
  BATTLESHIP_SIZE,
  type BattleshipDifficulty,
  type BattleshipMaskedCell,
  type BattleshipShipKind,
  type BattleshipState,
} from "./types";

/**
 * The computer's targeting.
 *
 * It chooses from the *masked* player board — the same view a person would have — so
 * the bot cannot cheat by construction; it never reads the player's ship list.
 *
 * - **Easy** fires at random.
 * - **Normal** hunts on a checkerboard, and after a hit tries the neighbours, then
 *   follows the line once two hits agree on a direction.
 * - **Hard** counts, for every cell, how many placements of the ships still afloat
 *   would cover it, and fires at the likeliest. With hits on the board, only
 *   placements that pass through them count, weighted by how many they explain.
 */

function pick<T>(items: readonly T[], random: Random): T {
  return items[Math.floor(random() * items.length)];
}

function unknownCells(view: readonly BattleshipMaskedCell[]): number[] {
  const out: number[] = [];
  for (let index = 0; index < BATTLESHIP_CELLS; index += 1) if (view[index] === "unknown") out.push(index);
  return out;
}

/** The up-to-four orthogonal neighbours of `index`. */
function orthogonal(index: number): number[] {
  const row = rowOf(index);
  const col = colOf(index);
  const out: number[] = [];
  if (row > 0) out.push(indexOf(row - 1, col));
  if (row < BATTLESHIP_SIZE - 1) out.push(indexOf(row + 1, col));
  if (col > 0) out.push(indexOf(row, col - 1));
  if (col < BATTLESHIP_SIZE - 1) out.push(indexOf(row, col + 1));
  return out;
}

/**
 * Normal's follow-up after a hit. Prefers cells that extend a line of two or more
 * hits; falls back to any unknown neighbour of a hit. Empty when there are no
 * unsunk hits, which sends the caller back to hunting.
 */
function targetCandidates(view: readonly BattleshipMaskedCell[]): number[] {
  const hits = view.flatMap((cell, index) => (cell === "hit" ? [index] : []));
  if (hits.length === 0) return [];
  const hitSet = new Set(hits);

  const inLine: number[] = [];
  for (const hit of hits) {
    for (const [dr, dc] of [[0, 1], [1, 0]] as const) {
      const row = rowOf(hit);
      const col = colOf(hit);
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (nextRow >= BATTLESHIP_SIZE || nextCol >= BATTLESHIP_SIZE) continue;
      if (!hitSet.has(indexOf(nextRow, nextCol))) continue;
      // Two adjacent hits along (dr, dc): walk both ways to the ends of the run.
      for (const sign of [-1, 1]) {
        let r = row;
        let c = col;
        while (r >= 0 && r < BATTLESHIP_SIZE && c >= 0 && c < BATTLESHIP_SIZE && hitSet.has(indexOf(r, c))) {
          r += dr * sign;
          c += dc * sign;
        }
        if (r >= 0 && r < BATTLESHIP_SIZE && c >= 0 && c < BATTLESHIP_SIZE && view[indexOf(r, c)] === "unknown") {
          inLine.push(indexOf(r, c));
        }
      }
    }
  }
  if (inLine.length > 0) return [...new Set(inLine)];

  return [...new Set(hits.flatMap(orthogonal).filter((cell) => view[cell] === "unknown"))];
}

/**
 * Hard's heat map: how many legal placements of the remaining ships cover each cell.
 * A placement is legal when it crosses no miss and no sunk cell. With unsunk hits on
 * the board, only placements through at least one hit count, weighted by how many.
 */
export function heatMap(
  view: readonly BattleshipMaskedCell[],
  afloat: readonly BattleshipShipKind[],
): number[] {
  const heat = Array.from({ length: BATTLESHIP_CELLS }, () => 0);
  const targeting = view.includes("hit");

  for (const kind of afloat) {
    for (let row = 0; row < BATTLESHIP_SIZE; row += 1) {
      for (let col = 0; col < BATTLESHIP_SIZE; col += 1) {
        for (const orientation of ["horizontal", "vertical"] as const) {
          const cells = shipCells({ kind, row, col, orientation });
          if (!cells) continue;
          if (cells.some((cell) => view[cell] === "miss" || view[cell] === "sunk")) continue;
          const hitsCovered = cells.filter((cell) => view[cell] === "hit").length;
          if (targeting && hitsCovered === 0) continue;
          const weight = targeting ? 1 + hitsCovered * 10 : 1;
          for (const cell of cells) if (view[cell] === "unknown") heat[cell] += weight;
        }
      }
    }
  }
  return heat;
}

/**
 * The cell the computer fires at next. Always an `unknown` cell — never a repeat —
 * so the result is a legal shot whenever any cell is left.
 */
export function chooseShot(
  view: readonly BattleshipMaskedCell[],
  afloat: readonly BattleshipShipKind[],
  difficulty: BattleshipDifficulty,
  random: Random,
): number {
  const open = unknownCells(view);
  if (open.length === 0) throw new Error("No cell left to fire at.");

  if (difficulty === "easy") return pick(open, random);

  if (difficulty === "normal") {
    const targets = targetCandidates(view);
    if (targets.length > 0) return pick(targets, random);
    // Hunt on a checkerboard: the smallest ship afloat always covers a cell of a
    // lattice with its own spacing, so the gaps can wait.
    const spacing =
      afloat.length > 0 ? Math.min(...afloat.map((kind) => BATTLESHIP_FLEET[kind].length)) : 1;
    const lattice = open.filter((cell) => (rowOf(cell) + colOf(cell)) % spacing === 0);
    return pick(lattice.length > 0 ? lattice : open, random);
  }

  const heat = heatMap(view, afloat);
  const best = Math.max(...open.map((cell) => heat[cell]));
  const hottest = best > 0 ? open.filter((cell) => heat[cell] === best) : open;
  return pick(hottest, random);
}

/** The computer takes its turn: masks the player's board, chooses, fires. */
export function takeComputerTurn(state: BattleshipState, random: Random): FireResult {
  const board = state.boards.player;
  const sunk = new Set(sunkShips(board));
  const afloat = BATTLESHIP_SHIP_KINDS.filter((kind) => !sunk.has(kind));
  const index = chooseShot(maskBoard(board), afloat, state.difficulty, random);
  return fire(state, "computer", index);
}
