import { describe, expect, it } from "vitest";
import type { StockPosition } from "@/lib/stock-positions";
import { exclusionReason, inferAccountKind, sanitizeAccountLabel } from "./account-kind";
import {
  aggregateHoldings,
  buildPortfolioExport,
  classifyAccounts,
  summarize,
  type ExportAccountInput,
} from "./portfolio-export";
import { portfolioExportOptionsSchema } from "./schema";
import type { AccountKind } from "./types";

/** A position with sane defaults; each test overrides only what it is about. */
function position(overrides: Partial<StockPosition> = {}): StockPosition {
  return {
    accountId: 1,
    ticker: "AAPL",
    name: "Apple Inc",
    type: "Stock",
    currentPriceCents: 20_000,
    quantity: 10,
    dayGainLossCents: 0,
    valueCents: 200_000,
    dayHighCents: 0,
    dayLowCents: 0,
    dividendRateCents: 0,
    costCents: 150_000,
    unitCostCents: 15_000,
    unrealizedGainLossCents: 50_000,
    unrealizedGainLossPct: 33.33,
    cusip: "",
    isin: "",
    assetClass: "",
    assetStrategy: "",
    estAnnualIncomeCents: 0,
    incomeEarnedCents: 0,
    createdAt: "2026-01-01 00:00:00",
    updatedAt: "2026-01-01 00:00:00",
    ...overrides,
  };
}

// The real account names from the live database, so the inference is tested
// against what it actually has to classify rather than against invented text.
const REAL_ACCOUNTS: ExportAccountInput[] = [
  { id: 1, name: "Chase Joint Stock Account" },
  { id: 2, name: "Fidelity Individual Account" },
  { id: 3, name: "Fidelity ROTH IRA Account" },
  { id: 4, name: "Fidelity 401K" },
  { id: 5, name: "VOYA Rutgers" },
  { id: 6, name: "VOYA TCNJ" },
  { id: 7, name: "Fidelity Health Savings Account" },
];

describe("inferAccountKind", () => {
  it("classifies every real account the way its owner does", () => {
    const kinds = REAL_ACCOUNTS.map((account) => inferAccountKind(account.name));
    expect(kinds).toEqual([
      "Taxable",
      "Taxable",
      "Roth IRA",
      "Retirement",
      "Retirement",
      "Retirement",
      "HSA",
    ] satisfies AccountKind[]);
  });

  it("reads a Roth 401k as a Roth, since that is what decides placement", () => {
    expect(inferAccountKind("Roth 401k")).toBe("Roth IRA");
  });

  it("is case-insensitive", () => {
    expect(inferAccountKind("fidelity roth ira")).toBe("Roth IRA");
    expect(inferAccountKind("MY hsa")).toBe("HSA");
  });

  it("falls back to Taxable for a name with no marker", () => {
    expect(inferAccountKind("Brokerage")).toBe("Taxable");
    expect(inferAccountKind("")).toBe("Taxable");
  });

  it("recognises the other IRA flavours", () => {
    expect(inferAccountKind("Rollover IRA")).toBe("Traditional IRA");
    expect(inferAccountKind("SEP IRA")).toBe("Traditional IRA");
  });
});

describe("sanitizeAccountLabel", () => {
  it("numbers accounts only when the kind has more than one", () => {
    expect(sanitizeAccountLabel("Taxable", 1, 2)).toBe("Taxable Account 1");
    expect(sanitizeAccountLabel("Taxable", 2, 2)).toBe("Taxable Account 2");
    expect(sanitizeAccountLabel("Roth IRA", 1, 1)).toBe("Roth IRA");
  });

  it("never leaks the institution or the owner", () => {
    const label = sanitizeAccountLabel(inferAccountKind("VOYA Rutgers"), 1, 1);
    expect(label).not.toMatch(/VOYA|Rutgers/i);
  });
});

describe("exclusionReason", () => {
  it("explains an HSA differently from an employer plan", () => {
    expect(exclusionReason("HSA")).toMatch(/health savings/i);
    expect(exclusionReason("Retirement")).toMatch(/employer retirement/i);
  });
});

