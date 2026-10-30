import { describe, expect, it } from "vitest";
import {
  clearCustomWords,
  countCustomWords,
  deleteCustomWord,
  importWords,
  listCustomWords,
  listPlayableWords,
} from "./games";
import type { PictionaryWordRepository } from "./ports";
import { tierSize } from "./pictionary-words";
import type { PictionaryTier, PictionaryWord, StoredPictionaryWord } from "./types";

/*
  The custom Pictionary word bank — the use-cases over `PictionaryWordRepository`.

  In its own file rather than appended to `games.test.ts`: that file's fake implements
  `ScoreRepository`, and these use-cases take a different port. Two unrelated fakes in
  one file would mean every test had to say which repository it meant.
*/

/** An in-memory PictionaryWordRepository, so the import use-cases skip SQLite. */
function fakeWordRepo(
  seed: StoredPictionaryWord[] = [],
): PictionaryWordRepository & { rows: StoredPictionaryWord[] } {
  let nextId = seed.length + 1;
  const rows = [...seed];

  return {
    rows,
    listWords(tier: PictionaryTier | undefined): StoredPictionaryWord[] {
      return rows.filter((row) => tier === undefined || row.tier === tier);
    },
    addWords(words: readonly PictionaryWord[], userId: number): number {
      let added = 0;
      for (const entry of words) {
        // The real unique index is (tier, word COLLATE NOCASE) — mirrored here so the
        // fake rejects exactly what SQLite would.
        const clash = rows.some(
          (row) => row.tier === entry.tier && row.word.toLowerCase() === entry.word.toLowerCase(),
        );
        if (clash) continue;

        rows.push({
          id: nextId,
          word: entry.word,
          tier: entry.tier,
          createdBy: `User ${userId}`,
          createdAt: "2026-10-30T00:00:00.000Z",
        });
        nextId += 1;
        added += 1;
      }
      return added;
    },
    deleteWord(id: number): boolean {
      const at = rows.findIndex((row) => row.id === id);
      if (at === -1) return false;
      rows.splice(at, 1);
      return true;
    },
    clearWords(tier: PictionaryTier | undefined): number {
      const going = rows.filter((row) => tier === undefined || row.tier === tier);
      for (const row of going) rows.splice(rows.indexOf(row), 1);
      return going.length;
    },
    countByTier(): Record<PictionaryTier, number> {
      const counts: Record<PictionaryTier, number> = { easy: 0, medium: 0, hard: 0 };
      for (const row of rows) counts[row.tier] += 1;
      return counts;
    },
  };
}

describe("importWords", () => {
  it("stores the words from a pasted list", () => {
    const repo = fakeWordRepo();
    const summary = importWords(repo, { text: "volcano\nbicycle", tier: "hard", userId: 1 });

    expect(summary.added).toBe(2);
    expect(repo.rows.map((row) => row.word)).toEqual(["volcano", "bicycle"]);
    expect(repo.rows.every((row) => row.tier === "hard")).toBe(true);
  });

  it("attributes the words to the importer", () => {
    const repo = fakeWordRepo();
    importWords(repo, { text: "volcano", tier: "easy", userId: 7 });
    expect(repo.rows[0].createdBy).toBe("User 7");
  });

  it("reports what was already in the bank rather than failing", () => {
    const repo = fakeWordRepo();
    importWords(repo, { text: "volcano", tier: "easy", userId: 1 });
    const again = importWords(repo, { text: "volcano\nbicycle", tier: "easy", userId: 1 });

    expect(again.added).toBe(1);
    expect(again.alreadyPresent).toBe(1);
    expect(repo.rows).toHaveLength(2);
  });

  it("imports the good rows from a list that has bad ones", () => {
    const repo = fakeWordRepo();
    const summary = importWords(repo, { text: "cat\narea 51\ndog", tier: "easy", userId: 1 });

    expect(summary.added).toBe(2);
    expect(summary.problems).toHaveLength(1);
    expect(summary.problems[0].line).toBe(2);
  });

  it("counts duplicates within the paste separately from ones already stored", () => {
    const repo = fakeWordRepo();
    const summary = importWords(repo, { text: "cat\nCat\ndog", tier: "easy", userId: 1 });

    expect(summary.added).toBe(2);
    expect(summary.duplicatesInPaste).toBe(1);
    expect(summary.alreadyPresent).toBe(0);
  });

  it("writes nothing when every row is unusable", () => {
    const repo = fakeWordRepo();
    const summary = importWords(repo, { text: "123\n456", tier: "easy", userId: 1 });

    expect(summary.added).toBe(0);
    expect(summary.problems).toHaveLength(2);
    expect(repo.rows).toHaveLength(0);
  });

  it("lets a row name its own tier", () => {
    const repo = fakeWordRepo();
    importWords(repo, { text: "volcano,hard\nball", tier: "easy", userId: 1 });

    expect(repo.rows.find((row) => row.word === "volcano")?.tier).toBe("hard");
    expect(repo.rows.find((row) => row.word === "ball")?.tier).toBe("easy");
  });

  it("rejects an empty submission", () => {
    const repo = fakeWordRepo();
    expect(() => importWords(repo, { text: "", tier: "easy", userId: 1 })).toThrow();
    expect(() => importWords(repo, { text: "   ", tier: "easy", userId: 1 })).not.toThrow();
  });

  it("rejects an unknown tier", () => {
    const repo = fakeWordRepo();
    expect(() => importWords(repo, { text: "cat", tier: "trivial", userId: 1 })).toThrow();
  });

  it("rejects a list too long to import at once", () => {
    const repo = fakeWordRepo();
    expect(() =>
      importWords(repo, { text: "cat\n".repeat(30_000), tier: "easy", userId: 1 }),
    ).toThrow(/too long/i);
  });

  it("rejects a submission with no user behind it", () => {
    const repo = fakeWordRepo();
    expect(() => importWords(repo, { text: "cat", tier: "easy", userId: 0 })).toThrow();
  });
});

