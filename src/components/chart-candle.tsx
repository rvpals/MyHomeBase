"use client";

// Candlestick / OHLC chart. Four prices per period — open, high, low, close —
// drawn as a body from open to close with a wick spanning the day's range.
//
// Recharts has no candle mark, so this is a `Bar` whose `shape` draws the candle:
// the bar supplies the category slot and the axis scale, and the shape uses them
// to place body and wick. That's the endorsed Recharts route to a candlestick, and
// it means the tooltip, grid, axes and `ChartToolbar` all behave exactly as they
// do on the other three charts rather than being re-implemented here.
//
// The rules — direction, the clamped extremes, the axis window, when a body is too
// thin to draw — live in `src/lib/shared/chart-candle.ts` so they're testable. This
// file owns the SVG and nothing else.

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_CHROME, CHART_STATUS_COLORS } from "./chart-colors";
import { pointLabelContent } from "./chart-point-labels";
import { ChartToolbar, useChartDisplay } from "./chart-toolbar";
import {
  candleDomain,
  candleGeometry,
  normalizeCandleBar,
  type CandleDirection,
  type ResolvedCandleBar,
} from "@/lib/shared/chart-candle";
import { selectLabeledIndexes, type ChartDisplayDefaults } from "@/lib/shared/chart-options";

