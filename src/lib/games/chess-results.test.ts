import { describe, expect, it } from "vitest";
import {
  chessRecordGames,
  chessResultOf,
  formatChessRecord,
  listChessRecords,
  playedChessLevels,
  recordChessResult,
} from "./chess-results";
import {
  agreeChessDraw,
  flagChessGame,
  playChessMove,
  resignChessGame,
  startChessGame,
} from "./game-chess";
import type { ChessResultRepository } from "./ports";
import {
  CHESS_LEVELS,
  type ChessGame,
  type ChessLevel,
  type ChessResult,
  type ChessResultWriteData,
} from "./types";

/** An in-memory stand-in, hand-written rather than mocked — the project's rule. */
class FakeChessResultRepository implements ChessResultRepository {
  rows: ChessResultWriteData[] = [];

  recordChessResult(input: ChessResultWriteData): void {
    this.rows.push(input);
  }

  countChessResults(
    userId: number,
  ): Partial<Record<ChessLevel, Record<ChessResult, number>>> {
    const counted: Partial<Record<ChessLevel, Record<ChessResult, number>>> = {};
    for (const row of this.rows) {
      if (row.userId !== userId) continue;
      const level = (counted[row.level] ??= { win: 0, loss: 0, draw: 0 });
      level[row.result] += 1;
    }
    return counted;
  }
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

const newGame = (overrides: Partial<Parameters<typeof startChessGame>[0]> = {}) =>
  startChessGame({ humanColor: "w", level: "intermediate", ...overrides });

const SCHOLARS_MATE = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"];
const FOOLS_MATE = ["f2f3", "e7e5", "g2g4", "d8h4"];

describe("chessResultOf", () => {
  it("reads a win, a loss and a draw from the player's point of view", () => {
    expect(chessResultOf(play(newGame({ humanColor: "w" }), ...SCHOLARS_MATE))).toBe("win");
    expect(chessResultOf(play(newGame({ humanColor: "w" }), ...FOOLS_MATE))).toBe("loss");
    expect(chessResultOf(agreeChessDraw(play(newGame(), "e2e4")))).toBe("draw");
  });

  it("counts a resignation as a loss", () => {
    expect(chessResultOf(resignChessGame(play(newGame(), "e2e4")))).toBe("loss");
  });

  it("reads a flag as whatever the clock made it", () => {
    const timed = startChessGame({
      humanColor: "w",
      level: "intermediate",
      timeControl: "3+2",
    });
    expect(chessResultOf(flagChessGame(timed, "w"))).toBe("loss");
    expect(chessResultOf(flagChessGame(timed, "b"))).toBe("win");
  });

  it("counts a flag against a side that could not mate as a draw", () => {
    // The official rule, and the reason this reads \`winner\` rather than the status.
    const timed = startChessGame({
      humanColor: "w",
      level: "intermediate",
      timeControl: "3+2",
      fen: "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1",
    });
    expect(chessResultOf(flagChessGame(timed, "w"))).toBe("draw");
  });

  it("counts every drawn ending as a draw", () => {
    const stalemate = newGame({ fen: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1" });
    expect(chessResultOf(stalemate)).toBe("draw");
  });

  it("reports nothing for a game still being played", () => {
    expect(chessResultOf(newGame())).toBeUndefined();
    expect(chessResultOf(play(newGame(), "e2e4", "e7e5", "f1b5"))).toBeUndefined();
  });
});

describe("recordChessResult", () => {
  const input = (overrides: Record<string, unknown> = {}) => ({
    userId: 1,
    level: "advanced",
    result: "win",
    moves: 31,
    score: 260,
    ...overrides,
  });

  it("writes the game with a timestamp", () => {
    const repo = new FakeChessResultRepository();
    recordChessResult(repo, input());

    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({ userId: 1, level: "advanced", result: "win" });
    expect(repo.rows[0]?.playedAt).toBeTruthy();
  });

  it("refuses a level or a result it does not know", () => {
    const repo = new FakeChessResultRepository();
    expect(() => recordChessResult(repo, input({ level: "grandmaster" }))).toThrow();
    expect(() => recordChessResult(repo, input({ result: "forfeit" }))).toThrow();
    expect(repo.rows).toHaveLength(0);
  });

  it("refuses a negative score or move count", () => {
    const repo = new FakeChessResultRepository();
    expect(() => recordChessResult(repo, input({ score: -1 }))).toThrow();
    expect(() => recordChessResult(repo, input({ moves: -1 }))).toThrow();
  });

  it("keeps every game, because a player may play the same level to the same end", () => {
    const repo = new FakeChessResultRepository();
    recordChessResult(repo, input());
    recordChessResult(repo, input());
    expect(repo.rows).toHaveLength(2);
  });
});

describe("listChessRecords", () => {
  it("returns every level, even ones never played", () => {
    // So the screen reads 0–0–0 rather than having to tell "no row" from "no games".
    const records = listChessRecords(new FakeChessResultRepository(), { userId: 1 });
    expect(records.map((record) => record.level)).toEqual([...CHESS_LEVELS]);
    for (const record of records) expect(chessRecordGames(record)).toBe(0);
  });

  it("counts wins, losses and draws per level", () => {
    const repo = new FakeChessResultRepository();
    const write = (level: string, result: string) =>
      recordChessResult(repo, { userId: 1, level, result, moves: 20, score: 0 });

    write("advanced", "win");
    write("advanced", "win");
    write("advanced", "loss");
    write("beginner", "draw");

    const records = listChessRecords(repo, { userId: 1 });
    expect(records.find((record) => record.level === "advanced")).toMatchObject({
      wins: 2,
      losses: 1,
      draws: 0,
    });
    expect(records.find((record) => record.level === "beginner")).toMatchObject({
      wins: 0,
      losses: 0,
      draws: 1,
    });
  });

  it("counts only the asking player's games", () => {
    const repo = new FakeChessResultRepository();
    recordChessResult(repo, { userId: 1, level: "advanced", result: "win", moves: 1, score: 0 });
    recordChessResult(repo, { userId: 2, level: "advanced", result: "win", moves: 1, score: 0 });

    const mine = listChessRecords(repo, { userId: 1 });
    expect(mine.find((record) => record.level === "advanced")?.wins).toBe(1);
  });
});

describe("formatChessRecord", () => {
  it("writes wins, losses and draws in that order", () => {
    expect(formatChessRecord({ level: "advanced", wins: 12, losses: 3, draws: 1 })).toBe("12–3–1");
  });

  it("says so rather than printing zeros when nothing has been played", () => {
    expect(formatChessRecord({ level: "advanced", wins: 0, losses: 0, draws: 0 })).toBe(
      "no games yet",
    );
  });
});

describe("playedChessLevels", () => {
  it("lists only the levels with games behind them", () => {
    const records = [
      { level: "beginner" as const, wins: 1, losses: 0, draws: 0 },
      { level: "intermediate" as const, wins: 0, losses: 0, draws: 0 },
      { level: "advanced" as const, wins: 0, losses: 0, draws: 2 },
    ];
    expect(playedChessLevels(records)).toEqual(["beginner", "advanced"]);
  });
});
