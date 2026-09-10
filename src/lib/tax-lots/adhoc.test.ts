// Tests for the ad-hoc path: transactions passed in, scored, optionally saved.
//
// The load-bearing claim these exist to hold down is that ad-hoc and stored analysis
// cannot disagree. Several assertions below therefore run the SAME numbers through
// both paths and compare, rather than hard-coding an expected figure twice — if the
// two ever diverge, that is the failure worth catching, not a changed constant.

import { describe, expect, it } from "vitest";
import {
  decodeAdhocLots,
  decodeTickerLots,
  encodeAdhocLots,
  encodeTickerLots,
} from "./adhoc-url";
import { lotsFromTrades } from "./from-transactions";
import type { TaxLotRepository } from "./ports";
import {
  adhocLotSchema,
  analyzeAdhocLotsSchema,
  saveAdhocLotsSchema,
  type AdhocLotInput,
  type CreateTaxLotInput,
  type UpdateTaxLotInput,
} from "./schema";
import type { TaxLot } from "./types";
import { analyzeAdhocLots, analyzeTicker, saveAdhocLots } from "./tax-lots";

/** The same in-memory port the stored tests use — fakes over mocks. */
class FakeTaxLotRepository implements TaxLotRepository {
  private nextId = 1;
  readonly lots: TaxLot[] = [];

  constructor(seed: Partial<TaxLot>[] = []) {
    for (const lot of seed) this.seedLot(lot);
  }

  private seedLot(lot: Partial<TaxLot>): TaxLot {
    const created: TaxLot = {
      id: this.nextId++,
      ticker: "NVDA",
      buyDate: "2020-01-01",
      shares: 10,
      pricePerShareCents: 10_000,
      isSplitAdjusted: false,
      brokerageFirm: "",
      note: "",
      createdAt: "2026-01-01 00:00:00",
      updatedAt: "2026-01-01 00:00:00",
      ...lot,
    };
    this.lots.push(created);
    return created;
  }

  listLots(ticker?: string): TaxLot[] {
    return this.lots
      .filter((lot) => !ticker || lot.ticker === ticker)
      .sort((left, right) => left.buyDate.localeCompare(right.buyDate) || left.id - right.id);
  }

  getLotById(id: number): TaxLot | undefined {
    return this.lots.find((lot) => lot.id === id);
  }

  listTickers(): string[] {
    return [...new Set(this.lots.map((lot) => lot.ticker))].sort();
  }

  createLot(input: CreateTaxLotInput): TaxLot {
    return this.seedLot(input);
  }

  updateLot(id: number, input: UpdateTaxLotInput): TaxLot {
    const index = this.lots.findIndex((lot) => lot.id === id);
    this.lots[index] = { ...this.lots[index], ...input };
    return this.lots[index];
  }

  deleteLot(id: number): void {
    const index = this.lots.findIndex((lot) => lot.id === id);
    if (index >= 0) this.lots.splice(index, 1);
  }
}

/** A lot already through the schema, so tests state only what they care about. */
function adhocLot(overrides: Partial<AdhocLotInput> = {}): AdhocLotInput {
  return adhocLotSchema.parse({
    buyDate: "2020-01-01",
    shares: 10,
    pricePerShare: 100,
    isSplitAdjusted: true,
    ...overrides,
  });
}

const CONTEXT = { currentMarketPrice: 200, trailingEPS: 0, today: "2026-01-01" };

