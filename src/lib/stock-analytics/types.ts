export interface VolatilityResult {
  ticker: string;
  companyName?: string;
  type: string;
  shares: number;
  currentPriceCents: number;
  annualizedVolPct: number;
  dailyStdDevPct: number;
  volatilityLabel: string;
  low52wCents: number;
  high52wCents: number;
  rangePositionPct: number;
  sampleCount: number;
  calculatedAt: string;
}

export interface CorrelationResult {
  tickers: string[];
  matrix: number[][];
  marketCorrelation: Record<string, number | null>;
  failedTickers: string[];
  calculatedAt: string;
}

export interface SharpeTickerDetail {
  ticker: string;
  shares: number;
  currentPriceCents: number;
  positionValueCents: number;
  weight: number;
  annualizedReturn: number;
  annualizedVolatility: number;
  tradingDays: number;
}

export interface SharpePortfolioReturnPoint {
  timestamp: number;
  dailyReturn: number;
}

export interface SharpeResult {
  sharpeRatio: number | null;
  annualizedReturn: number;
  annualizedVolatility: number;
  riskFreeRate: number;
  lookbackDays: number;
  calculationDate: string;
  skippedTickers: string[];
  skipReasons: Record<string, string>;
  insufficientDataReason?: string;
  portfolioReturnSeries: SharpePortfolioReturnPoint[];
  tickerDetails: SharpeTickerDetail[];
  alignedTradingDays: number;
  meanDailyReturn: number;
  dailyRiskFreeRate: number;
  calculatedAt: string;
}
