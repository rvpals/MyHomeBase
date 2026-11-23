import {
  CHESS_START_FEN,
  fileOf,
  isLightSquare,
  kingSquare,
  oppositeColor,
  parseFen,
  repetitionKey,
  rowOf,
  toFen,
} from "./chess-board";
import { applyChessMove, generateLegalMoves, isInCheck } from "./chess-moves";
import { findMoveByUci, moveToSan, moveToUci } from "./chess-notation";
import {
  CHESS_FINISHED_STATUSES,
  CHESS_LEVEL_SETUP,
  CHESS_SCORE_BASE,
  CHESS_SCORE_FLOOR_FRACTION,
  CHESS_SQUARE_COUNT,
  type ChessColor,
  type ChessGame,
  type ChessLevel,
  type ChessMove,
  type ChessPieceType,
  type ChessPosition,
  type ChessSquare,
  type ChessStatus,
} from "./types";

/**
 * The game, as opposed to the rules of movement (`chess-moves.ts`).
 *
 * Everything here takes a game and returns a new one — no mutation, no clock, no I/O —
 * so the same functions drive the board, the CLI and the tests.
 */

/** Half-moves without a capture or a pawn move that end the game in a draw. */
export const CHESS_FIFTY_MOVE_PLIES = 100;

/** How many times one position must appear for the repetition draw. */
export const CHESS_REPETITION_LIMIT = 3;

/**
 * A new game.
 *
 * `fen` exists so a position can be set up for a test or a puzzle; it falls back to the
 * standard opening, and an unparseable one is refused rather than quietly replaced —
 * silently starting a different game from the one asked for is worse than an error.
 */
export function startChessGame(input: {
  humanColor: ChessColor;
  level: ChessLevel;
  fen?: string;
}): ChessGame {
  const initialFen = input.fen?.trim() || CHESS_START_FEN;
  const position = parseFen(initialFen);
  if (!position) throw new Error("That is not a position this game can start from.");

  // The starting position counts toward repetition: a game that returns to its opening
  // position twice more has genuinely repeated it three times.
  const repetitionKeys = [repetitionKey(position)];
  const status = resolveStatus(position, repetitionKeys);

  return {
    initialFen: toFen(position),
    position,
    moves: [],
    repetitionKeys,
    status,
    // A hand-written FEN can be a finished position, so the winner is resolved here too
    // rather than only after a move.
    winner: winnerFor(status, position),
    humanColor: input.humanColor,
    level: input.level,
  };
}

/** Whether nobody is to move again. */
export function isChessGameOver(game: ChessGame): boolean {
  return CHESS_FINISHED_STATUSES.includes(game.status);
}

/** Whose turn it is to move, or undefined once the game is over. */
export function chessTurn(game: ChessGame): ChessColor | undefined {
  return isChessGameOver(game) ? undefined : game.position.turn;
}

/** Whether it is the human's move. */
export function isHumanTurn(game: ChessGame): boolean {
  return chessTurn(game) === game.humanColor;
}

export type ChessMoveResult =
  | { ok: true; game: ChessGame; move: ChessMove; san: string }
  | { ok: false; reason: string };

/**
 * Plays one move, named in coordinate form.
 *
 * A refusal is a **return value, not a throw**: an illegal move is an ordinary thing
 * for a boundary to receive — a tap on the wrong square, a stale request, a hand-edited
 * save — and every caller has something better to do with it than unwind. The same call
 * `evaluate` in `src/lib/calculator` makes.
 */
export function playChessMove(game: ChessGame, uci: string): ChessMoveResult {
  if (isChessGameOver(game)) return { ok: false, reason: "This game is already over." };

  const move = findMoveByUci(game.position, uci);
  if (!move) return { ok: false, reason: "That is not a legal move." };

  return { ok: true, ...applyToGame(game, move) };
}

/** Plays a move the generator produced, skipping the coordinate lookup. */
export function playChessMoveDirect(game: ChessGame, move: ChessMove): ChessGame {
  if (isChessGameOver(game)) return game;
  return applyToGame(game, move).game;
}

