import { describe, expect, it } from "vitest";
import { findAdjacentEntryDate, isAdjacentEntryDirection } from "./neighbors";
import type { JournalRepository } from "./ports";

// Naming the one port this use-case reaches, rather than casting a bare literal:
// the Pick keeps `fromDate` and `direction` inferred inside the fake, so a typo
// here fails the typecheck instead of silently becoming `any`.
type NeighborsRepo = Pick<JournalRepository, "findAdjacentEntryDate">;

// The dates are the whole fixture — the use-case never looks at an entry's body,
// so building whole JournalEntry objects would say less about the rule under
// test, not more.
function fakeRepo(dates: string[]): JournalRepository {
  const sorted = [...dates].sort();
  const repo: NeighborsRepo = {
    findAdjacentEntryDate(fromDate, direction) {
      return direction === "prev"
        ? [...sorted].reverse().find((date) => date < fromDate)
        : sorted.find((date) => date > fromDate);
    },
  };
  return repo as JournalRepository;
}

describe("findAdjacentEntryDate", () => {
  const repo = fakeRepo(["2026-01-05", "2026-03-20", "2026-03-20", "2026-09-01"]);

  it("finds the nearest earlier entry date", () => {
    expect(findAdjacentEntryDate(repo, { from: "2026-06-15", direction: "prev" })).toBe(
      "2026-03-20",
    );
  });

  it("finds the nearest later entry date", () => {
    expect(findAdjacentEntryDate(repo, { from: "2026-06-15", direction: "next" })).toBe(
      "2026-09-01",
    );
  });

  it("crosses an empty stretch longer than one month", () => {
    // The point of the feature: 2026-01-05 → 2026-03-20 skips all of February,
    // which a read bounded by the visible month could never have found.
    expect(findAdjacentEntryDate(repo, { from: "2026-01-05", direction: "next" })).toBe(
      "2026-03-20",
    );
  });

  it("is strict, so a day that has an entry moves on rather than sticking", () => {
    expect(findAdjacentEntryDate(repo, { from: "2026-03-20", direction: "next" })).toBe(
      "2026-09-01",
    );
    expect(findAdjacentEntryDate(repo, { from: "2026-03-20", direction: "prev" })).toBe(
      "2026-01-05",
    );
  });

  it("returns undefined at the start of the journal", () => {
    expect(findAdjacentEntryDate(repo, { from: "2026-01-05", direction: "prev" })).toBeUndefined();
  });

  it("returns undefined at the end of the journal", () => {
    expect(findAdjacentEntryDate(repo, { from: "2026-09-01", direction: "next" })).toBeUndefined();
  });

  it("returns undefined when the journal is empty", () => {
    expect(
      findAdjacentEntryDate(fakeRepo([]), { from: "2026-06-15", direction: "next" }),
    ).toBeUndefined();
  });

  it("rejects a date that is not ISO", () => {
    expect(() => findAdjacentEntryDate(repo, { from: "06/15/2026", direction: "next" })).toThrow(
      /must be YYYY-MM-DD/,
    );
  });

  it("rejects an unknown direction", () => {
    expect(() =>
      findAdjacentEntryDate(repo, {
        from: "2026-06-15",
        direction: "sideways" as "next",
      }),
    ).toThrow(/must be "prev" or "next"/);
  });
});

describe("isAdjacentEntryDirection", () => {
  it("accepts the two directions", () => {
    expect(isAdjacentEntryDirection("prev")).toBe(true);
    expect(isAdjacentEntryDirection("next")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isAdjacentEntryDirection("previous")).toBe(false);
    expect(isAdjacentEntryDirection("")).toBe(false);
  });
});