describe("classifyAccounts", () => {
  it("includes taxable and Roth, excluding the plans and the HSA", () => {
    const { includedByAccountId, excluded } = classifyAccounts(REAL_ACCOUNTS);

    expect([...includedByAccountId.keys()]).toEqual([1, 2, 3]);
    expect(includedByAccountId.get(1)).toEqual({ kind: "Taxable", label: "Taxable Account 1" });
    expect(includedByAccountId.get(2)).toEqual({ kind: "Taxable", label: "Taxable Account 2" });
    expect(includedByAccountId.get(3)).toEqual({ kind: "Roth IRA", label: "Roth IRA" });
    expect(excluded).toHaveLength(4);
    expect(excluded.every((account) => account.reason.length > 0)).toBe(true);
  });

  it("names no institution anywhere in the excluded list", () => {
    const { excluded } = classifyAccounts(REAL_ACCOUNTS);
    const text = JSON.stringify(excluded);
    for (const secret of ["Chase", "Fidelity", "VOYA", "Rutgers", "TCNJ"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("honours an explicit kind list", () => {
    const { includedByAccountId } = classifyAccounts(REAL_ACCOUNTS, ["HSA"]);
    expect([...includedByAccountId.keys()]).toEqual([7]);
  });

  it("assigns labels by ascending id, so numbering is stable across exports", () => {
    const shuffled = [...REAL_ACCOUNTS].reverse();
    const { includedByAccountId } = classifyAccounts(shuffled);
    expect(includedByAccountId.get(1)?.label).toBe("Taxable Account 1");
    expect(includedByAccountId.get(2)?.label).toBe("Taxable Account 2");
  });

  it("returns nothing for no accounts", () => {
    const { includedByAccountId, excluded } = classifyAccounts([]);
    expect(includedByAccountId.size).toBe(0);
    expect(excluded).toEqual([]);
  });
});

describe("aggregateHoldings", () => {
  const included = new Map<number, { kind: AccountKind; label: string }>([
    [1, { kind: "Taxable", label: "Taxable Account 1" }],
    [3, { kind: "Roth IRA", label: "Roth IRA" }],
  ]);

  it("sums one ticker held in two accounts and records both account kinds", () => {
    const holdings = aggregateHoldings(
      [
        position({ accountId: 1, ticker: "MSFT", quantity: 10, valueCents: 300_000, costCents: 200_000 }),
        position({ accountId: 3, ticker: "MSFT", quantity: 5, valueCents: 150_000, costCents: 125_000 }),
      ],
      included,
      new Map([["MSFT", "Technology"]]),
    );

    expect(holdings).toHaveLength(1);
    const [msft] = holdings;
    expect(msft.quantity).toBe(15);
    expect(msft.marketValue).toBe(4500);
    expect(msft.accounts).toEqual(["Roth IRA", "Taxable"]);
    // Blended basis: $3,250 over 15 shares, not the mean of $200 and $250.
    expect(msft.averageCostBasis).toBeCloseTo(216.6667, 3);
    expect(msft.unrealizedGainLoss).toBe(1250);
    expect(msft.weightPct).toBe(100);
  });

  it("ignores positions in accounts that were not included", () => {
    const holdings = aggregateHoldings(
      [position({ accountId: 1 }), position({ accountId: 4, ticker: "VTI" })],
      included,
      new Map(),
    );
    expect(holdings.map((holding) => holding.ticker)).toEqual(["AAPL"]);
  });

  it("reports a missing cost basis as null rather than a free position", () => {
    const [holding] = aggregateHoldings(
      [position({ costCents: 0, unitCostCents: 0 })],
      included,
      new Map(),
    );
    expect(holding.averageCostBasis).toBeNull();
    expect(holding.unrealizedGainLoss).toBeNull();
    expect(holding.unrealizedGainLossPct).toBeNull();
  });

  it("averages only the shares that came with a basis", () => {
    const [holding] = aggregateHoldings(
      [
        position({ accountId: 1, ticker: "T", quantity: 10, valueCents: 100_000, costCents: 80_000 }),
        position({ accountId: 3, ticker: "T", quantity: 10, valueCents: 100_000, costCents: 0 }),
      ],
      included,
      new Map(),
    );
    // $800 over the 10 shares that reported a basis, not over all 20.
    expect(holding.averageCostBasis).toBe(80);
  });

  it("keeps a zero-value holding without dividing by zero", () => {
    const [holding] = aggregateHoldings(
      [position({ quantity: 0, valueCents: 0, costCents: 0, currentPriceCents: 0 })],
      included,
      new Map(),
    );
    expect(holding.marketValue).toBe(0);
    expect(holding.weightPct).toBe(0);
  });

  it("labels a ticker with no sector as Unclassified", () => {
    const [holding] = aggregateHoldings([position({ ticker: "XYZ" })], included, new Map());
    expect(holding.sector).toBe("Unclassified");
  });

  it("takes the price per share rather than summing it across accounts", () => {
    const [holding] = aggregateHoldings(
      [
        position({ accountId: 1, ticker: "F", currentPriceCents: 1_000, valueCents: 10_000 }),
        position({ accountId: 3, ticker: "F", currentPriceCents: 1_000, valueCents: 5_000 }),
      ],
      included,
      new Map(),
    );
    expect(holding.currentPrice).toBe(10);
  });

  it("matches a ticker case-insensitively and reports it upper-case", () => {
    const holdings = aggregateHoldings(
      [
        position({ accountId: 1, ticker: "aapl", valueCents: 100_000, costCents: 0 }),
        position({ accountId: 3, ticker: "AAPL", valueCents: 100_000, costCents: 0 }),
      ],
      included,
      new Map(),
    );
    expect(holdings).toHaveLength(1);
    expect(holdings[0].ticker).toBe("AAPL");
  });

  it("falls back to the ticker when the name is blank", () => {
    const [holding] = aggregateHoldings([position({ name: "   " })], included, new Map());
    expect(holding.name).toBe("AAPL");
  });

  it("orders holdings by market value, largest first", () => {
    const holdings = aggregateHoldings(
      [
        position({ ticker: "SMALL", valueCents: 10_000 }),
        position({ ticker: "BIG", valueCents: 900_000 }),
        position({ ticker: "MID", valueCents: 100_000 }),
      ],
      included,
      new Map(),
    );
    expect(holdings.map((holding) => holding.ticker)).toEqual(["BIG", "MID", "SMALL"]);
  });

  it("never reports an expense ratio, because none is tracked", () => {
    const holdings = aggregateHoldings([position({ type: "ETF" })], included, new Map());
    expect(holdings.every((holding) => holding.expenseRatio === null)).toBe(true);
  });
});

describe("summarize", () => {
  const included = new Map<number, { kind: AccountKind; label: string }>([
    [1, { kind: "Taxable", label: "Taxable Account 1" }],
    [3, { kind: "Roth IRA", label: "Roth IRA" }],
  ]);

  it("totals value, basis and return over holdings that report one", () => {
    const positions = [
      position({ accountId: 1, ticker: "A", valueCents: 200_000, costCents: 150_000 }),
      position({ accountId: 3, ticker: "B", valueCents: 100_000, costCents: 50_000 }),
    ];
    const holdings = aggregateHoldings(positions, included, new Map());
    const summary = summarize(holdings, included, positions);

    expect(summary.totalMarketValue).toBe(3000);
    expect(summary.totalCostBasis).toBe(2000);
    expect(summary.totalUnrealizedGainLoss).toBe(1000);
    expect(summary.totalUnrealizedGainLossPct).toBe(50);
    expect(summary.accountCount).toBe(2);
  });

  it("excludes a basis-less holding from the return but not from the value", () => {
    const positions = [
      position({ accountId: 1, ticker: "A", valueCents: 200_000, costCents: 150_000 }),
      position({ accountId: 1, ticker: "B", valueCents: 100_000, costCents: 0 }),
    ];
    const holdings = aggregateHoldings(positions, included, new Map());
    const summary = summarize(holdings, included, positions);

    expect(summary.totalMarketValue).toBe(3000);
    expect(summary.totalCostBasis).toBe(1500);
    expect(summary.totalUnrealizedGainLoss).toBe(500);
    expect(summary.missingCostBasisCount).toBe(1);
  });

  it("counts a sweep fund as cash even though it is stored as an ordinary position", () => {
    const positions = [
      position({ accountId: 1, ticker: "SPAXX", type: "Other", valueCents: 100_000, costCents: 0 }),
      position({ accountId: 1, ticker: "AAPL", valueCents: 300_000, costCents: 0 }),
    ];
    const holdings = aggregateHoldings(positions, included, new Map());
    expect(summarize(holdings, included, positions).cashAllocationPct).toBe(25);
  });

  it("returns at most three sectors, largest first", () => {
    const positions = [
      position({ accountId: 1, ticker: "A", valueCents: 400_000, costCents: 0 }),
      position({ accountId: 1, ticker: "B", valueCents: 300_000, costCents: 0 }),
      position({ accountId: 1, ticker: "C", valueCents: 200_000, costCents: 0 }),
      position({ accountId: 1, ticker: "D", valueCents: 100_000, costCents: 0 }),
    ];
    const sectors = new Map([
      ["A", "Technology"],
      ["B", "Healthcare"],
      ["C", "Energy"],
      ["D", "Utilities"],
    ]);
    const holdings = aggregateHoldings(positions, included, sectors);
    const summary = summarize(holdings, included, positions);

    expect(summary.topSectors.map((sector) => sector.sector)).toEqual([
      "Technology",
      "Healthcare",
      "Energy",
    ]);
    expect(summary.topSectors[0].weightPct).toBe(40);
  });

  it("splits a cross-account ticker between both account kinds", () => {
    const positions = [
      position({ accountId: 1, ticker: "MSFT", valueCents: 300_000, costCents: 0 }),
      position({ accountId: 3, ticker: "MSFT", valueCents: 100_000, costCents: 0 }),
    ];
    const holdings = aggregateHoldings(positions, included, new Map());
    const summary = summarize(holdings, included, positions);

    expect(summary.holdingCount).toBe(1);
    expect(summary.byAccountKind).toEqual([
      { kind: "Taxable", marketValue: 3000, weightPct: 75, holdingCount: 1 },
      { kind: "Roth IRA", marketValue: 1000, weightPct: 25, holdingCount: 1 },
    ]);
  });

  it("reports zeroes rather than NaN for an empty portfolio", () => {
    const summary = summarize([], included, []);
    expect(summary.totalMarketValue).toBe(0);
    expect(summary.totalUnrealizedGainLossPct).toBe(0);
    expect(summary.cashAllocationPct).toBe(0);
    expect(summary.topSectors).toEqual([]);
  });
});

describe("buildPortfolioExport", () => {
  it("assembles a payload that leaks no account name", () => {
    const payload = buildPortfolioExport({
      positions: [
        position({ accountId: 1, ticker: "AAPL" }),
        position({ accountId: 4, ticker: "HIDDEN" }),
      ],
      accounts: REAL_ACCOUNTS,
      sectorsByTicker: new Map([["AAPL", "Technology"]]),
      asOf: "2026-08-05",
      focus: ["allocation", "tax"],
    });

    expect(payload.asOf).toBe("2026-08-05");
    expect(payload.holdings.map((holding) => holding.ticker)).toEqual(["AAPL"]);
    expect(payload.focus).toEqual(["allocation", "tax"]);

    const text = JSON.stringify(payload);
    for (const secret of ["Chase", "Fidelity", "VOYA", "Rutgers", "TCNJ"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("keeps an issuer name that happens to match a broker, e.g. JP Morgan Chase", () => {
    // The live portfolio holds JPM, whose name contains "Chase" — the same word as
    // account 1's broker. Sanitisation removes *account* names, not securities, so
    // this must survive. A blanket string scrub would silently corrupt a holding.
    const payload = buildPortfolioExport({
      positions: [position({ accountId: 1, ticker: "JPM", name: "JP Morgan Chase & Co." })],
      accounts: REAL_ACCOUNTS,
      sectorsByTicker: new Map([["JPM", "Financial Services"]]),
      asOf: "2026-08-05",
      focus: [],
    });

    expect(payload.holdings[0].name).toBe("JP Morgan Chase & Co.");
    // ...while no account is described by anything but its tax treatment.
    const accountLabels = payload.holdings.flatMap((holding) => holding.accounts);
    expect(accountLabels).toEqual(["Taxable"]);
  });

  it("drops a position whose account was excluded", () => {
    const payload = buildPortfolioExport({
      positions: [position({ accountId: 7, ticker: "HSAFUND" })],
      accounts: REAL_ACCOUNTS,
      sectorsByTicker: new Map(),
      asOf: "2026-08-05",
      focus: [],
    });
    expect(payload.holdings).toEqual([]);
    expect(payload.summary.totalMarketValue).toBe(0);
  });
});

describe("portfolioExportOptionsSchema", () => {
  it("defaults to markdown, no focus, and the taxable + IRA kinds", () => {
    const parsed = portfolioExportOptionsSchema.parse({});
    expect(parsed.format).toBe("markdown");
    expect(parsed.focus).toEqual([]);
    expect(parsed.includeKinds).toEqual(["Taxable", "Roth IRA", "Traditional IRA"]);
  });

  it("accepts a full selection", () => {
    const parsed = portfolioExportOptionsSchema.parse({
      format: "json",
      focus: ["fees", "tax"],
      includeKinds: ["Taxable"],
    });
    expect(parsed.format).toBe("json");
    expect(parsed.focus).toEqual(["fees", "tax"]);
  });

  it("rejects an unknown format", () => {
    expect(() => portfolioExportOptionsSchema.parse({ format: "pdf" })).toThrow();
  });

  it("rejects an unknown focus", () => {
    expect(() => portfolioExportOptionsSchema.parse({ focus: ["astrology"] })).toThrow();
  });

  it("rejects a duplicated focus", () => {
    expect(() => portfolioExportOptionsSchema.parse({ focus: ["fees", "fees"] })).toThrow();
  });

  it("rejects an empty account-kind list", () => {
    expect(() => portfolioExportOptionsSchema.parse({ includeKinds: [] })).toThrow();
  });
});
