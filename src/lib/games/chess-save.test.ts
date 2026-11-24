import { describe, expect, it } from "vitest";
import {
  autosaveChessGame,
  buildChessSave,
  deleteChessGame,
  discardChessAutosave,
  listChessGames,
  loadChessAutosave,
  loadChessGame,
  restoreChessGame,
  saveChessGame,
} from "./chess-save";
import { playChessMove, startChessGame } from "./game-chess";
import type { ChessSaveRepository, SavedRunRepository } from "./ports";
import type { SavedRunWriteData } from "./schema";
import {
  CHESS_GAME_KEY,
  CHESS_SAVE_VERSION,
  MAX_CHESS_SAVES_PER_PLAYER,
  type ChessGame,
  type ChessSaveWriteData,
  type StoredChessSave,
  type StoredSavedRun,
} from "./types";

/**
 * In-memory stand-ins for the two stores, hand-written rather than mocked — the
 * project's rule, and here it also means a test can assert what was actually written
 * rather than which methods were called.
 */
class FakeChessSaveRepository implements ChessSaveRepository {
  rows: StoredChessSave[] = [];
  private nextId = 1;

  listChessSaves(userId: number): StoredChessSave[] {
    return this.rows
      .filter((row) => row.userId === userId)
      .sort((left, right) => right.savedAt.localeCompare(left.savedAt));
  }

  getChessSave(userId: number, id: number): StoredChessSave | undefined {
    return this.rows.find((row) => row.userId === userId && row.id === id);
  }

  findChessSaveByName(userId: number, name: string): StoredChessSave | undefined {
    return this.rows.find(
      (row) => row.userId === userId && row.name.toLowerCase() === name.toLowerCase(),
    );
  }

  upsertChessSave(input: ChessSaveWriteData): number {
    const existing = this.findChessSaveByName(input.userId, input.name);
    if (existing) {
      existing.state = input.state;
      existing.formatVersion = input.formatVersion;
      existing.savedAt = input.savedAt;
      return existing.id;
    }
    const row: StoredChessSave = {
      id: this.nextId++,
      userId: input.userId,
      name: input.name,
      formatVersion: input.formatVersion,
      state: input.state,
      savedAt: input.savedAt,
      createdAt: input.savedAt,
    };
    this.rows.push(row);
    return row.id;
  }

  deleteChessSave(userId: number, id: number): boolean {
    const index = this.rows.findIndex((row) => row.userId === userId && row.id === id);
    if (index < 0) return false;
    this.rows.splice(index, 1);
    return true;
  }

  countChessSaves(userId: number): number {
    return this.rows.filter((row) => row.userId === userId).length;
  }
}

class FakeSavedRunRepository implements SavedRunRepository {
  rows: StoredSavedRun[] = [];

  getSavedRun(userId: number, gameKey: string): StoredSavedRun | undefined {
    return this.rows.find((row) => row.userId === userId && row.gameKey === gameKey);
  }

  upsertSavedRun(input: SavedRunWriteData): void {
    const existing = this.getSavedRun(input.userId, input.gameKey);
    if (existing) {
      existing.state = input.state;
      existing.formatVersion = input.formatVersion;
      existing.savedAt = input.savedAt;
      return;
    }
    this.rows.push({ ...input, userName: "Tester" });
  }

  deleteSavedRun(userId: number, gameKey: string): boolean {
    const index = this.rows.findIndex(
      (row) => row.userId === userId && row.gameKey === gameKey,
    );
    if (index < 0) return false;
    this.rows.splice(index, 1);
    return true;
  }

