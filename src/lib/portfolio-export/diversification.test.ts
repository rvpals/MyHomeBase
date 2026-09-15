/**
 * The diversification focus, end to end through the prompt and both renderers.
 *
 * Separate from render.test.ts because it covers one feature across three files
 * — the focus instructions, the context caveats and the correlation tables —
 * and reads better as one story than as additions to three describe blocks.
 */

import { describe, expect, it } from "vitest";
import { buildAnalystPrompt } from "./prompt";
import { renderJson, renderMarkdown } from "./render";
import type { CorrelationInsight, PortfolioExportPayload } from "./types";

/** A correlation insight with an inverse pair and two sector gaps. */
function insight(overrides: Partial<CorrelationInsight> = {}): CorrelationInsight {
  return {
    calculatedAt: "2026-08-04T10:00:00.000Z",
    ageDays: 1,
    isStale: false,
    tickerCount: 3,
    pairCount: 3,
    averagePairwiseCorrelation: 0.237,
    mostCorrelated: [
      {
        tickerA: "NVDA",
        tickerB: "MSFT",
        correlation: 0.88,
        label: "nearly identical",
        combinedWeightPct: 50,
      },
    ],
    leastCorrelated: [
      {
        tickerA: "NVDA",
        tickerB: "GLD",
        correlation: -0.12,
        label: "slightly inverse",
        combinedWeightPct: 35,
      },
    ],
    marketCorrelations: [{ ticker: "NVDA", correlation: 0.91, label: "nearly identical" }],
    excludedTickers: [],
    sectorGaps: [
      { sector: "Utilities", weightPct: 0, status: "absent" },
      { sector: "Energy", weightPct: 1.2, status: "thin" },
    ],
    hasInverseCorrelation: true,
    ...overrides,
  };
}

function payload(overrides: Partial<PortfolioExportPayload> = {}): PortfolioExportPayload {
  return {
    asOf: "2026-08-05",
    summary: {
      totalMarketValue: 586_251.46,
      totalCostBasis: 400_000,
      totalUnrealizedGainLoss: 186_251.46,
      totalUnrealizedGainLossPct: 46.56,
      holdingCount: 1,
      accountCount: 3,
      cashAllocationPct: 0,
      topSectors: [{ sector: "Technology", marketValue: 237_802.58, weightPct: 40.6 }],
      byAccountKind: [
        { kind: "Taxable", marketValue: 579_486.38, weightPct: 98.85, holdingCount: 48 },
      ],
      unclassifiedHoldingCount: 0,
      missingCostBasisCount: 0,
    },
    holdings: [
      {
        ticker: "NVDA",
        name: "NVIDIA Corporation",
        vehicle: "Stock",
        accounts: ["Taxable"],
        quantity: 500,
        averageCostBasis: 50,
        currentPrice: 193.6,
        marketValue: 96_800,
        unrealizedGainLoss: 71_800,
        unrealizedGainLossPct: 287.2,
        weightPct: 16.51,
        sector: "Technology",
        expenseRatio: null,
      },
    ],
    excludedAccounts: [],
    focus: ["diversification"],
    correlation: insight(),
    ...overrides,
  };
}

describe("the diversification prompt", () => {
  it("asks for concrete alternative tickers, not just a diagnosis", () => {
    const prompt = buildAnalystPrompt(payload());
    expect(prompt).toContain("DIVERSIFICATION & ALTERNATIVES");
    expect(prompt).toMatch(/name two or three concrete tickers/i);
    expect(prompt).toMatch(/unverified/i);
  });

  it("asks it to size each suggestion and rank by correlation reduction", () => {
    const prompt = buildAnalystPrompt(payload());
    expect(prompt).toMatch(/what percent of the portfolio/i);
    expect(prompt).toMatch(/Rank your suggestions/i);
  });

  it("names redundancy as a pair of high correlation AND large combined weight", () => {
    const prompt = buildAnalystPrompt(payload());
    expect(prompt).toMatch(/effectively the same bet/i);
    expect(prompt).toMatch(/large combined weight/i);
  });

  it("allows the honest answer that the offset is not an equity", () => {
    const prompt = buildAnalystPrompt(payload());
    expect(prompt).toMatch(/bond, a commodity, gold or cash/i);
  });

  it("states the matrix's age and its Stock/ETF-only coverage", () => {
    const prompt = buildAnalystPrompt(payload());
    expect(prompt).toContain("1 day(s) ago");
    expect(prompt).toMatch(/Only Stock and ETF positions are covered/);
  });

  it("warns when the matrix is stale without withholding it", () => {
    const prompt = buildAnalystPrompt(
      payload({ correlation: insight({ isStale: true, ageDays: 30 }) }),
    );
    expect(prompt).toMatch(/more than a week old/);
  });

  // The honesty requirement: a weakly correlated pair must never be presented
  // to the reader as a hedge it is not.
  it("says outright that nothing is inversely correlated when nothing is", () => {
    const prompt = buildAnalystPrompt(
      payload({
        correlation: insight({ hasInverseCorrelation: false, averagePairwiseCorrelation: 0.68 }),
      }),
    );
    expect(prompt).toMatch(/NOTHING in this portfolio is inversely correlated/);
    expect(prompt).toContain("0.68");
    expect(prompt).toMatch(/not opposing ones/);
  });

  it("makes no such claim when an inverse pair does exist", () => {
    expect(buildAnalystPrompt(payload())).not.toMatch(
      /NOTHING in this portfolio is inversely correlated/,
    );
  });

  it("tells the model to reason from sectors when no matrix exists", () => {
    const prompt = buildAnalystPrompt(payload({ correlation: undefined }));
    expect(prompt).toMatch(/No correlation matrix is available/);
    expect(prompt).toMatch(/estimates from your own knowledge/);
  });

  it("names the holdings the matrix could not cover", () => {
    const prompt = buildAnalystPrompt(
      payload({ correlation: insight({ excludedTickers: ["ABC"] }) }),
    );
    expect(prompt).toContain("ABC");
  });

  it("says nothing about correlations when the focus was not ticked", () => {
    const prompt = buildAnalystPrompt(payload({ focus: ["fees"] }));
    expect(prompt).not.toContain("DIVERSIFICATION & ALTERNATIVES");
    expect(prompt).not.toMatch(/Pearson coefficients/);
  });

  it("orders diversification after the three original focuses", () => {
    const prompt = buildAnalystPrompt(payload({ focus: ["diversification", "allocation"] }));
    expect(prompt.indexOf("ASSET ALLOCATION")).toBeLessThan(
      prompt.indexOf("DIVERSIFICATION & ALTERNATIVES"),
    );
  });

  it("produces the same prompt whichever order the boxes were ticked", () => {
    const one = buildAnalystPrompt(payload({ focus: ["diversification", "tax"] }));
    const two = buildAnalystPrompt(payload({ focus: ["tax", "diversification"] }));
    expect(one).toBe(two);
  });

  it("mentions diversification in the no-focus general review", () => {
    expect(buildAnalystPrompt(payload({ focus: [] }))).toMatch(/diversification/i);
  });
});

