import { CHESS_START_FEN, parseFen, toFen } from "./chess-board";
import { generateLegalMoves } from "./chess-moves";
import { moveToSan, moveToUci } from "./chess-notation";
import { isChessGameOver, playChessMove, startChessGame } from "./game-chess";
import type { ChessColor, ChessGame, ChessLevel, ChessPuzzle } from "./types";

/**
 * Bringing a game in from outside: a FEN position, or a PGN game.
 *
 * The counterpart to `gameToPgn`, and deliberately a separate file — exporting is a
 * handful of lines over a game that is already in hand, where importing is parsing
 * somebody else's text and has to refuse most of what it is given.
 *
 * **SAN is resolved, not parsed.** Rather than writing a grammar for algebraic
 * notation — with its disambiguation, its castling spellings, its check marks and its
 * promotion suffixes — each token is matched against the SAN the engine itself would
 * write for every legal move in that position. That reuses `moveToSan`, which is
 * already tested, and it makes a whole class of parser bug impossible: a token either
 * names a legal move or it does not.
 */

export type ChessImportResult =
  | { ok: true; game: ChessGame; headers: Record<string, string> }
  | { ok: false; reason: string };

/** How a game being imported should be set up, beyond the moves themselves. */
export interface ChessImportOptions {
  humanColor?: ChessColor;
  level?: ChessLevel;
}

/**
 * A position from a FEN.
 *
 * The position is re-serialised before use, so a FEN written with the counters left off
 * comes back complete and a saved game always stores a full one.
 */
export function importChessFen(text: string, options: ChessImportOptions = {}): ChessImportResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "Paste a position first." };

  const position = parseFen(trimmed);
  if (!position) {
    return {
      ok: false,
      reason: "That is not a position this game can read. A FEN looks like “rnbq…/8/8 w KQkq - 0 1”.",
    };
  }

  // A side with no king is a diagram, not a game: nothing could be checkmated and the
  // rules would have nothing to enforce.
  const kings = position.board.filter((piece) => piece?.type === "k").length;
  if (kings < 2) return { ok: false, reason: "That position is missing a king." };

  if (generateLegalMoves(position).length === 0) {
    return { ok: false, reason: "There are no legal moves in that position." };
  }

  return {
    ok: true,
    headers: {},
    game: startChessGame({
      // Playing the side to move is what somebody pasting a position almost always
      // wants — it is nearly always their turn in the puzzle they are looking at.
      humanColor: options.humanColor ?? position.turn,
      level: options.level ?? "intermediate",
      fen: toFen(position),
    }),
  };
}

/**
 * A game from PGN.
 *
 * Takes the headers it understands (`FEN` for a game that did not start from the
 * opening) and replays the movetext. Anything it cannot make sense of stops the import
 * with the move that failed named, rather than silently producing a shorter game than
 * the file describes.
 */
export function importChessPgn(text: string, options: ChessImportOptions = {}): ChessImportResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "Paste a game first." };

  const headers = readHeaders(trimmed);
  const start = headers.FEN ?? CHESS_START_FEN;

  const position = parseFen(start);
  if (!position) return { ok: false, reason: "That game's FEN header could not be read." };

  let game: ChessGame;
  try {
    game = startChessGame({
      humanColor: options.humanColor ?? position.turn,
      level: options.level ?? "intermediate",
      fen: toFen(position),
    });
  } catch {
    return { ok: false, reason: "That game's starting position is not valid." };
  }

  const tokens = readMovetext(trimmed);
  if (tokens.length === 0) {
    return { ok: false, reason: "No moves were found in that game." };
  }

  for (const [index, token] of tokens.entries()) {
    if (isChessGameOver(game)) {
      return { ok: false, reason: `The game ends before move ${index + 1} (${token}).` };
    }

    const uci = resolveSan(game, token);
    if (!uci) {
      return { ok: false, reason: `Move ${index + 1} (${token}) is not legal in this game.` };
    }

    const played = playChessMove(game, uci);
    if (!played.ok) {
      return { ok: false, reason: `Move ${index + 1} (${token}) could not be played.` };
    }
    game = played.game;
  }

  return { ok: true, game, headers };
}

