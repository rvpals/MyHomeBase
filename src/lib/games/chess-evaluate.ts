import { fileOf, oppositeColor, rowOf } from "./chess-board";
import {
  CHESS_BOARD_SIZE,
  CHESS_SQUARE_COUNT,
  type ChessColor,
  type ChessPiece,
  type ChessPosition,
} from "./types";

/**
 * How good a position is, in centipawns.
 *
 * Lifted out of `chess-bot.ts`, which had grown to hold the tables, the search and the
 * level behaviour at once. The split is along a real seam: **this file decides what a
 * position is worth, and nothing in it looks a move ahead.** Everything here is a pure
 * function of the pieces on the board.
 *
 * What it understands, beyond material and piece-square tables:
 *
 * - **King safety** — a king with its pawn shield intact is safer than one sitting in
 *   the open, which is the single thing that most separates a plausible-looking move
 *   from a good one in the middlegame.
 * - **Pawn structure** — doubled, isolated and passed pawns.
 * - **The bishop pair**, worth about half a pawn and invisible to a material count.
 * - **Rooks on open and half-open files.**
 * - **Mobility**, counted as pseudo-legal moves, which is a cheap stand-in for "how
 *   much is this piece actually doing".
 * - **Driving the enemy king to the edge in the endgame**, without which king-and-queen
 *   against a bare king shuffles until the fifty-move rule ends it.
 */

/** Centipawn values. The king's is nominal — mate is scored by the search. */
export const CHESS_PIECE_VALUES: Record<ChessPiece["type"], number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20_000,
};

/**
 * Piece-square tables, in centipawns, from **White's point of view and in board order**
 * — index 0 is a8, matching `ChessSquare`. Black reads the same table with the rank
 * mirrored, which is what `squareBonus` does.
 *
 * These are the well-known "simplified evaluation" tables. They are not tuned and are
 * not meant to be: their job is to stop the engine shuffling aimlessly when material is
 * level, by giving knights a reason to come to the middle and pawns a reason to
 * advance. Everything below them in this file is what makes the engine play *chess*
 * rather than just push wood toward good squares.
 */
const PAWN_TABLE: readonly number[] = [
  0, 0, 0, 0, 0, 0, 0, 0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 20, 20, 0, 0, 0,
  5, -5, -10, 0, 0, -10, -5, 5,
  5, 10, 10, -20, -20, 10, 10, 5,
  0, 0, 0, 0, 0, 0, 0, 0,
];

const KNIGHT_TABLE: readonly number[] = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 0, 0, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
];

const BISHOP_TABLE: readonly number[] = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 10, 10, 10, 10, 0, -10,
  -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 5, 0, 0, 0, 0, 5, -10,
  -20, -10, -10, -10, -10, -10, -10, -20,
];

const ROOK_TABLE: readonly number[] = [
  0, 0, 0, 0, 0, 0, 0, 0,
  5, 10, 10, 10, 10, 10, 10, 5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  0, 0, 0, 5, 5, 0, 0, 0,
];

const QUEEN_TABLE: readonly number[] = [
  -20, -10, -10, -5, -5, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 5, 5, 5, 0, -10,
  -5, 0, 5, 5, 5, 5, 0, -5,
  0, 0, 5, 5, 5, 5, 0, -5,
  -10, 5, 5, 5, 5, 5, 0, -10,
  -10, 0, 5, 0, 0, 0, 0, -10,
  -20, -10, -10, -5, -5, -10, -10, -20,
];

/** The king wants to be tucked away behind pawns while there is still an attack. */
const KING_MIDDLEGAME_TABLE: readonly number[] = [
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20,
  20, 30, 10, 0, 0, 10, 30, 20,
];

/**
 * …and in the endgame it wants the middle. Switching tables is the first piece of phase
 * knowledge here, and it is the difference between converting a won endgame and
 * shuffling on the back rank while the fifty-move counter runs out.
 */
const KING_ENDGAME_TABLE: readonly number[] = [
  -50, -40, -30, -20, -20, -30, -40, -50,
  -30, -20, -10, 0, 0, -10, -20, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -30, 0, 0, 0, 0, -30, -30,
  -50, -30, -30, -30, -30, -30, -30, -50,
];

const TABLES: Record<ChessPiece["type"], readonly number[]> = {
  p: PAWN_TABLE,
  n: KNIGHT_TABLE,
  b: BISHOP_TABLE,
  r: ROOK_TABLE,
  q: QUEEN_TABLE,
  k: KING_MIDDLEGAME_TABLE,
};

/**
 * Enough non-pawn material on one side to force mate against a bare king.
 *
 * A rook is the lightest piece that can do it alone; two minors cannot, which is why
 * this is a value threshold rather than a count.
 */