describe("analyzeAdhocLots", () => {
  it("aggregates several transactions into one summary", () => {
    const analysis = analyzeAdhocLots({
      ticker: "ZZZ",
      ...CONTEXT,
      lots: [
        adhocLot({ buyDate: "2020-01-01", shares: 10, pricePerShare: 100 }),
        adhocLot({ buyDate: "2021-06-15", shares: 5, pricePerShare: 150 }),
        adhocLot({ buyDate: "2022-03-01", shares: 20, pricePerShare: 50 }),
      ],
    });

    expect(analysis.lots).toHaveLength(3);
    expect(analysis.summary.lotCount).toBe(3);
    expect(analysis.summary.totalAdjustedShares).toBe(35);
    // 1_000 + 750 + 1_000
    expect(analysis.summary.totalCapitalInvested).toBeCloseTo(2_750, 6);
    // 35 shares at 200
    expect(analysis.summary.totalCurrentValue).toBeCloseTo(7_000, 6);
    expect(analysis.summary.totalGainDollars).toBeCloseTo(4_250, 6);
    expect(analysis.summary.blendedCostBasis).toBeCloseTo(2_750 / 35, 6);
  });

  it("returns lots oldest first regardless of the order passed in", () => {
    const analysis = analyzeAdhocLots({
      ticker: "ZZZ",
      ...CONTEXT,
      lots: [
        adhocLot({ buyDate: "2022-03-01" }),
        adhocLot({ buyDate: "2020-01-01" }),
        adhocLot({ buyDate: "2021-06-15" }),
      ],
    });

    expect(analysis.lots.map((lot) => lot.buyDate)).toEqual([
      "2020-01-01",
      "2021-06-15",
      "2022-03-01",
    ]);
  });

  it("agrees with the stored path given the same numbers", () => {
    // The point of the whole design: one set of maths, two entry points.
    const repo = new FakeTaxLotRepository([
      { ticker: "ZZZ", buyDate: "2020-01-01", shares: 10, pricePerShareCents: 10_000, isSplitAdjusted: true },
      { ticker: "ZZZ", buyDate: "2021-06-15", shares: 5, pricePerShareCents: 15_000, isSplitAdjusted: true },
    ]);
    const stored = analyzeTicker(repo, { ticker: "ZZZ", ...CONTEXT });

    const adhoc = analyzeAdhocLots({
      ticker: "ZZZ",
      ...CONTEXT,
      lots: [
        adhocLot({ buyDate: "2020-01-01", shares: 10, pricePerShare: 100 }),
        adhocLot({ buyDate: "2021-06-15", shares: 5, pricePerShare: 150 }),
      ],
    });

    expect(adhoc.summary.totalCapitalInvested).toBeCloseTo(
      stored.summary.totalCapitalInvested,
      6,
    );
    expect(adhoc.summary.totalCurrentValue).toBeCloseTo(stored.summary.totalCurrentValue, 6);
    expect(adhoc.summary.totalGainPercent).toBeCloseTo(stored.summary.totalGainPercent, 6);
    expect(adhoc.summary.blendedCostBasis).toBeCloseTo(stored.summary.blendedCostBasis, 6);
    expect(adhoc.summary.xirr).toBeCloseTo(stored.summary.xirr!, 6);
  });

  it("honours isSplitAdjusted per lot", () => {
    // NVDA is in the split table: 4:1 in 2021, 10:1 in 2024 — 40x for a 2020 buy.
    const analysis = analyzeAdhocLots({
      ticker: "NVDA",
      ...CONTEXT,
      lots: [
        adhocLot({ buyDate: "2020-01-01", shares: 10, pricePerShare: 100, isSplitAdjusted: false }),
        adhocLot({ buyDate: "2020-01-01", shares: 10, pricePerShare: 100, isSplitAdjusted: true }),
      ],
    });

    const [historical, alreadyAdjusted] = analysis.lots;
    expect(historical.cumulativeSplitFactor).toBe(40);
    expect(historical.adjustedShares).toBe(400);
    expect(alreadyAdjusted.cumulativeSplitFactor).toBe(1);
    expect(alreadyAdjusted.adjustedShares).toBe(10);
    // The split moved no money: both lots cost the same $1,000.
    expect(historical.costBasis).toBeCloseTo(1_000, 6);
    expect(alreadyAdjusted.costBasis).toBeCloseTo(1_000, 6);
  });

  it("converts dollars to cents and back without drifting", () => {
    const analysis = analyzeAdhocLots({
      ticker: "ZZZ",
      ...CONTEXT,
      lots: [adhocLot({ shares: 3, pricePerShare: 180.57 })],
    });
    expect(analysis.lots[0].adjustedCostPerShare).toBeCloseTo(180.57, 6);
  });
});

