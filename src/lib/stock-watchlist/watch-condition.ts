import type { MarketEvent } from "@/lib/market-data";
import { formatCents } from "@/lib/shared/money";
import type { StockWatchListItem, WatchEvaluation } from "./types";

/**
 * Deciding whether a watch-list row's condition holds.
 *
 * Pure functions over plain data — no repository, no clock, no network. This is
 * where the real test coverage lives, because it is where the actual rule is:
 * the rest of this module is storage and plumbing. Same split as
 * `@/lib/ticker-monitors/evaluate.ts`.
 */

/**
 * How close to a `price` target counts as reaching it, as a percent.
 *
 * A price lands exactly on a round number about never, so a target that needed
 * $100.00 to the cent would be a watch that silently never fires — the worst
 * failure mode for an alert. Half a percent of $100 is 50¢, which is tight
 * enough to mean "it got there" and loose enough to actually catch it.
 *
 * Fixed rather than per row, unlike `inv_ticker_monitors.band_pct`: that band
 * is the *substance* of a monitor ("near $10,000" is the question), whereas
 * this one is a tolerance on a question that is already exact. Making it a
 * field would ask the reader to configure something they did not ask about.
 */
export const PRICE_TARGET_BAND_PCT = 0.5;

/** A quiet verdict — the condition does not hold and nothing is filed. */
function quiet(itemId: number): WatchEvaluation {
  return { itemId, isActive: false, shouldNotify: false, message: "" };
}