/** One period's four prices. Values are in the chart's display unit — see `ChartCandleProps`. */
export interface ChartCandlePoint {
  /** X-axis category — a "YYYY-MM-DD" date for a daily series. */
  x: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ChartCandleProps extends ChartDisplayDefaults {
  /**
   * Periods, oldest first. Every point needs all four prices: a candlestick with
   * gaps reads as a halt in trading rather than a hole in the data, so screen the
   * series with `hasFullBars` before choosing this chart.
   *
   * Values are whatever unit you want on the axis — pass dollars, not cents, the
   * same way `ChartLine`'s callers do.
   */
  data: ChartCandlePoint[];
  /** Formats a y-axis tick, a tooltip price and any point label. */
  formatValue?: (value: number) => string;
  /** Formats an x-axis tick. */
  formatX?: (value: string | number) => string;
  height?: number;
  /** Label under the price in the tooltip and legend. */
  label?: string;
  className?: string;
}

/**
 * Up is hollow and down is filled, on top of being green and red.
 *
 * Colour alone would leave the two indistinguishable for a red-green colour-blind
 * reader and in greyscale, and direction is the whole point of the mark — so fill
 * carries it too. This is the same reasoning as the status colours' "always pair
 * with an icon/label" rule.
 */
const CANDLE_COLOR: Record<CandleDirection, string> = {
  up: CHART_STATUS_COLORS.good,
  down: CHART_STATUS_COLORS.critical,
  // A bar that closed where it opened is neither; the axis colour keeps it quiet.
  flat: CHART_CHROME.mutedText,
};

/** The row the chart plots: the resolved bar plus the two fields Recharts reads. */
interface CandleRow extends ResolvedCandleBar {
  /** Drives the bar's height, and so the y-scale Recharts hands the shape. */
  wick: [number, number];
  /** What the value label prints — the close is the figure a reader wants. */
  close: number;
}

export function ChartCandle({
  data,
  formatValue = (value) => String(value),
  formatX = (value) => String(value),
  height = 280,
  label = "Price",
  pointLabels,
  showDots,
  showLegend,
  showGrid,
  showToolbar = true,
  displayStorageKey,
  className = "",
}: ChartCandleProps) {
  const { display, setDisplay, maxPointLabels } = useChartDisplay(
    {
      pointLabels,
      showDots,
      // One mark type, so there's nothing for a legend to disambiguate by colour;
      // the up/down key below is always on instead.
      showLegend: showLegend ?? false,
      showGrid,
    },
    displayStorageKey,
  );

  // `wick` is a two-element value: Recharts scales a bar between the pair, which
  // makes the plotted rectangle exactly the day's range and gives the custom shape
  // a `y`/`height` already mapped to the axis. The shape then reads its own prices
  // off the payload to place the body inside that span.
  const rows = useMemo<CandleRow[]>(
    () =>
      data.map((point) => {
        const bar = normalizeCandleBar({
          x: point.x,
          openCents: point.open,
          highCents: point.high,
          lowCents: point.low,
          closeCents: point.close,
        });
        return { ...bar, wick: [bar.lowCents, bar.highCents], close: bar.closeCents };
      }),
    [data],
  );

  const domain = useMemo(() => candleDomain(rows), [rows]);

  const labeledIndexes = useMemo(
    () =>
      selectLabeledIndexes(
        rows.map((row) => row.closeCents),
        display.pointLabels,
        maxPointLabels,
      ),
    [rows, display.pointLabels, maxPointLabels],
  );

  return (
    <div className={className}>
      {showToolbar && (
        <ChartToolbar
          className="mb-1"
          value={display}
          onChange={setDisplay}
          // A candle has no point marker to toggle, and one mark type needs no legend.
          canToggleDots={false}
          canToggleLegend={false}
          // "Every point" on a year of daily bars is unreadable, and the shared cap
          // would silently downgrade it anyway. Offer what a candle chart can honour.
          labelModes={["none", "last", "extremes"]}
          pointCount={rows.length}
          maxPointLabels={maxPointLabels}
        />
      )}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={{ top: 14, right: 24, bottom: 0, left: 0 }}
            // The bar fills its category slot so `x`/`width` describe the *slot*,
            // and the gap between candles comes from `CANDLE_BODY_RATIO` alone.
            // With Recharts' default 10% category gap the slot would already be
            // narrowed, the ratio would narrow it again, and bodies would cross
            // `MIN_BODY_WIDTH` sooner than the 3px rule intends.
            barCategoryGap={0}
          >
            {display.showGrid && <CartesianGrid stroke={CHART_CHROME.grid} vertical={false} />}
            <XAxis
              dataKey="x"
              tickFormatter={formatX}
              stroke={CHART_CHROME.axis}
              tick={{ fill: CHART_CHROME.mutedText, fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: CHART_CHROME.axis }}
            />
            <YAxis
              domain={domain}
              tickFormatter={(value: number) => formatValue(value)}
              stroke={CHART_CHROME.axis}
              tick={{ fill: CHART_CHROME.mutedText, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={72}
              allowDataOverflow={false}
            />
            <Tooltip
              content={candleTooltip(formatValue, formatX, label)}
              cursor={{ fill: CHART_CHROME.grid, fillOpacity: 0.4 }}
            />
            {display.showLegend && <Legend />}
            <Bar
              dataKey="wick"
              name={label}
              shape={renderCandle}
              // Recharts holds a mark's labels back until its entry animation ends,
              // which lands the value labels a beat after the candles. The other
              // charts draw without it; this matches.
              isAnimationActive={false}
            >
              {labeledIndexes.length > 0 && (
                <LabelList
                  dataKey="close"
                  content={pointLabelContent({
                    indexes: labeledIndexes,
                    formatValue,
                    placement: "cap",
                    matchField: "x",
                    allowedKeys: labeledIndexes.map((index) => rows[index].x),
                  })}
                />
              )}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <CandleKey />
    </div>
  );
}

/**
 * Draws one candle into the slot Recharts allocated it.
 *
 * Recharts hands a shape the rectangle it would have drawn — `x`/`width` for the
 * category slot, `y`/`height` for the low-to-high span. Those two give the axis
 * scale without reaching for the axis: the payload's own low and high map to the
 * span's bottom and top, so the rest of the prices interpolate linearly between.
 */
function renderCandle(props: unknown) {
  const bar = props as {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    payload?: CandleRow;
  };
  const { x, y, width, height, payload } = bar;
  if (x == null || y == null || width == null || height == null || payload == null) {
    // Recharts wants an element back, not a fragment.
    return <g />;
  }

  const { lowCents, highCents, direction } = payload;
  const span = highCents - lowCents;

  // Cents to pixels, off the rectangle Recharts already scaled. A flat bar has no
  // span to interpolate over, so every price sits at the top of a zero-height box.
  const toY = (cents: number) => (span === 0 ? y : y + ((highCents - cents) / span) * height);

  const geometry = candleGeometry(payload, { x, width }, toY);
  const color = CANDLE_COLOR[direction];

  return (
    <g>
      <line
        x1={geometry.wickX}
        x2={geometry.wickX}
        y1={geometry.wickTop}
        y2={geometry.wickBottom}
        stroke={color}
        strokeWidth={1}
      />
      {geometry.showBody && (
        <rect
          x={geometry.bodyX}
          y={geometry.bodyY}
          width={geometry.bodyWidth}
          height={geometry.bodyHeight}
          stroke={color}
          strokeWidth={1}
          // Hollow for a bar that closed up, so direction survives greyscale and a
          // colour-blind reader. `bg-paper`'s literal — an SVG fill can't take a
          // Tailwind token, and a transparent body would show gridlines through it.
          fill={direction === "up" ? "#ffffff" : color}
        />
      )}
    </g>
  );
}

/**
 * The up/down key.
 *
 * Not the Recharts `Legend`: that keys *series* by colour, and this chart has one
 * series whose marks carry two meanings. Always shown, because a reader who
 * doesn't already know the convention can't infer hollow-is-up from the chart.
 */
function CandleKey() {
  return (
    <div className="mt-1 flex items-center justify-end gap-3 text-xs text-muted">
      <span className="flex items-center gap-1">
        <svg width="8" height="12" aria-hidden="true">
          <rect x="0.5" y="0.5" width="7" height="11" fill="#ffffff" stroke={CANDLE_COLOR.up} />
        </svg>
        Closed up
      </span>
      <span className="flex items-center gap-1">
        <svg width="8" height="12" aria-hidden="true">
          <rect x="0.5" y="0.5" width="7" height="11" fill={CANDLE_COLOR.down} stroke={CANDLE_COLOR.down} />
        </svg>
        Closed down
      </span>
    </div>
  );
}

/**
 * All four prices in the tooltip, plus the move.
 *
 * The default Recharts tooltip would print the `[low, high]` pair as a raw array —
 * and the four prices are the reason to choose this chart, so they're what it says.
 */
function candleTooltip(
  formatValue: (value: number) => string,
  formatX: (value: string | number) => string,
  label: string,
) {
  return function CandleTooltip(props: unknown) {
    const tooltip = props as { active?: boolean; payload?: { payload?: CandleRow }[] };
    const row = tooltip.payload?.[0]?.payload;
    if (!tooltip.active || row == null) return null;

    const rows: [string, string][] = [
      ["Open", formatValue(row.openCents)],
      ["High", formatValue(row.highCents)],
      ["Low", formatValue(row.lowCents)],
      ["Close", formatValue(row.closeCents)],
    ];

    return (
      <div className="rounded-md border border-line bg-paper px-2 py-1 text-xs shadow-lg">
        <p className="font-medium text-ink">{formatX(row.x)}</p>
        <p className="text-muted">{label}</p>
        <table className="mt-1">
          <tbody>
            {rows.map(([name, value]) => (
              <tr key={name}>
                <td className="pr-2 text-muted">{name}</td>
                <td className="text-right font-medium text-ink">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1" style={{ color: CANDLE_COLOR[row.direction] }}>
          {row.changeCents > 0 ? "+" : ""}
          {formatValue(row.changeCents)}
        </p>
      </div>
    );
  };
}