  listSavedRuns(userId: number | undefined): StoredSavedRun[] {
    return userId === undefined ? this.rows : this.rows.filter((row) => row.userId === userId);
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

function gameInProgress(): ChessGame {
  return play(
    startChessGame({ humanColor: "w", level: "intermediate" }),
    "e2e4",
    "e7e5",
    "g1f3",
  );
}

describe("buildChessSave and restoreChessGame", () => {
  it("round-trips a game", () => {
    const original = gameInProgress();
    const restored = restoreChessGame(buildChessSave(original));

    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.game.position).toEqual(original.position);
    expect(restored.game.moves).toEqual(original.moves);
    expect(restored.game.humanColor).toBe("w");
    expect(restored.game.level).toBe("intermediate");
    expect(restored.game.status).toBe(original.status);
  });

  it("stores the moves rather than the board", () => {
    const save = buildChessSave(gameInProgress());
    expect(save.moves).toEqual(["e2e4", "e7e5", "g1f3"]);
    expect(Object.keys(save).sort()).toEqual([
      "humanColor",
      "initialFen",
      "level",
      "moves",
      "version",
    ]);
  });

  it("refuses something that is not a chess save", () => {
    for (const bad of [undefined, null, 42, "e2e4", {}, { version: 1 }, []]) {
      expect(restoreChessGame(bad).ok, JSON.stringify(bad) ?? "undefined").toBe(false);
    }
  });

  it("refuses a save whose moves are not legal", () => {
    // The guarantee the whole format rests on: an edited row is refused rather than
    // producing an impossible board.
    const save = { ...buildChessSave(gameInProgress()), moves: ["e2e4", "a8a1"] };
    const restored = restoreChessGame(save);
    expect(restored.ok).toBe(false);
    if (restored.ok) return;
    expect(restored.reason).toMatch(/2/);
  });

  it("carries a clock through the round trip", () => {
    const timed = play(
      startChessGame({ humanColor: "w", level: "intermediate", timeControl: "5+0" }),
      "e2e4",
    );
    const restored = restoreChessGame(buildChessSave(timed));

    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.game.clock).toEqual(timed.clock);
  });

  it("leaves the clock out of an untimed save entirely", () => {
    // So an untimed game's save is byte-identical to one written before clocks existed.
    expect(buildChessSave(gameInProgress())).not.toHaveProperty("clock");
  });

  it("loads a save written before clocks existed as an untimed game", () => {
    // The compatibility case: an older row has no `clock` field at all, and must still
    // parse and restore rather than being reported as unreadable.
    const older = { ...buildChessSave(gameInProgress()) };
    delete (older as { clock?: unknown }).clock;

    const restored = restoreChessGame(older);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.game.clock).toBeUndefined();
  });

  it("refuses a clock claiming an impossible amount of time", () => {
    const save = {
      ...buildChessSave(gameInProgress()),
      clock: { control: "3+2", remainingMs: { w: 999_999_999, b: 1_000 } },
    };
    expect(restoreChessGame(save).ok).toBe(false);
  });

  it("refuses a clock on a control it does not know", () => {
    const save = {
      ...buildChessSave(gameInProgress()),
      clock: { control: "90+30", remainingMs: { w: 1_000, b: 1_000 } },
    };
    expect(restoreChessGame(save).ok).toBe(false);
  });

  it("carries assists through the round trip", () => {
    const assisted = { ...gameInProgress(), hintsUsed: 2, takebacksUsed: 1 };
    const restored = restoreChessGame(buildChessSave(assisted));

    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    // Stored, so closing and reloading cannot wash the penalty off a score.
    expect(restored.game.hintsUsed).toBe(2);
    expect(restored.game.takebacksUsed).toBe(1);
  });

  it("leaves assists out of an unassisted save", () => {
    const save = buildChessSave(gameInProgress());
    expect(save).not.toHaveProperty("hintsUsed");
    expect(save).not.toHaveProperty("takebacksUsed");
  });

  it("restores an older save with no assist fields as unassisted", () => {
    const older = buildChessSave(gameInProgress());
    const restored = restoreChessGame(older);
    expect(restored.ok && restored.game.hintsUsed).toBe(0);
  });

  it("refuses a save written by a different version", () => {
    const save = { ...buildChessSave(gameInProgress()), version: CHESS_SAVE_VERSION + 1 };
    expect(restoreChessGame(save).ok).toBe(false);
  });

  it("refuses a move that is not even coordinate notation", () => {
    const save = { ...buildChessSave(gameInProgress()), moves: ["castle kingside"] };
    expect(restoreChessGame(save).ok).toBe(false);
  });
});

