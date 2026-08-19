// Aggregates one ticker's story from the modules that each hold a piece of it.
//
// This module owns no storage. It reads through other modules' public surfaces
// (positions, accounts, watchlists, market data, news, the analytics stats) and
// returns the shapes the ticker viewer renders. The one rule it enforces is the
// source split: `getTickerOwnData` never touches the network, and the market
// use-cases never touch the database. A caller can therefore show our own
// figures instantly and pay for a provider round-trip only when the reader opens
// a market tab.

import type {
  MarketDataClient,
  MarketEvent,
  MarketEventsClient,
  PricePoint,
} from "@/lib/market-data";
import { toIsoDateLocal, todayIsoLocal } from "@/lib/shared/date";
import {
  alignSeriesByTimestamp,
  annualizeReturn,
  classifyVolatility,
  computeRangePositionPct,
  computeVolatilityStats,
  dailyReturns,
  pearsonCorrelation,
  MARKET_BENCHMARK_TICKER,
} from "@/lib/stock-analytics";
import {
  UNASSIGNED_ACCOUNT_ID,
  changePct,
  computeAverageCostBasisCents,
  computeTransactionStats,
  type StockPosition,
  type StockTransaction,
} from "@/lib/stock-positions";
import { isPrimarySubject, type RawNewsStory, type TickerNewsClient } from "@/lib/ticker-news";
import type { TickerOwnDataDeps, TickerRiskCacheRepository } from "./ports";
import {
  tickerNewsFeedSchema,
  tickerOverviewSchema,
  tickerPriceSeriesSchema,
  tickerRiskSchema,
} from "./schema";
import type {
  TickerClosePoint,
  TickerEvent,
  TickerEventFeed,
  TickerHistoryRange,
  TickerHolding,
  TickerHoldingTotals,
  TickerIncome,
  TickerNewsFeed,
  TickerOwnData,
  TickerPriceSeries,
  TickerQuote,
  TickerRisk,
  TickerStory,
  TickerTimelineKind,
  TickerTimelinePoint,
  TickerTradeRow,
  TickerTradeTimeline,
  TickerTrades,
  TickerWatchEntry,
} from "./types";

/** Shown for positions on the id-0 pseudo-account, which has no row of its own. */
const UNASSIGNED_ACCOUNT_NAME = "Unassigned";

/** The window the risk figures are computed over. Matches the analytics module. */
const RISK_RANGE = "1y";
const DAILY_INTERVAL = "1d";
/** Below this many closes the statistics are noise, so they're reported as zero. */
const MINIMUM_RISK_OBSERVATIONS = 10;

/**
 * Chart interval per range. Five years of daily closes is ~1,250 points for a
 * chart a few hundred pixels wide — weekly says the same thing in a fifth of
 * the payload.
 */
const INTERVAL_BY_RANGE: Record<TickerHistoryRange, string> = {
  "1mo": "1d",
  "3mo": "1d",
  "6mo": "1d",
  "1y": "1d",
  "5y": "1wk",
};

// ---------------------------------------------------------------------------
// Pure helpers — the arithmetic, testable without a repository or a network.
// ---------------------------------------------------------------------------

/** A percentage of a base, guarding the divide. 0 when the base is zero. */
function percentOf(part: number, base: number): number {
  return base === 0 ? 0 : (part / base) * 100;
}

/** Rolls a ticker's per-account holdings into one set of totals. */
export function summarizeHoldings(holdings: TickerHolding[]): TickerHoldingTotals {
  const totals = holdings.reduce(
    (accumulator, holding) => ({
      quantity: accumulator.quantity + holding.quantity,
      costCents: accumulator.costCents + holding.costCents,
      valueCents: accumulator.valueCents + holding.valueCents,
      dayGainLossCents: accumulator.dayGainLossCents + holding.dayGainLossCents,
      unrealizedGainLossCents:
        accumulator.unrealizedGainLossCents + holding.unrealizedGainLossCents,
    }),
    { quantity: 0, costCents: 0, valueCents: 0, dayGainLossCents: 0, unrealizedGainLossCents: 0 },
  );

  return {
    accountCount: holdings.length,
    ...totals,
    // `changePct` measures the move against the pre-move value, which is what
    // "up 1.2% today" means — not the move against today's closing value.
    dayChangePct: changePct(totals.valueCents, totals.dayGainLossCents),
    totalReturnPct: percentOf(totals.unrealizedGainLossCents, totals.costCents),
    averageUnitCostCents:
      totals.quantity > 0 && totals.costCents > 0
        ? Math.round(totals.costCents / totals.quantity)
        : 0,
  };
}

