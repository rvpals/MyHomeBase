export interface InvestmentAccount {
  id: number;
  name: string;
  description: string;
  initialValueCents: number;
  lastValueCents?: number;
  lastUpdatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PerformanceRecord {
  id: number;
  accountId: number;
  totalValueCents: number;
  recordDate: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}