const MATING_MATERIAL = CHESS_PIECE_VALUES.r;

/* --- the weights the extra terms are worth, all in centipawns --------------------- */

/** Two bishops cover both square colours, which a material count cannot see. */
const BISHOP_PAIR_BONUS = 45;

/** Two pawns on one file get in each other's way and cannot defend one another. */
const DOUBLED_PAWN_PENALTY = 18;

/** A pawn with no friendly pawn on either neighbouring file has to be defended by pieces. */
const ISOLATED_PAWN_PENALTY = 16;

/** A passed pawn, by how far it has come. Index is the number of ranks advanced. */
const PASSED_PAWN_BONUS: readonly number[] = [0, 8, 14, 26, 46, 78, 125, 200];

/** A rook on a file with no pawns at all, and on one with only the enemy's. */
const ROOK_OPEN_FILE_BONUS = 22;
const ROOK_HALF_OPEN_FILE_BONUS = 11;

/** Per pseudo-legal move, for the pieces whose activity is worth measuring. */
const MOBILITY_WEIGHT: Partial<Record<ChessPiece["type"], number>> = {
  n: 4,
  b: 5,
  r: 2,
  q: 1,
};

/** What each missing shield pawn in front of a castled king costs. */
const KING_SHIELD_PENALTY = 14;

/** And what standing on a file with no pawn on it at all costs. */
const KING_OPEN_FILE_PENALTY = 20;

/** How hard the stronger side drives the bare king toward a corner in the endgame. */
const MATING_DRIVE_WEIGHT = 10;

/** …and how hard it keeps its own king close enough to help. */
const MATING_PROXIMITY_WEIGHT = 4;

const KNIGHT_STEPS: readonly (readonly [number, number])[] = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1],
];
const BISHOP_STEPS: readonly (readonly [number, number])[] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK_STEPS: readonly (readonly [number, number])[] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const QUEEN_STEPS = [...ROOK_STEPS, ...BISHOP_STEPS];

function squareBonus(piece: ChessPiece, square: number, endgame: boolean): number {
  const table = piece.type === "k" && endgame ? KING_ENDGAME_TABLE : TABLES[piece.type];
  // Black reads White's table with the rank mirrored. The tables are left-right
  // symmetric, so only the rank flips.
  const index = piece.color === "w" ? square : (7 - rowOf(square)) * 8 + (square % 8);
  return table[index] ?? 0;
}

/** Everything counted in one walk of the board, so the terms below share it. */
interface Material {
  /** Pawn counts per file, per colour. */
  pawnsByFile: Record<ChessColor, number[]>;
  /** Every pawn's square, per colour. */
  pawns: Record<ChessColor, number[]>;
  bishops: Record<ChessColor, number>;
  /** Non-pawn, non-king material, in centipawns. */
  nonPawn: Record<ChessColor, number>;
  queens: Record<ChessColor, number>;
  rooks: Record<ChessColor, number>;
  /** Knights and bishops together. */
  minors: Record<ChessColor, number>;
  kings: Record<ChessColor, number>;
}

/**
 * Whether the game has reached an endgame, by the usual rule: a side is "in the
 * endgame" when it has no queen, or has a queen with at most one minor piece and no
 * rook; and the game is when both sides are.
 *
 * A plain material threshold was tried first and was wrong in the case this most
 * matters for. A lone queen is 900 centipawns, more than a rook and a bishop — so
 * **king and queen against a bare king was not counted as an endgame at all**, the
 * king kept its middlegame table, and the mating drive below never ran. That is
 * precisely the ending the drive exists to convert.
 */
function isEndgamePhase(material: Material): boolean {
  const settled = (color: ChessColor): boolean =>
    material.queens[color] === 0 ||
    (material.rooks[color] === 0 && material.minors[color] <= 1);
  return settled("w") && settled("b");
}

function survey(position: ChessPosition): Material {
  const material: Material = {
    pawnsByFile: { w: new Array<number>(8).fill(0), b: new Array<number>(8).fill(0) },
    pawns: { w: [], b: [] },
    bishops: { w: 0, b: 0 },
    nonPawn: { w: 0, b: 0 },
    queens: { w: 0, b: 0 },
    rooks: { w: 0, b: 0 },
    minors: { w: 0, b: 0 },
    kings: { w: -1, b: -1 },
  };

  for (let square = 0; square < CHESS_SQUARE_COUNT; square += 1) {
    const piece = position.board[square];
    if (!piece) continue;

    if (piece.type === "p") {
      material.pawnsByFile[piece.color][fileOf(square)] += 1;
      material.pawns[piece.color].push(square);
    } else if (piece.type === "k") {
      material.kings[piece.color] = square;
    } else {
      material.nonPawn[piece.color] += CHESS_PIECE_VALUES[piece.type];
      if (piece.type === "q") material.queens[piece.color] += 1;
      if (piece.type === "r") material.rooks[piece.color] += 1;
      if (piece.type === "b" || piece.type === "n") material.minors[piece.color] += 1;
      if (piece.type === "b") material.bishops[piece.color] += 1;
    }
  }
  return material;
}

