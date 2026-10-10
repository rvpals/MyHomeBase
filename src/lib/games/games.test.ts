import { describe, expect, it } from "vitest";
import {
  arrowBestScores,
  formatScore,
  getGame,
  listAvailableGames,
  listGames,
  listRecentScores,
  listTopScores,
  recordScore,
  scoreCardKey,
  scoreGameName,
} from "./games";
import type { ScoreRepository } from "./ports";
import type { ScoreWriteData } from "./schema";
import { ARROW_DIFFICULTIES, ARROW_DIFFICULTY_SETUP, type Score } from "./types";

/** An in-memory ScoreRepository, so the use-cases are tested without SQLite. */
function fakeRepo(seed: Score[] = []): ScoreRepository & { rows: Score[] } {
  const rows = [...seed];
  return {
    rows,
    recordScore(input: ScoreWriteData): Score {
      const created: Score = {
        id: rows.length + 1,
        gameKey: input.gameKey,
        userId: input.userId,
        userName: `User ${input.userId}`,
        score: input.score,
        moves: input.moves,
        playedAt: input.playedAt,
        createdAt: input.playedAt,
      };
      rows.push(created);
      return created;
    },
    listTopScores(gameKey, limit) {
      return rows
        .filter((row) => gameKey === undefined || row.gameKey === gameKey)
        .sort((a, b) => b.score - a.score || a.playedAt.localeCompare(b.playedAt))
        .slice(0, limit);
    },
    listRecentScores(limit) {
      return [...rows].sort((a, b) => b.playedAt.localeCompare(a.playedAt)).slice(0, limit);
    },
    getBestScore(gameKey) {
      return this.listTopScores(gameKey, 1)[0];
    },
    countScores(gameKey) {
      return rows.filter((row) => row.gameKey === gameKey).length;
    },
  };
}

function score(overrides: Partial<Score> = {}): Score {
  return {
    id: 1,
    gameKey: "2048",
    userId: 7,
    userName: "Min",
    score: 1000,
    moves: 50,
    playedAt: "2026-08-30T10:00:00.000Z",
    createdAt: "2026-08-30T10:00:00.000Z",
    ...overrides,
  };
}

describe("recordScore", () => {
  it("stores a validated score and stamps when it was played", () => {
    const repo = fakeRepo();
    const created = recordScore(repo, { gameKey: "2048", userId: 7, score: 2048, moves: 120 });

    expect(created.score).toBe(2048);
    expect(created.gameKey).toBe("2048");
    expect(created.playedAt).not.toBe("");
    expect(repo.rows).toHaveLength(1);
  });

  it("defaults moves to 0 when not supplied", () => {
    const created = recordScore(fakeRepo(), { gameKey: "2048", userId: 7, score: 4 });
    expect(created.moves).toBe(0);
  });

  it("accepts a score of 0 — a game lost without a single merge still counts", () => {
    expect(recordScore(fakeRepo(), { gameKey: "2048", userId: 7, score: 0 }).score).toBe(0);
  });

  it("rejects a game the catalogue does not know", () => {
    // The guard that stands in for the missing foreign key on game_key.
    expect(() => recordScore(fakeRepo(), { gameKey: "pong", userId: 7, score: 10 })).toThrow();
  });

  it("rejects a negative score", () => {
    expect(() => recordScore(fakeRepo(), { gameKey: "2048", userId: 7, score: -5 })).toThrow();
  });

  it("rejects a missing or invalid user", () => {
    expect(() => recordScore(fakeRepo(), { gameKey: "2048", userId: 0, score: 10 })).toThrow();
    expect(() => recordScore(fakeRepo(), { gameKey: "2048", score: 10 })).toThrow();
  });

  it("ignores a caller-supplied playedAt rather than trusting it", () => {
    // A backdated timestamp would win every tie-break, so the use-case sets its own.
    const created = recordScore(fakeRepo(), {
      gameKey: "2048",
      userId: 7,
      score: 10,
      playedAt: "1999-01-01T00:00:00.000Z",
    });
    expect(created.playedAt.startsWith("1999")).toBe(false);
  });
});

describe("listTopScores", () => {
  const repo = fakeRepo([
    score({ id: 1, score: 500, userName: "A", playedAt: "2026-08-01T00:00:00.000Z" }),
    score({ id: 2, score: 900, userName: "B", playedAt: "2026-08-02T00:00:00.000Z" }),
    score({ id: 3, score: 900, userName: "C", playedAt: "2026-08-03T00:00:00.000Z" }),
  ]);

  it("returns the highest scores first", () => {
    expect(listTopScores(repo).map((row) => row.score)).toEqual([900, 900, 500]);
  });

  it("breaks a tie in favour of whoever got there first", () => {
    expect(listTopScores(repo).slice(0, 2).map((row) => row.userName)).toEqual(["B", "C"]);
  });

  it("honours a limit", () => {
    expect(listTopScores(repo, { limit: 1 })).toHaveLength(1);
  });

  it("defaults to a limit of 10", () => {
    expect(listTopScores(repo, {})).toHaveLength(3);
  });

  it("rejects an unknown game key", () => {
    expect(() => listTopScores(repo, { gameKey: "pong" })).toThrow();
  });

  it("rejects a limit above the cap", () => {
    expect(() => listTopScores(repo, { limit: 1000 })).toThrow();
  });
});

