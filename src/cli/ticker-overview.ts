// Prints what the ticker viewer shows, for one symbol. Thin adapter: parse argv,
// call the same use-cases the web dialog calls, format for a terminal.
//
//   npm run cli -- ticker-overview AAPL            (our records only)
//   npm run cli -- ticker-overview AAPL --market   (also hit the provider)

import { formatCents } from "@/lib/shared/money";
import {
  getTickerNewsFeed,
  getTickerOwnData,
  getTickerQuote,
  getTickerRisk,
} from "@/lib/ticker-overview";
import { deps } from "@/lib/wiring";

function signed(cents: number): string {
  return `${cents >= 0 ? "+" : "-"}${formatCents(Math.abs(cents))}`;
}

export async function tickerOverviewCommand(args: string[]): Promise<void> {
  // `--market` is a boolean switch, so `parseFlags` (which reads `--key value`
  // pairs) isn't the right tool here — the ticker is a bare positional.
  const withMarket = args.includes("--market");
  const ticker = args.find((arg) => !arg.startsWith("--"));

  if (!ticker) {
    console.error("Usage: ticker-overview <TICKER> [--market]");
    process.exitCode = 1;
    return;
  }

  const own = getTickerOwnData(
    { ticker },
    {
      positions: deps.stockPositionRepo,
      accounts: deps.investmentAccountRepo,
      watchLists: deps.stockWatchListRepo,
    },
  );

  console.log(`${own.ticker}${own.name ? ` — ${own.name}` : ""}`);
  console.log("");
  console.log("OUR DATA");

  if (own.isHeld) {
    console.log(
      `  Shares ${own.totals.quantity} across ${own.totals.accountCount} account(s)` +
        ` · value ${formatCents(own.totals.valueCents)}` +
        ` · cost ${own.totals.costCents > 0 ? formatCents(own.totals.costCents) : "n/a"}`,
    );
    console.log(
      `  Today ${signed(own.totals.dayGainLossCents)} (${own.totals.dayChangePct.toFixed(2)}%)` +
        ` · unrealized ${signed(own.totals.unrealizedGainLossCents)}` +
        ` (${own.totals.totalReturnPct.toFixed(2)}%)`,
    );
    for (const holding of own.holdings) {
      console.log(
        `    ${holding.accountName}: ${holding.quantity} sh · ${formatCents(holding.valueCents)}` +
          ` · ${signed(holding.unrealizedGainLossCents)}`,
      );
    }
  } else {
    console.log("  No position recorded.");
  }

  console.log(
    `  Trades: ${own.trades.transactions.length}` +
      ` (${own.trades.buyCount} buy / ${own.trades.sellCount} sell)` +
      (own.trades.averageCostBasisCents != null
        ? ` · avg basis ${formatCents(Math.round(own.trades.averageCostBasisCents))}`
        : ""),
  );
  console.log(
    `  Dividends: ${formatCents(own.income.dividendRateCents)}/share` +
      ` · est. ${formatCents(own.income.estAnnualIncomeCents)}/yr` +
      ` · yield on cost ${own.income.yieldOnCostPct.toFixed(2)}%`,
  );
  for (const entry of own.watchEntries) {
    console.log(
      `  Watchlist "${entry.watchListName}" since ${entry.addedDate}` +
        ` · ${entry.changeSinceAddedPct.toFixed(2)}% since added`,
    );
  }

  if (!withMarket) return;

  console.log("");
  console.log("MARKET");

  // Each leg is reported independently: a news outage shouldn't hide the quote.
  const [quote, risk, news] = await Promise.allSettled([
    getTickerQuote(deps.marketDataClient, { ticker }),
    getTickerRisk(deps.marketDataClient, { ticker }),
    getTickerNewsFeed(deps.tickerNewsClient, { ticker }),
  ]);

  if (quote.status === "fulfilled") {
    console.log(
      `  Quote ${formatCents(quote.value.priceCents)}` +
        ` · ${signed(quote.value.changeCents)} (${quote.value.changePct.toFixed(2)}%)` +
        ` · day ${formatCents(quote.value.dayLowCents)}–${formatCents(quote.value.dayHighCents)}`,
    );
  } else {
    console.error(`  Quote unavailable: ${quote.reason}`);
  }

  if (risk.status === "fulfilled") {
    console.log(
      `  Volatility ${risk.value.annualizedVolPct.toFixed(1)}% (${risk.value.volatilityLabel})` +
        ` · 52w ${formatCents(risk.value.low52wCents)}–${formatCents(risk.value.high52wCents)}` +
        ` · ${risk.value.rangePositionPct.toFixed(0)}% up the range`,
    );
    console.log(
      `  Correlation to ${risk.value.marketBenchmarkTicker}: ` +
        (risk.value.marketCorrelation?.toFixed(2) ?? "n/a"),
    );
  } else {
    console.error(`  Risk unavailable: ${risk.reason}`);
  }

  if (news.status === "fulfilled") {
    for (const story of news.value.stories.slice(0, 5)) {
      console.log(`  · ${story.title} — ${story.publisher}${story.isFromToday ? " [today]" : ""}`);
    }
    if (news.value.stories.length === 0) console.log("  No recent stories.");
  } else {
    console.error(`  News unavailable: ${news.reason}`);
  }
}
