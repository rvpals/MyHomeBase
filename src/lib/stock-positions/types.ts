export type PositionType = "Stock" | "ETF" | "Bond" | "MutualFund" | "Crypto" | "Other";

export type TransactionAction = "Buy" | "Sell";

export interface StockPosition {
  ticker: string;
  name: string;
  type: PositionType;
  currentPriceCents: number;
  quantity: number;
  dayGainLossCents: number;
  valueCents: number;
  dayHighCents: number;
  dayLowCents: number;
  dividendRateCents: number;
  createdAt: string;
  updatedAt: string;
}

export interface StockTransaction {
  id: number;
  transactionAt: string;
  action: TransactionAction;
  ticker: string;
  numberOfShares: number;
  pricePerShareCents: number;
  totalAmountCents: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioSummary {
  positionCount: number;
  totalValueCents: number;
  totalDayGainLossCents: number;
  dayChangePct: number;
  stockValueCents: number;
  etfValueCents: number;
  otherValueCents: number;
  annualDividendIncomeCents: number;
}

export interface TransactionStats {
  count: number;
  avgPricePerShareCents: number;
  maxPricePerShareCents: number;
  minPricePerShareCents: number;
}
