// Turning recorded trades into analyzable lots.
//
// This is the bridge behind the ticker viewer's "Calculate Tax Lots" button, and it
// is in `lib` rather than in the host because it makes two real decisions — which
// rows count, and what a broker export's numbers mean — and both must come out the
// same from a terminal as from the button.
//
// A tax lot is a PURCHASE. Sells are therefore dropped, not netted: the analyzer
// scores what a lot cost against what it is worth, and a disposal has neither a
// holding period nor a cost basis to contribute. Dropping them is also honest about
// what this can't know — which specific lots a sale consumed is a decision (FIFO,
// specific-lot) recorded in the Tax Lots screen, not something recoverable from the
// ledger. So the count of skipped sells is returned rather than swallowed, and the
// screen says so.

import type { AdhocLotInput } from "./schema";

/** The trade fields this needs. Structural, so any row carrying them fits. */
export interface RecordedTrade {
  /** ISO instant, as the transaction rows store it. */
  transactionAt: string;
  action: string;
  numberOfShares: number;
  pricePerShareCents: number;
  brokerageFirm: string;
  note: string;
}

export interface LotsFromTradesResult {
  lots: AdhocLotInput[];
  /** Sells left out. Reported so the screen can say the position isn't net. */
  skippedSells: number;
  /** Rows dropped as unusable — no shares, or no date. */
  skippedInvalid: number;
}

/** The ledger's word for a purchase. Compared case-insensitively — the importer
 *  takes the broker's own spelling, which is not consistently cased. */
function isBuy(action: string): boolean {
  return action.trim().toUpperCase() === "BUY";
}

/** An ISO instant down to its calendar date. The lot maths is date-only. */
function toIsoDate(transactionAt: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(transactionAt.trim());
  return match?.[1];
}

/**
 * Maps a ticker's recorded trades to ad-hoc lots, oldest first.
 *
 * `isSplitAdjusted` is set to **true** for every row, which is the one judgement
 * call here and deserves saying out loud: these figures came from a broker export,
 * and a broker reports a holding in today's shares. Re-applying the split table to
 * them would multiply shares that were never historical — a 2019 NVDA buy would
 * come back as 40× the position actually held. A lot typed off a paper confirmation
 * is the opposite case, which is why the form's own default is false; the ad-hoc
 * screen leaves the flag editable so a mis-seeded row can be corrected there.
 */
export function lotsFromTrades(trades: RecordedTrade[]): LotsFromTradesResult {
  let skippedSells = 0;
  let skippedInvalid = 0;
  const lots: AdhocLotInput[] = [];

  for (const trade of trades) {
    if (!isBuy(trade.action)) {
      skippedSells += 1;
      continue;
    }
    const buyDate = toIsoDate(trade.transactionAt);
    // A zero-share buy is not a purchase, and a row with no parseable date has no
    // holding period — both would render as a lot that quietly contributes nothing.
    if (!buyDate || trade.numberOfShares <= 0) {
      skippedInvalid += 1;
      continue;
    }

    lots.push({
      buyDate,
      shares: trade.numberOfShares,
      pricePerShare: trade.pricePerShareCents / 100,
      isSplitAdjusted: true,
      brokerageFirm: trade.brokerageFirm,
      note: trade.note,
    });
  }

  // Oldest first, matching the order the analyzer and a tax-lot statement both use.
  lots.sort((left, right) => left.buyDate.localeCompare(right.buyDate));
  return { lots, skippedSells, skippedInvalid };
}
