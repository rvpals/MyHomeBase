"use server";

import { revalidatePath } from "next/cache";
import { lookupQuote } from "@/lib/market-data";
import {
  createTransactionAndApply,
  deletePosition,
  deleteTransaction,
  listPositionsByTicker,
  getPosition,
  listPositions,
  refreshAllPositions,
  refreshPosition,
  updateTransaction,
  upsertPosition,
  UNASSIGNED_ACCOUNT_ID,
} from "@/lib/stock-positions";
import type { PositionType, PositionValueMove, TransactionAction } from "@/lib/stock-positions";
import { listAccounts } from "@/lib/investment-accounts";
import { centsToDollars, dollarsToCents } from "@/lib/shared/money";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";
import { runMonitorsAgainstMyTickerAction } from "./ticker-monitors-actions";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "investments";

const INVESTMENTS_MODULE_PATH = "/modules/investments";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Every numeric field is the raw string from its input; the action parses them. */
export interface PositionFormInput {
  /** 0 = Unassigned. */
  accountId: number;
  ticker: string;
  name: string;
  type: PositionType;
  currentPrice: string;
  quantity: string;
  dayGainLoss: string;
  dayHigh: string;
  dayLow: string;
  dividendRate: string;
  cost: string;
  unitCost: string;
  unrealizedGainLoss: string;
  unrealizedGainLossPct: string;
  estAnnualIncome: string;
  incomeEarned: string;
  cusip: string;
  isin: string;
  assetClass: string;
  assetStrategy: string;
}

export interface TransactionFormInput {
  transactionAt: string;
  action: TransactionAction;
  ticker: string;
  numberOfShares: string;
  pricePerShare: string;
  /**
   * Which of your accounts the trade happened in. Stored on the transaction, and
   * what picks the holding when `applyToPosition` is set. `0`/undefined is
   * Unassigned, which records fine but can't update a holding.
   */
  accountId?: number;
  brokerageFirm?: string;
  /** The broker's reference number, when you have one. Blank is fine. */
  externalId?: string;
  note?: string;
  /**
   * "Also update positions data" — move the matching holding's share count too.
   * Only read when recording; editing an existing transaction never touches a
   * holding, since the original trade has already been applied.
   */
  applyToPosition?: boolean;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

/**
 * An account-id -> name function over the current account list.
 *
 * `lib/stock-positions` can't read `inv_investment_accounts`, so it asks for this
 * when it needs to name an account in an error ("AAPL is held in Chase, not
 * Fidelity"). Read once per call rather than per id — a message may name several.
 */
function accountNameLookup(): (accountId: number) => string {
  const accounts = listAccounts(deps.investmentAccountRepo);
  return (accountId) =>
    accountId === UNASSIGNED_ACCOUNT_ID
      ? "Unassigned"
      : (accounts.find((account) => account.id === accountId)?.name ?? `account ${accountId}`);
}

export async function upsertPositionAction(input: PositionFormInput): Promise<ActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    upsertPosition(deps.stockPositionRepo, {
      accountId: input.accountId,
      ticker: input.ticker,
      name: input.name,
      type: input.type,
      currentPriceCents: dollarsToCents(input.currentPrice || "0"),
      quantity: Number(input.quantity || "0"),
      dayGainLossCents: dollarsToCents(input.dayGainLoss || "0"),
      dayHighCents: dollarsToCents(input.dayHigh || "0"),
      dayLowCents: dollarsToCents(input.dayLow || "0"),
      dividendRateCents: dollarsToCents(input.dividendRate || "0"),
      costCents: dollarsToCents(input.cost || "0"),
      unitCostCents: dollarsToCents(input.unitCost || "0"),
      unrealizedGainLossCents: dollarsToCents(input.unrealizedGainLoss || "0"),
      unrealizedGainLossPct: Number(input.unrealizedGainLossPct || "0"),
      estAnnualIncomeCents: dollarsToCents(input.estAnnualIncome || "0"),
      incomeEarnedCents: dollarsToCents(input.incomeEarned || "0"),
      cusip: input.cusip,
      isin: input.isin,
      assetClass: input.assetClass,
      assetStrategy: input.assetStrategy,
    });
  } catch (error) {
    return toErrorResult(error, "Failed to save position.");
  }
  revalidatePath(INVESTMENTS_MODULE_PATH);
  return { ok: true };
}

