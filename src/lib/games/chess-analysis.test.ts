import { describe, expect, it } from "vitest";
import {
  analyseChessGame,
  chessEvalSeries,
  chessMoveQuality,
  chessPlyColor,
  clampEval,
  summarise,
} from "./chess-analysis";
import { playChessMove, startChessGame } from "./game-chess";
import {
  CHESS_EVAL_CLAMP,
  CHESS_QUALITY_THRESHOLDS,
  type ChessAnalysedPly,
  type ChessGame,
} from "./types";

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

function newGame(fen?: string): ChessGame {
  return startChessGame({ humanColor: "w", level: "intermediate", fen });
}

/** Fast, so the suite stays quick: these tests are about the arithmetic, not the depth. */
const FAST = { speed: "fast" } as const;

describe("clampEval", () => {
  it("holds a mate score inside the readable range", () => {
    // Without this one forced mate would flatten the whole graph and report a loss of
    // two million centipawns for the move that allowed it.
    expect(clampEval(1_000_000)).toBe(CHESS_EVAL_CLAMP);
    expect(clampEval(-1_000_000)).toBe(-CHESS_EVAL_CLAMP);
    expect(clampEval(120)).toBe(120);
  });
});

describe("chessMoveQuality", () => {
  it("names each band at its threshold", () => {
    expect(chessMoveQuality(0)).toBe("good");
    expect(chessMoveQuality(CHESS_QUALITY_THRESHOLDS.inaccuracy - 1)).toBe("good");
    expect(chessMoveQuality(CHESS_QUALITY_THRESHOLDS.inaccuracy)).toBe("inaccuracy");
    expect(chessMoveQuality(CHESS_QUALITY_THRESHOLDS.mistake)).toBe("mistake");
    expect(chessMoveQuality(CHESS_QUALITY_THRESHOLDS.blunder)).toBe("blunder");
    expect(chessMoveQuality(5_000)).toBe("blunder");
  });
});

describe("analyseChessGame", () => {
  it("reports one entry per move played", () => {
    const game = play(newGame(), "e2e4", "e7e5", "g1f3");
    const analysis = analyseChessGame(game, FAST);

    expect(analysis.plies).toHaveLength(3);
    expect(analysis.plies.map((ply) => ply.san)).toEqual(["e4", "e5", "Nf3"]);
    expect(analysis.partial).toBe(false);
  }, 30_000);

  it("alternates the colour, starting with whoever was to move", () => {
    const analysis = analyseChessGame(play(newGame(), "e2e4", "e7e5", "g1f3"), FAST);
    expect(analysis.plies.map((ply) => ply.color)).toEqual(["w", "b", "w"]);
  }, 30_000);

  it("records the position each move was played in", () => {
    const analysis = analyseChessGame(play(newGame(), "e2e4", "e7e5"), FAST);
    // The *first* ply's position is the opening, not the position after e4.
    expect(analysis.plies[0]?.fen).toContain("rnbqkbnr/pppppppp");
    expect(analysis.plies[1]?.fen).toContain(" b ");
  }, 30_000);

  it("never reports a negative loss", () => {
    // A move better than the engine's own pick is still zero loss, not a bonus.
    const analysis = analyseChessGame(play(newGame(), "e2e4", "e7e5", "g1f3", "b8c6"), FAST);
    for (const ply of analysis.plies) expect(ply.lossCentipawns).toBeGreaterThanOrEqual(0);
  }, 30_000);

  it("calls a move the engine would have played `best`, at no loss", () => {
    const analysis = analyseChessGame(play(newGame(), "e2e4", "e7e5"), FAST);
    for (const ply of analysis.plies) {
      if (ply.quality !== "best") continue;
      expect(ply.lossCentipawns).toBe(0);
      expect(ply.bestSan).toBeUndefined();
    }
  }, 30_000);

  it("calls a forced move `best`, since there was nothing else to play", () => {
    // Black's king must take: no other legal move exists.
    const game = play(newGame("7k/8/8/8/8/8/5r2/7K w - - 0 1"), "h1g1");
    const analysis = analyseChessGame(game, FAST);
    expect(analysis.plies[0]?.quality).toBe("best");
  }, 30_000);

  it("names a blunder that throws a queen away", () => {
    // White has a queen on d1 and plays it to d5 where a pawn takes it for nothing.
    const game = play(newGame("4k3/8/2p5/8/8/8/8/3QK3 w - - 0 1"), "d1d5");
    const analysis = analyseChessGame(game, FAST);

    const ply = analysis.plies[0]!;
    expect(ply.quality).toBe("blunder");
    expect(ply.lossCentipawns).toBeGreaterThanOrEqual(CHESS_QUALITY_THRESHOLDS.blunder);
    expect(ply.bestSan).toBeTruthy();
  }, 30_000);

  it("reports evaluations in White's frame throughout", () => {
    // White a queen up: every point should read strongly positive whoever is to move,
    // because a line that flipped frame each turn would zig-zag and show nothing.
    const game = play(newGame("4k3/8/8/8/8/8/8/3QK3 w - - 0 1"), "d1d4", "e8e7");
    const analysis = analyseChessGame(game, FAST);
    for (const ply of analysis.plies) {
      expect(ply.evalBefore).toBeGreaterThan(0);
      expect(ply.evalAfter).toBeGreaterThan(0);
    }
  }, 30_000);

  it("scores a checkmate as lost for the mated side rather than as material", () => {
    // With no legal moves the search has nothing to search, so a terminal position has
    // to be decided outright — otherwise mate is scored on material and the mating move
    // looks like a blunder.
    const mate = play(newGame(), "f2f3", "e7e5", "g2g4", "d8h4");
    const analysis = analyseChessGame(mate, FAST);

    const last = analysis.plies.at(-1)!;
    expect(last.san).toBe("Qh4#");
    expect(last.color).toBe("b");
    // Black delivered mate, so in White's frame the position is as lost as it gets.
    expect(last.evalAfter).toBeLessThan(0);
    expect(last.quality).not.toBe("blunder");
  }, 30_000);

  it("reports progress for every position, ending at the total", () => {
    const game = play(newGame(), "e2e4", "e7e5");
    const seen: { scored: number; total: number }[] = [];
    analyseChessGame(game, { ...FAST, onProgress: (scored, total) => seen.push({ scored, total }) });

    // Three positions for two moves: one before each, and the one left at the end.
    expect(seen.at(-1)).toEqual({ scored: 3, total: 3 });
    expect(seen.map((entry) => entry.scored)).toEqual([1, 2, 3]);
  }, 30_000);

  it("stops when asked and says the result is partial", () => {
    const game = play(newGame(), "e2e4", "e7e5", "g1f3", "b8c6");
    let scored = 0;
    const analysis = analyseChessGame(game, {
      ...FAST,
      onProgress: () => {
        scored += 1;
      },
      shouldStop: () => scored >= 2,
    });

    expect(analysis.partial).toBe(true);
    // Two positions scored judges only the one move between them.
    expect(analysis.plies.length).toBeLessThan(game.moves.length);
  }, 30_000);

  it("returns an empty report for a game with no moves", () => {
    const analysis = analyseChessGame(newGame(), FAST);
    expect(analysis.plies).toEqual([]);
    expect(analysis.partial).toBe(false);
    expect(analysis.summary.averageLoss).toEqual({ w: 0, b: 0 });
  });

  it("carries the speed it was run at, so the screen can say so", () => {
    expect(analyseChessGame(play(newGame(), "e2e4"), { speed: "careful" }).speed).toBe("careful");
  }, 30_000);
});

