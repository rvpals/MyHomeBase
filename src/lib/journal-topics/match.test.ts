import { describe, expect, it } from "vitest";
import { matchTopic } from "./match";
import type { JournalEntry } from "@/lib/journal/types";

/** A minimal entry; only the fields the matcher reads carry meaning. */
function entry(overrides: Partial<JournalEntry> & { id: number }): JournalEntry {
  return {
    date: "2026-07-27",
    time: "",
    title: "",
    content: "",
    placeName: "",
    isPinned: false,
    isLocked: false,
    isEncrypted: false,
    titleEncrypted: "",
    contentEncrypted: "",
    passwordHint: "",
    categories: [],
    tags: [],
    locations: [],
    source: "",
    externalId: "",
    externalContent: "",
    createdAt: "2026-07-27T00:00:00Z",
    updatedAt: "2026-07-27T00:00:00Z",
    ...overrides,
  };
}

const OFF = { matchBody: false };
const ON = { matchBody: true };

describe("matchTopic", () => {
  it("matches an entry by an exactly-spelled tag", () => {
    const result = matchTopic([entry({ id: 1, tags: ["HSA"] })], "HSA", OFF);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].reasons).toEqual([{ kind: "tag", name: "HSA", score: 1 }]);
    expect(result.entries[0].score).toBe(1);
  });

  it("matches a differently-punctuated tag", () => {
    const result = matchTopic([entry({ id: 1, tags: ["H.S.A."] })], "HSA", OFF);
    expect(result.entries).toHaveLength(1);
  });

  it("matches a category by its acronym", () => {
    const result = matchTopic(
      [entry({ id: 1, categories: ["Health Savings Account"] })],
      "HSA",
      OFF,
    );

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].reasons[0]).toMatchObject({ kind: "category", score: 0.95 });
  });

  it("matches a title as whole words", () => {
    const result = matchTopic([entry({ id: 1, title: "Filed the HSA claim" })], "HSA", OFF);
    expect(result.entries[0].reasons).toEqual([{ kind: "title", name: "", score: 1 }]);
  });

  it("leaves bodies alone when body matching is off", () => {
    const result = matchTopic([entry({ id: 1, content: "called about the HSA" })], "HSA", OFF);
    expect(result.entries).toHaveLength(0);
  });

  it("reports how many entries body matching would have added", () => {
    const result = matchTopic([entry({ id: 1, content: "called about the HSA" })], "HSA", OFF);
    expect(result.bodyOnlyCount).toBe(1);
  });

  it("finds those entries once body matching is on, and reports none hidden", () => {
    const result = matchTopic([entry({ id: 1, content: "called about the HSA" })], "HSA", ON);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].reasons[0].kind).toBe("body");
    expect(result.bodyOnlyCount).toBe(0);
  });

  it("does not count an already-matched entry as body-only", () => {
    const result = matchTopic(
      [entry({ id: 1, tags: ["HSA"], content: "more about the HSA" })],
      "HSA",
      OFF,
    );
    expect(result.entries).toHaveLength(1);
    expect(result.bodyOnlyCount).toBe(0);
  });

  it("records every reason an entry matched", () => {
    const result = matchTopic(
      [entry({ id: 1, tags: ["HSA"], title: "HSA paperwork" })],
      "HSA",
      OFF,
    );
    expect(result.entries[0].reasons.map((r) => r.kind)).toEqual(["tag", "title"]);
  });

  it("scores an entry by its strongest reason, not the sum", () => {
    const both = matchTopic(
      [entry({ id: 1, tags: ["HSA"], title: "HSA paperwork" })],
      "HSA",
      OFF,
    );
    const tagOnly = matchTopic([entry({ id: 2, tags: ["HSA"] })], "HSA", OFF);
    expect(both.entries[0].score).toBe(tagOnly.entries[0].score);
  });

  // An encrypted entry's tags are plaintext, so it is genuinely part of the
  // topic even though nothing can read its words.
  it("matches an encrypted entry by tag and flags it as masked", () => {
    const result = matchTopic(
      [entry({ id: 1, tags: ["HSA"], isEncrypted: true })],
      "HSA",
      ON,
    );

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].isMasked).toBe(true);
    expect(result.maskedCount).toBe(1);
  });

  it("never reads an encrypted entry's title or body", () => {
    // Contrived: a real encrypted entry carries "" in both columns. Populated
    // here so a regression that skipped the isEncrypted check would be caught.
    const result = matchTopic(
      [entry({ id: 1, title: "HSA", content: "HSA", isEncrypted: true })],
      "HSA",
      ON,
    );
    expect(result.entries).toHaveLength(0);
  });

  it("sorts by score, then by date descending, then by id", () => {
    const result = matchTopic(
      [
        entry({ id: 1, title: "HSA notes", date: "2026-01-01" }),
        entry({ id: 2, tags: ["HSA"], date: "2026-01-01" }),
        entry({ id: 3, tags: ["HSA"], date: "2026-06-01" }),
      ],
      "HSA",
      OFF,
    );

    // Tag matches (1.0) outrank the title match (0.8); within the tags the
    // later date leads.
    expect(result.entries.map((e) => e.entry.id)).toEqual([3, 2, 1]);
  });

  it("collects the distinct names that matched", () => {
    const result = matchTopic(
      [
        entry({ id: 1, tags: ["HSA"] }),
        entry({ id: 2, categories: ["Health Savings Account"] }),
        entry({ id: 3, tags: ["HSA"] }),
      ],
      "HSA",
      OFF,
    );
    // Alphabetical, not the order the entries were seen in — `matchTopic` sorts
    // these with `localeCompare` so a chip row is stable between renders. Under that
    // comparison "Health Savings Account" precedes "HSA" (the space sorts before the
    // S), which is what this previously had the wrong way round.
    expect(result.matchedNames).toEqual(["Health Savings Account", "HSA"]);
  });

  it("returns nothing for a blank term rather than matching everything", () => {
    const result = matchTopic([entry({ id: 1, tags: ["HSA"] })], "   ", OFF);
    expect(result.entries).toEqual([]);
    expect(result.bodyOnlyCount).toBe(0);
  });

  it("returns nothing when no entry matches", () => {
    const result = matchTopic([entry({ id: 1, tags: ["Garden"] })], "HSA", ON);
    expect(result.entries).toEqual([]);
    expect(result.maskedCount).toBe(0);
  });

  it("handles an empty journal", () => {
    const result = matchTopic([], "HSA", ON);
    expect(result.entries).toEqual([]);
    expect(result.matchedNames).toEqual([]);
  });
});