/**
 * The dividend picture for a holding.
 *
 * `dividendRateCents` is per-share and identical on every account's row, so it's
 * read rather than summed; the income figures are per-account amounts and are.
 * Yield on cost is the more interesting of the two numbers — it says what the
 * position pays against what was actually paid for it — so both are reported.
 */
export function summarizeIncome(
  positions: Pick<
    StockPosition,
    "dividendRateCents" | "estAnnualIncomeCents" | "incomeEarnedCents"
  >[],
  valueCents: number,
  costCents: number,
): TickerIncome {
  const dividendRateCents = positions.find((position) => position.dividendRateCents > 0)
    ?.dividendRateCents ?? 0;
  const estAnnualIncomeCents = positions.reduce(
    (sum, position) => sum + position.estAnnualIncomeCents,
    0,
  );
  const incomeEarnedCents = positions.reduce(
    (sum, position) => sum + position.incomeEarnedCents,
    0,
  );

  return {
    dividendRateCents,
    estAnnualIncomeCents,
    incomeEarnedCents,
    yieldOnValuePct: percentOf(estAnnualIncomeCents, valueCents),
    yieldOnCostPct: percentOf(estAnnualIncomeCents, costCents),
  };
}

/**
 * How far the price has moved since one trade was executed.
 *
 * Same guard as `computeWatchDrift`, for the same reason: a trade recorded
 * without a price, or a ticker we no longer hold and so have no current price
 * for, has no baseline to measure against — and dividing by a zero would read
 * as a total loss rather than as "we don't know".
 *
 * Reported both per share and across the trade's own shares. The percentage is
 * the same either way; the dollar figure is only meaningful against a share
 * count, and this trade's count is the one the row is about.
 */
export function computeTradeMoveSince(
  pricePerShareCents: number,
  numberOfShares: number,
  currentPriceCents: number,
): Pick<
  TickerTradeRow,
  "hasMoveSince" | "moveSinceCentsPerShare" | "moveSinceCents" | "moveSincePct"
> {
  if (pricePerShareCents <= 0 || currentPriceCents <= 0) {
    return {
      hasMoveSince: false,
      moveSinceCentsPerShare: 0,
      moveSinceCents: 0,
      moveSincePct: 0,
    };
  }

  const moveSinceCentsPerShare = currentPriceCents - pricePerShareCents;
  return {
    hasMoveSince: true,
    moveSinceCentsPerShare,
    moveSinceCents: Math.round(moveSinceCentsPerShare * numberOfShares),
    moveSincePct: percentOf(moveSinceCentsPerShare, pricePerShareCents),
  };
}

/**
 * Trade history plus the counts and totals the transactions panel captions it with.
 *
 * `currentPriceCents` is the price each row's "since this trade" move is
 * measured against — our own position row's price, not a provider call. Pass 0
 * (the default) for a ticker that isn't held: every row then reports no move
 * rather than a fabricated one.
 */
export function summarizeTrades(
  transactions: StockTransaction[],
  currentPriceCents = 0,
): TickerTrades {
  const newestFirst = [...transactions]
    .sort((a, b) => Date.parse(b.transactionAt) - Date.parse(a.transactionAt))
    .map((transaction) => ({
      ...transaction,
      ...computeTradeMoveSince(
        transaction.pricePerShareCents,
        transaction.numberOfShares,
        currentPriceCents,
      ),
    }));
  const buys = newestFirst.filter((transaction) => transaction.action === "Buy");
  const sells = newestFirst.filter((transaction) => transaction.action === "Sell");
  const sumShares = (rows: StockTransaction[]) =>
    rows.reduce((sum, row) => sum + row.numberOfShares, 0);
  const sumAmount = (rows: StockTransaction[]) =>
    rows.reduce((sum, row) => sum + row.totalAmountCents, 0);

  return {
    transactions: newestFirst,
    currentPriceCents,
    stats: computeTransactionStats(newestFirst),
    averageCostBasisCents: computeAverageCostBasisCents(newestFirst),
    buyCount: buys.length,
    sellCount: sells.length,
    sharesBought: sumShares(buys),
    sharesSold: sumShares(sells),
    totalBoughtCents: sumAmount(buys),
    totalSoldCents: sumAmount(sells),
    firstTradeAt: newestFirst.at(-1)?.transactionAt,
    lastTradeAt: newestFirst[0]?.transactionAt,
  };
}

