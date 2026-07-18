import type Database from "better-sqlite3";
import type { StockAnalyticsRepository } from "./ports";
import type { CorrelationResult, SharpeResult, VolatilityResult } from "./types";

interface VolatilityRow {
  ticker: string;
  company_name: string | null;
  type: string;
  shares: number;
  current_price_cents: number;
  annualized_vol_pct: number;
  daily_std_dev_pct: number;
  volatility_label: string;
  low_52w_cents: number;
  high_52w_cents: number;
  range_position_pct: number;
  sample_count: number;
  calculated_at: string;
}

interface CorrelationRow {
  tickers_json: string;
  matrix_json: string;
  market_correlation_json: string;
  failed_tickers_json: string;
  calculated_at: string;
}

interface SharpeRow {
  risk_free_rate: number;
  lookback_days: number;
  sharpe_ratio: number | null;
  annualized_return: number;
  annualized_volatility: number;
  aligned_trading_days: number;
  mean_daily_return: number;
  daily_risk_free_rate: number;
  calculation_date: string;
  ticker_details_json: string;
  portfolio_return_series_json: string;
  skipped_tickers_json: string;
  skip_reasons_json: string;
  insufficient_data_reason: string | null;
  calculated_at: string;
}

function volatilityToDomain(row: VolatilityRow): VolatilityResult {
  return {
    ticker: row.ticker,
    companyName: row.company_name ?? undefined,
    type: row.type,
    shares: row.shares,
    currentPriceCents: row.current_price_cents,
    annualizedVolPct: row.annualized_vol_pct,
    dailyStdDevPct: row.daily_std_dev_pct,
    volatilityLabel: row.volatility_label,
    low52wCents: row.low_52w_cents,
    high52wCents: row.high_52w_cents,
    rangePositionPct: row.range_position_pct,
    sampleCount: row.sample_count,
    calculatedAt: row.calculated_at,
  };
}

function correlationToDomain(row: CorrelationRow): CorrelationResult {
  return {
    tickers: JSON.parse(row.tickers_json),
    matrix: JSON.parse(row.matrix_json),
    marketCorrelation: JSON.parse(row.market_correlation_json),
    failedTickers: JSON.parse(row.failed_tickers_json),
    calculatedAt: row.calculated_at,
  };
}

function sharpeToDomain(row: SharpeRow): SharpeResult {
  return {
    sharpeRatio: row.sharpe_ratio,
    annualizedReturn: row.annualized_return,
    annualizedVolatility: row.annualized_volatility,
    riskFreeRate: row.risk_free_rate,
    lookbackDays: row.lookback_days,
    calculationDate: row.calculation_date,
    skippedTickers: JSON.parse(row.skipped_tickers_json),
    skipReasons: JSON.parse(row.skip_reasons_json),
    insufficientDataReason: row.insufficient_data_reason ?? undefined,
    portfolioReturnSeries: JSON.parse(row.portfolio_return_series_json),
    tickerDetails: JSON.parse(row.ticker_details_json),
    alignedTradingDays: row.aligned_trading_days,
    meanDailyReturn: row.mean_daily_return,
    dailyRiskFreeRate: row.daily_risk_free_rate,
    calculatedAt: row.calculated_at,
  };
}

// The real repository. Swap the database without touching any use-case.
export class SqliteStockAnalyticsRepository implements StockAnalyticsRepository {
  constructor(private db: Database.Database) {}

  listVolatilityCache(): VolatilityResult[] {
    const rows = this.db
      .prepare("SELECT * FROM stock_volatility_cache ORDER BY type, annualized_vol_pct ASC")
      .all() as VolatilityRow[];
    return rows.map(volatilityToDomain);
  }

  saveVolatilityCache(results: VolatilityResult[]): void {
    const upsert = this.db.prepare(
      `INSERT INTO stock_volatility_cache
         (ticker, company_name, type, shares, current_price_cents, annualized_vol_pct,
          daily_std_dev_pct, volatility_label, low_52w_cents, high_52w_cents,
          range_position_pct, sample_count, calculated_at)
       VALUES
         (@ticker, @companyName, @type, @shares, @currentPriceCents, @annualizedVolPct,
          @dailyStdDevPct, @volatilityLabel, @low52wCents, @high52wCents,
          @rangePositionPct, @sampleCount, datetime('now'))
       ON CONFLICT (ticker) DO UPDATE SET
         company_name = excluded.company_name,
         type = excluded.type,
         shares = excluded.shares,
         current_price_cents = excluded.current_price_cents,
         annualized_vol_pct = excluded.annualized_vol_pct,
         daily_std_dev_pct = excluded.daily_std_dev_pct,
         volatility_label = excluded.volatility_label,
         low_52w_cents = excluded.low_52w_cents,
         high_52w_cents = excluded.high_52w_cents,
         range_position_pct = excluded.range_position_pct,
         sample_count = excluded.sample_count,
         calculated_at = excluded.calculated_at`,
    );

    this.db.transaction(() => {
      for (const result of results) {
        upsert.run({ ...result, companyName: result.companyName ?? null });
      }
    })();
  }

