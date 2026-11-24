import {
  CHESS_BOARD_SIZE,
  CHESS_PIECE_TYPES,
  CHESS_SQUARE_COUNT,
  type ChessCastling,
  type ChessColor,
  type ChessPiece,
  type ChessPieceType,
  type ChessPosition,
  type ChessSquare,
} from "./types";

/**
 * The board itself: squares, pieces and FEN. No rules live here — what a piece may do
 * is `chess-moves.ts`, and what a game is doing is `game-chess.ts`.
 *
 * Index 0 is a8 and index 63 is h1, so a FEN's ranks read straight into the array.
 */

/** The standard opening position. */
export const CHESS_START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const FILE_LETTERS = "abcdefgh";

/** The file of a square, 0 for the a-file. */
export function fileOf(square: ChessSquare): number {
  return square % CHESS_BOARD_SIZE;
}

/** The row of a square, **0 at the top** (rank 8) through 7 (rank 1). */
export function rowOf(square: ChessSquare): number {
  return Math.floor(square / CHESS_BOARD_SIZE);
}

/** The square at a row and file, or -1 when either is off the board. */
export function squareAt(row: number, file: number): ChessSquare {
  if (row < 0 || row >= CHESS_BOARD_SIZE || file < 0 || file >= CHESS_BOARD_SIZE) return -1;
  return row * CHESS_BOARD_SIZE + file;
}

/** Whether an index names a real square. */
export function isOnBoard(square: ChessSquare): boolean {
  return Number.isInteger(square) && square >= 0 && square < CHESS_SQUARE_COUNT;
}

/** A square's name, `a8` through `h1`. */
export function squareName(square: ChessSquare): string {
  if (!isOnBoard(square)) return "-";
  return `${FILE_LETTERS[fileOf(square)]}${CHESS_BOARD_SIZE - rowOf(square)}`;
}

/** A square from its name, or -1 when the text is not one. */
export function squareFromName(name: string): ChessSquare {
  if (name.length !== 2) return -1;
  const file = FILE_LETTERS.indexOf(name[0]!.toLowerCase());
  const rank = Number(name[1]);
  if (file < 0 || !Number.isInteger(rank) || rank < 1 || rank > CHESS_BOARD_SIZE) return -1;
  return squareAt(CHESS_BOARD_SIZE - rank, file);
}

/** Whether a square is a light one. a8 (index 0) is light. */
export function isLightSquare(square: ChessSquare): boolean {
  return (rowOf(square) + fileOf(square)) % 2 === 0;
}

/** The other colour. */
export function oppositeColor(color: ChessColor): ChessColor {
  return color === "w" ? "b" : "w";
}

/** The piece on a square, or null. Returns null for an index off the board. */
export function pieceAt(position: ChessPosition, square: ChessSquare): ChessPiece | null {
  if (!isOnBoard(square)) return null;
  return position.board[square] ?? null;
}

/**
 * Where one side's king stands, or -1 when that side has none.
 *
 * -1 rather than a throw: a position with no king is illegal in a real game but is
 * perfectly reasonable in a test or a hand-written FEN, and the move generator asks
 * this question on every single node. A crash there would turn a malformed save into a
 * broken screen rather than a refused load.
 */
export function kingSquare(position: ChessPosition, color: ChessColor): ChessSquare {
  for (let square = 0; square < CHESS_SQUARE_COUNT; square += 1) {
    const piece = position.board[square];
    if (piece && piece.type === "k" && piece.color === color) return square;
  }
  return -1;
}

/** An empty 64-square board. */
export function emptyBoard(): (ChessPiece | null)[] {
  return new Array<ChessPiece | null>(CHESS_SQUARE_COUNT).fill(null);
}

/** The opening position. */
export function startPosition(): ChessPosition {
  // Parsed from the FEN rather than built by hand, so there is one definition of the
  // starting board and the FEN parser is exercised by every game that begins.
  const parsed = parseFen(CHESS_START_FEN);
  if (!parsed) throw new Error("The starting FEN is not valid.");
  return parsed;
}

function pieceFromFenChar(char: string): ChessPiece | null {
  const lower = char.toLowerCase() as ChessPieceType;
  if (!CHESS_PIECE_TYPES.includes(lower)) return null;
  return { type: lower, color: char === lower ? "b" : "w" };
}

function fenCharFromPiece(piece: ChessPiece): string {
  return piece.color === "w" ? piece.type.toUpperCase() : piece.type;
}

/**
 * A FEN string into a position, or **undefined** when it is not one.
 *
 * Undefined rather than a throw, because every caller of this is a boundary: a stored
 * save, a pasted string, a test fixture. A malformed FEN is an expected input here, not
 * an exceptional one, and the callers all have something better to do with it than
 * unwind. Only the first four fields are required — the two counters default, since
 * plenty of published positions are written without them.
 */
