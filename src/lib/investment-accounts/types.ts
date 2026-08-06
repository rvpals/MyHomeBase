export interface InvestmentAccount {
  id: number;
  name: string;
  description: string;
  initialValueCents: number;
  lastValueCents?: number;
  lastUpdatedAt?: string;
  /**
   * Set when the account has an icon. Only the *type* travels with a list — the
   * bytes themselves are fetched separately (see AccountIcon) so they never ride
   * along in a page payload.
   */
  iconMimeType?: string;
  createdAt: string;
  updatedAt: string;
}

/** An account's icon bytes. Read only by the route that serves them. */
export interface AccountIcon {
  data: Buffer;
  mimeType: string;
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

/**
 * One date across every account, for the combined performance chart and its
 * table.
 *
 * `valueCentsByAccountId` holds only the accounts that actually recorded a
 * value on this date — a missing key means "not recorded", which is different
 * from a recorded zero and must stay distinguishable. `totalCents` therefore
 * sums what was recorded on the date, not the portfolio's true worth that day.
 */
export interface AccountPerformancePoint {
  /** Local-calendar "YYYY-MM-DD". */
  date: string;
  valueCentsByAccountId: Record<number, number>;
  totalCents: number;
  /** How many accounts reported on this date. */
  reportingAccountCount: number;
}

/** One account's identity and how it moved over the window. */
export interface AccountPerformanceSeries {
  accountId: number;
  accountName: string;
  /** Dates this account actually recorded, oldest first. */
  recordCount: number;
  firstDate?: string;
  lastDate?: string;
  firstValueCents?: number;
  lastValueCents?: number;
  /** Change from first to last recorded value. 0 when fewer than two records. */
  changeCents: number;
  changePct: number;
}

/** Everything the "Account Performance Over Time" card renders. */
export interface AccountPerformanceHistory {
  /** Oldest first, one entry per date any account recorded. */
  points: AccountPerformancePoint[];
  /** One per account that has at least one record, in the order given. */
  series: AccountPerformanceSeries[];
}
