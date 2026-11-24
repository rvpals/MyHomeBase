import { describe, expect, it } from "vitest";
import {
  CHESS_START_FEN,
  isLightSquare,
  parseFen,
  repetitionKey,
  squareFromName,
  squareName,
  startPosition,
  toFen,
} from "./chess-board";
import {
  applyChessMove,
  generateLegalCaptures,
  generateLegalMoves,
  isInCheck,
  isSquareAttacked,
  perft,
} from "./chess-moves";
import type { ChessPosition } from "./types";

/**
 * The engine's correctness test.
 *
 * Most of it is **perft**: the published number of distinct positions reachable in
 * exactly N plies from a known position. These six positions are the standard set, and
 * between them they exercise every rule a hand-written move generator gets wrong —
 * castling through an attacked square, the en-passant capture that exposes a rank, a
 * pinned piece's "capture" that is not legal, promotion under check.
 *
 * A perft number is all-or-nothing: being one position out at depth 3 means a rule is
 * wrong somewhere, and the depth it first disagrees at says how deep to look. That is
 * worth far more than a dozen hand-written cases, because it catches the rules nobody
 * remembered to write a case for.
 *
 * Depths are chosen to stay quick. The full set runs to depth 5+ in a dedicated engine
 * suite; a unit test that takes a minute would stop being run.
 */

function positionFrom(fen: string): ChessPosition {
  const parsed = parseFen(fen);
  expect(parsed, `FEN should parse: ${fen}`).toBeDefined();
  return parsed!;
}

const KIWIPETE = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";
const ENDGAME = "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1";
const PROMOTIONS = "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1";
const MIDDLEGAME = "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8";
const QUIET = "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10";

describe("squares", () => {
  it("names the corners", () => {
    expect(squareName(0)).toBe("a8");
    expect(squareName(7)).toBe("h8");
    expect(squareName(56)).toBe("a1");
    expect(squareName(63)).toBe("h1");
  });

  it("round-trips every square through its name", () => {
    for (let square = 0; square < 64; square += 1) {
      expect(squareFromName(squareName(square))).toBe(square);
    }
  });

  it("rejects text that does not name a square", () => {
    expect(squareFromName("j1")).toBe(-1);
    expect(squareFromName("a9")).toBe(-1);
    expect(squareFromName("")).toBe(-1);
    expect(squareFromName("e4e5")).toBe(-1);
  });

  it("knows a1 and h8 are dark and a8 and h1 are light", () => {
    // The board's one orientation rule: the right-hand corner nearest White is light.
    expect(isLightSquare(squareFromName("h1"))).toBe(true);
    expect(isLightSquare(squareFromName("a8"))).toBe(true);
    expect(isLightSquare(squareFromName("a1"))).toBe(false);
    expect(isLightSquare(squareFromName("h8"))).toBe(false);
  });
});