export function parseFen(fen: string): ChessPosition | undefined {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) return undefined;

  const [placement, turnText, castlingText, enPassantText] = parts as [
    string,
    string,
    string,
    string,
  ];

  const ranks = placement.split("/");
  if (ranks.length !== CHESS_BOARD_SIZE) return undefined;

  const board = emptyBoard();
  for (let row = 0; row < CHESS_BOARD_SIZE; row += 1) {
    let file = 0;
    for (const char of ranks[row]!) {
      if (char >= "1" && char <= "8") {
        file += Number(char);
        continue;
      }
      const piece = pieceFromFenChar(char);
      if (!piece || file >= CHESS_BOARD_SIZE) return undefined;
      board[squareAt(row, file)] = piece;
      file += 1;
    }
    // A rank that does not describe exactly eight squares is malformed, and letting it
    // through would silently shift every later rank.
    if (file !== CHESS_BOARD_SIZE) return undefined;
  }

  if (turnText !== "w" && turnText !== "b") return undefined;

  const castling: ChessCastling = {
    wk: castlingText.includes("K"),
    wq: castlingText.includes("Q"),
    bk: castlingText.includes("k"),
    bq: castlingText.includes("q"),
  };

  const enPassant = enPassantText === "-" ? null : squareFromName(enPassantText);
  if (enPassant !== null && enPassant < 0) return undefined;

  const halfmoveClock = parts.length > 4 ? Number(parts[4]) : 0;
  const fullmoveNumber = parts.length > 5 ? Number(parts[5]) : 1;
  if (!Number.isInteger(halfmoveClock) || halfmoveClock < 0) return undefined;
  if (!Number.isInteger(fullmoveNumber) || fullmoveNumber < 1) return undefined;

  return { board, turn: turnText, castling, enPassant, halfmoveClock, fullmoveNumber };
}

/** A position as a FEN string. Round-trips with `parseFen`. */
export function toFen(position: ChessPosition): string {
  const ranks: string[] = [];
  for (let row = 0; row < CHESS_BOARD_SIZE; row += 1) {
    let rank = "";
    let empty = 0;
    for (let file = 0; file < CHESS_BOARD_SIZE; file += 1) {
      const piece = position.board[squareAt(row, file)];
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty > 0) {
        rank += String(empty);
        empty = 0;
      }
      rank += fenCharFromPiece(piece);
    }
    if (empty > 0) rank += String(empty);
    ranks.push(rank);
  }

  const { castling } = position;
  const rights =
    `${castling.wk ? "K" : ""}${castling.wq ? "Q" : ""}` +
    `${castling.bk ? "k" : ""}${castling.bq ? "q" : ""}`;

  return [
    ranks.join("/"),
    position.turn,
    rights === "" ? "-" : rights,
    position.enPassant === null ? "-" : squareName(position.enPassant),
    position.halfmoveClock,
    position.fullmoveNumber,
  ].join(" ");
}

/**
 * The key threefold repetition counts: the FEN without the two counters.
 *
 * The counters have to go, or no position would ever repeat — the halfmove clock
 * changes on most moves and the full-move number changes on every one. What is left is
 * the definition the rule actually uses: same pieces, same side to move, same castling
 * rights and same en-passant possibility.
 */
export function repetitionKey(position: ChessPosition): string {
  const fields = toFen(position).split(" ").slice(0, 4);

  /*
    The en-passant square counts only when a pawn could actually take it.

    FEN records the square after **any** double pawn step, whether or not a capture is
    available. Keeping it in the key unconditionally means the position right after a
    double step can never match the same position reached later, so a repetition that
    passes through one is silently miscounted — the draw arrives a cycle late, or not at
    all. FIDE's rule is about the moves available, not about what the notation happens
    to record.

    The test is whether an enemy pawn stands beside the pawn that just moved. It is
    deliberately **pseudo-legal**: a capture that would expose its own king is not a
    real option, but ruling that out needs the move generator, which this file must not
    import — `chess-moves.ts` imports this one. The remaining gap is a position where
    the only en-passant capture is pinned, which would be counted as distinct when it is
    not. That is rare enough to accept and is logged here rather than hidden.
  */
  if (position.enPassant !== null && !canAnyPawnCaptureEnPassant(position)) fields[3] = "-";

  return fields.join(" ");
}

/** Whether a pawn of the side to move stands ready to capture onto the ep square. */
function canAnyPawnCaptureEnPassant(position: ChessPosition): boolean {
  const target = position.enPassant;
  if (target === null) return false;

  // The capturing pawn sits on the same rank as the pawn it takes, which is one step
  // *back* from the target square along the mover's direction of travel.
  const forward = position.turn === "w" ? -1 : 1;
  const row = rowOf(target) - forward;

  for (const fileStep of [-1, 1]) {
    const from = squareAt(row, fileOf(target) + fileStep);
    if (from < 0) continue;
    const piece = position.board[from];
    if (piece && piece.type === "p" && piece.color === position.turn) return true;
  }
  return false;
}
