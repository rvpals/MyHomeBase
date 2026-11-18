import { describe, expect, it } from "vitest";
import { buildArrowSave } from "./arrow-save";
import type { SavedRunRepository } from "./ports";
import {
  discardArrowRun,
  discardSavedRun,
  listSavedRuns,
  loadArrowRun,
  saveArrowRun,
} from "./saved-runs";
import type { SavedRunWriteData } from "./schema";
import {
  ARROW_DIFFICULTY_SETUP,
  ARROW_SAVE_VERSION,
  type Arrow,
  type ArrowBoard,
  type StoredSavedRun,
} from "./types";

/** An in-memory SavedRunRepository, keyed the way the table's UNIQUE index is. */
function fakeRepo(): SavedRunRepository & { rows: Map<string, StoredSavedRun> } {
  const rows = new Map<string, StoredSavedRun>();
  const key = (userId: number, gameKey: string) => `${userId}:${gameKey}`;
  return {
    rows,
    getSavedRun: (userId, gameKey) => rows.get(key(userId, gameKey)),
    upsertSavedRun(input: SavedRunWriteData) {
      rows.set(key(input.userId, input.gameKey), { ...input, userName: `User ${input.userId}` });
    },
    deleteSavedRun: (userId, gameKey) => rows.delete(key(userId, gameKey)),
    listSavedRuns: (userId) =>
      [...rows.values()]
        .filter((row) => userId === undefined || row.userId === userId)
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
  };
}

function arrow(id: number, cells: [number, number][], direction: Arrow["direction"]): Arrow {
  return { id, cells: cells.map(([row, col]) => ({ row, col })), direction };
}

const HARD_KEY = ARROW_DIFFICULTY_SETUP.hard.gameKey;
const NIGHTMARE_KEY = ARROW_DIFFICULTY_SETUP.nightmare.gameKey;

function dealt(size: number): ArrowBoard {
  return {
    size,
    arrows: [arrow(1, [[0, 0]], "up"), arrow(2, [[3, 0]], "up"), arrow(3, [[9, 9]], "right")],
  };
}

function save(moves: number[], difficulty: "hard" | "nightmare" = "hard") {
  return buildArrowSave({
    difficulty,
    dealt: dealt(ARROW_DIFFICULTY_SETUP[difficulty].size),
    moves,
    unlimitedLives: false,
    practiceRun: false,
  });
}

describe("saveArrowRun / loadArrowRun", () => {
  it("stores a run under its tier's game key and loads it back", () => {
    const repo = fakeRepo();
    saveArrowRun(repo, { userId: 7, save: save([1]) });

    expect(repo.rows.get(`7:${HARD_KEY}`)?.formatVersion).toBe(ARROW_SAVE_VERSION);
    const loaded = loadArrowRun(repo, { userId: 7, difficulty: "hard" });
    expect(loaded).toMatchObject({ cleared: 1, remaining: 2 });
    expect(loaded?.save.moves).toEqual([1]);
  });

  it("keeps one save per tier and replaces it on the next save", () => {
    const repo = fakeRepo();
    saveArrowRun(repo, { userId: 7, save: save([1]) });
    saveArrowRun(repo, { userId: 7, save: save([1, 2]) });
    saveArrowRun(repo, { userId: 7, save: save([], "nightmare") });

    expect(repo.rows.size).toBe(2);
    expect(loadArrowRun(repo, { userId: 7, difficulty: "hard" })?.cleared).toBe(2);
    expect(loadArrowRun(repo, { userId: 7, difficulty: "nightmare" })?.cleared).toBe(0);
  });

  it("keeps players' runs apart", () => {
    const repo = fakeRepo();
    saveArrowRun(repo, { userId: 7, save: save([1]) });
    expect(loadArrowRun(repo, { userId: 8, difficulty: "hard" })).toBeUndefined();
  });

  it("refuses to store a run that has finished or is not legal", () => {
    const repo = fakeRepo();
    expect(() => saveArrowRun(repo, { userId: 7, save: save([1, 2, 3]) })).toThrow(
      "That run had already finished.",
    );
    expect(() => saveArrowRun(repo, { userId: 7, save: save([2]) })).toThrow();
    expect(repo.rows.size).toBe(0);
  });

  it("refuses a bad user id or a save that fails the schema", () => {
    const repo = fakeRepo();
    expect(() => saveArrowRun(repo, { userId: 0, save: save([]) })).toThrow();
    expect(() => saveArrowRun(repo, { userId: 7, save: { moves: [] } })).toThrow();
  });

  it("returns undefined when there is no save", () => {
    expect(loadArrowRun(fakeRepo(), { userId: 7, difficulty: "harder" })).toBeUndefined();
  });

  it("deletes a stored row that can no longer be resumed", () => {
    const repo = fakeRepo();
    const base = { userId: 7, userName: "User 7", savedAt: "2026-11-17T10:00:00.000Z" };
    repo.rows.set(`7:${HARD_KEY}`, {
      ...base,
      gameKey: HARD_KEY,
      formatVersion: ARROW_SAVE_VERSION,
      state: "{not json",
    });
    repo.rows.set(`7:${NIGHTMARE_KEY}`, {
      ...base,
      gameKey: NIGHTMARE_KEY,
      formatVersion: ARROW_SAVE_VERSION,
      // A Hard save filed under the Nightmare key.
      state: JSON.stringify(save([])),
    });

    expect(loadArrowRun(repo, { userId: 7, difficulty: "hard" })).toBeUndefined();
    expect(loadArrowRun(repo, { userId: 7, difficulty: "nightmare" })).toBeUndefined();
    expect(repo.rows.size).toBe(0);
  });

  it("rejects an unknown tier", () => {
    expect(() => loadArrowRun(fakeRepo(), { userId: 7, difficulty: "easy" })).toThrow();
  });
});

describe("discarding", () => {
  it("removes one tier's save and reports whether there was one", () => {
    const repo = fakeRepo();
    saveArrowRun(repo, { userId: 7, save: save([1]) });
    expect(discardArrowRun(repo, { userId: 7, difficulty: "hard" })).toBe(true);
    expect(discardArrowRun(repo, { userId: 7, difficulty: "hard" })).toBe(false);
  });

  it("discards by game key, and rejects a key the catalogue does not know", () => {
    const repo = fakeRepo();
    saveArrowRun(repo, { userId: 7, save: save([1]) });
    expect(discardSavedRun(repo, { userId: 7, gameKey: HARD_KEY })).toBe(true);
    expect(() => discardSavedRun(repo, { userId: 7, gameKey: "no-such-game" })).toThrow();
  });
});

describe("listSavedRuns", () => {
  it("lists runs with their progress and flags ones that can't be resumed", () => {
    const repo = fakeRepo();
    saveArrowRun(repo, { userId: 7, save: save([1]) });
    repo.rows.set(`8:${HARD_KEY}`, {
      userId: 8,
      userName: "User 8",
      gameKey: HARD_KEY,
      formatVersion: ARROW_SAVE_VERSION - 1,
      state: "{}",
      savedAt: "2000-01-01T00:00:00.000Z",
    });

    const all = listSavedRuns(repo);
    expect(all.map((run) => [run.userId, run.restorable, run.cleared])).toEqual([
      [7, true, 1],
      [8, false, 0],
    ]);
    expect(listSavedRuns(repo, { userId: 8 })).toHaveLength(1);
  });
});
