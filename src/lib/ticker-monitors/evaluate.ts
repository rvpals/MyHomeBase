import { centsToDollars, formatCents } from "@/lib/shared/money";
import {
  needsCostBasis,
  type MonitorEvaluation,
  type TickerMonitor,
  type TickerValuation,
} from "./types";

/**
 * Deciding whether a monitor is "near" its target.
 *
 * Pure functions over numbers — no repository, no clock, no I/O. This is where
 * the real test coverage lives, because it is where the actual rule is: the rest
 * of this module is storage and plumbing.
 */

/**
 * How wide the band is, in cents, for a given monitor and position.
 *
 * Normally a percentage of the target: 5% of $10,000 is $500, so anything from
 * $9,500 to $10,500 counts as near. That scales, which is why the band is a
 * percentage rather than a dollar tolerance — the same 5% reads correctly
 * against a $500 target and a $100,000 one.
 *
 * THE ZERO-TARGET CASE. "Unrealized loss near $0" is the most useful monitor of
 * the three — the bad one has nearly recovered — and 5% of $0 is $0, so a band
 * off the target would make the one monitor you most want the one that can
 * never fire. For a zero target the band is taken against the **cost basis**
 * instead: within 5% of what you paid of breaking even. That is the figure the
 * question is really relative to.
 */
export function bandCents(monitor: TickerMonitor, valuation: TickerValuation): number {
  const targetCents = Math.abs(monitor.targetCents);
  const basis = targetCents > 0 ? targetCents : Math.abs(valuation.costCents);
  return (basis * monitor.bandPct) / 100;
}

/** Is `value` within `band` of `target`? The shared "near" test. */
export function isWithinBand(valueCents: number, targetCents: number, band: number): boolean {
  return Math.abs(valueCents - targetCents) <= band;
}

/**
 * What a monitor is comparing, resolved to two cents figures.
 *
 * Every type reduces to "is this number near that number", which is what keeps
 * the three cases from each growing their own arithmetic. Returns `undefined`
 * when the monitor cannot be judged at all — see `evaluateMonitor`.
 */
function resolveComparison(
  monitor: TickerMonitor,
  valuation: TickerValuation,
): { valueCents: number; targetCents: number } | undefined {
  switch (monitor.monitorType) {
    case "gain_near_amount":
      // A loss is not an "almost gain": with the gain at -$8,000 and a $2,000
      // target the raw distance is $10,000, but reporting on it at all would be
      // answering a question nobody asked. Only a gain can approach a gain.
      return { valueCents: valuation.unrealizedGainLossCents, targetCents: monitor.targetCents };

    case "loss_near_amount":
      // Stored positive ("a $2,000 loss"), compared negative — the domain figure
      // is signed. This is why the schema refuses a negative target: one
      // condition would otherwise have two spellings.
      return {
        valueCents: valuation.unrealizedGainLossCents,
        targetCents: -Math.abs(monitor.targetCents),
      };

    case "gain_near_pct_of_cost": {
      // Expressed in cents rather than comparing percentages, so the band works
      // the same way it does for the amount types. 20% of a $50,000 basis is a
      // $10,000 target, and from there it is the same comparison.
      if (valuation.costCents <= 0) return undefined;
      return {
        valueCents: valuation.unrealizedGainLossCents,
        targetCents: Math.round((valuation.costCents * monitor.targetPct) / 100),
      };
    }

    case "price_near_amount":
      // The one new type that is still a band comparison, so it drops straight
      // into the same machinery: price per share against a target price. A
      // price of 0 is "unknown" rather than free, same convention as cost.
      if (valuation.pricePerShareCents <= 0) return undefined;
      return {
        valueCents: valuation.pricePerShareCents,
        targetCents: monitor.targetCents,
      };

    case "day_move_pct":
      // Not a band comparison at all — a threshold on a percentage, judged in
      // `evaluateMonitor`. Returning undefined here would read as "cannot be
      // judged", so this case must never reach `resolveComparison`; the
      // evaluator branches before calling it.
      return undefined;
  }
}

