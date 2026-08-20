import { describe, expect, it } from "vitest";
import {
  addFavorite,
  favoriteTickerSchema,
  isFavorite,
  listFavoriteTickers,
  listFavorites,
  removeFavorite,
  toggleFavorite,
} from "./index";
import type { TickerFavoriteRepository } from "./ports";
import type { TickerFavorite } from "./types";

// Hand-written fake, matching the sibling modules' style. It mimics the two
// behaviours the real table guarantees: the ticker is the key (so `add` is
// idempotent), and `list` comes back newest first.
function fakeRepo(seed: TickerFavorite[] = []): TickerFavoriteRepository {
  let rows = [...seed];
  let clock = seed.length;

  return {
    list() {
      return [...rows].sort((a, b) =>
        a.createdAt === b.createdAt
          ? a.ticker.localeCompare(b.ticker)
          : b.createdAt.localeCompare(a.createdAt),
      );
    },
    isFavorite(ticker) {
      return rows.some((row) => row.ticker === ticker);
    },
    add(ticker) {
      if (rows.some((row) => row.ticker === ticker)) return;
      clock += 1;
      rows.push({ ticker, createdAt: `2026-08-19T00:00:${String(clock).padStart(2, "0")}Z` });
    },
    remove(ticker) {
      rows = rows.filter((row) => row.ticker !== ticker);
    },
  };
}

describe("toggleFavorite", () => {
  it("stars a symbol that isn't starred, and says so", () => {
    const repo = fakeRepo();

    expect(toggleFavorite(repo, "AAPL")).toBe(true);
    expect(repo.isFavorite("AAPL")).toBe(true);
  });

  it("unstars one that is", () => {
    const repo = fakeRepo();
    toggleFavorite(repo, "AAPL");

    expect(toggleFavorite(repo, "AAPL")).toBe(false);
    expect(repo.isFavorite("AAPL")).toBe(false);
  });

  it("normalizes case, so aapl and AAPL are one favorite", () => {
    const repo = fakeRepo();
    toggleFavorite(repo, "aapl");

    expect(repo.isFavorite("AAPL")).toBe(true);
    // The second press must unstar the same row, not create a second one.
    expect(toggleFavorite(repo, "  AAPL ")).toBe(false);
    expect(listFavoriteTickers(repo)).toEqual([]);
  });

  it("accepts a class share and an exchange-suffixed symbol", () => {
    const repo = fakeRepo();

    expect(toggleFavorite(repo, "BRK.B")).toBe(true);
    expect(toggleFavorite(repo, "RDS-A")).toBe(true);
    expect(listFavoriteTickers(repo)).toContain("BRK.B");
  });

  it("rejects a symbol that could never be quoted", () => {
    const repo = fakeRepo();

    expect(() => toggleFavorite(repo, "")).toThrow();
    expect(() => toggleFavorite(repo, "not a ticker")).toThrow();
    expect(() => toggleFavorite(repo, "A".repeat(16))).toThrow();
    expect(listFavoriteTickers(repo)).toEqual([]);
  });
});

describe("addFavorite / removeFavorite", () => {
  it("add is idempotent and reports whether it changed anything", () => {
    const repo = fakeRepo();

    expect(addFavorite(repo, "MSFT")).toBe(true);
    expect(addFavorite(repo, "MSFT")).toBe(false);
    expect(listFavoriteTickers(repo)).toEqual(["MSFT"]);
  });

  it("remove is idempotent and reports whether it changed anything", () => {
    const repo = fakeRepo();
    addFavorite(repo, "MSFT");

    expect(removeFavorite(repo, "msft")).toBe(true);
    expect(removeFavorite(repo, "MSFT")).toBe(false);
    expect(listFavoriteTickers(repo)).toEqual([]);
  });

  it("rejects an invalid symbol rather than storing it", () => {
    const repo = fakeRepo();

    expect(() => addFavorite(repo, "$$$")).toThrow();
    expect(() => removeFavorite(repo, "")).toThrow();
  });
});

describe("isFavorite", () => {
  it("normalizes before asking", () => {
    const repo = fakeRepo();
    addFavorite(repo, "NVDA");

    expect(isFavorite(repo, " nvda ")).toBe(true);
  });

  it("is false for an unstarred symbol and for blank", () => {
    const repo = fakeRepo();

    expect(isFavorite(repo, "TSLA")).toBe(false);
    expect(isFavorite(repo, "   ")).toBe(false);
  });

  it("does not throw on junk, unlike the write paths", () => {
    // A read has nothing to corrupt, and the star has to render *something* for
    // whatever symbol the viewer was opened with.
    const repo = fakeRepo();

    expect(isFavorite(repo, "not a ticker")).toBe(false);
  });
});

describe("listFavorites", () => {
  it("comes back newest first", () => {
    const repo = fakeRepo();
    addFavorite(repo, "AAPL");
    addFavorite(repo, "MSFT");
    addFavorite(repo, "NVDA");

    expect(listFavoriteTickers(repo)).toEqual(["NVDA", "MSFT", "AAPL"]);
  });

  it("carries the starred timestamp", () => {
    const repo = fakeRepo();
    addFavorite(repo, "AAPL");

    expect(listFavorites(repo)[0].createdAt).not.toBe("");
  });

  it("is empty when nothing is starred", () => {
    expect(listFavorites(fakeRepo())).toEqual([]);
  });
});

describe("favoriteTickerSchema", () => {
  it("trims what it accepts", () => {
    expect(favoriteTickerSchema.parse("  AAPL ")).toBe("AAPL");
  });

  it("rejects blank, spaces and over-long symbols", () => {
    expect(favoriteTickerSchema.safeParse("").success).toBe(false);
    expect(favoriteTickerSchema.safeParse("A B").success).toBe(false);
    expect(favoriteTickerSchema.safeParse("A".repeat(16)).success).toBe(false);
  });
});
