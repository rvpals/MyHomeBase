import { describe, expect, it } from "vitest";
import { CHESS_START_FEN, parseFen, squareFromName } from "./chess-board";
import {
  agreeChessDraw,
  canUndoChessMove,
  chessCapturedPieces,
  chessCheckedKingSquare,
  chessFullMoves,
  chessMoveTargets,
  describeChessResult,
  hasInsufficientMaterial,
  isChessGameOver,
  isHumanTurn,
  playChessMove,
  replayChessMoves,
  resignChessGame,
  scoreChessGame,
  startChessGame,
  undoChessMove,
} from "./game-chess";
import { CHESS_LEVEL_SETUP, CHESS_SCORE_BASE, type ChessGame } from "./types";

/** Plays a list of coordinate moves, failing the test on the first illegal one. */
function play(game: ChessGame, ...moves: string[]): ChessGame {
  let current = game;
  for (const uci of moves) {
    const result = playChessMove(current, uci);
    expect(result.ok, `${uci} should be legal`).toBe(true);
    if (!result.ok) return current;
    current = result.game;
  }
  return current;
}

function newGame(overrides: Partial<Parameters<typeof startChessGame>[0]> = {}): ChessGame {
  return startChessGame({ humanColor: "w", level: "intermediate", ...overrides });
}

/** Scholar's mate: 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? 4.Qxf7#. */
const SCHOLARS_MATE = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"];

/** Fool's mate: 1.f3 e5 2.g4 Qh4#. The fastest mate there is. */
const FOOLS_MATE = ["f2f3", "e7e5", "g2g4", "d8h4"];

describe("startChessGame", () => {
  it("starts from the standard position with White to move", () => {
    const game = newGame();
    expect(game.initialFen).toBe(CHESS_START_FEN);
    expect(game.position.turn).toBe("w");
    expect(game.status).toBe("playing");
    expect(game.moves).toHaveLength(0);
    expect(isChessGameOver(game)).toBe(false);
  });

  it("counts the starting position toward repetition", () => {
    // Without this a game returning to its opening position twice more would only be
    // counted twice, and would never draw.
    expect(newGame().repetitionKeys).toHaveLength(1);
  });

  it("can start from a given position", () => {
    const game = newGame({ fen: "4k3/8/8/8/8/8/8/4K2R w K - 0 1" });
    expect(game.position.turn).toBe("w");
    expect(game.position.castling.wk).toBe(true);
  });

  it("refuses a position it cannot read rather than quietly using the opening", () => {
    // Silently starting a different game from the one asked for is worse than an error.
    expect(() => newGame({ fen: "not a position" })).toThrow();
  });

  it("knows whose turn it is from the player's colour", () => {
    expect(isHumanTurn(newGame({ humanColor: "w" }))).toBe(true);
    expect(isHumanTurn(newGame({ humanColor: "b" }))).toBe(false);
  });
});

describe("playChessMove", () => {
  it("records the move in both notations", () => {
    const result = playChessMove(newGame(), "e2e4");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.game.moves).toEqual([{ uci: "e2e4", san: "e4" }]);
  });

  it("refuses an illegal move as a value rather than throwing", () => {
    const result = playChessMove(newGame(), "e2e5");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/legal/i);
  });

  it("refuses text that is not a move at all", () => {
    for (const bad of ["", "e2", "zz9z", "e2e4e5", "castle"]) {
      expect(playChessMove(newGame(), bad).ok, bad).toBe(false);
    }
  });

  it("refuses a move once the game is over", () => {
    const mated = play(newGame(), ...SCHOLARS_MATE);
    expect(playChessMove(mated, "e8e7").ok).toBe(false);
  });

  it("does not change the game it was given", () => {
    const game = newGame();
    playChessMove(game, "e2e4");
    expect(game.moves).toHaveLength(0);
    expect(game.position.turn).toBe("w");
  });
});