describe("renderMarkdown with correlations", () => {
  it("tabulates both pair lists and labels what each means", () => {
    const markdown = renderMarkdown(payload());
    expect(markdown).toContain("## Correlation");
    expect(markdown).toMatch(/Most correlated pairs — candidates for redundancy/);
    expect(markdown).toMatch(/Least correlated pairs — the diversification that already exists/);
    expect(markdown).toContain("| NVDA | MSFT | 0.880 | nearly identical | 50.00% |");
    expect(markdown).toContain("| NVDA | GLD | -0.120 | slightly inverse | 35.00% |");
  });

  it("tabulates the sector gaps, distinguishing absent from thin", () => {
    const markdown = renderMarkdown(payload());
    expect(markdown).toContain("| Utilities | 0.00% | no exposure |");
    expect(markdown).toContain("| Energy | 1.20% | thin |");
  });

  it("reports the market correlations", () => {
    const markdown = renderMarkdown(payload());
    expect(markdown).toMatch(/Correlation to the market \(SPY\)/);
    expect(markdown).toContain("| NVDA | 0.910 | nearly identical |");
  });

  it("states the coverage and the average so a reader can judge the section", () => {
    const markdown = renderMarkdown(payload());
    expect(markdown).toMatch(/3 holdings, 3 pairs/);
    expect(markdown).toContain("0.237");
    expect(markdown).toMatch(/Any inversely correlated pair:\*\* yes/);
  });

  it("says every pair is positive when none is inverse", () => {
    const markdown = renderMarkdown(payload({ correlation: insight({ hasInverseCorrelation: false }) }));
    expect(markdown).toMatch(/every measured pair is positive/);
  });

  it("marks a stale matrix in the heading block", () => {
    const markdown = renderMarkdown(payload({ correlation: insight({ isStale: true, ageDays: 30 }) }));
    expect(markdown).toMatch(/30 days ago\) — stale/);
  });

  it("writes the day count in the singular for a one-day-old matrix", () => {
    expect(renderMarkdown(payload())).toMatch(/1 day ago/);
  });

  it("omits the whole section when there is no correlation data", () => {
    expect(renderMarkdown(payload({ focus: ["fees"], correlation: undefined }))).not.toContain(
      "## Correlation",
    );
  });

  it("explains the absence when diversification was asked for and there is no data", () => {
    const markdown = renderMarkdown(payload({ correlation: undefined }));
    expect(markdown).toContain("## Correlation");
    expect(markdown).toMatch(/No correlation matrix has been computed/);
  });

  it("puts correlation after the holdings it references", () => {
    const markdown = renderMarkdown(payload());
    expect(markdown.indexOf("## Holdings")).toBeLessThan(markdown.indexOf("## Correlation"));
  });

  it("names the tickers with no price history", () => {
    expect(renderMarkdown(payload({ correlation: insight({ excludedTickers: ["ABC"] }) }))).toMatch(
      /No price history:\*\* ABC/,
    );
  });
});

describe("renderJson with correlations", () => {
  it("carries the correlation object through verbatim", () => {
    const parsed = JSON.parse(renderJson(payload()));
    expect(parsed.correlation.mostCorrelated[0].tickerA).toBe("NVDA");
    expect(parsed.correlation.sectorGaps).toHaveLength(2);
    expect(parsed.notes.correlation).toMatch(/Pearson/);
  });

  it("omits the key rather than emitting null when there is no data", () => {
    const parsed = JSON.parse(renderJson(payload({ correlation: undefined })));
    expect("correlation" in parsed).toBe(false);
    expect(parsed.notes.correlation).toMatch(/absent rather than empty/);
  });
});