describe("analyzeAdhocLotsSchema", () => {
  it("accepts a valid multi-lot request and uppercases the ticker", () => {
    const parsed = analyzeAdhocLotsSchema.parse({
      ticker: "nvda",
      currentMarketPrice: 200,
      today: "2026-01-01",
      lots: [{ buyDate: "2020-01-01", shares: 10, pricePerShare: 100 }],
    });
    expect(parsed.ticker).toBe("NVDA");
    // Defaults land so every adapter sees the same shape.
    expect(parsed.trailingEPS).toBe(0);
    expect(parsed.lots[0].isSplitAdjusted).toBe(false);
    expect(parsed.lots[0].note).toBe("");
  });

  it("coerces the strings a URL and a CLI flag deliver", () => {
    const parsed = analyzeAdhocLotsSchema.parse({
      ticker: "ZZZ",
      currentMarketPrice: "200.5",
      trailingEPS: "1.25",
      today: "2026-01-01",
      lots: [{ buyDate: "2020-01-01", shares: "10.5", pricePerShare: "100.25" }],
    });
    expect(parsed.currentMarketPrice).toBe(200.5);
    expect(parsed.trailingEPS).toBe(1.25);
    expect(parsed.lots[0].shares).toBe(10.5);
    expect(parsed.lots[0].pricePerShare).toBe(100.25);
  });

  it("rejects an empty lot set", () => {
    expect(() =>
      analyzeAdhocLotsSchema.parse({
        ticker: "ZZZ",
        currentMarketPrice: 200,
        today: "2026-01-01",
        lots: [],
      }),
    ).toThrow(/at least one transaction/i);
  });

  it("rejects a malformed date, zero shares and a negative price", () => {
    const base = { ticker: "ZZZ", currentMarketPrice: 200, today: "2026-01-01" };
    expect(() =>
      analyzeAdhocLotsSchema.parse({
        ...base,
        lots: [{ buyDate: "01/02/2020", shares: 10, pricePerShare: 100 }],
      }),
    ).toThrow(/YYYY-MM-DD/);
    expect(() =>
      analyzeAdhocLotsSchema.parse({
        ...base,
        lots: [{ buyDate: "2020-01-01", shares: 0, pricePerShare: 100 }],
      }),
    ).toThrow(/greater than zero/i);
    expect(() =>
      analyzeAdhocLotsSchema.parse({
        ...base,
        lots: [{ buyDate: "2020-01-01", shares: 10, pricePerShare: -1 }],
      }),
    ).toThrow();
  });

  it("refuses an unbounded lot set", () => {
    const lots = Array.from({ length: 201 }, () => ({
      buyDate: "2020-01-01",
      shares: 1,
      pricePerShare: 1,
    }));
    expect(() =>
      analyzeAdhocLotsSchema.parse({
        ticker: "ZZZ",
        currentMarketPrice: 200,
        today: "2026-01-01",
        lots,
      }),
    ).toThrow();
  });
});

describe("encodeAdhocLots / decodeAdhocLots", () => {
  it("round-trips a set of transactions", () => {
    const lots = [
      adhocLot({ buyDate: "2020-01-01", shares: 10, pricePerShare: 100.5, isSplitAdjusted: true }),
      adhocLot({
        buyDate: "2021-06-15",
        shares: 2.5,
        pricePerShare: 150,
        isSplitAdjusted: false,
        brokerageFirm: "Chase",
        note: "DRIP",
      }),
    ];
    expect(decodeAdhocLots(encodeAdhocLots(lots))).toEqual(lots);
  });

  it("preserves the split flag in both directions", () => {
    // "0" is a truthy string, so a coercing decode would flip this to true and
    // silently re-apply the split table to an already-adjusted lot.
    const decoded = decodeAdhocLots(encodeAdhocLots([adhocLot({ isSplitAdjusted: false })]));
    expect(decoded?.[0].isSplitAdjusted).toBe(false);
  });

  it("strips delimiters out of free text so a note cannot split its record", () => {
    const encoded = encodeAdhocLots([
      adhocLot({ brokerageFirm: "A|B", note: "one~two|three" }),
    ]);
    const decoded = decodeAdhocLots(encoded);
    expect(decoded).toHaveLength(1);
    expect(decoded?.[0].note).toBe("one two three");
    expect(decoded?.[0].brokerageFirm).toBe("A B");
  });

  it("returns undefined for an absent, empty or unusable param", () => {
    expect(decodeAdhocLots(undefined)).toBeUndefined();
    expect(decodeAdhocLots("")).toBeUndefined();
    // Too few fields — a truncated copy-paste.
    expect(decodeAdhocLots("2020-01-01~10")).toBeUndefined();
    // A date the schema rejects.
    expect(decodeAdhocLots("01/02/2020~10~100~1~~")).toBeUndefined();
  });

  it("rejects the whole param when any single lot is bad", () => {
    const good = encodeAdhocLots([adhocLot()]);
    // Eleven good lots and one broken one must not yield a confident aggregate
    // over eleven — nothing on screen would report the missing purchase.
    expect(decodeAdhocLots(`${good}|2020-01-01~0~100~1~~`)).toBeUndefined();
  });
});

