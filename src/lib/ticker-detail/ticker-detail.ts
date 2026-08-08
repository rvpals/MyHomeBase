// Turns Yahoo's quoteSummary payload into the six sections the detail tab shows.
//
// One provider call in, six normalised sections out. The whole file is about
// distrusting the payload: every field is optional upstream, numbers arrive
// wrapped in `{ raw, fmt }` about half the time and bare the rest, percentages
// arrive as fractions, dates as epoch seconds, and whole modules go missing for
// symbols that don't have them. Nothing here throws on a missing field — a
// section with no usable content simply isn't returned.

import type { MaybeNumber, QuoteSummaryClient, RawQuoteSummary } from "@/lib/market-data";
import { toIsoDateLocal } from "@/lib/shared/date";
import { tickerOverviewSchema } from "@/lib/ticker-overview";
import type {
  TickerAnalysis,
  TickerCompanyProfile,
  TickerFinancials,
  TickerIncomeStatement,
  TickerKeyStatistics,
  TickerMarketData,
  TickerOfficer,
  TickerRatingChange,
  TickerRecommendationPeriod,
  TickerValuation,
  TickerYahooDetail,
} from "./types";

/**
 * How many rating changes to keep. Yahoo returns the full archive — 970 rows for
 * AAPL — which is a database, not a panel. The recent ones are the ones anybody
 * reads, and the count of the rest is reported alongside.
 */
export const MAX_RATING_CHANGES = 20;

// ---------------------------------------------------------------------------
// Unwrapping. Yahoo is inconsistent about `{ raw }` vs a bare number, so every
// read goes through these rather than trusting one shape.
// ---------------------------------------------------------------------------

