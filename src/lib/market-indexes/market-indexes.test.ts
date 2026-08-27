import { describe, expect, it } from "vitest";
import type { MarketDataClient, Quote } from "@/lib/market-data";
import { MARKET_INDEXES, MARKET_INDEX_SYMBOLS } from "./catalogue";
import { computeIndexQuote, groupQuotes, loadIndexBoard } from "./market-indexes";
import { indexBoardSchema } from "./schema";
import type { IndexQuote, MarketIndex } from "./types";

const SP500: MarketIndex = {
  symbol: "^GSPC",
  label: "S&P 500",
  group: "equity",
  unit: "points",
};

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    ticker: "^GSPC",
    priceCents: 543_210,
    previousCloseCents: 540_000,
    dayHighCents: 544_000,
    dayLowCents: 539_000,
    dividendRateCents: 0,
    ...overrides,
  };
}

/**
 * Hand-written fake — no mocking framework, no network. `failing` names symbols
 * that should throw, which is how the partial-failure paths are driven.
 */
function fakeClient(failing: string[] = []): MarketDataClient {
  return {
    async getQuote(ticker) {
      if (failing.includes(ticker)) throw new Error(`HTTP 429 for ${ticker}`);
      // A distinct price per symbol, so grouping/order assertions can tell rows apart.
      const seed = ticker.length * 1000;
      return quote({ ticker, priceCents: 500_000 + seed, previousCloseCents: 500_000 });
    },
    async getHistory() {
      return [];
    },
  };
}

