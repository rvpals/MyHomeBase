import { oppositeColor, rowOf } from "./chess-board";
import {
  applyChessMove,
  generateLegalCaptures,
  generateLegalMoves,
  isInCheck,
} from "./chess-moves";
import { isChessGameOver } from "./game-chess";
import {
  CHESS_LEVEL_SETUP,
  CHESS_SQUARE_COUNT,
  type ChessColor,
  type ChessGame,
  type ChessLevel,
  type ChessMove,
  type ChessPiece,
  type ChessPosition,
} from "./types";

/**
 * The computer player: how a position is scored, how deep it looks, and how each of the
 * three levels is made to play like itself.
 *
 * Hand-written alpha-beta rather than a Stockfish WASM build — see the Chess section of
 * `types.ts` for why. The point of these three levels is to be *beatable in three
 * different ways*, which a world-champion engine throttled down is bad at: a strong
 * engine told to play badly plays strong moves and then one absurd one, where a human
 * beginner plays plausible moves that do not look far enough ahead. So strength here is
 * built up from how far it looks, rather than cut down from perfect play.
 */

/** Centipawn values. The king's is nominal — mate is scored separately. */
export const CHESS_PIECE_VALUES: Record<ChessPiece["type"], number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20_000,
};

/** A score this large means mate; the distance to it is subtracted per ply. */
const MATE_SCORE = 1_000_000;

/** Beyond this, a mate score is "mate in N" rather than a huge evaluation. */
const MATE_THRESHOLD = MATE_SCORE - 1_000;

/** How often the clock is consulted during a search, in nodes. */
const TIME_CHECK_INTERVAL = 2_048;

/**
 * Piece-square tables, in centipawns, from **White's point of view and in board order**
 * — index 0 is a8, matching `ChessSquare`. Black reads the same table with the rank
 * mirrored, which is what `squareBonus` does.
 *
 * These are the well-known "simplified evaluation" tables. They are not tuned and are
 * not meant to be: their whole job is to stop the engine shuffling pieces aimlessly
 * when material is level, by giving knights a reason to come to the middle and pawns a
 * reason to advance. Material is what decides games at these depths.
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
 * …and in the endgame it wants the middle. Switching tables is the one piece of phase
 * knowledge in here, and it is the difference between converting a won endgame and
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

/** Non-pawn material (one side) below which the king's endgame table takes over. */
const ENDGAME_MATERIAL = CHESS_PIECE_VALUES.r + CHESS_PIECE_VALUES.b;

function squareBonus(piece: ChessPiece, square: number, endgame: boolean): number {
  const table = piece.type === "k" && endgame ? KING_ENDGAME_TABLE : TABLES[piece.type];
  // Black reads White's table with the rank mirrored: a8 for Black is what h1... is for
  // White only in rank, not file, because these tables are left-right symmetric.
  const index = piece.color === "w" ? square : (7 - rowOf(square)) * 8 + (square % 8);
  return table[index] ?? 0;
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
  let white = 0;
  let black = 0;
  let whiteNonPawn = 0;
  let blackNonPawn = 0;

  // One pass for material, so the endgame test does not need a second walk of the board.
  for (let square = 0; square < CHESS_SQUARE_COUNT; square += 1) {
    const piece = position.board[square];
    if (!piece) continue;
    const value = CHESS_PIECE_VALUES[piece.type];
    if (piece.color === "w") {
      white += value;
      if (piece.type !== "p" && piece.type !== "k") whiteNonPawn += value;
    } else {
      black += value;
      if (piece.type !== "p" && piece.type !== "k") blackNonPawn += value;
    }
  }

  const endgame = whiteNonPawn <= ENDGAME_MATERIAL && blackNonPawn <= ENDGAME_MATERIAL;

  for (let square = 0; square < CHESS_SQUARE_COUNT; square += 1) {
    const piece = position.board[square];
    if (!piece) continue;
    const bonus = squareBonus(piece, square, endgame);
    if (piece.color === "w") white += bonus;
    else black += bonus;
  }

  const score = white - black;
  return position.turn === "w" ? score : -score;
}

