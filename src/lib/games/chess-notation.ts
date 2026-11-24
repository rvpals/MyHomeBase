import { CHESS_START_FEN, fileOf, rowOf, squareFromName, squareName } from "./chess-board";
import { chessTimeControlTag } from "./chess-clock";
import { applyChessMove, generateLegalMoves, isInCheck } from "./chess-moves";
import {
  CHESS_PROMOTION_TYPES,
  type ChessGame,
  type ChessMove,
  type ChessPosition,
  type ChessPromotionType,
} from "./types";

/**
 * How a move is written: coordinates for storage, SAN for people, PGN for export.
 *
 * The two forms exist for different jobs and neither replaces the other — see
 * `ChessRecordedMove` in `types.ts`.
 */

/** A move in coordinate form: `e2e4`, or `e7e8q` for a promotion. */
export function moveToUci(move: ChessMove): string {
  return `${squareName(move.from)}${squareName(move.to)}${move.promotion ?? ""}`;
}

/**
 * The legal move that `uci` names, or undefined when none does.
 *
 * Resolved **against the legal move list** rather than parsed into a move. That is the
 * whole safety property of this function: a save or a request can only ever name a move
 * the rules already offered, so no amount of editing a stored game can produce a move
 * that moves a rook like a queen or castles out of check.
 */
export function findMoveByUci(position: ChessPosition, uci: string): ChessMove | undefined {
  const text = uci.trim().toLowerCase();
  if (text.length < 4 || text.length > 5) return undefined;

  const from = squareFromName(text.slice(0, 2));
  const to = squareFromName(text.slice(2, 4));
  if (from < 0 || to < 0) return undefined;

  const promotion = text.length === 5 ? (text[4] as ChessPromotionType) : undefined;
  if (promotion && !CHESS_PROMOTION_TYPES.includes(promotion)) return undefined;

  return generateLegalMoves(position).find(
    (move) => move.from === from && move.to === to && move.promotion === promotion,
  );
}

/**
 * A move in standard algebraic notation, as played from `position`.
 *
 * Must be called **before** the move is applied: SAN depends on what else could have
 * gone to the same square, which only the position before the move knows. The check and
 * mate marks are then read from the position after it.
 */
export function moveToSan(position: ChessPosition, move: ChessMove): string {
  const after = applyChessMove(position, move);
  const suffix = checkSuffix(after);

  if (move.isCastle) return `${move.isCastle === "k" ? "O-O" : "O-O-O"}${suffix}`;

  const target = squareName(move.to);
  const promotion = move.promotion ? `=${move.promotion.toUpperCase()}` : "";

  if (move.piece === "p") {
    // A pawn capture names its starting file and nothing else — `exd5`, never `e4xd5`.
    const capture = move.captured ? `${squareName(move.from)[0]}x` : "";
    return `${capture}${target}${promotion}${suffix}`;
  }

  const capture = move.captured ? "x" : "";
  return `${move.piece.toUpperCase()}${disambiguate(position, move)}${capture}${target}${suffix}`;
}

/**
 * The file, rank or whole square a piece move needs to be unambiguous — usually
 * nothing.
 *
 * The rule, in the order SAN requires: if no other piece of the same kind can reach the
 * square, write nothing; if the candidates differ by file, write the file; if they
 * differ by rank, write the rank; otherwise write both. Preferring the file matters —
 * `Nbd2` is the conventional form where `N1d2` would be read as unusual even when it is
 * equally unambiguous.
 */
function disambiguate(position: ChessPosition, move: ChessMove): string {
  const rivals = generateLegalMoves(position).filter(
    (other) =>
      other.piece === move.piece &&
      other.to === move.to &&
      other.from !== move.from &&
      // Promotions to different pieces share from and to, and are told apart by the
      // `=Q` rather than by a file letter.
      other.promotion === move.promotion,
  );

  if (rivals.length === 0) return "";

  const from = squareName(move.from);
  if (!rivals.some((other) => fileOf(other.from) === fileOf(move.from))) return from[0]!;
  if (!rivals.some((other) => rowOf(other.from) === rowOf(move.from))) return from[1]!;
  return from;
}