/**
 * Is a day-move monitor's threshold met?
 *
 * Separate from the band path because it is a different question: "has it moved
 * at least this far", not "is it near this number". `targetPct` is positive and
 * `direction` carries the sign (0148), so an 'up' monitor wants a move at or
 * above +X and a 'down' one a move at or below -X.
 *
 * `undefined` when there is no baseline to measure against — not false, because
 * "cannot be judged" and "judged and quiet" differ: the first must not clear a
 * latch that a real move set.
 */
function isDayMoveMet(
  monitor: TickerMonitor,
  valuation: TickerValuation,
): boolean | undefined {
  if (valuation.dayChangePct === undefined) return undefined;
  const threshold = Math.abs(monitor.targetPct);
  // A 0% threshold would be met by every quiet day, which is the inert-monitor
  // failure in reverse — permanently true says as little as never true. The
  // schema refuses it; this is the evaluator refusing to guess.
  if (threshold <= 0) return undefined;
  return monitor.direction === "down"
    ? valuation.dayChangePct <= -threshold
    : valuation.dayChangePct >= threshold;
}

/** The sentence filed in the queue and shown in the warning modal. */
export function describeMonitor(
  monitor: TickerMonitor,
  valuation: TickerValuation,
): string {
  const gain = valuation.unrealizedGainLossCents;
  const actual = formatCents(Math.abs(gain));

  switch (monitor.monitorType) {
    case "gain_near_amount":
      return `${valuation.ticker} unrealized gain is ${actual}, approaching your ${formatCents(monitor.targetCents)} target.`;

    case "loss_near_amount": {
      const target = Math.abs(monitor.targetCents);
      // Break-even reads as its own sentence. "Approaching your $0.00 loss
      // target" is technically right and says nothing about what happened.
      if (target === 0) {
        return gain >= 0
          ? `${valuation.ticker} has recovered to break even — unrealized gain is ${actual}.`
          : `${valuation.ticker} is close to breaking even — unrealized loss is down to ${actual}.`;
      }
      return `${valuation.ticker} unrealized loss is ${actual}, approaching your ${formatCents(target)} limit.`;
    }

    case "gain_near_pct_of_cost": {
      const pct = valuation.costCents > 0 ? (gain / valuation.costCents) * 100 : 0;
      return `${valuation.ticker} unrealized gain is ${actual} — ${pct.toFixed(1)}% of a ${formatCents(valuation.costCents)} cost basis, approaching your ${monitor.targetPct}% target.`;
    }

    case "price_near_amount":
      // Reports the price, not the gain: this type never consulted the basis,
      // so a sentence about unrealized gain would answer a different question.
      return `${valuation.ticker} is trading at ${formatCents(valuation.pricePerShareCents)}, near your ${formatCents(monitor.targetCents)} target.`;

    case "day_move_pct": {
      const move = valuation.dayChangePct ?? 0;
      const wayText = move < 0 ? "down" : "up";
      const baseline =
        valuation.previousClosePerShareCents !== undefined
          ? ` from a ${formatCents(valuation.previousClosePerShareCents)} previous close`
          : "";
      return `${valuation.ticker} is ${wayText} ${Math.abs(move).toFixed(2)}% today at ${formatCents(valuation.pricePerShareCents)}${baseline} — past your ${monitor.targetPct}% ${monitor.direction || "up"} threshold.`;
    }
  }
}

/**
 * Judge one monitor against one ticker's current figures.
 *
 * `isNear` is "true right now" — what the warning icon renders from.
 * `shouldNotify` is "true and not already reported", which is the only thing
 * that files a message. Keeping them apart is what lets the icon show for as
 * long as the condition holds while the queue gets exactly one entry per
 * crossing (see migrations/0110, "The fire-once latch").
 */