function applyToGame(
  game: ChessGame,
  move: ChessMove,
): { game: ChessGame; move: ChessMove; san: string } {
  // SAN has to be written against the position the move was made in — see `moveToSan`.
  const san = moveToSan(game.position, move);
  const position = applyChessMove(game.position, move);
  const repetitionKeys = [...game.repetitionKeys, repetitionKey(position)];

  const status = resolveStatus(position, repetitionKeys);
  return {
    move,
    san,
    game: {
      ...game,
      position,
      moves: [...game.moves, { uci: moveToUci(move), san }],
      repetitionKeys,
      status,
      winner: winnerFor(status, position),
    },
  };
}

/**
 * Who won, given a status and the position it was reached in.
 *
 * Only checkmate produces a winner here: it is the side that just moved, which is the
 * side *not* to move now. Every other ending is either a draw (no winner) or is set by
 * the function that caused it — `resignChessGame` names the winner itself, because a
 * resignation is not visible in the position at all.
 */
function winnerFor(status: ChessStatus, position: ChessPosition): ChessColor | undefined {
  return status === "checkmate" ? oppositeColor(position.turn) : undefined;
}

/**
 * How a position stands, given everything that led to it.
 *
 * Order is the rule, not a preference: **checkmate is decided first**, because a
 * position can be mate *and* on the fiftieth move, and calling that a draw would take a
 * win off the board. Everything after it is a draw of one kind or another, so their
 * order only affects which reason is reported.
 */
export function resolveStatus(
  position: ChessPosition,
  repetitionKeys: readonly string[],
): ChessStatus {
  const inCheck = isInCheck(position);

  if (generateLegalMoves(position).length === 0) return inCheck ? "checkmate" : "stalemate";

  if (position.halfmoveClock >= CHESS_FIFTY_MOVE_PLIES) return "fifty-move";

  const current = repetitionKeys[repetitionKeys.length - 1];
  if (current !== undefined) {
    const seen = repetitionKeys.filter((key) => key === current).length;
    if (seen >= CHESS_REPETITION_LIMIT) return "threefold";
  }

  if (hasInsufficientMaterial(position)) return "insufficient-material";

  return inCheck ? "check" : "playing";
}

/**
 * Whether neither side could checkmate the other with any sequence of legal moves.
 *
 * The four standard cases: bare kings, king and one bishop, king and one knight, and
 * two kings with one bishop each on the same colour squares.
 *
 * **King and two knights is deliberately not here.** Mate cannot be *forced* with them,
 * but it can be reached if the defender cooperates, so the rule does not call it a
 * draw — and a game that ended itself in that position would be ending a game that is
 * still playable.
 */
export function hasInsufficientMaterial(position: ChessPosition): boolean {
  const minor: { color: ChessColor; square: ChessSquare; type: "b" | "n" }[] = [];

  for (let square = 0; square < CHESS_SQUARE_COUNT; square += 1) {
    const piece = position.board[square];
    if (!piece || piece.type === "k") continue;
    // Any pawn, rook or queen anywhere means mate is still reachable, so nothing else
    // needs counting.
    if (piece.type === "p" || piece.type === "r" || piece.type === "q") return false;
    minor.push({ color: piece.color, square, type: piece.type });
    if (minor.length > 2) return false;
  }

  if (minor.length <= 1) return true;

  const [first, second] = minor as [(typeof minor)[number], (typeof minor)[number]];
  return (
    first.type === "b" &&
    second.type === "b" &&
    first.color !== second.color &&
    // Bishops on the same colour square can never attack each other's squares, so no
    // mating net exists. On opposite colours one of them can, so it is not a draw.
    isLightSquare(first.square) === isLightSquare(second.square)
  );
}

/**
 * The game with the player's last move taken back — and the computer's reply with it.
 *
 * Takes back **to the player's own turn**, not one ply, because a single ply would hand
 * the board back with the computer to move and it would simply play the same reply
 * again. Rebuilt by replaying from the start rather than by storing a stack of past
 * positions: the moves are already stored for the save and PGN, and a second
 * representation of the same history is a second thing that can disagree.
 */