interface SearchContext {
  deadline: number;
  now: () => number;
  quiescence: boolean;
  nodes: number;
  /** Set once the budget runs out; every frame then unwinds without scoring. */
  aborted: boolean;
}

export interface ChessSearchResult {
  move?: ChessMove;
  score: number;
  /** The last depth that completed before the budget ran out. */
  depth: number;
  nodes: number;
}

/**
 * The best move the search can find, within a depth and a time budget.
 *
 * **Iterative deepening**: depth 1, then 2, then 3, keeping the best move from the last
 * depth that *finished*. That is what makes the time budget safe — running out mid-depth
 * discards only that depth's partial answer, and the move played is always one that a
 * complete search chose. A plain fixed-depth search has no such property: on a crowded
 * position it simply takes as long as it takes, which on a phone is a frozen board.
 *
 * `now` is injected so a test can drive the clock instead of waiting for one.
 */
export function searchChessMove(
  position: ChessPosition,
  options: {
    depth: number;
    timeMs: number;
    quiescence: boolean;
    now?: () => number;
  },
): ChessSearchResult {
  const now = options.now ?? Date.now;
  const context: SearchContext = {
    deadline: now() + options.timeMs,
    now,
    quiescence: options.quiescence,
    nodes: 0,
    aborted: false,
  };

  const moves = orderMoves(generateLegalMoves(position));
  if (moves.length === 0) return { score: evaluateChessPosition(position), depth: 0, nodes: 0 };

  // A depth below 1 searches nothing, so the position's own evaluation *is* the answer.
  // Without this the deepening loop never runs and the caller is handed `-MATE_SCORE`
  // for a perfectly ordinary position — which, compared across root moves, makes every
  // one of them look equally lost.
  if (options.depth < 1) {
    return { move: moves[0], score: evaluateChessPosition(position), depth: 0, nodes: 0 };
  }

  let best: ChessMove = moves[0]!;
  let bestScore = -MATE_SCORE;
  let completedDepth = 0;

  for (let depth = 1; depth <= options.depth; depth += 1) {
    let alpha = -MATE_SCORE;
    let depthBest: ChessMove | undefined;
    let depthScore = -MATE_SCORE;

    for (const move of moves) {
      const score = -negamax(applyChessMove(position, move), depth - 1, -MATE_SCORE, -alpha, 1, context);
      if (context.aborted) break;
      if (score > depthScore) {
        depthScore = score;
        depthBest = move;
      }
      if (score > alpha) alpha = score;
    }

    if (context.aborted || !depthBest) break;

    best = depthBest;
    bestScore = depthScore;
    completedDepth = depth;

    // Searching deeper cannot improve on a forced mate already found, and continuing
    // would spend the whole budget re-proving it.
    if (Math.abs(bestScore) > MATE_THRESHOLD) break;

    // Move the best move to the front, so the next, deeper pass gets its best cutoff
    // immediately. This is most of what makes iterative deepening cheaper than it looks.
    moves.splice(moves.indexOf(best), 1);
    moves.unshift(best);
  }

  return { move: best, score: bestScore, depth: completedDepth, nodes: context.nodes };
}

/**
 * Negamax with alpha-beta pruning. Returns the score for the side to move.
 *
 * `ply` is the distance from the root, and it is only used to make a mate found sooner
 * score higher than the same mate found later — without it the engine announces mate
 * and then never actually delivers it, because every mating line looks equally good and
 * it keeps choosing a different one.
 */
