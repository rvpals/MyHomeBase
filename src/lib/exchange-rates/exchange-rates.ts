import type { ExchangeRateClient } from "../market-data/ports";
import { CURRENCIES, findCurrency } from "./catalogue";
import type { CurrencyBoard, CurrencyFailure, CurrencyRate, RateScale } from "./types";

/**
 * How many decimals a rate is printed to.
 *
 * A single rule rather than a per-currency setting, because the thing that
 * decides it is the magnitude, not the currency: a rate below 10 carries its
 * information in the decimals (EUR 0.9183 — two places would hide a move of
 * several tenths of a percent), while a rate above 10 carries it in the integer
 * part (KRW 1327.45 — four places would be noise). The boundary sits at 10
 * because that is where the fourth significant figure crosses the decimal point.
 *
 * Lives here with a test rather than in the view, so the card formats and
 * decides nothing.
 */
export function rateScale(rate: number): RateScale {
  return rate < 10 ? "fine" : "coarse";
}

/** Decimal places for a rate — 4 when fine, 2 when coarse. */
export function rateFractionDigits(rate: number): number {
  return rateScale(rate) === "fine" ? 4 : 2;
}

/**
 * The day move as a signed percentage.
 *
 * `undefined` rather than zero when there is nothing to compare against: the
 * provider omits the previous close often enough (a pair that did not trade over
 * a holiday) that reporting those rows as "unchanged" would be a quiet lie. A
 * previous close of zero is treated the same way — it is a missing value, not a
 * rate that was once free.
 */
export function changePercent(rate: number, previousRate: number | undefined): number | undefined {
  if (previousRate === undefined || !Number.isFinite(previousRate) || previousRate <= 0) {
    return undefined;
  }
  return ((rate - previousRate) / previousRate) * 100;
}

/**
 * Fetch every currency on the board, in parallel.
 *
 * **A failed symbol is reported, not thrown.** Ten good rows are worth more than
 * an error page, so each leg is settled independently and the dead ones land in
 * `failures` for the card to show. This throws only if the caller asks for codes
 * that are not on the board at all, which is a programming mistake rather than a
 * provider outage.
 *
 * Order is the catalogue's, not the order the responses arrive in.
 */
export async function loadCurrencyBoard(
  client: ExchangeRateClient,
  codes: readonly string[] = CURRENCIES.map((currency) => currency.code),
  now: Date = new Date(),
): Promise<CurrencyBoard> {
  const wanted = codes.map((code) => {
    const currency = findCurrency(code);
    if (!currency) throw new Error(`Unknown currency: ${code}`);
    return currency;
  });

  const settled = await Promise.allSettled(
    wanted.map((currency) => client.getRate(currency.symbol)),
  );

  const rates: CurrencyRate[] = [];
  const failures: CurrencyFailure[] = [];

  settled.forEach((outcome, index) => {
    const currency = wanted[index]!;
    if (outcome.status === "rejected") {
      const reason = outcome.reason;
      failures.push({
        code: currency.code,
        message: reason instanceof Error ? reason.message : "Failed to fetch the rate.",
      });
      return;
    }

    const quote = outcome.value;
    const previousRate = quote.previousClose > 0 ? quote.previousClose : undefined;
    rates.push({
      code: currency.code,
      label: currency.label,
      flag: currency.flag,
      rate: quote.rate,
      previousRate,
      changePct: changePercent(quote.rate, previousRate),
    });
  });

  return { rates, failures, fetchedAt: now.toISOString() };
}