export async function deletePositionAction(accountId: number, ticker: string): Promise<ActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    deletePosition(deps.stockPositionRepo, { accountId, ticker });
  } catch (error) {
    return toErrorResult(error, "Failed to delete position.");
  }
  revalidatePath(INVESTMENTS_MODULE_PATH);
  return { ok: true };
}

export async function createTransactionAction(input: TransactionFormInput): Promise<ActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    createTransactionAndApply(deps.stockPositionRepo, {
      transactionAt: input.transactionAt,
      action: input.action,
      ticker: input.ticker,
      numberOfShares: Number(input.numberOfShares || "0"),
      pricePerShareCents: dollarsToCents(input.pricePerShare || "0"),
      accountId: input.accountId ?? UNASSIGNED_ACCOUNT_ID,
      brokerageFirm: input.brokerageFirm ?? "",
      externalId: input.externalId ?? "",
      note: input.note ?? "",
      applyToPosition: input.applyToPosition ?? false,
    }, accountNameLookup());
  } catch (error) {
    return toErrorResult(error, "Failed to record transaction.");
  }
  revalidatePath(INVESTMENTS_MODULE_PATH);
  return { ok: true };
}

export async function updateTransactionAction(
  transactionId: number,
  input: TransactionFormInput,
): Promise<ActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    updateTransaction(deps.stockPositionRepo, transactionId, {
      transactionAt: input.transactionAt,
      action: input.action,
      ticker: input.ticker,
      numberOfShares: Number(input.numberOfShares || "0"),
      pricePerShareCents: dollarsToCents(input.pricePerShare || "0"),
      accountId: input.accountId ?? UNASSIGNED_ACCOUNT_ID,
      brokerageFirm: input.brokerageFirm ?? "",
      externalId: input.externalId ?? "",
      note: input.note ?? "",
    });
  } catch (error) {
    return toErrorResult(error, "Failed to update transaction.");
  }
  revalidatePath(INVESTMENTS_MODULE_PATH);
  return { ok: true };
}

export interface QuoteResult {
  ok: boolean;
  name?: string;
  currentPrice?: string;
  dayHigh?: string;
  dayLow?: string;
  dividendRate?: string;
  error?: string;
}

export async function fetchQuoteAction(ticker: string): Promise<QuoteResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const quote = await lookupQuote(deps.marketDataClient, ticker);
    return {
      ok: true,
      name: quote.shortName,
      currentPrice: centsToDollars(quote.priceCents).toFixed(2),
      dayHigh: centsToDollars(quote.dayHighCents).toFixed(2),
      dayLow: centsToDollars(quote.dayLowCents).toFixed(2),
      dividendRate: centsToDollars(quote.dividendRateCents).toFixed(2),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to fetch a live quote.");
  }
}

export interface RefreshAllResult extends ActionResult {
  refreshedCount?: number;
  failed?: { ticker: string; error: string }[];
  /** How many monitors newly fired on the back of this refresh. */
  triggeredMonitors?: number;
  /** Which tickers they were on, for the caller's notice. */
  triggeredTickers?: string[];
}

export interface RefreshTarget {
  accountId: number;
  ticker: string;
  name: string;
}

/**
 * The positions a progressive refresh will walk, in order. The dashboard reads
 * this first so it can show "3 of 34" and name each ticker before fetching it —
 * a single all-in-one action can't report progress, because a server action
 * returns once.
 */
export async function listRefreshTargetsAction(): Promise<RefreshTarget[]> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return listPositions(deps.stockPositionRepo).map((position) => ({
    accountId: position.accountId,
    ticker: position.ticker,
    name: position.name,
  }));
}