/**
 * The position in centipawns, **from the point of view of the side to move**.
 *
 * Side-to-move relative rather than always-White, because that is what negamax needs:
 * one function, negated at each ply, instead of a sign to keep track of at every call
 * site. Getting that sign wrong in one branch is the classic way an engine starts
 * playing deliberately bad moves.
 */
export function evaluateChessPosition(position: ChessPosition): number {
  const material = survey(position);
  const endgame = isEndgamePhase(material);

  let white = 0;
  let black = 0;

  for (let square = 0; square < CHESS_SQUARE_COUNT; square += 1) {
    const piece = position.board[square];
    if (!piece) continue;

    let value = CHESS_PIECE_VALUES[piece.type] + squareBonus(piece, square, endgame);

    const mobility = MOBILITY_WEIGHT[piece.type];
    if (mobility !== undefined) value += mobility * countMoves(position, square, piece);

    if (piece.type === "r") value += rookFileBonus(material, piece.color, fileOf(square));
    if (piece.type === "k" && !endgame) value -= kingDanger(material, piece.color, square);

    if (piece.color === "w") white += value;
    else black += value;
  }

  for (const color of ["w", "b"] as const) {
    let extra = pawnStructure(material, color);
    // The bishop pair is worth having only while there is a board to use it on; in a
    // bare endgame it is already counted by the material.
    if (material.bishops[color] >= 2) extra += BISHOP_PAIR_BONUS;
    if (color === "w") white += extra;
    else black += extra;
  }

  if (endgame) {
    white += matingDrive(material, "w");
    black += matingDrive(material, "b");
  }

  const score = white - black;
  return position.turn === "w" ? score : -score;
}

/**
 * How many squares a piece can reach, counted pseudo-legally.
 *
 * Pseudo-legal on purpose: asking whether each move is legal would mean a king-safety
 * test per square per piece per node, which is far more than this term is worth. A
 * pinned piece is therefore credited with moves it cannot really make — an
 * over-estimate the search corrects a ply later, when those moves turn out not to
 * exist.
 */
function countMoves(position: ChessPosition, from: number, piece: ChessPiece): number {
  const row = rowOf(from);
  const file = fileOf(from);
  let moves = 0;

  if (piece.type === "n") {
    for (const [rowStep, fileStep] of KNIGHT_STEPS) {
      const to = squareOf(row + rowStep, file + fileStep);
      if (to < 0) continue;
      const target = position.board[to];
      if (!target || target.color !== piece.color) moves += 1;
    }
    return moves;
  }

  const steps =
    piece.type === "b" ? BISHOP_STEPS : piece.type === "r" ? ROOK_STEPS : QUEEN_STEPS;

  for (const [rowStep, fileStep] of steps) {
    for (let distance = 1; distance < CHESS_BOARD_SIZE; distance += 1) {
      const to = squareOf(row + rowStep * distance, file + fileStep * distance);
      if (to < 0) break;
      const target = position.board[to];
      if (!target) {
        moves += 1;
        continue;
      }
      if (target.color !== piece.color) moves += 1;
      break;
    }
  }
  return moves;
}

function squareOf(row: number, file: number): number {
  if (row < 0 || row > 7 || file < 0 || file > 7) return -1;
  return row * 8 + file;
}

/** Doubled, isolated and passed pawns, summed for one colour. */
function pawnStructure(material: Material, color: ChessColor): number {
  const mine = material.pawnsByFile[color];
  const theirs = material.pawnsByFile[oppositeColor(color)];
  let score = 0;

  for (let file = 0; file < CHESS_BOARD_SIZE; file += 1) {
    const count = mine[file] ?? 0;
    if (count === 0) continue;

    // Every pawn past the first on a file is in the way of the one behind it.
    if (count > 1) score -= DOUBLED_PAWN_PENALTY * (count - 1);

    const left = file > 0 ? (mine[file - 1] ?? 0) : 0;
    const right = file < 7 ? (mine[file + 1] ?? 0) : 0;
    if (left === 0 && right === 0) score -= ISOLATED_PAWN_PENALTY * count;
  }

  // A passed pawn has no enemy pawn ahead of it on its own file or either neighbour,
  // so nothing can stop it but a piece. Worth more the closer it is to promoting.
  for (const square of material.pawns[color]) {
    const file = fileOf(square);
    const advanced = color === "w" ? 6 - rowOf(square) : rowOf(square) - 1;

    let blocked = false;
    for (const other of material.pawns[oppositeColor(color)]) {
      if (Math.abs(fileOf(other) - file) > 1) continue;
      const ahead = color === "w" ? rowOf(other) < rowOf(square) : rowOf(other) > rowOf(square);
      if (ahead) {
        blocked = true;
        break;
      }
    }
    if (!blocked && theirs[file] === 0) {
      score += PASSED_PAWN_BONUS[Math.max(0, Math.min(7, advanced))] ?? 0;
    }
  }
  return score;
}

