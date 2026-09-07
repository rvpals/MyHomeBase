// The public surface of the Tax Lots module. Import from here, never from a file
// inside it.
export type {
  StockSplit,
  SplitHistory,
  TaxClassification,
  RawLot,
  NormalizedLot,
  LotPerformance,
  PortfolioLotSummary,
  CashFlow,
  TaxLot,
} from "./types";
export {
  createTaxLotSchema,
  updateTaxLotSchema,
  taxLotIdSchema,
  analyzeLotsSchema,
  normalizeLotSchema,
  type CreateTaxLotInput,
  type UpdateTaxLotInput,
  type TaxLotIdInput,
  type AnalyzeLotsInput,
  type NormalizeLotInput,
} from "./schema";
export type { TaxLotRepository } from "./ports";
export {
  splitHistoryFor,
  tickersWithSplits,
  cumulativeSplitFactor,
  splitsAppliedTo,
  normalizeLot,
  passthroughLot,
} from "./splits";
export { computeXirr, type XirrFlow } from "./xirr";
export {
  yearsBetween,
  classifyHoldingPeriod,
  computeCagr,
  computeYieldOnCost,
  normalizeStoredLot,
  analyzeNormalizedLot,
  analyzeLot,
  buildCashFlows,
  summarizePortfolio,
  analyzePortfolio,
  analyzeTicker,
  listTaxLots,
  listTaxLotTickers,
  getTaxLot,
  createTaxLot,
  updateTaxLot,
  deleteTaxLot,
  type LotAnalysisContext,
  type PortfolioAnalysis,
} from "./tax-lots";