export function undoChessMove(game: ChessGame): ChessGame {
  if (game.moves.length === 0) return game;

  let moves = game.moves.slice(0, -1);
  // Drop the computer's reply too, when the move just removed was its.
  if (moves.length > 0 && plyColor(game, moves.length - 1) !== game.humanColor) {
    moves = moves.slice(0, -1);
  }

  const rebuilt = replayChessMoves({
    initialFen: game.initialFen,
    humanColor: game.humanColor,
    level: game.level,
    moves: moves.map((entry) => entry.uci),
  });

  // A replay of moves this game already made cannot fail, but it is checked rather
  // than asserted: silently returning the un-undone game would read as a dead button.
  return rebuilt.ok ? rebuilt.game : game;
}

/** The colour that made the move at `index`, from the starting position's turn. */
function plyColor(game: ChessGame, index: number): ChessColor {
  const first = game.initialFen.trim().split(/\s+/)[1] === "b" ? "b" : "w";
  return index % 2 === 0 ? first : oppositeColor(first);
}

/** Whether the player may take a move back. */
export function canUndoChessMove(game: ChessGame): boolean {
  return game.moves.length > 0 && !isChessGameOver(game);
}

/** The player resigns. The computer wins whatever is on the board. */
export function resignChessGame(game: ChessGame): ChessGame {
  if (isChessGameOver(game)) return game;
  return { ...game, status: "resigned", winner: oppositeColor(game.humanColor) };
}

/**
 * A draw by agreement.
 *
 * The computer accepts whenever the position is not clearly winning for it, which is
 * decided in `chess-bot.ts` — this function only records the agreement, so the rule
 * about when to accept stays with everything else the computer decides.
 */
export function agreeChessDraw(game: ChessGame): ChessGame {
  if (isChessGameOver(game)) return game;
  return { ...game, status: "draw-agreed", winner: undefined };
}

export type ChessReplayResult =
  | { ok: true; game: ChessGame }
  | { ok: false; reason: string };

/**
 * Rebuilds a game by replaying its moves through the rules.
 *
 * This is what makes a stored game safe to load: every move is resolved against the
 * legal list, so a damaged or hand-edited save is refused at the move that does not fit
 * rather than producing an impossible board. It is also how undo works, and how the
 * status, the move list and the repetition keys are recovered without storing any of
 * them.
 */
export function replayChessMoves(input: {
  initialFen: string;
  humanColor: ChessColor;
  level: ChessLevel;
  moves: readonly string[];
}): ChessReplayResult {
  let game: ChessGame;
  try {
    game = startChessGame({
      humanColor: input.humanColor,
      level: input.level,
      fen: input.initialFen,
    });
  } catch {
    return { ok: false, reason: "That game's starting position is not valid." };
  }

  for (const [index, uci] of input.moves.entries()) {
    // A game that is already over cannot have had another move played in it, so a save
    // claiming one was is damaged rather than merely odd.
    if (isChessGameOver(game)) {
      return { ok: false, reason: `There are moves recorded after the game ended (${index + 1}).` };
    }
    const played = playChessMove(game, uci);
    if (!played.ok) return { ok: false, reason: `Move ${index + 1} (${uci}) is not legal.` };
    game = played.game;
  }

  return { ok: true, game };
}

/**
 * Where a piece on `square` may go — what the board highlights when one is picked up.
 *
 * Returns the squares rather than the moves, because the view's question is "which
 * squares light up". A square a pawn can reach by promoting appears once, not four
 * times; which piece it becomes is asked separately, once a target is chosen.
 */
export function chessMoveTargets(game: ChessGame, square: ChessSquare): ChessSquare[] {
  if (isChessGameOver(game)) return [];
  const targets = new Set<ChessSquare>();
  for (const move of generateLegalMoves(game.position)) {
    if (move.from === square) targets.add(move.to);
  }
  return [...targets];
}

/** The legal moves from one square, including each promotion separately. */
export function chessMovesFrom(game: ChessGame, square: ChessSquare): ChessMove[] {
  if (isChessGameOver(game)) return [];
  return generateLegalMoves(game.position).filter((move) => move.from === square);
}

/** The square of the king that is in check, or -1 when neither is. */
export function chessCheckedKingSquare(game: ChessGame): ChessSquare {
  if (game.status !== "check" && game.status !== "checkmate") return -1;
  return kingSquare(game.position, game.position.turn);
}