export function evaluateMonitor(
  monitor: TickerMonitor,
  valuation: TickerValuation,
): MonitorEvaluation {
  const quiet: MonitorEvaluation = {
    monitorId: monitor.id,
    isNear: false,
    shouldNotify: false,
    message: "",
  };

  // A disabled monitor is off, not merely silent: its icon goes too.
  if (!monitor.isEnabled) return quiet;

  // No cost basis means no unrealized gain to speak of — `costCents` of 0 is
  // "unknown", not "free" (see StockPosition), and the gain/loss monitors are
  // measured against money actually put in. Firing one here would report a gain
  // equal to the whole market value.
  //
  // Per-type since 0148: a price target and a day move are facts about the
  // security, true of a holding with no imported transactions. Guarding those
  // too would accept a price monitor on a watch-list position and then never
  // fire it — an inert alert, the failure mode the schema warns about.
  if (needsCostBasis(monitor.monitorType) && valuation.costCents <= 0) return quiet;

  // The threshold type, judged before the band machinery: "has it moved this
  // far" is not "is it near this number", and `resolveComparison` has no
  // meaningful pair of cents figures to answer it with.
  if (monitor.monitorType === "day_move_pct") {
    const isMet = isDayMoveMet(monitor, valuation);
    // `undefined` is "cannot be judged" — no baseline, or no threshold set —
    // and is treated the same as "not met": quiet.
    //
    // Note this DOES clear the latch, because `runMonitors` re-arms on
    // `!isNear`. That is the right outcome rather than a missing distinction: a
    // monitor whose baseline has gone is not sitting inside a condition any
    // more, and re-arming means the next genuine move reports instead of being
    // swallowed. The cost is one extra message if the baseline disappears and
    // comes back while the move still qualifies, which is strictly better than
    // a silent alert.
    if (isMet !== true) return quiet;
    return {
      monitorId: monitor.id,
      isNear: true,
      shouldNotify: !monitor.isTriggered,
      message: describeMonitor(monitor, valuation),
    };
  }

  const comparison = resolveComparison(monitor, valuation);
  if (!comparison) return quiet;

  // Only a gain can approach a gain target, and only a loss a loss target.
  // Without this a position deep in the red "approaches" every gain target it
  // passes on the way back up from the wrong side.
  const gain = valuation.unrealizedGainLossCents;
  if (monitor.monitorType === "gain_near_amount" && gain < 0) return quiet;

  const isNear = isWithinBand(
    comparison.valueCents,
    comparison.targetCents,
    bandCents(monitor, valuation),
  );
  if (!isNear) return quiet;

  return {
    monitorId: monitor.id,
    isNear: true,
    // The latch. True on the way in, false while it stays in.
    shouldNotify: !monitor.isTriggered,
    message: describeMonitor(monitor, valuation),
  };
}

/**
 * A short label for the monitor as configured — what the setup screen lists and
 * what the ticker's Monitor button is titled with.
 *
 * Deliberately separate from `describeMonitor`, which reports what *happened*.
 * This one says what is being watched, and holds no live figures.
 */
export function summarizeMonitor(monitor: TickerMonitor): string {
  switch (monitor.monitorType) {
    case "gain_near_amount":
      return `Unrealized gain near ${formatCents(monitor.targetCents)}`;
    case "loss_near_amount":
      return Math.abs(monitor.targetCents) === 0
        ? "Unrealized loss near break-even"
        : `Unrealized loss near ${formatCents(Math.abs(monitor.targetCents))}`;
    case "gain_near_pct_of_cost":
      return `Unrealized gain near ${monitor.targetPct}% of cost basis`;
    case "price_near_amount":
      return `Price per share near ${formatCents(monitor.targetCents)}`;
    case "day_move_pct":
      // Says "or more" because this one is a threshold, so the label does not
      // read as the band the other four carry.
      return `Price ${monitor.direction || "up"} ${monitor.targetPct}% or more in a day`;
  }
}

