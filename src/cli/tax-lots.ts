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
// Ad-hoc mode — score transactions passed in on the command line, storing nothing.
// This is the same use-case the web screen's `?lots=` URL drives, so the two report
// identical figures:
//
//   npm run cli -- tax-lots --adhoc --ticker NVDA --price 175.50 \
//     --lot 2019-03-15:10:180 --lot 2021-01-04:5:130
//   npm run cli -- tax-lots --from-trades --ticker NVDA   # seed from recorded buys
//   npm run cli -- tax-lots --from-trades --ticker NVDA --save
//
// Multi-ticker — the "Add by tickers" screen's use-case, from a terminal:
//
//   npm run cli -- tax-lots --tickers NVDA,AAPL,MSFT
//
// Adding this command required zero changes to src/lib — which is the point of the
// layering rule, and worth checking the next time a use-case is added.

import { todayIsoLocal } from "@/lib/shared/date";
import { dollarsToCents } from "@/lib/shared/money";
import { listTransactions } from "@/lib/stock-positions";
import {
  analyzeAdhocLots,
  analyzeAdhocLotsSchema,
  analyzeMultipleTickers,
  multiTickerLotsSchema,
  analyzeLotsSchema,
  analyzeTicker,
  listTaxLotTickers,
  lotsFromTrades,
  normalizeLot,
  normalizeLotSchema,
  saveAdhocLots,
  saveAdhocLotsSchema,
  splitHistoryFor,
  splitsAppliedTo,
  type AdhocLotInput,
  type LotPerformance,
  type PortfolioAnalysis,
  type TickerPricing,
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

/**
 * Collects every `--lot date:shares:price[:brokerage[:note]]` off argv.
 *
 * Read from argv directly rather than through `parseFlags`, which flattens repeats
 * into a single key — and a repeated flag is the whole point here, since the feature
 * being exercised is *multiple* transactions.
 *
 * Colon-delimited, so a lot is one shell word without quoting. Brokerage and note
 * are optional; `isSplitAdjusted` is not settable per lot from the command line, so
 * `--adjusted` sets it for the whole set (the web screen, which has room for a
 * checkbox per row, is where a mixed set gets edited).
 */
function collectLotFlags(args: string[], isSplitAdjusted: boolean): AdhocLotInput[] {
  const lots: AdhocLotInput[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--lot") continue;
    const value = args[index + 1];
    if (!value) throw new Error("--lot needs a value, e.g. --lot 2019-03-15:10:180");

    const [buyDate, shares, price, brokerageFirm, note] = value.split(":");
    // Not validated here — the schema does it, the same schema the web form and the
    // URL decoder use, so argv cannot produce a shape they would have rejected.
    lots.push({
      buyDate,
      shares: Number(shares),
      pricePerShare: Number(price),
      isSplitAdjusted,
      brokerageFirm: brokerageFirm ?? "",
      note: note ?? "",
    } as AdhocLotInput);
  }
  return lots;
}

/**
 * `--adhoc` / `--from-trades`: score a passed-in or ledger-seeded set, storing
 * nothing unless `--save` is given.
 *
 * Deliberately the same three calls the web screen makes — `lotsFromTrades`,
 * `analyzeAdhocLots`, `saveAdhocLots` — because "the CLI drives the real use-case"
 * is only true if it drives *these* and not a terminal-shaped copy of them.
 */
function runAdhoc(args: string[], flags: Record<string, string>, fromTrades: boolean): void {
  const ticker = flags.ticker;
  if (!ticker) throw new Error("--ticker is required.");
  const symbol = ticker.trim().toUpperCase();

  let lots: AdhocLotInput[];
  if (fromTrades) {
    const seeded = lotsFromTrades(listTransactions(deps.stockPositionRepo, symbol));
    lots = seeded.lots;
    if (seeded.skippedSells > 0) {
      console.log(
        `Skipped ${seeded.skippedSells} sell transaction(s) — a tax lot is a purchase, so this is a gross position, not a net one.`,
      );
    }
    if (seeded.skippedInvalid > 0) {
      console.log(`Skipped ${seeded.skippedInvalid} unusable row(s) — no shares, or no date.`);
    }
    if (lots.length === 0) throw new Error(`No buy transactions recorded for ${symbol}.`);
  } else {
    lots = collectLotFlags(args, args.includes("--adjusted"));
    if (lots.length === 0) {
      throw new Error("Pass at least one --lot, e.g. --lot 2019-03-15:10:180");
    }
  }

  // Same price fallback as the stored path: the held position unless overridden.
  const positions = deps.stockPositionRepo
    .listPositionsByTicker(symbol)
    .filter((position) => position.currentPriceCents > 0);
  const positionPriceCents = positions[0]?.currentPriceCents;
  const positionDividendCents = positions.find(
    (position) => position.dividendRateCents > 0,
  )?.dividendRateCents;
  // With nothing stored to fall back on, an unheld ticker is priced off the newest
  // lot PASSED IN — the same rule the web screen applies, reported as an assumption.
  const newestPassedIn = [...lots].sort((left, right) =>
    left.buyDate.localeCompare(right.buyDate),
  ).at(-1);

  const input = analyzeAdhocLotsSchema.parse({
    ticker: symbol,
    currentMarketPrice: flags.price
      ? dollarsToCents(flags.price) / 100
      : ((positionPriceCents ?? 0) / 100 || (newestPassedIn?.pricePerShare ?? 0)),
    trailingEPS: flags.eps
      ? dollarsToCents(flags.eps) / 100
      : (positionDividendCents ?? 0) / 100,
    today: flags.today ?? todayIsoLocal(),
    lots,
  });

  if (positionPriceCents === undefined && !flags.price) {
    console.log(
      `No current price for ${input.ticker} — using ${money(input.currentMarketPrice)} from the newest transaction. Pass --price for a real quote.`,
    );
  }
  console.log("");

  printAnalysis(
    input.ticker,
    input.currentMarketPrice,
    input.today,
    input.trailingEPS,
    analyzeAdhocLots(input),
  );

  if (!args.includes("--save")) {
    console.log("");
    console.log("Nothing stored. Pass --save to record these as tax lots.");
    return;
  }

  const result = saveAdhocLots(
    deps.taxLotRepo,
    saveAdhocLotsSchema.parse({ ticker: input.ticker, lots: input.lots }),
  );
  console.log("");
  // Both counts, always — a bare "saved" after a second run would leave no way to
  // tell whether it did nothing or doubled the position.
  console.log(
    `Saved ${result.saved.length} lot(s); skipped ${result.skipped.length} already recorded.`,
  );
}

/**
 * `--tickers NVDA,AAPL`: the multi-ticker screen's use-case from a terminal.
 *
 * Drives the same three `lib` functions the web section does — `lotsFromTrades` to
 * seed, `analyzeMultipleTickers` to score, and the schema to validate — so the two
 * cannot report different figures. Adding this needed no change to `src/lib`, which
 * is the check ARCHITECTURE.md asks for on every new use-case.
 */
function runMultiTicker(flags: Record<string, string>): void {
  const requested = [
    ...new Set(
      (flags.tickers ?? "")
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (requested.length === 0) {
    throw new Error("--tickers needs a comma-separated list, e.g. --tickers NVDA,AAPL");
  }

  const entries = requested
    .map((ticker) => ({
      ticker,
      lots: lotsFromTrades(listTransactions(deps.stockPositionRepo, ticker)).lots,
    }))
    .filter((entry) => entry.lots.length > 0);

  const withoutBuys = requested.filter(
    (ticker) => !entries.some((entry) => entry.ticker === ticker),
  );
  if (withoutBuys.length > 0) {
    console.log(`No buy transactions for: ${withoutBuys.join(", ")} — skipped.`);
  }
  if (entries.length === 0) throw new Error("None of those tickers has a buy transaction.");

  const input = multiTickerLotsSchema.parse({
    today: flags.today ?? todayIsoLocal(),
    tickers: entries,
  });

  // Priced from the held position, the same fallback the web section applies; 0
  // hands the decision to `analyzeMultipleTickers`, which uses the newest lot.
  const pricing = new Map<string, TickerPricing>();
  for (const entry of input.tickers) {
    const positions = deps.stockPositionRepo
      .listPositionsByTicker(entry.ticker)
      .filter((position) => position.currentPriceCents > 0);
    const livePriceCents = positions[0]?.currentPriceCents;
    const dividendRateCents = positions.find(
      (position) => position.dividendRateCents > 0,
    )?.dividendRateCents;
    pricing.set(entry.ticker, {
      ticker: entry.ticker,
      currentMarketPrice: (livePriceCents ?? 0) / 100,
      hasLivePrice: livePriceCents !== undefined,
      trailingEPS: (dividendRateCents ?? 0) / 100,
    });
  }

  const { sections, totals } = analyzeMultipleTickers(input, pricing);

  for (const section of sections) {
    console.log("");
    console.log("=".repeat(78));
    if (!section.hasLivePrice) {
      console.log(
        `(${section.ticker} is not a held position — priced at ${money(section.currentMarketPrice)} from its newest transaction.)`,
      );
    }
    printAnalysis(
      section.ticker,
      section.currentMarketPrice,
      input.today,
      pricing.get(section.ticker)?.trailingEPS ?? 0,
      section.analysis,
    );
  }

  console.log("");
  console.log("=".repeat(78));
  console.log(`GRAND TOTAL — ${totals.tickerCount} ticker(s), ${totals.lotCount} lot(s)`);
  console.log(`  total invested:       ${money(totals.totalCapitalInvested)}`);
  console.log(`  current value:        ${money(totals.totalCurrentValue)}`);
  console.log(
    `  total gain:           ${signedMoney(totals.totalGainDollars)} (${percent(totals.totalGainPercent)})`,
  );
  console.log(
    `  combined XIRR:        ${totals.xirr === undefined ? "n/a (needs more than one purchase date)" : rate(totals.xirr)}`,
  );
  console.log(
    `  long term:            ${totals.longTermLotCount} lot(s), ${money(totals.longTermValue)}`,
  );
  console.log(
    `  short term:           ${totals.shortTermLotCount} lot(s), ${money(totals.shortTermValue)}`,
  );
  // No blended cost basis: dollars per share across different symbols is not a unit.
  if (totals.trimCandidateCount > 0) {
    console.log(
      `* ${totals.trimCandidateCount} lot(s) across every ticker are long-term AND in profit.`,
    );
  }
  console.log("");
  console.log("Nothing stored — this is analysis only.");
}

export async function taxLotsCommand(args: string[]): Promise<void> {
  // `parseFlags` gives every `--flag` the next argv item as its value, so a bare
  // switch anywhere but last swallows the flag after it — `--normalize --ticker
  // NVDA` parsed as `normalize: "--ticker"` and left `ticker` unset. So the two
  // valueless switches are read off argv and REMOVED before the rest is parsed,
  // which makes flag order irrelevant.
  const VALUELESS = ["--list", "--normalize", "--adhoc", "--from-trades", "--save", "--adjusted"];
  const hasSwitch = (name: string) => args.includes(`--${name}`);
  const flags = parseFlags(args.filter((arg) => !VALUELESS.includes(arg)));

  if (hasSwitch("list")) {
    const stored = listTaxLotTickers(deps.taxLotRepo);
    if (stored.length === 0) {
      console.log("No tax lots recorded.");
      return;
    }
    console.log(`Tickers with recorded lots: ${stored.join(", ")}`);
    return;
  }

  // Ad-hoc and normalize are dispatched BEFORE anything reads storage: neither
  // stores or loads a lot, so neither should fail on a database that has no tax-lot
  // table. Reading the ticker list up front made both depend on it for nothing.
  if (flags.tickers) {
    try {
      runMultiTicker(flags);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      console.error("Usage: tax-lots --tickers NVDA,AAPL,MSFT");
      process.exitCode = 1;
    }
    return;
  }

  if (hasSwitch("adhoc") || hasSwitch("from-trades")) {
    try {
      runAdhoc(args, flags, hasSwitch("from-trades"));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      console.error(
        "Usage: tax-lots --adhoc --ticker NVDA --lot 2019-03-15:10:180 --lot 2021-01-04:5:130",
      );
      console.error("   or: tax-lots --from-trades --ticker NVDA [--save]");
      process.exitCode = 1;
    }
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

  const tickers = listTaxLotTickers(deps.taxLotRepo);
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

  const analysis = analyzeTicker(deps.taxLotRepo, input);

  if (analysis.lots.length === 0) {
    console.log(`No tax lots recorded for ${input.ticker}.`);
    if (tickers.length > 0) console.log(`Known: ${tickers.join(", ")}`);
    return;
  }

  printAnalysis(input.ticker, input.currentMarketPrice, input.today, input.trailingEPS, analysis);
}

/**
 * The whole report for one analyzed set: the lot table, then the roll-up.
 *
 * Shared by the stored and the ad-hoc paths rather than written twice — the two
 * modes exist to be compared, so a figure formatted differently in one of them
 * would defeat the point.
 */
function printAnalysis(
  ticker: string,
  currentMarketPrice: number,
  today: string,
  trailingEPS: number,
  { lots, summary }: PortfolioAnalysis,
): void {
  console.log(`${ticker} tax lots — ${money(currentMarketPrice)}/share as of ${today}`);
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
    `  blended yield on cost:${trailingEPS > 0 ? ` ${summary.blendedYieldOnCost.toFixed(2)}%` : " n/a"}`,
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
