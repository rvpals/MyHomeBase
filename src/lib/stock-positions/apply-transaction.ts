// Letting a recorded trade move the holding it describes.
//
// The two ledgers are deliberately separate: `stk_stock_positions` carries what you
// hold (normally imported from a broker), `stk_stock_transactions` carries what you
// did. Recording a trade has never touched the holding, because which specific lots
// a sale consumed is a decision — FIFO, specific-lot — that the ledger doesn't
// record. See `lib/tax-lots/from-transactions.ts`, which drops sells for that reason.
//
// This module is the opt-in bridge behind the Record Transaction card's "also update
// positions data" checkbox. It lives in `lib` because it makes the two real
// decisions — *which* position a trade belongs to, and what the trade does to the
// basis — and both must come out identically from a terminal and from the button.
//
// The basis rule here is AVERAGE COST, and that is a choice rather than a discovery.
// A sell reduces `costCents` by `unitCostCents × shares`, leaving the average
// untouched. It will not agree with a FIFO or specific-lot statement produced by the
// Tax Lots screen, and it isn't meant to: average cost is the only basis derivable
// without knowing which lots the sale consumed.

import type { StockPosition, StockTransaction } from "./types";

/** The trade fields this needs. Structural, so a stored row or a fresh input fits. */
export interface AppliedTrade {
  action: StockTransaction["action"];
  ticker: string;
  numberOfShares: number;
  pricePerShareCents: number;
}

/**
 * Why a trade couldn't be matched to exactly one holding.
 *
 * `none` — no position holds this ticker. Not an error in itself: you can record a
 * trade for something you don't track as a holding. The caller decides whether to
 * complain.
 *
 * `ambiguous` — more than one account holds it and the trade doesn't say which.
 * A position is keyed by `(accountId, ticker)`, so picking one silently would
 * corrupt a real holding; this refuses and hands back the candidates for the caller
 * to disambiguate.
 *
 * `wrong-account` — the trade names an account, this ticker is held, but not
 * *there*. Before migration 0094 a transaction carried no account and a lone
 * holding was assumed to be the target, which added a Fidelity purchase to a Chase
 * position without saying so. Now that the trade knows its own account, a holding
 * in a different one is a mismatch to report, not a candidate to fall back on.
 */
export type PositionMatchFailure =
  | { kind: "none"; ticker: string }
  | { kind: "ambiguous"; ticker: string; candidates: StockPosition[] }
  | { kind: "wrong-account"; ticker: string; requestedAccountId: number; held: StockPosition[] };

export type PositionMatch =
  | { ok: true; position: StockPosition }
  | { ok: false; failure: PositionMatchFailure };

/**
 * Picks the one position a trade should move.
 *
 * `accountId` is the account the trade belongs to — stored on the transaction since
 * 0094, so it is normally present. Given one, the holding must be in *that* account:
 * a holding elsewhere fails as `wrong-account` rather than being used, which is the
 * whole point of the column. `0` (Unassigned) is a real account id here and matches
 * only positions that are themselves unassigned.
 *
 * Without an account id — an older row, or a CSV whose firm matched nothing — this
 * falls back to the pre-0094 behaviour: a single holding is used, anything else
 * fails. That fallback is why the UI requires an account before it will apply a
 * trade to a holding.
 */
export function resolveTargetPosition(
  positions: StockPosition[],
  ticker: string,
  accountId?: number,
): PositionMatch {
  const symbol = ticker.trim().toUpperCase();
  const holding = positions.filter((position) => position.ticker.toUpperCase() === symbol);

  if (holding.length === 0) return { ok: false, failure: { kind: "none", ticker: symbol } };

  if (accountId !== undefined) {
    const exact = holding.find((position) => position.accountId === accountId);
    if (exact) return { ok: true, position: exact };
    // Held, but somewhere else. The candidates come back so the caller can name
    // where it *is* held — that is what lets the reader tell a mis-picked account
    // apart from a genuinely new position that needs creating. Ids, not names:
    // account names live in `stk_investment_accounts`, which this module can't read.
    return {
      ok: false,
      failure: {
        kind: "wrong-account",
        ticker: symbol,
        requestedAccountId: accountId,
        held: holding,
      },
    };
  }

  if (holding.length > 1)
    return { ok: false, failure: { kind: "ambiguous", ticker: symbol, candidates: holding } };
  return { ok: true, position: holding[0] };
}

/**
 * A sentence a human can act on, for a failure the UI has to explain.
 *
 * `accountName` resolves an account id to its display name. Optional because this
 * module has no access to `stk_investment_accounts` — callers that have the account
 * list (the server action, the CLI) pass one and get "held in Chase"; callers that
 * don't fall back to "account 3", which is still actionable.
 */
