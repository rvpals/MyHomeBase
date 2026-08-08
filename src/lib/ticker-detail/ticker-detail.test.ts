import { describe, expect, it } from "vitest";
import type { QuoteSummaryClient, RawQuoteSummary } from "@/lib/market-data";
import {
  buildTickerDetail,
  cents,
  getTickerDetail,
  isoDate,
  num,
  pct,
  MAX_RATING_CHANGES,
} from "./ticker-detail";

/** Epoch seconds for a local-calendar date, so `toIsoDateLocal` round-trips. */
function at(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day, 12).getTime() / 1000;
}

describe("unwrapping the provider's shapes", () => {
  it("reads a number whether it is wrapped or bare", () => {
    expect(num({ raw: 12.5, fmt: "12.50" })).toBe(12.5);
    expect(num(12.5)).toBe(12.5);
  });

  it("treats an absent, empty or non-finite value as unknown", () => {
    expect(num(undefined)).toBeUndefined();
    expect(num({})).toBeUndefined();
    expect(num({ fmt: "N/A" })).toBeUndefined();
    expect(num(Number.NaN)).toBeUndefined();
    expect(num(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it("converts dollars to whole cents", () => {
    expect(cents({ raw: 312.47 })).toBe(31_247);
    // Floating-point dollars must not leak a fractional cent.
    expect(cents({ raw: 0.1 + 0.2 })).toBe(30);
    expect(cents(undefined)).toBeUndefined();
  });

  it("converts the provider's fractions to percentages", () => {
    expect(pct({ raw: 0.2762 })).toBeCloseTo(27.62, 10);
    expect(pct({ raw: -0.05 })).toBeCloseTo(-5, 10);
    // Zero is a real answer and must survive, unlike undefined.
    expect(pct({ raw: 0 })).toBe(0);
    expect(pct(undefined)).toBeUndefined();
  });

  it("turns epoch seconds into a calendar date", () => {
    expect(isoDate(at("2026-06-28"))).toBe("2026-06-28");
    expect(isoDate(undefined)).toBeUndefined();
  });
});

describe("buildTickerDetail", () => {
  it("returns no sections at all for an empty payload", () => {
    const detail = buildTickerDetail("AAPL", {});

    expect(detail.ticker).toBe("AAPL");
    expect(detail.marketData).toBeUndefined();
    expect(detail.profile).toBeUndefined();
    expect(detail.analysis).toBeUndefined();
    expect(detail.valuation).toBeUndefined();
    expect(detail.financials).toBeUndefined();
    expect(detail.keyStatistics).toBeUndefined();
  });

  it("builds market data, in cents", () => {
    const detail = buildTickerDetail("AAPL", {
      price: {
        regularMarketPrice: { raw: 312.47 },
        regularMarketPreviousClose: { raw: 311 },
        marketCap: { raw: 4_560_000_000_000 },
        currency: "USD",
        exchangeName: "NasdaqGS",
      },
      summaryDetail: { fiftyTwoWeekLow: { raw: 213.25 }, fiftyTwoWeekHigh: { raw: 340.08 } },
    });

    expect(detail.marketData?.priceCents).toBe(31_247);
    expect(detail.marketData?.previousCloseCents).toBe(31_100);
    expect(detail.marketData?.marketCapCents).toBe(456_000_000_000_000);
    expect(detail.marketData?.fiftyTwoWeekLowCents).toBe(21_325);
    expect(detail.marketData?.currency).toBe("USD");
  });

  it("keeps a market cap in cents inside the safe integer range", () => {
    // A multi-trillion cap times 100 is the largest number this app carries.
    const detail = buildTickerDetail("AAPL", {
      price: { marketCap: { raw: 4_560_000_000_000 } },
    });

    expect(detail.marketData?.marketCapCents).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(detail.marketData?.marketCapCents)).toBe(true);
  });

  it("drops officers with no name, and keeps the rest", () => {
    const detail = buildTickerDetail("AAPL", {
      assetProfile: {
        sector: "Technology",
        companyOfficers: [
          { name: "A Person", title: "CEO", age: 60, totalPay: { raw: 1_000 } },
          { name: "   ", title: "Ghost" },
          { title: "Nameless" },
        ],
      },
    });

    expect(detail.profile?.officers).toHaveLength(1);
    expect(detail.profile?.officers[0]).toEqual({
      name: "A Person",
      title: "CEO",
      age: 60,
      totalPayCents: 100_000,
    });
  });

  it("sums each recommendation period", () => {
    const detail = buildTickerDetail("AAPL", {
      recommendationTrend: {
        trend: [{ period: "0m", strongBuy: 6, buy: 21, hold: 14, sell: 2, strongSell: 3 }],
      },
      financialData: { recommendationKey: "buy", targetMeanPrice: { raw: 320.89 } },
    });

    expect(detail.analysis?.trend[0].total).toBe(46);
    expect(detail.analysis?.recommendationKey).toBe("buy");
    expect(detail.analysis?.targetMeanCents).toBe(32_089);
  });

  it("treats a missing bucket in a period as zero, not as a gap", () => {
    const detail = buildTickerDetail("AAPL", {
      recommendationTrend: { trend: [{ period: "-1m", strongBuy: 2 }] },
    });

    expect(detail.analysis?.trend[0]).toMatchObject({ strongBuy: 2, buy: 0, hold: 0, total: 2 });
  });

  it("caps the rating-change archive but reports the true count", () => {
    const history = Array.from({ length: 970 }, (_, index) => ({
      epochGradeDate: at("2020-01-01") + index * 86_400,
      firm: `Firm ${index}`,
      toGrade: "Buy",
    }));

    const detail = buildTickerDetail("AAPL", { upgradeDowngradeHistory: { history } });

    expect(detail.analysis?.ratingChanges).toHaveLength(MAX_RATING_CHANGES);
    expect(detail.analysis?.totalRatingChanges).toBe(970);
    // Most recent first, so the cap keeps the newest rather than the oldest.
    expect(detail.analysis?.ratingChanges[0].firm).toBe("Firm 969");
  });

  it("drops rating changes with no date or no firm", () => {
    const detail = buildTickerDetail("AAPL", {
      upgradeDowngradeHistory: {
        history: [
          { epochGradeDate: at("2026-05-01"), firm: "Real Firm", toGrade: "Buy", action: "up" },
          { firm: "Undated Firm", toGrade: "Buy" },
          { epochGradeDate: at("2026-04-01"), toGrade: "Hold" },
        ],
      },
    });

    expect(detail.analysis?.ratingChanges).toHaveLength(1);
    expect(detail.analysis?.ratingChanges[0].firm).toBe("Real Firm");
    expect(detail.analysis?.totalRatingChanges).toBe(1);
  });

  it("orders income statements newest first", () => {
    const detail = buildTickerDetail("AAPL", {
      incomeStatementHistory: {
        incomeStatementHistory: [
          { endDate: at("2023-09-30"), totalRevenue: { raw: 383_285_000_000 } },
          { endDate: at("2025-09-30"), totalRevenue: { raw: 416_000_000_000 } },
          { endDate: at("2024-09-30"), totalRevenue: { raw: 391_035_000_000 } },
        ],
      },
    });

    expect(detail.financials?.incomeStatements.map((row) => row.endDate)).toEqual([
      "2025-09-30",
      "2024-09-30",
      "2023-09-30",
    ]);
  });

  it("reads the quoted 52-week change key", () => {
    const detail = buildTickerDetail("AAPL", {
      defaultKeyStatistics: { "52WeekChange": { raw: 0.184 }, SandP52WeekChange: { raw: 0.121 } },
    });

    expect(detail.keyStatistics?.fiftyTwoWeekChangePct).toBeCloseTo(18.4, 10);
    expect(detail.keyStatistics?.benchmark52WeekChangePct).toBeCloseTo(12.1, 10);
  });

  it("omits a section whose module came back empty", () => {
    // An ETF: prices, but no company and no income statement.
    const detail = buildTickerDetail("SPY", {
      price: { regularMarketPrice: { raw: 500 } },
      assetProfile: {},
      incomeStatementHistory: { incomeStatementHistory: [] },
    });

    expect(detail.marketData).toBeDefined();
    expect(detail.profile).toBeUndefined();
    expect(detail.financials).toBeUndefined();
  });
});

describe("getTickerDetail", () => {
  function fakeClient(raw: RawQuoteSummary): QuoteSummaryClient {
    return { async getQuoteSummary() { return raw; } };
  }

  it("upper-cases the ticker at the boundary", async () => {
    const detail = await getTickerDetail(fakeClient({}), { ticker: " aapl " });
    expect(detail.ticker).toBe("AAPL");
  });

  it("stamps when it was fetched", async () => {
    const before = Date.now();
    const detail = await getTickerDetail(fakeClient({}), { ticker: "AAPL" });
    expect(new Date(detail.fetchedAt).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("propagates a provider failure — an unreachable provider is not 'no data'", async () => {
    const client: QuoteSummaryClient = {
      async getQuoteSummary() {
        throw new Error("Yahoo detail AAPL: the provider returned nothing.");
      },
    };

    await expect(getTickerDetail(client, { ticker: "AAPL" })).rejects.toThrow(/returned nothing/);
  });

  it("rejects an empty ticker before calling the provider", async () => {
    let called = false;
    const client: QuoteSummaryClient = {
      async getQuoteSummary() {
        called = true;
        return {};
      },
    };

    await expect(getTickerDetail(client, { ticker: "  " })).rejects.toThrow();
    expect(called).toBe(false);
  });
});