describe("status", () => {
  it("sees checkmate and names the winner", () => {
    const game = play(newGame(), ...SCHOLARS_MATE);
    expect(game.status).toBe("checkmate");
    expect(game.winner).toBe("w");
    expect(isChessGameOver(game)).toBe(true);
    expect(describeChessResult(game)).toMatch(/you win/i);
  });

  it("names the computer as the winner when the player is mated", () => {
    const game = play(newGame({ humanColor: "w" }), ...FOOLS_MATE);
    expect(game.status).toBe("checkmate");
    expect(game.winner).toBe("b");
    expect(describeChessResult(game)).toMatch(/computer wins/i);
  });

  it("reports check without ending the game", () => {
    const game = play(newGame(), "e2e4", "e7e5", "f1b5");
    expect(game.status).toBe("check");
    expect(isChessGameOver(game)).toBe(false);
    expect(chessCheckedKingSquare(game)).toBe(squareFromName("e8"));
  });

  it("sees stalemate", () => {
    // Black king h8, White queen f7 and king g6: not in check, and every escape square
    // is covered.
    const game = newGame({ fen: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1" });
    expect(game.status).toBe("stalemate");
    expect(game.winner).toBeUndefined();
    expect(describeChessResult(game)).toMatch(/stalemate/i);
  });

  it("draws on the fiftieth move with no capture and no pawn moved", () => {
    const game = newGame({ fen: "4k3/8/8/8/8/8/R7/4K3 w - - 99 60" });
    expect(game.status).toBe("playing");
    const after = play(game, "a2a3");
    expect(after.position.halfmoveClock).toBe(100);
    expect(after.status).toBe("fifty-move");
  });

  it("does not call a position a draw when it is also checkmate", () => {
    // The order the rules are checked in is load-bearing: a mate delivered on the
    // hundredth half-move is a win, not a draw, and checking the clock first would
    // take that win off the board.
    const game = newGame({ fen: "7k/5Q2/5K2/8/8/8/8/8 w - - 99 60" });
    const after = play(game, "f7g7");
    expect(after.position.halfmoveClock).toBe(100);
    expect(after.status).toBe("checkmate");
    expect(after.winner).toBe("w");
  });

  it("draws when the same position comes up three times", () => {
    // Both knights out and back, twice: the opening position is reached for the third
    // time on the eighth ply.
    const game = play(
      newGame(),
      "g1f3",
      "g8f6",
      "f3g1",
      "f6g8",
      "g1f3",
      "g8f6",
      "f3g1",
      "f6g8",
    );
    expect(game.status).toBe("threefold");
    expect(game.winner).toBeUndefined();
  });

  it("does not draw on the second repetition", () => {
    const game = play(newGame(), "g1f3", "g8f6", "f3g1", "f6g8");
    expect(game.status).toBe("playing");
  });
});

describe("hasInsufficientMaterial", () => {
  const material = (fen: string) => hasInsufficientMaterial(parseFen(fen)!);

  it("is a draw with bare kings, or a king and one minor piece", () => {
    expect(material("4k3/8/8/8/8/8/8/4K3 w - - 0 1")).toBe(true);
    expect(material("4k3/8/8/8/8/8/8/3BK3 w - - 0 1")).toBe(true);
    expect(material("4k3/8/8/8/8/8/8/3NK3 w - - 0 1")).toBe(true);
  });

  it("is a draw with one bishop each on the same colour squares", () => {
    // Bishops on c1 and f8 are both dark-squared, so neither can ever attack the
    // other's squares and no mating net exists.
    expect(material("5b2/8/8/8/8/8/8/2B1K2k w - - 0 1")).toBe(true);
  });

  it("is not a draw with one bishop each on opposite colours", () => {
    expect(material("2b5/8/8/8/8/8/8/2B1K2k w - - 0 1")).toBe(false);
  });

  it("is not a draw with any pawn, rook or queen on the board", () => {
    expect(material("4k3/8/8/8/8/8/P7/4K3 w - - 0 1")).toBe(false);
    expect(material("4k3/8/8/8/8/8/8/R3K3 w - - 0 1")).toBe(false);
    expect(material("4k3/8/8/8/8/8/8/Q3K3 w - - 0 1")).toBe(false);
  });

  it("is not a draw with two knights, which can still be mate", () => {
    // Mate cannot be forced, but it can be reached if the defender helps — so the rule
    // does not end the game, and neither does this.
    expect(material("4k3/8/8/8/8/8/8/1NN1K3 w - - 0 1")).toBe(false);
  });

  it("ends a game that reaches it", () => {
    const game = newGame({ fen: "4k3/8/8/8/8/8/8/3BK2r b - - 10 40" });
    const after = play(game, "h1d1");
    expect(after.status).toBe("insufficient-material");
    expect(isChessGameOver(after)).toBe(true);
  });
});

describe("resign and draw", () => {
  it("gives the win to the computer on a resignation", () => {
    const game = resignChessGame(play(newGame({ humanColor: "w" }), "e2e4"));
    expect(game.status).toBe("resigned");
    expect(game.winner).toBe("b");
    expect(scoreChessGame(game)).toBe(0);
  });

  it("records an agreed draw with no winner", () => {
    const game = agreeChessDraw(play(newGame(), "e2e4", "e7e5"));
    expect(game.status).toBe("draw-agreed");
    expect(game.winner).toBeUndefined();
  });

  it("will not resign or draw a game that is already over", () => {
    const mated = play(newGame(), ...SCHOLARS_MATE);
    expect(resignChessGame(mated).status).toBe("checkmate");
    expect(agreeChessDraw(mated).status).toBe("checkmate");
  });
});

describe("undoChessMove", () => {
  it("takes back the computer's reply as well as the player's move", () => {
    // One ply would hand the board back with the computer to move, and it would simply
    // play the same reply again.
    const game = play(newGame({ humanColor: "w" }), "e2e4", "e7e5");
    const undone = undoChessMove(game);
    expect(undone.moves).toHaveLength(0);
    expect(undone.position.turn).toBe("w");
  });

  it("takes back one ply when the computer has not replied yet", () => {
    const game = play(newGame({ humanColor: "w" }), "e2e4", "e7e5", "g1f3");
    const undone = undoChessMove(game);
    expect(undone.moves.map((move) => move.uci)).toEqual(["e2e4", "e7e5"]);
    expect(undone.position.turn).toBe("w");
  });

  it("works for a player who is Black", () => {
    const game = play(newGame({ humanColor: "b" }), "e2e4", "e7e5", "g1f3");
    const undone = undoChessMove(game);
    expect(undone.moves.map((move) => move.uci)).toEqual(["e2e4"]);
    expect(undone.position.turn).toBe("b");
  });

  it("rebuilds the status and the repetition keys, not just the board", () => {
    const mated = play(newGame(), ...SCHOLARS_MATE);
    const undone = undoChessMove(mated);
    expect(undone.status).not.toBe("checkmate");
    expect(undone.winner).toBeUndefined();
    expect(undone.repetitionKeys).toHaveLength(undone.moves.length + 1);
  });

  it("does nothing on a game with no moves", () => {
    const game = newGame();
    expect(undoChessMove(game).moves).toHaveLength(0);
    expect(canUndoChessMove(game)).toBe(false);
  });

  it("is refused once the game is over", () => {
    expect(canUndoChessMove(play(newGame(), ...SCHOLARS_MATE))).toBe(false);
  });
});

describe("replayChessMoves", () => {
  it("rebuilds a game from its moves", () => {
    const original = play(newGame(), "e2e4", "e7e5", "g1f3");
    const replayed = replayChessMoves({
      initialFen: original.initialFen,
      humanColor: "w",
      level: "intermediate",
      moves: ["e2e4", "e7e5", "g1f3"],
    });

    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.game.position).toEqual(original.position);
    expect(replayed.game.moves).toEqual(original.moves);
    expect(replayed.game.repetitionKeys).toEqual(original.repetitionKeys);
  });

  it("refuses at the first move that is not legal, naming it", () => {
    // This is what makes a stored game safe to load: an edited save is refused rather
    // than producing an impossible board.
    const replayed = replayChessMoves({
      initialFen: CHESS_START_FEN,
      humanColor: "w",
      level: "beginner",
      moves: ["e2e4", "e7e5", "a1a8"],
    });
    expect(replayed.ok).toBe(false);
    if (replayed.ok) return;
    expect(replayed.reason).toContain("3");
  });

  it("refuses moves recorded after the game ended", () => {
    const replayed = replayChessMoves({
      initialFen: CHESS_START_FEN,
      humanColor: "w",
      level: "beginner",
      moves: [...SCHOLARS_MATE, "e8e7"],
    });
    expect(replayed.ok).toBe(false);
  });

  it("refuses a starting position it cannot read", () => {
    const replayed = replayChessMoves({
      initialFen: "nonsense",
      humanColor: "w",
      level: "beginner",
      moves: [],
    });
    expect(replayed.ok).toBe(false);
  });
});

describe("scoreChessGame", () => {
  it("scores nothing for a loss or a draw", () => {
    expect(scoreChessGame(play(newGame({ humanColor: "w" }), ...FOOLS_MATE))).toBe(0);
    expect(scoreChessGame(agreeChessDraw(play(newGame(), "e2e4")))).toBe(0);
  });

  it("pays more for a win at a higher level", () => {
    const scores = (["beginner", "intermediate", "advanced"] as const).map((level) =>
      scoreChessGame(play(newGame({ humanColor: "w", level }), ...SCHOLARS_MATE)),
    );
    expect(scores[0]).toBeLessThan(scores[1]!);
    expect(scores[1]).toBeLessThan(scores[2]!);
  });

  it("charges for a long game but never below the level's floor", () => {
    const quick = play(newGame({ humanColor: "w", level: "advanced" }), ...SCHOLARS_MATE);
    expect(scoreChessGame(quick)).toBe(
      CHESS_SCORE_BASE * CHESS_LEVEL_SETUP.advanced.multiplier - chessFullMoves(quick),
    );

    // A game longer than the whole base is worth still scores the floor rather than
    // nothing or a negative — the shared board ranks `score DESC`.
    const long: ChessGame = { ...quick, moves: new Array(2_000).fill(quick.moves[0]!) };
    expect(scoreChessGame(long)).toBe(
      Math.round(CHESS_SCORE_BASE * CHESS_LEVEL_SETUP.advanced.multiplier * 0.4),
    );
  });

  it("scores nothing when the computer won, whatever the level", () => {
    const game = resignChessGame(newGame({ humanColor: "w", level: "advanced" }));
    expect(scoreChessGame(game)).toBe(0);
  });
});

describe("board helpers", () => {
  it("lists where a piece may go", () => {
    const targets = chessMoveTargets(newGame(), squareFromName("g1")).map((square) => square);
    expect(targets).toHaveLength(2);
  });

  it("collapses a promotion's four moves into one target square", () => {
    // The view asks "which squares light up", not "how many moves end there".
    const game = newGame({ fen: "8/4P3/8/8/8/8/8/K6k w - - 0 1" });
    expect(chessMoveTargets(game, squareFromName("e7"))).toHaveLength(1);
  });

  it("offers nothing once the game is over", () => {
    const mated = play(newGame(), ...SCHOLARS_MATE);
    expect(chessMoveTargets(mated, squareFromName("e8"))).toHaveLength(0);
  });

  it("lists captured pieces most valuable first", () => {
    const game = newGame({ fen: "4k3/8/8/8/8/8/8/R3K3 w - - 0 1" });
    // Black started this position with only a king, so nothing of Black's is missing.
    expect(chessCapturedPieces(game, "b")).toEqual([]);
    // White is missing nothing either — the comparison is against the starting FEN.
    expect(chessCapturedPieces(game, "w")).toEqual([]);
  });

  it("counts a real capture", () => {
    const game = play(newGame(), "e2e4", "d7d5", "e4d5");
    expect(chessCapturedPieces(game, "b")).toEqual(["p"]);
    expect(chessCapturedPieces(game, "w")).toEqual([]);
  });

  it("does not report a negative count after a promotion", () => {
    // Promoting leaves more queens than the game started with, which a naive
    // "before minus now" would print as -1.
    const game = play(newGame({ fen: "7k/4P3/8/8/8/8/8/K7 w - - 0 1" }), "e7e8q");
    expect(chessCapturedPieces(game, "w")).toEqual([]);
  });
});