export function describeMatchFailure(
  failure: PositionMatchFailure,
  accountName: (accountId: number) => string = (id) =>
    id === 0 ? "Unassigned" : `account ${id}`,
): string {
  if (failure.kind === "none")
    return `No ${failure.ticker} position to update. The transaction was not recorded — clear the checkbox to record it without touching holdings, or add the position first.`;

  if (failure.kind === "wrong-account") {
    const where = failure.held.map((position) => accountName(position.accountId)).join(", ");
    return `${failure.ticker} is held in ${where}, not in ${accountName(failure.requestedAccountId)}. The transaction was not recorded — add a ${failure.ticker} position to ${accountName(failure.requestedAccountId)} first, pick the account that holds it, or clear the checkbox to record the trade on its own.`;
  }

  const accounts = failure.candidates.length;
  return `${failure.ticker} is held in ${accounts} accounts, so it isn't clear which holding this trade belongs to. Pick an account, or clear the checkbox to record the transaction on its own.`;
}

/** A share count without trailing zeros — brokers report fractional shares. */
function formatShares(quantity: number): string {
  return Number(quantity.toFixed(4)).toString();
}

/**
 * What a pending trade will do to a holding, as a sentence:
 * `"AAPL: 100 shares, now +25 = 125 shares (Schwab Brokerage)."`
 *
 * For the preview shown *before* submitting, so the reader can check the arithmetic
 * against their broker rather than trusting the form. The signed middle term is the
 * point — a sell reads `now -25`, which is the one case where a wrong sign matters
 * and a bare `100 → 75` makes you infer the direction.
 *
 * An oversell isn't special-cased here; `projectedQuantity` goes negative and the
 * caller decides how to flag it, since a negative projection is also what
 * `applyTransactionToPosition` refuses to write.
 */
export function describeProjectedHolding({
  ticker,
  accountName,
  currentQuantity,
  delta,
}: {
  ticker: string;
  accountName: string;
  currentQuantity: number;
  /** Signed: positive for a buy, negative for a sell. */
  delta: number;
}): string {
  const sign = delta < 0 ? "-" : "+";
  const projected = currentQuantity + delta;
  return (
    `${ticker}: ${formatShares(currentQuantity)} shares, ` +
    `now ${sign}${formatShares(Math.abs(delta))} = ${formatShares(projected)} shares ` +
    `(${accountName}).`
  );
}

/** The holding fields a trade moves. Everything else on the position is left alone. */
export interface PositionQuantityUpdate {
  quantity: number;
  costCents: number;
  unitCostCents: number;
  valueCents: number;
  unrealizedGainLossCents: number;
  unrealizedGainLossPct: number;
}

/** Raised when a sell would take a holding below zero. */
export class OversellError extends Error {
  constructor(
    readonly ticker: string,
    readonly held: number,
    readonly requested: number,
  ) {
    super(
      `Cannot sell ${requested} shares of ${ticker} — the position holds ${held}. ` +
        `Record the transaction without updating positions, or correct the share count.`,
    );
    this.name = "OversellError";
  }
}

/**
 * What a trade does to a holding.
 *
 * A **buy** adds shares and adds `shares × price` to the basis, then re-averages.
 * A **sell** removes shares and removes `unitCostCents × shares` from the basis,
 * leaving the average per-share cost where it was.
 *
 * Selling everything leaves the row at zero shares rather than deleting it: the
 * position still carries history this function has no business discarding —
 * `incomeEarnedCents`, the broker's classification — and a zeroed row is reversible
 * where a deleted one isn't.
 *
 * Selling more than is held throws. `quantity` is `nonnegative()` in the schema, so
 * a negative would otherwise surface as an opaque zod failure further down.
 *
 * Value and unrealized gain are recomputed against the position's stored
 * `currentPriceCents` — the trade changes how much you hold, not what it's worth per
 * share. A position with no known basis (`costCents` 0) reports no gain, matching
 * `refreshPosition`.
 */
export function applyTransactionToPosition(
  position: StockPosition,
  trade: AppliedTrade,
): PositionQuantityUpdate {
  const { numberOfShares: shares, pricePerShareCents: priceCents } = trade;

  let quantity: number;
  let costCents: number;

  if (trade.action === "Buy") {
    quantity = position.quantity + shares;
    costCents = position.costCents + Math.round(shares * priceCents);
  } else {
    if (shares > position.quantity)
      throw new OversellError(position.ticker, position.quantity, shares);
    quantity = position.quantity - shares;
    // Average cost: the basis leaves with the shares, the per-share average stays.
    // Clamped at 0 because a rounded unit cost times many shares can overshoot a
    // basis that was itself rounded.
    costCents = Math.max(0, position.costCents - Math.round(position.unitCostCents * shares));
  }

  // Selling out zeroes the basis outright. Deriving it from the clamp above could
  // leave a few cents of basis against no shares, which reads as a phantom loss.
  if (quantity === 0) costCents = 0;

  const unitCostCents = quantity > 0 && costCents > 0 ? Math.round(costCents / quantity) : 0;
  const valueCents = Math.round(position.currentPriceCents * quantity);
  const hasBasis = costCents > 0;

  return {
    quantity,
    costCents,
    unitCostCents,
    valueCents,
    unrealizedGainLossCents: hasBasis ? valueCents - costCents : 0,
    unrealizedGainLossPct: hasBasis ? ((valueCents - costCents) / costCents) * 100 : 0,
  };
}
