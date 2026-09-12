/**
 * The shapes behind "Export for AI Analysis" — a portfolio flattened into
 * something a language model can read without seeing who owns it.
 *
 * Everything here is derived. Nothing in this module is stored, so there is no
 * table, no repository and no migration: the export is recomputed from the
 * positions and accounts that already exist each time it is asked for.
 */

/**
 * How an account is treated for tax, inferred from its name.
 *
 * A category rather than the account's own words because the analysis only ever
 * needs the tax treatment — "Roth IRA" is what decides whether a holding is
 * well-placed; "Fidelity ROTH IRA Account" adds a broker and nothing else.
 */
export type AccountKind = "Taxable" | "Roth IRA" | "Traditional IRA" | "Retirement" | "HSA";

export const ACCOUNT_KINDS = [
  "Taxable",
  "Roth IRA",
  "Traditional IRA",
  "Retirement",
  "HSA",
] as const satisfies readonly AccountKind[];

/**
 * The kinds exported by default.
 *
 * Employer plans (`Retirement`) and an `HSA` are left out: in this database they
 * carry a balance but no positions, so including them would contribute an opaque
 * number that no allocation, overlap or fee analysis can act on — while making
 * the portfolio total look like it covers everything. The payload says what was
 * excluded so the reader is never misled by the omission.
 */
export const DEFAULT_EXPORTED_KINDS = [
  "Taxable",
  "Roth IRA",
  "Traditional IRA",
] as const satisfies readonly AccountKind[];

/** Which rendering the reader asked for. */
export type ExportFormat = "markdown" | "json";

/** An analysis the prompt can ask for. The reader ticks any combination. */
export type AnalysisFocus = "allocation" | "fees" | "tax";

export const ANALYSIS_FOCUSES = ["allocation", "fees", "tax"] as const satisfies readonly AnalysisFocus[];

/** What each focus is called on screen, and the one-liner beside its checkbox. */
export const ANALYSIS_FOCUS_INFO: Record<AnalysisFocus, { label: string; description: string }> = {
  allocation: {
    label: "Asset Allocation & Overlap",
    description: "Concentration, diversification, and funds that hold the same companies twice.",
  },
  fees: {
    label: "Fee Drag & Expense Ratios",
    description: "What the funds cost to hold, and cheaper equivalents worth switching to.",
  },
  tax: {
    label: "Tax Efficiency & Rebalancing",
    description: "Whether each holding sits in the right account, and how to rebalance cheaply.",
  },
};

/**
 * One ticker, summed over every exported account that holds it.
 *
 * Aggregated by ticker rather than listed per account because the questions
 * being asked — how concentrated am I, do these funds overlap — are about the
 * portfolio, not the brokerage. `accounts` keeps the placement information that
 * the tax analysis still needs.
 */
export interface ExportHolding {
  ticker: string;
  name: string;
  /** The stored position type: Stock, ETF, Bond, MutualFund, Crypto, Other. */
  vehicle: string;
  /** Which account kinds hold it, deduplicated — the input to tax placement. */
  accounts: AccountKind[];
  quantity: number;
  /** Average cost per share in dollars. `null` when no account reports a basis. */
  averageCostBasis: number | null;
  currentPrice: number;
  marketValue: number;
  /** Signed. `null` when there is no basis to measure against. */
  unrealizedGainLoss: number | null;
  /** Signed percent. `null` when there is no basis to measure against. */
  unrealizedGainLossPct: number | null;
  /** Share of the exported portfolio, 0-100. */
  weightPct: number;
  /** The resolved sector, or the "no sector" label for a fund. */
  sector: string;
  /**
   * Always `null`. No provider in this app reports one, and inventing a number
   * the model would then reason about is worse than admitting the gap — the
   * prompt tells it to supply its own and say so.
   */
  expenseRatio: number | null;
}

/** One sector's share of the exported portfolio. */
export interface SectorWeight {
  sector: string;
  marketValue: number;
  weightPct: number;
}

/** One account kind's share, so the tax analysis knows the sizes involved. */
export interface AccountKindWeight {
  kind: AccountKind;
  marketValue: number;
  weightPct: number;
  holdingCount: number;
}

/** The headline numbers, computed once so every renderer agrees. */
export interface ExportSummary {
  totalMarketValue: number;
  /** Summed over holdings that report a basis. */
  totalCostBasis: number;
  totalUnrealizedGainLoss: number;
  /** Against `totalCostBasis`. 0 when nothing reports a basis. */
  totalUnrealizedGainLossPct: number;
  holdingCount: number;
  accountCount: number;
  /** Share of the total held as cash or a cash-like position, 0-100. */
  cashAllocationPct: number;
  /** Largest first, at most three. Fewer when fewer sectors are known. */
  topSectors: SectorWeight[];
  byAccountKind: AccountKindWeight[];
  /** How many holdings had no usable sector — the caveat the prompt states. */
  unclassifiedHoldingCount: number;
  /** How many holdings reported no cost basis. */
  missingCostBasisCount: number;
}

/** An account that was deliberately left out, and why — stated, never silent. */
export interface ExcludedAccount {
  label: string;
  kind: AccountKind;
  reason: string;
}

/** Everything the renderers and the prompt read. Contains no PII by construction. */
export interface PortfolioExportPayload {
  /** Local-calendar "YYYY-MM-DD" the export was taken. */
  asOf: string;
  summary: ExportSummary;
  holdings: ExportHolding[];
  excludedAccounts: ExcludedAccount[];
  focus: AnalysisFocus[];
}
