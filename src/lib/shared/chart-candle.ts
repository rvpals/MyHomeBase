// The rules behind a candlestick, kept out of the component so they can be tested.
//
// A candle is more decision than drawing: which bars are complete enough to draw,
// which way each one closed, how wide a body may be before it swallows its
// neighbour, and what vertical window the whole set needs. The component owns the
// SVG; this owns those answers.
//
// Cents in, cents out — no dollar conversion here. The component converts once at
// the edge, the same way `ChartLine`'s callers do.

/** Which way a bar closed against its open. */
export type CandleDirection = "up" | "down" | "flat";

/** A bar with every field a candle needs. Cents, like everything upstream. */
export interface CandleBar {
  /** Category value for the x-axis — a "YYYY-MM-DD" date for a daily series. */
  x: string;
  openCents: number;
  highCents: number;
  lowCents: number;
  closeCents: number;
}

/**
 * A bar as the chart draws it: the input plus what was derived from it.
 *
 * `highCents`/`lowCents` are re-derived rather than trusted, because a provider
 * that reports a high below its own close has given us a bar that can't be drawn
 * as stated — see `normalizeCandleBar`.
 */
export interface ResolvedCandleBar extends CandleBar {
  direction: CandleDirection;
  /** Signed move over the bar, close less open. */
  changeCents: number;
}

/** A point that may or may not carry a full bar. Structural, so any series fits. */
export interface MaybeCandlePoint {
  closeCents: number;
  openCents?: number;
  highCents?: number;
  lowCents?: number;
}

/**
 * True when every point carries a full bar, so a candlestick is honest to offer.
 *
 * All-or-nothing on purpose: a chart that silently skipped the third of its bars
 * the provider shorted would read as a gap in trading rather than a gap in the
 * data. An empty series is *not* chartable — there is nothing to draw, and
 * offering the toggle would hand the reader a blank panel.
 */
export function hasFullBars(points: readonly MaybeCandlePoint[]): boolean {
  return points.length > 0 && points.every(isFullBar);
}

function isFullBar(point: MaybeCandlePoint): boolean {
  return (
    isPositiveFinite(point.openCents) &&
    isPositiveFinite(point.highCents) &&
    isPositiveFinite(point.lowCents) &&
    isPositiveFinite(point.closeCents)
  );
}

function isPositiveFinite(value: number | undefined): value is number {
  // Non-positive is the provider's "no print", the same reading `toClosePoints`
  // takes of a close of zero.
  return value != null && Number.isFinite(value) && value > 0;
}

/**
 * A drawable bar, with the extremes made consistent.
 *
 * The high is widened to whatever the bar actually reached and the low likewise,
 * rather than trusting the provider's two fields. Yahoo does occasionally report a
 * high fractionally below the close on thin volume, and an un-clamped wick then
 * draws *inside* the body — a candle that appears to have traded above its own
 * high. Taking the max of all four is the only reading that can't contradict
 * itself, and for well-formed data it's a no-op.
 */
export function normalizeCandleBar(bar: CandleBar): ResolvedCandleBar {
  const highCents = Math.max(bar.highCents, bar.openCents, bar.closeCents);
  const lowCents = Math.min(bar.lowCents, bar.openCents, bar.closeCents);
  const changeCents = bar.closeCents - bar.openCents;

  return {
    ...bar,
    highCents,
    lowCents,
    changeCents,
    direction: changeCents > 0 ? "up" : changeCents < 0 ? "down" : "flat",
  };
}

/**
 * The vertical window a candle set needs, in cents, padded.
 *
 * Spans the wicks, not the closes — a candlestick whose axis was fitted to closes
 * would clip the very extremes the chart exists to show. The padding keeps the
 * tallest wick off the frame; a flat series (every bar identical) would otherwise
 * give a zero-height domain that Recharts can't scale, so it gets a nominal band
 * around the single value.
 */
export function candleDomain(
  bars: readonly ResolvedCandleBar[],
  paddingRatio = 0.05,
): [number, number] {
  if (bars.length === 0) return [0, 1];

  let low = bars[0].lowCents;
  let high = bars[0].highCents;
  for (const bar of bars) {
    if (bar.lowCents < low) low = bar.lowCents;
    if (bar.highCents > high) high = bar.highCents;
  }

  const span = high - low;
  // A flat series pads off the price itself — 5% of zero is zero, which would
  // collapse the axis.
  const padding = span === 0 ? Math.max(Math.abs(high) * paddingRatio, 1) : span * paddingRatio;

  return [low - padding, high + padding];
}

/**
 * How wide a candle body may be, given the room each bar has.
 *
 * Recharts hands a custom shape the full category slot; a body filling it leaves
 * no gap and the series reads as a solid block. `CANDLE_BODY_RATIO` of the slot
 * keeps the gap that makes bars countable.
 */
export const CANDLE_BODY_RATIO = 0.6;

/**
 * Below this many pixels a body is too thin to read as a rectangle, and the bar
 * is drawn as its wick alone — the OHLC-bar treatment.
 *
 * Not a style preference: a 1px body and a 1px wick are the same mark, so at that
 * density the body is noise. Five years of daily bars on a phone lands here, which
 * is why this exists rather than a viewport check — it's available width per bar
 * that decides, not screen size.
 */
export const MIN_BODY_WIDTH = 3;

/** Geometry for one candle, in SVG user units. */
export interface CandleGeometry {
  /** Left edge of the body. */
  bodyX: number;
  bodyWidth: number;
  /** Top of the body, and its height — always >= `minBodyHeight`. */
  bodyY: number;
  bodyHeight: number;
  /** The wick, centred on the slot. */
  wickX: number;
  wickTop: number;
  wickBottom: number;
  /** False when the slot is too narrow for a body; draw the wick alone. */
  showBody: boolean;
}

/**
 * Turns a bar and its slot into the geometry that draws it.
 *
 * `toY` maps cents to a vertical pixel — the caller passes the axis' own scale, so
 * this stays free of Recharts. A doji (open equal to close) would otherwise be a
 * zero-height rectangle and vanish, so the body floors at `minBodyHeight`: the
 * bar traded, and a candle that disappears reads as missing data.
 */
export function candleGeometry(
  bar: ResolvedCandleBar,
  slot: { x: number; width: number },
  toY: (cents: number) => number,
  minBodyHeight = 1,
): CandleGeometry {
  const bodyWidth = Math.max(slot.width * CANDLE_BODY_RATIO, 1);
  const wickX = slot.x + slot.width / 2;

  const openY = toY(bar.openCents);
  const closeY = toY(bar.closeCents);
  const bodyTop = Math.min(openY, closeY);
  const bodyHeight = Math.max(Math.abs(closeY - openY), minBodyHeight);

  return {
    bodyX: wickX - bodyWidth / 2,
    bodyWidth,
    bodyY: bodyTop,
    bodyHeight,
    wickX,
    wickTop: toY(bar.highCents),
    wickBottom: toY(bar.lowCents),
    showBody: bodyWidth >= MIN_BODY_WIDTH,
  };
}