describe("listGames", () => {
  it("summarises every catalogue game with its best score and play count", () => {
    const repo = fakeRepo([score({ score: 300 }), score({ id: 2, score: 700 })]);
    const summaries = listGames(repo);

    const game2048 = summaries.find((entry) => entry.game.key === "2048");
    expect(game2048?.best?.score).toBe(700);
    expect(game2048?.played).toBe(2);
  });

  it("reports a never-played game as undefined rather than omitting it", () => {
    const summary = listGames(fakeRepo()).find((entry) => entry.game.key === "2048");
    expect(summary).toBeDefined();
    expect(summary?.best).toBeUndefined();
    expect(summary?.played).toBe(0);
  });
});

describe("listRecentScores", () => {
  it("returns the newest games first", () => {
    const repo = fakeRepo([
      score({ id: 1, playedAt: "2026-08-01T00:00:00.000Z" }),
      score({ id: 2, playedAt: "2026-08-05T00:00:00.000Z" }),
    ]);
    expect(listRecentScores(repo).map((row) => row.id)).toEqual([2, 1]);
  });
});

describe("the catalogue", () => {
  it("finds a known game and misses an unknown one", () => {
    expect(getGame("2048")?.name).toBe("2048");
    expect(getGame("pong")).toBeUndefined();
  });

  it("lists 2048 as playable", () => {
    expect(listAvailableGames().map((game) => game.key)).toContain("2048");
  });

  it("has no duplicate keys — a key is stored, so a clash would merge two boards", () => {
    const keys = listGames(fakeRepo()).map((entry) => entry.game.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("accepts every Arrow Clearing tier as a recordable key", () => {
    /*
      The tiers are scoreboard keys with no catalogue entry of their own, so the
      catalogue-only version of `isKnownGame` rejected them — and `recordScoreSchema`
      uses it, which would have silently refused to save every Harder and Nightmare
      result while the game itself looked like it was working.
    */
    const repo = fakeRepo();
    for (const tier of ARROW_DIFFICULTIES) {
      const key = ARROW_DIFFICULTY_SETUP[tier].gameKey;
      expect(() => recordScore(repo, { gameKey: key, userId: 7, score: 100 })).not.toThrow();
    }
  });

  it("still refuses a key that merely looks like an Arrow Clearing tier", () => {
    // The guard enumerates the tiers rather than matching a prefix, so an invented
    // `arrow-clearing-*` key cannot open a leaderboard nobody can play.
    const repo = fakeRepo();
    expect(() =>
      recordScore(repo, { gameKey: "arrow-clearing-trivial", userId: 7, score: 100 }),
    ).toThrow();
  });
});

describe("formatScore", () => {
  it("labels a points game", () => {
    expect(formatScore("2048", 2048)).toBe("2,048 pts");
  });

  it("falls back to a bare number for a retired game", () => {
    // A scoreboard row for a game no longer in the catalogue must still render.
    expect(formatScore("pong", 1500)).toBe("1,500");
  });

  it("labels an Arrow Clearing tier that has no catalogue entry of its own", () => {
    // The three tiers post to three keys behind one card, so only the entry tier's key
    // is in the catalogue. Without `scoreCardKey` this fell through to the bare-number
    // branch and a Nightmare score lost its unit.
    expect(formatScore("arrow-clearing-nightmare", 1500)).toBe("1,500 pts");
  });
});

describe("scoreCardKey and scoreGameName", () => {
  it("maps every Arrow Clearing tier back to the one card", () => {
    for (const tier of ARROW_DIFFICULTIES) {
      const key = ARROW_DIFFICULTY_SETUP[tier].gameKey;
      expect(scoreCardKey(key)).toBe("arrow-clearing-hard");
      // The catalogue must actually hold what we map to, or the name and the icon slot
      // both fall back to the raw key.
      expect(getGame(scoreCardKey(key))).toBeDefined();
    }
  });

  it("leaves a non-arrow key alone", () => {
    expect(scoreCardKey("2048")).toBe("2048");
    expect(scoreGameName("2048")).toBe("2048");
  });

  it("names each tier distinctly, so three leaderboards do not read as one", () => {
    const names = ARROW_DIFFICULTIES.map((tier) =>
      scoreGameName(ARROW_DIFFICULTY_SETUP[tier].gameKey),
    );
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("Arrow Clearing — Nightmare");
  });

  it("falls back to the raw key for a retired game", () => {
    // A score outlives its game leaving the catalogue; the row must still render.
    expect(scoreGameName("pong")).toBe("pong");
  });
});

describe("arrowBestScores", () => {
  it("reports a best per tier, not per card", () => {
    const repo = fakeRepo([
      score({ id: 1, gameKey: "arrow-clearing-hard", score: 500 }),
      score({ id: 2, gameKey: "arrow-clearing-hard", score: 900 }),
      score({ id: 3, gameKey: "arrow-clearing-nightmare", score: 300 }),
    ]);

    const bests = arrowBestScores(repo);

    expect(bests.hard).toBe(900);
    expect(bests.nightmare).toBe(300);
    // Reported as 0 rather than undefined, so the view has a number to render.
    expect(bests.harder).toBe(0);
  });

  it("covers every tier, so a new one cannot be missed", () => {
    const bests = arrowBestScores(fakeRepo());
    for (const tier of ARROW_DIFFICULTIES) {
      expect(bests[tier]).toBe(0);
    }
  });
});