export interface RefreshOneResult extends ActionResult {
  ticker: string;
  /** Formatted price, e.g. "220.15". Absent when the fetch failed. */
  price?: string;
  name?: string;
  /**
   * What this position contributed to the portfolio total before and after the
   * re-price, so the dashboard can swap one for the other and keep a running
   * total climbing. Both absent when the fetch failed — a failed ticker keeps its
   * stored value, so there's nothing to swap.
   */
  before?: PositionValueMove;
  after?: PositionValueMove;
}

/**
 * Refreshes one position. Never throws: a delisted or renamed ticker comes back as
 * `ok: false` so the caller's loop can note it and carry on, the same tolerance
 * `refreshAllPositions` applies internally.
 */
export async function refreshOnePositionAction(
  accountId: number,
  ticker: string,
): Promise<RefreshOneResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    // Read before writing: `refreshPosition` upserts, so the pre-refresh value is
    // gone by the time it returns, and the running total needs both ends.
    const existing = getPosition(deps.stockPositionRepo, { accountId, ticker });
    const position = await refreshPosition(deps.stockPositionRepo, deps.marketDataClient, {
      accountId,
      ticker,
    });
    return {
      ok: true,
      ticker,
      price: centsToDollars(position.currentPriceCents).toFixed(2),
      name: position.name,
      before: {
        valueCents: existing?.valueCents ?? 0,
        dayGainLossCents: existing?.dayGainLossCents ?? 0,
      },
      after: {
        valueCents: position.valueCents,
        dayGainLossCents: position.dayGainLossCents,
      },
    };
  } catch (error) {
    return {
      ok: false,
      ticker,
      error: error instanceof Error ? error.message : "Failed to refresh.",
    };
  }
}

export async function refreshAllPositionsAction(): Promise<RefreshAllResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const { refreshed, failed } = await refreshAllPositions(deps.stockPositionRepo, deps.marketDataClient);

    // Monitors, against the prices just written. Inside the action rather than
    // at the caller because this one refreshes everything in a single round
    // trip — unlike the dashboard and home-card controls, which drive their own
    // per-ticker loop from the client and so call the monitor action themselves.
    //
    // Never throws (the action swallows its own failures), so a monitor problem
    // cannot turn a successful refresh into a failed one.
    const monitors = await runMonitorsAgainstMyTickerAction();

    revalidatePath(INVESTMENTS_MODULE_PATH);
    return {
      ok: true,
      refreshedCount: refreshed.length,
      failed,
      triggeredMonitors: monitors.triggered,
      triggeredTickers: monitors.triggeredTickers,
    };
  } catch (error) {
    return toErrorResult(error, "Failed to refresh positions.");
  }
}

export async function deleteTransactionAction(transactionId: number): Promise<ActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    deleteTransaction(deps.stockPositionRepo, transactionId);
  } catch (error) {
    return toErrorResult(error, "Failed to delete transaction.");
  }
  revalidatePath(INVESTMENTS_MODULE_PATH);
  return { ok: true };
}

/** One account that holds a ticker, for the apply-to-position picker. */
export interface TickerHolding {
  accountId: number;
  accountName: string;
  quantity: number;
}

/**
 * Which accounts hold this ticker, so the form can say what a sale would deduct
 * from — and ask which holding when there's more than one.
 *
 * Named for the picker rather than exposed as a general lookup: it returns only the
 * three fields that populate it.
 */
export async function listTickerHoldingsAction(ticker: string): Promise<TickerHolding[]> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const symbol = ticker.trim().toUpperCase();
  if (!symbol) return [];

  const accountName = accountNameLookup();
  return listPositionsByTicker(deps.stockPositionRepo, symbol).map((position) => ({
    accountId: position.accountId,
    accountName: accountName(position.accountId),
    quantity: position.quantity,
  }));
}
