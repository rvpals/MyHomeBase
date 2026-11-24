/// <reference lib="webworker" />

import {
  analyseChessGame,
  chessHint,
  chooseChessMove,
  moveToUci,
  parseFen,
  restoreChessGame,
  shouldAcceptChessDraw,
  startChessGame,
  toFen,
  type ChessAnalysis,
  type ChessAnalysisSpeed,
  type ChessColor,
  type ChessLevel,
  type ChessSave,
  type ChessThinkingEvent,
} from "@/lib/games";

/**
 * The engine, off the main thread. Two jobs: pick a move, and analyse a finished game.
 *
 * Both are here because both are long synchronous searches that would otherwise freeze
 * the page — Advanced thinks for up to two and a half seconds, and a careful analysis
 * of a long game runs for a minute. A worker makes both waits ordinary, and lets the
 * second one report progress and be cancelled.
 *
 * It is a **thin shim and nothing more**. Every rule, the search, the level behaviour
 * and the analysis are `src/lib/games`, called here exactly as the view would call
 * them, so nothing can behave differently depending on which thread it ran on — and so
 * the main-thread fallbacks in the views are the same code rather than a second,
 * simpler one.
 *
 * **Cancelling an analysis is done by terminating the worker**, which is why the view
 * gives analysis its own short-lived instance rather than sharing the one that answers
 * moves. A worker cannot receive a message in the middle of a synchronous loop, so
 * there is no cooperative stop to send it.
 */

/** Pick a move for a position. */
export interface ChessMoveRequest {
  kind: "move";
  /** Echoed back, so a reply from a position the player has since left is discarded. */
  id: number;
  fen: string;
  level: ChessLevel;
  /** Whether to narrate the search. Off means nothing is built or posted. */
  log?: boolean;
  /**
   * How long it may think, overriding the level's own budget. Sent by a clocked game so
   * the computer rations what is left instead of flagging itself; absent in an untimed
   * one, where the level's budget stands.
   */
  budgetMs?: number;
  /**
   * The positions already played, so the search can see a repetition coming.
   *
   * Sent with the move rather than derived here: the worker is given a FEN, which is
   * one position and knows nothing about how the game reached it.
   */
  history?: string[];
}

/**
 * Analyse a whole game.
 *
 * Carries a `ChessSave` rather than a `ChessGame`: a save is already the plain,
 * structured-cloneable shape of a game — a FEN and a list of moves — where a live game
 * holds a 64-element board of objects. The worker replays it through the rules, which
 * also means a tampered move list is refused here exactly as it is on load.
 */
export interface ChessAnalyseRequest {
  kind: "analyse";
  id: number;
  save: ChessSave;
  speed: ChessAnalysisSpeed;
}

/**
 * Advise the player, or answer their draw offer.
 *
 * Both were run on the main thread and both searched at Advanced strength, so both
 * froze the page for up to two and a half seconds — which is the exact thing the
 * worker exists to prevent, and it also meant their machine-log lines all arrived in
 * one burst at the end instead of as the search deepened.
 *
 * They take a FEN plus the player's colour rather than a game, for the reason a move
 * request does: a position is all the search needs, and a FEN is a string.
 */
export interface ChessAdviceRequest {
  kind: "advice";
  id: number;
  /** `hint` advises the player; `draw` decides whether the computer accepts. */
  job: "hint" | "draw";
  fen: string;
  humanColor: ChessColor;
  log?: boolean;
}

export type ChessWorkerRequest = ChessMoveRequest | ChessAnalyseRequest | ChessAdviceRequest;

/** A line of the machine log, posted while a search is still running. */
export interface ChessThinkingMessage {
  kind: "thinking";
  id: number;
  event: ChessThinkingEvent;
}

/** The answer to a move request. */
export interface ChessMoveMessage {
  kind: "move";
  id: number;
  /** The chosen move in coordinate form, or undefined when there is none to make. */
  uci?: string;
  /** Set when the position could not even be read. */
  error?: string;
}

/** The answer to an advice request. */
export interface ChessAdviceMessage {
  kind: "advice";
  id: number;
  /** For `hint`: the move advised, in coordinate form. */
  uci?: string;
  /** For `draw`: whether the computer accepts. */
  accept?: boolean;
  error?: string;
}