/**
 * Pieces captured from one side, most valuable first — the "taken" row beside the board.
 *
 * Counted by comparing the starting material with what is on the board now, rather than
 * by reading the move list's `captured` flags. Both would work; this one also covers a
 * game set up from a FEN, where there is no move list to read.
 */
export function chessCapturedPieces(game: ChessGame, color: ChessColor): ChessPieceType[] {
  const start = parseFen(game.initialFen);
  if (!start) return [];

  const count = (position: ChessPosition): Map<string, number> => {
    const tally = new Map<string, number>();
    for (const piece of position.board) {
      if (!piece || piece.color !== color) continue;
      tally.set(piece.type, (tally.get(piece.type) ?? 0) + 1);
    }
    return tally;
  };

  const before = count(start);
  const now = count(game.position);
  const captured: ChessPieceType[] = [];

  // Order is by value, so the row reads as a material count rather than a jumble.
  for (const type of ["q", "r", "b", "n", "p"] as const) {
    const lost = (before.get(type) ?? 0) - (now.get(type) ?? 0);
    // A promotion can leave *more* of a piece than the game started with, which would
    // otherwise show as a negative count.
    for (let index = 0; index < Math.max(0, lost); index += 1) captured.push(type);
  }
  return captured;
}

/**
 * How a finished game reads, in one sentence.
 *
 * In the library rather than the view because the CLI prints the same sentence, and
 * because "who won" is a rule rather than a label.
 */
export function describeChessResult(game: ChessGame): string {
  const youWon = game.winner === game.humanColor;
  switch (game.status) {
    case "checkmate":
      return youWon ? "Checkmate — you win." : "Checkmate — the computer wins.";
    case "resigned":
      return "You resigned.";
    case "stalemate":
      return "Stalemate — a draw. The side to move has no legal move and is not in check.";
    case "fifty-move":
      return "Draw — fifty moves with no capture and no pawn moved.";
    case "threefold":
      return "Draw — the same position has come up three times.";
    case "insufficient-material":
      return "Draw — neither side has enough material to checkmate.";
    case "draw-agreed":
      return "Draw agreed.";
    case "check":
      return "Check.";
    default:
      return "";
  }
}

/**
 * What a finished game is worth on the shared board.
 *
 * A win only, and only the human's: a loss or a draw scores 0, which is the rule Bridge,
 * Mahjong and Battleship all apply. Longer games score less, floored so that a hard-won
 * endgame is still worth more than nothing.
 */
export function scoreChessGame(game: ChessGame): number {
  if (game.winner !== game.humanColor) return 0;

  const base = CHESS_SCORE_BASE * CHESS_LEVEL_SETUP[game.level].multiplier;
  const floor = Math.round(base * CHESS_SCORE_FLOOR_FRACTION);
  return Math.max(floor, base - chessFullMoves(game));
}

/** Full moves played, counting a pair of plies as one. */
export function chessFullMoves(game: ChessGame): number {
  return Math.ceil(game.moves.length / 2);
}

/**
 * The board as the view draws it, in display order.
 *
 * Takes the orientation so the view never does the flip itself: a board drawn from
 * Black's side is the same 64 squares read backwards, and having two places compute
 * that is how a board ends up mirrored on one screen and not another.
 */
export function chessBoardSquares(
  position: ChessPosition,
  orientation: ChessColor,
): ChessSquare[] {
  const squares = Array.from({ length: CHESS_SQUARE_COUNT }, (_, index) => index);
  return orientation === "w" ? squares : squares.reverse();
}

/** The file letters and rank digits down the edge of the board, in display order. */
export function chessCoordinateLabels(orientation: ChessColor): {
  files: string[];
  ranks: string[];
} {
  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const ranks = ["8", "7", "6", "5", "4", "3", "2", "1"];
  return orientation === "w"
    ? { files, ranks }
    : { files: [...files].reverse(), ranks: [...ranks].reverse() };
}

/** Where a square sits in the display grid — used by the board's own tests. */
export function chessDisplayRowCol(
  square: ChessSquare,
  orientation: ChessColor,
): { row: number; col: number } {
  return orientation === "w"
    ? { row: rowOf(square), col: fileOf(square) }
    : { row: 7 - rowOf(square), col: 7 - fileOf(square) };
}
