export interface Quote {
  ticker: string;
  priceCents: number;
  previousCloseCents: number;
  shortName?: string;
  dayHighCents: number;
  dayLowCents: number;
  dividendRateCents: number;
}

/** A corporate action or a reported quarter — the dated things that move a price. */
export type MarketEventKind = "dividend" | "split" | "earnings";

export interface MarketEvent {
  /** Epoch seconds of the event's date. */
  timestamp: number;
  kind: MarketEventKind;
  /** Dividend per share, in cents. Only on `dividend`. */
  amountCents?: number;
  /** Split ratio as the provider words it, e.g. "4:1". Only on `split`. */
  ratio?: string;
  /** Reported EPS in cents. Only on `earnings`, and only once reported. */
  epsActualCents?: number;
  /** What analysts expected, in cents. Only on `earnings`. */
  epsEstimateCents?: number;
}

// ---------------------------------------------------------------------------
// quoteSummary — the provider's own shapes, deliberately left raw.
//
// These live here, with the adapter that fetches them, rather than in the module
// that renders them: this is "what Yahoo said", and normalising it into domain
// types is a separate job (see `src/lib/ticker-detail`). Only the fields we
// actually read are typed; the rest of each module is ignored, so a new field
// appearing upstream is not a breaking change.
// ---------------------------------------------------------------------------

/** Yahoo wraps most numbers as `{ raw, fmt }`. `raw` is the one to trust. */
export interface RawValue {
  raw?: number;
  fmt?: string;
  longFmt?: string;
}

/** A number that may arrive wrapped, bare, or not at all. */
export type MaybeNumber = RawValue | number | undefined;

export interface RawQuoteSummary {
  price?: {
    regularMarketPrice?: MaybeNumber;
    regularMarketPreviousClose?: MaybeNumber;
    regularMarketOpen?: MaybeNumber;
    regularMarketDayLow?: MaybeNumber;
    regularMarketDayHigh?: MaybeNumber;
    regularMarketVolume?: MaybeNumber;
    marketCap?: MaybeNumber;
    currency?: string;
    exchangeName?: string;
    longName?: string;
    quoteType?: string;
    preMarketPrice?: MaybeNumber;
    preMarketChangePercent?: MaybeNumber;
    postMarketPrice?: MaybeNumber;
    postMarketChangePercent?: MaybeNumber;
  };
  summaryDetail?: {
    fiftyTwoWeekLow?: MaybeNumber;
    fiftyTwoWeekHigh?: MaybeNumber;
    averageVolume?: MaybeNumber;
    trailingPE?: MaybeNumber;
    forwardPE?: MaybeNumber;
    beta?: MaybeNumber;
    dividendYield?: MaybeNumber;
    payoutRatio?: MaybeNumber;
    priceToSalesTrailing12Months?: MaybeNumber;
  };
  assetProfile?: {
    sector?: string;
    industry?: string;
    country?: string;
    city?: string;
    state?: string;
    website?: string;
    fullTimeEmployees?: number;
    longBusinessSummary?: string;
    companyOfficers?: {
      name?: string;
      title?: string;
      age?: number;
      totalPay?: MaybeNumber;
    }[];
  };
  defaultKeyStatistics?: {
    enterpriseValue?: MaybeNumber;
    forwardPE?: MaybeNumber;
    pegRatio?: MaybeNumber;
    priceToBook?: MaybeNumber;
    enterpriseToRevenue?: MaybeNumber;
    enterpriseToEbitda?: MaybeNumber;
    sharesOutstanding?: MaybeNumber;
    floatShares?: MaybeNumber;
    heldPercentInsiders?: MaybeNumber;
    heldPercentInstitutions?: MaybeNumber;
    sharesShort?: MaybeNumber;
    shortRatio?: MaybeNumber;
    shortPercentOfFloat?: MaybeNumber;
    bookValue?: MaybeNumber;
    "52WeekChange"?: MaybeNumber;
    SandP52WeekChange?: MaybeNumber;
    lastFiscalYearEnd?: MaybeNumber;
    mostRecentQuarter?: MaybeNumber;
    lastSplitFactor?: string;
    lastSplitDate?: MaybeNumber;
  };
  financialData?: {
    recommendationKey?: string;
    recommendationMean?: MaybeNumber;
    numberOfAnalystOpinions?: MaybeNumber;
    targetLowPrice?: MaybeNumber;
    targetMeanPrice?: MaybeNumber;
    targetMedianPrice?: MaybeNumber;
    targetHighPrice?: MaybeNumber;
    totalRevenue?: MaybeNumber;
    grossProfits?: MaybeNumber;
    ebitda?: MaybeNumber;
    totalCash?: MaybeNumber;
    totalDebt?: MaybeNumber;
    debtToEquity?: MaybeNumber;
    currentRatio?: MaybeNumber;
    freeCashflow?: MaybeNumber;
    profitMargins?: MaybeNumber;
    operatingMargins?: MaybeNumber;
    returnOnEquity?: MaybeNumber;
    returnOnAssets?: MaybeNumber;
    revenueGrowth?: MaybeNumber;
    earningsGrowth?: MaybeNumber;
  };
  recommendationTrend?: {
    trend?: {
      period?: string;
      strongBuy?: number;
      buy?: number;
      hold?: number;
      sell?: number;
      strongSell?: number;
    }[];
  };
  upgradeDowngradeHistory?: {
    history?: {
      epochGradeDate?: number;
      firm?: string;
      toGrade?: string;
      fromGrade?: string;
      action?: string;
    }[];
  };
  incomeStatementHistory?: {
    incomeStatementHistory?: {
      endDate?: MaybeNumber;
      totalRevenue?: MaybeNumber;
      grossProfit?: MaybeNumber;
      operatingIncome?: MaybeNumber;
      netIncome?: MaybeNumber;
    }[];
  };
}

/** One daily close, used as the raw series for volatility/correlation/Sharpe/scan stats. */
export interface PricePoint {
  /** Epoch seconds. */
  timestamp: number;
  closeCents: number;
  /** Shares traded that day. Undefined where the provider didn't report it. */
  volume?: number;
  /**
   * The rest of the bar, for a candlestick.
   *
   * Optional because `closeCents` is what every statistic here is built from —
   * volatility, correlation, Sharpe and the risk cache all read closes and would
   * gain nothing from a required open. A provider that reports only closes is
   * still a usable provider, so a candle chart degrades to "unavailable" rather
   * than making the whole series an error. Present together or not at all: the
   * adapter only sets them when the provider gave all three.
   */
  openCents?: number;
  highCents?: number;
  lowCents?: number;
}