function negamax(
  position: ChessPosition,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  context: SearchContext,
): number {
  context.nodes += 1;
  if (context.nodes % TIME_CHECK_INTERVAL === 0 && context.now() > context.deadline) {
    context.aborted = true;
  }
  if (context.aborted) return 0;

  const moves = generateLegalMoves(position);

  // Mate and stalemate are detected here rather than at depth 0, so a forced mate is
  // found at whatever depth it happens at rather than being scored as material.
  if (moves.length === 0) {
    return isInCheck(position) ? -MATE_SCORE + ply : 0;
  }

  // The fifty-move rule is the one draw the search has to know about: an engine that
  // cannot see it will happily shuffle in a won endgame until the game is drawn.
  if (position.halfmoveClock >= 100) return 0;

  if (depth <= 0) {
    return context.quiescence ? quiesce(position, alpha, beta, ply, context) : evaluateChessPosition(position);
  }

  let value = alpha;
  for (const move of orderMoves(moves)) {
    const score = -negamax(applyChessMove(position, move), depth - 1, -beta, -value, ply + 1, context);
    if (context.aborted) return 0;
    if (score >= beta) return beta;
    if (score > value) value = score;
  }
  return value;
}

/**
 * Keeps searching captures and promotions past the depth limit, until the position is
 * quiet.
 *
 * This is the fix for the **horizon effect**, and it is the single biggest difference
 * between Beginner and Intermediate. Without it a search that ends on "I take your
 * pawn" scores a pawn up and never sees the queen that recaptures — so the engine
 * cheerfully hangs pieces on its last ply, every time, at any depth.
 *
 * The "stand pat" score is the one subtlety: a side is never *forced* to capture, so
 * the position's own evaluation is a lower bound on what it can get.
 */
function quiesce(
  position: ChessPosition,
  alpha: number,
  beta: number,
  ply: number,
  context: SearchContext,
): number {
  context.nodes += 1;
  if (context.nodes % TIME_CHECK_INTERVAL === 0 && context.now() > context.deadline) {
    context.aborted = true;
  }
  if (context.aborted) return 0;

  const standPat = evaluateChessPosition(position);
  if (standPat >= beta) return beta;

  let value = alpha > standPat ? alpha : standPat;

  for (const move of orderMoves(generateLegalCaptures(position))) {
    const score = -quiesce(applyChessMove(position, move), -beta, -value, ply + 1, context);
    if (context.aborted) return 0;
    if (score >= beta) return beta;
    if (score > value) value = score;
  }
  return value;
}

/**
 * Captures first, best-looking ones first — **MVV-LVA**: most valuable victim, least
 * valuable attacker, so `PxQ` is tried before `QxP`.
 *
 * Ordering changes no result; it changes how fast alpha-beta finds the cutoffs that let
 * it skip work. On a middlegame position good ordering is worth roughly a whole extra
 * ply for the same time, which is why a dozen lines of sorting sits in the hot path.
 */
function orderMoves(moves: readonly ChessMove[]): ChessMove[] {
  return [...moves].sort((left, right) => moveOrderScore(right) - moveOrderScore(left));
}

function moveOrderScore(move: ChessMove): number {
  let score = 0;
  if (move.captured) {
    score += 10_000 + CHESS_PIECE_VALUES[move.captured] * 10 - CHESS_PIECE_VALUES[move.piece];
  }
  if (move.promotion) score += 9_000 + CHESS_PIECE_VALUES[move.promotion];
  if (move.isCastle) score += 50;
  return score;
}

/**
 * The move the computer plays, at its level.
 *
 * `rng` and `now` are injected rather than reached for, so this is a pure function of
 * its inputs and a test can pin both. Everything that makes a level feel like itself is
 * here: how deep it looks, whether it checks for recaptures, how often it throws a move
 * away, and how much it varies.
 */
