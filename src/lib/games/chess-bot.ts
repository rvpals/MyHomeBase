import { oppositeColor, repetitionKey } from "./chess-board";
import {
  CHESS_PIECE_VALUES,
  evaluateChessPosition,
  hasNonPawnMaterial,
} from "./chess-evaluate";
import { chessPositionKey } from "./chess-zobrist";
import {
  applyChessMove,
  generateLegalCaptures,
  generateLegalMoves,
  isInCheck,
} from "./chess-moves";
import { isChessGameOver } from "./game-chess";
import { findMoveByUci, moveToSan } from "./chess-notation";
import {
  CHESS_LEVEL_SETUP,
  type ChessColor,
  type ChessGame,
  type ChessLevel,
  type ChessMove,
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

/**
 * Material values, the piece-square tables and everything else about *what a position
 * is worth* now live in `chess-evaluate.ts`. They are re-exported here because this
 * module was their home and both the analysis screen and the tests import them from it.
 */
export { CHESS_PIECE_VALUES, evaluateChessPosition } from "./chess-evaluate";

/** A score this large means mate; the distance to it is subtracted per ply. */
const MATE_SCORE = 1_000_000;

/** Beyond this, a mate score is "mate in N" rather than a huge evaluation. */
const MATE_THRESHOLD = MATE_SCORE - 1_000;

/** How often the clock is consulted during a search, in nodes. */
const TIME_CHECK_INTERVAL = 2_048;

/* ---------------------------------------------------------------------------------
   The transposition table.

   The same position turns up again and again by different move orders, and without a
   table every one of them is searched from scratch. Storing what a position was worth
   — and how deeply it was examined — is the single largest speed-up available to a
   search of this shape, and it is what lets Advanced reach a usable depth inside its
   couple of seconds.

   `flag` records what the stored score *means*, which is the part that is easy to get
   wrong: alpha-beta does not always return the true value of a position. An `exact`
   score was fully determined; a `lower` bound means a beta cutoff stopped the search
   early, so the real value is at least this; an `upper` bound means nothing beat alpha,
   so the real value is at most this. Reusing a bound as though it were exact is how a
   table makes an engine play nonsense.
--------------------------------------------------------------------------------- */

type ScoreFlag = "exact" | "lower" | "upper";

interface TableEntry {
  key: number;
  depth: number;
  score: number;
  flag: ScoreFlag;
  /** The move that was best here, tried first next time even when the score cannot be used. */
  move?: ChessMove;
}

/**
 * Entries, as a plain Map keyed by position.
 *
 * Cleared at the start of every root search rather than kept between moves. Keeping it
 * would help, but it also means scores from a position reached by a different route —
 * with a different repetition history behind it — leaking into a later search, and that
 * is a class of bug not worth inviting for a game at this scale. The table still pays
 * for itself many times over inside one search.
 */
const MAX_TABLE_ENTRIES = 200_000;

interface SearchContext {
  deadline: number;
  now: () => number;
  quiescence: boolean;
  nodes: number;
  /** Set once the budget runs out; every frame then unwinds without scoring. */
  aborted: boolean;
  table: Map<number, TableEntry>;
  /**
   * Two moves per ply that caused a beta cutoff without being captures.
   *
   * A move that refuted one line usually refutes its siblings too, so trying it early
   * is worth far more than its static ordering score suggests. Two per ply, because
   * one is too easily displaced and three rarely adds anything.
   */
  killers: (ChessMove | undefined)[][];
  /** How often a quiet move has caused a cutoff anywhere, indexed by from-to. */
  history: Int32Array;
  /**
   * Position keys on the path from the root, so the search can see a repetition.
   *
   * Without it the engine happily walks into a threefold draw while winning, because
   * every position in the loop evaluates well and nothing tells it the game ends there.
   */
  repetitions: string[];
}

export interface ChessSearchProgress {
  depth: number;
  /** The best move found so far — it can change as the search looks deeper. */
  move: ChessMove;
  /** Centipawns, for the side to move. */
  score: number;
  nodes: number;
  elapsedMs: number;
  /**
   * The line the engine expects, in coordinate form — its own move, the reply it
   * predicts, and so on. Empty when the search was cut short before one was found.
   */
  line: string[];
}

/**
 * What the computer says while it thinks, for the Messages panel.
 *
 * **Only produced when a caller passes `onEvent`.** With no listener nothing here is
 * computed — no SAN, no score text, no candidate list — so the panel's "See machine log"
 * switch being off costs the search exactly nothing.
 *
 * Events carry display-ready text (`san`, `scoreText`) rather than raw moves and
 * centipawns, so the view only lays them out and the CLI could print the same lines.
 */
export type ChessThinkingEvent =
  | {
      kind: "start";
      label: string;
      legalMoves: number;
      depth: number;
      budgetMs: number;
      quiescence: boolean;
    }
  | {
      kind: "depth";
      depth: number;
      san: string;
      scoreText: string;
      nodes: number;
      elapsedMs: number;
      /** The expected continuation, in algebraic notation. */
      line: string[];
    }
  | { kind: "candidates"; items: { san: string; scoreText: string }[] }
  | { kind: "note"; text: string }
  | { kind: "chosen"; san: string; elapsedMs: number; depth?: number; nodes?: number };

export interface ChessSearchResult {
  move?: ChessMove;
  /** The last depth that completed before the budget ran out. */
  depth: number;
  score: number;
  nodes: number;
  /** The principal variation — the line the engine expects, in coordinate form. */
  line: string[];
}

/** How deep a null-move search is reduced by. Three plies is the usual choice. */
const NULL_MOVE_REDUCTION = 3;

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
 * `history` is the positions already played in the game, so the search can tell that
 * repeating one ends it.
 */
export function searchChessMove(
  position: ChessPosition,
  options: {
    depth: number;
    timeMs: number;
    quiescence: boolean;
    now?: () => number;
    /** Repetition keys of the positions already played, oldest first. */
    history?: readonly string[];
    /** Called after each depth that completes. Absent means no reporting work at all. */
    onProgress?: (progress: ChessSearchProgress) => void;
  },
): ChessSearchResult {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const context: SearchContext = {
    deadline: startedAt + options.timeMs,
    now,
    quiescence: options.quiescence,
    nodes: 0,
    aborted: false,
    table: new Map(),
    killers: [],
    history: new Int32Array(64 * 64),
    repetitions: [...(options.history ?? [])],
  };

  const moves = orderMoves(generateLegalMoves(position), position, context, 0);
  if (moves.length === 0) {
    return { score: evaluateChessPosition(position), depth: 0, nodes: 0, line: [] };
  }

  // A depth below 1 searches nothing, so the position's own evaluation *is* the answer.
  if (options.depth < 1) {
    return {
      move: moves[0],
      score: evaluateChessPosition(position),
      depth: 0,
      nodes: 0,
      line: [],
    };
  }

  let best: ChessMove = moves[0]!;
  let bestScore = -MATE_SCORE;
  let bestLine: string[] = [];
  let completedDepth = 0;

  for (let depth = 1; depth <= options.depth; depth += 1) {
    let alpha = -MATE_SCORE;
    let depthBest: ChessMove | undefined;
    let depthScore = -MATE_SCORE;
    let depthLine: string[] = [];

    for (const move of moves) {
      const line: string[] = [];
      const after = applyChessMove(position, move);

      context.repetitions.push(repetitionKey(after));
      const score = -negamax(after, depth - 1, -MATE_SCORE, -alpha, 1, context, line);
      context.repetitions.pop();

      if (context.aborted) break;
      if (score > depthScore) {
        depthScore = score;
        depthBest = move;
        depthLine = [moveToUciLite(move), ...line];
      }
      if (score > alpha) alpha = score;
    }

    if (context.aborted || !depthBest) break;

    best = depthBest;
    bestScore = depthScore;
    bestLine = depthLine;
    completedDepth = depth;
    options.onProgress?.({
      depth,
      move: best,
      score: bestScore,
      nodes: context.nodes,
      elapsedMs: now() - startedAt,
      line: bestLine,
    });

    // Searching deeper cannot improve on a forced mate already found, and continuing
    // would spend the whole budget re-proving it.
    if (Math.abs(bestScore) > MATE_THRESHOLD) break;

    // Move the best move to the front, so the next, deeper pass gets its best cutoff
    // immediately. This is most of what makes iterative deepening cheaper than it looks.
    moves.splice(moves.indexOf(best), 1);
    moves.unshift(best);
  }

  /*
    No depth finished, so there is no searched score to report.

    `bestScore` is still its `-MATE_SCORE` starting value here, and returning that would
    say "this position is lost" about a perfectly ordinary one. That matters because
    `chooseChessMove` negates these scores to compare root moves: a move whose search
    was cut short would come back as +MATE_SCORE and be played immediately.
  */
  if (completedDepth === 0) {
    return {
      move: best,
      score: evaluateChessPosition(position),
      depth: 0,
      nodes: context.nodes,
      line: [],
    };
  }

  return {
    move: best,
    score: bestScore,
    depth: completedDepth,
    nodes: context.nodes,
    line: bestLine,
  };
}

/** A move in coordinate form, without reaching for the notation module. */
function moveToUciLite(move: ChessMove): string {
  const name = (square: number) =>
    `${"abcdefgh"[square % 8]}${8 - Math.floor(square / 8)}`;
  return `${name(move.from)}${name(move.to)}${move.promotion ?? ""}`;
}

/** Whether this position has appeared before on the path from the root. */
function isRepetition(context: SearchContext, key: string): boolean {
  // Twice is enough inside a search. A position seen once already means the side to
  // move can force a third by repeating, so treating it as a draw here is what stops
  // the engine walking into one while winning — and what lets it *reach* for one when
  // it is losing.
  let seen = 0;
  for (const entry of context.repetitions) {
    if (entry === key) seen += 1;
    if (seen >= 2) return true;
  }
  return false;
}

/**
 * Negamax with alpha-beta pruning. Returns the score for the side to move.
 *
 * `ply` is the distance from the root, and it is only used to make a mate found sooner
 * score higher than the same mate found later — without it the engine announces mate
 * and then never actually delivers it, because every mating line looks equally good and
 * it keeps choosing a different one.
 *
 * `line` is filled with the continuation this node expects, which is what the Messages
 * panel prints as the principal variation.
 */
function negamax(
  position: ChessPosition,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  context: SearchContext,
  line: string[],
): number {
  context.nodes += 1;
  if (context.nodes % TIME_CHECK_INTERVAL === 0 && context.now() > context.deadline) {
    context.aborted = true;
  }
  if (context.aborted) return 0;

  line.length = 0;

  // A position repeated on the way here is a draw, whatever the pieces say. Checked
  // before anything else, because it ends the game and no evaluation applies.
  const repetition = repetitionKey(position);
  if (ply > 0 && isRepetition(context, repetition)) return 0;

  const originalAlpha = alpha;
  const key = chessPositionKey(position);
  const stored = context.table.get(key);

  /*
    A stored result is only usable when it was searched at least as deeply as this, and
    then only according to what its score means — see `ScoreFlag`. At the root (ply 0)
    it is never used for the score, because the root has to produce a move and a line,
    not just a number.
  */
  if (stored && stored.key === key && stored.depth >= depth && ply > 0) {
    if (stored.flag === "exact") return stored.score;
    if (stored.flag === "lower" && stored.score > alpha) alpha = stored.score;
    else if (stored.flag === "upper" && stored.score < beta) beta = stored.score;
    if (alpha >= beta) return stored.score;
  }

  const moves = generateLegalMoves(position);
  const inCheck = isInCheck(position);

  // Mate and stalemate are detected here rather than at depth 0, so a forced mate is
  // found at whatever depth it happens at rather than being scored as material.
  if (moves.length === 0) return inCheck ? -MATE_SCORE + ply : 0;

  // The fifty-move rule is the other draw the search has to know about: an engine that
  // cannot see it will happily shuffle in a won endgame until the game is drawn.
  if (position.halfmoveClock >= 100) return 0;

  if (depth <= 0) {
    return context.quiescence
      ? quiesce(position, alpha, beta, ply, context)
      : evaluateChessPosition(position);
  }

  /*
    Null-move pruning: let the opponent move twice and see whether the position is
    *still* good enough to cut off. If it is, this line is so strong that searching it
    properly is a waste.

    Three conditions, each for a reason. Not while in check, because passing out of
    check is not a legal idea and the result would be meaningless. Not in the last two
    plies, where the reduced search would be shallower than nothing. And not when the
    side to move has only pawns, where **zugzwang** makes the whole premise false —
    being forced to move can be worse than passing, so "I could pass and still be fine"
    proves nothing.
  */
  if (
    depth >= NULL_MOVE_REDUCTION &&
    !inCheck &&
    ply > 0 &&
    hasNonPawnMaterial(position, position.turn)
  ) {
    const passed: ChessPosition = {
      ...position,
      turn: oppositeColor(position.turn),
      enPassant: null,
    };
    const scratch: string[] = [];
    const score = -negamax(
      passed,
      depth - NULL_MOVE_REDUCTION,
      -beta,
      -beta + 1,
      ply + 1,
      context,
      scratch,
    );
    if (context.aborted) return 0;
    if (score >= beta) return beta;
  }

  let value = alpha;
  let bestMove: ChessMove | undefined;
  const child: string[] = [];

  for (const move of orderMoves(moves, position, context, ply, stored?.move)) {
    const after = applyChessMove(position, move);
    context.repetitions.push(repetitionKey(after));
    const score = -negamax(after, depth - 1, -beta, -value, ply + 1, context, child);
    context.repetitions.pop();

    if (context.aborted) return 0;

    if (score >= beta) {
      // A quiet move that caused a cutoff is worth trying first elsewhere, so it is
      // remembered both per ply (a killer) and globally (history).
      if (!move.captured && !move.promotion) rememberCutoff(context, move, ply, depth);
      store(context, key, depth, beta, "lower", move);
      return beta;
    }
    if (score > value) {
      value = score;
      bestMove = move;
      line.length = 0;
      line.push(moveToUciLite(move), ...child);
    }
  }

  store(
    context,
    key,
    depth,
    value,
    value > originalAlpha ? "exact" : "upper",
    bestMove,
  );
  return value;
}

/** Records a result, unless the table has grown past what is worth keeping. */
function store(
  context: SearchContext,
  key: number,
  depth: number,
  score: number,
  flag: ScoreFlag,
  move?: ChessMove,
): void {
  const existing = context.table.get(key);
  // Depth-preferred: a deeper result is more trustworthy than a shallower one, so it is
  // never overwritten by a cheaper look at the same position.
  if (existing && existing.depth > depth) return;
  if (!existing && context.table.size >= MAX_TABLE_ENTRIES) return;
  context.table.set(key, { key, depth, score, flag, move });
}

/** Remembers a quiet move that caused a cutoff, for ordering later. */
function rememberCutoff(
  context: SearchContext,
  move: ChessMove,
  ply: number,
  depth: number,
): void {
  const slot = (context.killers[ply] ??= [undefined, undefined]);
  if (slot[0] && slot[0].from === move.from && slot[0].to === move.to) return;
  slot[1] = slot[0];
  slot[0] = move;

  // Weighted by depth squared: a cutoff found deep in the tree says far more about a
  // move than one found at a leaf, and without the weighting shallow noise drowns it.
  context.history[move.from * 64 + move.to] += depth * depth;
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
 * **While in check it searches every move, not just captures.** Standing pat in check
 * would score a position the side to move may not legally hold, and the usual symptom
 * is an engine that cannot see it is being mated. That makes the node more expensive,
 * which is why it only applies when there actually is a check to answer.
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

  const inCheck = isInCheck(position);

  if (inCheck) {
    const escapes = generateLegalMoves(position);
    // No way out: this is mate, and it has to be scored as mate rather than as whatever
    // the material happens to be.
    if (escapes.length === 0) return -MATE_SCORE + ply;

    let value = alpha;
    for (const move of orderMoves(escapes, position, context, ply)) {
      const score = -quiesce(applyChessMove(position, move), -beta, -value, ply + 1, context);
      if (context.aborted) return 0;
      if (score >= beta) return beta;
      if (score > value) value = score;
    }
    return value;
  }

  // The "stand pat" score: a side is never *forced* to capture, so the position's own
  // evaluation is a lower bound on what it can get.
  const standPat = evaluateChessPosition(position);
  if (standPat >= beta) return beta;

  let value = alpha > standPat ? alpha : standPat;

  for (const move of orderMoves(generateLegalCaptures(position), position, context, ply)) {
    const score = -quiesce(applyChessMove(position, move), -beta, -value, ply + 1, context);
    if (context.aborted) return 0;
    if (score >= beta) return beta;
    if (score > value) value = score;
  }
  return value;
}

/**
 * Orders moves so that alpha-beta finds its cutoffs as early as possible.
 *
 * Ordering changes no result; it changes how much work is skipped. On a middlegame
 * position good ordering is worth roughly a whole extra ply for the same time, which is
 * why this sits in the hot path. The ranking, best first:
 *
 * 1. **The table's move** for this position — the one that was best last time it was
 *    searched, usually still best now.
 * 2. **Captures**, by MVV-LVA: most valuable victim, least valuable attacker, so `PxQ`
 *    is tried before `QxP`.
 * 3. **Killers** — quiet moves that caused a cutoff at this same ply elsewhere.
 * 4. **History** — quiet moves that have caused cutoffs anywhere, weighted by depth.
 */
function orderMoves(
  moves: readonly ChessMove[],
  position: ChessPosition,
  context: SearchContext,
  ply: number,
  tableMove?: ChessMove,
): ChessMove[] {
  const killers = context.killers[ply];

  const score = (move: ChessMove): number => {
    if (tableMove && move.from === tableMove.from && move.to === tableMove.to) {
      return 1_000_000;
    }

    let value = 0;
    if (move.captured) {
      value +=
        100_000 + CHESS_PIECE_VALUES[move.captured] * 10 - CHESS_PIECE_VALUES[move.piece];
    }
    if (move.promotion) value += 90_000 + CHESS_PIECE_VALUES[move.promotion];
    if (value > 0) return value;

    if (killers) {
      if (killers[0] && killers[0].from === move.from && killers[0].to === move.to) return 80_000;
      if (killers[1] && killers[1].from === move.from && killers[1].to === move.to) return 79_000;
    }
    if (move.isCastle) return 1_000;

    return context.history[move.from * 64 + move.to] ?? 0;
  };

  // `position` is unused by the ranking today, and is taken so a future term that needs
  // it — seeing whether a move gives check, say — does not change every call site.
  void position;

  return [...moves].sort((left, right) => score(right) - score(left));
}

export function chooseChessMove(
  position: ChessPosition,
  level: ChessLevel,
  options: {
    rng?: () => number;
    now?: () => number;
    /** Narrates the search. Omit it and no narration is built. */
    onEvent?: (event: ChessThinkingEvent) => void;
    /**
     * Overrides the level's own time budget — what a clocked game passes so the
     * computer rations its remaining time instead of flagging itself. See
     * `chessSearchBudgetMs`.
     */
    timeBudgetMs?: number;
    /**
     * The positions already played, so the search can see a repetition coming. Without
     * it the engine will walk into a threefold draw from a winning position, because
     * every position in the loop evaluates well and nothing says the game ends there.
     */
    history?: readonly string[];
  } = {},
): ChessMove | undefined {
  const rng = options.rng ?? Math.random;
  const now = options.now ?? Date.now;
  const emit = options.onEvent;
  const setup = CHESS_LEVEL_SETUP[level];
  const budgetMs = options.timeBudgetMs ?? setup.timeMs;
  const startedAt = emit ? now() : 0;

  const moves = generateLegalMoves(position);
  if (moves.length === 0) return undefined;

  emit?.({
    kind: "start",
    label: setup.label,
    legalMoves: moves.length,
    depth: setup.depth,
    budgetMs,
    quiescence: setup.quiescence,
  });

  /** Reports the move chosen, then returns it — every exit below goes through here. */
  const finish = (
    move: ChessMove | undefined,
    detail?: { depth: number; nodes: number },
  ): ChessMove | undefined => {
    if (emit && move) {
      emit({ kind: "chosen", san: moveToSan(position, move), elapsedMs: now() - startedAt, ...detail });
    }
    return move;
  };

  if (moves.length === 1) {
    emit?.({ kind: "note", text: "Only one legal move, so it played it without searching." });
    return finish(moves[0]);
  }

  if (emit) {
    if (setup.depth <= 1) {
      emit({ kind: "note", text: "Looks one move ahead only. It does not consider your reply." });
    }
    if (!setup.quiescence) {
      emit({
        kind: "note",
        text: "Does not check whether a piece it takes can be taken back.",
      });
    }
  }

  // The blunder. A level's beatability comes from here rather than from a worse search:
  // this is a player who did not look, which is what a human beginner actually does,
  // where a shallower search is a player who looked and judged badly.
  if (setup.blunderChance > 0 && rng() < setup.blunderChance) {
    emit?.({
      kind: "note",
      text: `Rolled the dice (${Math.round(setup.blunderChance * 100)}% chance at ${setup.label}) and is playing a random move instead of searching.`,
    });
    return finish(moves[Math.floor(rng() * moves.length) % moves.length]);
  }

  if (setup.noiseCentipawns <= 0) {
    const result = searchChessMove(position, {
      depth: setup.depth,
      timeMs: budgetMs,
      quiescence: setup.quiescence,
      now: options.now,
      history: options.history,
      onProgress: emit && depthReporter(position, emit),
    });

    /*
      Variety at the top level, without weakening the move.

      Advanced adds no noise to its scores, so from a given position it played the
      identical game every single time — the same opening, move for move, for ever.
      Rather than making it play worse, the opening moves are chosen at random from
      those the search rates **within a pawn's tenth of its best**: moves it considers
      equal, so picking among them costs nothing it can measure.

      Only in the opening, and only among genuinely equal moves, so nothing about the
      way it plays a real position changes.
    */
    const best = result.move ?? moves[0];
    if (best && position.fullmoveNumber <= OPENING_MOVES && moves.length > 1) {
      const varied = pickAmongEqual(position, moves, best, result.score, setup, rng, options.now);
      if (varied !== best) {
        emit?.({
          kind: "note",
          text: "Chose at random among the opening moves it rates as equal, so it does not replay the same game.",
        });
        return finish(varied, { depth: result.depth, nodes: result.nodes });
      }
    }

    return finish(best, { depth: result.depth, nodes: result.nodes });
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
  const scored: { move: ChessMove; ours: number; nudged: number }[] = [];

  for (const move of moves) {
    const child = applyChessMove(position, move);
    // At Beginner `childDepth` is 0, which is exactly a one-ply search: look at the
    // position this move leads to and score it, with no reply considered. Routing that
    // through the search would ask it to complete zero depths and report nothing.
    const raw =
      childDepth >= 1
        ? searchChessMove(child, {
            depth: childDepth,
            timeMs: Math.max(50, Math.floor(budgetMs / moves.length)),
            quiescence: setup.quiescence,
            now: options.now,
            history: options.history,
          }).score
        : evaluateChessPosition(child);

    const score = -raw + (rng() * 2 - 1) * setup.noiseCentipawns;
    if (emit) scored.push({ move, ours: -raw, nudged: score });
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }

  if (emit) {
    emit({
      kind: "note",
      text: `Scored all ${moves.length} legal moves, looking ${Math.max(1, setup.depth)} ahead, then added up to ±${setup.noiseCentipawns} centipawns of randomness so it does not replay the same game.`,
    });
    emit({
      kind: "candidates",
      // Ordered by the nudged score, which is what it actually chose from, but shown with
      // the honest score — so a move can sit above a better one, and that is the point.
      items: [...scored]
        .sort((left, right) => right.nudged - left.nudged)
        .slice(0, 5)
        .map((entry) => ({
          san: moveToSan(position, entry.move),
          scoreText: formatChessScore(entry.ours, position.turn, position.turn),
        })),
    });
  }
  return finish(best);
}

/**
 * How many full moves count as "the opening" for the variety rule below.
 *
 * Eight is about where a game stops being a known sequence and starts being a position
 * — early enough that varying costs nothing, late enough to make two games differ.
 */
const OPENING_MOVES = 8;

/** How far below the best a move may score and still be treated as equal to it. */
const EQUAL_MOVE_MARGIN = 10;

/**
 * Picks at random among the opening moves the search rates as equal to its best.
 *
 * Each candidate is scored by searching the position it leads to, which costs a second
 * pass over the root — acceptable because it only ever runs in the first few moves of a
 * game, where positions are cheap and the budget is nowhere near spent.
 *
 * Returns `best` unchanged if anything goes wrong or nothing ties, so the worst case is
 * the behaviour this replaced.
 */
function pickAmongEqual(
  position: ChessPosition,
  moves: readonly ChessMove[],
  best: ChessMove,
  bestScore: number,
  setup: { depth: number; timeMs: number; quiescence: boolean },
  rng: () => number,
  now?: () => number,
): ChessMove {
  // A forced mate is never "equal" to anything — take it.
  if (Math.abs(bestScore) > MATE_THRESHOLD) return best;

  const equal: ChessMove[] = [best];
  const shallow = Math.max(1, setup.depth - 2);

  for (const move of moves) {
    if (move === best) continue;
    const result = searchChessMove(applyChessMove(position, move), {
      depth: shallow,
      timeMs: Math.max(40, Math.floor(setup.timeMs / (moves.length * 2))),
      quiescence: setup.quiescence,
      now,
    });
    if (bestScore - -result.score <= EQUAL_MOVE_MARGIN) equal.push(move);
  }

  return equal[Math.floor(rng() * equal.length) % equal.length] ?? best;
}

/** Turns each finished depth into a display-ready thinking event. */
function depthReporter(
  position: ChessPosition,
  emit: (event: ChessThinkingEvent) => void,
): (progress: ChessSearchProgress) => void {
  return (progress) =>
    emit({
      kind: "depth",
      depth: progress.depth,
      san: moveToSan(position, progress.move),
      scoreText: formatChessScore(progress.score, position.turn, position.turn),
      nodes: progress.nodes,
      elapsedMs: progress.elapsedMs,
      line: describeLine(position, progress.line),
    });
}

/**
 * The principal variation in algebraic notation — the line the engine expects.
 *
 * Far more informative than the single move it was showing before: "Nf3" says what it
 * will play, while "Nf3 Nc6 Bb5" says *why*. Built by replaying the line from the
 * position it starts in, because SAN depends on what else could reach each square.
 *
 * Stops at the first move that does not fit rather than throwing. A line can come back
 * slightly stale — the table can hand back a move from a position reached another way,
 * and a 52-bit key can collide — so a short line is a normal outcome, not an error.
 */
function describeLine(from: ChessPosition, line: readonly string[]): string[] {
  const written: string[] = [];
  let position = from;

  for (const uci of line) {
    const move = findMoveByUci(position, uci);
    if (!move) break;
    written.push(moveToSan(position, move));
    position = applyChessMove(position, move);
  }
  return written;
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
  options: { now?: () => number; onEvent?: (event: ChessThinkingEvent) => void } = {},
): { move: ChessMove; score: number } | undefined {
  if (isChessGameOver(game)) return undefined;
  const advanced = CHESS_LEVEL_SETUP.advanced;
  const emit = options.onEvent;
  const now = options.now ?? Date.now;
  const startedAt = emit ? now() : 0;

  emit?.({
    kind: "start",
    label: "Hint (Advanced strength)",
    legalMoves: generateLegalMoves(game.position).length,
    depth: advanced.depth,
    budgetMs: advanced.timeMs,
    quiescence: true,
  });

  const result = searchChessMove(game.position, {
    depth: advanced.depth,
    timeMs: advanced.timeMs,
    quiescence: true,
    now: options.now,
    history: game.repetitionKeys,
    onProgress: emit && depthReporter(game.position, emit),
  });

  if (emit && result.move) {
    emit({
      kind: "chosen",
      san: moveToSan(game.position, result.move),
      elapsedMs: now() - startedAt,
      depth: result.depth,
      nodes: result.nodes,
    });
  }
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
  options: { now?: () => number; onEvent?: (event: ChessThinkingEvent) => void } = {},
): boolean {
  if (isChessGameOver(game)) return false;

  const computer = oppositeColor(game.humanColor);
  const emit = options.onEvent;

  emit?.({
    kind: "start",
    label: "Draw offer",
    legalMoves: generateLegalMoves(game.position).length,
    depth: 2,
    budgetMs: 400,
    quiescence: true,
  });

  const result = searchChessMove(game.position, {
    depth: 2,
    timeMs: 400,
    quiescence: true,
    now: options.now,
    history: game.repetitionKeys,
    onProgress: emit && depthReporter(game.position, emit),
  });

  // The search scores for whoever is to move, so it is flipped when that is the player.
  const fromComputer = game.position.turn === computer ? result.score : -result.score;
  const accepts = fromComputer < CHESS_PIECE_VALUES.n;

  emit?.({
    kind: "note",
    text: `It rates its own position ${formatChessScore(fromComputer, computer, computer)}, and accepts a draw unless that is better than about a piece (+3.2). ${accepts ? "Accepted." : "Declined."}`,
  });
  return accepts;
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