describe("summarise", () => {
  const ply = (overrides: Partial<ChessAnalysedPly>): ChessAnalysedPly => ({
    index: 0,
    color: "w",
    san: "e4",
    uci: "e2e4",
    fen: "",
    evalBefore: 0,
    evalAfter: 0,
    lossCentipawns: 0,
    quality: "good",
    ...overrides,
  });

  it("counts each label per side", () => {
    const summary = summarise([
      ply({ color: "w", quality: "blunder", lossCentipawns: 400 }),
      ply({ color: "w", quality: "good" }),
      ply({ color: "b", quality: "best" }),
    ]);

    expect(summary.counts.w.blunder).toBe(1);
    expect(summary.counts.w.good).toBe(1);
    expect(summary.counts.b.best).toBe(1);
    expect(summary.counts.b.blunder).toBe(0);
  });

  it("averages the loss over that side's own moves only", () => {
    const summary = summarise([
      ply({ color: "w", lossCentipawns: 100 }),
      ply({ color: "w", lossCentipawns: 300 }),
      ply({ color: "b", lossCentipawns: 0 }),
    ]);

    expect(summary.averageLoss.w).toBe(200);
    expect(summary.averageLoss.b).toBe(0);
  });

  it("reports zero rather than dividing by no moves", () => {
    expect(summarise([]).averageLoss).toEqual({ w: 0, b: 0 });
  });
});

describe("chessEvalSeries", () => {
  it("opens with the position before any move was played", () => {
    const analysis = analyseChessGame(play(newGame(), "e2e4", "e7e5"), FAST);
    const points = chessEvalSeries(analysis);

    // One more point than moves: the starting position, then one per move.
    expect(points).toHaveLength(analysis.plies.length + 1);
    expect(points[0]).toMatchObject({ ply: 0 });
  }, 30_000);

  it("reports pawns, not centipawns", () => {
    const points = chessEvalSeries({
      speed: "fast",
      partial: false,
      summary: summarise([]),
      plies: [
        {
          index: 0,
          color: "w",
          san: "e4",
          uci: "e2e4",
          fen: "",
          evalBefore: 150,
          evalAfter: -250,
          lossCentipawns: 400,
          quality: "blunder",
        },
      ],
    });

    expect(points[0]?.evaluation).toBe(1.5);
    expect(points[1]?.evaluation).toBe(-2.5);
  });

  it("is empty for an empty analysis", () => {
    expect(chessEvalSeries({ speed: "fast", partial: false, plies: [], summary: summarise([]) })).toEqual(
      [],
    );
  });
});

describe("chessPlyColor", () => {
  it("alternates from whoever moved first", () => {
    expect(chessPlyColor("w", 0)).toBe("w");
    expect(chessPlyColor("w", 1)).toBe("b");
    expect(chessPlyColor("b", 0)).toBe("b");
    expect(chessPlyColor("b", 3)).toBe("w");
  });
});
