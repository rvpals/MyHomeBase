import { describe, expect, it } from "vitest";
import { CHESS_START_FEN, toFen } from "./chess-board";
import {
  CHESS_PUZZLES,
  findChessPuzzle,
  importChessFen,
  importChessPgn,
  looksLikeChessPgn,
} from "./chess-import";
import { generateLegalMoves } from "./chess-moves";
import { gameToPgn } from "./chess-notation";
import { playChessMove, startChessGame } from "./game-chess";
import type { ChessGame } from "./types";

function play(game: ChessGame, ...moves: string[]): ChessGame {
  let current = game;
  for (const uci of moves) {
    const result = playChessMove(current, uci);
    expect(result.ok, uci).toBe(true);
    if (!result.ok) return current;
    current = result.game;
  }
  return current;
}

describe("importChessFen", () => {
  it("starts a game from a position", () => {
    const result = importChessFen("4k3/8/8/8/8/8/8/4K2R w K - 0 1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.game.position.turn).toBe("w");
    expect(result.game.position.castling.wk).toBe(true);
  });

  it("gives the player the side to move, which is what a puzzle wants", () => {
    const result = importChessFen("4k3/8/8/8/8/8/8/4K2R b - - 0 1");
    expect(result.ok && result.game.humanColor).toBe("b");
  });

  it("fills in counters a short FEN left off", () => {
    const result = importChessFen("4k3/8/8/8/8/8/8/4K3 w - -");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toFen(result.game.position)).toBe("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
  });

  it("refuses text that is not a position", () => {
    for (const bad of ["", "   ", "hello", "rnbq/8 w"]) {
      expect(importChessFen(bad).ok, bad).toBe(false);
    }
  });

  it("refuses a position with a king missing", () => {
    // A diagram, not a game: nothing could be checkmated and the rules would have
    // nothing to enforce.
    const result = importChessFen("8/8/8/8/8/8/8/4K3 w - - 0 1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/king/i);
  });

  it("refuses a position with no legal move", () => {
    const result = importChessFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    expect(result.ok).toBe(false);
  });
});

describe("importChessPgn", () => {
  it("round-trips a game this app exported", () => {
    // The pair that matters most: anything written by `gameToPgn` must come back.
    const original = play(
      startChessGame({ humanColor: "w", level: "intermediate" }),
      "e2e4",
      "e7e5",
      "g1f3",
      "b8c6",
      "f1b5",
    );
    const result = importChessPgn(gameToPgn(original, { date: "2026.11.24" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.game.moves.map((move) => move.san)).toEqual(
      original.moves.map((move) => move.san),
    );
    expect(toFen(result.game.position)).toBe(toFen(original.position));
  });

  it("reads a plain movetext with no headers", () => {
    const result = importChessPgn("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.game.moves).toHaveLength(6);
    expect(result.game.moves.at(-1)?.san).toBe("a6");
  });

  it("takes the result token in its stride", () => {
    expect(importChessPgn("1. e4 e5 1-0").ok).toBe(true);
    expect(importChessPgn("1. e4 e5 1/2-1/2").ok).toBe(true);
    expect(importChessPgn("1. e4 e5 *").ok).toBe(true);
  });

  it("ignores comments, variations and annotation glyphs", () => {
    // None of these is a move that was played, and a variation has nowhere to go in a
    // single game.
    const result = importChessPgn(
      "1. e4 {a good start} e5 $1 2. Nf3 (2. Bc4 Nf6) Nc6 ; trailing note\n3. Bb5",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.game.moves.map((move) => move.san)).toEqual([
      "e4",
      "e5",
      "Nf3",
      "Nc6",
      "Bb5",
    ]);
  });

  it("ignores nested variations", () => {
    const result = importChessPgn("1. e4 e5 (1... c5 (1... e6 2. d4) 2. Nf3) 2. Nf3");
    expect(result.ok && result.game.moves.map((move) => move.san)).toEqual(["e4", "e5", "Nf3"]);
  });

  it("accepts a move written without its check mark", () => {
    // Plenty of real exporters leave them off, and a game should not fail to import
    // over a missing "+".
    const withMark = importChessPgn("1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#");
    const without = importChessPgn("1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7");
    expect(withMark.ok).toBe(true);
    expect(without.ok).toBe(true);
    if (!withMark.ok || !without.ok) return;
    expect(toFen(without.game.position)).toBe(toFen(withMark.game.position));
  });

  it("accepts castling written with zeros", () => {
    const result = importChessPgn("1. e4 e5 2. Nf3 Nf6 3. Bc4 Bc5 4. 0-0 0-0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.game.moves.at(-1)?.san).toBe("O-O");
  });

  it("starts from a FEN header when the game did not start from the opening", () => {
    const result = importChessPgn(
      '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/4K2R w K - 0 1"]\n\n1. Rh8+',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.game.initialFen).toBe("4k3/8/8/8/8/8/8/4K2R w K - 0 1");
    expect(result.game.moves.at(-1)?.san).toBe("Rh8+");
  });

  it("keeps the headers it read", () => {
    const result = importChessPgn('[White "Ada"]\n[Black "Grace"]\n\n1. e4 e5');
    expect(result.ok && result.headers).toMatchObject({ White: "Ada", Black: "Grace" });
  });

  it("names the move that would not play", () => {
    // Better than importing a shorter game than the file describes and saying nothing.
    // The white queen on d1 has no way to h6, so the third token names no legal move.
    const result = importChessPgn("1. e4 e5 2. Qh6");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Qh6");
  });

  it("refuses an empty or move-less game", () => {
    expect(importChessPgn("").ok).toBe(false);
    expect(importChessPgn('[Event "Nothing"]').ok).toBe(false);
  });

  it("refuses moves recorded after the game ended", () => {
    const result = importChessPgn("1. f3 e5 2. g4 Qh4# 3. e4");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/ends before/i);
  });
});

describe("looksLikeChessPgn", () => {
  it("tells a game from a position", () => {
    expect(looksLikeChessPgn('[Event "x"]\n1. e4')).toBe(true);
    expect(looksLikeChessPgn("1. e4 e5")).toBe(true);
    expect(looksLikeChessPgn(CHESS_START_FEN)).toBe(false);
    expect(looksLikeChessPgn("4k3/8/8/8/8/8/8/4K2R w K - 0 1")).toBe(false);
  });
});

describe("CHESS_PUZZLES", () => {
  it("every puzzle is a position the rules can read and play from", () => {
    expect(CHESS_PUZZLES.length).toBeGreaterThan(0);
    for (const puzzle of CHESS_PUZZLES) {
      const result = importChessFen(puzzle.fen);
      expect(result.ok, `${puzzle.id}: ${puzzle.fen}`).toBe(true);
      if (!result.ok) continue;
      expect(generateLegalMoves(result.game.position).length, puzzle.id).toBeGreaterThan(0);
      expect(puzzle.goal.length, puzzle.id).toBeGreaterThan(10);
    }
  });

  it("has a mate in one in the back-rank puzzle", () => {
    // The one puzzle whose claim is checkable without solving: Ra8 is mate.
    const puzzle = findChessPuzzle("back-rank")!;
    const result = importChessFen(puzzle.fen);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const mated = playChessMove(result.game, "a1a8");
    expect(mated.ok).toBe(true);
    if (!mated.ok) return;
    expect(mated.game.status).toBe("checkmate");
  });

  it("gives every puzzle its own id", () => {
    const ids = CHESS_PUZZLES.map((puzzle) => puzzle.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("finds nothing for an id that is not a puzzle", () => {
    expect(findChessPuzzle("nope")).toBeUndefined();
  });
});