/**
 * How far the price has drifted since the ticker was added to a watchlist.
 *
 * Both prices must be real for the answer to mean anything: a watched-but-unheld
 * ticker has no current price in our records, and an item added without one has
 * no baseline. Either way the drift is 0 rather than a number computed from a
 * zero, which would read as a 100% collapse.
 */
export function computeWatchDrift(
  priceWhenAddedCents: number,
  currentPriceCents: number,
): { changeSinceAddedCents: number; changeSinceAddedPct: number } {
  if (priceWhenAddedCents <= 0 || currentPriceCents <= 0) {
    return { changeSinceAddedCents: 0, changeSinceAddedPct: 0 };
  }
  const changeSinceAddedCents = currentPriceCents - priceWhenAddedCents;
  return {
    changeSinceAddedCents,
    changeSinceAddedPct: percentOf(changeSinceAddedCents, priceWhenAddedCents),
  };
}

/**
 * Provider bars as dated closes, oldest first. Non-positive closes are dropped
 * — that's the provider's way of saying "no print", not a price of zero.
 */
export function toClosePoints(history: PricePoint[]): TickerClosePoint[] {
  return history
    .filter((point) => point.closeCents > 0)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((point) => ({
      date: toIsoDateLocal(new Date(point.timestamp * 1000)),
      closeCents: point.closeCents,
      volume: point.volume,
      openCents: point.openCents,
      highCents: point.highCents,
      lowCents: point.lowCents,
    }));
}

/**
 * The close to date something to: the one on `date` itself, or failing that the
 * last one before it.
 *
 * Corporate actions and reported quarters land on days the market was shut often
 * enough that this can't be an exact match. Taking the previous close keeps every
 * price shown against an event a real print, and returning undefined (rather than
 * reaching *forward*) keeps it one that existed when the event did.
 *
 * `closes` must be oldest first — `toClosePoints` guarantees that.
 */
export function closeOnOrBefore(
  closes: TickerClosePoint[],
  date: string,
): TickerClosePoint | undefined {
  return (
    closes.find((point) => point.date === date) ??
    [...closes].reverse().find((point) => point.date <= date)
  );
}

/** Turns provider closes into a chartable series with its window summary. */
export function summarizePriceSeries(
  ticker: string,
  range: TickerHistoryRange,
  history: PricePoint[],
): TickerPriceSeries {
  const points = toClosePoints(history);

  if (points.length === 0) {
    return {
      ticker,
      range,
      points,
      startCloseCents: 0,
      endCloseCents: 0,
      changeCents: 0,
      changePct: 0,
      highCents: 0,
      lowCents: 0,
    };
  }

  const closes = points.map((point) => point.closeCents);
  const startCloseCents = closes[0];
  const endCloseCents = closes[closes.length - 1];
  const volumes = points
    .map((point) => point.volume)
    .filter((volume): volume is number => volume != null);

  return {
    ticker,
    range,
    points,
    startCloseCents,
    endCloseCents,
    changeCents: endCloseCents - startCloseCents,
    changePct: percentOf(endCloseCents - startCloseCents, startCloseCents),
    highCents: Math.max(...closes),
    lowCents: Math.min(...closes),
    averageVolume:
      volumes.length > 0
        ? Math.round(volumes.reduce((sum, volume) => sum + volume, 0) / volumes.length)
        : undefined,
  };
}

/**
 * Ranks a provider's stories for one ticker: subject before mention, newest
 * first within that. Same ordering the single-story picker uses, kept as a list
 * rather than collapsed to one — the viewer has room for a reading list.
 */
export function rankStories(
  stories: RawNewsStory[],
  ticker: string,
  today: string = todayIsoLocal(),
): TickerStory[] {
  const publishedOn = (story: RawNewsStory) => {
    const date = new Date(story.publishedAt);
    return Number.isNaN(date.getTime()) ? "" : toIsoDateLocal(date);
  };

  return stories
    .filter((story) => story.title.trim() !== "" && story.url.trim() !== "")
    .map((story) => ({
      ...story,
      isPrimarySubject: isPrimarySubject(story, ticker),
      isFromToday: publishedOn(story) === today,
    }))
    .sort((a, b) => {
      const bySubject = Number(b.isPrimarySubject) - Number(a.isPrimarySubject);
      if (bySubject !== 0) return bySubject;
      return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    });
}

// ---------------------------------------------------------------------------
// Use-cases — our own data.
// ---------------------------------------------------------------------------

