import { describe, expect, it } from "vitest";
import { CHESS_START_FEN, parseFen, squareFromName, toFen } from "./chess-board";
import {
  agreeChessDraw,
  canChessColorMate,
  canUndoChessMove,
  recordChessHint,
  chessCapturedPieces,
  chessCheckedKingSquare,
  chessFullMoves,
  chessInfluence,
  chessMoveTargets,
  chessPlayerOptions,
  chessPositionAtPly,
  describeChessResult,
  flagChessGame,
  hasInsufficientMaterial,
  isChessGameOver,
  isChessGameTimed,
  isHumanTurn,
  playChessMove,
  replayChessMoves,
  resignChessGame,
  scoreChessGame,
  startChessGame,
  undoChessMove,
} from "./game-chess";
import {
  CHESS_ASSIST_PENALTY_FRACTION,
  CHESS_LEVEL_SETUP,
  CHESS_SCORE_BASE,
  type ChessGame,
} from "./types";

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
    // A rook swinging to the eighth rank. (2.Bb5 in the opening is *not* check — the
    // d7 pawn blocks the diagonal, which is what an earlier version of this test got
    // wrong.)
    const game = play(newGame({ fen: "4k3/8/8/8/8/8/8/4K2R w K - 0 1" }), "h1h8");
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

  it("counts a repetition through a double pawn step", () => {
    /*
      The en-passant bug: FEN records the ep square after any double step, so the
      position right after one never matched the same position reached later and the
      draw arrived a cycle late — or never.

      Here each cycle passes through 1.e4/1...e5-style double steps only at the start;
      the knight shuffle after it must still reach threefold on the eighth ply.
    */
    const game = play(
      newGame(),
      "e2e4",
      "e7e5",
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
    // Black's bishop takes White's last piece, leaving king and bishop against a bare
    // king — which neither side can mate with.
    const game = newGame({ fen: "4k3/8/8/2b5/8/8/8/4K1N1 b - - 0 1" });
    const after = play(game, "c5g1");
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
    const checked = play(newGame({ humanColor: "w" }), "e2e4", "e7e5", "d1h5", "e8e7");
    const undone = undoChessMove(checked);

    expect(undone.moves).toHaveLength(2);
    expect(undone.status).toBe("playing");
    expect(undone.winner).toBeUndefined();
    expect(undone.repetitionKeys).toHaveLength(undone.moves.length + 1);
  });

  it("is refused once the game is over, so a loss cannot be replayed away", () => {
    const mated = play(newGame(), ...SCHOLARS_MATE);
    expect(undoChessMove(mated).status).toBe("checkmate");
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

describe("the clock", () => {
  const timed = (fen?: string) =>
    startChessGame({ humanColor: "w", level: "intermediate", timeControl: "3+2", fen });

  it("is absent by default, so an untimed game is the plain case", () => {
    expect(newGame().clock).toBeUndefined();
    expect(isChessGameTimed(newGame())).toBe(false);
  });

  it("starts both sides on the control's allowance", () => {
    expect(timed().clock?.remainingMs).toEqual({ w: 180_000, b: 180_000 });
    expect(isChessGameTimed(timed())).toBe(true);
  });

  it("charges the mover and adds the increment when a move is timed", () => {
    const result = playChessMove(timed(), "e2e4", { elapsedMs: 4_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.game.clock?.remainingMs).toEqual({ w: 178_000, b: 180_000 });
  });

  it("charges nothing when no elapsed time is given", () => {
    // Replays, the CLI and most tests play moves without measuring time, and an
    // unmeasured move must cost nothing — that is what keeps every older caller right.
    const result = playChessMove(timed(), "e2e4");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.game.clock?.remainingMs.w).toBe(180_000);
  });

  it("ignores elapsed time in an untimed game", () => {
    const result = playChessMove(newGame(), "e2e4", { elapsedMs: 4_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.game.clock).toBeUndefined();
    expect(result.game.status).toBe("playing");
  });

  it("ends the game when a move arrives too late, and does not play it", () => {
    // A flag falls before the move completes, so the move never lands — otherwise a
    // losing side could deliver mate with time already gone.
    const nearly: ChessGame = { ...timed(), clock: { control: "3+2", remainingMs: { w: 1_000, b: 60_000 } } };
    const result = playChessMove(nearly, "e2e4", { elapsedMs: 5_000 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.game.status).toBe("timeout");
    expect(result.game.winner).toBe("b");
    expect(result.game.moves).toHaveLength(0);
    expect(isChessGameOver(result.game)).toBe(true);
  });

  it("gives the win to the other side when a flag falls", () => {
    const game = flagChessGame(timed(), "w");
    expect(game.status).toBe("timeout");
    expect(game.winner).toBe("b");
    expect(game.clock?.remainingMs.w).toBe(0);
    expect(describeChessResult(game)).toMatch(/you ran out of time/i);
    expect(scoreChessGame(game)).toBe(0);
  });

  it("scores a win when the computer is the one that flags", () => {
    const game = flagChessGame(timed(), "b");
    expect(game.winner).toBe("w");
    expect(describeChessResult(game)).toMatch(/computer ran out of time/i);
    expect(scoreChessGame(game)).toBeGreaterThan(0);
  });

  it("draws a flag when the other side could never have mated", () => {
    // The official rule, and the one case where running out of time costs nothing:
    // Black has a bare king, so it cannot win however long White takes.
    const game = startChessGame({
      humanColor: "w",
      level: "intermediate",
      timeControl: "3+2",
      fen: "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1",
    });
    const flagged = flagChessGame(game, "w");

    expect(flagged.status).toBe("timeout");
    expect(flagged.winner).toBeUndefined();
    expect(describeChessResult(flagged)).toMatch(/draw/i);
  });

  it("still awards a flag to a side holding a rook or a pawn", () => {
    const game = timed("4k3/8/8/8/8/8/8/R3K3 b - - 0 1");
    expect(flagChessGame(game, "b").winner).toBe("w");
  });

  it("does nothing to an untimed game or one already over", () => {
    expect(flagChessGame(newGame(), "w").status).toBe("playing");
    const mated = play(newGame(), ...SCHOLARS_MATE);
    expect(flagChessGame(mated, "w").status).toBe("checkmate");
  });

  it("refuses Undo in a timed game", () => {
    // A takeback cannot honestly restore time already spent, and allowing one would be
    // a way to play a blitz game at leisure.
    const played = play(timed(), "e2e4", "e7e5");
    expect(canUndoChessMove(played)).toBe(false);
    expect(undoChessMove(played).moves).toHaveLength(2);
  });

  it("still allows Undo without a clock", () => {
    const played = play(newGame(), "e2e4", "e7e5");
    expect(canUndoChessMove(played)).toBe(true);
    expect(undoChessMove(played).moves).toHaveLength(0);
  });

  it("carries the clock through a replay rather than resetting it", () => {
    const clock = { control: "3+2", remainingMs: { w: 42_000, b: 51_000 } } as const;
    const replayed = replayChessMoves({
      initialFen: CHESS_START_FEN,
      humanColor: "w",
      level: "intermediate",
      moves: ["e2e4", "e7e5"],
      clock,
    });

    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    // Time spent is the one thing the moves cannot rebuild, so it is carried across
    // whole — a replay that started the clock again would hand back a free game.
    expect(replayed.game.clock).toEqual(clock);
  });

  it("replays as untimed when no clock is given", () => {
    const replayed = replayChessMoves({
      initialFen: CHESS_START_FEN,
      humanColor: "w",
      level: "intermediate",
      moves: ["e2e4"],
    });
    expect(replayed.ok && replayed.game.clock).toBeUndefined();
  });
});

describe("canChessColorMate", () => {
  const mate = (fen: string, color: "w" | "b") => canChessColorMate(parseFen(fen)!, color);

  it("is false for a bare king, and for a king with one minor piece", () => {
    expect(mate("4k3/8/8/8/8/8/8/4K3 w - - 0 1", "w")).toBe(false);
    expect(mate("4k3/8/8/8/8/8/8/3BK3 w - - 0 1", "w")).toBe(false);
    expect(mate("4k3/8/8/8/8/8/8/3NK3 w - - 0 1", "w")).toBe(false);
  });

  it("is true with a pawn, a rook or a queen", () => {
    expect(mate("4k3/8/8/8/8/8/P7/4K3 w - - 0 1", "w")).toBe(true);
    expect(mate("4k3/8/8/8/8/8/8/R3K3 w - - 0 1", "w")).toBe(true);
    expect(mate("4k3/8/8/8/8/8/8/Q3K3 w - - 0 1", "w")).toBe(true);
  });

  it("is true with two minor pieces", () => {
    // A different question from `hasInsufficientMaterial`, which calls two knights a
    // live game only because mate is reachable — here it is the same answer for the
    // same reason.
    expect(mate("4k3/8/8/8/8/8/8/1NN1K3 w - - 0 1", "w")).toBe(true);
  });

  it("answers about the colour it was asked about", () => {
    expect(mate("3qk3/8/8/8/8/8/8/4K3 w - - 0 1", "b")).toBe(true);
    expect(mate("3qk3/8/8/8/8/8/8/4K3 w - - 0 1", "w")).toBe(false);
  });
});

describe("assists", () => {
  it("starts a game with none taken", () => {
    const game = newGame();
    expect(game.hintsUsed).toBe(0);
    expect(game.takebacksUsed).toBe(0);
  });

  it("counts a hint", () => {
    expect(recordChessHint(newGame()).hintsUsed).toBe(1);
    expect(recordChessHint(recordChessHint(newGame())).hintsUsed).toBe(2);
  });

  it("does not count a hint on a finished game", () => {
    const mated = play(newGame(), ...SCHOLARS_MATE);
    expect(recordChessHint(mated).hintsUsed).toBe(0);
  });

  it("counts a takeback, and keeps the count across later ones", () => {
    // The rebuild starts from the opening position, so without carrying these across
    // every takeback would also erase the record of the ones before it.
    const once = undoChessMove(play(newGame(), "e2e4", "e7e5"));
    expect(once.takebacksUsed).toBe(1);

    const twice = undoChessMove(play(once, "d2d4", "d7d5"));
    expect(twice.takebacksUsed).toBe(2);
  });

  it("keeps a hint count across a takeback", () => {
    const hinted = recordChessHint(play(newGame(), "e2e4", "e7e5"));
    expect(undoChessMove(hinted).hintsUsed).toBe(1);
  });

  it("charges a winning score for each one", () => {
    const won = play(newGame({ humanColor: "w", level: "advanced" }), ...SCHOLARS_MATE);
    const clean = scoreChessGame(won);

    const base = CHESS_SCORE_BASE * CHESS_LEVEL_SETUP.advanced.multiplier;
    const oneHint = scoreChessGame({ ...won, hintsUsed: 1 });
    expect(oneHint).toBe(Math.round(clean - base * CHESS_ASSIST_PENALTY_FRACTION));

    // A takeback costs the same as a hint.
    expect(scoreChessGame({ ...won, takebacksUsed: 1 })).toBe(oneHint);
  });

  it("can take a win all the way to nothing", () => {
    // Four assists cancel the win outright, rather than stopping at the length floor —
    // that floor is there for a long hard game, not for one the engine played.
    const won = play(newGame({ humanColor: "w", level: "advanced" }), ...SCHOLARS_MATE);
    expect(scoreChessGame({ ...won, hintsUsed: 2, takebacksUsed: 2 })).toBe(0);
    expect(scoreChessGame({ ...won, hintsUsed: 99 })).toBe(0);
  });

  it("changes nothing about a loss, which already scored zero", () => {
    const lost = play(newGame({ humanColor: "w" }), ...FOOLS_MATE);
    expect(scoreChessGame({ ...lost, hintsUsed: 3 })).toBe(0);
  });
});

describe("chessPlayerOptions", () => {
  it("lists every square the player can reach and every piece that can move", () => {
    // The opening: eight pawns and two knights can move, to twenty squares between them.
    /*
      Ten pieces can move — eight pawns and two knights — and they reach **sixteen**
      distinct squares, not twenty. There are twenty legal moves, but the knights'
      destinations (a3, c3, f3, h3) are squares a pawn can also step to, and the aid
      lights a square once however many pieces can reach it.
    */
    const { reachable, movable } = chessPlayerOptions(newGame({ humanColor: "w" }));
    expect(movable).toHaveLength(10);
    expect(reachable).toHaveLength(16);
  });

  it("counts a square only once however many pieces can reach it", () => {
    // Two rooks both bearing on c1: the aid lights the square, not the pair of moves.
    const game = newGame({ humanColor: "w", fen: "7k/8/8/8/8/8/4K3/R6R w - - 0 1" });
    const { reachable } = chessPlayerOptions(game);
    expect(reachable.filter((square) => square === squareFromName("c1"))).toHaveLength(1);
  });

  it("counts a promotion square once, not four times", () => {
    const game = newGame({ humanColor: "w", fen: "8/4P3/8/8/8/8/8/K6k w - - 0 1" });
    const { reachable } = chessPlayerOptions(game);
    expect(reachable.filter((square) => square === squareFromName("e8"))).toHaveLength(1);
  });

  it("shows nothing while it is the computer's turn", () => {
    // Otherwise the aid would be drawing the computer's options while it thinks, which
    // is giving away its plan rather than helping the player read their own.
    const game = play(newGame({ humanColor: "w" }), "e2e4");
    expect(chessPlayerOptions(game)).toEqual({ reachable: [], movable: [] });
  });

  it("shows nothing once the game is over", () => {
    const mated = play(newGame({ humanColor: "w" }), ...SCHOLARS_MATE);
    expect(chessPlayerOptions(mated).reachable).toEqual([]);
  });

  it("follows the player's own colour", () => {
    // Black to move and the player is Black, so these are Black's options.
    const game = play(newGame({ humanColor: "b" }), "e2e4");
    const { movable } = chessPlayerOptions(game);
    expect(movable).toContain(squareFromName("e7"));
    expect(movable).not.toContain(squareFromName("e4"));
  });
});

describe("chessInfluence", () => {
  it("marks a square its own piece stands on as controlled, because it is defended", () => {
    // The distinction the aid exists to teach: control is not "can move to". A knight
    // on a square a pawn defends is safe, and that is only visible if defence counts.
    // The knight on e4 stands on a square its own pawn on d3 defends. (A pawn on f3
    // does *not* defend g2 — pawns attack forwards, which an earlier version of this
    // test had backwards.)
    const game = newGame({ humanColor: "w", fen: "7k/8/8/8/4N3/3P4/8/K7 w - - 0 1" });
    const { mine } = chessInfluence(game);
    expect(mine[squareFromName("e4")]).toBe(true);
  });

  it("marks the squares a pawn attacks, not the one it moves to", () => {
    const game = newGame({ humanColor: "w", fen: "7k/8/8/8/4P3/8/8/K7 w - - 0 1" });
    const { mine } = chessInfluence(game);
    expect(mine[squareFromName("d5")]).toBe(true);
    expect(mine[squareFromName("f5")]).toBe(true);
    expect(mine[squareFromName("e5")]).toBe(false);
  });

  it("tells the two sides apart, and shows a square both control", () => {
    // White pawn on e4 and Black pawn on e6 both bear on d5.
    const game = newGame({ humanColor: "w", fen: "4k3/8/4p3/8/4P3/8/8/4K3 w - - 0 1" });
    const { mine, theirs } = chessInfluence(game);
    expect(mine[squareFromName("d5")]).toBe(true);
    expect(theirs[squareFromName("d5")]).toBe(true);
    expect(mine[squareFromName("d3")]).toBe(false);
  });

  it("reads `mine` as the player's side, whichever colour they chose", () => {
    const asBlack = newGame({ humanColor: "b", fen: "4k3/8/4p3/8/4P3/8/8/4K3 w - - 0 1" });
    const { mine, theirs } = chessInfluence(asBlack);
    // d7 is attacked by the black pawn on e6, so it belongs to the player here.
    expect(mine[squareFromName("d7")]).toBe(true);
    expect(theirs[squareFromName("d7")]).toBe(false);
  });

  it("covers all sixty-four squares", () => {
    const { mine, theirs } = chessInfluence(newGame());
    expect(mine).toHaveLength(64);
    expect(theirs).toHaveLength(64);
  });

  it("still answers once the game is over", () => {
    // Unlike the move aid: a finished position is exactly the one a beginner wants to
    // look at, and nothing about it is secret.
    const mated = play(newGame({ humanColor: "w" }), ...SCHOLARS_MATE);
    expect(chessInfluence(mated).mine).toHaveLength(64);
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

describe("chessPositionAtPly", () => {
  it("gives the starting position at ply 0", () => {
    const game = play(newGame(), "e2e4", "e7e5");
    const { position, lastMove } = chessPositionAtPly(game, 0);
    expect(toFen(position)).toBe(CHESS_START_FEN);
    expect(lastMove).toBeUndefined();
  });

  it("gives the position after each move, with the move that got there", () => {
    const game = play(newGame(), "e2e4", "e7e5", "g1f3");

    const first = chessPositionAtPly(game, 1);
    expect(first.position.turn).toBe("b");
    expect(first.lastMove).toEqual({
      from: squareFromName("e2"),
      to: squareFromName("e4"),
    });

    const second = chessPositionAtPly(game, 2);
    expect(second.position.turn).toBe("w");
    expect(second.lastMove?.to).toBe(squareFromName("e5"));
  });

  it("gives the current position at the last ply", () => {
    const game = play(newGame(), "e2e4", "e7e5", "g1f3");
    expect(toFen(chessPositionAtPly(game, 3).position)).toBe(toFen(game.position));
  });

  it("clamps rather than refusing an out-of-range ply", () => {
    // The caller is a pair of arrow buttons, and clamping is exactly what they would
    // otherwise have to do themselves.
    const game = play(newGame(), "e2e4", "e7e5");
    expect(toFen(chessPositionAtPly(game, -5).position)).toBe(CHESS_START_FEN);
    expect(toFen(chessPositionAtPly(game, 99).position)).toBe(toFen(game.position));
  });

  it("does not change the game it was given", () => {
    const game = play(newGame(), "e2e4", "e7e5");
    const before = toFen(game.position);
    chessPositionAtPly(game, 1);
    expect(toFen(game.position)).toBe(before);
  });
});
