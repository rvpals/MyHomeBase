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
 * `ambiguous` — more than one account holds it. A position is keyed by
 * `(accountId, ticker)`, but a transaction carries no account, only a free-text
 * `brokerageFirm`. Picking one silently would corrupt a real holding, so this
 * refuses and hands back the candidates for the caller to disambiguate.
 */
export type PositionMatchFailure =
  | { kind: "none"; ticker: string }
  | { kind: "ambiguous"; ticker: string; candidates: StockPosition[] };

export type PositionMatch =
  | { ok: true; position: StockPosition }
  | { ok: false; failure: PositionMatchFailure };

/**
 * Picks the one position a trade should move.
 *
 * When `accountId` is given the choice is already made and this just finds that
 * holding — that is the path the UI takes once it has asked which account. Without
 * one, a single match is used and anything else fails rather than guessing.
 */
export function resolveTargetPosition(
  positions: StockPosition[],
  ticker: string,
  accountId?: number,
): PositionMatch {
  const symbol = ticker.trim().toUpperCase();
  const holding = positions.filter((position) => position.ticker.toUpperCase() === symbol);

  if (accountId !== undefined) {
    const exact = holding.find((position) => position.accountId === accountId);
    return exact
      ? { ok: true, position: exact }
      : { ok: false, failure: { kind: "none", ticker: symbol } };
  }

  if (holding.length === 0) return { ok: false, failure: { kind: "none", ticker: symbol } };
  if (holding.length > 1)
    return { ok: false, failure: { kind: "ambiguous", ticker: symbol, candidates: holding } };
  return { ok: true, position: holding[0] };
}

/** A sentence a human can act on, for a failure the UI has to explain. */
export function describeMatchFailure(failure: PositionMatchFailure): string {
  if (failure.kind === "none")
    return `No ${failure.ticker} position to update. The transaction was not recorded — clear the checkbox to record it without touching holdings, or add the position first.`;

  const accounts = failure.candidates.length;
  return `${failure.ticker} is held in ${accounts} accounts, so it isn't clear which holding this trade belongs to. Pick an account, or clear the checkbox to record the transaction on its own.`;
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
