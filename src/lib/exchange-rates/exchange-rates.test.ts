import { describe, expect, it } from "vitest";
import type { ExchangeRateClient } from "../market-data/ports";
import type { FxQuote } from "../market-data/types";
import { CURRENCIES, CURRENCY_CODES } from "./catalogue";
import {
  changePercent,
  loadCurrencyBoard,
  rateFractionDigits,
  rateScale,
} from "./exchange-rates";
import { currencyBoardSchema, parseCurrencyCodes } from "./schema";

/**
 * A client that answers from a table, and rejects for anything not in it — which
 * is how the partial-failure paths are driven without touching the network.
 */
function fakeClient(table: Record<string, Partial<FxQuote>>): ExchangeRateClient {
  return {
    async getRate(symbol: string): Promise<FxQuote> {
      const entry = table[symbol];
      if (!entry) throw new Error(`No rate data for ${symbol}.`);
      return {
        symbol,
        rate: entry.rate ?? 1,
        previousClose: entry.previousClose ?? 0,
        shortName: entry.shortName,
      };
    },
  };
}

describe("catalogue", () => {
  it("keeps CURRENCY_CODES in step with CURRENCIES", () => {
    // The literal tuple exists for `z.enum` and so can drift from the catalogue
    // it mirrors. This is the check that stops that.
    expect([...CURRENCY_CODES]).toEqual(CURRENCIES.map((currency) => currency.code));
  });

  it("quotes every currency against one US dollar", () => {
    // Every row reads "1 USD = X", so every symbol must be USD-based. An inverted
    // pair would render a correct-looking number that means the opposite thing.
    for (const currency of CURRENCIES) {
      expect(currency.symbol, currency.code).toBe(`USD${currency.code}=X`);
    }
  });
});

describe("rateScale", () => {
  it("prints a sub-10 rate fine and a larger one coarse", () => {
    expect(rateScale(0.9183)).toBe("fine");
    expect(rateFractionDigits(0.9183)).toBe(4);
    expect(rateScale(149.82)).toBe("coarse");
    expect(rateFractionDigits(149.82)).toBe(2);
  });

  it("treats exactly 10 as coarse", () => {
    // The boundary is documented as "below 10 is fine", so 10 itself is not.
    expect(rateScale(10)).toBe("coarse");
  });
});

describe("changePercent", () => {
  it("computes a signed move against the previous close", () => {
    expect(changePercent(110, 100)).toBeCloseTo(10, 10);
    expect(changePercent(90, 100)).toBeCloseTo(-10, 10);
    expect(changePercent(100, 100)).toBe(0);
  });

  it("reports an unusable previous close as unknown rather than flat", () => {
    // Zero would claim the rate did not move, which is a different statement
    // from "the provider did not say".
    expect(changePercent(7.1, undefined)).toBeUndefined();
    expect(changePercent(7.1, 0)).toBeUndefined();
    expect(changePercent(7.1, Number.NaN)).toBeUndefined();
  });
});

describe("loadCurrencyBoard", () => {
  it("returns every requested rate, in catalogue order", async () => {
    const client = fakeClient({
      "USDCNY=X": { rate: 7.1234, previousClose: 7.1 },
      "USDEUR=X": { rate: 0.9183, previousClose: 0.92 },
      "USDJPY=X": { rate: 149.82, previousClose: 149 },
    });

    // Deliberately out of catalogue order — the board must not echo the argument
    // order back, it must impose the catalogue's.
    const board = await loadCurrencyBoard(client, ["JPY", "CNY", "EUR"]);

    expect(board.rates.map((rate) => rate.code)).toEqual(["JPY", "CNY", "EUR"]);
    expect(board.failures).toEqual([]);
    expect(board.rates[1]?.rate).toBe(7.1234);
    expect(board.rates[1]?.changePct).toBeCloseTo(0.3296, 3);
    expect(board.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("defaults to the whole catalogue", async () => {
    const table = Object.fromEntries(
      CURRENCIES.map((currency) => [currency.symbol, { rate: 2, previousClose: 2 }]),
    );
    const board = await loadCurrencyBoard(fakeClient(table));

    expect(board.rates).toHaveLength(CURRENCIES.length);
    expect(board.failures).toEqual([]);
  });

  it("reports a dead symbol as a failure and keeps the good rows", async () => {
    // The whole reason failures are collected rather than thrown: one bad pair
    // must not blank the card.
    const client = fakeClient({
      "USDCNY=X": { rate: 7.12, previousClose: 7.1 },
      // EUR deliberately absent — the fake rejects it.
    });

    const board = await loadCurrencyBoard(client, ["CNY", "EUR"]);

    expect(board.rates.map((rate) => rate.code)).toEqual(["CNY"]);
    expect(board.failures).toEqual([
      { code: "EUR", message: "No rate data for USDEUR=X." },
    ]);
  });

  it("returns an empty board rather than throwing when every symbol fails", async () => {
    const board = await loadCurrencyBoard(fakeClient({}), ["CNY", "EUR"]);

    expect(board.rates).toEqual([]);
    expect(board.failures).toHaveLength(2);
    expect(board.fetchedAt).toBeTruthy();
  });

  it("leaves changePct undefined when the provider omits the previous close", async () => {
    const client = fakeClient({ "USDCNY=X": { rate: 7.12, previousClose: 0 } });
    const board = await loadCurrencyBoard(client, ["CNY"]);

    expect(board.rates[0]?.changePct).toBeUndefined();
    expect(board.rates[0]?.previousRate).toBeUndefined();
  });

  it("throws for a code that is not on the board", async () => {
    // A programming mistake, unlike a provider outage — so this one does throw.
    await expect(loadCurrencyBoard(fakeClient({}), ["XYZ"])).rejects.toThrow("Unknown currency: XYZ");
  });
});

describe("currencyBoardSchema", () => {
  it("accepts an omitted list and de-duplicates a repeated code", () => {
    expect(currencyBoardSchema.parse({})).toEqual({});
    expect(currencyBoardSchema.parse({ codes: ["CNY", "CNY", "EUR"] }).codes).toEqual([
      "CNY",
      "EUR",
    ]);
  });

  it("rejects an uncatalogued code and an empty list", () => {
    expect(() => currencyBoardSchema.parse({ codes: ["XYZ"] })).toThrow();
    expect(() => currencyBoardSchema.parse({ codes: [] })).toThrow("Pick at least one currency.");
  });

  it("upper-cases raw input before validating", () => {
    expect(parseCurrencyCodes(["eur", "gbp"]).codes).toEqual(["EUR", "GBP"]);
    expect(parseCurrencyCodes(undefined)).toEqual({});
  });
});