/**
 * Sums one ticker's holdings into the shape the evaluator takes.
 *
 * A ticker can be held in several accounts (`PositionKey` is
 * `(accountId, ticker)`), and a monitor is about the symbol rather than about
 * one account's slice of it — "my NVDA gain" means all of it.
 *
 * Positions with no known basis contribute their gain but no cost, matching
 * `computePortfolioSummary`: a partial basis must not be divided into a whole
 * gain. Takes the minimal shape rather than `StockPosition` so nothing here
 * depends on the positions module's wider surface.
 */
export function valuationFromHoldings(
  ticker: string,
  holdings: readonly {
    unrealizedGainLossCents: number;
    costCents: number;
    currentPriceCents?: number;
    quantity?: number;
    dayGainLossCents?: number;
  }[],
): TickerValuation {
  // The accumulator is annotated rather than inferred. Without it, TypeScript builds
  // the accumulator's type from the callback's RETURN type, where `quantity` and
  // `dayGainLossCents` are read off an optional field — so both widen to
  // `number | undefined` even though the seed is 0 and `+` can never produce
  // undefined. That is what made `totals.quantity` "possibly undefined" below.
  const totals = holdings.reduce<{
    unrealizedGainLossCents: number;
    costCents: number;
    quantity: number;
    dayGainLossCents: number;
  }>(
    (total, holding) => ({
      unrealizedGainLossCents:
        total.unrealizedGainLossCents + (holding.costCents > 0 ? holding.unrealizedGainLossCents : 0),
      costCents: total.costCents + Math.max(0, holding.costCents),
      // Summed across accounts so the previous close is derived from the same
      // breadth of holdings as the move itself — one account's slice would give
      // the right percentage only by coincidence.
      quantity: total.quantity + Math.max(0, holding.quantity ?? 0),
      dayGainLossCents: total.dayGainLossCents + (holding.dayGainLossCents ?? 0),
    }),
    { unrealizedGainLossCents: 0, costCents: 0, quantity: 0, dayGainLossCents: 0 },
  );

  // PRICE IS NOT SUMMED. Two accounts holding NVDA hold it at one price; adding
  // them would double it. The first holding that states a price wins, which is
  // also why a stale 0 in one account cannot mask a real price in another.
  const pricePerShareCents =
    holdings.find((holding) => (holding.currentPriceCents ?? 0) > 0)?.currentPriceCents ?? 0;

  // The previous close, recovered rather than stored — see TickerValuation.
  // Needs shares to divide by and a price to subtract from; without either
  // there is no baseline, and `undefined` says so rather than a 0 that would
  // read as "closed at nothing" and make every move look like +infinity.
  const hasBaseline = totals.quantity > 0 && pricePerShareCents > 0;
  const previousClosePerShareCents = hasBaseline
    ? pricePerShareCents - totals.dayGainLossCents / totals.quantity
    : undefined;

  // A previous close at or below 0 is not a baseline either: it means the stored
  // day gain disagrees with the stored price (a half-applied refresh, or an
  // imported row whose day figure came from elsewhere). Dividing by it would
  // manufacture a vast percentage from bad data.
  const dayChangePct =
    previousClosePerShareCents !== undefined && previousClosePerShareCents > 0
      ? ((pricePerShareCents - previousClosePerShareCents) / previousClosePerShareCents) * 100
      : undefined;

  return {
    ticker,
    unrealizedGainLossCents: totals.unrealizedGainLossCents,
    costCents: totals.costCents,
    pricePerShareCents,
    previousClosePerShareCents:
      dayChangePct === undefined ? undefined : previousClosePerShareCents,
    dayChangePct,
  };
}

/** Exported for the setup screen's preview line. */
export function bandRangeDollars(
  monitor: TickerMonitor,
  valuation: TickerValuation,
): { lowDollars: number; highDollars: number } | undefined {
  const comparison = resolveComparison(monitor, valuation);
  if (!comparison) return undefined;
  const band = bandCents(monitor, valuation);
  return {
    lowDollars: centsToDollars(comparison.targetCents - band),
    highDollars: centsToDollars(comparison.targetCents + band),
  };
}