/** How far an analysis has got, posted after each position is scored. */
export interface ChessAnalysisProgressMessage {
  kind: "analysis-progress";
  id: number;
  scored: number;
  total: number;
}

/** The finished analysis. */
export interface ChessAnalysisMessage {
  kind: "analysis";
  id: number;
  analysis?: ChessAnalysis;
  error?: string;
}

export type ChessWorkerMessage =
  | ChessThinkingMessage
  | ChessMoveMessage
  | ChessAdviceMessage
  | ChessAnalysisProgressMessage
  | ChessAnalysisMessage;

/*
  Reached through `globalThis` rather than `self`.

  This file is compiled with the project's DOM lib as well as the webworker one above,
  so `self` is typed as a `Window` — which has no `postMessage(message)` of this shape
  — and redeclaring it collides with the DOM's own declaration. Casting `globalThis`
  once is the narrowest way through, and it keeps the cast in one place instead of at
  every call.
*/
const worker = globalThis as unknown as DedicatedWorkerGlobalScope;

function post(message: ChessWorkerMessage): void {
  worker.postMessage(message);
}

worker.addEventListener("message", (event: MessageEvent<ChessWorkerRequest>) => {
  const request = event.data;

  try {
    if (request.kind === "analyse") {
      runAnalysis(request);
      return;
    }
    if (request.kind === "advice") {
      runAdvice(request);
      return;
    }
    runMove(request);
  } catch (error) {
    // Never let the worker die silently: the view would wait for an answer that is
    // never coming, and the screen would sit on "Thinking…" or a stuck progress bar.
    const message = error instanceof Error ? error.message : "The engine could not finish.";
    if (request.kind === "analyse") post({ kind: "analysis", id: request.id, error: message });
    else if (request.kind === "advice") post({ kind: "advice", id: request.id, error: message });
    else post({ kind: "move", id: request.id, error: message });
  }
});

function runMove(request: ChessMoveRequest): void {
  const position = parseFen(request.fen);
  if (!position) {
    post({ kind: "move", id: request.id, error: "That position could not be read." });
    return;
  }

  const move = chooseChessMove(position, request.level, {
    onEvent: request.log
      ? (thinking) => post({ kind: "thinking", id: request.id, event: thinking })
      : undefined,
    timeBudgetMs: request.budgetMs,
    history: request.history,
  });
  post({ kind: "move", id: request.id, uci: move ? moveToUci(move) : undefined });
}

function runAdvice(request: ChessAdviceRequest): void {
  const position = parseFen(request.fen);
  if (!position) {
    post({ kind: "advice", id: request.id, error: "That position could not be read." });
    return;
  }

  /*
    Both calls want a `ChessGame`, and all they read from it is the position and the
    player's colour — so one is built around this position rather than the whole game
    being shipped across. The level is irrelevant to either: a hint always searches at
    Advanced strength, and a draw offer at a fixed shallow depth.
  */
  const game = startChessGame({
    humanColor: request.humanColor,
    level: "advanced",
    fen: toFen(position),
  });

  const onEvent = request.log
    ? (thinking: ChessThinkingEvent) => post({ kind: "thinking", id: request.id, event: thinking })
    : undefined;

  if (request.job === "draw") {
    post({ kind: "advice", id: request.id, accept: shouldAcceptChessDraw(game, { onEvent }) });
    return;
  }

  const advice = chessHint(game, { onEvent });
  post({ kind: "advice", id: request.id, uci: advice ? moveToUci(advice.move) : undefined });
}

function runAnalysis(request: ChessAnalyseRequest): void {
  const restored = restoreChessGame(request.save);
  if (!restored.ok) {
    post({ kind: "analysis", id: request.id, error: restored.reason });
    return;
  }

  const analysis = analyseChessGame(restored.game, {
    speed: request.speed,
    onProgress: (scored, total) =>
      post({ kind: "analysis-progress", id: request.id, scored, total }),
  });
  post({ kind: "analysis", id: request.id, analysis });
}