describe("saveChessGame", () => {
  const input = (overrides: Record<string, unknown> = {}) => ({
    userId: 1,
    name: "Sunday game",
    save: buildChessSave(gameInProgress()),
    ...overrides,
  });

  it("writes the game and reports its id", () => {
    const repo = new FakeChessSaveRepository();
    const result = saveChessGame(repo, input());

    expect(result.id).toBeGreaterThan(0);
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]!.name).toBe("Sunday game");
    expect(repo.rows[0]!.formatVersion).toBe(CHESS_SAVE_VERSION);
  });

  it("replaces a save of the same name instead of adding a second", () => {
    const repo = new FakeChessSaveRepository();
    const first = saveChessGame(repo, input());
    const second = saveChessGame(repo, input({ save: buildChessSave(play(gameInProgress(), "b8c6")) }));

    expect(second.id).toBe(first.id);
    expect(repo.rows).toHaveLength(1);
  });

  it("treats a name as the same save whatever its case", () => {
    const repo = new FakeChessSaveRepository();
    saveChessGame(repo, input({ name: "Sunday game" }));
    saveChessGame(repo, input({ name: "SUNDAY GAME" }));
    expect(repo.rows).toHaveLength(1);
  });

  it("refuses a game that has already finished", () => {
    // The point of a save is to come back to it; a stored checkmate is a game nobody
    // can continue.
    //
    // Checkmate rather than a resignation, and the difference is worth knowing: a save
    // is the moves, so the replay rediscovers a mate but **cannot** rediscover a
    // resignation — nothing about resigning appears in the move list. That is not a
    // hole in practice, because the board disables Save once a game is over; this
    // guard is the backstop for an ending the moves do carry.
    const repo = new FakeChessSaveRepository();
    const mated = play(
      startChessGame({ humanColor: "w", level: "beginner" }),
      "f2f3",
      "e7e5",
      "g2g4",
      "d8h4",
    );
    expect(() => saveChessGame(repo, input({ save: buildChessSave(mated) }))).toThrow(/finished/i);
    expect(repo.rows).toHaveLength(0);
  });

  it("refuses a save it could not replay, before writing anything", () => {
    const repo = new FakeChessSaveRepository();
    const broken = { ...buildChessSave(gameInProgress()), moves: ["e2e4", "a8a1"] };
    expect(() => saveChessGame(repo, input({ save: broken }))).toThrow();
    expect(repo.rows).toHaveLength(0);
  });

  it("refuses a blank name", () => {
    const repo = new FakeChessSaveRepository();
    expect(() => saveChessGame(repo, input({ name: "   " }))).toThrow();
  });

  it("stops at the per-player cap", () => {
    const repo = new FakeChessSaveRepository();
    for (let index = 0; index < MAX_CHESS_SAVES_PER_PLAYER; index += 1) {
      saveChessGame(repo, input({ name: `Game ${index}` }));
    }
    expect(() => saveChessGame(repo, input({ name: "One too many" }))).toThrow(/Delete one/i);
  });

  it("still lets a player at the cap save over an existing game", () => {
    // Otherwise the cap would block finishing a game already in progress, which is the
    // one thing it must never do.
    const repo = new FakeChessSaveRepository();
    for (let index = 0; index < MAX_CHESS_SAVES_PER_PLAYER; index += 1) {
      saveChessGame(repo, input({ name: `Game ${index}` }));
    }
    expect(() => saveChessGame(repo, input({ name: "Game 0" }))).not.toThrow();
    expect(repo.countChessSaves(1)).toBe(MAX_CHESS_SAVES_PER_PLAYER);
  });

  it("counts each player's saves separately", () => {
    const repo = new FakeChessSaveRepository();
    saveChessGame(repo, input({ userId: 1, name: "Mine" }));
    saveChessGame(repo, input({ userId: 2, name: "Mine" }));
    expect(repo.countChessSaves(1)).toBe(1);
    expect(repo.countChessSaves(2)).toBe(1);
  });
});

describe("loadChessGame", () => {
  it("restores a game that was saved", () => {
    const repo = new FakeChessSaveRepository();
    const original = gameInProgress();
    const { id } = saveChessGame(repo, {
      userId: 1,
      name: "Sunday game",
      save: buildChessSave(original),
    });

    const loaded = loadChessGame(repo, { userId: 1, id });
    expect(loaded.name).toBe("Sunday game");
    expect(loaded.game.position).toEqual(original.position);
    expect(loaded.game.moves).toEqual(original.moves);
  });

  it("will not load another player's save", () => {
    const repo = new FakeChessSaveRepository();
    const { id } = saveChessGame(repo, {
      userId: 1,
      name: "Private",
      save: buildChessSave(gameInProgress()),
    });
    expect(() => loadChessGame(repo, { userId: 2, id })).toThrow(/no longer there/i);
  });

  it("reports a damaged save rather than deleting it", () => {
    // The opposite of the autosave's rule, and deliberately: a game somebody named and
    // kept must not be destroyed because this build could not read it.
    const repo = new FakeChessSaveRepository();
    const { id } = saveChessGame(repo, {
      userId: 1,
      name: "Broken",
      save: buildChessSave(gameInProgress()),
    });
    repo.rows[0]!.state = "{not json";

    expect(() => loadChessGame(repo, { userId: 1, id })).toThrow();
    expect(repo.rows).toHaveLength(1);
  });
});

describe("listChessGames", () => {
  it("summarises without replaying the moves", () => {
    const repo = new FakeChessSaveRepository();
    saveChessGame(repo, {
      userId: 1,
      name: "Sunday game",
      save: buildChessSave(gameInProgress()),
    });

    const [summary] = listChessGames(repo, { userId: 1 });
    expect(summary).toMatchObject({
      name: "Sunday game",
      level: "intermediate",
      humanColor: "w",
      moveCount: 3,
      readable: true,
    });
  });

  it("lists a damaged save as unreadable rather than dropping it", () => {
    // Visible, so it can be deleted. A row that silently vanished would leave the
    // player's list short with nothing to act on.
    const repo = new FakeChessSaveRepository();
    saveChessGame(repo, { userId: 1, name: "Broken", save: buildChessSave(gameInProgress()) });
    repo.rows[0]!.state = "{not json";

    const [summary] = listChessGames(repo, { userId: 1 });
    expect(summary?.readable).toBe(false);
    expect(summary?.name).toBe("Broken");
  });

  it("shows only the asking player's games", () => {
    const repo = new FakeChessSaveRepository();
    saveChessGame(repo, { userId: 1, name: "Mine", save: buildChessSave(gameInProgress()) });
    saveChessGame(repo, { userId: 2, name: "Theirs", save: buildChessSave(gameInProgress()) });

    expect(listChessGames(repo, { userId: 1 }).map((row) => row.name)).toEqual(["Mine"]);
  });
});