/**
 * Everything our own records hold on a ticker: the holdings across accounts,
 * their totals, dividends, the trade history and any watchlist entries.
 *
 * Database only — no provider is contacted, so this is cheap enough to run when
 * the viewer opens. An unknown ticker is not an error: it comes back with
 * `isHeld` and `isWatched` false and zeroed figures, which is the honest answer
 * to "what do we know about this?".
 */
export function getTickerOwnData(
  input: { ticker: string },
  deps: TickerOwnDataDeps,
): TickerOwnData {
  const { ticker } = tickerOverviewSchema.parse(input);

  const positions = deps.positions.listPositionsByTicker(ticker);
  const accountNameById = new Map(
    deps.accounts.listAccounts().map((account) => [account.id, account.name]),
  );

  const holdings: TickerHolding[] = positions
    .map((position) => ({
      accountId: position.accountId,
      accountName:
        position.accountId === UNASSIGNED_ACCOUNT_ID
          ? UNASSIGNED_ACCOUNT_NAME
          : accountNameById.get(position.accountId) ?? `Account ${position.accountId}`,
      quantity: position.quantity,
      currentPriceCents: position.currentPriceCents,
      costCents: position.costCents,
      unitCostCents: position.unitCostCents,
      valueCents: position.valueCents,
      dayGainLossCents: position.dayGainLossCents,
      unrealizedGainLossCents: position.unrealizedGainLossCents,
      unrealizedGainLossPct: position.unrealizedGainLossPct,
    }))
    .sort((a, b) => b.valueCents - a.valueCents);

  const totals = summarizeHoldings(holdings);

  const watchEntries: TickerWatchEntry[] = [];
  for (const list of deps.watchLists.listWatchLists()) {
    for (const item of deps.watchLists.listItems(list.id)) {
      if (item.ticker.toUpperCase() !== ticker) continue;
      watchEntries.push({
        itemId: item.id,
        watchListId: list.id,
        watchListName: list.name,
        addedDate: item.addedDate,
        priceWhenAddedCents: item.priceWhenAddedCents,
        shares: item.shares,
        ...computeWatchDrift(item.priceWhenAddedCents, positions[0]?.currentPriceCents ?? 0),
        reminderAt: item.reminderAt,
        reminderMessage: item.reminderMessage,
      });
    }
  }
  watchEntries.sort((a, b) => a.addedDate.localeCompare(b.addedDate));

  // The identifiers are properties of the security, not of one account's lot,
  // so the first row that actually recorded one wins rather than the first row.
  const firstWith = <K extends keyof StockPosition>(field: K): string =>
    (positions.find((position) => position[field])?.[field] as string | undefined) ?? "";

  return {
    ticker,
    name: firstWith("name"),
    type: positions[0]?.type,
    isHeld: positions.length > 0,
    isWatched: watchEntries.length > 0,
    holdings,
    totals,
    income: summarizeIncome(positions, totals.valueCents, totals.costCents),
    // Same price the watchlist drift is measured against: our own position row,
    // so the whole of this use-case stays a database read.
    trades: summarizeTrades(
      deps.positions.listTransactions(ticker),
      positions[0]?.currentPriceCents ?? 0,
    ),
    watchEntries,
    assetClass: firstWith("assetClass"),
    assetStrategy: firstWith("assetStrategy"),
    cusip: firstWith("cusip"),
    isin: firstWith("isin"),
    lastUpdatedAt: positions
      .map((position) => position.updatedAt)
      .sort()
      .at(-1),
  };
}

// ---------------------------------------------------------------------------
// Use-cases — market data. Each one is a provider round-trip, called on demand.
// ---------------------------------------------------------------------------

/** A live quote with the day's move worked out. Network only — no DB read. */
export async function getTickerQuote(
  client: MarketDataClient,
  input: { ticker: string },
): Promise<TickerQuote> {
  const { ticker } = tickerOverviewSchema.parse(input);
  const quote = await client.getQuote(ticker);
  const changeCents = quote.priceCents - quote.previousCloseCents;

  return {
    ticker,
    shortName: quote.shortName,
    priceCents: quote.priceCents,
    previousCloseCents: quote.previousCloseCents,
    changeCents,
    changePct: percentOf(changeCents, quote.previousCloseCents),
    dayHighCents: quote.dayHighCents,
    dayLowCents: quote.dayLowCents,
    dividendRateCents: quote.dividendRateCents,
    fetchedAt: new Date().toISOString(),
  };
}

