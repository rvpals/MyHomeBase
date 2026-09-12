import { describe, expect, it } from "vitest";
import { buildAnalystPrompt } from "./prompt";
import { exportFileName, renderExport, renderJson, renderMarkdown } from "./render";
import type { PortfolioExportPayload } from "./types";

function payload(overrides: Partial<PortfolioExportPayload> = {}): PortfolioExportPayload {
  return {
    asOf: "2026-08-05",
    summary: {
      totalMarketValue: 586_251.46,
      totalCostBasis: 400_000,
      totalUnrealizedGainLoss: 186_251.46,
      totalUnrealizedGainLossPct: 46.56,
      holdingCount: 2,
      accountCount: 3,
      cashAllocationPct: 0,
      topSectors: [{ sector: "Technology", marketValue: 237_802.58, weightPct: 40.6 }],
      byAccountKind: [
        { kind: "Taxable", marketValue: 579_486.38, weightPct: 98.85, holdingCount: 48 },
        { kind: "Roth IRA", marketValue: 6_765.08, weightPct: 1.15, holdingCount: 3 },
      ],
      unclassifiedHoldingCount: 11,
      missingCostBasisCount: 0,
    },
    holdings: [
      {
        ticker: "MSFT",
        name: "Microsoft Corp",
        vehicle: "Stock",
        accounts: ["Roth IRA", "Taxable"],
        quantity: 80,
        averageCostBasis: 310.25,
        currentPrice: 504.75,
        marketValue: 40_380.08,
        unrealizedGainLoss: 15_560.08,
        unrealizedGainLossPct: 62.7,
        weightPct: 6.89,
        sector: "Technology",
        expenseRatio: null,
      },
      {
        ticker: "VOO",
        name: "Vanguard S&P 500 ETF",
        vehicle: "ETF",
        accounts: ["Taxable"],
        quantity: 100,
        averageCostBasis: null,
        currentPrice: 520,
        marketValue: 52_000,
        unrealizedGainLoss: null,
        unrealizedGainLossPct: null,
        weightPct: 8.87,
        sector: "ETFs & funds",
        expenseRatio: null,
      },
    ],
    excludedAccounts: [
      { label: "Retirement", kind: "Retirement", reason: "Employer retirement plan — no holdings." },
      { label: "HSA", kind: "HSA", reason: "Health savings account — no holdings." },
    ],
    focus: ["allocation", "fees", "tax"],
    ...overrides,
  };
}

describe("buildAnalystPrompt", () => {
  it("states the role, the totals and the as-of date", () => {
    const prompt = buildAnalystPrompt(payload());
    expect(prompt).toMatch(/portfolio analyst/i);
    expect(prompt).toContain("$586,251");
    expect(prompt).toContain("2026-08-05");
  });

  it("warns that excluded retirement money exists, so the model cannot misread the gap", () => {
    const prompt = buildAnalystPrompt(payload());
    expect(prompt).toMatch(/DOES have retirement savings/);
    expect(prompt).toContain("Retirement");
    expect(prompt).toContain("HSA");
  });

  it("tells the model expense ratios are absent and must be marked when supplied", () => {
    expect(buildAnalystPrompt(payload())).toMatch(/Expense ratios are not tracked/);
  });

  it("mentions the unclassified and basis-less counts only when there are some", () => {
    const withGaps = buildAnalystPrompt(payload());
    expect(withGaps).toContain("11 holdings have no sector");

    const clean = buildAnalystPrompt(
      payload({
        summary: { ...payload().summary, unclassifiedHoldingCount: 0, missingCostBasisCount: 0 },
      }),
    );
    expect(clean).not.toMatch(/have no sector/);
    expect(clean).not.toMatch(/report no cost basis/);
  });

  it("emits only the focus areas that were selected", () => {
    const feesOnly = buildAnalystPrompt(payload({ focus: ["fees"] }));
    expect(feesOnly).toContain("FEE DRAG");
    expect(feesOnly).not.toContain("TAX EFFICIENCY");
    expect(feesOnly).not.toContain("ASSET ALLOCATION");
  });

  it("orders focus sections consistently however they were ticked", () => {
    const one = buildAnalystPrompt(payload({ focus: ["tax", "allocation"] }));
    const two = buildAnalystPrompt(payload({ focus: ["allocation", "tax"] }));
    expect(one).toBe(two);
    expect(one.indexOf("ASSET ALLOCATION")).toBeLessThan(one.indexOf("TAX EFFICIENCY"));
  });

  it("asks for a general review when nothing was ticked", () => {
    const prompt = buildAnalystPrompt(payload({ focus: [] }));
    expect(prompt).toMatch(/No specific focus was requested/);
  });

  it("always says how to lay the answer out", () => {
    expect(buildAnalystPrompt(payload())).toContain("HOW TO ANSWER");
  });
});

