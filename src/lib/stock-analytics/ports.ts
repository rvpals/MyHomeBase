import type { CorrelationResult, SharpeResult, VolatilityResult } from "./types";

export interface StockAnalyticsRepository {
  listVolatilityCache(): VolatilityResult[];
  /** Wholesale replace — one row per result, upserted by ticker. */
  saveVolatilityCache(results: VolatilityResult[]): void;
  clearVolatilityCache(): void;

  getCorrelationCache(): CorrelationResult | undefined;
  saveCorrelationCache(result: CorrelationResult): void;
  clearCorrelationCache(): void;

  getSharpeCache(): SharpeResult | undefined;
  saveSharpeCache(result: SharpeResult): void;
}