/** Closes over one of the offered windows, plus that window's summary figures. */
export async function getTickerPriceSeries(
  client: MarketDataClient,
  input: { ticker: string; range?: TickerHistoryRange },
): Promise<TickerPriceSeries> {
  const { ticker, range } = tickerPriceSeriesSchema.parse(input);
  const history = await client.getHistory(ticker, range, INTERVAL_BY_RANGE[range]);
  return summarizePriceSeries(ticker, range, history);
}

/**
 * Volatility, the 52-week range, and correlation to the benchmark, over a year
 * of daily closes.
 *
 * **Served from `cache` whenever a row exists, at any age.** Computing this costs
 * two provider round-trips (a year of the ticker's closes, plus a year of the
 * benchmark's), and it is not a figure that moves meaningfully between two
 * glances at the same dialog. Nothing expires it on a timer — pass
 * `refresh: true`, which is what the card's Recalculate button does.
 *
 * A refresh that fails leaves the stored row alone and returns it, so a network
 * blip shows yesterday's answer rather than an empty card. Only a first-ever
 * calculation, with nothing to fall back on, propagates the error.
 *
 * The benchmark leg is best-effort even on a successful run: if that fetch fails
 * the rest is still worth showing, so `marketCorrelation` comes back null rather
 * than the whole call throwing. A failure to fetch the *ticker's* own history
 * does throw — there'd be nothing left to report.
 */
export async function getTickerRisk(
  client: MarketDataClient,
  cache: TickerRiskCacheRepository,
  input: { ticker: string; refresh?: boolean },
): Promise<TickerRisk> {
  const { ticker, refresh } = tickerRiskSchema.parse(input);

  const stored = cache.get(ticker);
  if (stored && !refresh) return stored;

  try {
    const computed = await computeTickerRisk(client, ticker);
    cache.save(computed);
    return computed;
  } catch (error) {
    // Keeping a readable old answer beats blanking the card. With no stored row
    // there is nothing to keep, so the caller still hears about the failure.
    if (stored) return stored;
    throw error;
  }
}

