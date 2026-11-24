import { describe, expect, it } from "vitest";
import { parseFen, startPosition } from "./chess-board";
import { applyChessMove, generateLegalMoves } from "./chess-moves";
import { findMoveByUci } from "./chess-notation";
import { chessPositionKey } from "./chess-zobrist";
import type { ChessPosition } from "./types";

function positionFrom(fen: string): ChessPosition {
  const parsed = parseFen(fen);
  expect(parsed, fen).toBeDefined();
  return parsed!;
}

describe("chessPositionKey", () => {
  it("gives the same position the same key", () => {
    expect(chessPositionKey(startPosition())).toBe(chessPositionKey(startPosition()));
  });

  it("is a safe integer, so it can be a Map key", () => {
    const key = chessPositionKey(startPosition());
    expect(Number.isSafeInteger(key)).toBe(true);
  });

  it("tells two different positions apart", () => {
    const start = startPosition();
    const after = applyChessMove(start, findMoveByUci(start, "e2e4")!);
    expect(chessPositionKey(after)).not.toBe(chessPositionKey(start));
  });

  it("tells the side to move apart", () => {
    // The same pieces with the other side to move is a different position, and a table
    // that conflated them would hand back a score for the wrong player.
    const white = positionFrom("4k3/8/8/8/8/8/8/4K2R w - - 0 1");
    const black = positionFrom("4k3/8/8/8/8/8/8/4K2R b - - 0 1");
    expect(chessPositionKey(white)).not.toBe(chessPositionKey(black));
  });

  it("tells castling rights apart", () => {
    const withRights = positionFrom("4k2r/8/8/8/8/8/8/4K2R w Kk - 0 1");
    const without = positionFrom("4k2r/8/8/8/8/8/8/4K2R w - - 0 1");
    expect(chessPositionKey(withRights)).not.toBe(chessPositionKey(without));
  });

  it("ignores an en-passant square no pawn can take", () => {
    // Same reasoning as the repetition key: two positions that differ only by a square
    // nobody can use are the same position, and separating them would halve the
    // table's usefulness in every pawn-heavy middlegame.
    const noTaker = positionFrom("4k3/8/8/3p4/8/8/8/4K3 w - d6 0 1");
    const plain = positionFrom("4k3/8/8/3p4/8/8/8/4K3 w - - 0 1");
    expect(chessPositionKey(noTaker)).toBe(chessPositionKey(plain));
  });

  it("keeps an en-passant square a pawn really can take", () => {
    const real = positionFrom("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
    const plain = positionFrom("4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1");
    expect(chessPositionKey(real)).not.toBe(chessPositionKey(plain));
  });

  it("gives one position reached two ways the same key", () => {
    // The whole point of a transposition table: 1.Nf3 d5 2.d4 and 1.d4 d5 2.Nf3 reach
    // the same position, and searching it twice is the work the table saves.
    const start = startPosition();
    const routeOne = ["g1f3", "d7d5", "d2d4"].reduce(
      (position, uci) => applyChessMove(position, findMoveByUci(position, uci)!),
      start,
    );
    const routeTwo = ["d2d4", "d7d5", "g1f3"].reduce(
      (position, uci) => applyChessMove(position, findMoveByUci(position, uci)!),
      start,
    );
    expect(chessPositionKey(routeOne)).toBe(chessPositionKey(routeTwo));
  });

  it("almost never collides across a wide sweep of real positions", () => {
    /*
      The key is 52 bits, not 64 — JavaScript has no cheap 64-bit integer and `BigInt`
      in the hot path would cost more than the table saves. This walks a few thousand
      genuinely distinct positions and asserts the keys stay distinct too.

      A collision is not a correctness bug even so: the search re-checks that a move
      from the table is legal before trusting it, so a clash costs a wasted entry.
    */
    const seen = new Map<number, string>();
    const queue: ChessPosition[] = [startPosition()];
    let collisions = 0;

    for (let index = 0; index < queue.length && seen.size < 3_000; index += 1) {
      const position = queue[index]!;
      for (const move of generateLegalMoves(position)) {
        const next = applyChessMove(position, move);
        const key = chessPositionKey(next);
        const fen = next.board.map((piece) => (piece ? piece.type + piece.color : ".")).join("");
        const signature = `${fen}|${next.turn}`;

        const existing = seen.get(key);
        if (existing === undefined) {
          seen.set(key, signature);
          if (queue.length < 400) queue.push(next);
        } else if (existing !== signature) {
          collisions += 1;
        }
      }
    }

    expect(seen.size).toBeGreaterThan(1_000);
    expect(collisions).toBe(0);
  }, 30_000);
});
