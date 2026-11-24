import { fileOf } from "./chess-board";
import {
  CHESS_PIECE_TYPES,
  CHESS_SQUARE_COUNT,
  type ChessPieceType,
  type ChessPosition,
} from "./types";

/**
 * A compact key for a position, so the transposition table can recognise one it has
 * already searched.
 *
 * **Zobrist hashing**: every (piece, colour, square) combination gets a fixed random
 * number, and a position's key is all of its own XORed together, plus the side to
 * move, the castling rights and a usable en-passant file. Two positions that are the
 * same get the same key, and two that differ almost never do.
 *
 * The obvious alternative was the FEN string, which is exact and needs no new code.
 * It was rejected because building one allocates a string per node, and the search
 * visits hundreds of thousands — the hash is two numbers and no allocation.
 *
 * **It is 52 bits, not 64.** JavaScript has no cheap 64-bit integer, and `BigInt` in
 * the hot path would cost more than the table saves. Two 26-bit halves are kept as
 * ordinary numbers and combined into one safe integer. The cost is a higher collision
 * rate than a real 64-bit key, which is why the table stores the move it found and the
 * search **re-checks that the move is legal** before trusting it: a collision then
 * costs a wasted entry, never an illegal move.
 */

/** A deterministic generator, so a build always hashes a position the same way. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // xorshift32 — fast, and good enough for keys that only need to differ.
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

/** Each half of a key is kept under 2^26 so the two combine inside a safe integer. */
const HALF_BITS = 26;
const HALF_MASK = (1 << HALF_BITS) - 1;

interface Key {
  low: number;
  high: number;
}

function randomKey(next: () => number): Key {
  return { low: next() & HALF_MASK, high: next() & HALF_MASK };
}

const random = makeRandom(0x9e3779b9);

/** One key per piece type, colour and square. */
const PIECE_KEYS: Record<"w" | "b", Record<ChessPieceType, Key[]>> = {
  w: {} as Record<ChessPieceType, Key[]>,
  b: {} as Record<ChessPieceType, Key[]>,
};

for (const color of ["w", "b"] as const) {
  for (const type of CHESS_PIECE_TYPES) {
    PIECE_KEYS[color][type] = Array.from({ length: CHESS_SQUARE_COUNT }, () =>
      randomKey(random),
    );
  }
}

const TURN_KEY = randomKey(random);
const CASTLING_KEYS = Array.from({ length: 16 }, () => randomKey(random));
/** One per file, because only the file of an en-passant square can matter. */
const EN_PASSANT_KEYS = Array.from({ length: 8 }, () => randomKey(random));

/**
 * The key for a position.
 *
 * The en-passant square is folded in **only when a pawn could actually take it**, for
 * the reason `repetitionKey` drops it: two positions that differ by a square nobody can
 * use are the same position, and treating them as different would halve the table's
 * usefulness in every pawn-heavy middlegame.
 */
export function chessPositionKey(position: ChessPosition): number {
  let low = 0;
  let high = 0;

  for (let square = 0; square < CHESS_SQUARE_COUNT; square += 1) {
    const piece = position.board[square];
    if (!piece) continue;
    const key = PIECE_KEYS[piece.color][piece.type][square]!;
    low ^= key.low;
    high ^= key.high;
  }

  if (position.turn === "b") {
    low ^= TURN_KEY.low;
    high ^= TURN_KEY.high;
  }

  const { castling } = position;
  const rights =
    (castling.wk ? 1 : 0) | (castling.wq ? 2 : 0) | (castling.bk ? 4 : 0) | (castling.bq ? 8 : 0);
  const rightsKey = CASTLING_KEYS[rights]!;
  low ^= rightsKey.low;
  high ^= rightsKey.high;

  if (position.enPassant !== null && canCaptureEnPassant(position)) {
    const epKey = EN_PASSANT_KEYS[fileOf(position.enPassant)]!;
    low ^= epKey.low;
    high ^= epKey.high;
  }

  // Two 26-bit halves into one safe integer: 52 bits, comfortably inside 2^53.
  return high * (HALF_MASK + 1) + low;
}

/** Whether a pawn of the side to move stands ready to capture onto the ep square. */
function canCaptureEnPassant(position: ChessPosition): boolean {
  const target = position.enPassant;
  if (target === null) return false;

  const forward = position.turn === "w" ? -1 : 1;
  const row = Math.floor(target / 8) - forward;
  if (row < 0 || row > 7) return false;

  for (const fileStep of [-1, 1]) {
    const file = fileOf(target) + fileStep;
    if (file < 0 || file > 7) continue;
    const piece = position.board[row * 8 + file];
    if (piece && piece.type === "p" && piece.color === position.turn) return true;
  }
  return false;
}