/** A rook is worth more on a file no pawn blocks. */
function rookFileBonus(material: Material, color: ChessColor, file: number): number {
  const mine = material.pawnsByFile[color][file] ?? 0;
  const theirs = material.pawnsByFile[oppositeColor(color)][file] ?? 0;

  if (mine === 0 && theirs === 0) return ROOK_OPEN_FILE_BONUS;
  if (mine === 0) return ROOK_HALF_OPEN_FILE_BONUS;
  return 0;
}

/**
 * What a king's exposure costs it, in the middlegame only.
 *
 * Counts the three pawns that should be standing in front of it and the file it stands
 * on. Crude, but it is the term that stops the engine wandering its king up the board
 * in a position full of pieces — which a piece-square table alone only discourages.
 */
function kingDanger(material: Material, color: ChessColor, square: number): number {
  const file = fileOf(square);
  const row = rowOf(square);
  let danger = 0;

  // The rank the shield should be on: one step toward the enemy.
  const shieldRow = color === "w" ? row - 1 : row + 1;

  for (const neighbour of [file - 1, file, file + 1]) {
    if (neighbour < 0 || neighbour > 7) continue;
    const shield = squareOf(shieldRow, neighbour);
    const hasPawn =
      shield >= 0 && material.pawns[color].some((pawn) => pawn === shield);
    if (!hasPawn) danger += KING_SHIELD_PENALTY;
  }

  if ((material.pawnsByFile[color][file] ?? 0) === 0) danger += KING_OPEN_FILE_PENALTY;
  return danger;
}

/**
 * The endgame mating technique: drive the lone king to the edge and bring your own up.
 *
 * Without this, king and queen against a bare king is a draw by the fifty-move rule —
 * the search sees every check as equally good, shuffles, and never makes progress.
 * Rewarding a cornered enemy king and a close friendly one is enough to convert K+Q and
 * K+R, which is the overwhelming majority of endgames this engine reaches.
 *
 * Applied only by the side with enough material to mate, and only when the other side
 * has nothing but a king — otherwise it would push the engine toward the enemy king in
 * positions where that is simply bad.
 */
function matingDrive(material: Material, color: ChessColor): number {
  const enemy = oppositeColor(color);
  const theirKing = material.kings[enemy];
  const myKing = material.kings[color];
  if (theirKing < 0 || myKing < 0) return 0;

  // Only when they are down to a bare king and we can actually mate.
  const theyHaveNothing = material.nonPawn[enemy] === 0 && material.pawns[enemy].length === 0;
  const weCanMate = material.nonPawn[color] >= MATING_MATERIAL;
  if (!theyHaveNothing || !weCanMate) return 0;

  // Distance of the bare king from the middle: 0 in the centre, 6 in a corner.
  const theirRow = rowOf(theirKing);
  const theirFile = fileOf(theirKing);
  const fromCentre =
    Math.max(Math.abs(theirRow * 2 - 7), Math.abs(theirFile * 2 - 7));

  // And how close our own king has come to help, which is what actually forces mate.
  const between =
    Math.abs(theirRow - rowOf(myKing)) + Math.abs(theirFile - fileOf(myKing));

  return fromCentre * MATING_DRIVE_WEIGHT + (14 - between) * MATING_PROXIMITY_WEIGHT;
}

/** Whether both sides are down to the material the endgame rules are tuned for. */
export function isChessEndgame(position: ChessPosition): boolean {
  return isEndgamePhase(survey(position));
}

/**
 * Whether the side to move has any piece beyond pawns and a king.
 *
 * Null-move pruning asks this: in a position where a side has only pawns left, passing
 * is often genuinely better than any move it has (zugzwang), and the pruning's core
 * assumption — that doing nothing is worse than something — stops holding.
 */
export function hasNonPawnMaterial(position: ChessPosition, color: ChessColor): boolean {
  for (const piece of position.board) {
    if (piece && piece.color === color && piece.type !== "p" && piece.type !== "k") return true;
  }
  return false;
}

