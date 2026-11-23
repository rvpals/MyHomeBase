import { describe, expect, it } from "vitest";
import { parseFen, squareName, startPosition } from "./chess-board";
import {
  CHESS_PIECE_VALUES,
  chessHint,
  chooseChessMove,
  evaluateChessPosition,
  formatChessScore,
  isChessMateScore,
  searchChessMove,
  shouldAcceptChessDraw,
} from "./chess-bot";
import { generateLegalMoves } from "./chess-moves";
import { moveToUci } from "./chess-notation";
import { playChessMove, startChessGame } from "./game-chess";
import type { ChessGame, ChessPosition } from "./types";

function positionFrom(fen: string): ChessPosition {
  const parsed = parseFen(fen);
  expect(parsed, fen).toBeDefined();
  return parsed!;
}

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

/** A deterministic generator, so a level's randomness can be pinned in a test. */
function fixedRng(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}

/** Mate in one: Qf7-g7, protected by the king on f6. */
const MATE_IN_ONE = "7k/5Q2/5K2/8/8/8/8/8 w - - 0 1";

/**
 * White may take the pawn on d5, but it is defended by the c6 pawn — so `Qxd5??`
 * wins a pawn and loses the queen. The position that separates a search which looks
 * at recaptures from one that does not.
 */
const POISONED_PAWN = "4k3/8/2p5/3p4/8/8/8/3QK3 w - - 0 1";

/** Black to move, not in check, and with no legal move — the king on h8 is boxed in. */
const STALEMATE = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1";

describe("evaluateChessPosition", () => {
  it("scores the opening position as level", () => {
    expect(evaluateChessPosition(startPosition())).toBe(0);
  });

  it("scores from the point of view of the side to move", () => {
    // The same board, with only the side to move changed, must score as the negation
    // of itself — the property negamax depends on, and the one whose sign is easiest
    // to get wrong in one branch.
    const white = positionFrom("4k3/8/8/8/8/8/8/Q3K3 w - - 0 1");
    const black = positionFrom("4k3/8/8/8/8/8/8/Q3K3 b - - 0 1");
    expect(evaluateChessPosition(white)).toBe(-evaluateChessPosition(black));
    expect(evaluateChessPosition(white)).toBeGreaterThan(0);
  });

  it("counts a queen as worth far more than a pawn", () => {
    const queenUp = evaluateChessPosition(positionFrom("4k3/8/8/8/8/8/8/Q3K3 w - - 0 1"));
    const pawnUp = evaluateChessPosition(positionFrom("4k3/8/8/8/8/8/P7/4K3 w - - 0 1"));
    expect(queenUp).toBeGreaterThan(pawnUp * 5);
  });
});

describe("searchChessMove", () => {
  it("finds mate in one", () => {
    const result = searchChessMove(positionFrom(MATE_IN_ONE), {
      depth: 2,
      timeMs: 5_000,
      quiescence: true,
    });
    expect(result.move && moveToUci(result.move)).toBe("f7g7");
    expect(isChessMateScore(result.score)).toBe(true);
  });

  it("takes a free piece", () => {
    // An undefended queen on d5 with White to move.
    const result = searchChessMove(positionFrom("4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1"), {
      depth: 2,
      timeMs: 5_000,
      quiescence: true,
    });
    expect(result.move && squareName(result.move.to)).toBe("d5");
  });

  it("does not grab a defended pawn with its queen when it looks at recaptures", () => {
    const result = searchChessMove(positionFrom(POISONED_PAWN), {
      depth: 1,
      timeMs: 5_000,
      quiescence: true,
    });
    expect(result.move && moveToUci(result.move)).not.toBe("d1d5");
  });

  it("does grab it without quiescence, which is what makes Beginner beatable", () => {
    // The same position and the same depth, with the recapture search switched off: it
    // sees a free pawn and never sees the queen come off. This is the horizon effect,
    // and the contrast with the test above is the whole reason quiescence is a level
    // knob rather than always on.
    const result = searchChessMove(positionFrom(POISONED_PAWN), {
      depth: 1,
      timeMs: 5_000,
      quiescence: false,
    });
    expect(result.move && moveToUci(result.move)).toBe("d1d5");
  });

  it("always returns a legal move", () => {
    const position = startPosition();
    const result = searchChessMove(position, { depth: 3, timeMs: 2_000, quiescence: true });
    const legal = generateLegalMoves(position).map(moveToUci);
    expect(legal).toContain(result.move && moveToUci(result.move));
  });

  it("returns no move from a position with none", () => {
    // Stalemate: nothing legal to play, which must come back as "no move" rather than
    // throwing or offering one the rules do not allow.
    const result = searchChessMove(positionFrom(STALEMATE), {
      depth: 2,
      timeMs: 1_000,
      quiescence: true,
    });
    expect(result.move).toBeUndefined();
  });

  it("stops at the budget and still answers with a completed depth", () => {
    // A clock that jumps an hour on its second reading, so the budget is spent during
    // the search rather than by waiting for one.
    let calls = 0;
    const now = () => (calls++ === 0 ? 0 : 3_600_000);

    const result = searchChessMove(startPosition(), {
      depth: 20,
      timeMs: 1,
      quiescence: true,
      now,
    });

    // It never reached depth 20, but it still returns a legal move rather than nothing.
    expect(result.depth).toBeLessThan(20);
    expect(generateLegalMoves(startPosition()).map(moveToUci)).toContain(
      result.move && moveToUci(result.move),
    );
  });
});

