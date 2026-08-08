// The provider's reference record for one symbol, normalised into six sections.
//
// Everything here is *derived from* Yahoo's quoteSummary but is not shaped like
// it: numbers are unwrapped from `{ raw, fmt }`, money is cents (the project's
// money convention), fractions are turned into percentages, and epoch seconds
// become ISO dates. Yahoo's own pre-formatted strings ("4.56T", "27.62%") are
// deliberately discarded — they wouldn't match the app's formatting anywhere
// else, and presentation is the view's job.
//
// **Every section is optional, and so is nearly every field.** Coverage varies
// enormously by symbol: an ETF has no income statement, a foreign listing often
// has no analyst coverage, a newly listed company has no 52-week change. A
// missing section is a normal answer, not a failure.

/** Price, volume and the day's shape. Roughly Yahoo's "Market Data". */
export interface TickerMarketData {
  priceCents?: number;
  previousCloseCents?: number;
  openCents?: number;
  dayLowCents?: number;
  dayHighCents?: number;
  fiftyTwoWeekLowCents?: number;
  fiftyTwoWeekHighCents?: number;
  volume?: number;
  averageVolume?: number;
  marketCapCents?: number;
  currency?: string;
  exchangeName?: string;
  quoteType?: string;
  /** Only outside regular hours, and only when the provider reports it. */
  preMarketPriceCents?: number;
  preMarketChangePct?: number;
  postMarketPriceCents?: number;
  postMarketChangePct?: number;
}

export interface TickerOfficer {
  name: string;
  title: string;
  age?: number;
  totalPayCents?: number;
}

export interface TickerCompanyProfile {
  sector?: string;
  industry?: string;
  country?: string;
  city?: string;
  state?: string;
  website?: string;
  employees?: number;
  /** Yahoo's long business summary — a paragraph or several. */
  summary?: string;
  /** Named officers, as the provider lists them. Often empty. */
  officers: TickerOfficer[];
}

/** One period's analyst spread. `period` is Yahoo's "0m", "-1m", "-2m", "-3m". */
export interface TickerRecommendationPeriod {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  /** The five buckets summed, so the view doesn't re-add them. */
  total: number;
}

export interface TickerRatingChange {
  /** Local-calendar "YYYY-MM-DD". */
  date: string;
  firm: string;
  toGrade: string;
  fromGrade?: string;
  /** Yahoo's word for it: "up", "down", "main", "init", "reit". */
  action?: string;
}

export interface TickerAnalysis {
  /** "buy" / "hold" / "underperform" … as the provider words it. */
  recommendationKey?: string;
  /** 1 (strong buy) to 5 (strong sell). */
  recommendationMean?: number;
  analystCount?: number;
  targetLowCents?: number;
  targetMeanCents?: number;
  targetMedianCents?: number;
  targetHighCents?: number;
  /** Newest period first. */
  trend: TickerRecommendationPeriod[];
  /** Most recent first, and **capped** — see `MAX_RATING_CHANGES`. */
  ratingChanges: TickerRatingChange[];
  /** How many the provider actually holds, when more than the cap. */
  totalRatingChanges: number;
}

export interface TickerValuation {
  trailingPE?: number;
  forwardPE?: number;
  pegRatio?: number;
  priceToBook?: number;
  priceToSales?: number;
  enterpriseValueCents?: number;
  enterpriseToRevenue?: number;
  enterpriseToEbitda?: number;
  beta?: number;
  dividendYieldPct?: number;
  payoutRatioPct?: number;
}

/** One reported year from the income statement. */
export interface TickerIncomeStatement {
  /** Local-calendar "YYYY-MM-DD" of the period end. */
  endDate: string;
  totalRevenueCents?: number;
  grossProfitCents?: number;
  operatingIncomeCents?: number;
  netIncomeCents?: number;
}

export interface TickerFinancials {
  totalRevenueCents?: number;
  grossProfitsCents?: number;
  ebitdaCents?: number;
  totalCashCents?: number;
  totalDebtCents?: number;
  freeCashflowCents?: number;
  debtToEquity?: number;
  currentRatio?: number;
  profitMarginPct?: number;
  operatingMarginPct?: number;
  returnOnEquityPct?: number;
  returnOnAssetsPct?: number;
  revenueGrowthPct?: number;
  earningsGrowthPct?: number;
  /** Most recent year first. Empty for anything without statements. */
  incomeStatements: TickerIncomeStatement[];
}

export interface TickerKeyStatistics {
  sharesOutstanding?: number;
  floatShares?: number;
  heldPercentInsidersPct?: number;
  heldPercentInstitutionsPct?: number;
  sharesShort?: number;
  shortRatio?: number;
  shortPercentOfFloatPct?: number;
  bookValuePerShareCents?: number;
  fiftyTwoWeekChangePct?: number;
  benchmark52WeekChangePct?: number;
  /** Local-calendar "YYYY-MM-DD". */
  lastFiscalYearEnd?: string;
  mostRecentQuarter?: string;
  lastSplitFactor?: string;
  lastSplitDate?: string;
}

/**
 * The whole detail record. Sections are undefined when the provider returned
 * nothing usable for them, which the view renders as "not reported" rather than
 * as an empty panel.
 */
export interface TickerYahooDetail {
  ticker: string;
  /** ISO instant — this is a live read, and the view says when. */
  fetchedAt: string;
  marketData?: TickerMarketData;
  profile?: TickerCompanyProfile;
  analysis?: TickerAnalysis;
  valuation?: TickerValuation;
  financials?: TickerFinancials;
  keyStatistics?: TickerKeyStatistics;
}
