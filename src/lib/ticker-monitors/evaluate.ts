import { centsToDollars, formatCents } from "@/lib/shared/money";
import type { MonitorEvaluation, TickerMonitor, TickerValuation } from "./types";

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
  }
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
  // "unknown", not "free" (see StockPosition), and every one of these monitors
  // is measured against money actually put in. Firing here would report a gain
  // equal to the whole market value.
  if (valuation.costCents <= 0) return quiet;

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
  holdings: readonly { unrealizedGainLossCents: number; costCents: number }[],
): TickerValuation {
  return holdings.reduce<TickerValuation>(
    (total, holding) => ({
      ticker: total.ticker,
      unrealizedGainLossCents:
        total.unrealizedGainLossCents + (holding.costCents > 0 ? holding.unrealizedGainLossCents : 0),
      costCents: total.costCents + Math.max(0, holding.costCents),
    }),
    { ticker, unrealizedGainLossCents: 0, costCents: 0 },
  );
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
