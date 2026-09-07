// The Tax Lot Analyzer from a terminal. Thin adapter: parse argv, validate with the
// module's zod schema, call the same `analyzeTicker` use-case the web section calls,
// print a table.
//
//   npm run cli -- tax-lots --ticker NVDA
//   npm run cli -- tax-lots --ticker NVDA --price 175.50 --eps 0.04
//   npm run cli -- tax-lots --ticker NVDA --today 2025-01-01
//   npm run cli -- tax-lots --list
//   npm run cli -- tax-lots --normalize --ticker NVDA --date 2019-03-15 --shares 10 --price 180
//
// Adding this command required zero changes to src/lib — which is the point of the
// layering rule, and worth checking the next time a use-case is added.

import { todayIsoLocal } from "@/lib/shared/date";
import { dollarsToCents } from "@/lib/shared/money";
import {
  analyzeLotsSchema,
  analyzeTicker,
  listTaxLotTickers,
  normalizeLot,
  normalizeLotSchema,
  splitHistoryFor,
  splitsAppliedTo,
  type LotPerformance,
} from "@/lib/tax-lots";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

function pad(value: string, width: number): string {
  return value.padEnd(width);
}

function padStart(value: string, width: number): string {
  return value.padStart(width);
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function signedMoney(value: number): string {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

function percent(value: number): string {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}%`;
}

/** A rate stored as a fraction shown as a percent. */
function rate(value: number): string {
  return percent(value * 100);
}

function lotRow(lot: LotPerformance): string {
  return [
    `  ${pad(lot.buyDate, 12)}`,
    padStart(lot.adjustedShares.toFixed(2), 12),
    padStart(money(lot.adjustedCostPerShare), 14),
    padStart(money(lot.costBasis), 13),
    padStart(percent(lot.unrealizedGainPercent), 12),
    padStart(lot.yearsHeld > 0 ? rate(lot.cagr) : "n/a", 11),
    padStart(lot.yieldOnCost > 0 ? `${lot.yieldOnCost.toFixed(2)}%` : "n/a", 9),
    // The ✓ marks a tax-efficient trimming candidate, same rule as the web view.
    `  ${lot.taxClassification === "LONG_TERM" ? "LONG " : "SHORT"}${lot.isTrimCandidate ? " *" : ""}`,
  ].join("");
}

/** `--normalize`: restate one ad-hoc lot without storing it. */
function runNormalize(flags: Record<string, string>): void {
  const input = normalizeLotSchema.parse({
    ticker: flags.ticker,
    buyDate: flags.date,
    rawShares: Number(flags.shares),
    rawPrice: Number(flags.price),
  });

  const history = splitHistoryFor(input.ticker);
  const result = normalizeLot(
    { buyDate: input.buyDate, rawShares: input.rawShares, rawPrice: input.rawPrice },
    history,
  );
  const applied = splitsAppliedTo(input.buyDate, history);

  console.log(`${input.ticker} lot bought ${input.buyDate}`);
  console.log(`  as entered:  ${input.rawShares} shares @ ${money(input.rawPrice)}`);
  console.log(
    `  splits since: ${applied.length > 0 ? applied.map((split) => `${split.label} on ${split.effectiveDate}`).join(", ") : "none"}`,
  );
  console.log(`  factor:      x${result.cumulativeSplitFactor}`);
  console.log(
    `  adjusted:    ${result.adjustedShares} shares @ ${money(result.adjustedCostPerShare)}`,
  );
  console.log(`  cost basis:  ${money(result.costBasis)} (unchanged by the split)`);
}

export async function taxLotsCommand(args: string[]): Promise<void> {
  // `parseFlags` gives every `--flag` the next argv item as its value, so a bare
  // switch anywhere but last swallows the flag after it — `--normalize --ticker
  // NVDA` parsed as `normalize: "--ticker"` and left `ticker` unset. So the two
  // valueless switches are read off argv and REMOVED before the rest is parsed,
  // which makes flag order irrelevant.
  const VALUELESS = ["--list", "--normalize"];
  const hasSwitch = (name: string) => args.includes(`--${name}`);
  const flags = parseFlags(args.filter((arg) => !VALUELESS.includes(arg)));

  const tickers = listTaxLotTickers(deps.taxLotRepo);

  if (hasSwitch("list")) {
    if (tickers.length === 0) {
      console.log("No tax lots recorded.");
      return;
    }
    console.log(`Tickers with recorded lots: ${tickers.join(", ")}`);
    return;
  }

  if (hasSwitch("normalize")) {
    try {
      runNormalize(flags);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      console.error(
        "Usage: tax-lots --normalize --ticker NVDA --date 2019-03-15 --shares 10 --price 180",
      );
      process.exitCode = 1;
    }
    return;
  }

  const ticker = flags.ticker ?? tickers[0];
  if (!ticker) {
    console.error("No tax lots recorded. Add one in the web app, or pass --ticker.");
    process.exitCode = 1;
    return;
  }

  // Price and EPS come from the held position when the flags don't override them,
  // the same fallback the web section uses.
  const positions = deps.stockPositionRepo
    .listPositionsByTicker(ticker.trim().toUpperCase())
    .filter((position) => position.currentPriceCents > 0);
  const positionPriceCents = positions[0]?.currentPriceCents;
  const positionDividendCents = positions.find(
    (position) => position.dividendRateCents > 0,
  )?.dividendRateCents;

  let input;
  try {
    // The schema validates, exactly as it does in the web action — argv's raw
    // strings become the same typed input without a cast.
    input = analyzeLotsSchema.parse({
      ticker,
      currentMarketPrice: flags.price
        ? dollarsToCents(flags.price) / 100
        : (positionPriceCents ?? 0) / 100,
      trailingEPS: flags.eps
        ? dollarsToCents(flags.eps) / 100
        : (positionDividendCents ?? 0) / 100,
      today: flags.today ?? todayIsoLocal(),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  if (input.currentMarketPrice === 0) {
    console.error(
      `No current price for ${input.ticker} — it isn't a held position. Pass --price.`,
    );
    process.exitCode = 1;
    return;
  }

  const { lots, summary } = analyzeTicker(deps.taxLotRepo, input);

  if (lots.length === 0) {
    console.log(`No tax lots recorded for ${input.ticker}.`);
    if (tickers.length > 0) console.log(`Known: ${tickers.join(", ")}`);
    return;
  }

  console.log(
    `${input.ticker} tax lots — ${money(input.currentMarketPrice)}/share as of ${input.today}`,
  );
  console.log("");
  console.log(
    `  ${pad("BOUGHT", 12)}${padStart("ADJ SHARES", 12)}${padStart("ADJ COST/SH", 14)}${padStart("COST BASIS", 13)}${padStart("GAIN %", 12)}${padStart("CAGR", 11)}${padStart("YOC", 9)}  STATUS`,
  );
  for (const lot of lots) console.log(lotRow(lot));

  console.log("");
  console.log("Position summary");
  console.log(`  lots:                 ${summary.lotCount}`);
  console.log(`  adjusted shares:      ${summary.totalAdjustedShares.toFixed(2)}`);
  console.log(`  total invested:       ${money(summary.totalCapitalInvested)}`);
  console.log(`  current value:        ${money(summary.totalCurrentValue)}`);
  console.log(
    `  total gain:           ${signedMoney(summary.totalGainDollars)} (${percent(summary.totalGainPercent)})`,
  );
  console.log(`  blended cost basis:   ${money(summary.blendedCostBasis)}`);
  // "n/a" rather than 0% — see computeXirr on why undefined is not a flat return.
  console.log(
    `  position XIRR:        ${summary.xirr === undefined ? "n/a (needs more than one purchase date)" : rate(summary.xirr)}`,
  );
  console.log(
    `  blended yield on cost:${input.trailingEPS > 0 ? ` ${summary.blendedYieldOnCost.toFixed(2)}%` : " n/a"}`,
  );
  console.log(
    `  long term:            ${summary.longTermLotCount} lot(s), ${money(summary.longTermValue)}`,
  );
  console.log(
    `  short term:           ${summary.shortTermLotCount} lot(s), ${money(summary.shortTermValue)}`,
  );

  const trimCandidates = lots.filter((lot) => lot.isTrimCandidate);
  if (trimCandidates.length > 0) {
    console.log("");
    console.log(
      `* ${trimCandidates.length} lot(s) are long-term AND in profit — the tax-efficient ones to trim.`,
    );
  }
}
