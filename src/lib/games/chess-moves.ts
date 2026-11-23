import {
  fileOf,
  isOnBoard,
  kingSquare,
  oppositeColor,
  rowOf,
  squareAt,
} from "./chess-board";
import {
  CHESS_BOARD_SIZE,
  CHESS_PROMOTION_TYPES,
  CHESS_SQUARE_COUNT,
  type ChessCastling,
  type ChessColor,
  type ChessMove,
  type ChessPiece,
  type ChessPosition,
  type ChessSquare,
} from "./types";

/**
 * Move generation and move application — the rules of how pieces move.
 *
 * Whether a *game* is over is `game-chess.ts`; this file only answers "what may be
 * played from here" and "what does the board look like afterwards".
 *
 * Correctness here is load-bearing for everything else, which is why it is tested with
 * perft rather than with hand-picked cases: a bug in castling-through-check or in the
 * en-passant pin shows up as a wrong count at depth 3 and is invisible to any test
 * somebody thought to write.
 */

/** Offsets as [rowStep, fileStep]. */
type Step = readonly [number, number];

const KNIGHT_STEPS: readonly Step[] = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
];

const KING_STEPS: readonly Step[] = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

const ROOK_STEPS: readonly Step[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

const BISHOP_STEPS: readonly Step[] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

const QUEEN_STEPS: readonly Step[] = [...ROOK_STEPS, ...BISHOP_STEPS];

/**
 * Which way a pawn of each colour travels, and the rows that matter to it.
 *
 * White moves toward row 0 because row 0 is rank 8 — see `ChessSquare` in `types.ts`.
 */
const PAWN_SETUP: Record<
  ChessColor,
  { forward: number; startRow: number; promotionRow: number }
> = {
  w: { forward: -1, startRow: 6, promotionRow: 0 },
  b: { forward: 1, startRow: 1, promotionRow: 7 },
};

/** The squares castling moves between, per colour and wing. */
const CASTLE_SETUP: Record<
  ChessColor,
  Record<
    "k" | "q",
    {
      king: ChessSquare;
      kingTo: ChessSquare;
      rook: ChessSquare;
      rookTo: ChessSquare;
      /** Must all be empty. */
      empty: readonly ChessSquare[];
      /** Must none be attacked — the king's path, including where it starts. */
      safe: readonly ChessSquare[];
      right: keyof ChessCastling;
    }
  >
> = {
  w: {
    k: {
      king: 60,
      kingTo: 62,
      rook: 63,
      rookTo: 61,
      empty: [61, 62],
      safe: [60, 61, 62],
      right: "wk",
    },
    q: {
      king: 60,
      kingTo: 58,
      rook: 56,
      rookTo: 59,
      // b1 must be empty but is never walked through by the king, so it is not in
      // `safe` — a rook on b1 attacked by anything does not stop queen-side castling.
      empty: [57, 58, 59],
      safe: [60, 59, 58],
      right: "wq",
    },
  },
  b: {
    k: { king: 4, kingTo: 6, rook: 7, rookTo: 5, empty: [5, 6], safe: [4, 5, 6], right: "bk" },
    q: {
      king: 4,
      kingTo: 2,
      rook: 0,
      rookTo: 3,
      empty: [1, 2, 3],
      safe: [4, 3, 2],
      right: "bq",
    },
  },
};

/**
 * Castling rights that a move touching a square must clear.
 *
 * Keyed by square rather than by piece, which is what makes it cover both halves of the
 * rule at once: a rook *moving off* a1 and a rook *captured on* a1 both end White's
 * queen-side right, and both are "a move touched a1". Handling only the first is the
 * classic bug — a position where the rook has been taken still offers the castle.
 */
const RIGHTS_LOST_BY_SQUARE: ReadonlyMap<ChessSquare, readonly (keyof ChessCastling)[]> =
  new Map([
    [60, ["wk", "wq"]],
    [63, ["wk"]],
    [56, ["wq"]],
    [4, ["bk", "bq"]],
    [7, ["bk"]],
    [0, ["bq"]],
  ]);

/**
 * Whether `color` attacks `square`, reading a bare board.
 *
 * Takes the board rather than a position because it is asked about hypothetical boards
 * during legality filtering, where the rest of the position no longer matches.
 *
 * **En passant is deliberately not considered.** This question is only ever asked about
 * a king's square, and a king can never be captured en passant.
 */
export function isSquareAttacked(
  board: readonly (ChessPiece | null)[],
  square: ChessSquare,
  color: ChessColor,
): boolean {
  if (!isOnBoard(square)) return false;
  const row = rowOf(square);
  const file = fileOf(square);

  // Pawns. A white pawn attacks *upward*, so one that attacks this square sits one row
  // below it — the opposite of its own direction of travel.
  const pawnRow = row - PAWN_SETUP[color].forward;
  for (const fileStep of [-1, 1]) {
    const from = squareAt(pawnRow, file + fileStep);
    if (from < 0) continue;
    const piece = board[from];
    if (piece && piece.color === color && piece.type === "p") return true;
  }

  for (const [rowStep, fileStep] of KNIGHT_STEPS) {
    const from = squareAt(row + rowStep, file + fileStep);
    if (from < 0) continue;
    const piece = board[from];
    if (piece && piece.color === color && piece.type === "n") return true;
  }

  for (const [rowStep, fileStep] of KING_STEPS) {
    const from = squareAt(row + rowStep, file + fileStep);
    if (from < 0) continue;
    const piece = board[from];
    if (piece && piece.color === color && piece.type === "k") return true;
  }

  // Sliders: walk each ray out until something blocks it. The first piece met decides,
  // whichever ray it is on.
  for (const [rowStep, fileStep] of QUEEN_STEPS) {
    const straight = rowStep === 0 || fileStep === 0;
    for (let distance = 1; distance < CHESS_BOARD_SIZE; distance += 1) {
      const from = squareAt(row + rowStep * distance, file + fileStep * distance);
      if (from < 0) break;
      const piece = board[from];
      if (!piece) continue;
      if (piece.color === color) {
        if (piece.type === "q") return true;
        if (straight && piece.type === "r") return true;
        if (!straight && piece.type === "b") return true;
      }
      break;
    }
  }

  return false;
}

/** Whether the side to move is in check. */
export function isInCheck(position: ChessPosition): boolean {
  return isKingAttacked(position, position.turn);
}

/** Whether `color`'s king stands on an attacked square. A side with no king is not. */
export function isKingAttacked(position: ChessPosition, color: ChessColor): boolean {
  const king = kingSquare(position, color);
  if (king < 0) return false;
  return isSquareAttacked(position.board, king, oppositeColor(color));
}

/**
 * Every move the side to move may legally play.
 *
 * Generated pseudo-legally and then filtered by making each move on a copy of the board
 * and asking whether the king is left attacked. That filter is what handles pins, moving
 * into check, and the en-passant capture that exposes a rank — none of which is checked
 * anywhere else, because trying to enumerate them is exactly how move generators get
 * subtly wrong.
 */
export function generateLegalMoves(position: ChessPosition): ChessMove[] {
  return generatePseudoLegalMoves(position).filter((move) => !leavesKingInCheck(position, move));
}

/**
 * Only the legal moves that capture or promote — what quiescence search extends on.
 *
 * Filtered from the full list rather than generated separately: a second generator that
 * only emitted captures would be a second place for the rules to be wrong, and the
 * search's correctness would then depend on the two agreeing.
 */
export function generateLegalCaptures(position: ChessPosition): ChessMove[] {
  return generateLegalMoves(position).filter((move) => move.captured || move.promotion);
}

/**
 * Every move ignoring whether it leaves the king in check. Castling is the exception:
 * its own "may not castle through check" rule is applied here, because it is about
 * squares the king never lands on and so no after-the-fact filter would see it.
 */
export function generatePseudoLegalMoves(position: ChessPosition): ChessMove[] {
  const moves: ChessMove[] = [];
  const { board, turn } = position;

  for (let from = 0; from < CHESS_SQUARE_COUNT; from += 1) {
    const piece = board[from];
    if (!piece || piece.color !== turn) continue;

    switch (piece.type) {
      case "p":
        addPawnMoves(position, from, moves);
        break;
      case "n":
        addStepMoves(position, from, "n", KNIGHT_STEPS, moves);
        break;
      case "k":
        addStepMoves(position, from, "k", KING_STEPS, moves);
        break;
      case "b":
        addSlidingMoves(position, from, "b", BISHOP_STEPS, moves);
        break;
      case "r":
        addSlidingMoves(position, from, "r", ROOK_STEPS, moves);
        break;
      case "q":
        addSlidingMoves(position, from, "q", QUEEN_STEPS, moves);
        break;
    }
  }

  addCastlingMoves(position, moves);
  return moves;
}

function addStepMoves(
  position: ChessPosition,
  from: ChessSquare,
  type: "n" | "k",
  steps: readonly Step[],
  moves: ChessMove[],
): void {
  const row = rowOf(from);
  const file = fileOf(from);
  for (const [rowStep, fileStep] of steps) {
    const to = squareAt(row + rowStep, file + fileStep);
    if (to < 0) continue;
    const target = position.board[to];
    if (target && target.color === position.turn) continue;
    moves.push({ from, to, piece: type, ...(target ? { captured: target.type } : {}) });
  }
}

function addSlidingMoves(
  position: ChessPosition,
  from: ChessSquare,
  type: "b" | "r" | "q",
  steps: readonly Step[],
  moves: ChessMove[],
): void {
  const row = rowOf(from);
  const file = fileOf(from);
  for (const [rowStep, fileStep] of steps) {
    for (let distance = 1; distance < CHESS_BOARD_SIZE; distance += 1) {
      const to = squareAt(row + rowStep * distance, file + fileStep * distance);
      if (to < 0) break;
      const target = position.board[to];
      if (!target) {
        moves.push({ from, to, piece: type });
        continue;
      }
      if (target.color !== position.turn) {
        moves.push({ from, to, piece: type, captured: target.type });
      }
      break;
    }
  }
}

function addPawnMoves(position: ChessPosition, from: ChessSquare, moves: ChessMove[]): void {
  const { forward, startRow, promotionRow } = PAWN_SETUP[position.turn];
  const row = rowOf(from);
  const file = fileOf(from);

  const oneStep = squareAt(row + forward, file);
  if (oneStep >= 0 && !position.board[oneStep]) {
    pushPawnMove(from, oneStep, promotionRow, undefined, moves);

    // The double step is only available from the home row, and only when *both*
    // squares are clear — which is why it is nested inside the one-step check rather
    // than tested on its own.
    if (row === startRow) {
      const twoStep = squareAt(row + forward * 2, file);
      if (twoStep >= 0 && !position.board[twoStep]) {
        moves.push({ from, to: twoStep, piece: "p" });
      }
    }
  }

  for (const fileStep of [-1, 1]) {
    const to = squareAt(row + forward, file + fileStep);
    if (to < 0) continue;

    const target = position.board[to];
    if (target && target.color !== position.turn) {
      pushPawnMove(from, to, promotionRow, target.type, moves);
      continue;
    }

    // En passant. The captured pawn is beside the mover, not on the square it moves to,
    // which is why `captured` is set here with `isEnPassant` rather than read off the
    // board like every other capture.
    if (!target && position.enPassant !== null && to === position.enPassant) {
      moves.push({ from, to, piece: "p", captured: "p", isEnPassant: true });
    }
  }
}

/** One pawn move, expanded into four when it lands on the far rank. */
function pushPawnMove(
  from: ChessSquare,
  to: ChessSquare,
  promotionRow: number,
  captured: ChessMove["captured"],
  moves: ChessMove[],
): void {
  const capture = captured ? { captured } : {};
  if (rowOf(to) !== promotionRow) {
    moves.push({ from, to, piece: "p", ...capture });
    return;
  }
  for (const promotion of CHESS_PROMOTION_TYPES) {
    moves.push({ from, to, piece: "p", promotion, ...capture });
  }
}

function addCastlingMoves(position: ChessPosition, moves: ChessMove[]): void {
  const { turn, board, castling } = position;
  const enemy = oppositeColor(turn);

  for (const wing of ["k", "q"] as const) {
    const setup = CASTLE_SETUP[turn][wing];
    if (!castling[setup.right]) continue;

    // The rights can legitimately outlive the pieces in a hand-written FEN, so the
    // pieces are checked rather than assumed.
    const king = board[setup.king];
    const rook = board[setup.rook];
    if (!king || king.type !== "k" || king.color !== turn) continue;
    if (!rook || rook.type !== "r" || rook.color !== turn) continue;

    if (setup.empty.some((square) => board[square])) continue;
    if (setup.safe.some((square) => isSquareAttacked(board, square, enemy))) continue;

    moves.push({ from: setup.king, to: setup.kingTo, piece: "k", isCastle: wing });
  }
}

/**
 * Whether playing `move` would leave the mover's own king attacked.
 *
 * Moves the pieces on a copied board rather than calling `applyChessMove`, because the
 * rest of the position (clocks, rights, en-passant) cannot affect whether a king is
 * attacked and rebuilding it for every candidate move doubles the cost of generation.
 */
function leavesKingInCheck(position: ChessPosition, move: ChessMove): boolean {
  const board = position.board.slice();
  const mover = board[move.from];
  if (!mover) return false;

  board[move.from] = null;
  board[move.to] = move.promotion ? { type: move.promotion, color: mover.color } : mover;

  if (move.isEnPassant) {
    // The pawn taken sits on the mover's own row, beside it — not on the target square.
    board[squareAt(rowOf(move.from), fileOf(move.to))] = null;
  }

  if (move.isCastle) {
    const setup = CASTLE_SETUP[mover.color][move.isCastle];
    board[setup.rookTo] = board[setup.rook];
    board[setup.rook] = null;
  }

  const king =
    mover.type === "k"
      ? move.to
      : board.findIndex((piece) => piece?.type === "k" && piece.color === mover.color);

  if (king < 0) return false;
  return isSquareAttacked(board, king, oppositeColor(mover.color));
}

/**
 * The position after a move. Never mutates its input — see `ChessPosition` for why the
 * engine is built this way.
 *
 * Assumes the move came from the generator for this position. A move built by hand is
 * applied as written, which is why every boundary resolves text against the legal list
 * instead of constructing a move.
 */
export function applyChessMove(position: ChessPosition, move: ChessMove): ChessPosition {
  const board = position.board.slice();
  const mover = board[move.from];
  if (!mover) return position;

  board[move.from] = null;
  board[move.to] = move.promotion ? { type: move.promotion, color: mover.color } : mover;

  if (move.isEnPassant) {
    board[squareAt(rowOf(move.from), fileOf(move.to))] = null;
  }

  if (move.isCastle) {
    const setup = CASTLE_SETUP[mover.color][move.isCastle];
    board[setup.rookTo] = board[setup.rook];
    board[setup.rook] = null;
  }

  const castling: ChessCastling = { ...position.castling };
  for (const square of [move.from, move.to]) {
    for (const right of RIGHTS_LOST_BY_SQUARE.get(square) ?? []) castling[right] = false;
  }

  // The en-passant square is set only by a double step, and cleared by every other move
  // — a stale one would offer a capture that is a full move out of date.
  let enPassant: ChessSquare | null = null;
  if (mover.type === "p" && Math.abs(rowOf(move.to) - rowOf(move.from)) === 2) {
    enPassant = squareAt((rowOf(move.from) + rowOf(move.to)) / 2, fileOf(move.from));
  }

  return {
    board,
    turn: oppositeColor(position.turn),
    castling,
    enPassant,
    // A capture or a pawn move resets the fifty-move counter; everything else advances it.
    halfmoveClock: move.captured || mover.type === "p" ? 0 : position.halfmoveClock + 1,
    fullmoveNumber:
      position.turn === "b" ? position.fullmoveNumber + 1 : position.fullmoveNumber,
  };
}

/**
 * How many positions are reachable in exactly `depth` plies — the standard **perft**
 * count, and the engine's own correctness test.
 *
 * Lives beside the generator rather than in the test file because it is the natural
 * expression of "walk every legal move" and is useful from the CLI when a rule change
 * has to be re-proved.
 */
export function perft(position: ChessPosition, depth: number): number {
  if (depth <= 0) return 1;
  const moves = generateLegalMoves(position);
  // At the last ply the move count *is* the answer, which skips a whole level of
  // position-building. Worth it: that level is the overwhelming majority of the nodes.
  if (depth === 1) return moves.length;

  let total = 0;
  for (const move of moves) {
    total += perft(applyChessMove(position, move), depth - 1);
  }
  return total;
}
