import { oppositeColor, parseFen, toFen } from "./chess-board";
import { searchChessMove } from "./chess-bot";
import { applyChessMove, generateLegalMoves, isInCheck } from "./chess-moves";
import { findMoveByUci, moveToSan, moveToUci } from "./chess-notation";
import {
  CHESS_ANALYSIS_SPEED_SETUP,
  CHESS_EVAL_CLAMP,
  CHESS_MOVE_QUALITIES,
  CHESS_QUALITY_THRESHOLDS,
  type ChessAnalysedPly,
  type ChessAnalysis,
  type ChessAnalysisSpeed,
  type ChessAnalysisSummary,
  type ChessColor,
  type ChessGame,
  type ChessMoveQuality,
  type ChessPosition,
} from "./types";

/**
 * Post-game analysis: what every move was worth, and what the engine would have played.
 *
 * **Each position is searched once, not twice.** The obvious shape — score the position
 * before a move, then score it again after — does double the work, because the second
 * score *is* the first score of the next position. So the run walks the game once,
 * scores all n+1 positions, and derives every move's loss from the pair either side of
 * it. For an 80-move game that is 81 searches rather than 160, which is the difference
 * between twenty seconds and forty.
 *
 * Pure, and the clock is injected: the only reason this module knows about time at all
 * is the per-position budget it hands the search.
 */

/**
 * The score of one position, from the side to move's point of view, clamped.
 *
 * Terminal positions are decided here rather than left to the search: with no legal
 * moves `searchChessMove` has nothing to search and falls back to counting material,
 * which would score a checkmate as a comfortable position and make the mating move look
 * like a blunder.
 */
function scorePosition(
  position: ChessPosition,
  speed: ChessAnalysisSpeed,
  now?: () => number,
): { score: number; bestUci?: string; bestSan?: string } {
  if (generateLegalMoves(position).length === 0) {
    return { score: isInCheck(position) ? -CHESS_EVAL_CLAMP : 0 };
  }

  const setup = CHESS_ANALYSIS_SPEED_SETUP[speed];
  const result = searchChessMove(position, {
    depth: setup.depth,
    timeMs: setup.timeMs,
    quiescence: true,
    now,
  });

  return {
    score: clampEval(result.score),
    bestUci: result.move ? moveToUci(result.move) : undefined,
    bestSan: result.move ? moveToSan(position, result.move) : undefined,
  };
}

/** Holds an evaluation inside the range the graph and the thresholds can mean anything in. */
export function clampEval(score: number): number {
  return Math.max(-CHESS_EVAL_CLAMP, Math.min(CHESS_EVAL_CLAMP, score));
}

/** A side-to-move score put into White's frame, which is the one the graph plots. */
function toWhiteFrame(score: number, turn: ChessColor): number {
  return turn === "w" ? score : -score;
}

/** What a loss of this many centipawns is called. */
export function chessMoveQuality(lossCentipawns: number): ChessMoveQuality {
  if (lossCentipawns >= CHESS_QUALITY_THRESHOLDS.blunder) return "blunder";
  if (lossCentipawns >= CHESS_QUALITY_THRESHOLDS.mistake) return "mistake";
  if (lossCentipawns >= CHESS_QUALITY_THRESHOLDS.inaccuracy) return "inaccuracy";
  return "good";
}

/**
 * Analyses a finished game.
 *
 * `onProgress` is called after each position is scored, so a caller can draw a bar;
 * `shouldStop` is checked at the same points and ends the run early, returning what it
 * has with `partial` set. Both are what let this run in a worker that the reader can
 * cancel without being left with a half-drawn graph presented as the whole story.
 */
