import { describe, expect, it } from "vitest";
import {
  collectKnownTickers,
  isKnownTicker,
  matchTickers,
  normalizeQuery,
  tickerQuerySchema,
} from "./index";
import type { KnownTicker } from "./types";

const known: KnownTicker[] = [
  { ticker: "AAPL", source: "position" },
  { ticker: "GOOGL", source: "position" },
  { ticker: "GOOG", source: "watchlist" },
  { ticker: "MSFT", source: "profile" },
  { ticker: "SPGI", source: "profile" },
];

describe("normalizeQuery", () => {
  it("upper-cases and trims", () => {
    expect(normalizeQuery("  aapl ")).toBe("AAPL");
  });

  it("collapses a blank query to the empty string", () => {
    expect(normalizeQuery("   ")).toBe("");
  });
});

describe("collectKnownTickers", () => {
  it("merges the three sources, deduped and alphabetical", () => {
    const result = collectKnownTickers({
      positionTickers: ["MSFT", "AAPL"],
      watchListTickers: ["TSLA"],
      profileTickers: ["NVDA"],
    });

    expect(result.map((entry) => entry.ticker)).toEqual(["AAPL", "MSFT", "NVDA", "TSLA"]);
  });

  it("keeps the strongest source when a symbol appears twice", () => {
    const result = collectKnownTickers({
      positionTickers: ["AAPL"],
      watchListTickers: ["AAPL"],
      profileTickers: ["AAPL"],
    });

    expect(result).toEqual([{ ticker: "AAPL", source: "position" }]);
  });

  it("upgrades a profile-only symbol that is also watched", () => {
    const result = collectKnownTickers({
      positionTickers: [],
      watchListTickers: ["NVDA"],
      profileTickers: ["NVDA"],
    });

    expect(result).toEqual([{ ticker: "NVDA", source: "watchlist" }]);
  });

  it("normalizes case and drops blank symbols", () => {
    const result = collectKnownTickers({
      positionTickers: [" aapl ", ""],
      watchListTickers: ["  "],
      profileTickers: [],
    });

    expect(result).toEqual([{ ticker: "AAPL", source: "position" }]);
  });
});

describe("matchTickers", () => {
  it("matches a prefix, case-insensitively", () => {
    expect(matchTickers(known, "aap").map((m) => m.ticker)).toEqual(["AAPL"]);
  });

  it("matches inside a symbol too", () => {
    expect(matchTickers(known, "OOG").map((m) => m.ticker)).toEqual(["GOOG", "GOOGL"]);
  });

  it("ranks prefix matches above substring matches", () => {
    const rows: KnownTicker[] = [
      { ticker: "XSPG", source: "position" },
      { ticker: "SPGI", source: "profile" },
    ];

    expect(matchTickers(rows, "SPG").map((m) => m.ticker)).toEqual(["SPGI", "XSPG"]);
  });

  it("ranks a held symbol above a merely known one within the same tier", () => {
    const rows: KnownTicker[] = [
      { ticker: "GA", source: "profile" },
      { ticker: "GB", source: "position" },
    ];

    expect(matchTickers(rows, "G").map((m) => m.ticker)).toEqual(["GB", "GA"]);
  });

  it("returns the first few known symbols for a blank query", () => {
    expect(matchTickers(known, "  ", 2).map((m) => m.ticker)).toEqual(["AAPL", "GOOGL"]);
  });

  it("returns nothing when the query matches no symbol", () => {
    expect(matchTickers(known, "ZZZZ")).toEqual([]);
  });

  it("caps the result at the limit", () => {
    expect(matchTickers(known, "", 3)).toHaveLength(3);
  });

  it("treats a non-positive limit as no results rather than throwing", () => {
    expect(matchTickers(known, "AAPL", 0)).toEqual([]);
  });
});

describe("isKnownTicker", () => {
  it("is true for an exact symbol, whatever the case", () => {
    expect(isKnownTicker(known, "aapl")).toBe(true);
  });

  it("is false for a partial symbol", () => {
    expect(isKnownTicker(known, "AAP")).toBe(false);
  });

  it("is false for an unknown symbol and for blank", () => {
    expect(isKnownTicker(known, "ZZZZ")).toBe(false);
    expect(isKnownTicker(known, "  ")).toBe(false);
  });
});

describe("tickerQuerySchema", () => {
  it("accepts what a reader types, including blank", () => {
    expect(tickerQuerySchema.parse("")).toBe("");
    expect(tickerQuerySchema.parse("aapl")).toBe("aapl");
  });

  it("rejects a query longer than any real symbol", () => {
    expect(tickerQuerySchema.safeParse("A".repeat(33)).success).toBe(false);
  });
});