/** The provider round-trips and the arithmetic, with no cache in the picture. */
async function computeTickerRisk(
  client: MarketDataClient,
  ticker: string,
): Promise<TickerRisk> {
  const [history, benchmarkHistory] = await Promise.all([
    client.getHistory(ticker, RISK_RANGE, DAILY_INTERVAL),
    client
      .getHistory(MARKET_BENCHMARK_TICKER, RISK_RANGE, DAILY_INTERVAL)
      .catch((): PricePoint[] => []),
  ]);

  const usable = history.filter((point) => point.closeCents > 0);
  const closes = usable.map((point) => point.closeCents);
  const stats = computeVolatilityStats(closes);
  const currentPriceCents = closes.at(-1) ?? 0;
  const low52wCents = closes.length > 0 ? Math.min(...closes) : 0;
  const high52wCents = closes.length > 0 ? Math.max(...closes) : 0;

  // Correlation needs both legs on the *same* trading days; an inner join on the
  // timestamp is what makes a half-day or a missing print line up rather than
  // silently shifting one series against the other.
  let marketCorrelation: number | null = null;
  if (usable.length >= MINIMUM_RISK_OBSERVATIONS && benchmarkHistory.length > 0) {
    const { closesByTicker } = alignSeriesByTimestamp({
      [ticker]: usable,
      [MARKET_BENCHMARK_TICKER]: benchmarkHistory,
    });
    marketCorrelation = pearsonCorrelation(
      dailyReturns(closesByTicker[ticker] ?? []),
      dailyReturns(closesByTicker[MARKET_BENCHMARK_TICKER] ?? []),
    );
  }

  return {
    ticker,
    annualizedVolPct: stats.annualizedVolPct,
    dailyStdDevPct: stats.dailyStdDevPct,
    volatilityLabel: classifyVolatility(stats.annualizedVolPct),
    low52wCents,
    high52wCents,
    currentPriceCents,
    rangePositionPct: computeRangePositionPct(currentPriceCents, low52wCents, high52wCents),
    marketCorrelation,
    marketBenchmarkTicker: MARKET_BENCHMARK_TICKER,
    annualizedReturnPct:
      closes.length >= MINIMUM_RISK_OBSERVATIONS ? annualizeReturn(dailyReturns(closes)) * 100 : 0,
    sampleCount: closes.length,
    calculatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Events — the dated things that moved the price.
// ---------------------------------------------------------------------------

/** The window the Events card covers. Fixed, not tied to the chart's range. */
const EVENTS_RANGE = "1y";

/**
 * One event in a sentence.
 *
 * Lives here rather than in the viewer because two places render the same
 * events — the Events card and the trade timeline's Note column — and two
 * copies of this phrasing would drift.
 */
export function describeMarketEvent(event: MarketEvent): string {
  if (event.kind === "dividend") {
    return event.amountCents != null
      ? `Dividend ${formatEventCents(event.amountCents)} / share`
      : "Dividend";
  }
  if (event.kind === "split") {
    return event.ratio ? `Split ${event.ratio}` : "Split";
  }
  // An upcoming or unreported quarter has a date but no figures yet. Saying
  // "Earnings" alone is the honest answer; inventing a 0 EPS is not.
  if (event.epsActualCents == null) return "Earnings";
  const estimate =
    event.epsEstimateCents != null
      ? ` vs ${formatEventCents(event.epsEstimateCents)} est.`
      : "";
  return `Earnings ${formatEventCents(event.epsActualCents)} EPS${estimate}`;
}

/** Cents as plain dollars. Local to the phrasing above, and sign-aware. */
function formatEventCents(cents: number): string {
  return `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/**
 * Provider events worked up for display: the surprise against the estimate, and
 * the close that day. Pure — the caller does the fetching.
 *
 * Newest first, which is the opposite of how the provider hands them over and of
 * how the chart wants them. The card is read top-down for "what happened
 * lately?", so the latest quarter belongs at the top.
 */
export function buildTickerEvents(
  ticker: string,
  events: MarketEvent[],
  closes: TickerClosePoint[],
): TickerEventFeed {
  const built = events.map<TickerEvent>((event) => {
    const date = toIsoDateLocal(new Date(event.timestamp * 1000));
    const close = closeOnOrBefore(closes, date);

    return {
      date,
      kind: event.kind,
      summary: describeMarketEvent(event),
      amountCents: event.amountCents,
      ratio: event.ratio,
      epsActualCents: event.epsActualCents,
      epsEstimateCents: event.epsEstimateCents,
      ...earningsSurprise(event),
      closeCents: close?.closeCents,
      // Only worth saying when the close came from a different day.
      closeDate: close && close.date !== date ? close.date : undefined,
    };
  });

  return {
    ticker,
    events: built.sort((a, b) => b.date.localeCompare(a.date)),
    closesUnavailable: closes.length === 0,
  };
}

/** The beat/miss arithmetic, for an earnings event that has both figures. */
function earningsSurprise(
  event: MarketEvent,
): Pick<TickerEvent, "epsSurpriseCents" | "epsSurprisePct" | "outcome"> {
  if (
    event.kind !== "earnings" ||
    event.epsActualCents == null ||
    event.epsEstimateCents == null
  ) {
    return {};
  }

  const epsSurpriseCents = event.epsActualCents - event.epsEstimateCents;

  return {
    epsSurpriseCents,
    // Against the estimate's *magnitude*, so a beat against a forecast loss
    // reads as positive rather than having its sign flipped by the divisor.
    epsSurprisePct:
      event.epsEstimateCents !== 0
        ? (epsSurpriseCents / Math.abs(event.epsEstimateCents)) * 100
        : undefined,
    outcome: epsSurpriseCents > 0 ? "beat" : epsSurpriseCents < 0 ? "miss" : "inline",
  };
}

/**
 * Dividends, splits and reported quarters over the last year, each with the
 * close it happened against.
 *
 * Two legs, and the closes one is best-effort: an event list with no prices
 * beside it is still worth reading, so a history failure sets
 * `closesUnavailable` rather than throwing. An empty list is a normal answer —
 * plenty of tickers pay nothing and never split.
 */
export async function getTickerEvents(
  events: MarketEventsClient,
  marketData: MarketDataClient,
  input: { ticker: string },
): Promise<TickerEventFeed> {
  const { ticker } = tickerOverviewSchema.parse(input);

  const [eventList, history] = await Promise.all([
    events.getEvents(ticker, EVENTS_RANGE),
    marketData.getHistory(ticker, EVENTS_RANGE, DAILY_INTERVAL).catch((): PricePoint[] => []),
  ]);

  return buildTickerEvents(ticker, eventList, toClosePoints(history));
}

/**
 * Recent stories for a ticker, ranked. An empty list is a normal answer — plenty
 * of tickers have no coverage — but a provider failure still throws, so the
 * caller can tell "quiet" apart from "broken".
 */
export async function getTickerNewsFeed(
  client: TickerNewsClient,
  input: { ticker: string; limit?: number },
  today: string = todayIsoLocal(),
): Promise<TickerNewsFeed> {
  const { ticker, limit } = tickerNewsFeedSchema.parse(input);
  const stories = await client.searchStories(ticker, limit);
  return { ticker, stories: rankStories(stories, ticker, today).slice(0, limit) };
}

// ---------------------------------------------------------------------------
// The trade timeline — our trades against the provider's closes.
// ---------------------------------------------------------------------------

/** Stories are indexed by day, so ask for the widest window the schema allows. */
const TIMELINE_NEWS_LIMIT = 25;

/** Sort order within one date, so a trade sits between its two closes. */
const KIND_ORDER: Record<TickerTimelineKind, number> = {
  prevClose: 0,
  event: 1,
  trade: 2,
  nextClose: 3,
  current: 4,
};

/**
 * A transaction's calendar day.
 *
 * `transactionAt` is a date in practice but the column is free text, so an
 * instant is parsed rather than assumed away.
 */
export function transactionDate(transactionAt: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(transactionAt)) return transactionAt.slice(0, 10);
  const parsed = new Date(transactionAt);
  return Number.isNaN(parsed.getTime()) ? transactionAt : toIsoDateLocal(parsed);
}

/**
 * The provider range that reaches back past the oldest trade.
 *
 * Deliberately over-reaches by a step: the timeline needs a close *before* the
 * first trade, and asking for exactly the span would leave that point missing
 * for anyone whose first purchase is the oldest bar returned.
 */
export function historyRangeCovering(earliestDate: string, today: string): string {
  const from = Date.parse(`${earliestDate}T00:00:00`);
  const to = Date.parse(`${today}T00:00:00`);
  if (Number.isNaN(from) || Number.isNaN(to)) return "max";

  const days = Math.max(0, Math.round((to - from) / 86_400_000)) + 15;
  if (days <= 80) return "3mo";
  if (days <= 170) return "6mo";
  if (days <= 350) return "1y";
  if (days <= 715) return "2y";
  if (days <= 1810) return "5y";
  if (days <= 3630) return "10y";
  return "max";
}

/**
 * Builds the timeline: for every trade, the close either side of it, the trade
 * itself, and one final point for where the price is now.
 *
 * "Either side" means the nearest *trading* day with a close, not the calendar
 * day — a Monday purchase is bracketed by the previous Friday and the Tuesday.
 * A close is never emitted on a date that already has a trade, so the chart
 * doesn't stack two points on one day claiming different prices for it.
 *
 * The trailing `current` point is the newest close the provider returned, not
 * "today" — on a weekend or a holiday those differ, and the last real print is
 * the honest mark.
 */
export function buildTradeTimeline(
  ticker: string,
  transactions: StockTransaction[],
  closes: TickerClosePoint[],
  stories: TickerStory[],
  events: MarketEvent[] = [],
): Omit<
  TickerTradeTimeline,
  "newsUnavailable" | "newsFromDate" | "eventsUnavailable"
> {
  const ordered = [...closes].sort((a, b) => a.date.localeCompare(b.date));
  const tradeDates = new Set(transactions.map((row) => transactionDate(row.transactionAt)));

  const storiesByDate = new Map<string, TickerStory[]>();
  for (const story of stories) {
    const parsed = new Date(story.publishedAt);
    if (Number.isNaN(parsed.getTime())) continue;
    const date = toIsoDateLocal(parsed);
    storiesByDate.set(date, [...(storiesByDate.get(date) ?? []), story]);
  }

  const points: TickerTimelinePoint[] = [];
  const seenCloseDates = new Set<string>();
  const datesWithoutCloses: string[] = [];

  const newPoint = (
    date: string,
    kind: TickerTimelineKind,
    pricePerShareCents: number,
  ): TickerTimelinePoint => ({
    date,
    kind,
    pricePerShareCents,
    stories: storiesByDate.get(date) ?? [],
    events: [],
  });

  const addClose = (kind: "prevClose" | "nextClose", close?: TickerClosePoint) => {
    if (!close || tradeDates.has(close.date) || seenCloseDates.has(close.date)) return;
    seenCloseDates.add(close.date);
    points.push(newPoint(close.date, kind, close.closeCents));
  };

  for (const transaction of transactions) {
    const date = transactionDate(transaction.transactionAt);
    const previous = [...ordered].reverse().find((close) => close.date < date);
    const next = ordered.find((close) => close.date > date);
    if (!previous && !next) datesWithoutCloses.push(date);

    addClose("prevClose", previous);
    points.push({
      ...newPoint(date, "trade", transaction.pricePerShareCents),
      transactionId: transaction.id,
      action: transaction.action,
      numberOfShares: transaction.numberOfShares,
      note: transaction.note,
    });
    addClose("nextClose", next);
  }

  const latest = ordered.at(-1);
  // Only a genuinely later point is worth adding: if the newest close is already
  // on the chart as a trade's bracket, "current" would just double it up.
  if (latest && !seenCloseDates.has(latest.date) && !tradeDates.has(latest.date)) {
    seenCloseDates.add(latest.date);
    points.push(newPoint(latest.date, "current", latest.closeCents));
  }

  // Events land on whichever point already sits on their date; anything left
  // gets its own point, priced at that day's close. An event with no close to
  // date it to — outside the fetched window, or a symbol with no history —
  // can't be plotted honestly, so it's counted instead of guessed at.
  const byDate = new Map(points.map((point) => [point.date, point]));
  let unplottedEventCount = 0;

  for (const event of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    const eventDate = toIsoDateLocal(new Date(event.timestamp * 1000));
    // The exact day where possible; otherwise the last close on or before it,
    // so an event dated to a holiday still lands somewhere true.
    const close = closeOnOrBefore(ordered, eventDate);

    if (!close) {
      unplottedEventCount += 1;
      continue;
    }

    const existing = byDate.get(close.date);
    if (existing) {
      existing.events.push(event);
      continue;
    }

    const point = newPoint(close.date, "event", close.closeCents);
    point.events.push(event);
    points.push(point);
    byDate.set(point.date, point);
  }

  points.sort(
    (a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  );

  return {
    ticker,
    points,
    tradeStats: computeTransactionStats(transactions),
    currentPriceCents: latest?.closeCents ?? 0,
    datesWithoutCloses: [...new Set(datesWithoutCloses)],
    unplottedEventCount,
  };
}

/**
 * Our trade history plotted against the market around it.
 *
 * Takes the transactions as data rather than a repository, which keeps the
 * source split intact — the caller does the database read, this function only
 * adds the provider's side. One history call, one news call and one events
 * call, however many trades there are.
 *
 * Both provider extras are best-effort and fail independently, because they
 * fail for different reasons and neither is worth losing the chart over:
 *
 * - **News** is shallow by nature. The provider's search returns recent
 *   coverage only, so a trade from two years ago will have no stories.
 *   `newsFromDate` reports how far back it actually reached.
 * - **Events** go back as far as the price history does, so dividends, splits
 *   and reported quarters do fill in the old rows news can't.
 */
export async function getTickerTradeTimeline(
  clients: {
    marketData: MarketDataClient;
    news?: TickerNewsClient;
    events?: MarketEventsClient;
  },
  transactions: StockTransaction[],
  input: { ticker: string },
  today: string = todayIsoLocal(),
): Promise<TickerTradeTimeline> {
  const { ticker } = tickerOverviewSchema.parse(input);

  const forTicker = transactions
    .filter((row) => row.ticker.toUpperCase() === ticker)
    .sort((a, b) => transactionDate(a.transactionAt).localeCompare(transactionDate(b.transactionAt)));

  // No trades, nothing to bracket — don't spend three provider calls saying so.
  if (forTicker.length === 0) {
    return {
      ticker,
      points: [],
      tradeStats: computeTransactionStats([]),
      currentPriceCents: 0,
      datesWithoutCloses: [],
      unplottedEventCount: 0,
      newsUnavailable: false,
      eventsUnavailable: false,
    };
  }

  const range = historyRangeCovering(transactionDate(forTicker[0].transactionAt), today);

  const [history, news, events] = await Promise.all([
    clients.marketData.getHistory(ticker, range, DAILY_INTERVAL),
    clients.news
      ? clients.news.searchStories(ticker, TIMELINE_NEWS_LIMIT).catch(() => undefined)
      : Promise.resolve(undefined),
    clients.events
      ? clients.events.getEvents(ticker, range).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);

  const stories = news ? rankStories(news, ticker, today) : [];

  const storyDates = stories
    .map((story) => new Date(story.publishedAt))
    .filter((date) => !Number.isNaN(date.getTime()))
    .map(toIsoDateLocal)
    .sort();

  return {
    ...buildTradeTimeline(ticker, forTicker, toClosePoints(history), stories, events ?? []),
    newsUnavailable: news === undefined,
    newsFromDate: storyDates.at(0),
    eventsUnavailable: events === undefined,
  };
}