export function analyseChessGame(
  game: ChessGame,
  options: {
    speed?: ChessAnalysisSpeed;
    now?: () => number;
    onProgress?: (scored: number, total: number) => void;
    shouldStop?: () => boolean;
  } = {},
): ChessAnalysis {
  const speed = options.speed ?? "normal";
  const total = game.moves.length + 1;

  const start = parseFen(game.initialFen);
  if (!start || game.moves.length === 0) {
    return { speed, plies: [], summary: emptySummary(), partial: false };
  }

  /*
    Walk the game once, keeping each position and its score. The moves are replayed
    through the rules rather than trusted, so a game whose move list has been tampered
    with simply stops being analysed at the bad move instead of scoring nonsense.
  */
  const positions: ChessPosition[] = [start];
  const scores: ReturnType<typeof scorePosition>[] = [];
  let partial = false;

  for (let index = 0; index < total; index += 1) {
    if (options.shouldStop?.()) {
      partial = true;
      break;
    }

    const position = positions[index]!;
    scores.push(scorePosition(position, speed, options.now));
    options.onProgress?.(index + 1, total);

    // The last position has no move after it.
    if (index === game.moves.length) break;

    const move = findMoveByUci(position, game.moves[index]!.uci);
    if (!move) {
      partial = true;
      break;
    }
    positions.push(applyChessMove(position, move));
  }

  const plies: ChessAnalysedPly[] = [];

  // A move can only be judged with the score of the position on *both* sides of it, so
  // the loop stops one short of however many positions were scored.
  for (let index = 0; index + 1 < scores.length; index += 1) {
    const before = scores[index]!;
    const after = scores[index + 1]!;
    const position = positions[index]!;
    const mover = position.turn;
    const recorded = game.moves[index]!;

    /*
      Both figures from the mover's point of view. `after.score` belongs to the opponent,
      who is to move in that position, so it is negated to say what the position is worth
      to the player who just moved.
    */
    const bestForMover = before.score;
    const afterForMover = -after.score;
    const loss = Math.max(0, bestForMover - afterForMover);

    // A move the engine itself would have played is "best" whatever the arithmetic says
    // — including a forced move, where there was nothing else to play.
    const playedBest = before.bestUci !== undefined && before.bestUci === recorded.uci;

    plies.push({
      index,
      color: mover,
      san: recorded.san,
      uci: recorded.uci,
      fen: toFen(position),
      evalBefore: toWhiteFrame(before.score, mover),
      evalAfter: toWhiteFrame(afterForMover, mover),
      lossCentipawns: playedBest ? 0 : loss,
      quality: playedBest ? "best" : chessMoveQuality(loss),
      ...(playedBest ? {} : { bestSan: before.bestSan, bestUci: before.bestUci }),
    });
  }

  return { speed, plies, summary: summarise(plies), partial };
}

function emptySummary(): ChessAnalysisSummary {
  const blank = () => {
    const counts = {} as Record<ChessMoveQuality, number>;
    for (const quality of CHESS_MOVE_QUALITIES) counts[quality] = 0;
    return counts;
  };
  return { counts: { w: blank(), b: blank() }, averageLoss: { w: 0, b: 0 } };
}

/** The counts and the average loss, per side. */
export function summarise(plies: readonly ChessAnalysedPly[]): ChessAnalysisSummary {
  const summary = emptySummary();
  const totals: Record<ChessColor, { loss: number; moves: number }> = {
    w: { loss: 0, moves: 0 },
    b: { loss: 0, moves: 0 },
  };

  for (const ply of plies) {
    summary.counts[ply.color][ply.quality] += 1;
    totals[ply.color].loss += ply.lossCentipawns;
    totals[ply.color].moves += 1;
  }

  for (const color of ["w", "b"] as const) {
    const { loss, moves } = totals[color];
    summary.averageLoss[color] = moves === 0 ? 0 : Math.round(loss / moves);
  }
  return summary;
}

/**
 * The graph's points: one per position, including the one before any move was played.
 *
 * In **pawns rather than centipawns**, because that is the unit a chess player reads an
 * evaluation in, and always from White's point of view — a line that flipped frame with
 * the turn would zig-zag on every move and show nothing.
 */
export function chessEvalSeries(
  analysis: ChessAnalysis,
): { ply: number; evaluation: number; quality?: ChessMoveQuality; color?: ChessColor }[] {
  const first = analysis.plies[0];
  if (!first) return [];

  // Typed up front: the opening point carries no move, so inference from it alone
  // would give the array a shape the later points do not fit.
  const points: {
    ply: number;
    evaluation: number;
    quality?: ChessMoveQuality;
    color?: ChessColor;
  }[] = [{ ply: 0, evaluation: first.evalBefore / 100 }];
  for (const ply of analysis.plies) {
    points.push({
      ply: ply.index + 1,
      evaluation: ply.evalAfter / 100,
      quality: ply.quality,
      color: ply.color,
    });
  }
  return points;
}

/** The side whose turn it is after `plies` have been played from `initialTurn`. */
export function chessPlyColor(initialTurn: ChessColor, index: number): ChessColor {
  return index % 2 === 0 ? initialTurn : oppositeColor(initialTurn);
}
