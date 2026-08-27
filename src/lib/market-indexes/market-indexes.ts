// Loading the index board: fetch every catalogued symbol at once, turn each
// quote into a level plus a day move, and bucket the results into groups.
//
// The arithmetic (`computeIndexQuote`, `groupQuotes`) is pure and tested without
// a network. `loadIndexBoard` is the only part that fetches.

import { lookupQuote, type MarketDataClient, type Quote } from "@/lib/market-data";
import {
  findMarketIndex,
  INDEX_GROUPS,
  INDEX_GROUP_LABELS,
  MARKET_INDEXES,
} from "./catalogue";
import { indexBoardSchema, type IndexBoardInput } from "./schema";
import type {
  IndexBoard,
  IndexFailure,
  IndexGroupBoard,
  IndexQuote,
  MarketIndex,
} from "./types";

/**
 * One quote into one row.
 *
 * The percent guard matters more here than on a stock: `^VIX` and the futures
 * symbols occasionally come back with no prior close at all, and dividing by it
 * would put `Infinity`/`NaN` on screen. A missing close is reported as a flat
 * day rather than a broken one — the level is still true, only the move is
 * unknown, and `previousCloseCents: 0` is how the view can tell.
 */
export function computeIndexQuote(index: MarketIndex, quote: Quote): IndexQuote {
  const valueCents = quote.priceCents;
  const previousCloseCents = quote.previousCloseCents;
  const changeCents = previousCloseCents === 0 ? 0 : valueCents - previousCloseCents;
  const changePct =
    previousCloseCents === 0 ? 0 : (changeCents / previousCloseCents) * 100;

  return {
    symbol: index.symbol,
    label: index.label,
    group: index.group,
    unit: index.unit,
    valueCents,
    previousCloseCents,
    changeCents,
    changePct,
  };
}

/**
 * Rows into the groups the card draws, in catalogue order.
 *
 * An empty group is dropped rather than rendered as a heading over nothing —
 * which is what happens when a filtered run asks for equity symbols only, or
 * when every commodity symbol failed.
 */
export function groupQuotes(quotes: IndexQuote[]): IndexGroupBoard[] {
  return INDEX_GROUPS.map((group) => ({
    group,
    label: INDEX_GROUP_LABELS[group],
    quotes: quotes.filter((quote) => quote.group === group),
  })).filter((board) => board.quotes.length > 0);
}

/**
 * Fetch the board.
 *
 * Every symbol is fetched in parallel and **failures are collected, not thrown**:
 * eleven unauthenticated calls to a provider with no SLA will occasionally lose
 * one, and a single dead symbol must not blank a card that got the other ten.
 * The caller decides how loudly to report `failures`.
 *
 * Order follows the catalogue, not completion order, so the card doesn't reshuffle
 * itself between refreshes.
 */
export async function loadIndexBoard(
  client: MarketDataClient,
  input: IndexBoardInput = {},
): Promise<IndexBoard> {
  const { symbols } = indexBoardSchema.parse(input);

  const requested: MarketIndex[] = symbols
    ? // Non-null: the schema's enum already rejected anything not in the
      // catalogue, and the test above pins the enum to the catalogue's contents.
      symbols.map((symbol) => findMarketIndex(symbol)!)
    : [...MARKET_INDEXES];

  // An explicit tag rather than two differently-shaped objects: TypeScript unions
  // the branches into one type with both properties optional, so `"quote" in
  // outcome` reads as a narrowing but isn't one — and `outcome.quote` stays
  // `Quote | undefined` right into the arithmetic.
  type Outcome =
    | { ok: true; index: MarketIndex; quote: Awaited<ReturnType<typeof lookupQuote>> }
    | { ok: false; index: MarketIndex; reason: string };

  const settled = await Promise.all(
    requested.map(async (index): Promise<Outcome> => {
      try {
        return { ok: true, index, quote: await lookupQuote(client, index.symbol) };
      } catch (error) {
        return {
          ok: false,
          index,
          reason: error instanceof Error ? error.message : "Quote lookup failed.",
        };
      }
    }),
  );

  const quotes: IndexQuote[] = [];
  const failures: IndexFailure[] = [];

  for (const outcome of settled) {
    if (outcome.ok) {
      quotes.push(computeIndexQuote(outcome.index, outcome.quote));
    } else {
      failures.push({
        symbol: outcome.index.symbol,
        label: outcome.index.label,
        reason: outcome.reason,
      });
    }
  }

  return { fetchedAt: new Date().toISOString(), groups: groupQuotes(quotes), failures };
}