describe("renderMarkdown", () => {
  it("leads with the prompt, then the data", () => {
    const markdown = renderMarkdown(payload());
    expect(markdown.indexOf("portfolio analyst")).toBeLessThan(markdown.indexOf("## Holdings"));
  });

  it("renders a holdings table with a row per holding", () => {
    const markdown = renderMarkdown(payload());
    expect(markdown).toContain("| MSFT | Microsoft Corp |");
    expect(markdown).toContain("| VOO | Vanguard S&P 500 ETF |");
  });

  it("shows an em dash, never a zero, where a value is genuinely unknown", () => {
    const row = renderMarkdown(payload())
      .split("\n")
      .find((line) => line.startsWith("| VOO "))!;
    expect(row).toContain("—");
    expect(row).not.toContain("$0.00");
  });

  it("lists what was excluded and why", () => {
    const markdown = renderMarkdown(payload());
    expect(markdown).toContain("## Excluded from this export");
    expect(markdown).toContain("Employer retirement plan");
  });

  it("groups repeated exclusions into one line with a count", () => {
    // The live portfolio has three employer plans, which must not render as
    // three identical bullets.
    const markdown = renderMarkdown(
      payload({
        excludedAccounts: [
          { label: "Retirement", kind: "Retirement", reason: "Employer retirement plan." },
          { label: "Retirement", kind: "Retirement", reason: "Employer retirement plan." },
          { label: "Retirement", kind: "Retirement", reason: "Employer retirement plan." },
          { label: "HSA", kind: "HSA", reason: "Health savings account." },
        ],
      }),
    );
    expect(markdown).toContain("**Retirement** (3 accounts)");
    expect(markdown).toContain("**HSA** —");
    expect(markdown).not.toContain("**HSA** (1 accounts)");
    expect(markdown.match(/\*\*Retirement\*\*/g)).toHaveLength(1);
  });

  it("says 'account' when there is only one", () => {
    const markdown = renderMarkdown(
      payload({ summary: { ...payload().summary, accountCount: 1 } }),
    );
    expect(markdown).toContain("across 1 account");
    expect(markdown).not.toContain("across 1 accounts");
  });

  it("handles an empty portfolio without an empty table", () => {
    const markdown = renderMarkdown(payload({ holdings: [] }));
    expect(markdown).toContain("_No holdings in the exported accounts._");
  });

  it("escapes a pipe in a fund name so the table cannot break", () => {
    const markdown = renderMarkdown(
      payload({
        holdings: [{ ...payload().holdings[0], name: "Odd | Fund" }],
      }),
    );
    expect(markdown).toContain("Odd \\| Fund");
  });
});

describe("renderJson", () => {
  it("parses, and carries the prompt beside the data", () => {
    const parsed = JSON.parse(renderJson(payload()));
    expect(typeof parsed.prompt).toBe("string");
    expect(parsed.holdings).toHaveLength(2);
    expect(parsed.summary.totalMarketValue).toBe(586_251.46);
  });

  it("keeps an unknown value as null rather than zero", () => {
    const parsed = JSON.parse(renderJson(payload()));
    const voo = parsed.holdings.find((holding: { ticker: string }) => holding.ticker === "VOO");
    expect(voo.averageCostBasis).toBeNull();
    expect(voo.unrealizedGainLoss).toBeNull();
  });

  it("documents the two things a reader would otherwise have to guess", () => {
    const parsed = JSON.parse(renderJson(payload()));
    expect(parsed.notes.expenseRatio).toMatch(/not tracked/i);
    expect(parsed.notes.accountNames).toMatch(/tax treatment/i);
  });
});

describe("renderExport and exportFileName", () => {
  it("routes to the requested renderer", () => {
    expect(renderExport(payload(), "json").startsWith("{")).toBe(true);
    expect(renderExport(payload(), "markdown")).toContain("## Summary");
  });

  it("names the file by format and date", () => {
    expect(exportFileName(payload(), "json")).toBe("portfolio-ai-export-2026-08-05.json");
    expect(exportFileName(payload(), "markdown")).toBe("portfolio-ai-export-2026-08-05.md");
  });
});