/** `#` for mate, `+` for check, nothing otherwise — read from the position after. */
function checkSuffix(after: ChessPosition): string {
  if (!isInCheck(after)) return "";
  return generateLegalMoves(after).length === 0 ? "#" : "+";
}

/**
 * The game as PGN — the interchange format every other chess program reads.
 *
 * Exists so a game played here is not trapped here: it can be pasted into an analysis
 * board or a database. It is **export only**; importing PGN would mean parsing SAN,
 * which is a parser's worth of work for a direction nobody asked for.
 *
 * `date` is passed in rather than read from a clock, so the library keeps no hidden I/O
 * and a test gets a stable string.
 */
export function gameToPgn(
  game: ChessGame,
  options: { event?: string; white?: string; black?: string; date?: string } = {},
): string {
  const {
    event = "MyHomeBase",
    white = game.humanColor === "w" ? "Player" : "Computer",
    black = game.humanColor === "b" ? "Player" : "Computer",
    date = "????.??.??",
  } = options;

  const headers = [
    `[Event "${pgnValue(event)}"]`,
    '[Site "MyHomeBase"]',
    `[Date "${pgnValue(date)}"]`,
    '[Round "-"]',
    `[White "${pgnValue(white)}"]`,
    `[Black "${pgnValue(black)}"]`,
    `[Result "${pgnResult(game)}"]`,
    // PGN writes a control as seconds+increment, and "-" for an untimed game. Always
    // emitted, because its absence and "-" mean different things to a reader: one is
    // "nobody said", the other is "there was no clock".
    `[TimeControl "${chessTimeControlTag(game.clock)}"]`,
  ];

  // Only when the game ended in a way the moves alone do not explain. A reader shown
  // "time forfeit" knows why a won position was lost.
  if (game.status === "timeout") headers.push('[Termination "time forfeit"]');

  // A game that did not start from the standard position needs both tags, and readers
  // that see SetUp without FEN fall back to the opening position and replay nonsense.
  if (game.initialFen !== CHESS_START_FEN) {
    headers.push('[SetUp "1"]', `[FEN "${pgnValue(game.initialFen)}"]`);
  }

  const movetext: string[] = [];
  // Which colour moves first comes from the starting position, so a game set up from a
  // FEN with Black to move is numbered correctly rather than from move 1 as White.
  let moveNumber = startingFullmove(game);
  let whiteToMove = startingTurnIsWhite(game);

  for (const recorded of game.moves) {
    if (whiteToMove) {
      movetext.push(`${moveNumber}.`);
    } else if (movetext.length === 0) {
      // Black moving first in the export needs the ellipsis, or the first move reads
      // as White's.
      movetext.push(`${moveNumber}...`);
    }
    movetext.push(recorded.san);
    if (!whiteToMove) moveNumber += 1;
    whiteToMove = !whiteToMove;
  }

  movetext.push(pgnResult(game));
  return `${headers.join("\n")}\n\n${wrapMovetext(movetext)}\n`;
}

/** The PGN result token for a game's status. */
export function pgnResult(game: ChessGame): string {
  if (game.status === "playing" || game.status === "check") return "*";
  if (!game.winner) return "1/2-1/2";
  return game.winner === "w" ? "1-0" : "0-1";
}

function startingFullmove(game: ChessGame): number {
  const field = game.initialFen.trim().split(/\s+/)[5];
  const parsed = Number(field);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function startingTurnIsWhite(game: ChessGame): boolean {
  return game.initialFen.trim().split(/\s+/)[1] !== "b";
}

/** A quote or backslash in a PGN tag value would end the tag early. */
function pgnValue(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** PGN wraps its movetext at 80 columns, and plenty of readers rely on it. */
function wrapMovetext(tokens: readonly string[]): string {
  const lines: string[] = [];
  let line = "";
  for (const token of tokens) {
    if (line === "") {
      line = token;
    } else if (line.length + 1 + token.length <= 80) {
      line += ` ${token}`;
    } else {
      lines.push(line);
      line = token;
    }
  }
  if (line !== "") lines.push(line);
  return lines.join("\n");
}
