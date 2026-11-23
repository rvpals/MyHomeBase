/// <reference lib="webworker" />

import {
  chooseChessMove,
  moveToUci,
  parseFen,
  type ChessLevel,
  type ChessThinkingEvent,
} from "@/lib/games";

/**
 * The computer's move, worked out off the main thread.
 *
 * Advanced is allowed two and a half seconds of search, and that is two and a half
 * seconds during which a main-thread engine would freeze the page: the board would not
 * repaint, the "Thinking…" line would never appear, and nothing — not Resign, not
 * closing the dialog — would respond. A worker makes the wait ordinary.
 *
 * It is a **thin shim and nothing more**. Every rule, the search and the level
 * behaviour are `src/lib/games/chess-bot.ts`, called here exactly as the view would
 * call it, so the engine cannot behave differently depending on which thread it ran
 * on — and so the main-thread fallback in `game-chess-view.tsx` is the same engine
 * rather than a second, simpler one.
 *
 * It takes a FEN rather than a game, because a position is all the search needs and a
 * FEN is a string — no structured clone of a 64-element board per move.
 *
 * **Narration is opt-in.** `log` is true only while the Messages panel's "See machine
 * log" switch is on; with it off no listener is handed to the engine, so no event is
 * built and no progress message is posted. Events are posted *while the search runs* —
 * a worker's `postMessage` is delivered immediately, even from inside synchronous
 * code — which is what lets the panel show the search deepening in real time.
 */

export interface ChessWorkerRequest {
  /** Echoed back, so a reply from a position the player has since left is discarded. */
  id: number;
  fen: string;
  level: ChessLevel;
  /** Whether to narrate the search. Off means nothing is built or posted. */
  log?: boolean;
}

/** A progress line, posted while the search is still running. */
export interface ChessWorkerProgress {
  id: number;
  event: ChessThinkingEvent;
}

/** The final answer. `done` is what tells it apart from a progress line. */
export interface ChessWorkerReply {
  id: number;
  done: true;
  /** The chosen move in coordinate form, or undefined when there is none to make. */
  uci?: string;
  /** Set when the position could not even be read. */
  error?: string;
}

export type ChessWorkerMessage = ChessWorkerProgress | ChessWorkerReply;

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
  const { id, fen, level, log } = event.data;

  try {
    const position = parseFen(fen);
    if (!position) {
      post({ id, done: true, error: "That position could not be read." });
      return;
    }

    const move = chooseChessMove(position, level, {
      onEvent: log ? (thinking) => post({ id, event: thinking }) : undefined,
    });
    post({ id, done: true, uci: move ? moveToUci(move) : undefined });
  } catch (error) {
    // Never let the worker die silently: the view would wait for a reply that is never
    // coming, and the board would sit on "Thinking…" for ever.
    post({
      id,
      done: true,
      error: error instanceof Error ? error.message : "The computer could not move.",
    });
  }
});
