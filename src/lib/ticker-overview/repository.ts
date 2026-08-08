import type Database from "better-sqlite3";
import type { TickerRiskCacheRepository } from "./ports";
import type { TickerRisk } from "./types";

interface RiskRow {
  ticker: string;
  annualized_vol_pct: number;
  daily_std_dev_pct: number;
  volatility_label: string;
  low_52w_cents: number;
  high_52w_cents: number;
  current_price_cents: number;
  range_position_pct: number;
  market_correlation: number | null;
  market_benchmark_ticker: string;
  annualized_return_pct: number;
  sample_count: number;
  calculated_at: string;
}

function toDomain(row: RiskRow): TickerRisk {
  return {
    ticker: row.ticker,
    annualizedVolPct: row.annualized_vol_pct,
    dailyStdDevPct: row.daily_std_dev_pct,
    volatilityLabel: row.volatility_label,
    low52wCents: row.low_52w_cents,
    high52wCents: row.high_52w_cents,
    currentPriceCents: row.current_price_cents,
    rangePositionPct: row.range_position_pct,
    // NULL means the benchmark leg was unavailable when this was computed —
    // not a correlation of zero, so it must not collapse to one.
    marketCorrelation: row.market_correlation,
    marketBenchmarkTicker: row.market_benchmark_ticker,
    annualizedReturnPct: row.annualized_return_pct,
    sampleCount: row.sample_count,
    calculatedAt: row.calculated_at,
  };
}

// Rows are keyed by ticker and written one at a time. There is no TTL here on
// purpose: staleness is the caller's business, and the only thing that refreshes
// a row is a reader pressing Recalculate.
export class SqliteTickerRiskCacheRepository implements TickerRiskCacheRepository {
  constructor(private db: Database.Database) {}

  get(ticker: string): TickerRisk | undefined {
    const row = this.db
      .prepare("SELECT * FROM stk_ticker_risk_cache WHERE ticker = ?")
      .get(ticker) as RiskRow | undefined;
    return row ? toDomain(row) : undefined;
  }

  save(risk: TickerRisk): void {
    this.db
      .prepare(
        `INSERT INTO stk_ticker_risk_cache
           (ticker, annualized_vol_pct, daily_std_dev_pct, volatility_label,
            low_52w_cents, high_52w_cents, current_price_cents, range_position_pct,
            market_correlation, market_benchmark_ticker, annualized_return_pct,
            sample_count, calculated_at)
         VALUES
           (@ticker, @annualizedVolPct, @dailyStdDevPct, @volatilityLabel,
            @low52wCents, @high52wCents, @currentPriceCents, @rangePositionPct,
            @marketCorrelation, @marketBenchmarkTicker, @annualizedReturnPct,
            @sampleCount, @calculatedAt)
         ON CONFLICT(ticker) DO UPDATE SET
           annualized_vol_pct      = excluded.annualized_vol_pct,
           daily_std_dev_pct       = excluded.daily_std_dev_pct,
           volatility_label        = excluded.volatility_label,
           low_52w_cents           = excluded.low_52w_cents,
           high_52w_cents          = excluded.high_52w_cents,
           current_price_cents     = excluded.current_price_cents,
           range_position_pct      = excluded.range_position_pct,
           market_correlation      = excluded.market_correlation,
           market_benchmark_ticker = excluded.market_benchmark_ticker,
           annualized_return_pct   = excluded.annualized_return_pct,
           sample_count            = excluded.sample_count,
           calculated_at           = excluded.calculated_at`,
      )
      // Listed out rather than spreading `risk`: better-sqlite3 rejects an
      // object carrying a key the statement doesn't name, so a future field on
      // `TickerRisk` would break this at runtime instead of at the type level.
      .run({
        ticker: risk.ticker,
        annualizedVolPct: risk.annualizedVolPct,
        dailyStdDevPct: risk.dailyStdDevPct,
        volatilityLabel: risk.volatilityLabel,
        low52wCents: risk.low52wCents,
        high52wCents: risk.high52wCents,
        currentPriceCents: risk.currentPriceCents,
        rangePositionPct: risk.rangePositionPct,
        marketCorrelation: risk.marketCorrelation,
        marketBenchmarkTicker: risk.marketBenchmarkTicker,
        annualizedReturnPct: risk.annualizedReturnPct,
        sampleCount: risk.sampleCount,
        calculatedAt: risk.calculatedAt,
      });
  }
}