  clearVolatilityCache(): void {
    this.db.prepare("DELETE FROM stock_volatility_cache").run();
  }

  getCorrelationCache(): CorrelationResult | undefined {
    const row = this.db.prepare("SELECT * FROM stock_correlation_cache WHERE id = 1").get() as
      | CorrelationRow
      | undefined;
    return row ? correlationToDomain(row) : undefined;
  }

  saveCorrelationCache(result: CorrelationResult): void {
    this.db
      .prepare(
        `INSERT INTO stock_correlation_cache
           (id, tickers_json, matrix_json, market_correlation_json, failed_tickers_json, calculated_at)
         VALUES (1, @tickersJson, @matrixJson, @marketCorrelationJson, @failedTickersJson, datetime('now'))
         ON CONFLICT (id) DO UPDATE SET
           tickers_json = excluded.tickers_json,
           matrix_json = excluded.matrix_json,
           market_correlation_json = excluded.market_correlation_json,
           failed_tickers_json = excluded.failed_tickers_json,
           calculated_at = excluded.calculated_at`,
      )
      .run({
        tickersJson: JSON.stringify(result.tickers),
        matrixJson: JSON.stringify(result.matrix),
        marketCorrelationJson: JSON.stringify(result.marketCorrelation),
        failedTickersJson: JSON.stringify(result.failedTickers),
      });
  }

  clearCorrelationCache(): void {
    this.db.prepare("DELETE FROM stock_correlation_cache").run();
  }

  getSharpeCache(): SharpeResult | undefined {
    const row = this.db.prepare("SELECT * FROM stock_sharpe_cache WHERE id = 1").get() as
      | SharpeRow
      | undefined;
    return row ? sharpeToDomain(row) : undefined;
  }

  saveSharpeCache(result: SharpeResult): void {
    this.db
      .prepare(
        `INSERT INTO stock_sharpe_cache
           (id, risk_free_rate, lookback_days, sharpe_ratio, annualized_return, annualized_volatility,
            aligned_trading_days, mean_daily_return, daily_risk_free_rate, calculation_date,
            ticker_details_json, portfolio_return_series_json, skipped_tickers_json, skip_reasons_json,
            insufficient_data_reason, calculated_at)
         VALUES
           (1, @riskFreeRate, @lookbackDays, @sharpeRatio, @annualizedReturn, @annualizedVolatility,
            @alignedTradingDays, @meanDailyReturn, @dailyRiskFreeRate, @calculationDate,
            @tickerDetailsJson, @portfolioReturnSeriesJson, @skippedTickersJson, @skipReasonsJson,
            @insufficientDataReason, datetime('now'))
         ON CONFLICT (id) DO UPDATE SET
           risk_free_rate = excluded.risk_free_rate,
           lookback_days = excluded.lookback_days,
           sharpe_ratio = excluded.sharpe_ratio,
           annualized_return = excluded.annualized_return,
           annualized_volatility = excluded.annualized_volatility,
           aligned_trading_days = excluded.aligned_trading_days,
           mean_daily_return = excluded.mean_daily_return,
           daily_risk_free_rate = excluded.daily_risk_free_rate,
           calculation_date = excluded.calculation_date,
           ticker_details_json = excluded.ticker_details_json,
           portfolio_return_series_json = excluded.portfolio_return_series_json,
           skipped_tickers_json = excluded.skipped_tickers_json,
           skip_reasons_json = excluded.skip_reasons_json,
           insufficient_data_reason = excluded.insufficient_data_reason,
           calculated_at = excluded.calculated_at`,
      )
      .run({
        riskFreeRate: result.riskFreeRate,
        lookbackDays: result.lookbackDays,
        sharpeRatio: result.sharpeRatio,
        annualizedReturn: result.annualizedReturn,
        annualizedVolatility: result.annualizedVolatility,
        alignedTradingDays: result.alignedTradingDays,
        meanDailyReturn: result.meanDailyReturn,
        dailyRiskFreeRate: result.dailyRiskFreeRate,
        calculationDate: result.calculationDate,
        tickerDetailsJson: JSON.stringify(result.tickerDetails),
        portfolioReturnSeriesJson: JSON.stringify(result.portfolioReturnSeries),
        skippedTickersJson: JSON.stringify(result.skippedTickers),
        skipReasonsJson: JSON.stringify(result.skipReasons),
        insufficientDataReason: result.insufficientDataReason ?? null,
      });
  }
}