describe("chooseChessMove", () => {
  it("plays a legal move at every level", () => {
    const position = startPosition();
    const legal = generateLegalMoves(position).map(moveToUci);
    for (const level of ["beginner", "intermediate", "advanced"] as const) {
      const move = chooseChessMove(position, level, { rng: fixedRng(0.99) });
      expect(legal, level).toContain(move && moveToUci(move));
    }
  }, 30_000);

  it("blunders when the dice say so, and searches when they do not", () => {
    const position = positionFrom("4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1");

    // First value decides the blunder, second picks which move. 0.0 is below
    // Beginner's 0.3 chance, so this one is a throw-away move.
    const blundered = chooseChessMove(position, "beginner", { rng: fixedRng(0, 0) });
    expect(blundered).toBeDefined();

    // 0.99 is above the chance, so it searches — and finds the free queen.
    const searched = chooseChessMove(position, "beginner", { rng: fixedRng(0.99) });
    expect(searched && squareName(searched.to)).toBe("d5");
  });

  it("never blunders at Advanced, whatever the dice say", () => {
    const position = positionFrom("4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1");
    const move = chooseChessMove(position, "advanced", { rng: fixedRng(0, 0) });
    expect(move && squareName(move.to)).toBe("d5");
  }, 30_000);

  it("plays the only move without searching at all", () => {
    // One legal move: the search would have to produce the same answer, so skipping it
    // keeps the board responsive in a forced sequence.
    const position = positionFrom("7k/8/8/8/8/8/5r2/7K w - - 0 1");
    const move = chooseChessMove(position, "advanced", { rng: fixedRng(0.99) });
    expect(move).toBeDefined();
    expect(generateLegalMoves(position)).toHaveLength(1);
  });

  it("returns nothing when there is nothing to play", () => {
    expect(
      chooseChessMove(positionFrom(STALEMATE), "beginner", {
        rng: fixedRng(0.99),
      }),
    ).toBeUndefined();
  });
});

describe("chessHint", () => {
  it("points at a winning move", () => {
    const game = startChessGame({ humanColor: "w", level: "beginner", fen: MATE_IN_ONE });
    const hint = chessHint(game);
    expect(hint && moveToUci(hint.move)).toBe("f7g7");
  }, 30_000);

  it("is silent once the game is over", () => {
    const over = play(
      startChessGame({ humanColor: "w", level: "beginner" }),
      "e2e4",
      "e7e5",
      "f1c4",
      "b8c6",
      "d1h5",
      "g8f6",
      "h5f7",
    );
    expect(chessHint(over)).toBeUndefined();
  });
});

describe("shouldAcceptChessDraw", () => {
  it("accepts in a level position", () => {
    const game = startChessGame({ humanColor: "w", level: "intermediate" });
    expect(shouldAcceptChessDraw(game)).toBe(true);
  });

  it("refuses when it is a queen up", () => {
    // The player is White and a queen down, so the computer (Black) declines.
    const game = startChessGame({
      humanColor: "w",
      level: "intermediate",
      fen: "3qk3/8/8/8/8/8/8/4K3 w - - 0 1",
    });
    expect(shouldAcceptChessDraw(game)).toBe(false);
  });

  it("accepts when it is the one losing", () => {
    const game = startChessGame({
      humanColor: "w",
      level: "intermediate",
      fen: "4k3/8/8/8/8/8/8/3QK3 w - - 0 1",
    });
    expect(shouldAcceptChessDraw(game)).toBe(true);
  });

  it("refuses on a game that has already ended", () => {
    const over = play(
      startChessGame({ humanColor: "w", level: "beginner" }),
      "e2e4",
      "e7e5",
      "f1c4",
      "b8c6",
      "d1h5",
      "g8f6",
      "h5f7",
    );
    expect(shouldAcceptChessDraw(over)).toBe(false);
  });
});

describe("formatChessScore", () => {
  it("prints pawns with a sign, from the asked-for side's view", () => {
    // 150 centipawns for White to move reads as +1.5 for White and -1.5 for Black.
    expect(formatChessScore(150, "w", "w")).toBe("+1.5");
    expect(formatChessScore(150, "b", "w")).toBe("-1.5");
    expect(formatChessScore(0, "w", "w")).toBe("+0.0");
  });

  it("prints a forced mate as a move count", () => {
    const mate = searchChessMove(positionFrom(MATE_IN_ONE), {
      depth: 2,
      timeMs: 5_000,
      quiescence: true,
    });
    expect(formatChessScore(mate.score, "w", "w")).toMatch(/^mate in \d+$/);
    expect(formatChessScore(mate.score, "b", "w")).toMatch(/^mated in \d+$/);
  });
});

describe("CHESS_PIECE_VALUES", () => {
  it("ranks the pieces in the conventional order", () => {
    const { p, n, b, r, q } = CHESS_PIECE_VALUES;
    expect(p).toBeLessThan(n);
    expect(n).toBeLessThanOrEqual(b);
    expect(b).toBeLessThan(r);
    expect(r).toBeLessThan(q);
  });
});