describe("lotsFromTrades", () => {
  const buy = {
    transactionAt: "2020-01-01 14:30:00",
    action: "BUY",
    numberOfShares: 10,
    pricePerShareCents: 10_000,
    brokerageFirm: "Chase",
    note: "",
  };

  it("keeps buys, drops sells, and reports how many it dropped", () => {
    const result = lotsFromTrades([
      buy,
      { ...buy, action: "SELL", transactionAt: "2021-01-01 10:00:00" },
      { ...buy, transactionAt: "2022-01-01 10:00:00" },
      { ...buy, action: "sell", transactionAt: "2023-01-01 10:00:00" },
    ]);

    expect(result.lots).toHaveLength(2);
    expect(result.skippedSells).toBe(2);
    expect(result.skippedInvalid).toBe(0);
  });

  it("takes the calendar date off the instant and converts cents to dollars", () => {
    const [lot] = lotsFromTrades([{ ...buy, pricePerShareCents: 18_057 }]).lots;
    expect(lot.buyDate).toBe("2020-01-01");
    expect(lot.pricePerShare).toBeCloseTo(180.57, 6);
  });

  it("marks broker rows as already split-adjusted", () => {
    // A broker reports today's shares. Re-applying the split table to a 2019 NVDA
    // buy would report 40x the position actually held.
    expect(lotsFromTrades([buy]).lots[0].isSplitAdjusted).toBe(true);
  });

  it("carries the brokerage and note through", () => {
    const [lot] = lotsFromTrades([{ ...buy, brokerageFirm: "Fidelity", note: "transfer in" }]).lots;
    expect(lot.brokerageFirm).toBe("Fidelity");
    expect(lot.note).toBe("transfer in");
  });

  it("drops rows with no shares or no parseable date", () => {
    const result = lotsFromTrades([
      { ...buy, numberOfShares: 0 },
      { ...buy, transactionAt: "not a date" },
      buy,
    ]);
    expect(result.lots).toHaveLength(1);
    expect(result.skippedInvalid).toBe(2);
  });

  it("returns lots oldest first", () => {
    const result = lotsFromTrades([
      { ...buy, transactionAt: "2022-01-01 10:00:00" },
      { ...buy, transactionAt: "2020-01-01 10:00:00" },
      { ...buy, transactionAt: "2021-01-01 10:00:00" },
    ]);
    expect(result.lots.map((lot) => lot.buyDate)).toEqual([
      "2020-01-01",
      "2021-01-01",
      "2022-01-01",
    ]);
  });

  it("returns an empty set when every row is a sell", () => {
    const result = lotsFromTrades([{ ...buy, action: "SELL" }]);
    expect(result.lots).toEqual([]);
    expect(result.skippedSells).toBe(1);
  });
});