export function chooseChessMove(
  position: ChessPosition,
  level: ChessLevel,
  options: { rng?: () => number; now?: () => number } = {},
): ChessMove | undefined {
  const rng = options.rng ?? Math.random;
  const setup = CHESS_LEVEL_SETUP[level];

  const moves = generateLegalMoves(position);
  if (moves.length === 0) return undefined;
  if (moves.length === 1) return moves[0];

  // The blunder. A level's beatability comes from here rather than from a worse search:
  // this is a player who did not look, which is what a human beginner actually does,
  // where a shallower search is a player who looked and judged badly.
  if (setup.blunderChance > 0 && rng() < setup.blunderChance) {
    return moves[Math.floor(rng() * moves.length) % moves.length];
  }

  if (setup.noiseCentipawns <= 0) {
    return (
      searchChessMove(position, {
        depth: setup.depth,
        timeMs: setup.timeMs,
        quiescence: setup.quiescence,
        now: options.now,
      }).move ?? moves[0]
    );
  }

  // With noise, every root move is scored and then nudged, so the computer does not
  // play the identical game from the identical position every single time. The nudge is
  // small enough that it only decides between moves the search thought were close.
  //
  // Each child is scored from *its* side to move, so every score is negated to bring it
  // back to ours.
  const childDepth = setup.depth - 1;
  let best = moves[0]!;
  let bestScore = -Infinity;

  for (const move of moves) {
    const child = applyChessMove(position, move);
    // At Beginner `childDepth` is 0, which is exactly a one-ply search: look at the
    // position this move leads to and score it, with no reply considered. Routing that
    // through the search would ask it to complete zero depths and report nothing.
    const raw =
      childDepth >= 1
        ? searchChessMove(child, {
            depth: childDepth,
            timeMs: Math.max(50, Math.floor(setup.timeMs / moves.length)),
            quiescence: setup.quiescence,
            now: options.now,
          }).score
        : evaluateChessPosition(child);

    const score = -raw + (rng() * 2 - 1) * setup.noiseCentipawns;
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

/**
 * The move the player is advised to make, and what the engine thinks of the position.
 *
 * Always searched at **Advanced strength**, whatever level the game is being played at:
 * a hint from the Beginner engine would sometimes be a blunder, and a hint you cannot
 * trust is worse than none. Undefined when the game is over or there is nothing to play.
 */
export function chessHint(
  game: ChessGame,
  options: { now?: () => number } = {},
): { move: ChessMove; score: number } | undefined {
  if (isChessGameOver(game)) return undefined;
  const advanced = CHESS_LEVEL_SETUP.advanced;
  const result = searchChessMove(game.position, {
    depth: advanced.depth,
    timeMs: advanced.timeMs,
    quiescence: true,
    now: options.now,
  });
  return result.move ? { move: result.move, score: result.score } : undefined;
}

/**
 * Whether the computer accepts a draw.
 *
 * It accepts unless it judges itself clearly better — the threshold is about a minor
 * piece, so being a pawn up is not a reason to refuse while being a rook up is. A
 * computer that always accepted would make the button a free escape from a lost game;
 * one that never accepted would make it a dead control.
 *
 * Searched shallowly on purpose: this is a judgement about the position as it stands,
 * and spending Advanced's whole budget on a question the player asked in passing would
 * stall the board.
 */
export function shouldAcceptChessDraw(
  game: ChessGame,
  options: { now?: () => number } = {},
): boolean {
  if (isChessGameOver(game)) return false;

  const computer = oppositeColor(game.humanColor);
  const result = searchChessMove(game.position, {
    depth: 2,
    timeMs: 400,
    quiescence: true,
    now: options.now,
  });

  // The search scores for whoever is to move, so it is flipped when that is the player.
  const fromComputer = game.position.turn === computer ? result.score : -result.score;
  return fromComputer < CHESS_PIECE_VALUES.n;
}

/** Whether a score means a forced mate, for the analysis line the hint shows. */
export function isChessMateScore(score: number): boolean {
  return Math.abs(score) > MATE_THRESHOLD;
}

/**
 * A score as the screen prints it: `+1.4`, `-0.6`, or `mate in 3`.
 *
 * Always from the given colour's point of view, so the hint can say what it means for
 * the player rather than for whoever happens to be to move.
 */
export function formatChessScore(score: number, forColor: ChessColor, turn: ChessColor): string {
  const value = forColor === turn ? score : -score;
  if (isChessMateScore(value)) {
    const plies = MATE_SCORE - Math.abs(value);
    const moves = Math.max(1, Math.ceil(plies / 2));
    return value > 0 ? `mate in ${moves}` : `mated in ${moves}`;
  }
  const pawns = value / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(1)}`;
}
