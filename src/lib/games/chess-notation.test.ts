import { describe, expect, it } from "vitest";
import { parseFen, squareFromName } from "./chess-board";
import { generateLegalMoves } from "./chess-moves";
import { findMoveByUci, gameToPgn, moveToSan, moveToUci, pgnResult } from "./chess-notation";
import { playChessMove, resignChessGame, startChessGame } from "./game-chess";
import type { ChessGame, ChessPosition } from "./types";

function positionFrom(fen: string): ChessPosition {
  const parsed = parseFen(fen);
  expect(parsed, fen).toBeDefined();
  return parsed!;
}

/** The SAN for one coordinate move, played from a FEN. */
function san(fen: string, uci: string): string {
  const position = positionFrom(fen);
  const move = findMoveByUci(position, uci);
  expect(move, `${uci} should be legal in ${fen}`).toBeDefined();
  return moveToSan(position, move!);
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

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("moveToUci", () => {
  it("writes four squares, and five for a promotion", () => {
    const position = positionFrom("8/4P3/8/8/8/8/8/K6k w - - 0 1");
    const moves = generateLegalMoves(position).filter(
      (move) => move.from === squareFromName("e7"),
    );
    expect(moves.map(moveToUci).sort()).toEqual(["e7e8b", "e7e8n", "e7e8q", "e7e8r"]);
  });
});

describe("findMoveByUci", () => {
  it("resolves a move against the legal list", () => {
    expect(findMoveByUci(positionFrom(START), "e2e4")).toBeDefined();
  });

  it("returns nothing for a move the rules do not offer", () => {
    // The safety property the whole save format rests on: a stored game can only ever
    // name a move the rules already allowed, so no edited row can move a rook like a
    // queen or castle out of check.
    expect(findMoveByUci(positionFrom(START), "e2e5")).toBeUndefined();
    expect(findMoveByUci(positionFrom(START), "a1a8")).toBeUndefined();
  });

  it("returns nothing for text that is not coordinate notation", () => {
    for (const bad of ["", "e2", "e2e4e5", "z9z9", "e2e4k"]) {
      expect(findMoveByUci(positionFrom(START), bad), bad).toBeUndefined();
    }
  });

  it("tells the four promotions apart", () => {
    const position = positionFrom("8/4P3/8/8/8/8/8/K6k w - - 0 1");
    expect(findMoveByUci(position, "e7e8q")?.promotion).toBe("q");
    expect(findMoveByUci(position, "e7e8n")?.promotion).toBe("n");
    // Coordinates alone are ambiguous on a promotion rank, so a move with no promotion
    // letter must not quietly resolve to a queen.
    expect(findMoveByUci(position, "e7e8")).toBeUndefined();
  });
});

describe("moveToSan", () => {
  it("writes a pawn move as the square alone", () => {
    expect(san(START, "e2e4")).toBe("e4");
  });

  it("writes a piece move with its letter", () => {
    expect(san(START, "g1f3")).toBe("Nf3");
  });

  it("writes a pawn capture with its starting file", () => {
    expect(san("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", "e4d5")).toBe(
      "exd5",
    );
  });

  it("writes a piece capture with an x", () => {
    expect(san("4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1", "d1d5")).toBe("Qxd5");
  });

  it("writes castling as O-O and O-O-O", () => {
    expect(san("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1g1")).toBe("O-O");
    expect(san("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1c1")).toBe("O-O-O");
  });

  it("writes a promotion with an equals sign", () => {
    expect(san("8/4P3/8/8/8/8/8/K6k w - - 0 1", "e7e8q")).toBe("e8=Q");
    expect(san("8/4P3/8/8/8/8/8/K6k w - - 0 1", "e7e8n")).toBe("e8=N");
  });

  it("marks check with + and mate with #", () => {
    expect(san("4k3/8/8/8/8/8/8/4K2R w K - 0 1", "h1h8")).toBe("Rh8+");

    // Scholar's mate: the queen takes on f7 protected by the bishop, so this is mate
    // and not merely check.
    const before = play(
      startChessGame({ humanColor: "w", level: "beginner" }),
      "e2e4",
      "e7e5",
      "f1c4",
      "b8c6",
      "d1h5",
      "g8f6",
    );
    expect(play(before, "h5f7").moves.at(-1)?.san).toBe("Qxf7#");
  });

  it("prefers the file over the rank when disambiguating", () => {
    // Rooks on a1 and h1 with the first rank clear between them, so both reach c1.
    // They differ by file, so SAN names the file — `Rac1`, not `R1c1`.
    expect(san("7k/8/8/8/8/8/4K3/R6R w - - 0 1", "a1c1")).toBe("Rac1");
    expect(san("7k/8/8/8/8/8/4K3/R6R w - - 0 1", "h1f1")).toBe("Rhf1");
  });

  it("falls back to the rank when the files are the same", () => {
    // Rooks on a1 and a5 both reach a3; they share a file, so the rank disambiguates.
    expect(san("4k3/8/8/R7/8/8/8/R3K3 w - - 0 1", "a1a3")).toBe("R1a3");
    expect(san("4k3/8/8/R7/8/8/8/R3K3 w - - 0 1", "a5a3")).toBe("R5a3");
  });

  it("writes the whole square when neither file nor rank is enough", () => {
    // Three queens bear on e5: a1, a5 and e1. For the a1 queen the a-file is shared
    // with a5 and the first rank with e1, so only both coordinates will do.
    expect(san("7k/8/8/Q7/8/8/8/Q3Q1K1 w - - 0 1", "a1e5")).toBe("Qa1e5");
    // The same position names the other two by one coordinate each, since for them one
    // of the two is unique: the a5 queen is alone on the fifth rank, and the e1 queen
    // is alone on the e-file.
    expect(san("7k/8/8/Q7/8/8/8/Q3Q1K1 w - - 0 1", "a5e5")).toBe("Q5e5");
    expect(san("7k/8/8/Q7/8/8/8/Q3Q1K1 w - - 0 1", "e1e5")).toBe("Qee5");
  });

  it("does not disambiguate a move only one piece can make", () => {
    expect(san("4k3/8/8/8/8/8/8/4K2R w - - 0 1", "h1h5")).toBe("Rh5");
  });

  it("does not treat the four promotions as needing disambiguation", () => {
    // They share from and to, and are told apart by the =Q rather than a file letter.
    expect(san("8/4P3/8/8/8/8/8/K6k w - - 0 1", "e7e8r")).toBe("e8=R");
  });
});

describe("gameToPgn", () => {
  it("writes headers, numbered moves and a result", () => {
    const game = play(
      startChessGame({ humanColor: "w", level: "beginner" }),
      "e2e4",
      "e7e5",
      "g1f3",
    );
    const pgn = gameToPgn(game, { date: "2026.11.22" });

    expect(pgn).toContain('[White "Player"]');
    expect(pgn).toContain('[Black "Computer"]');
    expect(pgn).toContain('[Date "2026.11.22"]');
    expect(pgn).toContain("1. e4 e5 2. Nf3");
    // A game still in progress has no result yet.
    expect(pgn).toContain('[Result "*"]');
  });

  it("names the player as Black when that is the colour they chose", () => {
    const game = startChessGame({ humanColor: "b", level: "beginner" });
    const pgn = gameToPgn(game);
    expect(pgn).toContain('[White "Computer"]');
    expect(pgn).toContain('[Black "Player"]');
  });

  it("reports the result of a finished game", () => {
    const won = play(
      startChessGame({ humanColor: "w", level: "beginner" }),
      "e2e4",
      "e7e5",
      "f1c4",
      "b8c6",
      "d1h5",
      "g8f6",
      "h5f7",
    );
    expect(pgnResult(won)).toBe("1-0");
    expect(gameToPgn(won)).toContain('[Result "1-0"]');

    const resigned = resignChessGame(
      play(startChessGame({ humanColor: "w", level: "beginner" }), "e2e4"),
    );
    expect(pgnResult(resigned)).toBe("0-1");
  });

  it("writes a draw as 1/2-1/2", () => {
    const drawn = play(
      startChessGame({ humanColor: "w", level: "beginner" }),
      "g1f3",
      "g8f6",
      "f3g1",
      "f6g8",
      "g1f3",
      "g8f6",
      "f3g1",
      "f6g8",
    );
    expect(pgnResult(drawn)).toBe("1/2-1/2");
  });

  it("includes SetUp and FEN only when the game did not start normally", () => {
    const standard = startChessGame({ humanColor: "w", level: "beginner" });
    expect(gameToPgn(standard)).not.toContain("[SetUp");

    const custom = startChessGame({
      humanColor: "w",
      level: "beginner",
      fen: "4k3/8/8/8/8/8/8/4K2R w K - 0 1",
    });
    const pgn = gameToPgn(custom);
    // Both tags, or a reader that honours SetUp without FEN replays from the opening
    // position and prints nonsense.
    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain('[FEN "4k3/8/8/8/8/8/8/4K2R w K - 0 1"]');
  });

  it("numbers a game that starts with Black to move with an ellipsis", () => {
    const game = play(
      startChessGame({
        humanColor: "b",
        level: "beginner",
        fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
      }),
      "e7e5",
    );
    expect(gameToPgn(game)).toContain("1... e5");
  });

  it("escapes a quote in a tag value rather than ending the tag early", () => {
    const pgn = gameToPgn(startChessGame({ humanColor: "w", level: "beginner" }), {
      event: 'The "big" match',
    });
    expect(pgn).toContain('[Event "The \\"big\\" match"]');
  });
});