describe("FEN", () => {
  it("round-trips the starting position", () => {
    expect(toFen(startPosition())).toBe(CHESS_START_FEN);
  });

  it("round-trips every test position", () => {
    for (const fen of [KIWIPETE, ENDGAME, PROMOTIONS, MIDDLEGAME, QUIET]) {
      expect(toFen(positionFrom(fen))).toBe(fen);
    }
  });

  it("defaults the two counters when they are left off", () => {
    const parsed = positionFrom("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -");
    expect(parsed.halfmoveClock).toBe(0);
    expect(parsed.fullmoveNumber).toBe(1);
  });

  it("refuses a malformed FEN rather than throwing", () => {
    // Each of these is a shape a stored save or a pasted string could really have, and
    // every one must come back undefined so the caller can report it.
    expect(parseFen("")).toBeUndefined();
    expect(parseFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq -")).toBeUndefined();
    expect(parseFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq -")).toBeUndefined();
    // A rank describing nine squares: the kind of damage that would otherwise shift
    // every rank below it and produce a plausible-looking wrong board.
    expect(parseFen("rnbqkbnrr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -")).toBeUndefined();
    expect(parseFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq z9")).toBeUndefined();
  });

  it("ignores an en-passant square no pawn can actually take", () => {
    /*
      FEN records the square after any double step. Two positions that differ only by
      an ep square nobody can use are the same position for repetition, and treating
      them as different is what made a threefold draw arrive a cycle late.
    */
    const withEp = positionFrom("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
    const without = positionFrom("4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1");
    // The e5 pawn *can* take on d6, so here the square is real and must be kept.
    expect(repetitionKey(withEp)).not.toBe(repetitionKey(without));

    const noTaker = positionFrom("4k3/8/8/3p4/8/8/8/4K3 w - d6 0 1");
    const noTakerPlain = positionFrom("4k3/8/8/3p4/8/8/8/4K3 w - - 0 1");
    // No white pawn beside it, so the square changes nothing and is dropped.
    expect(repetitionKey(noTaker)).toBe(repetitionKey(noTakerPlain));
  });

  it("drops the two counters from a repetition key", () => {
    // Two positions identical but for the clocks must share a key, or no game could
    // ever repeat a position three times.
    const early = positionFrom(`${CHESS_START_FEN}`);
    const later = positionFrom("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 7 12");
    expect(repetitionKey(early)).toBe(repetitionKey(later));
    expect(repetitionKey(early)).not.toContain(" 0 1");
  });
});

describe("perft", () => {
  it("counts the starting position to depth 4", () => {
    const start = startPosition();
    expect(perft(start, 1)).toBe(20);
    expect(perft(start, 2)).toBe(400);
    expect(perft(start, 3)).toBe(8_902);
    expect(perft(start, 4)).toBe(197_281);
  }, 30_000);

  it("counts Kiwipete to depth 3", () => {
    // The standard castling and en-passant torture position.
    const position = positionFrom(KIWIPETE);
    expect(perft(position, 1)).toBe(48);
    expect(perft(position, 2)).toBe(2_039);
    expect(perft(position, 3)).toBe(97_862);
  }, 30_000);

  it("counts the rook endgame to depth 4", () => {
    // The position whose whole point is the en-passant capture that would expose the
    // king along the fourth rank — illegal, and counted wrong by any generator that
    // treats en passant as an ordinary pawn capture.
    const position = positionFrom(ENDGAME);
    expect(perft(position, 1)).toBe(14);
    expect(perft(position, 2)).toBe(191);
    expect(perft(position, 3)).toBe(2_812);
    expect(perft(position, 4)).toBe(43_238);
  }, 30_000);

  it("counts the promotion position to depth 3", () => {
    const position = positionFrom(PROMOTIONS);
    expect(perft(position, 1)).toBe(6);
    expect(perft(position, 2)).toBe(264);
    expect(perft(position, 3)).toBe(9_467);
  }, 30_000);

  it("counts the middlegame position to depth 3", () => {
    const position = positionFrom(MIDDLEGAME);
    expect(perft(position, 1)).toBe(44);
    expect(perft(position, 2)).toBe(1_486);
    expect(perft(position, 3)).toBe(62_379);
  }, 30_000);

  it("counts the quiet position to depth 3", () => {
    const position = positionFrom(QUIET);
    expect(perft(position, 1)).toBe(46);
    expect(perft(position, 2)).toBe(2_079);
    expect(perft(position, 3)).toBe(89_890);
  }, 30_000);
});

describe("generateLegalMoves", () => {
  it("offers twenty moves from the opening position", () => {
    expect(generateLegalMoves(startPosition())).toHaveLength(20);
  });

  it("will not move a pinned piece off the pin", () => {
    // White knight on e2 is pinned to the king on e1 by the rook on e8.
    const position = positionFrom("4r3/8/8/8/8/8/4N3/4K3 w - - 0 1");
    const knightMoves = generateLegalMoves(position).filter(
      (move) => move.from === squareFromName("e2"),
    );
    expect(knightMoves).toHaveLength(0);
  });

  it("allows a pinned piece to capture the pinner", () => {
    // A bishop pinned along the diagonal may still take what is pinning it.
    const position = positionFrom("7k/8/8/8/4b3/8/2B5/1K6 w - - 0 1");
    const captures = generateLegalMoves(position).filter(
      (move) => move.from === squareFromName("c2") && move.to === squareFromName("e4"),
    );
    expect(captures).toHaveLength(1);
  });

  it("leaves only the moves that answer a check", () => {
    // Black king on h8, White queen on h1 giving check down the file. The only answers
    // are the king stepping off the file; nothing can block or capture.
    const position = positionFrom("7k/8/8/8/8/8/8/K6Q b - - 0 1");
    expect(isInCheck(position)).toBe(true);
    const moves = generateLegalMoves(position);
    expect(moves.map((move) => squareName(move.to)).sort()).toEqual(["g7", "g8"]);
  });

  it("promotes to four pieces, not one", () => {
    const position = positionFrom("8/4P3/8/8/8/8/8/K6k w - - 0 1");
    const promotions = generateLegalMoves(position).filter((move) => move.promotion);
    expect(promotions.map((move) => move.promotion).sort()).toEqual(["b", "n", "q", "r"]);
  });

  it("castles both ways when the path is clear", () => {
    const position = positionFrom("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    const castles = generateLegalMoves(position).filter((move) => move.isCastle);
    expect(castles.map((move) => move.isCastle).sort()).toEqual(["k", "q"]);
  });

  it("refuses to castle through an attacked square", () => {
    // A black rook on f8 attacks f1, which the king must cross to castle king-side.
    // Queen-side is untouched, which is the half of the rule that is easy to over-apply.
    const position = positionFrom("5r2/8/8/8/8/8/8/R3K2R w KQ - 0 1");
    const castles = generateLegalMoves(position).filter((move) => move.isCastle);
    expect(castles.map((move) => move.isCastle)).toEqual(["q"]);
  });

  it("refuses to castle out of check", () => {
    const position = positionFrom("4r3/8/8/8/8/8/8/R3K2R w KQ - 0 1");
    expect(isInCheck(position)).toBe(true);
    expect(generateLegalMoves(position).filter((move) => move.isCastle)).toHaveLength(0);
  });

  it("still castles queen-side when only b1 is attacked", () => {
    // b1 must be empty but the king never crosses it, so a rook bearing on b1 does not
    // stop the castle. The mirror of the test above, and the easier half to get wrong.
    const position = positionFrom("1r6/8/8/8/8/8/8/R3K2R w KQ - 0 1");
    const castles = generateLegalMoves(position).filter((move) => move.isCastle);
    expect(castles.map((move) => move.isCastle).sort()).toEqual(["k", "q"]);
  });
});

describe("applyChessMove", () => {
  it("moves the rook when the king castles", () => {
    const position = positionFrom("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    const castle = generateLegalMoves(position).find((move) => move.isCastle === "k")!;
    const after = applyChessMove(position, castle);

    expect(after.board[squareFromName("g1")]).toEqual({ type: "k", color: "w" });
    expect(after.board[squareFromName("f1")]).toEqual({ type: "r", color: "w" });
    expect(after.board[squareFromName("h1")]).toBeNull();
    expect(after.board[squareFromName("e1")]).toBeNull();
    // Castling ends both of that side's rights, not just the wing used.
    expect(after.castling.wk).toBe(false);
    expect(after.castling.wq).toBe(false);
    expect(after.castling.bk).toBe(true);
  });

  it("ends a castling right when the rook is captured on its own square", () => {
    // The half of the rule that is usually missed: the rook never moved, it was taken.
    const position = positionFrom("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    const takeRook = generateLegalMoves(position).find(
      (move) => move.from === squareFromName("a1") && move.to === squareFromName("a8"),
    )!;
    expect(applyChessMove(position, takeRook).castling.bq).toBe(false);
  });

  it("removes the pawn beside the mover on an en-passant capture", () => {
    const position = positionFrom("8/8/8/3pP3/8/8/8/K6k w - d6 0 1");
    const enPassant = generateLegalMoves(position).find((move) => move.isEnPassant)!;

    const after = applyChessMove(position, enPassant);
    expect(after.board[squareFromName("d6")]).toEqual({ type: "p", color: "w" });
    // The captured pawn stood on d5, not on the square the capturer moved to.
    expect(after.board[squareFromName("d5")]).toBeNull();
    expect(after.board[squareFromName("e5")]).toBeNull();
  });

  it("sets the en-passant square only after a double step", () => {
    const start = startPosition();
    const double = generateLegalMoves(start).find(
      (move) => move.from === squareFromName("e2") && move.to === squareFromName("e4"),
    )!;
    const single = generateLegalMoves(start).find(
      (move) => move.from === squareFromName("e2") && move.to === squareFromName("e3"),
    )!;

    expect(applyChessMove(start, double).enPassant).toBe(squareFromName("e3"));
    expect(applyChessMove(start, single).enPassant).toBeNull();
  });

  it("clears a stale en-passant square on the next move", () => {
    const position = positionFrom("8/8/8/3pP3/8/8/8/K6k w - d6 0 1");
    const quiet = generateLegalMoves(position).find(
      (move) => move.from === squareFromName("a1"),
    )!;
    expect(applyChessMove(position, quiet).enPassant).toBeNull();
  });

  it("resets the halfmove clock on a capture or a pawn move and not otherwise", () => {
    const position = positionFrom("4k3/8/8/3p4/4P3/8/8/4K3 w - - 9 20");
    const moves = generateLegalMoves(position);

    const capture = moves.find((move) => move.captured)!;
    const pawnPush = moves.find((move) => move.piece === "p" && !move.captured)!;
    const kingStep = moves.find((move) => move.piece === "k")!;

    expect(applyChessMove(position, capture).halfmoveClock).toBe(0);
    expect(applyChessMove(position, pawnPush).halfmoveClock).toBe(0);
    expect(applyChessMove(position, kingStep).halfmoveClock).toBe(10);
  });

  it("advances the full-move number only after Black moves", () => {
    const white = positionFrom("4k3/8/8/8/8/8/8/4K3 w - - 0 7");
    const afterWhite = applyChessMove(white, generateLegalMoves(white)[0]!);
    expect(afterWhite.fullmoveNumber).toBe(7);

    const afterBlack = applyChessMove(afterWhite, generateLegalMoves(afterWhite)[0]!);
    expect(afterBlack.fullmoveNumber).toBe(8);
  });

  it("does not mutate the position it was given", () => {
    const start = startPosition();
    const before = toFen(start);
    applyChessMove(start, generateLegalMoves(start)[0]!);
    expect(toFen(start)).toBe(before);
  });
});

describe("isSquareAttacked", () => {
  it("sees a pawn attacking diagonally and not straight ahead", () => {
    const position = positionFrom("8/8/8/8/4P3/8/8/K6k w - - 0 1");
    expect(isSquareAttacked(position.board, squareFromName("d5"), "w")).toBe(true);
    expect(isSquareAttacked(position.board, squareFromName("f5"), "w")).toBe(true);
    // The square a pawn moves to is not a square it attacks — the distinction that
    // decides whether a king may stand in front of a pawn.
    expect(isSquareAttacked(position.board, squareFromName("e5"), "w")).toBe(false);
  });

  it("stops a slider at the first piece in its way", () => {
    const position = positionFrom("8/8/8/8/R2p3k/8/8/K7 w - - 0 1");
    expect(isSquareAttacked(position.board, squareFromName("d4"), "w")).toBe(true);
    expect(isSquareAttacked(position.board, squareFromName("e4"), "w")).toBe(false);
  });
});

describe("generateLegalCaptures", () => {
  it("keeps only captures and promotions", () => {
    const position = positionFrom("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1");
    const captures = generateLegalCaptures(position);
    expect(captures).toHaveLength(1);
    expect(squareName(captures[0]!.to)).toBe("d5");
  });

  it("counts a quiet promotion as worth searching", () => {
    // Promotion changes the material on the board as surely as a capture does, so a
    // quiescence search that ignored it would stop on a position about to gain a queen.
    const position = positionFrom("8/4P3/8/8/8/8/8/K6k w - - 0 1");
    expect(generateLegalCaptures(position).length).toBeGreaterThan(0);
  });
});