describe("saveAdhocLots", () => {
  it("stores every new transaction", () => {
    const repo = new FakeTaxLotRepository();
    const result = saveAdhocLots(repo, {
      ticker: "ZZZ",
      lots: [
        adhocLot({ buyDate: "2020-01-01", shares: 10, pricePerShare: 100 }),
        adhocLot({ buyDate: "2021-06-15", shares: 5, pricePerShare: 150 }),
      ],
    });

    expect(result.saved).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    expect(repo.listLots("ZZZ")).toHaveLength(2);
    expect(repo.listLots("ZZZ")[0].pricePerShareCents).toBe(10_000);
  });

  it("skips a transaction already recorded, so pressing Save twice is safe", () => {
    const repo = new FakeTaxLotRepository();
    const input = {
      ticker: "ZZZ",
      lots: [
        adhocLot({ buyDate: "2020-01-01", shares: 10, pricePerShare: 100 }),
        adhocLot({ buyDate: "2021-06-15", shares: 5, pricePerShare: 150 }),
      ],
    };

    saveAdhocLots(repo, input);
    const second = saveAdhocLots(repo, input);

    expect(second.saved).toHaveLength(0);
    expect(second.skipped).toHaveLength(2);
    // The position did not double.
    expect(repo.listLots("ZZZ")).toHaveLength(2);
  });

  it("reports a partial save when only some lots are new", () => {
    const repo = new FakeTaxLotRepository([
      { ticker: "ZZZ", buyDate: "2020-01-01", shares: 10, pricePerShareCents: 10_000 },
    ]);
    const result = saveAdhocLots(repo, {
      ticker: "ZZZ",
      lots: [
        adhocLot({ buyDate: "2020-01-01", shares: 10, pricePerShare: 100 }),
        adhocLot({ buyDate: "2022-03-01", shares: 20, pricePerShare: 50 }),
      ],
    });

    expect(result.saved).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.saved[0].buyDate).toBe("2022-03-01");
  });

  it("collapses two identical rows inside one submission", () => {
    const repo = new FakeTaxLotRepository();
    const lot = adhocLot({ buyDate: "2020-01-01", shares: 10, pricePerShare: 100 });
    const result = saveAdhocLots(repo, { ticker: "ZZZ", lots: [lot, lot] });

    expect(result.saved).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });

  it("ignores brokerage and note when deciding what is a duplicate", () => {
    // The same buy re-seeded from the ledger can arrive carrying a note the stored
    // copy lacks; treating that as a new lot would double the position.
    const repo = new FakeTaxLotRepository([
      {
        ticker: "ZZZ",
        buyDate: "2020-01-01",
        shares: 10,
        pricePerShareCents: 10_000,
        brokerageFirm: "",
        note: "",
      },
    ]);
    const result = saveAdhocLots(repo, {
      ticker: "ZZZ",
      lots: [
        adhocLot({
          buyDate: "2020-01-01",
          shares: 10,
          pricePerShare: 100,
          brokerageFirm: "Chase",
          note: "seeded from ledger",
        }),
      ],
    });

    expect(result.saved).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  it("treats a different price on the same date as a distinct lot", () => {
    const repo = new FakeTaxLotRepository([
      { ticker: "ZZZ", buyDate: "2020-01-01", shares: 10, pricePerShareCents: 10_000 },
    ]);
    const result = saveAdhocLots(repo, {
      ticker: "ZZZ",
      lots: [adhocLot({ buyDate: "2020-01-01", shares: 10, pricePerShare: 101 })],
    });
    expect(result.saved).toHaveLength(1);
  });

  it("does not confuse another ticker's identical lot for a duplicate", () => {
    const repo = new FakeTaxLotRepository([
      { ticker: "AAA", buyDate: "2020-01-01", shares: 10, pricePerShareCents: 10_000 },
    ]);
    const result = saveAdhocLots(repo, {
      ticker: "ZZZ",
      lots: [adhocLot({ buyDate: "2020-01-01", shares: 10, pricePerShare: 100 })],
    });
    expect(result.saved).toHaveLength(1);
  });

  it("rejects an empty save", () => {
    expect(() => saveAdhocLotsSchema.parse({ ticker: "ZZZ", lots: [] })).toThrow();
  });
});

describe("encodeTickerLots / decodeTickerLots", () => {
  const entries = [
    { ticker: "NVDA", lots: [adhocLot({ buyDate: "2019-03-15", shares: 10, pricePerShare: 180 })] },
    {
      ticker: "AAPL",
      lots: [
        adhocLot({ buyDate: "2020-01-01", shares: 5, pricePerShare: 75 }),
        adhocLot({ buyDate: "2021-06-15", shares: 3, pricePerShare: 130, brokerageFirm: "Chase" }),
      ],
    },
  ];

  it("round-trips several tickers each with their own lots", () => {
    expect(decodeTickerLots(encodeTickerLots(entries))).toEqual(entries);
  });

  it("preserves the ticker order it was given", () => {
    const decoded = decodeTickerLots(encodeTickerLots(entries));
    expect(decoded?.map((entry) => entry.ticker)).toEqual(["NVDA", "AAPL"]);
  });

  it("uppercases a lower-cased symbol on the way back in", () => {
    const decoded = decodeTickerLots(`nvda=${encodeAdhocLots([adhocLot()])}`);
    expect(decoded?.[0].ticker).toBe("NVDA");
  });

  it("drops a ticker carrying no lots rather than encoding an empty block", () => {
    const encoded = encodeTickerLots([...entries, { ticker: "ZZZ", lots: [] }]);
    expect(decodeTickerLots(encoded)).toHaveLength(2);
  });

  it("returns undefined for an absent, empty or unusable param", () => {
    expect(decodeTickerLots(undefined)).toBeUndefined();
    expect(decodeTickerLots("")).toBeUndefined();
    // No symbol separator at all.
    expect(decodeTickerLots("NVDA")).toBeUndefined();
    // Empty symbol.
    expect(decodeTickerLots("=2020-01-01~10~100~1~~")).toBeUndefined();
  });

  it("rejects the whole param when any one ticker's lots are bad", () => {
    // A partial decode would show a confident grand total with a ticker silently
    // missing from it.
    const good = encodeTickerLots(entries);
    expect(decodeTickerLots(`${good};ZZZ=2020-01-01~0~100~1~~`)).toBeUndefined();
  });

  it("keeps a lots payload intact when the note contains no separators", () => {
    const withNote = [{ ticker: "ZZZ", lots: [adhocLot({ note: "long term hold" })] }];
    expect(decodeTickerLots(encodeTickerLots(withNote))).toEqual(withNote);
  });
});
