"use client";

import type { ReactElement } from "react";
import {
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_CATEGORICAL_COLORS, CHART_CHROME } from "./chart-colors";
import { pointLabelContent } from "./chart-point-labels";
import { ChartToolbar, useChartDisplay } from "./chart-toolbar";
import { selectLabeledIndexes, type ChartDisplayDefaults } from "@/lib/shared/chart-options";

/** What a custom dot renderer is told about the point it's drawing. */
export interface ChartLineDotContext {
  /** Centre of the point, in SVG user units. */
  cx: number;
  cy: number;
  /** Position in `data`, so a renderer can key off the row it came from. */
  index: number;
  /** The whole row this point was read from — carry extra fields on it to switch on. */
  payload: Record<string, number | string>;
  /** The series' resolved colour, so a custom mark can match its line by default. */
  color: string;
}

export interface ChartLineSeries {
  /** Key into each row of `data`. */
  key: string;
  /** Legend/tooltip label. */
  label: string;
  /** Overrides the default categorical slot for this series' position. */
  color?: string;
  /**
   * Draws this series' points yourself, instead of the default filled circle.
   * Return an SVG element, or `null` to draw nothing at that point.
   *
   * Use it when the *shape* of a point carries meaning the line can't — a buy
   * against a sell, say. Prefer a second series when the extra thing is its own
   * quantity; a shape is for annotating the points you already have. Recharts
   * needs an element back, so a plain fragment won't do.
   *
   * A series with custom marks is exempt from the reader's "point markers"
   * toggle: those shapes carry meaning the line doesn't, so hiding them would
   * lose data rather than reduce clutter.
   */
  renderDot?: (context: ChartLineDotContext) => ReactElement | null;
}

export interface ChartLineProps extends ChartDisplayDefaults {
  /** Rows sharing one `xKey` field plus one numeric field per series key. */
  data: Record<string, number | string>[];
  /** One entry per line. A single series renders with no legend box. */
  series: ChartLineSeries[];
  /** Field in `data` used for the x-axis. */
  xKey: string;
  /** Formats a y-axis tick / tooltip value, and any direct point label. */
  formatValue?: (value: number) => string;
  /** Formats an x-axis tick. */
  formatX?: (value: string | number) => string;
  height?: number;
  /**
   * Draw a series straight through rows where its key is missing, instead of
   * breaking the line. For a sparse series — accounts recorded on different
   * schedules — the join is the readable answer, and the dots still mark the
   * rows that hold real data. Default `false`, which is the honest default for
   * a series that genuinely stops and starts.
   */
  connectNulls?: boolean;
  /**
   * How the line is drawn between points. `monotone` (the default) smooths it;
   * `linear` joins the points with straight segments.
   *
   * Prefer `linear` when the gap between two points is an interpolation the
   * reader shouldn't over-read — a smoothed curve implies intermediate movement
   * the data doesn't record, which matters for a sparse series like periodic
   * account balances.
   */
  curve?: "monotone" | "linear";
  className?: string;
}

export function ChartLine({
  data,
  series,
  xKey,
  formatValue = (value) => String(value),
  formatX = (value) => String(value),
  height = 280,
  connectNulls = false,
  curve = "monotone",
  pointLabels,
  showDots,
  showLegend,
  showGrid,
  showToolbar = true,
  displayStorageKey,
  className = "",
}: ChartLineProps) {
  const { display, setDisplay, maxPointLabels } = useChartDisplay(
    {
      pointLabels,
      showDots,
      // The long-standing default: a legend only earns its space once there's more
      // than one colour to tell apart.
      showLegend: showLegend ?? series.length > 1,
      showGrid,
    },
    displayStorageKey,
  );

  // Custom marks are the series' data, not decoration, so they ignore the toggle.
  const hasCustomMarks = series.some((item) => item.renderDot !== undefined);

  return (
    <div className={className}>
      {showToolbar && (
        <ChartToolbar
          className="mb-1"
          value={display}
          onChange={setDisplay}
          canToggleDots={!hasCustomMarks}
          canToggleLegend={series.length > 1}
          pointCount={data.length}
          maxPointLabels={maxPointLabels}
        />
      )}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 14, right: 24, bottom: 0, left: 0 }}>
            {display.showGrid && <CartesianGrid stroke={CHART_CHROME.grid} vertical={false} />}
            <XAxis
              dataKey={xKey}
              tickFormatter={formatX}
              stroke={CHART_CHROME.axis}
              tick={{ fill: CHART_CHROME.mutedText, fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: CHART_CHROME.axis }}
            />
            <YAxis
              tickFormatter={(value: number) => formatValue(value)}
              stroke={CHART_CHROME.axis}
              tick={{ fill: CHART_CHROME.mutedText, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={72}
            />
            <Tooltip
              formatter={(value, name) => [formatValue(Number(value)), String(name)]}
              labelFormatter={(label) => formatX(label as string | number)}
              cursor={{ stroke: CHART_CHROME.axis, strokeWidth: 1 }}
            />
            {display.showLegend && <Legend />}
            {series.map((item, index) => {
              const color =
                item.color ?? CHART_CATEGORICAL_COLORS[index % CHART_CATEGORICAL_COLORS.length];
              const labeledIndexes = selectLabeledIndexes(
                data.map((row) => row[item.key]),
                display.pointLabels,
                maxPointLabels,
              );

              return (
                <Line
                  key={item.key}
                  type={curve}
                  dataKey={item.key}
                  name={item.label}
                  stroke={color}
                  strokeWidth={2}
                  connectNulls={connectNulls}
                  // Recharts renders a mark's labels only once its entry animation
                  // has finished, so with animation on the value labels pop in a
                  // second and a half after the line. ChartXY already draws without
                  // it; this matches.
                  isAnimationActive={false}
                  dot={
                    item.renderDot
                      ? // Recharts hands the renderer its own props and expects an
                        // element back; the cast narrows those to the fields a caller
                        // should care about rather than leaking the library's shape.
                        (props: unknown) => {
                          const dot = props as {
                            cx?: number;
                            cy?: number;
                            index?: number;
                            payload?: Record<string, number | string>;
                          };
                          if (dot.cx == null || dot.cy == null) return <g key="empty" />;
                          return (
                            item.renderDot?.({
                              cx: dot.cx,
                              cy: dot.cy,
                              index: dot.index ?? 0,
                              payload: dot.payload ?? {},
                              color,
                            }) ?? <g key="empty" />
                          );
                        }
                      : // `fill` is explicit because Recharts defaults a dot to white,
                        // which on a dense series chops the line into what looks like
                        // a dashed stroke. The mark spec wants the series colour.
                        display.showDots && { r: 4, strokeWidth: 0, fill: color }
                  }
                  activeDot={{ r: 6 }}
                >
                  {labeledIndexes.length > 0 && (
                    <LabelList
                      dataKey={item.key}
                      content={pointLabelContent({
                        indexes: labeledIndexes,
                        formatValue,
                        placement: "above",
                        lastIndex: data.length - 1,
                        matchField: xKey,
                        allowedKeys: labeledIndexes.map((row) => data[row][xKey]),
                      })}
                    />
                  )}
                </Line>
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
