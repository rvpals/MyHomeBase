import { describe, expect, it } from "vitest";
import { buildTickerConsultPrompt } from "./prompt";
import type { TickerConsultInput } from "./types";

function input(overrides: Partial<TickerConsultInput> = {}): TickerConsultInput {
  return {
    ticker: "AAPL",
    name: "Apple Inc.",
    sector: "Technology",
    industry: "Consumer Electronics",
    referencePrice: { cents: 20_000, source: "intraday", asOf: "2026-09-14T18:00:00.000Z" },
    band: { tolerancePct: 15, lowCents: 17_000, highCents: 23_000 },
    position: {
      isHeld: true,
      isWatched: false,
      quantity: 10,
      accountCount: 1,
      costCents: 180_000,
      averageUnitCostCents: 18_000,
      valueCents: 200_000,
      unrealizedGainLossCents: 20_000,
      totalReturnPct: 11.11,
      hasCostBasis: true,
      portfolioWeightPct: 10,
      holdings: [
        {
          accountName: "Taxable",
          quantity: 10,
          costCents: 180_000,
          unitCostCents: 18_000,
          valueCents: 200_000,
        },
      ],
    },
    history: {
      trades: [
        {
          date: "2026-03-10",
          action: "Buy",
          numberOfShares: 10,
          pricePerShareCents: 18_000,
          totalAmountCents: 180_000,
          brokerageFirm: "Chase",
        },
      ],
      buyCount: 1,
      sellCount: 0,
      sharesBought: 10,
      sharesSold: 0,
      totalBoughtCents: 180_000,
      totalSoldCents: 0,
      firstTradeDate: "2026-03-10",
      lastTradeDate: "2026-03-10",
    },
    ...overrides,
  };
}

describe("buildTickerConsultPrompt", () => {
  it("states the reference price, its as-of, and both edges of the band", () => {
    const prompt = buildTickerConsultPrompt(input());

    expect(prompt).toContain("$200.00 per share");
    expect(prompt).toContain("2026-09-14T18:00:00.000Z");
    expect(prompt).toContain("$170.00 and $230.00");
    expect(prompt).toContain("±15%");
  });

  it("asks both questions — same sector and a different one", () => {
    const prompt = buildTickerConsultPrompt(input());

    expect(prompt).toContain("ALTERNATIVES IN THE SAME SECTOR");
    expect(prompt).toContain("ALTERNATIVES IN A DIFFERENT SECTOR");
  });

  it("says an intraday price is provisional", () => {
    expect(buildTickerConsultPrompt(input())).toContain("provisional");
  });

  it("warns that a recorded price is not a live quote", () => {
    const prompt = buildTickerConsultPrompt(
      input({
        referencePrice: { cents: 20_000, source: "recorded", asOf: "2026-09-01T00:00:00.000Z" },
      }),
    );

    expect(prompt).toContain("NOT a live quote");
  });

  it("names the provider's sector when it has one", () => {
    const prompt = buildTickerConsultPrompt(input());

    expect(prompt).toContain("**Technology**");
    expect(prompt).toContain("Consumer Electronics");
  });

  it("asks the model to establish the sector when none is recorded", () => {
    const prompt = buildTickerConsultPrompt(input({ sector: undefined, industry: undefined }));

    expect(prompt).toContain("No sector is recorded");
    expect(prompt).not.toContain("**Technology**");
  });

  it("lists the position's shares, basis and return", () => {
    const prompt = buildTickerConsultPrompt(input());

    expect(prompt).toContain("Shares held: 10");
    // 180,000 cents — the whole-dollar rendering a total gets.
    expect(prompt).toContain("Total cost basis: $1,800");
    expect(prompt).toContain("average $180.00 per share");
    expect(prompt).toContain("+11.11%");
  });

  it("refuses to imply a return when no basis is recorded", () => {
    const base = input();
    const prompt = buildTickerConsultPrompt({
      ...base,
      position: {
        ...base.position,
        hasCostBasis: false,
        costCents: 0,
        averageUnitCostCents: 0,
        totalReturnPct: 0,
      },
    });

    expect(prompt).toContain("Cost basis: not recorded");
    expect(prompt).toContain("unknown,");
    expect(prompt).not.toContain("Unrealised gain/loss");
  });

  it("tabulates every recorded trade with its shares, date and price", () => {
    const base = input();
    const prompt = buildTickerConsultPrompt({
      ...base,
      history: {
        ...base.history,
        trades: [
          ...base.history.trades,
          {
            date: "2026-06-01",
            action: "Sell",
            numberOfShares: 4,
            pricePerShareCents: 21_500,
            totalAmountCents: 86_000,
            brokerageFirm: "",
          },
        ],
        sellCount: 1,
        sharesSold: 4,
        totalSoldCents: 86_000,
        lastTradeDate: "2026-06-01",
      },
    });

    expect(prompt).toContain("| 2026-03-10 | Buy | 10 | $180.00 |");
    expect(prompt).toContain("| 2026-06-01 | Sell | 4 | $215.00 |");
    // An unrecorded brokerage says so rather than leaving an empty cell.
    expect(prompt).toContain("not recorded |");
    expect(prompt).toContain("Activity runs from 2026-03-10 to 2026-06-01");
  });

  it("says nothing was sold when the position was only ever added to", () => {
    expect(buildTickerConsultPrompt(input())).toContain("Nothing has been sold");
  });

  it("does not imply a symbol was never traded when no trades are recorded", () => {
    const base = input();
    const prompt = buildTickerConsultPrompt({
      ...base,
      history: {
        trades: [],
        buyCount: 0,
        sellCount: 0,
        sharesBought: 0,
        sharesSold: 0,
        totalBoughtCents: 0,
        totalSoldCents: 0,
      },
    });

    expect(prompt).toContain("No transactions are recorded");
    expect(prompt).toContain("outside what this application tracks");
  });

  it("treats a watch-only symbol as a candidate rather than a position to replace", () => {
    const base = input();
    const prompt = buildTickerConsultPrompt({
      ...base,
      position: {
        ...base.position,
        isHeld: false,
        isWatched: true,
        quantity: 0,
        accountCount: 0,
        holdings: [],
      },
    });

    expect(prompt).toContain("is NOT held");
    expect(prompt).toContain("skip any advice about selling");
  });

  it("asks the model to supply a price when we have none", () => {
    const prompt = buildTickerConsultPrompt(
      input({
        referencePrice: { cents: 0, source: "recorded", asOf: "2026-09-14T18:00:00.000Z" },
        band: { tolerancePct: 15, lowCents: 0, highCents: 0 },
      }),
    );

    expect(prompt).toContain("No price is available");
    expect(prompt).toContain("check the real price before acting");
  });

  it("breaks the position out per account only when more than one holds it", () => {
    const base = input();
    expect(buildTickerConsultPrompt(base)).not.toContain("Per account:");

    const prompt = buildTickerConsultPrompt({
      ...base,
      position: {
        ...base.position,
        accountCount: 2,
        holdings: [
          ...base.position.holdings,
          {
            accountName: "Roth IRA",
            quantity: 5,
            costCents: 0,
            unitCostCents: 0,
            valueCents: 100_000,
          },
        ],
      },
    });

    expect(prompt).toContain("Per account:");
    expect(prompt).toContain("| Roth IRA | 5 | not recorded | — |");
  });

  it("insists price claims are marked unverified", () => {
    const prompt = buildTickerConsultPrompt(input());

    expect(prompt).toContain("unverified");
    expect(prompt).toContain("This is analysis, not advice");
  });
});