describe("the catalogue", () => {
  /**
   * MARKET_INDEX_SYMBOLS repeats the symbols so the schema's enum keeps literal
   * types (see catalogue.ts). This is what stops the two lists drifting: add an
   * index to one and not the other and this fails.
   */
  it("lists exactly the symbols the catalogue describes", () => {
    expect([...MARKET_INDEX_SYMBOLS].sort()).toEqual(
      MARKET_INDEXES.map((index) => index.symbol).sort(),
    );
  });

  it("gives every index a label, a group and a unit", () => {
    for (const index of MARKET_INDEXES) {
      expect(index.label).toBeTruthy();
      expect(index.group).toBeTruthy();
      expect(index.unit).toBeTruthy();
    }
  });

  it("names no symbol twice", () => {
    const symbols = MARKET_INDEXES.map((index) => index.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  /** The three the request named explicitly, so a reorder can't quietly drop one. */
  it("includes the S&P, the NASDAQ, the Dow and gold", () => {
    const symbols = MARKET_INDEXES.map((index) => index.symbol);
    expect(symbols).toContain("^GSPC");
    expect(symbols).toContain("^IXIC");
    expect(symbols).toContain("^DJI");
    expect(symbols).toContain("GC=F");
  });

  /** A yield is a percent, not a price — the unit is what keeps it out of dollars. */
  it("quotes the 10-year yield as a percent", () => {
    expect(MARKET_INDEXES.find((index) => index.symbol === "^TNX")?.unit).toBe("percent");
    expect(MARKET_INDEXES.find((index) => index.symbol === "GC=F")?.unit).toBe("currency");
    expect(MARKET_INDEXES.find((index) => index.symbol === "^GSPC")?.unit).toBe("points");
  });
});

describe("computeIndexQuote", () => {
  it("computes the day move against the previous close", () => {
    const result = computeIndexQuote(SP500, quote());
    expect(result.changeCents).toBe(3_210);
    expect(result.changePct).toBeCloseTo(0.5944, 4);
    expect(result.label).toBe("S&P 500");
    expect(result.unit).toBe("points");
  });

  it("reports a fall as a negative change", () => {
    const result = computeIndexQuote(SP500, quote({ priceCents: 535_000 }));
    expect(result.changeCents).toBe(-5_000);
    expect(result.changePct).toBeLessThan(0);
  });

  it("treats a missing previous close as flat rather than dividing by zero", () => {
    const result = computeIndexQuote(SP500, quote({ previousCloseCents: 0 }));
    expect(result.changeCents).toBe(0);
    expect(result.changePct).toBe(0);
    // The level itself is still reported — only the move is unknown.
    expect(result.valueCents).toBe(543_210);
    expect(Number.isFinite(result.changePct)).toBe(true);
  });
});

describe("groupQuotes", () => {
  const row = (symbol: string, group: IndexQuote["group"]): IndexQuote => ({
    symbol,
    label: symbol,
    group,
    unit: "points",
    valueCents: 100,
    previousCloseCents: 100,
    changeCents: 0,
    changePct: 0,
  });

  it("buckets rows into groups in catalogue order", () => {
    const boards = groupQuotes([
      row("BTC-USD", "crypto"),
      row("^GSPC", "equity"),
      row("GC=F", "commodity"),
    ]);
    expect(boards.map((board) => board.group)).toEqual(["equity", "commodity", "crypto"]);
  });

  it("drops a group with no rows instead of rendering an empty heading", () => {
    const boards = groupQuotes([row("^GSPC", "equity")]);
    expect(boards).toHaveLength(1);
    expect(boards[0].label).toBe("US equity");
  });

  it("returns nothing for no rows", () => {
    expect(groupQuotes([])).toEqual([]);
  });
});

describe("indexBoardSchema", () => {
  it("accepts an omitted symbol list, meaning the whole board", () => {
    expect(indexBoardSchema.parse({})).toEqual({});
  });

  it("de-duplicates a repeated symbol", () => {
    expect(indexBoardSchema.parse({ symbols: ["^GSPC", "^GSPC"] })).toEqual({
      symbols: ["^GSPC"],
    });
  });

  it("rejects a symbol that isn't in the catalogue", () => {
    expect(() => indexBoardSchema.parse({ symbols: ["AAPL"] })).toThrow();
  });

  it("rejects an empty symbol list", () => {
    expect(() => indexBoardSchema.parse({ symbols: [] })).toThrow();
  });
});

describe("loadIndexBoard", () => {
  it("quotes every catalogued symbol by default", async () => {
    const board = await loadIndexBoard(fakeClient());
    const quoted = board.groups.flatMap((group) => group.quotes);
    expect(quoted).toHaveLength(MARKET_INDEXES.length);
    expect(board.failures).toEqual([]);
    expect(Number.isNaN(Date.parse(board.fetchedAt))).toBe(false);
  });

  it("honours a filtered symbol list", async () => {
    const board = await loadIndexBoard(fakeClient(), { symbols: ["^GSPC", "GC=F"] });
    const quoted = board.groups.flatMap((group) => group.quotes);
    expect(quoted.map((row) => row.symbol)).toEqual(["^GSPC", "GC=F"]);
  });

  it("reports a failed symbol and still returns the rest", async () => {
    const board = await loadIndexBoard(fakeClient(["^VIX"]));
    const quoted = board.groups.flatMap((group) => group.quotes);
    expect(quoted).toHaveLength(MARKET_INDEXES.length - 1);
    expect(quoted.some((row) => row.symbol === "^VIX")).toBe(false);
    expect(board.failures).toEqual([
      { symbol: "^VIX", label: "Volatility (VIX)", reason: "HTTP 429 for ^VIX" },
    ]);
  });

  it("returns no groups and all failures when every symbol fails", async () => {
    const board = await loadIndexBoard(fakeClient([...MARKET_INDEXES.map((i) => i.symbol)]));
    expect(board.groups).toEqual([]);
    expect(board.failures).toHaveLength(MARKET_INDEXES.length);
  });

  it("rejects an uncatalogued symbol before calling the client", async () => {
    let called = false;
    const client: MarketDataClient = {
      async getQuote() {
        called = true;
        return quote();
      },
      async getHistory() {
        return [];
      },
    };
    await expect(
      loadIndexBoard(client, { symbols: ["NVDA"] } as never),
    ).rejects.toThrow();
    expect(called).toBe(false);
  });
});
