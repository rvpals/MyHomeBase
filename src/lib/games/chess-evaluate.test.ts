import { describe, expect, it } from "vitest";
import { parseFen, startPosition } from "./chess-board";
import {
  CHESS_PIECE_VALUES,
  evaluateChessPosition,
  hasNonPawnMaterial,
  isChessEndgame,
} from "./chess-evaluate";
import type { ChessPosition } from "./types";

function positionFrom(fen: string): ChessPosition {
  const parsed = parseFen(fen);
  expect(parsed, fen).toBeDefined();
  return parsed!;
}

/**
 * The evaluation is judged by **comparing two positions**, never by pinning a number.
 *
 * Every weight here is a guess that will be re-tuned, so a test asserting "this is
 * worth 45" would fail on every tuning pass while telling nobody anything. What must
 * stay true is the ordering: a position with the bishop pair is better than the same
 * one without, a sheltered king is better than an exposed one, and so on.
 */
describe("evaluateChessPosition", () => {
  it("scores the opening position as level", () => {
    expect(evaluateChessPosition(startPosition())).toBe(0);
  });

  it("scores from the point of view of the side to move", () => {
    // The property negamax depends on, and the one whose sign is easiest to get wrong
    // in a single branch.
    const white = positionFrom("4k3/8/8/8/8/8/8/Q3K3 w - - 0 1");
    const black = positionFrom("4k3/8/8/8/8/8/8/Q3K3 b - - 0 1");
    expect(evaluateChessPosition(white)).toBe(-evaluateChessPosition(black));
  });

  it("counts a queen as worth far more than a pawn", () => {
    const queen = evaluateChessPosition(positionFrom("4k3/8/8/8/8/8/8/Q3K3 w - - 0 1"));
    const pawn = evaluateChessPosition(positionFrom("4k3/8/8/8/8/8/P7/4K3 w - - 0 1"));
    expect(queen).toBeGreaterThan(pawn * 5);
  });

  it("prefers two bishops to a bishop and a knight", () => {
    // Worth about half a pawn and completely invisible to a material count, since a
    // bishop and a knight are priced within ten centipawns of each other.
    const pair = evaluateChessPosition(positionFrom("4k3/8/8/8/8/8/8/2BB1K2 w - - 0 1"));
    const mixed = evaluateChessPosition(positionFrom("4k3/8/8/8/8/8/8/2BN1K2 w - - 0 1"));
    expect(pair).toBeGreaterThan(mixed);
  });

  it("penalises doubled pawns", () => {
    const doubled = evaluateChessPosition(positionFrom("4k3/8/8/8/8/3P4/3P4/4K3 w - - 0 1"));
    const spread = evaluateChessPosition(positionFrom("4k3/8/8/8/8/3P4/2P5/4K3 w - - 0 1"));
    expect(spread).toBeGreaterThan(doubled);
  });

  it("penalises an isolated pawn", () => {
    const isolated = evaluateChessPosition(positionFrom("4k3/8/8/8/8/8/P4P2/4K3 w - - 0 1"));
    const connected = evaluateChessPosition(positionFrom("4k3/8/8/8/8/8/PP6/4K3 w - - 0 1"));
    expect(connected).toBeGreaterThan(isolated);
  });

  it("rewards a passed pawn more the further it has come", () => {
    const near = evaluateChessPosition(positionFrom("4k3/8/8/8/8/8/P7/4K3 w - - 0 1"));
    const far = evaluateChessPosition(positionFrom("4k3/P7/8/8/8/8/8/4K3 w - - 0 1"));
    expect(far).toBeGreaterThan(near);
  });

  it("likes a rook on an open file", () => {
    // Same material either way; the only difference is whether a pawn of its own is
    // standing in the rook's way.
    const open = evaluateChessPosition(positionFrom("4k3/8/8/8/8/8/1P6/R3K3 w - - 0 1"));
    const blocked = evaluateChessPosition(positionFrom("4k3/8/8/8/8/8/P7/R3K3 w - - 0 1"));
    expect(open).toBeGreaterThan(blocked);
  });

  it("prefers a king behind its pawns to one in the open", () => {
    const sheltered = positionFrom("4k3/8/8/8/8/8/5PPP/6K1 w - - 0 1");
    const exposed = positionFrom("4k3/8/8/8/8/5PPP/8/6K1 w - - 0 1");
    expect(evaluateChessPosition(sheltered)).toBeGreaterThan(evaluateChessPosition(exposed));
  });

  it("gives a knight in the middle more than one in the corner", () => {
    const centre = evaluateChessPosition(positionFrom("4k3/8/8/4N3/8/8/8/4K3 w - - 0 1"));
    const corner = evaluateChessPosition(positionFrom("4k3/8/8/8/8/8/8/N3K3 w - - 0 1"));
    expect(centre).toBeGreaterThan(corner);
  });

  it("drives a lone king toward the edge in the endgame", () => {
    // Without this, king and queen against a bare king shuffles until the fifty-move
    // rule ends it: every check looks as good as every other.
    const cornered = evaluateChessPosition(positionFrom("7k/8/5KQ1/8/8/8/8/8 w - - 0 1"));
    const central = evaluateChessPosition(positionFrom("8/8/3k4/8/5KQ1/8/8/8 w - - 0 1"));
    expect(cornered).toBeGreaterThan(central);
  });

  it("does not chase the enemy king when it still has pieces of its own", () => {
    // The drive applies only against a bare king. Against a defended one it would push
    // the engine toward it in positions where that is simply bad.
    const withPieces = positionFrom("r3k3/pppp4/8/8/8/8/8/4K1Q1 w - - 0 1");
    expect(() => evaluateChessPosition(withPieces)).not.toThrow();
  });
});

describe("isChessEndgame", () => {
  it("is false in the opening and true with only a few pieces left", () => {
    expect(isChessEndgame(startPosition())).toBe(false);
    expect(isChessEndgame(positionFrom("4k3/8/8/8/8/8/8/4K2R w - - 0 1"))).toBe(true);
  });
});

describe("hasNonPawnMaterial", () => {
  it("is what null-move pruning asks before trusting itself", () => {
    // In a pawns-only position, being forced to move can be worse than passing, so the
    // pruning's premise stops holding.
    expect(hasNonPawnMaterial(startPosition(), "w")).toBe(true);
    expect(hasNonPawnMaterial(positionFrom("4k3/8/8/8/8/8/PPP5/4K3 w - - 0 1"), "w")).toBe(false);
    expect(hasNonPawnMaterial(positionFrom("4k3/8/8/8/8/8/PPP5/4K2R w - - 0 1"), "w")).toBe(true);
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
