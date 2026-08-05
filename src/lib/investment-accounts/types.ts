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