/** Epoch seconds to the "YYYY-MM-DD" the rest of the module stores dates as. */
export function eventDateIso(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

/**
 * How far the price has moved since the row was added, as cents and as a
 * percentage of the price when added.
 *
 * Signed — negative is a fall. Returns `undefined` when there is no baseline to
 * measure against: a row whose quote failed when it was added has
 * `priceWhenAddedCents` of 0, and treating that as the baseline would report
 * every price as an infinite gain.
 */
export function priceSwing(
  item: StockWatchListItem,
  priceCents: number,
): { deltaCents: number; deltaPct: number } | undefined {
  if (item.priceWhenAddedCents <= 0) return undefined;
  const deltaCents = priceCents - item.priceWhenAddedCents;
  return {
    deltaCents,
    deltaPct: (deltaCents / item.priceWhenAddedCents) * 100,
  };
}

/** "gained" or "lost", for a sentence about a signed move. */
function direction(delta: number): string {
  return delta >= 0 ? "gained" : "lost";
}

/**
 * Judge one row's price-based watch against a live price.
 *
 * Handles the four continuous kinds — `price`, `price_range`, `gain_loss_pct`
 * and `gain_loss_price`. The two event kinds are `evaluateEventWatch`'s job,
 * because they are judged against a dated fact rather than against a number.
 *
 * `isActive` is "true right now" — what the marker beside the row renders from.
 * `shouldNotify` is "true and not already reported", which is the only thing
 * that files a message. Keeping them apart is what lets the marker show for as
 * long as the condition holds while the queue gets exactly one entry per
 * crossing (migrations/0111, "The fire-once latch").
 */
export function evaluatePriceWatch(
  item: StockWatchListItem,
  priceCents: number,
): WatchEvaluation {
  const kind = item.watchKind;

  // Not watching, or watching for something this function does not judge.
  if (kind === "" || kind === "dividend" || kind === "split") return quiet(item.id);

  const active = (message: string): WatchEvaluation => ({
    itemId: item.id,
    isActive: true,
    // The latch. True on the way in, false while it stays in.
    shouldNotify: !item.watchIsTriggered,
    message,
  });

  switch (kind) {
    case "price": {
      const target = Math.round(item.watchValue);
      if (target <= 0) return quiet(item.id);

      // "Hits $100" fires from either direction — a watch list holds tickers
      // you are waiting on, and waiting for a fall is as common as waiting for
      // a rise.
      //
      // WHICH SIDE IT STARTED ON IS NOT STORED, and that is what decides the
      // rule here. Without a previous price there is no way to detect a
      // crossing, so "hits" cannot mean "passed through the target since last
      // time" — it has to be a statement about where the price is *now*.
      //
      // So: the price is within `PRICE_TARGET_BAND_PCT` of the target. A band
      // rather than exact equality because a price lands exactly on a round
      // number about never, and a watch that needs $100.00 to the cent is one
      // that silently never fires. The latch turns "is near" into one message
      // per approach, and leaving the band re-arms it — so a stock oscillating
      // around $100 reports each visit, which is the useful behaviour.
      const band = (target * PRICE_TARGET_BAND_PCT) / 100;
      if (Math.abs(priceCents - target) > band) return quiet(item.id);

      return active(
        `${item.ticker} is at ${formatCents(priceCents)}, reaching your ${formatCents(target)} target.`,
      );
    }

    case "price_range": {
      const low = Math.round(item.watchValue);
      const high = Math.round(item.watchValueHigh);
      if (low <= 0 || high <= low) return quiet(item.id);
      if (priceCents < low || priceCents > high) return quiet(item.id);

      return active(
        `${item.ticker} is at ${formatCents(priceCents)}, inside your ${formatCents(low)}–${formatCents(high)} range.`,
      );
    }

    case "gain_loss_pct": {
      const threshold = item.watchValue;
      if (threshold <= 0) return quiet(item.id);

      const swing = priceSwing(item, priceCents);
      if (!swing) return quiet(item.id);

      // Symmetric: ±20% fires on the way up and on the way down, which is what
      // "gain or loss" asks for.
      if (Math.abs(swing.deltaPct) < threshold) return quiet(item.id);

      return active(
        `${item.ticker} has ${direction(swing.deltaCents)} ${Math.abs(swing.deltaPct).toFixed(1)}% since you added it at ${formatCents(item.priceWhenAddedCents)} — now ${formatCents(priceCents)}.`,
      );
    }

    case "gain_loss_price": {
      const threshold = Math.round(item.watchValue);
      if (threshold <= 0) return quiet(item.id);

      const swing = priceSwing(item, priceCents);
      if (!swing) return quiet(item.id);

      if (Math.abs(swing.deltaCents) < threshold) return quiet(item.id);

      return active(
        `${item.ticker} has ${direction(swing.deltaCents)} ${formatCents(Math.abs(swing.deltaCents))} per share since you added it at ${formatCents(item.priceWhenAddedCents)} — now ${formatCents(priceCents)}.`,
      );
    }
  }
}

/**
 * Judge one row's event watch against the ticker's recent corporate actions.
 *
 * Dividends and splits are **not continuous** — a dividend is a dated fact that
 * stays true forever, so "has this paid a dividend" would fire once and never
 * re-arm, swallowing next quarter's. So these two kinds latch on the event's
 * date instead of on a band: `watchLastTriggeredAt` doubles as a cursor, and
 * the row fires for the newest event dated after both it and `addedDate`.
 *
 * `addedDate` is the floor, which is what stops adding a row to a watch list
 * from immediately announcing last quarter's dividend as though it were news.
 */
export function evaluateEventWatch(
  item: StockWatchListItem,
  events: readonly MarketEvent[],
): WatchEvaluation {
  const kind = item.watchKind;
  if (kind !== "dividend" && kind !== "split") return quiet(item.id);

  // String comparison is correct for "YYYY-MM-DD" and avoids a timezone round
  // trip, which is the same reason the journal module compares dates this way.
  const floor =
    item.watchLastTriggeredAt && item.watchLastTriggeredAt > item.addedDate
      ? item.watchLastTriggeredAt
      : item.addedDate;

  const fresh = events
    .filter((event) => event.kind === kind)
    .map((event) => ({ event, date: eventDateIso(event.timestamp) }))
    .filter((entry) => entry.date > floor)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const newest = fresh[0];
  if (!newest) return quiet(item.id);

  const message =
    kind === "dividend"
      ? `${item.ticker} issued a dividend on ${newest.date}${
          newest.event.amountCents != null
            ? ` of ${formatCents(newest.event.amountCents)} per share`
            : ""
        }.`
      : `${item.ticker} split on ${newest.date}${
          newest.event.ratio ? ` — ${newest.event.ratio}` : ""
        }.`;

  return {
    itemId: item.id,
    isActive: true,
    // Unlike the price kinds, this does not consult `watchIsTriggered`: the
    // cursor above has already established that this event is one we have not
    // reported. A latch on top would suppress the second dividend.
    shouldNotify: true,
    message,
    eventDate: newest.date,
  };
}

/**
 * A short label for the watch as configured — what the row's "Watching" column
 * shows and what the edit form is titled with.
 *
 * Deliberately separate from the evaluators, which report what *happened*. This
 * one says what is being watched and holds no live figures.
 */
export function summarizeWatch(item: {
  watchKind: StockWatchListItem["watchKind"];
  watchValue: number;
  watchValueHigh: number;
}): string {
  switch (item.watchKind) {
    case "":
      return "—";
    case "price":
      return `Price hits ${formatCents(Math.round(item.watchValue))}`;
    case "price_range":
      return `Price within ${formatCents(Math.round(item.watchValue))}–${formatCents(Math.round(item.watchValueHigh))}`;
    case "dividend":
      return "Dividend issued";
    case "split":
      return "Split happens";
    case "gain_loss_pct":
      return `Gain/loss of ${item.watchValue}%`;
    case "gain_loss_price":
      return `Gain/loss of ${formatCents(Math.round(item.watchValue))} per share`;
  }
}