/** Whether the text looks more like a PGN than a bare FEN. */
export function looksLikeChessPgn(text: string): boolean {
  const trimmed = text.trim();
  // A tag pair, or a numbered move: either is something a FEN never contains.
  return /^\s*\[/.test(trimmed) || /\b\d+\s*\.\s*\S/.test(trimmed);
}

/** The `[Key "Value"]` pairs at the top of a PGN. */
function readHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const pattern = /\[\s*(\w+)\s*"((?:[^"\\]|\\.)*)"\s*\]/g;

  for (const match of text.matchAll(pattern)) {
    headers[match[1]!] = (match[2] ?? "").replace(/\\(.)/g, "$1");
  }
  return headers;
}

/**
 * The move tokens, with everything that is not a move stripped out.
 *
 * PGN carries a lot that is not moves: comments in braces, variations in parentheses,
 * numeric annotation glyphs, move numbers, and a result at the end. Variations are
 * dropped wholesale rather than imported — a variation is a line somebody considered,
 * not a move that was played, and there is nowhere in a single game to put one.
 */
function readMovetext(text: string): string[] {
  let body = text.replace(/\[[^\]]*\]/g, " ");

  body = body.replace(/\{[^}]*\}/g, " ").replace(/;[^\n]*/g, " ");

  // Variations nest, so they come off one layer at a time rather than with one pattern.
  let previous: string;
  do {
    previous = body;
    body = body.replace(/\([^()]*\)/g, " ");
  } while (body !== previous);

  return body
    .replace(/\$\d+/g, " ")
    .replace(/\d+\s*\.(\.\.)?/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token !== "" && !RESULTS.has(token));
}

const RESULTS = new Set(["1-0", "0-1", "1/2-1/2", "*"]);

/**
 * The coordinate form of the legal move this SAN token names, or undefined.
 *
 * Matched against what the engine would write, with the check and mate marks taken off
 * both sides: plenty of real PGN omits them, and a game should not fail to import
 * because somebody's exporter left the `+` off.
 */
function resolveSan(game: ChessGame, token: string): string | undefined {
  const wanted = normaliseSan(token);

  for (const move of generateLegalMoves(game.position)) {
    if (normaliseSan(moveToSan(game.position, move)) === wanted) return moveToUci(move);
  }
  return undefined;
}

/** Strips the decoration that two writers of the same move may disagree about. */
function normaliseSan(san: string): string {
  return san
    .replace(/[+#]/g, "")
    .replace(/[!?]+$/, "")
    // `0-0` and `O-O` are both written for castling, and the digit form is common in
    // older files and in anything typed by hand.
    .replace(/0/g, "O")
    .replace(/e\.p\.?/i, "")
    .trim();
}

/**
 * A few positions worth setting up, for practice rather than for play.
 *
 * In code rather than in a table, for the reason `GAME_CATALOGUE` is: a puzzle is only
 * usable if the rules can read its position, so a row could name one this build cannot
 * load. The ids are not stored anywhere, so unlike a game key they are free to change.
 */
export const CHESS_PUZZLES: readonly ChessPuzzle[] = [
  {
    id: "back-rank",
    name: "Back-rank mate",
    goal: "White to play and mate in one. The black king has no way out along its own rank.",
    fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1",
  },
  {
    id: "queen-endgame",
    name: "Queen against a bare king",
    goal: "White to play. Drive the king to the edge and mate it — the ending every game can reach.",
    fen: "8/8/8/4k3/8/8/4K3/4Q3 w - - 0 1",
  },
  {
    id: "rook-endgame",
    name: "Rook against a bare king",
    goal: "White to play. Harder than the queen: the king has to do most of the work.",
    fen: "8/8/8/4k3/8/8/4K3/4R3 w - - 0 1",
  },
  {
    id: "promotion-race",
    name: "A pawn race",
    goal: "White to play. Both sides are running for the last rank — count the moves before you push.",
    fen: "8/5p2/8/8/8/8/2P5/k6K w - - 0 1",
  },
];

/** One puzzle by id, or undefined. */
export function findChessPuzzle(id: string): ChessPuzzle | undefined {
  return CHESS_PUZZLES.find((puzzle) => puzzle.id === id);
}