describe("deleteChessGame", () => {
  it("removes one of the player's saves", () => {
    const repo = new FakeChessSaveRepository();
    const { id } = saveChessGame(repo, {
      userId: 1,
      name: "Sunday game",
      save: buildChessSave(gameInProgress()),
    });

    expect(deleteChessGame(repo, { userId: 1, id })).toBe(true);
    expect(repo.rows).toHaveLength(0);
  });

  it("will not remove another player's", () => {
    const repo = new FakeChessSaveRepository();
    const { id } = saveChessGame(repo, {
      userId: 1,
      name: "Private",
      save: buildChessSave(gameInProgress()),
    });

    expect(deleteChessGame(repo, { userId: 2, id })).toBe(false);
    expect(repo.rows).toHaveLength(1);
  });
});

describe("the autosave", () => {
  it("writes under the chess game key and replaces itself", () => {
    const repo = new FakeSavedRunRepository();
    autosaveChessGame(repo, { userId: 1, save: buildChessSave(gameInProgress()) });
    autosaveChessGame(repo, {
      userId: 1,
      save: buildChessSave(play(gameInProgress(), "b8c6")),
    });

    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]!.gameKey).toBe(CHESS_GAME_KEY);
  });

  it("loads back the game that was written", () => {
    const repo = new FakeSavedRunRepository();
    const original = gameInProgress();
    autosaveChessGame(repo, { userId: 1, save: buildChessSave(original) });

    const loaded = loadChessAutosave(repo, { userId: 1 });
    expect(loaded?.game.position).toEqual(original.position);
    expect(loaded?.savedAt).toBeTruthy();
  });

  it("reports nothing when there is no autosave", () => {
    expect(loadChessAutosave(new FakeSavedRunRepository(), { userId: 1 })).toBeUndefined();
  });

  it("deletes an autosave it cannot restore, rather than failing forever", () => {
    // The Arrow Clearing rule: an unresumable autosave would otherwise offer the player
    // the same broken Resume prompt every single time.
    const repo = new FakeSavedRunRepository();
    autosaveChessGame(repo, { userId: 1, save: buildChessSave(gameInProgress()) });
    repo.rows[0]!.state = "{not json";

    expect(loadChessAutosave(repo, { userId: 1 })).toBeUndefined();
    expect(repo.rows).toHaveLength(0);
  });

  it("deletes an autosave written by another version", () => {
    const repo = new FakeSavedRunRepository();
    autosaveChessGame(repo, { userId: 1, save: buildChessSave(gameInProgress()) });
    repo.rows[0]!.formatVersion = CHESS_SAVE_VERSION + 1;

    expect(loadChessAutosave(repo, { userId: 1 })).toBeUndefined();
    expect(repo.rows).toHaveLength(0);
  });

  it("deletes an autosave of a game that has finished", () => {
    // Nothing to resume, so offering it would be a Resume button that reopens a
    // checkmate.
    const repo = new FakeSavedRunRepository();
    const over = play(
      startChessGame({ humanColor: "w", level: "beginner" }),
      "f2f3",
      "e7e5",
      "g2g4",
      "d8h4",
    );
    repo.upsertSavedRun({
      userId: 1,
      gameKey: CHESS_GAME_KEY,
      formatVersion: CHESS_SAVE_VERSION,
      state: JSON.stringify(buildChessSave(over)),
      savedAt: new Date().toISOString(),
    });

    expect(loadChessAutosave(repo, { userId: 1 })).toBeUndefined();
    expect(repo.rows).toHaveLength(0);
  });

  it("does not read another player's autosave", () => {
    const repo = new FakeSavedRunRepository();
    autosaveChessGame(repo, { userId: 1, save: buildChessSave(gameInProgress()) });
    expect(loadChessAutosave(repo, { userId: 2 })).toBeUndefined();
  });

  it("is discarded on request", () => {
    const repo = new FakeSavedRunRepository();
    autosaveChessGame(repo, { userId: 1, save: buildChessSave(gameInProgress()) });

    expect(discardChessAutosave(repo, { userId: 1 })).toBe(true);
    expect(discardChessAutosave(repo, { userId: 1 })).toBe(false);
  });
});