/** A finite number, however it was wrapped. Undefined for anything else. */
export function num(value: MaybeNumber): number | undefined {
  const raw = typeof value === "number" ? value : value?.raw;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

/** Dollars to whole cents, the project's money unit. */
export function cents(value: MaybeNumber): number | undefined {
  const raw = num(value);
  return raw === undefined ? undefined : Math.round(raw * 100);
}

/**
 * A fraction to a percentage: Yahoo reports 0.2762, the app says 27.62.
 * Matches how every other percentage in the codebase is carried.
 */
export function pct(value: MaybeNumber): number | undefined {
  const raw = num(value);
  return raw === undefined ? undefined : raw * 100;
}

/** Epoch seconds to a local-calendar date. */
export function isoDate(value: MaybeNumber): string | undefined {
  const raw = num(value);
  if (raw === undefined) return undefined;
  const date = new Date(raw * 1000);
  return Number.isNaN(date.getTime()) ? undefined : toIsoDateLocal(date);
}

/** A non-empty trimmed string, or undefined. Blank strings are not answers. */
function text(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * True when a section carries at least one value worth showing.
 *
 * Takes an `object` rather than `Record<string, unknown>` so the section
 * interfaces can be passed without each declaring an index signature — this only
 * ever reads values, never keys.
 */
function hasAnything(section: object): boolean {
  return Object.values(section).some(
    (value) => value !== undefined && (!Array.isArray(value) || value.length > 0),
  );
}

// ---------------------------------------------------------------------------
// The six sections. Each returns undefined when the provider gave it nothing,
// so the view can say "not reported" instead of drawing an empty grid.
// ---------------------------------------------------------------------------

function buildMarketData(raw: RawQuoteSummary): TickerMarketData | undefined {
  const price = raw.price;
  const summary = raw.summaryDetail;
  if (!price && !summary) return undefined;

  const section: TickerMarketData = {
    priceCents: cents(price?.regularMarketPrice),
    previousCloseCents: cents(price?.regularMarketPreviousClose),
    openCents: cents(price?.regularMarketOpen),
    dayLowCents: cents(price?.regularMarketDayLow),
    dayHighCents: cents(price?.regularMarketDayHigh),
    fiftyTwoWeekLowCents: cents(summary?.fiftyTwoWeekLow),
    fiftyTwoWeekHighCents: cents(summary?.fiftyTwoWeekHigh),
    volume: num(price?.regularMarketVolume),
    averageVolume: num(summary?.averageVolume),
    marketCapCents: cents(price?.marketCap),
    currency: text(price?.currency),
    exchangeName: text(price?.exchangeName),
    quoteType: text(price?.quoteType),
    preMarketPriceCents: cents(price?.preMarketPrice),
    preMarketChangePct: pct(price?.preMarketChangePercent),
    postMarketPriceCents: cents(price?.postMarketPrice),
    postMarketChangePct: pct(price?.postMarketChangePercent),
  };

  return hasAnything(section) ? section : undefined;
}

function buildProfile(raw: RawQuoteSummary): TickerCompanyProfile | undefined {
  const profile = raw.assetProfile;
  if (!profile) return undefined;

  const officers: TickerOfficer[] = (profile.companyOfficers ?? [])
    .map((officer) => ({
      name: text(officer.name) ?? "",
      title: text(officer.title) ?? "",
      age: num(officer.age),
      totalPayCents: cents(officer.totalPay),
    }))
    // An unnamed officer is a row of dashes; drop it rather than render it.
    .filter((officer) => officer.name !== "");

  const section: TickerCompanyProfile = {
    sector: text(profile.sector),
    industry: text(profile.industry),
    country: text(profile.country),
    city: text(profile.city),
    state: text(profile.state),
    website: text(profile.website),
    employees: num(profile.fullTimeEmployees),
    summary: text(profile.longBusinessSummary),
    officers,
  };

  return hasAnything(section) ? section : undefined;
}

function buildAnalysis(raw: RawQuoteSummary): TickerAnalysis | undefined {
  const financial = raw.financialData;
  const trendRows = raw.recommendationTrend?.trend ?? [];
  const historyRows = raw.upgradeDowngradeHistory?.history ?? [];

  const trend: TickerRecommendationPeriod[] = trendRows.map((row) => {
    const strongBuy = row.strongBuy ?? 0;
    const buy = row.buy ?? 0;
    const hold = row.hold ?? 0;
    const sell = row.sell ?? 0;
    const strongSell = row.strongSell ?? 0;
    return {
      period: row.period ?? "",
      strongBuy,
      buy,
      hold,
      sell,
      strongSell,
      total: strongBuy + buy + hold + sell + strongSell,
    };
  });

  const dated = historyRows
    .map((row): TickerRatingChange | undefined => {
      const date = isoDate(row.epochGradeDate);
      const firm = text(row.firm);
      // Undated or unattributed rows can't be read as history; drop them.
      if (!date || !firm) return undefined;
      return {
        date,
        firm,
        toGrade: text(row.toGrade) ?? "—",
        fromGrade: text(row.fromGrade),
        action: text(row.action),
      };
    })
    .filter((row): row is TickerRatingChange => row !== undefined)
    .sort((a, b) => b.date.localeCompare(a.date));

  const section: TickerAnalysis = {
    recommendationKey: text(financial?.recommendationKey),
    recommendationMean: num(financial?.recommendationMean),
    analystCount: num(financial?.numberOfAnalystOpinions),
    targetLowCents: cents(financial?.targetLowPrice),
    targetMeanCents: cents(financial?.targetMeanPrice),
    targetMedianCents: cents(financial?.targetMedianPrice),
    targetHighCents: cents(financial?.targetHighPrice),
    trend,
    ratingChanges: dated.slice(0, MAX_RATING_CHANGES),
    totalRatingChanges: dated.length,
  };

  return hasAnything({ ...section, totalRatingChanges: undefined }) ? section : undefined;
}

function buildValuation(raw: RawQuoteSummary): TickerValuation | undefined {
  const summary = raw.summaryDetail;
  const stats = raw.defaultKeyStatistics;
  if (!summary && !stats) return undefined;

  const section: TickerValuation = {
    trailingPE: num(summary?.trailingPE),
    // Both modules carry it; summaryDetail is the one that agrees with the site.
    forwardPE: num(summary?.forwardPE) ?? num(stats?.forwardPE),
    pegRatio: num(stats?.pegRatio),
    priceToBook: num(stats?.priceToBook),
    priceToSales: num(summary?.priceToSalesTrailing12Months),
    enterpriseValueCents: cents(stats?.enterpriseValue),
    enterpriseToRevenue: num(stats?.enterpriseToRevenue),
    enterpriseToEbitda: num(stats?.enterpriseToEbitda),
    beta: num(summary?.beta),
    dividendYieldPct: pct(summary?.dividendYield),
    payoutRatioPct: pct(summary?.payoutRatio),
  };

  return hasAnything(section) ? section : undefined;
}

function buildFinancials(raw: RawQuoteSummary): TickerFinancials | undefined {
  const financial = raw.financialData;
  const statements = raw.incomeStatementHistory?.incomeStatementHistory ?? [];

  const incomeStatements: TickerIncomeStatement[] = statements
    .map((row): TickerIncomeStatement | undefined => {
      const endDate = isoDate(row.endDate);
      if (!endDate) return undefined;
      return {
        endDate,
        totalRevenueCents: cents(row.totalRevenue),
        grossProfitCents: cents(row.grossProfit),
        operatingIncomeCents: cents(row.operatingIncome),
        netIncomeCents: cents(row.netIncome),
      };
    })
    .filter((row): row is TickerIncomeStatement => row !== undefined)
    .sort((a, b) => b.endDate.localeCompare(a.endDate));

  const section: TickerFinancials = {
    totalRevenueCents: cents(financial?.totalRevenue),
    grossProfitsCents: cents(financial?.grossProfits),
    ebitdaCents: cents(financial?.ebitda),
    totalCashCents: cents(financial?.totalCash),
    totalDebtCents: cents(financial?.totalDebt),
    freeCashflowCents: cents(financial?.freeCashflow),
    debtToEquity: num(financial?.debtToEquity),
    currentRatio: num(financial?.currentRatio),
    profitMarginPct: pct(financial?.profitMargins),
    operatingMarginPct: pct(financial?.operatingMargins),
    returnOnEquityPct: pct(financial?.returnOnEquity),
    returnOnAssetsPct: pct(financial?.returnOnAssets),
    revenueGrowthPct: pct(financial?.revenueGrowth),
    earningsGrowthPct: pct(financial?.earningsGrowth),
    incomeStatements,
  };

  return hasAnything(section) ? section : undefined;
}

function buildKeyStatistics(raw: RawQuoteSummary): TickerKeyStatistics | undefined {
  const stats = raw.defaultKeyStatistics;
  if (!stats) return undefined;

  const section: TickerKeyStatistics = {
    sharesOutstanding: num(stats.sharesOutstanding),
    floatShares: num(stats.floatShares),
    heldPercentInsidersPct: pct(stats.heldPercentInsiders),
    heldPercentInstitutionsPct: pct(stats.heldPercentInstitutions),
    sharesShort: num(stats.sharesShort),
    shortRatio: num(stats.shortRatio),
    shortPercentOfFloatPct: pct(stats.shortPercentOfFloat),
    bookValuePerShareCents: cents(stats.bookValue),
    // Quoted with the leading digit, so it can't be a plain property name.
    fiftyTwoWeekChangePct: pct(stats["52WeekChange"]),
    benchmark52WeekChangePct: pct(stats.SandP52WeekChange),
    lastFiscalYearEnd: isoDate(stats.lastFiscalYearEnd),
    mostRecentQuarter: isoDate(stats.mostRecentQuarter),
    lastSplitFactor: text(stats.lastSplitFactor),
    lastSplitDate: isoDate(stats.lastSplitDate),
  };

  return hasAnything(section) ? section : undefined;
}

/**
 * The whole normalisation, as a pure function. Takes the provider's payload and
 * returns the six sections — no client, no clock beyond `fetchedAt`, so it's
 * testable against a captured fixture.
 */
export function buildTickerDetail(
  ticker: string,
  raw: RawQuoteSummary,
  fetchedAt: string = new Date().toISOString(),
): TickerYahooDetail {
  return {
    ticker,
    fetchedAt,
    marketData: buildMarketData(raw),
    profile: buildProfile(raw),
    analysis: buildAnalysis(raw),
    valuation: buildValuation(raw),
    financials: buildFinancials(raw),
    keyStatistics: buildKeyStatistics(raw),
  };
}

/**
 * Yahoo's reference record for one symbol.
 *
 * A single provider round-trip covering all six sections — quoteSummary takes a
 * module list, so this costs no more than fetching one of them. A provider
 * failure throws, because unlike a missing section it means we know nothing.
 */
export async function getTickerDetail(
  client: QuoteSummaryClient,
  input: { ticker: string },
): Promise<TickerYahooDetail> {
  const { ticker } = tickerOverviewSchema.parse(input);
  return buildTickerDetail(ticker, await client.getQuoteSummary(ticker));
}
