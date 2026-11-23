/// <reference lib="webworker" />

import { chooseChessMove, moveToUci, parseFen, type ChessLevel } from "@/lib/games";

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
 */

export interface ChessWorkerRequest {
  /** Echoed back, so a reply from a position the player has since left is discarded. */
  id: number;
  fen: string;
  level: ChessLevel;
}

export interface ChessWorkerReply {
  id: number;
  /** The chosen move in coordinate form, or undefined when there is none to make. */
  uci?: string;
  /** Set when the position could not even be read. */
  error?: string;
}

/*
  Reached through `globalThis` rather than `self`.

  This file is compiled with the project's DOM lib as well as the webworker one above,
  so `self` is typed as a `Window` — which has no `postMessage(message)` of this shape
  — and redeclaring it collides with the DOM's own declaration. Casting `globalThis`
  once is the narrowest way through, and it keeps the cast in one place instead of at
  every call.
*/
const worker = globalThis as unknown as DedicatedWorkerGlobalScope;

worker.addEventListener("message", (event: MessageEvent<ChessWorkerRequest>) => {
  const { id, fen, level } = event.data;

  try {
    const position = parseFen(fen);
    if (!position) {
      worker.postMessage({
        id,
        error: "That position could not be read.",
      } satisfies ChessWorkerReply);
      return;
    }

    const move = chooseChessMove(position, level);
    worker.postMessage({ id, uci: move ? moveToUci(move) : undefined } satisfies ChessWorkerReply);
  } catch (error) {
    // Never let the worker die silently: the view would wait for a reply that is never
    // coming, and the board would sit on "Thinking…" for ever.
    worker.postMessage({
      id,
      error: error instanceof Error ? error.message : "The computer could not move.",
    } satisfies ChessWorkerReply);
  }
});