describe("the stored word bank", () => {
  it("lists and counts per tier", () => {
    const repo = fakeWordRepo();
    importWords(repo, { text: "cat,easy\nvolcano,hard", tier: "easy", userId: 1 });

    expect(listCustomWords(repo)).toHaveLength(2);
    expect(listCustomWords(repo, { tier: "hard" })).toHaveLength(1);
    expect(countCustomWords(repo)).toEqual({ easy: 1, medium: 0, hard: 1 });
  });

  it("counts every tier, including the empty ones", () => {
    expect(countCustomWords(fakeWordRepo())).toEqual({ easy: 0, medium: 0, hard: 0 });
  });

  it("removes one word", () => {
    const repo = fakeWordRepo();
    importWords(repo, { text: "cat\ndog", tier: "easy", userId: 1 });

    expect(deleteCustomWord(repo, repo.rows[0].id)).toBe(true);
    expect(repo.rows).toHaveLength(1);
  });

  it("reports a word that was already gone", () => {
    expect(deleteCustomWord(fakeWordRepo(), 999)).toBe(false);
  });

  it("rejects a bad id rather than deleting something else", () => {
    expect(() => deleteCustomWord(fakeWordRepo(), 0)).toThrow();
    expect(() => deleteCustomWord(fakeWordRepo(), -1)).toThrow();
  });

  it("clears one tier, then all of them", () => {
    const repo = fakeWordRepo();
    importWords(repo, { text: "cat,easy\nvolcano,hard", tier: "easy", userId: 1 });

    expect(clearCustomWords(repo, "hard")).toBe(1);
    expect(repo.rows).toHaveLength(1);
    expect(clearCustomWords(repo)).toBe(1);
    expect(repo.rows).toHaveLength(0);
  });

  it("clearing an empty bank removes nothing rather than failing", () => {
    expect(clearCustomWords(fakeWordRepo())).toBe(0);
  });
});

describe("listPlayableWords", () => {
  it("joins the built-in bank with what was imported", () => {
    const repo = fakeWordRepo();
    importWords(repo, { text: "inside joke", tier: "easy", userId: 1 });

    const pool = listPlayableWords(repo, "easy");
    expect(pool).toHaveLength(tierSize("easy") + 1);
    expect(pool.map((entry) => entry.word)).toContain("inside joke");
  });

  it("reads only the built-in bank when asked for built-in", () => {
    const repo = fakeWordRepo();
    importWords(repo, { text: "inside joke", tier: "easy", userId: 1 });

    const pool = listPlayableWords(repo, "easy", "built-in");
    expect(pool).toHaveLength(tierSize("easy"));
    expect(pool.map((entry) => entry.word)).not.toContain("inside joke");
  });

  it("reads only the imported words when asked for custom", () => {
    const repo = fakeWordRepo();
    importWords(repo, { text: "inside joke", tier: "easy", userId: 1 });

    expect(listPlayableWords(repo, "easy", "custom")).toEqual([
      { word: "inside joke", tier: "easy" },
    ]);
  });

  it("falls back to the built-in bank when custom was asked for and nothing is stored", () => {
    // A session that cannot deal a prompt is not a session.
    expect(listPlayableWords(fakeWordRepo(), "easy", "custom")).toHaveLength(tierSize("easy"));
  });

  it("only returns words of the tier asked for", () => {
    const repo = fakeWordRepo();
    importWords(repo, { text: "inside joke", tier: "hard", userId: 1 });

    const pool = listPlayableWords(repo, "easy");
    expect(pool.every((entry) => entry.tier === "easy")).toBe(true);
    expect(pool.map((entry) => entry.word)).not.toContain("inside joke");
  });
});
